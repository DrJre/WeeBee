const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

initializeApp();

// ── Direct Trade Settlement ───────────────────────────────────────────────────
// Called by the recipient when they accept a trade. Validates both sides,
// swaps cards and amber atomically, and marks the trade completed — all in
// one Firestore transaction so there is no window for double-application.
exports.settleTrade = onCall({ invoker: 'public' }, async (request) => {
    const { tradeId } = request.data;
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in.');
    if (!tradeId)   throw new HttpsError('invalid-argument', 'tradeId is required.');

    const db = getFirestore();
    const tradeRef = db.collection('trades').doc(tradeId);

    let tradeData;
    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(tradeRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Trade not found.');
            const t = snap.data();
            if (t.status !== 'pending') throw new HttpsError('failed-precondition', 'This trade is no longer pending.');
            if (t.toUid !== callerUid)  throw new HttpsError('permission-denied',   'You are not the recipient of this trade.');
            tradeData = t;

            // Read and verify both sides own their cards
            const fromCardRefs = (t.offerCardIds || []).map(id =>
                db.collection('card_collections').doc(t.fromUid).collection('cards').doc(id));
            const toCardRefs = (t.requestCardIds || []).map(id =>
                db.collection('card_collections').doc(t.toUid).collection('cards').doc(id));

            const [fromSnaps, toSnaps] = await Promise.all([
                Promise.all(fromCardRefs.map(r => tx.get(r))),
                Promise.all(toCardRefs.map(r => tx.get(r))),
            ]);
            if (fromSnaps.some(s => !s.exists)) throw new HttpsError('failed-precondition', 'The offerer no longer has all their offered cards.');
            if (toSnaps.some(s => !s.exists))   throw new HttpsError('failed-precondition', 'You no longer have all the requested cards.');

            // Verify amber balances
            const offerAmber   = t.offerAmber   || 0;
            const requestAmber = t.requestAmber || 0;
            if (offerAmber > 0) {
                const fp = await tx.get(db.collection('profiles').doc(t.fromUid));
                if (!fp.exists || (fp.data().amber || 0) < offerAmber)
                    throw new HttpsError('failed-precondition', 'The offerer no longer has enough Amber.');
            }
            if (requestAmber > 0) {
                const tp = await tx.get(db.collection('profiles').doc(t.toUid));
                if (!tp.exists || (tp.data().amber || 0) < requestAmber)
                    throw new HttpsError('failed-precondition', 'You no longer have enough Amber for this trade.');
            }

            // Swap: fromUid loses offered cards, gains requested cards
            fromCardRefs.forEach(ref => tx.delete(ref));
            (t.requestCards || []).forEach(card => {
                const { monthlyUr, ...rest } = card;
                tx.set(
                    db.collection('card_collections').doc(t.fromUid).collection('cards').doc(),
                    monthlyUr ? { ...rest, tradedMonthlyUr: true } : rest
                );
            });

            // Swap: toUid loses requested cards, gains offered cards
            toCardRefs.forEach(ref => tx.delete(ref));
            (t.offerCards || []).forEach(card => {
                const { monthlyUr, ...rest } = card;
                tx.set(
                    db.collection('card_collections').doc(t.toUid).collection('cards').doc(),
                    monthlyUr ? { ...rest, tradedMonthlyUr: true } : rest
                );
            });

            // Amber transfer
            const net = offerAmber - requestAmber;
            if (net !== 0) {
                tx.update(db.collection('profiles').doc(t.fromUid), { amber: FieldValue.increment(-net) });
                tx.update(db.collection('profiles').doc(t.toUid),   { amber: FieldValue.increment( net) });
            }

            // Mark completed
            tx.update(tradeRef, { status: 'completed', fromCompleted: true, toCompleted: true, updatedAt: new Date() });
        });
    } catch (e) {
        if (e.code) throw e; // re-throw HttpsError
        throw new HttpsError('internal', e.message);
    }

    // Non-fatal post-transaction cleanup
    const db2 = getFirestore();
    try {
        await db2.collection('notifications').add({
            targetUid: tradeData.fromUid, type: 'trade_offer', tradeId,
            senderUid: callerUid,
            senderName:   tradeData.toName   || 'A user',
            senderAvatar: tradeData.toAvatar || '',
            message: 'accepted your trade offer',
            timestamp: new Date(), read: false,
        });
    } catch(e) {}

    // Release any stale card locks (belt-and-suspenders — locks aren't needed
    // for atomicity with CF, but may exist from before the upgrade)
    try {
        const lockSnap = await db2.collection('card_trade_locks').where('tradeId', '==', tradeId).get();
        if (!lockSnap.empty) {
            const batch = db2.batch();
            lockSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
    } catch(e) {}

    return { success: true };
});

