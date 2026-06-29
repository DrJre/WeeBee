const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onRequest } = require('firebase-functions/v2/https');

initializeApp();

function setCORS(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getCallerUid(req) {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    try { return (await getAuth().verifyIdToken(h.slice(7))).uid; }
    catch { return null; }
}

function sendErr(res, httpStatus, code, message) {
    res.status(httpStatus).json({ error: { status: code, message } });
}

// ── Direct Trade Settlement ───────────────────────────────────────────────────
exports.settleTrade = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { tradeId } = req.body?.data || {};
    if (!tradeId) return sendErr(res, 400, 'INVALID_ARGUMENT', 'tradeId is required.');

    const db = getFirestore();
    const tradeRef = db.collection('trades').doc(tradeId);

    let tradeData, userError = null;
    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(tradeRef);
            if (!snap.exists) { userError = [400, 'NOT_FOUND', 'Trade not found.']; return; }
            const t = snap.data();
            if (t.status !== 'pending')  { userError = [400, 'FAILED_PRECONDITION', 'This trade is no longer pending.']; return; }
            if (t.toUid !== callerUid)   { userError = [403, 'PERMISSION_DENIED', 'You are not the recipient of this trade.']; return; }
            tradeData = t;

            const fromCardRefs = (t.offerCardIds || []).map(id =>
                db.collection('card_collections').doc(t.fromUid).collection('cards').doc(id));
            const toCardRefs = (t.requestCardIds || []).map(id =>
                db.collection('card_collections').doc(t.toUid).collection('cards').doc(id));

            const fromSnaps = [];
            for (const r of fromCardRefs) fromSnaps.push(await tx.get(r));
            const toSnaps = [];
            for (const r of toCardRefs) toSnaps.push(await tx.get(r));

            if (fromSnaps.some(s => !s.exists)) { userError = [400, 'FAILED_PRECONDITION', 'The offerer no longer has all their offered cards.']; return; }
            if (toSnaps.some(s => !s.exists))   { userError = [400, 'FAILED_PRECONDITION', 'You no longer have all the requested cards.']; return; }

            const offerAmber = t.offerAmber || 0;
            const requestAmber = t.requestAmber || 0;

            if (offerAmber > 0) {
                const fp = await tx.get(db.collection('profiles').doc(t.fromUid));
                if (!fp.exists || (fp.data().amber || 0) < offerAmber) { userError = [400, 'FAILED_PRECONDITION', 'The offerer no longer has enough Amber.']; return; }
            }
            if (requestAmber > 0) {
                const tp = await tx.get(db.collection('profiles').doc(t.toUid));
                if (!tp.exists || (tp.data().amber || 0) < requestAmber) { userError = [400, 'FAILED_PRECONDITION', 'You no longer have enough Amber for this trade.']; return; }
            }

            fromCardRefs.forEach(ref => tx.delete(ref));
            for (const card of (t.requestCards || [])) {
                if (!card || typeof card !== 'object') continue;
                const { monthlyUr, id: _id, ...rest } = card;
                tx.set(db.collection('card_collections').doc(t.fromUid).collection('cards').doc(),
                    monthlyUr ? { ...rest, tradedMonthlyUr: true } : rest);
            }

            toCardRefs.forEach(ref => tx.delete(ref));
            for (const card of (t.offerCards || [])) {
                if (!card || typeof card !== 'object') continue;
                const { monthlyUr, id: _id, ...rest } = card;
                tx.set(db.collection('card_collections').doc(t.toUid).collection('cards').doc(),
                    monthlyUr ? { ...rest, tradedMonthlyUr: true } : rest);
            }

            const net = offerAmber - requestAmber;
            if (net !== 0) {
                tx.update(db.collection('profiles').doc(t.fromUid), { amber: FieldValue.increment(-net) });
                tx.update(db.collection('profiles').doc(t.toUid),   { amber: FieldValue.increment( net) });
            }

            tx.update(tradeRef, { status: 'completed', fromCompleted: true, toCompleted: true, updatedAt: new Date() });
        });
    } catch(e) {
        console.error('settleTrade error:', e);
        return sendErr(res, 500, 'INTERNAL', e.message || 'Transaction failed.');
    }

    if (userError) return sendErr(res, ...userError);

    try {
        await getFirestore().collection('notifications').add({
            targetUid: tradeData.fromUid, type: 'trade_offer', tradeId,
            senderUid: callerUid,
            senderName: tradeData.toName || 'A user', senderAvatar: tradeData.toAvatar || '',
            message: 'accepted your trade offer', timestamp: new Date(), read: false,
        });
    } catch(e) {}

    try {
        const lockSnap = await getFirestore().collection('card_trade_locks').where('tradeId', '==', tradeId).get();
        if (!lockSnap.empty) {
            const b = getFirestore().batch();
            lockSnap.docs.forEach(d => b.delete(d.ref));
            await b.commit();
        }
    } catch(e) {}

    res.json({ result: { success: true } });
});

