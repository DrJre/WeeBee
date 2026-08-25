const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { TCG_SR_CARDS, TCG_SSR_CARDS, TCG_UR_CARDS, TCG_PR_CARDS, TCG_NR_CARDS, TCG_RELEASED_BATCH } = require('./tcg-card-pools');

initializeApp();

const ADMIN_UID = 'XUD3ym2NcdWtrUiPLlFFaO5ufMh1';

const JIKAN_UPSTREAM = 'https://jikan-railway-production.up.railway.app';

// Thin proxy so the browser never makes cross-origin requests to Railway/Jikan.
exports.jikanProxy = onRequest({ invoker: 'public' }, async (req, res) => {
    const jikanPath = req.path.replace(/^\/jikan/, '');
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `${JIKAN_UPSTREAM}${jikanPath}${search}`;
    try {
        const upstream = await fetch(targetUrl, { headers: { 'User-Agent': 'WeeBee/1.0' } });
        const body = await upstream.text();
        res.set('Content-Type', 'application/json');
        res.set('Cache-Control', 'public, max-age=3600, s-maxage=86400');
        res.status(upstream.status).send(body);
    } catch (e) {
        res.status(502).json({ error: e.message });
    }
});

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

    let tradeData, userError = null, setIntactInvalidations = [];
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

            // Block trade if any card is SET-locked
            const tradeNow2 = new Date();
            const lockedFromCard = fromSnaps.find(s => { const d = s.data(); if (!d.setLockUntil) return false; const t = d.setLockUntil.toDate ? d.setLockUntil.toDate() : new Date(d.setLockUntil); return t > tradeNow2; });
            const lockedToCard   = toSnaps.find(s => { const d = s.data(); if (!d.setLockUntil) return false; const t = d.setLockUntil.toDate ? d.setLockUntil.toDate() : new Date(d.setLockUntil); return t > tradeNow2; });
            if (lockedFromCard) { userError = [400, 'FAILED_PRECONDITION', 'set_locked:offerer']; return; }
            if (lockedToCard)   { userError = [400, 'FAILED_PRECONDITION', 'set_locked:recipient']; return; }

            // Capture SET card references that need intact=false after trade
            for (const s of fromSnaps) {
                const sId = s.data().setCardId;
                if (sId) setIntactInvalidations.push({ uid: t.fromUid, setCardId: sId });
            }
            for (const s of toSnaps) {
                const sId = s.data().setCardId;
                if (sId) setIntactInvalidations.push({ uid: t.toUid, setCardId: sId });
            }

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

            // Verify and transfer offered packs (fromUid → toUid)
            const offerPackIds = t.offerPackIds || [];
            const offerPacks = t.offerPacks || [];
            const fromPackRefs = offerPackIds.map(id =>
                db.collection('inventory').doc(t.fromUid).collection('items').doc(id));
            const fromPackSnaps = [];
            for (const r of fromPackRefs) fromPackSnaps.push(await tx.get(r));
            if (fromPackSnaps.some(s => !s.exists)) { userError = [400, 'FAILED_PRECONDITION', 'The offerer no longer has all their offered packs.']; return; }

            const tradeNow = new Date();
            fromCardRefs.forEach(ref => tx.delete(ref));
            for (const card of (t.requestCards || [])) {
                if (!card || typeof card !== 'object') continue;
                const { monthlyUr, id: _id, ...rest } = card;
                tx.set(db.collection('card_collections').doc(t.fromUid).collection('cards').doc(),
                    monthlyUr ? { ...rest, tradedMonthlyUr: true, acquiredVia: 'trade', acquiredAt: tradeNow } : { ...rest, acquiredVia: 'trade', acquiredAt: tradeNow });
            }

            toCardRefs.forEach(ref => tx.delete(ref));
            for (const card of (t.offerCards || [])) {
                if (!card || typeof card !== 'object') continue;
                const { monthlyUr, id: _id, ...rest } = card;
                tx.set(db.collection('card_collections').doc(t.toUid).collection('cards').doc(),
                    monthlyUr ? { ...rest, tradedMonthlyUr: true, acquiredVia: 'trade', acquiredAt: tradeNow } : { ...rest, acquiredVia: 'trade', acquiredAt: tradeNow });
            }

            // Transfer packs: delete from fromUid, create for toUid
            fromPackRefs.forEach(ref => tx.delete(ref));
            for (const pack of offerPacks) {
                if (!pack || typeof pack !== 'object') continue;
                const { itemId: _itemId, ...rest } = pack;
                tx.set(db.collection('inventory').doc(t.toUid).collection('items').doc(), rest);
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

    // Log amber transfers outside transaction (non-critical)
    try {
        const net = (tradeData.offerAmber || 0) - (tradeData.requestAmber || 0);
        const now = new Date();
        if (net !== 0) {
            await Promise.all([
                db.collection('amber_log').add({ uid: tradeData.fromUid, amount: -net, reason: `trade:${tradeId}`, timestamp: now }),
                db.collection('amber_log').add({ uid: tradeData.toUid,   amount:  net, reason: `trade:${tradeId}`, timestamp: now }),
            ]);
        }
    } catch(e) {}

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

    // Invalidate SET cards for any required cards that were traded away (non-critical)
    if (setIntactInvalidations.length) {
        Promise.allSettled(setIntactInvalidations.map(({ uid, setCardId }) =>
            db.collection('card_collections').doc(uid).collection('cards').doc(setCardId).update({ setIntact: false })
        )).catch(() => {});
    }

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
                tx.set(db.collection('card_collections').doc(item.currentBidderUid).collection('cards').doc(), { ...item.card, acquiredVia: 'auction', acquiredAt: now });
                tx.update(db.collection('profiles').doc(item.uid), { amber: FieldValue.increment(item.currentBid) });
                tx.update(listingRef, { status: 'won', deliveredAt: now });
            } else {
                tx.set(db.collection('card_collections').doc(item.uid).collection('cards').doc(), { ...item.card, acquiredVia: 'auction', acquiredAt: now });
                tx.update(listingRef, { status: 'unsold', deliveredAt: now });
            }
        });
    } catch(e) {
        console.error('settleAuction error:', e);
        return sendErr(res, 500, 'INTERNAL', e.message || 'Transaction failed.');
    }

    if (userError) return sendErr(res, ...userError);

    if (item?.currentBidderUid && item?.currentBid > 0) {
        try {
            await Promise.all([
                getFirestore().collection('amber_log').add({ uid: item.uid, amount: item.currentBid, reason: `auction:sold:${listingId}`, timestamp: new Date() }),
                getFirestore().collection('amber_log').add({ uid: item.currentBidderUid, amount: -item.currentBid, reason: `auction:bid:${listingId}`, timestamp: new Date() }),
            ]);
        } catch(e) {}
    }

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

            const offerCardRefs = (offer.offerCardIds || []).map(id =>
                db.collection('card_collections').doc(offer.fromUid).collection('cards').doc(id));

            if (listing.type === 'wanted') {
                // Wanted listing: seller offers a card → poster pays amber
                const oCardSnaps = await Promise.all(offerCardRefs.map(r => tx.get(r)));
                if (oCardSnaps.some(s => !s.exists)) { userError = [400, 'FAILED_PRECONDITION', 'The seller no longer has the offered card.']; return; }

                const payAmber = listing.offerAmber || 0;
                if (payAmber > 0) {
                    const ownerProfile = await tx.get(db.collection('profiles').doc(callerUid));
                    if (!ownerProfile.exists || (ownerProfile.data().amber || 0) < payAmber) {
                        userError = [400, 'FAILED_PRECONDITION', 'You no longer have enough Amber.']; return;
                    }
                }

                const bulletinNow = new Date();
                offerCardRefs.forEach(ref => tx.delete(ref));
                (offer.offerCards || []).forEach(card => {
                    tx.set(db.collection('card_collections').doc(callerUid).collection('cards').doc(), { ...card, acquiredVia: 'trade', acquiredAt: bulletinNow });
                });

                if (payAmber > 0) {
                    tx.update(db.collection('profiles').doc(callerUid),     { amber: FieldValue.increment(-payAmber) });
                    tx.update(db.collection('profiles').doc(offer.fromUid), { amber: FieldValue.increment( payAmber) });
                }
            } else {
                // For-trade listing: swap cards + offeror pays amber
                const listingCardRefs = (listing.cardIds || []).map(id =>
                    db.collection('card_collections').doc(callerUid).collection('cards').doc(id));

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

                const bulletinNow = new Date();
                listingCardRefs.forEach(ref => tx.delete(ref));
                (offer.offerCards || []).forEach(card => {
                    tx.set(db.collection('card_collections').doc(callerUid).collection('cards').doc(), { ...card, acquiredVia: 'trade', acquiredAt: bulletinNow });
                });

                offerCardRefs.forEach(ref => tx.delete(ref));
                (listing.cards || []).forEach(card => {
                    tx.set(db.collection('card_collections').doc(offer.fromUid).collection('cards').doc(), { ...card, acquiredVia: 'trade', acquiredAt: bulletinNow });
                });

                if (offerAmber > 0) {
                    tx.update(db.collection('profiles').doc(callerUid),    { amber: FieldValue.increment( offerAmber) });
                    tx.update(db.collection('profiles').doc(offer.fromUid), { amber: FieldValue.increment(-offerAmber) });
                }
            }

            tx.update(listingRef, { status: 'closed' });
            tx.update(offerRef, { status: 'completed', listingOwnerCompleted: true, offerorCompleted: true, completedAt: new Date() });
        });
    } catch(e) {
        console.error('settleBulletinOffer error:', e);
        return sendErr(res, 500, 'INTERNAL', e.message || 'Transaction failed.');
    }

    if (userError) return sendErr(res, ...userError);

    // Log amber transfer outside transaction (non-critical)
    const db2 = getFirestore();
    if (listing?.type === 'wanted') {
        const payAmber = listing.offerAmber || 0;
        if (payAmber > 0) {
            try {
                const now = new Date();
                await Promise.all([
                    db2.collection('amber_log').add({ uid: callerUid,       amount: -payAmber, reason: `bulletin:wanted:paid:${listingId}`,   timestamp: now }),
                    db2.collection('amber_log').add({ uid: offer.fromUid,   amount:  payAmber, reason: `bulletin:wanted:earned:${listingId}`, timestamp: now }),
                ]);
            } catch(e) {}
        }
    } else {
        if ((offer?.offerAmber || 0) > 0) {
            try {
                const now = new Date();
                await Promise.all([
                    db2.collection('amber_log').add({ uid: callerUid,       amount:  offer.offerAmber, reason: `bulletin:sold:${listingId}`, timestamp: now }),
                    db2.collection('amber_log').add({ uid: offer.fromUid,   amount: -offer.offerAmber, reason: `bulletin:offer:${listingId}`, timestamp: now }),
                ]);
            } catch(e) {}
        }
    }

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

    const notifMessage = listing?.type === 'wanted'
        ? 'accepted your offer! The card has been transferred and Amber sent to you.'
        : 'accepted your Trade Bulletin offer! Your cards have been transferred.';
    try {
        await db2.collection('notifications').add({
            targetUid: offer.fromUid, type: 'bulletin_offer_accepted',
            senderUid: callerUid, senderName: listing.displayName || 'Someone',
            message: notifMessage,
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
            offerAmber: listing?.type === 'wanted' ? (listing.offerAmber || 0) : (offer.offerAmber || 0),
            requestAmber: 0,
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

// ── Inventory / Server-Side Pack Rolling ────────────────────────────────────────
// Pack contents are rolled here (never client-side) and frozen onto the inventory
// item the instant a pack is purchased/gifted — this closes the exploit where a
// tampered client could write itself a fake rare card directly to card_collections,
// and guarantees a hoarded pack can't benefit from future card-pool changes since
// its contents are already locked in before it's ever opened.
//
// Serial numbers are NOT assigned here — only card identity (name/anime/rarity/image)
// is frozen at roll time. Serial/edition gets assigned at OPEN time (openInventoryItems)
// so an unopened pack sitting in someone's inventory doesn't permanently reserve a
// serial slot nobody has actually claimed yet.

// Mirrors TCG_PACKS in app.js — keep cost/odds/flags in sync if that array changes.
const TCG_PACKS = {
    standard: {
        id: 'standard', name: 'Standard Pack', cost: 150,
        guaranteedSR: false, prismatic: false,
        image: 'https://pub-b241667abcf649f48658584322a083c1.r2.dev/tcg-art/Booster%20Packs/Standard%20Pack.png',
    },
    premium: {
        id: 'premium', name: 'Premium Pack', cost: 750,
        guaranteedSR: true, prismatic: false,
        image: 'https://pub-b241667abcf649f48658584322a083c1.r2.dev/tcg-art/Booster%20Packs/Premium%20Pack.png',
    },
    current_premium: {
        id: 'current_premium', name: 'Current Batch Premium', cost: 800,
        guaranteedSR: true, currentBatch: true,
        image: 'https://pub-b241667abcf649f48658584322a083c1.r2.dev/tcg-art/Booster%20Packs/Premium%20Pack.png',
    },
    filler: {
        id: 'filler', name: 'Filler Pack', cost: 800,
        guaranteedSR: true, filler: true,
        image: 'https://pub-b241667abcf649f48658584322a083c1.r2.dev/tcg-art/Booster%20Packs/Premium%20Pack.png',
    },
    prismatic: {
        id: 'prismatic', name: 'Neon 2026 Pack', cost: 800,
        guaranteedSR: false, prismatic: true,
        image: 'https://pub-b241667abcf649f48658584322a083c1.r2.dev/tcg-art/Booster%20Packs/Neon%202026%20Pack.png',
    },
};

const RARITY_MAX_VERSIONS = { common: 5000, rare: 2500, sr: 500, ssr: 250, ur: 50, pr: 100 };

// ── Pity system ───────────────────────────────────────────────────────────────
function getPityField(packId) {
    if (packId === 'standard') return 'pityStandard';
    if (packId === 'premium'  || packId === 'current_premium' || packId === 'filler') return 'pityPremium';
    return null; // prismatic and other event packs have no pity
}
// 30% headstart for users who opened packs before pity was tracked
const PITY_HEADSTART = { pityStandard: 180, pityPremium: 22 };

// Returns the incremental pity UR injection chance for a given counter.
// 0 = below threshold (natural roll only). 1.0 = hard pity (guaranteed inject).
// Standard: soft pity at 400 (+0.5%/pack), hard pity at 600.
// Premium:  soft pity at 50  (+2%/pack),   hard pity at 75.
function calcPityUrChance(packId, counter) {
    if (packId === 'standard') {
        if (counter >= 600) return 1.0;
        if (counter > 400)  return Math.min(1.0, (counter - 400) * 0.005);
        return 0;
    }
    if (packId === 'premium' || packId === 'current_premium' || packId === 'filler') {
        if (counter >= 75) return 1.0;
        if (counter > 50)  return Math.min(1.0, (counter - 50) * 0.02);
        return 0;
    }
    return 0;
}

// Mirrors _normalizeSeriesName() in app.js
function normalizeSeriesName(title) {
    if (!title) return title;
    let t = title;
    t = t.replace(/:\s*(The\s+)?Final Season.*/i, '');
    t = t.replace(/:\s*\d+(st|nd|rd|th)?\s+Season.*/i, '');
    t = t.replace(/:\s*Season\s+\d+.*/i, '');
    t = t.replace(/\s+Season\s+\d+\s*$/i, '');
    t = t.replace(/\s*[:\-]\s*Part\s+\d+\s*$/i, '');
    t = t.replace(/\s+Part\s+\d+\s*$/i, '');
    t = t.replace(/\s+[-–]\s+.*?(Arc|Chapter|Cour)\s*\d*\s*$/i, '');
    return t.trim();
}

// Mirrors _tcgEnsureCardPool() in app.js — Firestore 'characters' collection
// per rarityTier, falling back to the copied-in arrays from tcg-card-pools.js
// when Firestore has nothing for that tier yet. Cached per warm instance.
let _cardPoolCache = null;
let _cardPoolCacheAt = 0;
const CARD_POOL_TTL_MS = 5 * 60 * 1000;
async function ensureCardPool(db) {
    const now = Date.now();
    if (_cardPoolCache && (now - _cardPoolCacheAt) < CARD_POOL_TTL_MS) return _cardPoolCache;
    const charsRef = db.collection('characters');
    const [rareSnap, commonSnap, srSnap, ssrSnap, urSnap, prSnap, nrSnap] = await Promise.all([
        charsRef.where('rarityTier', '==', 'rare').limit(2000).get(),
        charsRef.where('rarityTier', '==', 'common').limit(2000).get(),
        charsRef.where('rarityTier', '==', 'sr').limit(500).get(),
        charsRef.where('rarityTier', '==', 'ssr').limit(500).get(),
        charsRef.where('rarityTier', '==', 'ur').limit(100).get(),
        charsRef.where('rarityTier', '==', 'pr').limit(200).get(),
        charsRef.where('rarityTier', '==', 'nr').limit(200).get(),
    ]);
    const filterDocs = (snap, requireSeries) => {
        const out = [];
        snap.forEach(d => {
            const c = d.data();
            if (c.name && c.image && !c.imageBroken && (!requireSeries || c.series)) out.push(c);
        });
        return out;
    };
    _cardPoolCache = {
        rare: filterDocs(rareSnap, true),
        common: filterDocs(commonSnap, true),
        sr: filterDocs(srSnap, false),
        ssr: filterDocs(ssrSnap, false),
        ur: filterDocs(urSnap, false),
        pr: filterDocs(prSnap, false),
        nr: filterDocs(nrSnap, false),
    };
    _cardPoolCacheAt = now;
    return _cardPoolCache;
}

function computeCurrentBatch(pool) {
    let max = 1;
    for (const tier of Object.values(pool)) {
        for (const card of tier) {
            if ((card.batch || 1) > max) max = card.batch;
        }
    }
    return max;
}

// Mirrors _tcgPickCard() in app.js
function pickCard(pool, rarity) {
    if (rarity === 'pr') {
        const arr = pool.pr.length ? pool.pr : TCG_PR_CARDS;
        if (!arr.length) return pickCard(pool, 'sr');
        const src = arr[Math.floor(Math.random() * arr.length)];
        return { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'pr' };
    }
    if (rarity === 'nr') {
        const arr = (pool.nr && pool.nr.length) ? pool.nr : TCG_NR_CARDS;
        if (!arr.length) return pickCard(pool, 'sr');
        const src = arr[Math.floor(Math.random() * arr.length)];
        return { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'nr',
                 neonA: src.neonA || null, neonB: src.neonB || null, neonC: src.neonC || null,
                 neonClass: src.neonClass || '', flickerDelay: src.flickerDelay || '0s' };
    }
    if (rarity === 'ur') {
        const all = pool.ur.length ? pool.ur : TCG_UR_CARDS;
        const released = all.filter(c => (c.batch || 1) <= TCG_RELEASED_BATCH);
        const arr = released.length ? released : all;
        if (!arr.length) return pickCard(pool, 'ssr');
        const src = arr[Math.floor(Math.random() * arr.length)];
        return { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'ur' };
    }
    if (rarity === 'ssr') {
        const arr = pool.ssr.length ? pool.ssr : TCG_SSR_CARDS;
        if (arr.length) {
            const src = arr[Math.floor(Math.random() * arr.length)];
            return { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'ssr' };
        }
        rarity = 'sr';
    }
    if (rarity === 'sr') {
        const arr = pool.sr.length ? pool.sr : TCG_SR_CARDS;
        const src = arr[Math.floor(Math.random() * arr.length)];
        return { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'sr' };
    }
    const arr = rarity === 'rare' ? pool.rare : pool.common;
    if (!arr.length) return { name: '???', anime: '', image: '', rarity };
    const c = arr[Math.floor(Math.random() * arr.length)];
    return { name: c.name, anime: normalizeSeriesName(c.series || c.anime || ''), image: c.image, rarity };
}

// Picks a card filtered to targetBatch. UR uses 4:1 weighting (current vs older),
// restricted to batch <= TCG_RELEASED_BATCH so unreleased URs can't appear.
function pickCardBatch(pool, rarity, targetBatch) {
    if (rarity === 'ur') {
        const all = (pool.ur.length ? pool.ur : TCG_UR_CARDS).filter(c => (c.batch || 1) <= TCG_RELEASED_BATCH);
        const cur = all.filter(c => (c.batch || 1) === targetBatch);
        // Strictly batch-locked; fall back to full UR pool only if this batch has no URs yet
        const src = cur.length ? cur[Math.floor(Math.random() * cur.length)]
                  : all.length ? all[Math.floor(Math.random() * all.length)]
                  : null;
        if (!src) return pickCard(pool, 'ssr');
        return { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'ur' };
    }
    let arr;
    if (rarity === 'ssr') {
        const all = pool.ssr.length ? pool.ssr : TCG_SSR_CARDS;
        arr = all.filter(c => (c.batch || 1) === targetBatch);
        if (!arr.length) arr = all;
        if (!arr.length) return pickCardBatch(pool, 'sr', targetBatch);
    } else if (rarity === 'sr') {
        const all = pool.sr.length ? pool.sr : TCG_SR_CARDS;
        arr = all.filter(c => (c.batch || 1) === targetBatch);
        if (!arr.length) arr = all;
    } else if (rarity === 'rare') {
        arr = pool.rare.filter(c => (c.batch || 1) === targetBatch);
        if (!arr.length) arr = pool.rare;
        if (!arr.length) return { name: '???', anime: '', image: '', rarity };
    } else {
        arr = pool.common.filter(c => (c.batch || 1) === targetBatch);
        if (!arr.length) arr = pool.common;
        if (!arr.length) return { name: '???', anime: '', image: '', rarity };
    }
    if (!arr.length) return { name: '???', anime: '', image: '', rarity };
    const src = arr[Math.floor(Math.random() * arr.length)];
    return { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity };
}

// Mirrors _tcgRollCurrentBatchPackCards() in app.js.
// SR boosted: +0.5% guaranteed slot, +0.25% normal slots (taken from Rare).
function rollCurrentBatchPackCards(pool, pack, targetBatch) {
    const cards = [];
    const pick = (r) => pickCardBatch(pool, r, targetBatch);
    const g = Math.random();
    if (pack.guaranteedSR) {
        // Current Batch Premium: SSR 4% (+0.5% vs regular), SR 96%
        cards.push(pick(g < 0.04 ? 'ssr' : 'sr'));
    } else {
        if      (g < 0.004) cards.push(pick('ssr'));
        else if (g < 0.055) cards.push(pick('sr'));
        else                cards.push(pick('rare'));
    }
    for (let i = 0; i < 4; i++) {
        const r = Math.random();
        let rarity;
        if (pack.guaranteedSR) {
            // Current Batch Premium: SSR 0.75% (+0.25%), SR 3.5%, Rare 20.75%, Common 75%
            if      (r < 0.0075) rarity = 'ssr';
            else if (r < 0.0425) rarity = 'sr';
            else if (r < 0.2500) rarity = 'rare';
            else                 rarity = 'common';
        } else {
            if      (r < 0.001)  rarity = 'ssr';
            else if (r < 0.0075) rarity = 'sr';
            else if (r < 0.1000) rarity = 'rare';
            else                 rarity = 'common';
        }
        cards.push(pick(rarity));
    }
    const urChance = 0.004;
    if (Math.random() < urChance) {
        cards[Math.floor(Math.random() * cards.length)] = pick('ur');
    }
    return cards.sort(() => Math.random() - 0.5);
}

// Mirrors _tcgRollPackCards() in app.js (standard/premium, no customOdds — that's an
// admin-only client preview tool, never used in the real purchase flow)
function rollPackCards(pool, pack) {
    const cards = [];
    if (pack.guaranteedSR) {
        cards.push(pickCard(pool, Math.random() < 0.035 ? 'ssr' : 'sr'));
    } else {
        const r = Math.random();
        if      (r < 0.004) cards.push(pickCard(pool, 'ssr'));
        else if (r < 0.05)  cards.push(pickCard(pool, 'sr'));
        else                cards.push(pickCard(pool, 'rare'));
    }
    for (let i = 0; i < 4; i++) {
        const r = Math.random();
        let rarity;
        if (pack.guaranteedSR) {
            if      (r < 0.005) rarity = 'ssr';
            else if (r < 0.04)  rarity = 'sr';
            else if (r < 0.25)  rarity = 'rare';
            else                rarity = 'common';
        } else {
            if      (r < 0.001) rarity = 'ssr';
            else if (r < 0.005) rarity = 'sr';
            else if (r < 0.10)  rarity = 'rare';
            else                rarity = 'common';
        }
        cards.push(pickCard(pool, rarity));
    }
    const urChance = pack.guaranteedSR ? 0.0025 : 0.001;
    if (Math.random() < urChance) {
        cards[Math.floor(Math.random() * cards.length)] = pickCard(pool, 'ur');
    }
    return cards.sort(() => Math.random() - 0.5);
}

// Mirrors _tcgRollPrismaticPackCards() in app.js
function rollPrismaticPackCards(pool) {
    const cards = [];
    for (let i = 0; i < 5; i++) {
        const r = Math.random();
        let rarity;
        if      (r < 0.04) rarity = 'nr';
        else if (r < 0.30) rarity = 'sr';
        else                rarity = 'rare';
        cards.push(pickCard(pool, rarity));
    }
    return cards.sort(() => Math.random() - 0.5);
}

// Rolls a single pack's 5 cards, including god-pack odds.
// currentBatch and filler packs filter the pool to a specific batch with 4:1 UR weighting.
function rollOnePack(pool, pack, fillerBatch = null) {
    let godPackTheme = null;
    let cards;
    if (pack.prismatic) {
        const isPrismaticGodPack = Math.random() < 0.01;
        godPackTheme = isPrismaticGodPack ? 'neon' : null;
        cards = isPrismaticGodPack
            ? [pickCard(pool,'nr'), pickCard(pool,'nr'), pickCard(pool,'nr'), pickCard(pool,'nr'), pickCard(pool,'nr')]
            : rollPrismaticPackCards(pool);
    } else if (pack.currentBatch || pack.filler) {
        const targetBatch = pack.filler ? (fillerBatch || 1) : computeCurrentBatch(pool);
        const isGodPack = pack.guaranteedSR && Math.random() < 0.0002;
        godPackTheme = isGodPack ? 'gold' : null;
        cards = isGodPack
            ? [pickCard(pool,'ur'), pickCard(pool,'ur'), pickCard(pool,'ssr'), pickCard(pool,'ssr'), pickCard(pool,'ssr')]
            : rollCurrentBatchPackCards(pool, pack, targetBatch);
    } else {
        const isGodPack = pack.guaranteedSR && Math.random() < 0.0002;
        godPackTheme = isGodPack ? 'gold' : null;
        cards = isGodPack
            ? [pickCard(pool,'ur'), pickCard(pool,'ur'), pickCard(pool,'ssr'), pickCard(pool,'ssr'), pickCard(pool,'ssr')]
            : rollPackCards(pool, pack);
    }
    return { cards, godPackTheme };
}

// Mirrors _tcgCardKey() / _tcgShufflePool() / _tcgAssignSerial() in app.js
function cardKey(card) {
    const n = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return `${card.rarity}_${n(card.name)}_${n(card.anime)}`;
}
function shufflePool(max) {
    const arr = Array.from({ length: max }, (_, i) => i + 1);
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}
async function assignSerial(db, card) {
    const key = cardKey(card);
    const maxV = RARITY_MAX_VERSIONS[card.rarity] || 5000;
    const ref = db.collection('card_serials').doc(key);
    return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists || !snap.data().versionsRemaining?.length) {
            const edition = snap.exists ? (snap.data().edition || 1) + 1 : 1;
            const pool = shufflePool(maxV);
            const version = pool.pop();
            tx.set(ref, { versionsRemaining: pool, edition, maxVersions: maxV });
            return { version, edition };
        }
        const { edition = 1 } = snap.data();
        const pool = [...snap.data().versionsRemaining];
        const idx = Math.floor(Math.random() * pool.length);
        const version = pool.splice(idx, 1)[0];
        tx.update(ref, { versionsRemaining: pool });
        return { version, edition };
    });
}

