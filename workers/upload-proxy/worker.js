// Cloudflare Worker — two endpoints:
//   PUT  /?key=<path>                        — direct upload (avatars, banners, post images)
//   POST /fetch-and-cache  { key, sourceUrl } — fetch a remote image and store it in R2
//
// Both require: Authorization: Bearer <UPLOAD_SECRET>
// Environment bindings: BUCKET (R2), UPLOAD_SECRET (secret via wrangler secret put)

const ALLOWED_PREFIXES = ['avatars/', 'banners/', 'post_images/', 'tcg-art/characters/'];
const PUBLIC_BASE = 'https://pub-b241667abcf649f48658584322a083c1.r2.dev';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function unauthorized() { return new Response('Unauthorized', { status: 401, headers: CORS }); }
function badRequest(msg) { return new Response(msg, { status: 400, headers: CORS }); }

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }

        const auth = request.headers.get('Authorization') || '';
        if (auth !== `Bearer ${env.UPLOAD_SECRET}`) return unauthorized();

        const url = new URL(request.url);

        // ── POST /fetch-and-cache ─────────────────────────────────────────────
        if (request.method === 'POST' && url.pathname === '/fetch-and-cache') {
            let body;
            try { body = await request.json(); } catch { return badRequest('Invalid JSON'); }

            const { key, sourceUrl } = body;
            if (!key || !sourceUrl) return badRequest('Missing key or sourceUrl');
            if (!ALLOWED_PREFIXES.some(p => key.startsWith(p))) {
                return new Response('Forbidden path', { status: 403, headers: CORS });
            }

            const imageResp = await fetch(sourceUrl, { headers: { 'User-Agent': 'WeeBeeBot/1.0' } });
            if (!imageResp.ok) {
                return new Response(`Failed to fetch source: ${imageResp.status}`, { status: 502, headers: CORS });
            }

            const buffer = await imageResp.arrayBuffer();
            const contentType = imageResp.headers.get('Content-Type') || 'image/jpeg';

            await env.BUCKET.put(key, buffer, { httpMetadata: { contentType } });

            return new Response(JSON.stringify({ url: `${PUBLIC_BASE}/${key}` }), {
                headers: { ...CORS, 'Content-Type': 'application/json' },
            });
        }

        // ── PUT /?key=<path> ─────────────────────────────────────────────────
        if (request.method === 'PUT') {
            const key = url.searchParams.get('key') || '';
            if (!key) return badRequest('Missing key');
            if (!ALLOWED_PREFIXES.some(p => key.startsWith(p))) {
                return new Response('Forbidden path', { status: 403, headers: CORS });
            }

            const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
            const body = await request.arrayBuffer();
            await env.BUCKET.put(key, body, { httpMetadata: { contentType } });

            return new Response(JSON.stringify({ url: `${PUBLIC_BASE}/${key}` }), {
                headers: { ...CORS, 'Content-Type': 'application/json' },
            });
        }

        return new Response('Method not allowed', { status: 405, headers: CORS });
    },
};
