const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onRequest } = require('firebase-functions/v2/https');
const { TCG_SR_CARDS, TCG_SSR_CARDS, TCG_UR_CARDS, TCG_PR_CARDS } = require('./tcg-card-pools');

initializeApp();

const ADMIN_UID = 'XUD3ym2NcdWtrUiPLlFFaO5ufMh1';

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

                offerCardRefs.forEach(ref => tx.delete(ref));
                (offer.offerCards || []).forEach(card => {
                    tx.set(db.collection('card_collections').doc(callerUid).collection('cards').doc(), card);
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
        id: 'standard', name: 'Standard Pack', cost: 150, salePrice: 100,
        guaranteedSR: false, prismatic: false,
        image: 'https://firebasestorage.googleapis.com/v0/b/weebee-fbbd8.firebasestorage.app/o/tcg-art%2FBooster%20Packs%2FStandard%20Pack.png?alt=media&token=8db206cf-8f57-4c64-b3cf-d2b8316d7364',
    },
    premium: {
        id: 'premium', name: 'Premium Pack', cost: 750, salePrice: null,
        guaranteedSR: true, prismatic: false,
        image: 'https://firebasestorage.googleapis.com/v0/b/weebee-fbbd8.firebasestorage.app/o/tcg-art%2FBooster%20Packs%2FPremium%20Pack.png?alt=media&token=3c1f22b2-655b-479f-9be8-d8ee448f4b38',
    },
    prismatic: {
        id: 'prismatic', name: '2026 Prismatic Pack', cost: 800, salePrice: null,
        guaranteedSR: false, prismatic: true,
        image: 'https://firebasestorage.googleapis.com/v0/b/weebee-fbbd8.firebasestorage.app/o/tcg-art%2FBooster%20Packs%2F2026%20Prismatic%20Pack.png?alt=media&token=0fd87cb6-3811-443b-a75c-e87c2513366f',
    },
};

const RARITY_MAX_VERSIONS = { common: 5000, rare: 2500, sr: 500, ssr: 250, ur: 50, pr: 100 };

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
    const [rareSnap, commonSnap, srSnap, ssrSnap, urSnap, prSnap] = await Promise.all([
        charsRef.where('rarityTier', '==', 'rare').limit(2000).get(),
        charsRef.where('rarityTier', '==', 'common').limit(2000).get(),
        charsRef.where('rarityTier', '==', 'sr').limit(500).get(),
        charsRef.where('rarityTier', '==', 'ssr').limit(500).get(),
        charsRef.where('rarityTier', '==', 'ur').limit(100).get(),
        charsRef.where('rarityTier', '==', 'pr').limit(200).get(),
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
    if (rarity === 'ur') {
        const arr = pool.ur.length ? pool.ur : TCG_UR_CARDS;
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
        if      (r < 0.04) rarity = 'pr';
        else if (r < 0.30) rarity = 'sr';
        else                rarity = 'rare';
        cards.push(pickCard(pool, rarity));
    }
    return cards.sort(() => Math.random() - 0.5);
}

// Rolls a single pack's 5 cards, including god-pack odds — mirrors the logic
// inline in _tcgBuyPack() in app.js (1-in-10000 standard/premium, 1-in-100 prismatic)
function rollOnePack(pool, pack) {
    let godPackTheme = null;
    let cards;
    if (pack.prismatic) {
        const isPrismaticGodPack = Math.random() < 0.01;
        godPackTheme = isPrismaticGodPack ? 'prismatic' : null;
        cards = isPrismaticGodPack
            ? [pickCard(pool,'pr'), pickCard(pool,'pr'), pickCard(pool,'pr'), pickCard(pool,'pr'), pickCard(pool,'pr')]
            : rollPrismaticPackCards(pool);
    } else {
        const isGodPack = pack.guaranteedSR && Math.random() < 0.0001;
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
exports.purchasePacks = onRequest({ invoker: 'public' }, async (req, res) => {
    setCORS(res);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const callerUid = await getCallerUid(req);
    if (!callerUid) return sendErr(res, 401, 'UNAUTHENTICATED', 'Must be signed in.');

    const { packId, quantity } = req.body?.data || {};
    const pack = TCG_PACKS[packId];
    if (!pack) return sendErr(res, 400, 'INVALID_ARGUMENT', 'Unknown pack.');
    if (![1, 5, 10].includes(quantity)) return sendErr(res, 400, 'INVALID_ARGUMENT', 'Quantity must be 1, 5, or 10.');

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
        // Mirrors _tcgLoadSaleConfig() in app.js: the sale defaults to ON until an
        // admin explicitly saves the toggle (the doc only exists once that happens).
        const saleEnabled = saleSnap.exists ? !!saleSnap.data().enabled : true;
        if (saleEnabled && pack.salePrice != null) costPerPack = pack.salePrice;
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

    try {
        const pool = await ensureCardPool(db);
        const cardBatch = computeCurrentBatch(pool);
        const bulkBatchId = quantity > 1 ? db.collection('inventory').doc().id : null;
        const itemIds = [];
        const batch = db.batch();
        const invCol = db.collection('inventory').doc(callerUid).collection('items');
        for (let i = 0; i < quantity; i++) {
            const { cards, godPackTheme } = rollOnePack(pool, pack);
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

    const revealed = [];
    try {
        for (const item of items) {
            const finishedCards = [];
            for (const card of (item.rolledCards || [])) {
                const { version, edition } = await assignSerial(db, card);
                finishedCards.push({ ...card, serial: version, edition });
            }
            const cardCol = db.collection('card_collections').doc(callerUid).collection('cards');
            const batch = db.batch();
            finishedCards.forEach(c => {
                batch.set(cardCol.doc(), { name: c.name, anime: c.anime, rarity: c.rarity, image: c.image, serial: c.serial, edition: c.edition, pulledAt: new Date() });
            });
            batch.delete(invCol.doc(item.id));
            await batch.commit();
            revealed.push({ itemId: item.id, packId: item.packId, packName: item.packName, godPackTheme: item.godPackTheme || null, cards: finishedCards });
        }
    } catch(e) {
        console.error('openInventoryItems open error:', e);
        return res.status(500).json({ error: { status: 'INTERNAL', message: 'Failed to open one or more packs — please try again for the rest. Already-opened packs were saved to your collection.' }, partial: { packs: revealed } });
    }

    res.json({ result: { success: true, packs: revealed } });
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

            // Card payouts
            if (c.battleType === 'card') {
                const allWager = [...(c.challengerWagerCards || []), ...(defenderWagerCards || [])];
                for (const card of allWager) {
                    tx.set(db.collection('card_collections').doc(winnerUid).collection('cards').doc(), card);
                }
                const loserCards = winnerUid === c.challengerId ? (defenderWagerCards || []) : (c.challengerWagerCards || []);
                for (const wc of loserCards) {
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
    const qty = [1, 5, 10].includes(quantity) ? quantity : 1;

    const db = getFirestore();
    try {
        const pool = await ensureCardPool(db);
        const cardBatch = computeCurrentBatch(pool);
        const bulkBatchId = qty > 1 ? db.collection('inventory').doc().id : null;
        const itemIds = [];
        const batch = db.batch();
        const invCol = db.collection('inventory').doc(targetUid).collection('items');
        for (let i = 0; i < qty; i++) {
            const { cards, godPackTheme } = rollOnePack(pool, pack);
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