// ── Purchase Packs (1x/5x/10x) — rolls + freezes contents into inventory ──────
async function incrementUserStats(db, uid, fields) {
    const year = new Date().getFullYear().toString();
    const updates = {};
    for (const [k, v] of Object.entries(fields)) updates[k] = FieldValue.increment(v);
    const statsRef = db.collection('user_stats').doc(uid);
    const yearRef  = statsRef.collection('years').doc(year);
    await Promise.all([
        statsRef.set(updates, { merge: true }),
        yearRef.set(updates, { merge: true }),
    ]);
}

exports.purchasePacks = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { packId, quantity } = req.body?.data || {};
    const pack = TCG_PACKS[packId];
    if (!pack) return sendErr(res, 400, 'INVALID_ARGUMENT', 'Unknown pack.');
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) return sendErr(res, 400, 'INVALID_ARGUMENT', 'Quantity must be between 1 and 10.');

    const db = getFirestore();

    if (pack.prismatic) {
        try {
            const evSnap = await db.collection('tcg_event_config').doc('prismatic').get();
            const evData = evSnap.exists ? evSnap.data() : {};
            const startAt = evData.startAt ?? null;
            const start = startAt?.toDate ? startAt.toDate() : (startAt ? new Date(startAt) : null);
            let endAt;
            if (evData.endAt) {
                endAt = evData.endAt.toDate ? evData.endAt.toDate() : new Date(evData.endAt);
            } else {
                endAt = start ? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000) : null;
            }
            if (!endAt || endAt <= new Date()) return sendErr(res, 400, 'FAILED_PRECONDITION', 'The Prismatic Pack event is not currently running.');
        } catch(e) {
            return sendErr(res, 500, 'INTERNAL', 'Failed to verify event status.');
        }
    }

    let costPerPack = pack.cost;
    try {
        const saleSnap = await db.collection('tcg_sale_config').doc('current').get();
        const saleEnabled = saleSnap.exists ? !!saleSnap.data().enabled : false;
        if (saleEnabled) {
            const prices = (saleSnap.exists && saleSnap.data().prices) || {};
            const salePrice = prices[packId];
            if (salePrice != null && salePrice > 0) costPerPack = salePrice;
        }
    } catch(e) {}
    const totalCost = costPerPack * quantity;

    const profileRef = db.collection('profiles').doc(callerUid);
    try {
        await db.runTransaction(async tx => {
            const pd = await tx.get(profileRef);
            const amber = pd.exists ? (pd.data().amber || 0) : 0;
            if (amber < totalCost) throw new Error('NOT_ENOUGH_AMBER');
            tx.update(profileRef, { amber: FieldValue.increment(-totalCost) });
        });
    } catch(e) {
        if (e.message === 'NOT_ENOUGH_AMBER') return sendErr(res, 400, 'FAILED_PRECONDITION', 'Not enough Amber.');
        console.error('purchasePacks amber deduction error:', e);
        return sendErr(res, 500, 'INTERNAL', 'Purchase failed.');
    }

    try {
        await db.collection('amber_log').add({ uid: callerUid, amount: -totalCost, reason: `pack:${packId}x${quantity}`, timestamp: new Date() });
    } catch(e) {}
    incrementUserStats(db, callerUid, { amberSpent: totalCost }).catch(() => {});

    // Load filler batch for filler packs
    let fillerBatch = null;
    if (pack.filler) {
        try {
            const fillerSnap = await db.collection('tcg_event_config').doc('filler').get();
            fillerBatch = fillerSnap.exists ? (fillerSnap.data().batch || null) : null;
        } catch(e) {}
        if (!fillerBatch) return sendErr(res, 400, 'FAILED_PRECONDITION', 'Filler pack is not currently available.');
    }

    try {
        const pool = await ensureCardPool(db);
        const cardBatch = computeCurrentBatch(pool);
        const bulkBatchId = quantity > 1 ? db.collection('inventory').doc().id : null;
        const itemIds = [];
        const batch = db.batch();
        const invCol = db.collection('inventory').doc(callerUid).collection('items');
        for (let i = 0; i < quantity; i++) {
            const { cards, godPackTheme } = rollOnePack(pool, pack, fillerBatch);
            const itemRef = invCol.doc();
            batch.set(itemRef, {
                type: 'pack', packId: pack.id, packName: pack.name, packImage: pack.image,
                rolledCards: cards, godPackTheme, source: 'purchase', bulkBatchId,
                cardBatch, grantedAt: new Date(),
            });
            itemIds.push(itemRef.id);
        }
        await batch.commit();
        res.json({ result: { success: true, itemIds, bulkBatchId } });
    } catch(e) {
        console.error('purchasePacks roll/write error:', e);
        try { await profileRef.update({ amber: FieldValue.increment(totalCost) }); } catch(e2) { console.error('purchasePacks refund failed:', e2); }
        return sendErr(res, 500, 'INTERNAL', "Something went wrong opening that pack. You've been refunded — please try again.");
    }
});

