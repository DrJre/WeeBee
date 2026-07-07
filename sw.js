// WeeBee service worker — caches the app shell (HTML/CSS/JS/icons) for fast,
// installable loads. Everything else (Firestore, Jikan, Deezer, avatars,
// etc.) passes straight through to the network; we never cache app data.
//
// Bump CACHE_VERSION whenever app.js/styles.css version query strings change
// in index.html, so returning users get the new shell instead of a stale one.
const CACHE_VERSION = 'v564';
const CACHE_NAME = `weebee-shell-${CACHE_VERSION}`;

const SHELL_URLS = [
    '/',
    '/index.html',
    '/styles.css?v=136',
    '/app.js?v=539',
    '/characters.js',
    '/manifest.json',
    '/favicon.svg',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/assets/icon-maskable-192.png',
    '/assets/icon-maskable-512.png',
    '/assets/apple-touch-icon.png',
];

self.addEventListener('install', event => {
    // Bypass the HTTP cache when populating the shell cache — otherwise a
    // stale browser-cached response gets baked in and served forever.
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.all(SHELL_URLS.map(url =>
                fetch(url, { cache: 'reload' }).then(response => cache.put(url, response))
            ))
        )
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (!SHELL_URLS.includes(url.pathname) && !SHELL_URLS.includes(url.pathname + url.search)) return;

    event.respondWith(
        caches.match(request).then(cached => cached || fetch(request))
    );
});
