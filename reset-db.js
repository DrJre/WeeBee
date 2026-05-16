const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();

// admins collection is intentionally excluded — your UID stays safe
const COLLECTIONS = [
    'reviews',
    'follows',
    'friends',
    'friend_requests',
    'anime_lists',
    'top_anime_lists',
    'profiles',
    'notifications',
    'conversations',       // subcollection (messages) handled by recursiveDelete
    'usernames',
    'profile_comments',
    'comments',
    'rankHistory',
    'meta',
    'achievements',
    'seasonal_votes',
    'seasonal_vote_records',
    'seasonal_winners',
    'seasonal_badges',
    'bug_reports',
    'feature_suggestions',
    'direct_suggestions',
    'founders',            // remove this line if you want to keep founder badges
];

async function reset() {
    console.log('Starting WeeBee database reset...\n');
    for (const col of COLLECTIONS) {
        try {
            process.stdout.write(`Deleting ${col}... `);
            await db.recursiveDelete(db.collection(col));
            console.log('✓');
        } catch(e) {
            console.log(`✗ (${e.message})`);
        }
    }
    console.log('\nDone. admins collection was not touched — you are still admin.');
}

reset();
