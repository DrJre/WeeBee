/**
 * One-time scraper: animefillerlist.com → Firestore filler_guide collection
 *
 * Setup:
 *   1. Download a service account key from Firebase Console →
 *      Project Settings → Service accounts → Generate new private key
 *   2. Save it as scripts/serviceAccount.json  (already in .gitignore)
 *   3. cd scripts && npm install
 *   4. node scrape-filler.js
 *
 * Re-running is safe — each doc is overwritten with the latest scraped data.
 * To re-scrape a single show:  node scrape-filler.js naruto-shippuden
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore }        = require('firebase-admin/firestore');
const cheerio                 = require('cheerio');
const path                    = require('path');
const fs                      = require('fs');

// ── Firebase init ─────────────────────────────────────────────────────────────
const saPath = path.join(__dirname, 'serviceAccount.json');
if (!fs.existsSync(saPath)) {
    console.error('❌  serviceAccount.json not found in scripts/');
    console.error('   Download it from Firebase Console → Project Settings → Service accounts');
    process.exit(1);
}
initializeApp({ credential: cert(require(saPath)) });
const db = getFirestore();

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL  = 'https://www.animefillerlist.com';
const DELAY_MS  = 800;   // be polite — one request every ~800ms
const BATCH_MAX = 400;   // Firestore batch write limit

// ── Helpers ───────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeTitle(t) {
    return (t || '')
        .toLowerCase()
        .replace(/[:\-–—!?.,'"()[\]]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Maps the text in the "Type" column to a short internal key
const TYPE_TEXT_MAP = {
    'manga canon':        'manga_canon',
    'anime canon':        'anime_canon',
    'mixed canon/filler': 'mixed',
    'filler':             'filler',
    'recap':              'recap',
};

function parseType(raw) {
    const key = (raw || '').toLowerCase().trim();
    return TYPE_TEXT_MAP[key] || 'canon';
}

// ── Scrape the full show list ─────────────────────────────────────────────────
async function fetchShowList() {
    console.log('Fetching show list from animefillerlist.com...');
    const res  = await fetch(`${BASE_URL}/shows`);
    const html = await res.text();
    const $    = cheerio.load(html);

    const seen  = new Set();
    const shows = [];

    $('a[href^="/shows/"]').each((_, el) => {
        const href  = $(el).attr('href') || '';
        const slug  = href.replace('/shows/', '').split('/')[0].trim();
        const title = $(el).text().trim();
        if (!slug || !title || slug === 'shows' || seen.has(slug)) return;
        seen.add(slug);
        shows.push({ slug, title });
    });

    console.log(`  Found ${shows.length} shows\n`);
    return shows;
}

// ── Scrape one show page ──────────────────────────────────────────────────────
async function fetchShowEpisodes(slug) {
    const res  = await fetch(`${BASE_URL}/shows/${slug}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $    = cheerio.load(html);

    const episodes = [];

    // The episode table is the main <table> on the page.
    // Columns: #  |  Title  |  Type  |  Airdate
    $('table tr').each((i, row) => {
        const cols = $(row).find('td');
        if (cols.length < 3) return;

        const num   = parseInt($(cols[0]).text().trim(), 10);
        const title = $(cols[1]).text().trim();
        const type  = parseType($(cols[2]).text().trim());
        const aired = $(cols[3])?.text().trim() || '';

        if (isNaN(num)) return;
        episodes.push({ n: num, title, type, aired });
    });

    return episodes;
}

// ── Save one show to Firestore ────────────────────────────────────────────────
async function saveShow(slug, title, episodes) {
    // Build a set of normalized title variants for fuzzy lookup from app.js
    const titleNorms = [
        normalizeTitle(title),
        // also strip the parenthetical year, e.g. "Hunter × Hunter (2011)"
        normalizeTitle(title.replace(/\s*\(\d{4}\)/, '')),
    ].filter((v, i, a) => v && a.indexOf(v) === i);

    await db.collection('filler_guide').doc(slug).set({
        title,
        titleNorms,
        slug,
        episodes,
        episodeCount: episodes.length,
        scrapedAt:    new Date(),
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const targetSlug = process.argv[2]; // optional: re-scrape one show

    let shows;
    if (targetSlug) {
        // Single-show mode: infer a title from the slug (will be overwritten by page title if we add that later)
        shows = [{ slug: targetSlug, title: targetSlug }];
        console.log(`Single-show mode: ${targetSlug}\n`);
    } else {
        shows = await fetchShowList();
    }

    let ok = 0, failed = 0;

    for (let i = 0; i < shows.length; i++) {
        const { slug, title } = shows[i];
        process.stdout.write(`[${i + 1}/${shows.length}] ${title} (${slug}) ... `);

        try {
            await sleep(DELAY_MS);
            const episodes = await fetchShowEpisodes(slug);

            if (episodes.length === 0) {
                console.log('⚠  0 episodes parsed — skipping');
                failed++;
                continue;
            }

            await saveShow(slug, title, episodes);
            console.log(`✓  ${episodes.length} episodes`);
            ok++;
        } catch (e) {
            console.log(`✗  ${e.message}`);
            failed++;
        }
    }

    console.log(`\nDone — ${ok} saved, ${failed} failed`);
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