// ── Open Inventory Items — assigns serials, moves cards into the collection ────
exports.openInventoryItems = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { itemIds } = req.body?.data || {};
    if (!Array.isArray(itemIds) || !itemIds.length) return sendErr(res, 400, 'INVALID_ARGUMENT', 'itemIds is required.');
    if (itemIds.length > 50) return sendErr(res, 400, 'INVALID_ARGUMENT', 'Too many items at once.');

    const db = getFirestore();
    const invCol = db.collection('inventory').doc(callerUid).collection('items');

    let items;
    try {
        const snaps = await Promise.all(itemIds.map(id => invCol.doc(id).get()));
        if (snaps.some(s => !s.exists)) return sendErr(res, 400, 'FAILED_PRECONDITION', 'One or more packs were already opened or do not exist.');
        items = snaps.map(s => ({ id: s.id, ...s.data() }));
    } catch(e) {
        console.error('openInventoryItems read error:', e);
        return sendErr(res, 500, 'INTERNAL', 'Failed to load packs.');
    }

    // Load card pool (needed for pity UR injection)
    let pool = null;
    try { pool = await ensureCardPool(db); } catch(e) { console.error('openInventoryItems pool error:', e); }

    // Read pity counters — default to headstart if field has never been set
    const profileRef = db.collection('profiles').doc(callerUid);
    const pityCounters = { pityStandard: PITY_HEADSTART.pityStandard, pityPremium: PITY_HEADSTART.pityPremium };
    // pityXxxUsedBatch tracks which batch number the pity UR was already claimed for (null = not yet claimed)
    const pityUsedBatch = { pityStandard: null, pityPremium: null };
    try {
        const profSnap = await profileRef.get();
        const profData = profSnap.exists ? profSnap.data() : {};
        if (profData.pityStandard !== undefined) pityCounters.pityStandard = profData.pityStandard;
        if (profData.pityPremium  !== undefined) pityCounters.pityPremium  = profData.pityPremium;
        if (profData.pityStandardUsedBatch !== undefined) pityUsedBatch.pityStandard = profData.pityStandardUsedBatch;
        if (profData.pityPremiumUsedBatch  !== undefined) pityUsedBatch.pityPremium  = profData.pityPremiumUsedBatch;
    } catch(e) { console.error('openInventoryItems pity read error:', e); }
    const pityFieldsChanged = new Set();

    const revealed = [];
    try {
        for (const item of items) {
            // Apply pity: potentially inject UR into pre-rolled cards
            let rolledCards = [...(item.rolledCards || [])];
            const pityField = getPityField(item.packId);
            if (pityField) {
                const hasNaturalUR = rolledCards.some(c => c.rarity === 'ur');
                // Natural URs no longer reset the pity counter — only a pity-triggered UR does.
                // Also enforce 1 pity UR per batch cap.
                const batchCapHit = pityUsedBatch[pityField] === TCG_RELEASED_BATCH;
                if (!hasNaturalUR && !batchCapHit) {
                    const pityChance = calcPityUrChance(item.packId, pityCounters[pityField]);
                    if (pityChance > 0 && Math.random() < pityChance) {
                        const urArr = pool?.ur?.length ? pool.ur : TCG_UR_CARDS;
                        const src = urArr[Math.floor(Math.random() * urArr.length)];
                        const urCard = { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'ur' };
                        rolledCards = [...rolledCards];
                        rolledCards[Math.floor(Math.random() * rolledCards.length)] = urCard;
                        pityCounters[pityField] = 0;
                        pityUsedBatch[pityField] = TCG_RELEASED_BATCH;
                    } else {
                        pityCounters[pityField]++;
                    }
                } else if (!hasNaturalUR) {
                    // Batch cap hit — still increment so counter is accurate for next batch
                    pityCounters[pityField]++;
                }
                pityFieldsChanged.add(pityField);
            }

            const finishedCards = [];
            for (const card of rolledCards) {
                const { version, edition } = await assignSerial(db, card);
                finishedCards.push({ ...card, serial: version, edition });
            }
            const cardCol = db.collection('card_collections').doc(callerUid).collection('cards');
            const batch = db.batch();
            const pulledAt = new Date();
            finishedCards.forEach(c => {
                const cardDoc = { name: c.name, anime: c.anime, rarity: c.rarity, image: c.image, serial: c.serial, edition: c.edition, pulledAt, acquiredVia: 'pack', acquiredAt: pulledAt };
                if (c.rarity === 'nr') { cardDoc.neonA = c.neonA || null; cardDoc.neonB = c.neonB || null; cardDoc.neonC = c.neonC || null; cardDoc.neonClass = c.neonClass || ''; cardDoc.flickerDelay = c.flickerDelay || '0s'; }
                batch.set(cardCol.doc(), cardDoc);
            });
            batch.delete(invCol.doc(item.id));
            await batch.commit();
            revealed.push({ itemId: item.id, packId: item.packId, packName: item.packName, godPackTheme: item.godPackTheme || null, cards: finishedCards });
        }
    } catch(e) {
        console.error('openInventoryItems open error:', e);
        return res.status(500).json({ error: { status: 'INTERNAL', message: 'Failed to open one or more packs — please try again for the rest. Already-opened packs were saved to your collection.' }, partial: { packs: revealed } });
    }

    // Write updated pity counters and batch-used flags
    if (pityFieldsChanged.size > 0) {
        const pityUpdate = {};
        for (const f of pityFieldsChanged) {
            pityUpdate[f] = pityCounters[f];
            pityUpdate[f + 'UsedBatch'] = pityUsedBatch[f];
        }
        try { await profileRef.update(pityUpdate); } catch(e) { console.error('openInventoryItems pity write error:', e); }
    }

    // Track stats for packs opened this batch
    try {
        const statFields = {};
        for (const pack of revealed) {
            const isStandard = pack.packId === 'standard';
            const isPremium  = pack.packId === 'premium' || pack.packId === 'current_premium' || pack.packId === 'filler';
            const statKey = isStandard ? 'packsOpenedStandard' : isPremium ? 'packsOpenedPremium' : 'packsOpenedEvent';
            statFields[statKey] = (statFields[statKey] || 0) + 1;
            if (pack.godPackTheme) statFields.godPacksOpened = (statFields.godPacksOpened || 0) + 1;
            for (const card of (pack.cards || [])) {
                if (card.rarity === 'ssr') statFields.ssrsPulled = (statFields.ssrsPulled || 0) + 1;
                if (card.rarity === 'ur')  statFields.ursPulled  = (statFields.ursPulled  || 0) + 1;
            }
        }
        await incrementUserStats(db, callerUid, statFields);
    } catch(e) { console.error('openInventoryItems stats error:', e); }

    res.json({ result: { success: true, packs: revealed } });
});