// ── Auction Settlement ────────────────────────────────────────────────────────
// Called by the first client to detect an expired auction. Atomically delivers
// the card to the winner (or returns it to the seller if unsold) and pays out
// amber — all in one transaction, no separate delivery queue needed.
exports.settleAuction = onCall({ invoker: 'public' }, async (request) => {
    const { listingId } = request.data;
    const callerUid = request.auth?.uid;
    if (!callerUid)   throw new HttpsError('unauthenticated', 'Must be signed in.');
    if (!listingId)   throw new HttpsError('invalid-argument', 'listingId is required.');

    const db = getFirestore();
    const listingRef = db.collection('auction_listings').doc(listingId);

    let item;
    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(listingRef);
            if (!snap.exists) throw new HttpsError('not-found', 'Listing not found.');
            item = snap.data();

            const closeTime = item.closeTime?.toDate ? item.closeTime.toDate() : new Date(item.closeTime);
            if (!['live', 'queued'].includes(item.status)) {
                // Another client already settled it — not an error
                const alreadyDone = new Error('already_settled');
                alreadyDone.skip = true;
                throw alreadyDone;
            }
            if (closeTime > new Date()) throw new HttpsError('failed-precondition', 'Auction has not closed yet.');

            const now = new Date();
            if (item.currentBidderUid) {
                // Deliver card to winner, pay seller
                tx.set(
                    db.collection('card_collections').doc(item.currentBidderUid).collection('cards').doc(),
                    item.card
                );
                tx.update(db.collection('profiles').doc(item.uid), { amber: FieldValue.increment(item.currentBid) });
                tx.update(listingRef, { status: 'won', deliveredAt: now });
            } else {
                // No bids — return card to seller
                tx.set(
                    db.collection('card_collections').doc(item.uid).collection('cards').doc(),
                    item.card
                );
                tx.update(listingRef, { status: 'unsold', deliveredAt: now });
            }
        });
    } catch(e) {
        if (e.skip) return { success: true, skipped: true };
        if (e.code) throw e;
        throw new HttpsError('internal', e.message);
    }

    // Notifications (non-fatal)
    const db2 = getFirestore();
    if (item?.currentBidderUid) {
        try {
            await Promise.all([
                db2.collection('notifications').add({
                    targetUid: item.currentBidderUid, type: 'auction_won',
                    senderUid: item.uid, senderName: item.displayName || 'Someone',
                    message: `You won the auction for ${item.card?.name || 'a card'}!`,
                    timestamp: new Date(), read: false,
                }),
                db2.collection('notifications').add({
                    targetUid: item.uid, type: 'auction_sold',
                    senderUid: item.currentBidderUid, senderName: item.currentBidderName || 'Someone',
                    message: `Your ${item.card?.name || 'card'} sold for 🟡 ${item.currentBid?.toLocaleString()} Amber!`,
                    timestamp: new Date(), read: false,
                }),
            ]);
        } catch(e) {}
    }

    // Clean up any legacy delivery doc for this listing (transition period)
    try {
        const deliveryRef = db2.collection('auction_deliveries').doc(listingId);
        const deliverySnap = await deliveryRef.get();
        if (deliverySnap.exists) await deliveryRef.delete();
    } catch(e) {}

    return { success: true };
});

