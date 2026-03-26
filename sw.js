// ═══════════════════════════════════════
// GROUNDWORK SERVICE WORKER v1.0
// ═══════════════════════════════════════
const CACHE_NAME = 'groundwork-v1';
const SHELL_CACHE = 'groundwork-shell-v1';

// App shell — precached on install
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// Domains that should NEVER be cached (always network)
const NETWORK_ONLY_DOMAINS = [
  'jxemjlafjjcjuriceetj.supabase.co',  // Supabase API
  'accounts.google.com',                 // Google Auth
  'apis.google.com',                     // Google APIs
];

// Domains that use network-first (try network, fall back to cache)
const NETWORK_FIRST_DOMAINS = [
  'maps.googleapis.com',  // Google Maps tiles & API
];

// ── INSTALL: Precache app shell ──
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Groundwork service worker...');
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => {
        console.log('[SW] App shell cached');
        return self.skipWaiting(); // Activate immediately
      })
      .catch(err => {
        console.warn('[SW] Shell cache failed (offline?):', err);
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE: Clean old caches ──
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== SHELL_CACHE)
          .map(key => {
            console.log('[SW] Removing old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim()) // Take control immediately
  );
});

// ── FETCH: Smart routing ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests (POST to Supabase, etc.)
  if (event.request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!url.protocol.startsWith('http')) return;

  // ── Network-only domains (auth, database) ──
  if (NETWORK_ONLY_DOMAINS.some(d => url.hostname.includes(d))) {
    return; // Let browser handle normally
  }

  // ── Network-first for Google Maps ──
  if (NETWORK_FIRST_DOMAINS.some(d => url.hostname.includes(d))) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ── Google Fonts: cache-first (they never change) ──
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // ── CDN scripts (Supabase JS, etc.): stale-while-revalidate ──
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // ── App shell (same origin): network-first so updates are immediate ──
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // ── Everything else: network-first ──
  event.respondWith(networkFirst(event.request));
});

// ═══════════════════════════════════════
// CACHING STRATEGIES
// ═══════════════════════════════════════

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 408, statusText: 'Offline' });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // If it's a navigation request, serve the cached shell
    if (request.mode === 'navigate') {
      const shell = await caches.match('/index.html');
      if (shell) return shell;
    }
    return new Response('Offline — please reconnect to use Groundwork.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) {
        caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
      }
      return response;
    })
    .catch(() => cached || new Response('', { status: 408 }));
  return cached || fetchPromise;
}

// ── Listen for skip-waiting message from client ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