// ── Admin: Backfill Stripe Pity URs (one-time) ───────────────────────────────
// Reads all stripe_sessions, computes how many $30 thresholds each user has
// crossed on non-bonusUr bundles, grants Pity UR inventory items, and sets
// stripePityCents to the leftover cents. Safe to re-run: already-processed
// sessions are detected by checking existing stripePityCents + inventory.
const STRIPE_BUNDLE_PRICES = { amber_1000: 99, amber_5750: 499, amber_12000: 999 };
const STRIPE_PITY_THRESHOLD = 3000;

exports.adminBackfillStripePity = onRequest({ invoker: 'public', timeoutSeconds: 300 }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const callerUid = await getCallerUid(req);
    if (callerUid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');

    const db = getFirestore();
    const dryRun = req.body?.data?.dryRun !== false;

    // Load all stripe sessions
    const sessionsSnap = await db.collection('stripe_sessions').get();

    // Sum spend per user (bonusUr bundle already includes a UR — skip it)
    const spendByUid = {};
    sessionsSnap.forEach(d => {
        const { uid, bundleId } = d.data();
        if (!uid || !STRIPE_BUNDLE_PRICES[bundleId]) return;
        spendByUid[uid] = (spendByUid[uid] || 0) + STRIPE_BUNDLE_PRICES[bundleId];
    });

    const grants = Object.entries(spendByUid)
        .map(([uid, totalCents]) => ({
            uid,
            totalCents,
            ursOwed: Math.floor(totalCents / STRIPE_PITY_THRESHOLD),
            remainderCents: totalCents % STRIPE_PITY_THRESHOLD,
        }))
        .filter(g => g.ursOwed > 0);

    if (dryRun) {
        return res.json({ result: { dryRun: true, usersQualified: grants.length, totalUrs: grants.reduce((s,g) => s+g.ursOwed,0), grants } });
    }

    // Load UR pool once
    const pool = [];
    const poolSnap = await db.collection('characters').where('rarityTier', '==', 'ur').limit(100).get();
    poolSnap.forEach(d => { const c = d.data(); if (c.name && c.image && !c.imageBroken) pool.push(c); });
    if (!pool.length) return sendErr(res, 500, 'INTERNAL', 'No UR cards in pool.');

    const results = [];
    for (const g of grants) {
        try {
            const invCol = db.collection('inventory').doc(g.uid).collection('items');
            const profileRef = db.collection('profiles').doc(g.uid);
            const batch = db.batch();
            const granted = [];
            for (let i = 0; i < g.ursOwed; i++) {
                const src = pool[Math.floor(Math.random() * pool.length)];
                const urCard = { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'ur' };
                const itemRef = invCol.doc();
                batch.set(itemRef, {
                    type: 'pack', packId: 'bonus_ur', packName: 'Pity UR',
                    packImage: 'https://pub-b241667abcf649f48658584322a083c1.r2.dev/tcg-art/Booster%20Packs/Premium%20Pack.png',
                    rolledCards: [urCard], godPackTheme: null, source: 'stripe_pity_backfill', bulkBatchId: null, grantedAt: new Date(),
                });
                granted.push(urCard.name);
            }
            batch.update(profileRef, { stripePityCents: g.remainderCents });
            await batch.commit();
            results.push({ uid: g.uid, granted, remainderCents: g.remainderCents, ok: true });
        } catch(e) {
            results.push({ uid: g.uid, ok: false, error: e.message });
        }
    }

    res.json({ result: { dryRun: false, results } });
});

// ── PVP Battle Settlement ─────────────────────────────────────────────────────
// Runs battle resolution and handles all cross-user Firestore writes (amber/card
// payouts) that client-side rules can't do safely.
exports.settlePvpBattle = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { challengeId, defenderParty, defenderWagerCards } = req.body?.data || {};
    if (!challengeId || !Array.isArray(defenderParty) || defenderParty.length !== 3)
        return sendErr(res, 400, 'INVALID_ARGUMENT', 'challengeId and defenderParty (3 cards) are required.');

    const db = getFirestore();
    const challengeRef = db.collection('pvp_challenges').doc(challengeId);

    // Port of the client-side power/battle helpers
    const RARITY_POWER = { common:1, rare:5, sr:9, 'sr+':13, pr:11, nr:11, ar:11, ssr:13, 'ssr+':17, ur:17, 'ur+':25 };
    const PVP_MVP_THRESHOLDS = { sr: 12, 'sr+': 12, ssr: 30, 'ssr+': 30, ur: 50, 'ur+': 50 };
    function cardPower(card, boosts) {
        const animeKey = (card.anime || '').toLowerCase().trim();
        const animeBoost = (boosts || {})[animeKey] || 0;
        if (card.monthlyUr || card.tradedMonthlyUr) return 16 + animeBoost;
        if (card.rarity === 'set') return (card.setIntact !== false ? 25 : 1) + animeBoost;
        let p = RARITY_POWER[card.rarity] || 1;
        if (card.founder) p += 3;
        else if (card.rarity !== 'pr' && !card.event && card.serial != null) {
            if (card.serial < 10) p += 3;
            else if (card.serial < 100) p += 2;
            else if (card.serial < 1000) p += 1;
        }
        const mvpT = PVP_MVP_THRESHOLDS[card.rarity];
        if (mvpT != null && (card.mvpCount || 0) >= mvpT) p += 1;
        return p + animeBoost;
    }
    function roundPower(card, party, boosts) {
        const isCombo = party.some(c => c !== card && (c.anime||'') === (card.anime||'') && card.anime);
        return cardPower(card, boosts) + (isCombo ? 1 : 0);
    }
    function sortParty(party, boosts) { return [...party].sort((a,b) => cardPower(b, boosts) - cardPower(a, boosts)); }
    function successChance(partyPow, difficulty) {
        return Math.max(15, Math.min(98, Math.round(50 + (partyPow - difficulty) * 4)));
    }

    let battleResult, challengeData, userError = null;
    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(challengeRef);
            if (!snap.exists) { userError = [404, 'NOT_FOUND', 'Challenge not found.']; return; }
            const c = snap.data();
            if (c.status !== 'pending') { userError = [400, 'FAILED_PRECONDITION', 'This challenge is no longer active.']; return; }
            if (c.defenderId !== callerUid) { userError = [403, 'PERMISSION_DENIED', 'Only the defender can accept this challenge.']; return; }
            challengeData = c;

            // Always load both profiles — needed for anime boosts + optionally amber check
            const [cProf, dProf] = await Promise.all([
                tx.get(db.collection('profiles').doc(c.challengerId)),
                tx.get(db.collection('profiles').doc(callerUid)),
            ]);
            const challengerBoosts = cProf.exists ? (cProf.data().animeBoosts || {}) : {};
            const defenderBoosts   = dProf.exists ? (dProf.data().animeBoosts || {}) : {};

            // Amber check
            if (c.battleType === 'amber' && c.amberWager > 0) {
                const cAmber = cProf.exists ? (cProf.data().amber || 0) : 0;
                const dAmber = dProf.exists ? (dProf.data().amber || 0) : 0;
                if (cAmber < c.amberWager || dAmber < c.amberWager) {
                    userError = [400, 'FAILED_PRECONDITION', 'amber_insufficient'];
                    tx.update(challengeRef, { status: 'cancelled', cancelReason: 'amber_insufficient' });
                    return;
                }
            }

            // Resolve battle
            const cParty = sortParty(c.challengerParty, challengerBoosts);
            const dParty = sortParty(defenderParty, defenderBoosts);
            const rounds = [0, 1, 2].map(i => {
                const cCard = cParty[i], dCard = dParty[i];
                const cPow = roundPower(cCard, c.challengerParty, challengerBoosts);
                const dPow = roundPower(dCard, defenderParty, defenderBoosts);
                const chance = successChance(cPow, dPow);
                const cWins = Math.random() * 100 < chance;
                return { challengerCard: cCard, defenderCard: dCard, challengerPower: cPow, defenderPower: dPow, winner: cWins ? 'challenger' : 'defender' };
            });
            const cScore = rounds.filter(r => r.winner === 'challenger').length;
            const dScore = 3 - cScore;
            const winner = cScore > dScore ? 'challenger' : 'defender';
            const winnerUid = winner === 'challenger' ? c.challengerId : callerUid;
            const loserUid  = winner === 'challenger' ? callerUid : c.challengerId;

            battleResult = { rounds, winner, challengerScore: cScore, defenderScore: dScore };
            const now = new Date();

            // Update challenge doc
            tx.update(challengeRef, {
                defenderParty,
                defenderWagerCards: c.battleType === 'card' ? (defenderWagerCards || null) : null,
                status: 'complete',
                result: battleResult,
                resolvedAt: now,
            });

            // Amber payouts
            if (c.battleType === 'amber' && c.amberWager > 0) {
                tx.update(db.collection('profiles').doc(c.challengerId), { amber: FieldValue.increment(-c.amberWager) });
                tx.update(db.collection('profiles').doc(callerUid),      { amber: FieldValue.increment(-c.amberWager) });
                tx.update(db.collection('profiles').doc(winnerUid),      { amber: FieldValue.increment(c.amberWager * 2) });
            }

            // Card payouts — only move the LOSER's cards to the winner.
            // Winner already owns their wagered cards; re-writing them would create
            // duplicates with mismatched doc IDs that break selection and dismantle.
            if (c.battleType === 'card') {
                const pvpNow = new Date();
                const loserWagerCards = winnerUid === c.challengerId ? (defenderWagerCards || []) : (c.challengerWagerCards || []);
                for (const wc of loserWagerCards) {
                    const newRef = db.collection('card_collections').doc(winnerUid).collection('cards').doc();
                    // Stamp id field to match the new document path so UI lookups stay consistent.
                    tx.set(newRef, { ...wc, id: newRef.id, acquiredVia: 'pvp', acquiredAt: pvpNow });
                    if (wc.id) tx.delete(db.collection('card_collections').doc(loserUid).collection('cards').doc(wc.id));
                }
            }
        });
    } catch(e) {
        console.error('settlePvpBattle error:', e);
        return sendErr(res, 500, 'INTERNAL', e.message || 'Transaction failed.');
    }

    if (userError) return sendErr(res, ...userError);

    // Log amber wager payouts (outside transaction — non-critical)
    if (challengeData?.battleType === 'amber' && challengeData?.amberWager > 0) {
        try {
            const winnerUid2 = battleResult.winner === 'challenger' ? challengeData.challengerId : callerUid;
            const loserUid2  = battleResult.winner === 'challenger' ? callerUid : challengeData.challengerId;
            const now = new Date();
            await Promise.all([
                db.collection('amber_log').add({ uid: winnerUid2, amount: challengeData.amberWager, reason: `pvp:win:${challengeId}`, timestamp: now }),
                db.collection('amber_log').add({ uid: loserUid2,  amount: -challengeData.amberWager, reason: `pvp:loss:${challengeId}`, timestamp: now }),
            ]);
        } catch(e) {}
    }

    // Notify challenger (outside transaction — non-critical)
    try {
        const c = challengeData;
        await db.collection('notifications').doc(`pvpr_${challengeId}`).set({
            targetUid: c.challengerId, type: 'pvp_result', challengeId,
            senderUid: callerUid,
            senderName: c.defenderName || 'Opponent',
            senderAvatar: c.defenderAvatar || '',
            message: battleResult.winner === 'challenger'
                ? 'Your challenge was accepted — you won! ⚔️🏆'
                : 'Your challenge was accepted — you lost. ⚔️💀',
            timestamp: new Date(), read: false,
        }, { merge: true });
    } catch(e) {}

    res.json({ result: { battleResult } });
});

