const CACHE_VERSION = 'v1.0.2'; // Increment this when you update your app
const CACHE_NAME = `packing-visualizer-${CACHE_VERSION}`;
const urlsToCache = [
    '.',
    'index.html',
    'main.js',
    'manifest.json',
    'https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css',
    'https://unpkg.com/three@0.159.0/build/three.module.js',
    'https://unpkg.com/three@0.159.0/examples/jsm/controls/OrbitControls.js',
    'https://unpkg.com/three@0.159.0/examples/jsm/exporters/GLTFExporter.js',
    'https://unpkg.com/es-module-shims/dist/es-module-shims.js'
];

// Install service worker and cache resources
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
    // Force the waiting service worker to become the active service worker
    self.skipWaiting();
});

// Fetch resources from cache or network
self.addEventListener('fetch', event => {
    // Skip cache for version.json to always get latest version info
    if (event.request.url.includes('version.json')) {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Return cached version or fetch from network
                return response || fetch(event.request)
                    .then(response => {
                        // Cache new resources
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                        return response;
                    });
            })
    );
});

// Clean up old caches and check for updates
self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName.startsWith('packing-visualizer-') && cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),
            // Take control of all clients
            self.clients.claim()
        ])
    );
});

// Handle update checking
self.addEventListener('message', event => {
    if (event.data === 'checkForUpdates') {
        // Check version.json for updates
        fetch('version.json', { cache: 'no-cache' })
            .then(response => response.json())
            .then(data => {
                if (data.version !== CACHE_VERSION) {
                    // Notify all clients about the update
                    self.clients.matchAll().then(clients => {
                        clients.forEach(client => {
                            client.postMessage({
                                type: 'updateAvailable',
                                version: data.version
                            });
                        });
                    });
                }
            })
            .catch(error => console.error('Error checking for updates:', error));
    }
});

// Handle immediate update request
self.addEventListener('message', event => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
