// Deduplicates TCG card collections across all users.
// Run with: node dedup-cards.js [--delete]
// Without --delete: dry run (reports what would be removed, no writes)
// With --delete: actually deletes duplicate cards

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const sa = require('./weebee-fbbd8-firebase-adminsdk-fbsvc-1c415911f5.json');

initializeApp({ credential: cert(sa) });
const db = getFirestore();

const dryRun = !process.argv.includes('--delete');

function dedupKey(card) {
    if (card.founder) return `founder|${card.name}|${card.rarity}`;
    if (card.monthlyUr) return `monthlyUr|${card.name}|${card.stampText || ''}`;
    return `${card.name}|${card.rarity}|${card.serial}|${card.edition || ''}`;
}

async function run() {
    console.log(`\n=== TCG Card Dedup — ${dryRun ? 'DRY RUN (no deletes)' : '⚠️  LIVE DELETE MODE'} ===\n`);

    const usersSnap = await db.collection('card_collections').listDocuments();
    const uids = usersSnap.map(d => d.id);
    console.log(`Found ${uids.length} users with card collections.\n`);

    let totalDupes = 0;
    let totalDeleted = 0;

    for (const uid of uids) {
        const cardsSnap = await db
            .collection('card_collections')
            .doc(uid)
            .collection('cards')
            .orderBy('pulledAt', 'asc')
            .get();

        if (cardsSnap.empty) continue;

        const seen = new Map(); // key -> first card id
        const dupes = [];

        for (const doc of cardsSnap.docs) {
            const data = doc.data();
            const key = dedupKey(data);
            if (seen.has(key)) {
                dupes.push({ id: doc.id, key, data });
            } else {
                seen.set(key, doc.id);
            }
        }

        if (dupes.length === 0) continue;

        totalDupes += dupes.length;
        console.log(`User ${uid}: ${dupes.length} duplicate(s)`);
        for (const dupe of dupes) {
            const kept = seen.get(dupe.key);
            console.log(`  DUPE  ${dupe.id}  key="${dupe.key}"  (keeping: ${kept})`);
        }

        if (!dryRun) {
            for (const dupe of dupes) {
                await db
                    .collection('card_collections')
                    .doc(uid)
                    .collection('cards')
                    .doc(dupe.id)
                    .delete();
                totalDeleted++;
            }
        }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Total duplicates found: ${totalDupes}`);
    if (!dryRun) {
        console.log(`Total deleted: ${totalDeleted}`);
    } else {
        console.log(`(Dry run — nothing deleted. Re-run with --delete to remove them.)`);
    }
}

run().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