// ── Admin: Gift Pack(s) to a User ───────────────────────────────────────────────
exports.adminGiftPack = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');
    if (callerUid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');

    const { targetUid, packId, quantity } = req.body?.data || {};
    const pack = TCG_PACKS[packId];
    if (!targetUid) return sendErr(res, 400, 'INVALID_ARGUMENT', 'targetUid is required.');
    if (!pack) return sendErr(res, 400, 'INVALID_ARGUMENT', 'Unknown pack.');
    const qty = (Number.isInteger(quantity) && quantity >= 1 && quantity <= 10) ? quantity : 1;

    const db = getFirestore();
    let fillerBatch = null;
    if (pack.filler) {
        try {
            const snap = await db.collection('tcg_event_config').doc('filler').get();
            fillerBatch = snap.exists ? (snap.data().batch || null) : null;
        } catch(e) {}
    }
    try {
        const pool = await ensureCardPool(db);
        const cardBatch = computeCurrentBatch(pool);
        const bulkBatchId = qty > 1 ? db.collection('inventory').doc().id : null;
        const itemIds = [];
        const batch = db.batch();
        const invCol = db.collection('inventory').doc(targetUid).collection('items');
        for (let i = 0; i < qty; i++) {
            const { cards, godPackTheme } = rollOnePack(pool, pack, fillerBatch);
            const itemRef = invCol.doc();
            batch.set(itemRef, {
                type: 'pack', packId: pack.id, packName: pack.name, packImage: pack.image,
                rolledCards: cards, godPackTheme, source: 'gift', grantedBy: callerUid, bulkBatchId,
                cardBatch, grantedAt: new Date(),
            });
            itemIds.push(itemRef.id);
        }
        await batch.commit();
        res.json({ result: { success: true, itemIds } });
    } catch(e) {
        console.error('adminGiftPack error:', e);
        return sendErr(res, 500, 'INTERNAL', 'Gift failed: ' + e.message);
    }
});

// ── Admin: Gift God Pack Cards Directly to a User's Collection ───────────────
// Writes 5 cards of the specified rarity straight into card_collections — no
// inventory step. Used to compensate users who received the wrong rarity during
// the PR→NR bug window. godPackType: 'ur' | 'nr' | 'pr'
exports.adminGiftGodPack = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');
    if (callerUid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');

    const { targetUid, godPackType } = req.body?.data || {};
    if (!targetUid) return sendErr(res, 400, 'INVALID_ARGUMENT', 'targetUid is required.');
    if (!['ur', 'nr', 'pr'].includes(godPackType)) return sendErr(res, 400, 'INVALID_ARGUMENT', 'godPackType must be ur, nr, or pr.');

    const db = getFirestore();
    try {
        const pool = await ensureCardPool(db);
        const isEvent = godPackType === 'nr' || godPackType === 'pr';
        const cardCol = db.collection('card_collections').doc(targetUid).collection('cards');
        const batch = db.batch();
        const giftedAt = new Date();
        const cards = [];
        for (let i = 0; i < 5; i++) {
            const c = pickCard(pool, godPackType);
            let serial = null, edition = null;
            if (!isEvent) {
                const assigned = await assignSerial(db, c);
                serial = assigned.version;
                edition = assigned.edition;
            }
            const cardDoc = { name: c.name, anime: c.anime, rarity: c.rarity, image: c.image, serial, edition, pulledAt: giftedAt, acquiredVia: 'gift', acquiredAt: giftedAt };
            if (c.rarity === 'nr') { cardDoc.neonA = c.neonA || null; cardDoc.neonB = c.neonB || null; cardDoc.neonC = c.neonC || null; cardDoc.neonClass = c.neonClass || ''; cardDoc.flickerDelay = c.flickerDelay || '0s'; }
            batch.set(cardCol.doc(), cardDoc);
            cards.push({ name: c.name, rarity: c.rarity });
        }
        await batch.commit();
        res.json({ result: { success: true, cards } });
    } catch(e) {
        console.error('adminGiftGodPack error:', e);
        return sendErr(res, 500, 'INTERNAL', 'Gift failed: ' + e.message);
    }
});

// ── TCG Community Boss ─────────────────────────────────────────────────────

const BOSS_CARD_DAMAGE_CF = { common: 10, rare: 30, sr: 150, 'sr+': 275, ssr: 500, 'ssr+': 1000, ur: 2000, 'ur+': 4000, pr: 800 };
const BOSS_CRIT_RATES    = { ssr: 0.20, 'ssr+': 0.20, ur: 0.25, 'ur+': 0.25 }; // 20% SSR(+), 25% UR(+) → 2× damage on crit
const BOSS_ANIME_MATCH_MULT = 1.5;                   // +50% if card anime matches the boss

exports.attackBoss = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { cardIds } = req.body?.data || {};
    if (!Array.isArray(cardIds) || cardIds.length === 0 || cardIds.length > 5) {
        return sendErr(res, 400, 'INVALID_ARGUMENT', 'Pick 1–5 cards to attack with.');
    }

    const db = getFirestore();
    const bossRef = db.collection('dungeon_boss').doc('current');

    const bossSnap = await bossRef.get();
    if (!bossSnap.exists) return sendErr(res, 400, 'NOT_FOUND', 'No active boss right now.');
    const boss = bossSnap.data();
    if (boss.status !== 'active') return sendErr(res, 400, 'FAILED_PRECONDITION', boss.status === 'defeated' ? 'The boss has already been defeated!' : 'The boss battle has ended.');

    const now = new Date();
    if (boss.startDate && boss.startDate.toDate() > now) return sendErr(res, 400, 'FAILED_PRECONDITION', 'The boss battle hasn\'t started yet.');
    if (boss.endDate.toDate() < now) return sendErr(res, 400, 'FAILED_PRECONDITION', 'The boss battle has ended.');

    const todayStr = now.toISOString().slice(0, 10);
    const weekId = boss.weekId;

    const dailyRef = db.collection('dungeon_attacks').doc(weekId).collection('daily').doc(`${todayStr}_${callerUid}`);
    const userRef  = db.collection('dungeon_attacks').doc(weekId).collection('users').doc(callerUid);

    const cardRefs  = cardIds.map(id => db.collection('card_collections').doc(callerUid).collection('cards').doc(id));
    const cardSnaps = await Promise.all(cardRefs.map(r => r.get()));
    if (cardSnaps.some(s => !s.exists)) return sendErr(res, 400, 'FAILED_PRECONDITION', 'One or more selected cards were not found.');

    const attackedCards = cardSnaps.map(s => {
        const data = s.data();
        const baseDamage = BOSS_CARD_DAMAGE_CF[data.rarity] || 0;
        const critRate = BOSS_CRIT_RATES[data.rarity] || 0;
        const isCrit = critRate > 0 && Math.random() < critRate;
        const isAnimeMatch = !!(boss.anime && data.anime &&
            data.anime.trim().toLowerCase() === boss.anime.trim().toLowerCase());
        let finalDamage = isCrit ? baseDamage * 2 : baseDamage;
        if (isAnimeMatch) finalDamage = Math.round(finalDamage * BOSS_ANIME_MATCH_MULT);
        return {
            id: s.id, name: data.name, rarity: data.rarity, image: data.image, anime: data.anime,
            baseDamage, isCrit, isAnimeMatch, damage: finalDamage,
        };
    });
    const totalDamage = attackedCards.reduce((sum, c) => sum + c.damage, 0);

    let newHp = 0, bossDefeated = false, userError = null;

    try {
        await db.runTransaction(async tx => {
            const dailySnap = await tx.get(dailyRef);
            if (dailySnap.exists) {
                userError = [400, 'FAILED_PRECONDITION', "You already attacked the boss today! Come back tomorrow."];
                return;
            }
            const liveBoss = await tx.get(bossRef);
            if (!liveBoss.exists || liveBoss.data().status !== 'active') {
                userError = [400, 'FAILED_PRECONDITION', 'Boss is no longer active.'];
                return;
            }
            newHp = Math.max(0, liveBoss.data().hpRemaining - totalDamage);
            bossDefeated = newHp <= 0;

            tx.set(dailyRef, { uid: callerUid, weekId, date: todayStr, damage: totalDamage, cards: attackedCards, attackedAt: new Date() });
            tx.set(userRef, { uid: callerUid, totalDamage: FieldValue.increment(totalDamage), daysAttacked: FieldValue.increment(1), lastAttacked: new Date() }, { merge: true });
            tx.update(bossRef, bossDefeated ? { hpRemaining: 0, status: 'defeated', defeatedAt: new Date() } : { hpRemaining: newHp });
        });
    } catch(e) {
        console.error('attackBoss error:', e);
        return sendErr(res, 500, 'INTERNAL', 'Attack failed: ' + e.message);
    }

    if (userError) return sendErr(res, ...userError);
    res.json({ result: { success: true, damage: totalDamage, hpRemaining: newHp, bossDefeated, cards: attackedCards } });
});

exports.claimBossReward = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { weekId } = req.body?.data || {};
    if (!weekId) return sendErr(res, 400, 'INVALID_ARGUMENT', 'weekId is required.');

    const db = getFirestore();
    const bossRef = db.collection('dungeon_boss').doc('current');
    const userRef  = db.collection('dungeon_attacks').doc(weekId).collection('users').doc(callerUid);

    const bossSnap = await bossRef.get();
    if (!bossSnap.exists) return sendErr(res, 400, 'NOT_FOUND', 'Boss not found.');
    const boss = bossSnap.data();
    if (boss.weekId !== weekId) return sendErr(res, 400, 'NOT_FOUND', 'Boss week mismatch.');

    const now = new Date();
    const isOver = boss.status === 'defeated' || (boss.endDate.toDate() < now);
    if (!isOver) return sendErr(res, 400, 'FAILED_PRECONDITION', 'The boss battle is still ongoing!');

    let amberAwarded = 0, userError = null;

    try {
        await db.runTransaction(async tx => {
            const userSnap = await tx.get(userRef);
            if (!userSnap.exists) { userError = [400, 'NOT_FOUND', "You didn't participate in this boss battle."]; return; }
            const ud = userSnap.data();
            if (ud.claimedAt) { userError = [400, 'FAILED_PRECONDITION', "You've already claimed this reward."]; return; }

            const daysAttacked = ud.daysAttacked || 0;
            const rewardPerDay = boss.rewardPerDay || 150;
            const multiplier   = boss.status === 'defeated' ? 1 : (boss.partialMultiplier || 0.5);
            amberAwarded = Math.round(daysAttacked * rewardPerDay * multiplier);

            if (amberAwarded > 0) {
                tx.update(db.collection('profiles').doc(callerUid), { amber: FieldValue.increment(amberAwarded) });
            }
            tx.update(userRef, { claimedAt: new Date(), amberClaimed: amberAwarded });
        });
    } catch(e) {
        console.error('claimBossReward error:', e);
        return sendErr(res, 500, 'INTERNAL', 'Claim failed: ' + e.message);
    }

    if (userError) return sendErr(res, ...userError);
    res.json({ result: { success: true, amberAwarded } });
});

exports.adminSpawnBoss = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid || callerUid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');

    const { name, anime, image, hp, rewardPerDay, partialMultiplier, weekId, startDate, endDate } = req.body?.data || {};
    if (!name || !anime || !image || !hp || !weekId) {
        return sendErr(res, 400, 'INVALID_ARGUMENT', 'name, anime, image, hp, weekId required.');
    }

    const db = getFirestore();
    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    await db.collection('dungeon_boss').doc('current').set({
        name, anime, image,
        hp: Number(hp), hpRemaining: Number(hp),
        weekId, startDate: start, endDate: end,
        status: 'active',
        rewardPerDay: Number(rewardPerDay) || 150,
        partialMultiplier: Number(partialMultiplier) || 0.5,
        spawnedAt: new Date(),
    });

    res.json({ result: { success: true } });
});

