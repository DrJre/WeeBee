// One-time backfill: grant retroactive pity URs for historical Stripe spending.
//
// For each user, sums all non-bonusUr Stripe purchases. Every $30 spent earns
// one UR inventory item. Also sets stripePityCents to the leftover cents so
// future purchases continue from the correct point.
//
// Usage:
//   node discord-bot/backfill-stripe-pity.js          (dry run — prints plan)
//   node discord-bot/backfill-stripe-pity.js --commit  (actually grants URs)
//
// Run from the repo root. Requires service-account.json in discord-bot/.
// or FIREBASE_SERVICE_ACCOUNT env var (same as the bot).

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString())
  : require('./service-account.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const COMMIT = process.argv.includes('--commit');
const PITY_THRESHOLD = 3000; // cents = $30

// Mirror of AMBER_BUNDLES — bonusUr bundles always include a UR so they don't
// count toward pity (user already got one as part of that purchase).
const BUNDLE_PRICES = {
  amber_1000:  { price: 99,   bonusUr: false },
  amber_5750:  { price: 499,  bonusUr: false },
  amber_12000: { price: 999,  bonusUr: false },
  amber_36000: { price: 3000, bonusUr: true  },
};

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

async function pickRandomUr() {
  const snap = await db.collection('characters').where('rarityTier', '==', 'ur').limit(100).get();
  const pool = [];
  snap.forEach(d => {
    const c = d.data();
    if (c.name && c.image && !c.imageBroken) pool.push(c);
  });
  if (!pool.length) throw new Error('No UR cards found in characters pool');
  const src = pool[Math.floor(Math.random() * pool.length)];
  return {
    name: src.name,
    anime: normalizeSeriesName(src.series || src.anime || ''),
    image: src.image,
    rarity: 'ur',
  };
}

async function grantUrInventoryItem(uid) {
  const urCard = await pickRandomUr();
  await db.collection('inventory').doc(uid).collection('items').add({
    type: 'pack',
    packId: 'bonus_ur',
    packName: 'Pity UR',
    packImage: 'https://firebasestorage.googleapis.com/v0/b/weebee-fbbd8.firebasestorage.app/o/tcg-art%2FBooster%20Packs%2FPremium%20Pack.png?alt=media&token=3c1f22b2-655b-479f-9be8-d8ee448f4b38',
    rolledCards: [urCard],
    godPackTheme: null,
    source: 'stripe_pity_backfill',
    bulkBatchId: null,
    grantedAt: Timestamp.now(),
  });
  return urCard.name;
}

async function main() {
  console.log(`\n${ COMMIT ? '⚡ COMMIT MODE' : '🔍 DRY RUN (pass --commit to apply)' }\n`);

  // Load all stripe sessions
  console.log('Loading stripe_sessions...');
  const snap = await db.collection('stripe_sessions').get();
  console.log(`  Found ${snap.size} sessions\n`);

  // Group spending by uid, skipping bonusUr bundles
  const spendByUid = {};
  snap.forEach(d => {
    const { uid, bundleId } = d.data();
    if (!uid || !bundleId) return;
    const bundle = BUNDLE_PRICES[bundleId];
    if (!bundle || bundle.bonusUr) return; // bonusUr already came with a UR
    spendByUid[uid] = (spendByUid[uid] || 0) + bundle.price;
  });

  // Compute URs owed per user
  const grants = Object.entries(spendByUid)
    .map(([uid, totalCents]) => ({
      uid,
      totalCents,
      totalDollars: (totalCents / 100).toFixed(2),
      ursOwed: Math.floor(totalCents / PITY_THRESHOLD),
      remainderCents: totalCents % PITY_THRESHOLD,
    }))
    .filter(u => u.ursOwed > 0)
    .sort((a, b) => b.totalCents - a.totalCents);

  if (!grants.length) {
    console.log('No users have reached the $30 pity threshold. Nothing to grant.');
    return;
  }

  const totalUrs = grants.reduce((s, u) => s + u.ursOwed, 0);
  console.log(`Users who qualify: ${grants.length}`);
  console.log(`Total URs to grant: ${totalUrs}\n`);
  console.log('Plan:');
  for (const g of grants) {
    console.log(`  ${g.uid}  $${g.totalDollars} spent  →  ${g.ursOwed} UR(s)  (remainder: ${g.remainderCents}¢)`);
  }

  if (!COMMIT) {
    console.log('\nDry run complete. Run with --commit to apply.\n');
    return;
  }

  console.log('\nApplying...');
  let succeeded = 0, failed = 0;
  for (const g of grants) {
    try {
      const cardNames = [];
      for (let i = 0; i < g.ursOwed; i++) {
        const name = await grantUrInventoryItem(g.uid);
        cardNames.push(name);
      }
      // Update pity counter to the leftover so future purchases continue correctly
      await db.doc(`profiles/${g.uid}`).update({ stripePityCents: g.remainderCents });
      console.log(`  ✅ ${g.uid}  granted: ${cardNames.join(', ')}  (pity set to ${g.remainderCents}¢)`);
      succeeded++;
    } catch(e) {
      console.error(`  ❌ ${g.uid}  FAILED: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
