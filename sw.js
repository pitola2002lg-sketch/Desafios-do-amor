const CACHE_PREFIX = 'desafios-do-amor-';
const CACHE_NAME = `${CACHE_PREFIX}v3.2.0`;
const APP_SHELL = [
    './', './index.html', './styles.css', './manifest.json', './icon-192.png', './icon-512.png',
    './icon-maskable-512.png', './apple-touch-icon.png', './favicon.png',
    './js/app.js', './js/challenges.js', './js/storage.js', './js/notifications.js', './js/ui.js'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

    if (event.request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                const response = await fetch(event.request, { cache: 'no-store' });
                if (response.ok) {
                    const cache = await caches.open(CACHE_NAME);
                    await cache.put('./index.html', response.clone());
                }
                return response.ok ? response : (await caches.match('./index.html')) || response;
            } catch {
                return (await caches.match(event.request)) || (await caches.match('./index.html')) || Response.error();
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const cached = await caches.match(event.request);
        const update = fetch(event.request).then(async response => {
            if (response.ok) {
                const cache = await caches.open(CACHE_NAME);
                await cache.put(event.request, response.clone());
            }
            return response;
        }).catch(() => null);
        return cached || (await update) || Response.error();
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const destination = event.notification.data?.url || './#today';
    event.waitUntil((async () => {
        const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if ('navigate' in client) await client.navigate(destination);
            if ('focus' in client) return client.focus();
        }
        return clients.openWindow ? clients.openWindow(destination) : undefined;
    })());
});