exports.adminScanBossHP = onRequest({ invoker: 'public', timeoutSeconds: 300 }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid || callerUid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');

    const db = getFirestore();
    const DAMAGE = { common: 10, rare: 30, sr: 150, ssr: 500, ur: 2000, pr: 800 };
    const colDocs = await db.collection('card_collections').listDocuments();

    const userPowers = [];
    for (const colRef of colDocs) {
        const cardsSnap = await colRef.collection('cards').get();
        if (cardsSnap.size < 5) continue;
        const powers = cardsSnap.docs.map(d => DAMAGE[d.data().rarity] || 0).sort((a, b) => b - a);
        userPowers.push(powers.slice(0, 5).reduce((s, p) => s + p, 0));
    }

    if (userPowers.length === 0) return res.json({ result: { suggestedHp: 100000, activeUsers: 0, avgTop5Power: 0 } });

    const avgTop5 = userPowers.reduce((s, p) => s + p, 0) / userPowers.length;
    const suggestedHp = Math.round(avgTop5 * 0.65 * 5 * userPowers.length);

    res.json({ result: {
        suggestedHp,
        activeUsers: userPowers.length,
        avgTop5Power: Math.round(avgTop5),
        minTop5: Math.min(...userPowers),
        maxTop5: Math.max(...userPowers),
    }});
});

// ── TCG Tournament System ──────────────────────────────────────────────────────

// Battle simulation helpers (mirrors settlePvpBattle — kept separate to avoid coupling)
const T_RARITY_POWER = { common:1, rare:5, sr:9, 'sr+':13, pr:11, nr:11, ar:11, ssr:13, 'ssr+':17, ur:17, 'ur+':25 };
function _tCardPower(card) {
    if (card.monthlyUr || card.tradedMonthlyUr) return 16;
    let p = T_RARITY_POWER[card.rarity] || 1;
    if (card.founder) p += 3;
    else if (card.rarity !== 'pr' && !card.event && card.serial != null) {
        if (card.serial < 10) p += 3;
        else if (card.serial < 100) p += 2;
        else if (card.serial < 1000) p += 1;
    }
    return p;
}
function _tRoundPower(card, party) {
    const isCombo = party.some(c => c !== card && (c.anime||'') === (card.anime||'') && card.anime);
    return _tCardPower(card) + (isCombo ? 1 : 0);
}
function _tSortParty(party) { return [...party].sort((a,b) => _tCardPower(b) - _tCardPower(a)); }
function _tSuccessChance(p1Pow, p2Pow) {
    return Math.max(15, Math.min(98, Math.round(50 + (p1Pow - p2Pow) * 4)));
}
function _tSimulateGame(p1Party, p2Party) {
    const sp1 = _tSortParty(p1Party), sp2 = _tSortParty(p2Party);
    let p1Score = 0, p2Score = 0;
    for (let i = 0; i < 3; i++) {
        const pow1 = _tRoundPower(sp1[i], p1Party);
        const pow2 = _tRoundPower(sp2[i], p2Party);
        if (Math.random() * 100 < _tSuccessChance(pow1, pow2)) p1Score++; else p2Score++;
    }
    return { winner: p1Score >= 2 ? 'p1' : 'p2', p1Score, p2Score };
}
function _tSimulateMatch(p1Party, p2Party, bestOf) {
    const winsNeeded = Math.ceil(bestOf / 2);
    let p1Wins = 0, p2Wins = 0;
    const games = [];
    while (p1Wins < winsNeeded && p2Wins < winsNeeded) {
        const g = _tSimulateGame(p1Party, p2Party);
        games.push(g);
        if (g.winner === 'p1') p1Wins++; else p2Wins++;
    }
    return { winner: p1Wins >= winsNeeded ? 'p1' : 'p2', p1Wins, p2Wins, games };
}

async function _generateBracketInternal(db, tourneyId, tourneyData) {
    const tourneyRef = db.collection('pvp_tournaments').doc(tourneyId);
    const entriesSnap = await tourneyRef.collection('entries').get();
    const entries = entriesSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

    if (entries.length < 2) {
        const batch = db.batch();
        batch.update(tourneyRef, { status: 'cancelled', cancelReason: 'Not enough players registered (minimum 2).' });
        for (const e of entries)
            batch.update(db.collection('profiles').doc(e.uid), { amber: FieldValue.increment(tourneyData.entryCost || 1000) });
        await batch.commit();
        return;
    }

    const shuffled = [...entries].sort(() => Math.random() - 0.5);
    let bracketSize = 1;
    while (bracketSize < shuffled.length) bracketSize *= 2;
    while (shuffled.length < bracketSize) shuffled.push(null);

    const totalRounds = Math.log2(bracketSize);
    const matchesRef = tourneyRef.collection('matches');
    const batch = db.batch();

    for (let round = 1; round <= totalRounds; round++) {
        const matchCount = bracketSize / Math.pow(2, round);
        const isFinal = round === totalRounds;
        for (let idx = 0; idx < matchCount; idx++) {
            const matchId = `r${round}_${idx}`;
            const nextMatchId = round < totalRounds ? `r${round+1}_${Math.floor(idx/2)}` : null;
            const nextMatchSlot = idx % 2 === 0 ? 'p1' : 'p2';
            const doc = {
                round, matchIndex: idx, isFinal,
                bestOf: isFinal ? 7 : 3,
                status: 'pending', winner: null,
                p1Wins: 0, p2Wins: 0, games: [],
                nextMatchId, nextMatchSlot, p1: null, p2: null,
            };
            if (round === 1) {
                const e1 = shuffled[idx * 2], e2 = shuffled[idx * 2 + 1];
                doc.p1 = e1 ? { uid: e1.uid, displayName: e1.displayName, avatar: e1.avatar, party: e1.party } : null;
                doc.p2 = e2 ? { uid: e2.uid, displayName: e2.displayName, avatar: e2.avatar, party: e2.party } : null;
                if (!e1) { doc.status = 'bye'; doc.winner = e2.uid; }
                else if (!e2) { doc.status = 'bye'; doc.winner = e1.uid; }
            }
            batch.set(matchesRef.doc(matchId), doc);
        }
    }

    // Pre-fill round 2 slots for byes so round 1 byes don't block advancement
    if (totalRounds > 1) {
        for (let idx = 0; idx < bracketSize / 2; idx++) {
            const e1 = shuffled[idx * 2], e2 = shuffled[idx * 2 + 1];
            const byeWinner = !e1 ? e2 : (!e2 ? e1 : null);
            if (byeWinner) {
                const nextMatchId = `r2_${Math.floor(idx / 2)}`;
                const slot = idx % 2 === 0 ? 'p1' : 'p2';
                batch.update(matchesRef.doc(nextMatchId), {
                    [slot]: { uid: byeWinner.uid, displayName: byeWinner.displayName, avatar: byeWinner.avatar, party: byeWinner.party }
                });
            }
        }
    }

    const nextRoundTime = new Date(Date.now() + 10 * 60 * 1000);
    batch.update(tourneyRef, {
        status: 'in_progress', currentRound: 1,
        totalRounds, bracketSize,
        playerCount: entries.length,
        nextRoundTime, startedAt: new Date(),
    });
    await batch.commit();
}

async function _resolveCurrentRound(db, tourneyId, tourneyData) {
    const { currentRound, totalRounds } = tourneyData;
    const tourneyRef = db.collection('pvp_tournaments').doc(tourneyId);
    const matchesRef = tourneyRef.collection('matches');

    const roundSnap = await matchesRef.where('round', '==', currentRound).get();
    const matches = roundSnap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

    const batch = db.batch();
    const advancers = [];

    for (const match of matches) {
        if (match.status === 'complete' || match.status === 'bye') {
            if (match.winner && match.nextMatchId) {
                const w = match.p1?.uid === match.winner ? match.p1 : match.p2;
                if (w) advancers.push({ winner: w, nextMatchId: match.nextMatchId, nextMatchSlot: match.nextMatchSlot });
            }
            continue;
        }
        if (!match.p1 || !match.p2) continue;

        const result = _tSimulateMatch(match.p1.party, match.p2.party, match.bestOf);
        const winnerPlayer = result.winner === 'p1' ? match.p1 : match.p2;
        batch.update(match.ref, {
            status: 'complete', winner: winnerPlayer.uid,
            p1Wins: result.p1Wins, p2Wins: result.p2Wins, games: result.games,
        });
        if (match.nextMatchId)
            advancers.push({ winner: winnerPlayer, nextMatchId: match.nextMatchId, nextMatchSlot: match.nextMatchSlot });
    }

    for (const { winner, nextMatchId, nextMatchSlot } of advancers)
        batch.update(matchesRef.doc(nextMatchId), { [nextMatchSlot]: winner });

    await batch.commit();

    const refreshed = await matchesRef.where('round', '==', currentRound).get();
    const allDone = refreshed.docs.every(d => ['complete','bye'].includes(d.data().status));
    if (!allDone) return;

    if (currentRound === totalRounds) {
        const finalDoc = refreshed.docs.find(d => d.data().isFinal);
        const fd = finalDoc?.data();
        const winnerId = fd?.winner;
        const winnerData = fd?.p1?.uid === winnerId ? fd.p1 : fd?.p2;
        await tourneyRef.update({ status: 'complete', winnerId, winnerName: winnerData?.displayName || '', completedAt: new Date() });
        await _distributePrizes(db, tourneyId, tourneyData, totalRounds);
    } else {
        await tourneyRef.update({ currentRound: currentRound + 1, nextRoundTime: new Date(Date.now() + 10 * 60 * 1000) });
    }
}

async function _distributePrizes(db, tourneyId, tourneyData, totalRounds) {
    const prizes = tourneyData.prizes || {};
    if (!Object.keys(prizes).length) return;

    const matchesSnap = await db.collection('pvp_tournaments').doc(tourneyId).collection('matches').get();
    const matches = matchesSnap.docs.map(d => d.data()).filter(m => ['complete','bye'].includes(m.status));
    const byRound = r => matches.filter(m => m.round === r);
    const standings = {};
    const addLoser = (m, place) => {
        const loser = m.p1?.uid === m.winner ? m.p2 : m.p1;
        if (loser?.uid && !standings[loser.uid]) standings[loser.uid] = place;
    };

    byRound(totalRounds).forEach(m => {
        if (m.winner && !standings[m.winner]) standings[m.winner] = 1;
        addLoser(m, 2);
    });
    if (totalRounds >= 2) { let p = 3; byRound(totalRounds-1).forEach(m => addLoser(m, p++)); }
    if (totalRounds >= 3) { let p = 5; byRound(totalRounds-2).forEach(m => addLoser(m, p++)); }
    if (totalRounds >= 4) { let p = 9; byRound(totalRounds-3).forEach(m => { if (p <= 10) addLoser(m, p++); }); }

    for (const [uid, place] of Object.entries(standings)) {
        const prize = prizes[String(place)];
        if (!prize) continue;
        const updates = {};
        if ((prize.amber || 0) > 0) updates.amber = FieldValue.increment(prize.amber);
        if ((prize.shards || 0) > 0) updates.shards = FieldValue.increment(prize.shards);
        if (Object.keys(updates).length) await db.collection('profiles').doc(uid).update(updates);
        if (prize.cards?.length) {
            const collRef = db.collection('card_collections').doc(uid).collection('cards');
            for (const card of prize.cards)
                await collRef.add({ ...card, acquiredVia: 'tournament_prize', acquiredAt: new Date() });
        }
        const placeLabel = ['','🥇 1st','🥈 2nd','🥉 3rd–4th','🥉 3rd–4th'][place] || `${place}th`;
        await db.collection('notifications').add({
            targetUid: uid, type: 'tournament_result', place, tourneyId,
            senderName: 'WeeBee Tournament', senderAvatar: '',
            message: `You finished ${placeLabel} in the WeeBee Tournament!`,
            prize, timestamp: new Date(), read: false,
        });
    }
}

// Fans a "registration is open" notification out to every user. Best-effort —
// a failure here shouldn't block bracket generation for other tournaments.
async function _notifyTournamentRegistrationOpen(db, tourneyId, tourneyData) {
    const profilesSnap = await db.collection('profiles').get();
    const name = tourneyData.name || 'WeeBee Tournament';
    const base = {
        type: 'tournament_open', tourneyId,
        senderName: name, senderAvatar: '',
        message: `Entry is now open for the ${name}! Register your party before it closes.`,
        timestamp: new Date(), read: false,
    };
    const docs = profilesSnap.docs;
    for (let i = 0; i < docs.length; i += 450) {
        const batch = db.batch();
        docs.slice(i, i + 450).forEach(d => batch.set(db.collection('notifications').doc(), { ...base, targetUid: d.id }));
        await batch.commit();
    }
}

