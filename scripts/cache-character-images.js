// Fetches character images from AniList and caches them on Cloudflare R2.
// Updates each Firestore 'characters' doc with the new R2 URL so future
// card opens automatically use R2 instead of AniList.
//
// Folder structure: tcg-art/characters/{Anime}/{Name}.jpg
// Run from the scripts/ directory: node cache-character-images.js

const admin = require('firebase-admin');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const http = require('http');
const path = require('path');
const serviceAccount = require('./serviceAccount.json');

// ── Firebase ──────────────────────────────────────────────────────────────────
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'weebee-fbbd8.firebasestorage.app',
});
const db = admin.firestore();

// ── Cloudflare R2 ─────────────────────────────────────────────────────────────
const r2 = new S3Client({
    region: 'auto',
    endpoint: 'https://6d6269120d92868832026048bc6eb770.r2.cloudflarestorage.com',
    credentials: {
        accessKeyId: '327e11debdc426646ace46f232e29b94',
        secretAccessKey: '99ffbe35b5517a0e8e9368325f4b07940a52fc1da3f274db1d3e4a5d40c11daa',
    },
});
const R2_BUCKET = 'weebee-assets';
const R2_PUBLIC_BASE = 'https://pub-b241667abcf649f48658584322a083c1.r2.dev';

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitize(str) {
    return (str || 'unknown')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')  // strip path-unsafe chars
        .replace(/\.{2,}/g, '.')                 // no double dots
        .trim();
}

function r2Key(anime, name) {
    return `tcg-art/characters/${sanitize(anime)}/${sanitize(name)}.jpg`;
}

function downloadBuffer(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': 'WeeBeeBot/1.0' } }, res => {
            if (res.statusCode === 301 || res.statusCode === 302) {
                return downloadBuffer(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

async function existsInR2(key) {
    try {
        await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        return true;
    } catch { return false; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('Loading characters from Firestore...');
    const snap = await db.collection('characters').get();
    const docs = snap.docs;
    console.log(`Found ${docs.length} characters.\n`);

    let uploaded = 0, skipped = 0, alreadyR2 = 0, errors = 0;

    for (let i = 0; i < docs.length; i++) {
        const docRef = docs[i].ref;
        const data = docs[i].data();
        const { name, anime, image } = data;

        if (!name || !anime) { skipped++; continue; }

        // Already on R2 — nothing to do
        if (image && image.startsWith(R2_PUBLIC_BASE)) {
            process.stdout.write('r');
            alreadyR2++;
            continue;
        }

        // No image URL to fetch
        if (!image) {
            process.stdout.write('_');
            skipped++;
            continue;
        }

        const key = r2Key(anime, name);

        try {
            // Skip upload if file already exists in R2 (resumable)
            if (await existsInR2(key)) {
                await docRef.update({ image: `${R2_PUBLIC_BASE}/${key}` });
                process.stdout.write('s');
                skipped++;
            } else {
                const buffer = await downloadBuffer(image);
                await r2.send(new PutObjectCommand({
                    Bucket: R2_BUCKET,
                    Key: key,
                    Body: buffer,
                    ContentType: 'image/jpeg',
                }));
                await docRef.update({ image: `${R2_PUBLIC_BASE}/${key}` });
                process.stdout.write('.');
                uploaded++;
            }
        } catch (e) {
            process.stdout.write('E');
            console.error(`\n  ERROR [${name} / ${anime}]: ${e.message}`);
            errors++;
        }

        // Rate limit: ~100ms between requests to be polite to AniList
        if (i % 10 === 9) process.stdout.write(` ${i + 1}/${docs.length}\n`);
        await sleep(100);
    }

    console.log(`\n\n── Done ──────────────────────────────────────────`);
    console.log(`. = uploaded   r = already R2   s = skipped (file existed)   _ = no image   E = error`);
    console.log(`Uploaded: ${uploaded}  Already R2: ${alreadyR2}  Skipped: ${skipped}  Errors: ${errors}`);
    console.log(`\nR2 folder: ${R2_PUBLIC_BASE}/tcg-art/characters/`);
    console.log('Remember to rotate your R2 API token in the Cloudflare dashboard.');
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1); });
