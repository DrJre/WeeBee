/**
 * WeeBee — Update Sensei Tier List Templates
 *
 * Before running:
 *   1. Go to Firebase Console → Project Settings → Service Accounts
 *   2. Click "Generate new private key" → save as serviceAccount.json in the project root
 *   3. node scraper/update-sensei-templates.mjs
 */

import admin from 'firebase-admin';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const ANILIST = 'https://graphql.anilist.co';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Firebase init ─────────────────────────────────────────────────────────────
let serviceAccount;
try {
    serviceAccount = JSON.parse(readFileSync(path.join(ROOT, 'serviceAccount.json'), 'utf8'));
} catch {
    console.error('❌  serviceAccount.json not found in project root.');
    console.error('   Go to Firebase Console → Project Settings → Service Accounts → Generate new private key');
    console.error('   Save the downloaded file as serviceAccount.json in the WeeBee folder.');
    process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── AniList helpers ───────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
    const res = await fetch(ANILIST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables })
    });
    if (res.status === 429) { console.log('  Rate limited — waiting 60s...'); await sleep(60000); return gql(query, variables); }
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data;
}

async function searchCharacter(name) {
    const data = await gql(`
        query ($search: String) {
            Character(search: $search) {
                id
                name { full }
                image { large }
            }
        }
    `, { search: name });
    return data?.Character || null;
}

// ── Characters to remove (matched case-insensitively against item.title) ──────
const REMOVE_NAMES = ['erwin', 'itachi', 'hange', 'roy mustang', 'minato', 'tsunade'];

// ── Characters to add ─────────────────────────────────────────────────────────
const ADD_CHARS = [
    { search: 'Biscuit Krueger',  animeTitle: 'Hunter x Hunter'          },
    { search: 'Keishin Ukai',     animeTitle: 'Haikyuu!!'                },
    { search: 'Yami Sukehiro',    animeTitle: 'Black Clover'             },
    { search: 'Piccolo',          animeTitle: 'Dragon Ball Z'            },
    { search: 'Monkey D. Garp',   animeTitle: 'One Piece'                },
    { search: 'Eikichi Onizuka',  animeTitle: 'Great Teacher Onizuka'    },
];

// ── Fetch new characters from AniList ─────────────────────────────────────────
async function fetchNewCharacters() {
    const results = [];
    for (const c of ADD_CHARS) {
        process.stdout.write(`  Fetching "${c.search}"... `);
        const char = await searchCharacter(c.search);
        if (!char) { console.log('NOT FOUND — skipping'); continue; }
        console.log(`✓ ${char.name.full}`);
        results.push({
            id:         `anilist_${char.id}`,
            title:      char.name.full,
            image:      char.image.large,
            animeTitle: c.animeTitle
        });
        await sleep(750); // AniList rate limit
    }
    return results;
}

// ── Remove characters from an item array ─────────────────────────────────────
function filterOut(items) {
    return (items || []).filter(item => {
        const name = (item.title || item.name || '').toLowerCase();
        return !REMOVE_NAMES.some(n => name.includes(n));
    });
}

// ── Update a single tier list document ───────────────────────────────────────
async function updateTemplate(docId, title, newChars) {
    const ref = db.collection('tier_lists').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`  ⚠  Document not found: ${docId}`); return; }

    const data = snap.data();

    const updatedTiers = (data.tiers || []).map(tier => ({
        ...tier,
        items: filterOut(tier.items)
    }));
    const updatedUnranked = [...filterOut(data.unranked), ...newChars];

    const allItems = [...updatedTiers.flatMap(t => t.items || []), ...updatedUnranked];
    const sourceAnimeTitles = [...new Set(allItems.map(i => i.animeTitle).filter(Boolean))];

    await ref.update({
        tiers: updatedTiers,
        unranked: updatedUnranked,
        sourceAnimeTitles,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const removed = (data.tiers || []).flatMap(t => t.items || []).concat(data.unranked || [])
        .filter(item => REMOVE_NAMES.some(n => (item.title || '').toLowerCase().includes(n)))
        .map(i => i.title);

    console.log(`  ✓ Removed: ${removed.join(', ') || 'none found by name'}`);
    console.log(`  ✓ Added:   ${newChars.map(c => c.title).join(', ')}`);
}

// ── Append new characters to characters.js (WB_CHARACTERS) ───────────────────
function updateCharactersJs(newChars) {
    const filePath = path.join(ROOT, 'characters.js');
    let content = readFileSync(filePath, 'utf8');

    // Build the new entries to append before the closing ];
    const entries = newChars.map(c => `  { "name": ${JSON.stringify(c.title)}, "image": ${JSON.stringify(c.image)}, "anime": ${JSON.stringify(c.animeTitle)} }`);
    const toInsert = '\n' + entries.join(',\n') + '\n';

    // Insert before the closing ]; of the WB_CHARACTERS array
    content = content.replace(/\n\];/, toInsert + '];');
    writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Added ${newChars.length} characters to characters.js`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n🔍  Fetching character images from AniList...\n');
    const newChars = await fetchNewCharacters();
    if (!newChars.length) { console.error('No characters fetched — aborting.'); process.exit(1); }

    console.log(`\n📦  Fetched ${newChars.length} / ${ADD_CHARS.length} characters\n`);

    // Find all Sensei templates
    console.log('🔎  Searching Firestore for "Sensei" templates...\n');
    const snap = await db.collection('tier_lists').get();
    const templates = snap.docs.filter(d =>
        d.data().title?.toLowerCase().includes('sensei')
    );

    if (!templates.length) {
        console.error('❌  No templates with "sensei" in title found. Check the title spelling in Firestore.');
        process.exit(1);
    }

    console.log(`Found ${templates.length} template(s):`);
    templates.forEach(t => console.log(`  • "${t.data().title}" [${t.id}]`));

    for (const t of templates) {
        console.log(`\n✏️   Updating "${t.data().title}"...`);
        await updateTemplate(t.id, t.data().title, newChars);
    }

    console.log('\n📝  Updating characters.js...');
    updateCharactersJs(newChars);

    console.log('\n✅  Done! Deploy when ready:\n   firebase deploy\n');
}

main().catch(e => { console.error('\n❌  Fatal error:', e.message); process.exit(1); });