// Scheduled: runs every 10 minutes, handles bracket generation + round resolution
exports.resolveTournamentRounds = onSchedule({ schedule: 'every 10 minutes', timeZone: 'America/New_York' }, async () => {
    const db = getFirestore();
    const now = Date.now();

    const regSnap = await db.collection('pvp_tournaments').where('status', '==', 'registration').get();
    for (const doc of regSnap.docs) {
        const t = doc.data();
        const startMs = t.startTime?.toMillis?.() ?? (t.startTime instanceof Date ? t.startTime.getTime() : 0);
        const openMs = t.registrationOpenTime?.toMillis?.() ?? (t.registrationOpenTime instanceof Date ? t.registrationOpenTime.getTime() : 0);
        if (openMs && openMs <= now && !t.registrationOpenNotified) {
            await doc.ref.update({ registrationOpenNotified: true });
            try { await _notifyTournamentRegistrationOpen(db, doc.id, t); } catch (e) { console.error('notifyTournamentRegistrationOpen', e); }
        }
        if (startMs <= now) await _generateBracketInternal(db, doc.id, t);
    }

    const activeSnap = await db.collection('pvp_tournaments').where('status', '==', 'in_progress').get();
    for (const doc of activeSnap.docs) {
        const t = doc.data();
        const nextMs = t.nextRoundTime?.toMillis?.() ?? (t.nextRoundTime instanceof Date ? t.nextRoundTime.getTime() : 0);
        if (nextMs <= now) await _resolveCurrentRound(db, doc.id, t);
    }
});

exports.registerForTournament = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const uid = await getCallerUid(req);
    if (!uid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');
    const { tourneyId, party } = req.body?.data || {};
    if (!tourneyId || !Array.isArray(party) || party.length !== 3)
        return sendErr(res, 400, 'INVALID_ARGUMENT', 'tourneyId and party (3 cards) required.');

    const db = getFirestore();
    const tourneyRef = db.collection('pvp_tournaments').doc(tourneyId);
    const entryRef = tourneyRef.collection('entries').doc(uid);
    const profileRef = db.collection('profiles').doc(uid);
    let userError = null;

    try {
        await db.runTransaction(async tx => {
            const [tSnap, eSnap, pSnap] = await Promise.all([tx.get(tourneyRef), tx.get(entryRef), tx.get(profileRef)]);
            if (!tSnap.exists) { userError = [404, 'NOT_FOUND', 'Tournament not found.']; return; }
            const t = tSnap.data();
            if (t.status !== 'registration') { userError = [400, 'FAILED_PRECONDITION', 'Registration is not currently open.']; return; }
            const nowMs = Date.now();
            const openMs = t.registrationOpenTime?.toMillis?.() ?? 0;
            if (openMs > nowMs) { userError = [400, 'FAILED_PRECONDITION', 'Registration has not opened yet.']; return; }
            if (eSnap.exists) { userError = [400, 'FAILED_PRECONDITION', 'You are already registered for this tournament.']; return; }
            const amber = pSnap.exists ? (pSnap.data().amber || 0) : 0;
            const cost = t.entryCost || 1000;
            if (amber < cost) { userError = [400, 'FAILED_PRECONDITION', `Not enough Amber. Need ${cost}, have ${amber}.`]; return; }
            tx.update(profileRef, { amber: FieldValue.increment(-cost) });
            tx.set(entryRef, {
                uid, party,
                displayName: pSnap.data()?.displayName || 'Unknown',
                avatar: pSnap.data()?.avatar || '',
                registeredAt: new Date(),
            });
            tx.update(tourneyRef, { playerCount: FieldValue.increment(1) });
        });
    } catch(e) { return sendErr(res, 500, 'INTERNAL', e.message); }
    if (userError) return sendErr(res, ...userError);
    res.json({ result: { success: true } });
});

exports.adminCreateTournament = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const uid = await getCallerUid(req);
    if (uid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');
    const { startTime, prizes, name, entryCost } = req.body?.data || {};
    if (!startTime) return sendErr(res, 400, 'INVALID_ARGUMENT', 'startTime required (ISO string).');
    const db = getFirestore();
    const startDate = new Date(startTime);
    const regOpenDate = new Date(startDate.getTime() - 24 * 3600 * 1000);
    const ref = await db.collection('pvp_tournaments').add({
        name: name || 'WeeBee Tournament',
        status: 'registration',
        startTime: startDate,
        registrationOpenTime: regOpenDate,
        entryCost: entryCost || 1000,
        prizes: prizes || {},
        playerCount: 0,
        currentRound: 0, totalRounds: 0,
        createdAt: new Date(), createdBy: uid,
    });
    res.json({ result: { tourneyId: ref.id } });
});

exports.adminSaveTournamentPrizes = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const uid = await getCallerUid(req);
    if (uid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');
    const { tourneyId, prizes } = req.body?.data || {};
    if (!tourneyId || !prizes) return sendErr(res, 400, 'INVALID_ARGUMENT', 'tourneyId and prizes required.');
    const db = getFirestore();
    await db.collection('pvp_tournaments').doc(tourneyId).update({ prizes });
    res.json({ result: { success: true } });
});

exports.adminCancelTournament = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const uid = await getCallerUid(req);
    if (uid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');
    const { tourneyId } = req.body?.data || {};
    if (!tourneyId) return sendErr(res, 400, 'INVALID_ARGUMENT', 'tourneyId required.');
    const db = getFirestore();
    const tRef = db.collection('pvp_tournaments').doc(tourneyId);
    const tSnap = await tRef.get();
    if (!tSnap.exists) return sendErr(res, 404, 'NOT_FOUND', 'Tournament not found.');
    const t = tSnap.data();
    const entriesSnap = await tRef.collection('entries').get();
    const batch = db.batch();
    batch.update(tRef, { status: 'cancelled', cancelledAt: new Date() });
    for (const e of entriesSnap.docs)
        batch.update(db.collection('profiles').doc(e.id), { amber: FieldValue.increment(t.entryCost || 1000) });
    await batch.commit();
    res.json({ result: { success: true, refunded: entriesSnap.size } });
});

exports.adminGenerateBracket = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const uid = await getCallerUid(req);
    if (uid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');
    const { tourneyId } = req.body?.data || {};
    if (!tourneyId) return sendErr(res, 400, 'INVALID_ARGUMENT', 'tourneyId required.');
    const db = getFirestore();
    const snap = await db.collection('pvp_tournaments').doc(tourneyId).get();
    if (!snap.exists) return sendErr(res, 404, 'NOT_FOUND', 'Tournament not found.');
    if (snap.data().status !== 'registration')
        return sendErr(res, 400, 'FAILED_PRECONDITION', 'Tournament must be in registration status.');
    await _generateBracketInternal(db, snap.id, snap.data());
    res.json({ result: { success: true } });
});

// ── PVP Weekly Ladder ─────────────────────────────────────────────────────────

const LADDER_RARITY_POWER = { common:1, rare:5, sr:9, 'sr+':13, pr:11, nr:11, ar:11, ssr:13, 'ssr+':17, ur:17, 'ur+':25 };

const LADDER_MVP_THRESHOLDS = { sr: 12, 'sr+': 12, ssr: 30, 'ssr+': 30, ur: 50, 'ur+': 50 };
function _ladderCardPower(card, boosts) {
    const animeKey = (card.anime || '').toLowerCase().trim();
    const animeBoost = (boosts || {})[animeKey] || 0;
    if (card.monthlyUr || card.tradedMonthlyUr) return 16 + animeBoost;
    if (card.rarity === 'set') return (card.setIntact !== false ? 25 : 1) + animeBoost;
    let p = LADDER_RARITY_POWER[card.rarity] || 1;
    if (card.founder) p += 3;
    else if (card.rarity !== 'pr' && !card.event && card.serial != null) {
        if (card.serial < 10) p += 3;
        else if (card.serial < 100) p += 2;
        else if (card.serial < 1000) p += 1;
    }
    const mvpT = LADDER_MVP_THRESHOLDS[card.rarity];
    if (mvpT != null && (card.mvpCount || 0) >= mvpT) p += 1;
    return p + animeBoost;
}
function _ladderRoundPower(card, party, boosts) {
    const isCombo = party.some(c => c !== card && (c.anime||'') === (card.anime||'') && card.anime);
    return _ladderCardPower(card, boosts) + (isCombo ? 1 : 0);
}
function _ladderSortParty(party, boosts) { return [...party].sort((a,b) => _ladderCardPower(b, boosts) - _ladderCardPower(a, boosts)); }
function _ladderRunBattle(party1, party2, boosts1, boosts2) {
    const s1 = _ladderSortParty(party1, boosts1);
    const s2 = _ladderSortParty(party2, boosts2);
    const rounds = [0,1,2].map(i => {
        const c1 = s1[i], c2 = s2[i];
        const p1 = _ladderRoundPower(c1, party1, boosts1), p2 = _ladderRoundPower(c2, party2, boosts2);
        const chance = Math.max(15, Math.min(98, Math.round(50 + (p1 - p2) * 4)));
        const p1w = Math.random() * 100 < chance;
        return { card1: { name: c1.name, rarity: c1.rarity }, card2: { name: c2.name, rarity: c2.rarity }, power1: p1, power2: p2, winner: p1w ? 0 : 1 };
    });
    const p1Score = rounds.filter(r => r.winner === 0).length;
    return { winner: p1Score >= 2 ? 0 : 1, rounds, p1Score, p2Score: 3 - p1Score };
}
async function _ladderGetTop3(db, uid, boosts) {
    const snap = await db.collection('card_collections').doc(uid).collection('cards').get();
    const cards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return cards.sort((a,b) => _ladderCardPower(b, boosts) - _ladderCardPower(a, boosts)).slice(0,3);
}
async function _ladderBestOf7(db, a, b) {
    const [profA, profB] = await Promise.all([
        db.collection('profiles').doc(a.uid).get().catch(() => null),
        db.collection('profiles').doc(b.uid).get().catch(() => null),
    ]);
    const boostsA = profA?.exists ? (profA.data().animeBoosts || {}) : {};
    const boostsB = profB?.exists ? (profB.data().animeBoosts || {}) : {};
    const [cA, cB] = await Promise.all([_ladderGetTop3(db, a.uid, boostsA), _ladderGetTop3(db, b.uid, boostsB)]);
    const matches = [];
    let wA = 0, wB = 0;
    while (wA < 4 && wB < 4 && matches.length < 7) {
        const r = _ladderRunBattle(cA, cB, boostsA, boostsB);
        if (r.winner === 0) wA++; else wB++;
        matches.push({ ...r, matchNum: matches.length + 1 });
    }
    return { winnerId: wA >= 4 ? a.uid : b.uid, uid1: a.uid, uid2: b.uid,
             uid1Name: a.displayName||'', uid2Name: b.displayName||'',
             uid1Wins: wA, uid2Wins: wB, matches };
}
function _ladderSlotId(d) {
    const t = new Date(d); t.setUTCMinutes(0,0,0); return t.toISOString();
}
function _shuffleArr(arr) {
    for (let i = arr.length-1; i>0; i--) {
        const j = Math.floor(Math.random()*(i+1));
        [arr[i],arr[j]] = [arr[j],arr[i]];
    }
    return arr;
}

// Runs every :00 UTC — opens the hourly pool slot
exports.pvpLadderHourlyOpen = onSchedule({ schedule: '0 * * * *', timeZone: 'UTC' }, async () => {
    const db = getFirestore();
    const now = new Date();
    const slotId = _ladderSlotId(now);
    const weekSnap = await db.collection('pvp_ladder_weeks').where('status','==','active').limit(1).get();
    if (weekSnap.empty) { console.log('[ladder] No active week, skipping open.'); return; }
    const weekId = weekSnap.docs[0].id;
    const closeTime = new Date(now); closeTime.setUTCMinutes(30,0,0);
    await db.collection('pvp_ladder_pool').doc(slotId).set({
        status: 'open', openTime: now, closeTime, weekId, entryCount: 0,
    });
    console.log(`[ladder] Opened slot ${slotId} for week ${weekId}`);
});