// ── Bulletin Trade Settlement ─────────────────────────────────────────────────
// Called by the listing owner when they accept an offer. Does the full swap
// for BOTH parties atomically — no waiting for the offeror's client to come
// online. Also handles amber transfer, declining other pending offers, and
// logging to trade history.
exports.settleBulletinOffer = onCall({ invoker: 'public' }, async (request) => {
    const { listingId, offerId } = request.data;
    const callerUid = request.auth?.uid;
    if (!callerUid)             throw new HttpsError('unauthenticated',  'Must be signed in.');
    if (!listingId || !offerId) throw new HttpsError('invalid-argument', 'listingId and offerId are required.');

    const db = getFirestore();
    const listingRef = db.collection('bulletin_listings').doc(listingId);
    const offerRef   = db.collection('bulletin_offers').doc(offerId);

    let listing, offer;
    try {
        await db.runTransaction(async tx => {
            const [lSnap, oSnap] = await Promise.all([tx.get(listingRef), tx.get(offerRef)]);
            if (!lSnap.exists || !oSnap.exists) throw new HttpsError('not-found', 'Listing or offer not found.');
            listing = lSnap.data();
            offer   = oSnap.data();

            if (listing.status !== 'active')  throw new HttpsError('failed-precondition', 'This listing is no longer available.');
            if (offer.status   !== 'pending') throw new HttpsError('failed-precondition', 'This offer is no longer available.');
            if (listing.uid    !== callerUid) throw new HttpsError('permission-denied',   'Only the listing owner can accept offers.');

            // Read and verify cards for both sides
            const listingCardRefs = (listing.cardIds || []).map(id =>
                db.collection('card_collections').doc(callerUid).collection('cards').doc(id));
            const offerCardRefs = (offer.offerCardIds || []).map(id =>
                db.collection('card_collections').doc(offer.fromUid).collection('cards').doc(id));

            const [listingCardSnaps, offerCardSnaps] = await Promise.all([
                Promise.all(listingCardRefs.map(r => tx.get(r))),
                Promise.all(offerCardRefs.map(r => tx.get(r))),
            ]);
            if (listingCardSnaps.some(s => !s.exists)) throw new HttpsError('failed-precondition', 'You no longer have all your listed cards.');
            if (offerCardSnaps.some(s => !s.exists))   throw new HttpsError('failed-precondition', 'The offerer no longer has all their offered cards.');

            // Verify offeror amber balance
            const offerAmber = offer.offerAmber || 0;
            if (offerAmber > 0) {
                const offerProfile = await tx.get(db.collection('profiles').doc(offer.fromUid));
                if (!offerProfile.exists || (offerProfile.data().amber || 0) < offerAmber)
                    throw new HttpsError('failed-precondition', 'The offerer no longer has enough Amber.');
            }

            // Swap: listing owner loses listed cards, gains offered cards
            listingCardRefs.forEach(ref => tx.delete(ref));
            (offer.offerCards || []).forEach(card => {
                tx.set(db.collection('card_collections').doc(callerUid).collection('cards').doc(), card);
            });

            // Swap: offeror loses offered cards, gains listed cards
            offerCardRefs.forEach(ref => tx.delete(ref));
            (listing.cards || []).forEach(card => {
                tx.set(db.collection('card_collections').doc(offer.fromUid).collection('cards').doc(), card);
            });

            // Amber transfer from offeror to listing owner
            if (offerAmber > 0) {
                tx.update(db.collection('profiles').doc(callerUid),    { amber: FieldValue.increment( offerAmber) });
                tx.update(db.collection('profiles').doc(offer.fromUid), { amber: FieldValue.increment(-offerAmber) });
            }

            // Close listing and complete offer for both sides
            tx.update(listingRef, { status: 'closed' });
            tx.update(offerRef, {
                status: 'completed',
                listingOwnerCompleted: true,
                offerorCompleted: true,
                completedAt: new Date(),
            });
        });
    } catch(e) {
        if (e.code) throw e;
        throw new HttpsError('internal', e.message);
    }

    const db2 = getFirestore();

    // Decline all other pending offers on this listing (non-fatal)
    try {
        const otherSnap = await db2.collection('bulletin_offers')
            .where('listingOwnerUid', '==', callerUid)
            .where('listingId', '==', listingId)
            .where('status', '==', 'pending')
            .get();
        if (!otherSnap.empty) {
            const batch = db2.batch();
            otherSnap.docs.forEach(d => batch.update(d.ref, { status: 'declined' }));
            await batch.commit();
        }
    } catch(e) {}

    // Notify offeror (non-fatal)
    try {
        await db2.collection('notifications').add({
            targetUid: offer.fromUid, type: 'bulletin_offer_accepted',
            senderUid: callerUid, senderName: listing.displayName || 'Someone',
            message: 'accepted your Trade Bulletin offer! Your cards have been transferred.',
            listingId, timestamp: new Date(), read: false,
        });
    } catch(e) {}

    // Log to trade history (non-fatal)
    try {
        await db2.collection('trades').add({
            participants: [callerUid, offer.fromUid],
            fromUid: offer.fromUid, fromName: offer.fromName    || 'Unknown',
            toUid:   callerUid,    toName:   listing.displayName || 'Unknown',
            offerCards: offer.offerCards || [],  requestCards: listing.cards   || [],
            offerCardIds: offer.offerCardIds || [], requestCardIds: listing.cardIds || [],
            offerAmber: offer.offerAmber || 0, requestAmber: 0,
            status: 'completed', fromCompleted: true, toCompleted: true,
            source: 'bulletin', bulletinListingId: listingId,
            history: [], createdAt: new Date(), updatedAt: new Date(),
        });
    } catch(e) {}

    // Withdraw offeror's own bulletin listings that contained the cards they just gave away (non-fatal)
    try {
        if ((offer.offerCardIds || []).length > 0) {
            const offerorListings = await db2.collection('bulletin_listings')
                .where('uid', '==', offer.fromUid)
                .where('status', '==', 'active')
                .get();
            const stale = offerorListings.docs.filter(l =>
                (l.data().cardIds || []).some(id => offer.offerCardIds.includes(id)));
            if (stale.length) {
                const batch = db2.batch();
                stale.forEach(l => batch.update(l.ref, { status: 'withdrawn' }));
                await batch.commit();
            }
        }
    } catch(e) {}

    return { success: true };
});
