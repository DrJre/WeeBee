const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onRequest } = require('firebase-functions/v2/https');
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
    const urChance = pack.guaranteedSR ? 0.005 : 0.0025;
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
    const urChance = pack.guaranteedSR ? 0.003 : 0.001;
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
    try {
        const profSnap = await profileRef.get();
        const profData = profSnap.exists ? profSnap.data() : {};
        if (profData.pityStandard !== undefined) pityCounters.pityStandard = profData.pityStandard;
        if (profData.pityPremium  !== undefined) pityCounters.pityPremium  = profData.pityPremium;
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
                if (hasNaturalUR) {
                    pityCounters[pityField] = 0;
                } else {
                    const pityChance = calcPityUrChance(item.packId, pityCounters[pityField]);
                    if (pityChance > 0 && Math.random() < pityChance) {
                        const urArr = pool?.ur?.length ? pool.ur : TCG_UR_CARDS;
                        const src = urArr[Math.floor(Math.random() * urArr.length)];
                        const urCard = { name: src.name, anime: normalizeSeriesName(src.series || src.anime || ''), image: src.image, rarity: 'ur' };
                        rolledCards = [...rolledCards];
                        rolledCards[Math.floor(Math.random() * rolledCards.length)] = urCard;
                        pityCounters[pityField] = 0;
                    } else {
                        pityCounters[pityField]++;
                    }
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

    // Write updated pity counters
    if (pityFieldsChanged.size > 0) {
        const pityUpdate = {};
        for (const f of pityFieldsChanged) pityUpdate[f] = pityCounters[f];
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
    const RARITY_POWER = { common:1, rare:5, sr:9, pr:11, ssr:13, ur:17 };
    function cardPower(card) {
        if (card.monthlyUr || card.tradedMonthlyUr) return 16;
        let p = RARITY_POWER[card.rarity] || 1;
        if (card.founder) p += 3;
        else if (card.rarity !== 'pr' && !card.event && card.serial != null) {
            if (card.serial < 10) p += 3;
            else if (card.serial < 100) p += 2;
            else if (card.serial < 1000) p += 1;
        }
        return p;
    }
    function roundPower(card, party) {
        const isCombo = party.some(c => c !== card && (c.anime||'') === (card.anime||'') && card.anime);
        return cardPower(card) + (isCombo ? 1 : 0);
    }
    function sortParty(party) { return [...party].sort((a,b) => cardPower(b) - cardPower(a)); }
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

            // Amber check
            if (c.battleType === 'amber' && c.amberWager > 0) {
                const [cProf, dProf] = await Promise.all([
                    tx.get(db.collection('profiles').doc(c.challengerId)),
                    tx.get(db.collection('profiles').doc(callerUid)),
                ]);
                const cAmber = cProf.exists ? (cProf.data().amber || 0) : 0;
                const dAmber = dProf.exists ? (dProf.data().amber || 0) : 0;
                if (cAmber < c.amberWager || dAmber < c.amberWager) {
                    userError = [400, 'FAILED_PRECONDITION', 'amber_insufficient'];
                    tx.update(challengeRef, { status: 'cancelled', cancelReason: 'amber_insufficient' });
                    return;
                }
            }

            // Resolve battle
            const cParty = sortParty(c.challengerParty);
            const dParty = sortParty(defenderParty);
            const rounds = [0, 1, 2].map(i => {
                const cCard = cParty[i], dCard = dParty[i];
                const cPow = roundPower(cCard, c.challengerParty);
                const dPow = roundPower(dCard, defenderParty);
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

const BOSS_CARD_DAMAGE_CF = { common: 10, rare: 30, sr: 150, ssr: 500, ur: 2000, pr: 800 };
const BOSS_CRIT_RATES    = { ssr: 0.20, ur: 0.25 }; // 20% SSR, 25% UR → 2× damage on crit
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