// ── Auction Settlement ────────────────────────────────────────────────────────
exports.settleAuction = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { listingId } = req.body?.data || {};
    if (!listingId) return sendErr(res, 400, 'INVALID_ARGUMENT', 'listingId is required.');

    const db = getFirestore();
    const listingRef = db.collection('auction_listings').doc(listingId);

    let item, userError = null;
    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(listingRef);
            if (!snap.exists) { userError = [404, 'NOT_FOUND', 'Listing not found.']; return; }
            item = snap.data();

            const closeTime = item.closeTime?.toDate ? item.closeTime.toDate() : new Date(item.closeTime);
            if (!['live', 'queued'].includes(item.status)) return; // already settled — no-op
            if (closeTime > new Date()) { userError = [400, 'FAILED_PRECONDITION', 'Auction has not closed yet.']; return; }

            const now = new Date();
            if (item.currentBidderUid) {
                tx.set(db.collection('card_collections').doc(item.currentBidderUid).collection('cards').doc(), item.card);
                tx.update(db.collection('profiles').doc(item.uid), { amber: FieldValue.increment(item.currentBid) });
                tx.update(listingRef, { status: 'won', deliveredAt: now });
            } else {
                tx.set(db.collection('card_collections').doc(item.uid).collection('cards').doc(), item.card);
                tx.update(listingRef, { status: 'unsold', deliveredAt: now });
            }
        });
    } catch(e) {
        console.error('settleAuction error:', e);
        return sendErr(res, 500, 'INTERNAL', e.message || 'Transaction failed.');
    }

    if (userError) return sendErr(res, ...userError);

    if (item?.currentBidderUid) {
        try {
            await Promise.all([
                getFirestore().collection('notifications').add({
                    targetUid: item.currentBidderUid, type: 'auction_won',
                    senderUid: item.uid, senderName: item.displayName || 'Someone',
                    message: `You won the auction for ${item.card?.name || 'a card'}!`,
                    timestamp: new Date(), read: false,
                }),
                getFirestore().collection('notifications').add({
                    targetUid: item.uid, type: 'auction_sold',
                    senderUid: item.currentBidderUid, senderName: item.currentBidderName || 'Someone',
                    message: `Your ${item.card?.name || 'card'} sold for 🟡 ${item.currentBid?.toLocaleString()} Amber!`,
                    timestamp: new Date(), read: false,
                }),
            ]);
        } catch(e) {}
    }

    try {
        const deliveryRef = getFirestore().collection('auction_deliveries').doc(listingId);
        if ((await deliveryRef.get()).exists) await deliveryRef.delete();
    } catch(e) {}

    res.json({ result: { success: true } });
});

