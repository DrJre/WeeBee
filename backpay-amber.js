// One-time amber backpay script.
//
// 1. Clears DrJre's card collection, custom binders, and resets amber to 0.
// 2. For every user, computes amber earned so far from:
//    - Achievements already recorded in `achievements/{uid}` (per ACHIEVEMENT_AMBER tier)
//    - Reviews: 10 amber per in-depth review, 5 amber per quick review
//      (profiles.reviewCount includes both; profiles.indepthCount is the in-depth subset)
//    - Completed anime: 2 amber each (profiles.completedCount)
//    Login-streak bonuses and like/comment "interaction" amber are NOT backfilled —
//    no historical record exists for either.
// 3. Sets profiles/{uid}.amber to the computed total and logs a single
//    `amber_log` entry with reason "backpay:initial".

const admin = require('firebase-admin');
const serviceAccount = require('./weebee-fbbd8-firebase-adminsdk-fbsvc-1c415911f5.json');

admin.initializeApp({ credential: admin.cert(serviceAccount) });
const db = require('firebase-admin/firestore').getFirestore();

const ADMIN_UID = 'XUD3ym2NcdWtrUiPLlFFaO5ufMh1';

// Mirrors ACHIEVEMENT_AMBER in app.js
const ACHIEVEMENT_AMBER = {
    // Common
    review_1:25, review_10:25, indepth_1:25, indepth_10:25, react_1:25, react_10:25,
    complete_1:25, complete_10:25, dropout:25, first_follow:25,
    bwop_first:25, bwnrt_first:25, bwblc_first:25, bwdb_first:25,
    feed_showtime:25, tl_first:25, trivia_first:25, trivia_7:25,
    ht_first:25, ht_10:25, poll_first:25, mb_first:25,
    // Uncommon
    review_25:50, review_50:50, indepth_25:50, indepth_50:50, react_25:50, react_50:50,
    complete_25:50, complete_50:50, suggestor_5:50,
    bwop_streak_7:50, bwnrt_streak_7:50, bwblc_streak_7:50, bwdb_streak_7:50,
    bw_double_agent:50, feed_trending:50, tl_10:50, tl_crowd_pleaser:50,
    trivia_perfect:50, trivia_30:50, ht_controversial:50, poll_popular:50,
    mb_perfect_pitch:50, mb_streak_7:50,
    // Rare
    review_100:100, indepth_100:100, react_100:100, complete_100:100,
    bwop_total_30:100, bwnrt_total_30:100, bwblc_total_30:100, bwdb_total_30:100,
    bw_multiverse:100, ht_popular:100, mb_total_30:100,
    bwop_1guess:100, bwnrt_1guess:100, bwblc_1guess:100, bwdb_1guess:100,
    // Epic
    review_250:250, indepth_250:250, react_250:250, complete_250:250,
    // Legendary
    review_500:500, indepth_500:500, react_500:500, complete_500:500,
    founder:500, top_reviewer:500, bwop_streak_100:500,
    // Mythic
    review_1000:1000, indepth_1000:1000, react_1000:1000, complete_1000:1000,
};

async function clearAdminCardData() {
    process.stdout.write(`Clearing card collection for ${ADMIN_UID}... `);
    try {
        await db.recursiveDelete(db.collection('card_collections').doc(ADMIN_UID).collection('cards'));
        await db.recursiveDelete(db.collection('card_binders').doc(ADMIN_UID).collection('binders'));
        await db.collection('profiles').doc(ADMIN_UID).set({ amber: 0 }, { merge: true });
        console.log('done.');
    } catch (e) {
        console.log(`failed (${e.message})`);
    }
}

function amberFromAchievements(achData) {
    let total = 0;
    for (const id of Object.keys(achData || {})) {
        total += ACHIEVEMENT_AMBER[id] || 0;
    }
    return total;
}

function amberFromReviews(profile) {
    const reviewCount = profile.reviewCount || 0;
    const indepthCount = profile.indepthCount || 0;
    const quickCount = Math.max(0, reviewCount - indepthCount);
    return (indepthCount * 10) + (quickCount * 5);
}

function amberFromCompletions(profile) {
    return (profile.completedCount || 0) * 2;
}

async function backpayAllUsers() {
    const profilesSnap = await db.collection('profiles').get();
    console.log(`\nFound ${profilesSnap.size} profiles. Computing backpay...\n`);

    let batch = db.batch();
    let batchCount = 0;
    let processed = 0;

    for (const profileDoc of profilesSnap.docs) {
        const uid = profileDoc.id;
        const profile = profileDoc.data();

        const achDoc = await db.collection('achievements').doc(uid).get();
        const achAmber = amberFromAchievements(achDoc.exists ? achDoc.data() : {});
        const reviewAmber = amberFromReviews(profile);
        const completeAmber = amberFromCompletions(profile);
        const total = achAmber + reviewAmber + completeAmber;

        batch.set(db.collection('profiles').doc(uid), { amber: total }, { merge: true });
        const logRef = db.collection('amber_log').doc();
        batch.set(logRef, {
            uid, amount: total, reason: 'backpay:initial',
            breakdown: { achievements: achAmber, reviews: reviewAmber, completions: completeAmber },
            timestamp: new Date(),
        });

        batchCount++;
        processed++;
        console.log(`${uid}: ${total} amber (achievements ${achAmber} + reviews ${reviewAmber} + completions ${completeAmber})`);

        if (batchCount >= 200) {
            await batch.commit();
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) await batch.commit();
    console.log(`\nDone. Processed ${processed} profiles.`);
}

(async () => {
    await clearAdminCardData();
    await backpayAllUsers();
})();
