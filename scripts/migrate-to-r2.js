// One-time migration: copies static assets from Firebase Storage to Cloudflare R2.
// Run from the scripts/ directory: node migrate-to-r2.js
// After migration, rotate the R2 API token in the Cloudflare dashboard.

const admin = require('firebase-admin');
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const serviceAccount = require('./serviceAccount.json');

// ── Firebase Storage ──────────────────────────────────────────────────────────
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'weebee-fbbd8.firebasestorage.app',
});
const bucket = admin.storage().bucket();

// ── Cloudflare R2 (S3-compatible) ────────────────────────────────────────────
const r2 = new S3Client({
    region: 'auto',
    endpoint: 'https://6d6269120d92868832026048bc6eb770.r2.cloudflarestorage.com',
    credentials: {
        accessKeyId: '327e11debdc426646ace46f232e29b94',
        secretAccessKey: '99ffbe35b5517a0e8e9368325f4b07940a52fc1da3f274db1d3e4a5d40c11daa',
    },
});
const R2_BUCKET = 'weebee-assets';

// ── Folders to migrate ────────────────────────────────────────────────────────
// Phase 1: static assets only. Add 'avatars/', 'banners/', 'post_images/' later
// once the upload code is switched over to R2.
const FOLDERS = ['tcg-art/', 'cursors/', 'mal-badges/'];

const CONTENT_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.json': 'application/json',
};

async function existsInR2(key) {
    try {
        await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        return true;
    } catch {
        return false;
    }
}

async function migrateFile(file) {
    const key = file.name;
    if (await existsInR2(key)) {
        process.stdout.write('s'); // skip
        return 'skipped';
    }
    const [buffer] = await file.download();
    const ext = path.extname(key).toLowerCase();
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
    await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
    }));
    process.stdout.write('.');
    return 'uploaded';
}

async function main() {
    let totalUploaded = 0, totalSkipped = 0, totalErrors = 0;

    for (const folder of FOLDERS) {
        console.log(`\n\nFolder: ${folder}`);
        const [files] = await bucket.getFiles({ prefix: folder });
        console.log(`Found ${files.length} files — migrating (. = uploaded, s = skipped, E = error):`);

        for (const file of files) {
            try {
                const result = await migrateFile(file);
                if (result === 'uploaded') totalUploaded++;
                else totalSkipped++;
            } catch (e) {
                process.stdout.write('E');
                console.error(`\n  ERROR: ${file.name} — ${e.message}`);
                totalErrors++;
            }
        }
    }

    console.log(`\n\n── Done ──────────────────────────────────────────`);
    console.log(`Uploaded: ${totalUploaded}  Skipped: ${totalSkipped}  Errors: ${totalErrors}`);
    console.log(`\nR2 public base URL: https://pub-b241667abcf649f48658584322a083c1.r2.dev/`);
    console.log(`Remember to rotate your R2 API token in the Cloudflare dashboard.`);
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1); });