// ── Bulletin Trade Settlement ─────────────────────────────────────────────────
exports.settleBulletinOffer = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { listingId, offerId } = req.body?.data || {};
    if (!listingId || !offerId) return sendErr(res, 400, 'INVALID_ARGUMENT', 'listingId and offerId are required.');

    const db = getFirestore();
    const listingRef = db.collection('bulletin_listings').doc(listingId);
    const offerRef   = db.collection('bulletin_offers').doc(offerId);

    let listing, offer, userError = null;
    try {
        await db.runTransaction(async tx => {
            const [lSnap, oSnap] = await Promise.all([tx.get(listingRef), tx.get(offerRef)]);
            if (!lSnap.exists || !oSnap.exists) { userError = [404, 'NOT_FOUND', 'Listing or offer not found.']; return; }
            listing = lSnap.data();
            offer   = oSnap.data();

            if (listing.status !== 'active')  { userError = [400, 'FAILED_PRECONDITION', 'This listing is no longer available.']; return; }
            if (offer.status   !== 'pending') { userError = [400, 'FAILED_PRECONDITION', 'This offer is no longer available.']; return; }
            if (listing.uid    !== callerUid) { userError = [403, 'PERMISSION_DENIED', 'Only the listing owner can accept offers.']; return; }

            const listingCardRefs = (listing.cardIds || []).map(id =>
                db.collection('card_collections').doc(callerUid).collection('cards').doc(id));
            const offerCardRefs = (offer.offerCardIds || []).map(id =>
                db.collection('card_collections').doc(offer.fromUid).collection('cards').doc(id));

            const [lCardSnaps, oCardSnaps] = await Promise.all([
                Promise.all(listingCardRefs.map(r => tx.get(r))),
                Promise.all(offerCardRefs.map(r => tx.get(r))),
            ]);
            if (lCardSnaps.some(s => !s.exists)) { userError = [400, 'FAILED_PRECONDITION', 'You no longer have all your listed cards.']; return; }
            if (oCardSnaps.some(s => !s.exists)) { userError = [400, 'FAILED_PRECONDITION', 'The offerer no longer has all their offered cards.']; return; }

            const offerAmber = offer.offerAmber || 0;
            if (offerAmber > 0) {
                const offerProfile = await tx.get(db.collection('profiles').doc(offer.fromUid));
                if (!offerProfile.exists || (offerProfile.data().amber || 0) < offerAmber) { userError = [400, 'FAILED_PRECONDITION', 'The offerer no longer has enough Amber.']; return; }
            }

            listingCardRefs.forEach(ref => tx.delete(ref));
            (offer.offerCards || []).forEach(card => {
                tx.set(db.collection('card_collections').doc(callerUid).collection('cards').doc(), card);
            });

            offerCardRefs.forEach(ref => tx.delete(ref));
            (listing.cards || []).forEach(card => {
                tx.set(db.collection('card_collections').doc(offer.fromUid).collection('cards').doc(), card);
            });

            if (offerAmber > 0) {
                tx.update(db.collection('profiles').doc(callerUid),    { amber: FieldValue.increment( offerAmber) });
                tx.update(db.collection('profiles').doc(offer.fromUid), { amber: FieldValue.increment(-offerAmber) });
            }

            tx.update(listingRef, { status: 'closed' });
            tx.update(offerRef, { status: 'completed', listingOwnerCompleted: true, offerorCompleted: true, completedAt: new Date() });
        });
    } catch(e) {
        console.error('settleBulletinOffer error:', e);
        return sendErr(res, 500, 'INTERNAL', e.message || 'Transaction failed.');
    }

    if (userError) return sendErr(res, ...userError);

    const db2 = getFirestore();
    try {
        const otherSnap = await db2.collection('bulletin_offers')
            .where('listingOwnerUid', '==', callerUid)
            .where('listingId', '==', listingId)
            .where('status', '==', 'pending')
            .get();
        if (!otherSnap.empty) {
            const b = db2.batch();
            otherSnap.docs.forEach(d => b.update(d.ref, { status: 'declined' }));
            await b.commit();
        }
    } catch(e) {}

    try {
        await db2.collection('notifications').add({
            targetUid: offer.fromUid, type: 'bulletin_offer_accepted',
            senderUid: callerUid, senderName: listing.displayName || 'Someone',
            message: 'accepted your Trade Bulletin offer! Your cards have been transferred.',
            listingId, timestamp: new Date(), read: false,
        });
    } catch(e) {}

    try {
        await db2.collection('trades').add({
            participants: [callerUid, offer.fromUid],
            fromUid: offer.fromUid, fromName: offer.fromName || 'Unknown',
            toUid: callerUid, toName: listing.displayName || 'Unknown',
            offerCards: offer.offerCards || [], requestCards: listing.cards || [],
            offerCardIds: offer.offerCardIds || [], requestCardIds: listing.cardIds || [],
            offerAmber: offer.offerAmber || 0, requestAmber: 0,
            status: 'completed', fromCompleted: true, toCompleted: true,
            source: 'bulletin', bulletinListingId: listingId,
            history: [], createdAt: new Date(), updatedAt: new Date(),
        });
    } catch(e) {}

    try {
        if ((offer.offerCardIds || []).length > 0) {
            const staleListings = await db2.collection('bulletin_listings')
                .where('uid', '==', offer.fromUid).where('status', '==', 'active').get();
            const stale = staleListings.docs.filter(l =>
                (l.data().cardIds || []).some(id => offer.offerCardIds.includes(id)));
            if (stale.length) {
                const b = db2.batch();
                stale.forEach(l => b.update(l.ref, { status: 'withdrawn' }));
                await b.commit();
            }
        }
    } catch(e) {}

    res.json({ result: { success: true } });
});