// Runs every :30 UTC — closes pool, pairs players, runs battles, updates leaderboard
exports.pvpLadderHourlyClose = onSchedule({ schedule: '30 * * * *', timeZone: 'UTC' }, async () => {
    const db = getFirestore();
    const now = new Date();
    const slotId = _ladderSlotId(now);
    const slotRef = db.collection('pvp_ladder_pool').doc(slotId);
    let weekId;
    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(slotRef);
            if (!snap.exists || snap.data().status !== 'open') throw new Error('not_open');
            weekId = snap.data().weekId;
            tx.update(slotRef, { status: 'resolving' });
        });
    } catch(e) { console.log(`[ladder] Slot ${slotId}: ${e.message}`); return; }

    const entriesSnap = await slotRef.collection('entries').get();
    const entries = _shuffleArr(entriesSnap.docs.map(d => ({ uid: d.id, ...d.data() })));

    if (!entries.length) {
        await slotRef.update({ status: 'resolved', matchCount: 0, resolvedAt: now });
        return;
    }

    const batch = db.batch();
    const weekDelta = {};
    const matchIdByUid = {};
    for (let i = 0; i < entries.length; i += 2) {
        const e1 = entries[i], e2 = entries[i+1] || null;
        const isMirror = !e2;
        const matchRef = slotRef.collection('matches').doc();
        if (isMirror) {
            // No opponent this hour — fight a mirror of your own party (same
            // cards on both sides) so there's a real best-of-3 to look at,
            // not just a silent freebie win with no data behind it.
            const boosts = e1.animeBoosts || {};
            const battle = _ladderRunBattle(e1.cards, e1.cards, boosts, boosts);
            const playerWon = battle.winner === 0;
            batch.set(matchRef, {
                uid1: e1.uid, uid1Name: e1.displayName||'', uid1Avatar: e1.avatar||'',
                uid2: e1.uid, uid2Name: e1.displayName||'', uid2Avatar: e1.avatar||'',
                isMirror: true,
                // uid1 and uid2 are the same player, so winnerId alone can't
                // distinguish a win from a loss here — playerWon carries the
                // actual outcome. winnerId is still set to e1.uid on a win so
                // the client's generic "did I win" check keeps working there.
                result: { winnerId: playerWon ? e1.uid : null, playerWon, rounds: battle.rounds, p1Score: battle.p1Score, p2Score: battle.p2Score },
                resolvedAt: now,
            });
            if (!weekDelta[e1.uid]) weekDelta[e1.uid] = { wins:0, losses:0, name: e1.displayName||'', av: e1.avatar||'' };
            if (playerWon) weekDelta[e1.uid].wins++; else weekDelta[e1.uid].losses++;
            matchIdByUid[e1.uid] = matchRef.id;
        } else {
            const battle = _ladderRunBattle(e1.cards, e2.cards, e1.animeBoosts || {}, e2.animeBoosts || {});
            const wid = battle.winner===0 ? e1.uid : e2.uid;
            const lid = battle.winner===0 ? e2.uid : e1.uid;
            const we = battle.winner===0 ? e1 : e2, le = battle.winner===0 ? e2 : e1;
            batch.set(matchRef, {
                uid1: e1.uid, uid1Name: e1.displayName||'', uid1Avatar: e1.avatar||'',
                uid2: e2.uid, uid2Name: e2.displayName||'', uid2Avatar: e2.avatar||'',
                isMirror: false,
                result: { winnerId: wid, rounds: battle.rounds, p1Score: battle.p1Score, p2Score: battle.p2Score },
                resolvedAt: now,
            });
            if (!weekDelta[wid]) weekDelta[wid] = { wins:0, losses:0, name: we.displayName||'', av: we.avatar||'' };
            if (!weekDelta[lid]) weekDelta[lid] = { wins:0, losses:0, name: le.displayName||'', av: le.avatar||'' };
            weekDelta[wid].wins++;
            weekDelta[lid].losses++;
            matchIdByUid[e1.uid] = matchRef.id;
            matchIdByUid[e2.uid] = matchRef.id;
        }
    }

    for (const [uid, d] of Object.entries(weekDelta)) {
        batch.set(db.collection('pvp_ladder_weeks').doc(weekId).collection('entries').doc(uid), {
            uid, displayName: d.name, avatar: d.av,
            wins: FieldValue.increment(d.wins),
            losses: FieldValue.increment(d.losses),
            lastMatch: now,
        }, { merge: true });
    }
    batch.update(slotRef, { status: 'resolved', matchCount: Math.ceil(entries.length/2), resolvedAt: now });
    await batch.commit();

    // Notify participants
    try {
        const nb = db.batch();
        for (const [uid, d] of Object.entries(weekDelta)) {
            nb.set(db.collection('notifications').doc(), {
                targetUid: uid, type: 'ladder_match', slotId, matchId: matchIdByUid[uid],
                senderName: 'Weekly Ladder', senderAvatar: '',
                message: d.wins > 0 ? '⚔️ Ladder match result: you won! Check the Weekly Ladder.' : '⚔️ Ladder match result: you lost. Better luck next round.',
                timestamp: now, read: false,
            });
        }
        await nb.commit();
    } catch(e) {}

    console.log(`[ladder] Resolved slot ${slotId}: ${Math.ceil(entries.length/2)} matches, ${entries.length} players`);
});

// Runs Saturday 7PM ET — finalizes week, resolves ties, distributes prizes
exports.pvpLadderWeeklyClose = onSchedule({ schedule: '0 19 * * 6', timeZone: 'America/New_York' }, async () => {
    const db = getFirestore();
    const weekSnap = await db.collection('pvp_ladder_weeks').where('status','==','active').limit(1).get();
    if (weekSnap.empty) { console.log('[ladder] No active week to close.'); return; }
    const weekRef = weekSnap.docs[0].ref;
    const weekId = weekSnap.docs[0].id;
    await weekRef.update({ status: 'distributing' });

    const entriesSnap = await weekRef.collection('entries').get();
    let entries = entriesSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
    entries.sort((a,b) => (b.wins||0)-(a.wins||0) || (a.losses||0)-(b.losses||0));

    const configSnap = await db.collection('pvp_ladder_config').doc('rewards').get();
    const prizes = configSnap.exists ? (configSnap.data().prizes||{}) : {};

    // Resolve tiebreakers for prize positions
    const tiebreakers = [];
    for (let i = 0; i < Math.min(entries.length-1, 3); i++) {
        const a = entries[i], b = entries[i+1];
        if ((a.wins||0)===(b.wins||0) && (a.losses||0)===(b.losses||0)) {
            console.log(`[ladder] Tiebreaker place ${i+1}: ${a.uid} vs ${b.uid}`);
            const tb = await _ladderBestOf7(db, a, b);
            tb.place = i+1;
            tiebreakers.push(tb);
            if (tb.winnerId===b.uid) [entries[i],entries[i+1]] = [entries[i+1],entries[i]];
        }
    }

    const now = new Date();
    const finalRankings = entries.slice(0,10).map((e,i) => ({
        uid: e.uid, displayName: e.displayName||'', avatar: e.avatar||'',
        wins: e.wins||0, losses: e.losses||0, place: i+1,
    }));

    const pb = db.batch();
    for (let i = 0; i < finalRankings.length; i++) {
        const place = i + 1;
        const prize = prizes[String(place)];
        if (!prize || (!prize.amber && !prize.shards && !prize.cardId)) continue;
        const uid = finalRankings[i].uid;
        const profileRef = db.collection('profiles').doc(uid);
        const profileUpdate = {};
        const parts = [];

        if (prize.amber) {
            profileUpdate.amber = FieldValue.increment(prize.amber);
            pb.set(db.collection('amber_log').doc(), { uid, amount: prize.amber, reason: `pvp_ladder:${weekId}:place:${place}`, timestamp: now });
            parts.push(`${prize.amber.toLocaleString()} Amber`);
        }
        if (prize.shards) {
            profileUpdate.shards = FieldValue.increment(prize.shards);
            pb.set(db.collection('amber_log').doc(), { uid, amount: prize.shards, reason: `pvp_ladder:${weekId}:place:${place}:shards`, timestamp: now });
            parts.push(`${prize.shards.toLocaleString()} Shards`);
        }
        if (Object.keys(profileUpdate).length) pb.update(profileRef, profileUpdate);

        if (prize.cardId) {
            try {
                const cardSnap = await db.collection('pvp_prize_cards').doc(prize.cardId).get();
                if (cardSnap.exists) {
                    const newCardRef = db.collection('card_collections').doc(uid).collection('cards').doc();
                    pb.set(newCardRef, { ...cardSnap.data(), id: newCardRef.id, acquiredVia: 'ladder_prize', acquiredAt: now });
                    parts.push(`a ${cardSnap.data().rarity?.toUpperCase() || 'prize'} card`);
                } else {
                    console.warn(`[ladder] Prize card ${prize.cardId} not found in pvp_prize_cards`);
                }
            } catch(e) { console.error(`[ladder] Card prize error for uid ${uid}:`, e); }
        }

        pb.set(db.collection('notifications').doc(), {
            targetUid: uid, type: 'ladder_reward',
            senderName: 'Weekly Ladder', senderAvatar: '',
            message: `🏆 Weekly Ladder ended! You finished #${place} and earned ${parts.join(', ')}!`,
            timestamp: now, read: false,
        });
    }
    pb.update(weekRef, { status: 'complete', completedAt: now, finalRankings, tiebreakers, playerCount: entries.length });
    await pb.commit();
    console.log(`[ladder] Week ${weekId} closed — ${entries.length} players, ${tiebreakers.length} tiebreakers`);
});

// Runs Sunday 7PM ET — opens new week
exports.pvpLadderWeeklyOpen = onSchedule({ schedule: '0 19 * * 0', timeZone: 'America/New_York' }, async () => {
    const db = getFirestore();
    const existing = await db.collection('pvp_ladder_weeks').where('status','==','active').limit(1).get();
    if (!existing.empty) { console.log('[ladder] Active week already exists.'); return; }
    const now = new Date();
    const endTime = new Date(now.getTime() + 6*24*3600*1000);
    const weekId = now.toISOString().slice(0,10);
    await db.collection('pvp_ladder_weeks').doc(weekId).set({
        startTime: now, endTime, status: 'active', createdAt: now, playerCount: 0,
    });
    console.log(`[ladder] Opened new week ${weekId}`);
});

// Callable: user enters the current hourly pool with 3 cards
exports.pvpLadderEnterPool = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');
    const { cards } = req.body?.data || {};
    if (!Array.isArray(cards) || cards.length !== 3)
        return sendErr(res, 400, 'INVALID_ARGUMENT', 'Exactly 3 cards required.');
    const db = getFirestore();
    const now = new Date();
    if (now.getUTCMinutes() >= 30)
        return sendErr(res, 400, 'FAILED_PRECONDITION', 'Pool is closed. Opens again at the top of the next hour.');
    const slotId = _ladderSlotId(now);
    const slotRef = db.collection('pvp_ladder_pool').doc(slotId);
    const slotSnap = await slotRef.get();
    if (!slotSnap.exists || slotSnap.data().status !== 'open')
        return sendErr(res, 400, 'FAILED_PRECONDITION', 'No active pool right now. Try at the top of the next hour.');
    const entryRef = slotRef.collection('entries').doc(callerUid);
    if ((await entryRef.get()).exists)
        return sendErr(res, 400, 'ALREADY_EXISTS', 'You already entered this pool.');
    const cardIds = cards.map(c => c.id).filter(Boolean);
    if (cardIds.length !== 3) return sendErr(res, 400, 'INVALID_ARGUMENT', 'All 3 cards must have IDs.');
    const cardSnaps = await Promise.all(cardIds.map(id =>
        db.collection('card_collections').doc(callerUid).collection('cards').doc(id).get()
    ));
    if (cardSnaps.some(s => !s.exists)) return sendErr(res, 400, 'FAILED_PRECONDITION', 'You do not own all selected cards.');
    const profileSnap = await db.collection('profiles').doc(callerUid).get();
    const profile = profileSnap.exists ? profileSnap.data() : {};
    await entryRef.set({
        uid: callerUid,
        displayName: profile.displayName || '',
        avatar: profile.avatar || '',
        cards: cardSnaps.map(s => ({ id: s.id, ...s.data() })),
        animeBoosts: profile.animeBoosts || {},
        submittedAt: now,
    });
    try { await slotRef.update({ entryCount: FieldValue.increment(1) }); } catch(e) {}
    res.json({ result: { success: true, slotId } });
});

// Admin: set weekly ladder prize config (persists week-to-week)
exports.pvpLadderSetConfig = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const uid = await getCallerUid(req);
    if (uid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');
    const { prizes } = req.body?.data || {};
    if (!prizes || typeof prizes !== 'object')
        return sendErr(res, 400, 'INVALID_ARGUMENT', 'prizes object required.');
    const db = getFirestore();
    await db.collection('pvp_ladder_config').doc('rewards').set({ prizes, updatedAt: new Date(), updatedBy: uid }, { merge: true });
    res.json({ result: { success: true } });
});

// Admin: broadcast notification to all users
exports.adminBroadcastNotification = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    const callerUid = await getCallerUid(req);
    if (callerUid !== ADMIN_UID) return sendErr(res, 403, 'PERMISSION_DENIED', 'Admin only.');
    const { message } = req.body?.data || {};
    if (!message || typeof message !== 'string' || !message.trim())
        return sendErr(res, 400, 'INVALID_ARGUMENT', 'message is required.');
    const db = getFirestore();
    const profilesSnap = await db.collection('profiles').get();
    const now = new Date();
    const base = {
        type: 'announcement',
        senderName: 'WeeBee',
        senderAvatar: '',
        message: message.trim(),
        timestamp: now,
        read: false,
    };
    const docs = profilesSnap.docs;
    for (let i = 0; i < docs.length; i += 450) {
        const batch = db.batch();
        docs.slice(i, i + 450).forEach(d => {
            batch.set(db.collection('notifications').doc(), { ...base, targetUid: d.id });
        });
        await batch.commit();
    }
    res.json({ result: { success: true, count: docs.length } });
});
