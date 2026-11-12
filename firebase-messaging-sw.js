// Service worker voor pushmeldingen.
// Elke melding wordt hier door ons zelf getoond (precies één keer), ook als de app open staat.
// Zo voorkomt dit dubbele meldingen en de standaardmelding van Chrome.

const ICON = '/icon-192.png';
const BADGE = '/badge-96.png';

// ---- Zonder internet (sinds 9.04) ----
// De bestanden van de app worden ook op het toestel bewaard. Altijd EERST van internet (zodat een nieuwe versie
// meteen doorkomt); alleen als dat niet lukt, de bewaarde kopie. De server (/api/) en de database gaan nooit via de kopie.
const APP_KOPIE = 'padel-app';
const APP_BESTANDEN = ['/index.html', '/stijl.css', '/foutlog.js', '/padel-regels.js', '/offline.js', '/uitgelicht.js', '/manifest.json', '/icon-192.png'];
const FIREBASE_SDK = ['app', 'database', 'auth', 'messaging'].map(n => `https://www.gstatic.com/firebasejs/13.2.0/firebase-${n}-compat.js`);

// Eén vaste sleutel per bestand: zonder ?v=... (en / is index.html), zodat altijd de laatst opgehaalde versie bewaard staat
function kopieSleutel(url) {
  const u = new URL(url);
  if (u.origin !== self.location.origin) return u.href;
  return u.origin + (u.pathname === '/' ? '/index.html' : u.pathname);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(APP_KOPIE).then(async (kopie) => {
    for (const pad of APP_BESTANDEN) {
      try { const r = await fetch(pad, { cache: 'no-store' }); if (r.ok) await kopie.put(kopieSleutel(new URL(pad, self.location.origin).href), r); } catch (e) { /* later opnieuw */ }
    }
    for (const url of FIREBASE_SDK) {
      try { const r = await fetch(url, { mode: 'no-cors' }); await kopie.put(url, r); } catch (e) { /* later opnieuw */ }
    }
  }).catch(() => {}));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const eigen = url.origin === self.location.origin;
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!eigen && !sdk) return;                     // database, inloggen, weer en pushdienst: gewoon via internet
  if (eigen && url.pathname.startsWith('/api/')) return;
  const sleutel = kopieSleutel(req.url);
  event.respondWith(
    fetch(req).then((antwoord) => {
      if (antwoord && (antwoord.ok || antwoord.type === 'opaque')) {
        const kopie = antwoord.clone();
        caches.open(APP_KOPIE).then(c => c.put(sleutel, kopie)).catch(() => {});
      }
      return antwoord;
    }).catch(() => caches.match(sleutel).then(r => r || (req.mode === 'navigate' ? caches.match(kopieSleutel(self.location.origin + '/index.html')) : undefined))
      .then(r => r || Response.error()))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { data: { title: 'Padel', body: event.data ? event.data.text() : '' } };
  }

  const d = Object.assign({}, payload.notification || {}, payload.data || {});
  const title = d.title || 'Padel';
  const options = {
    body: d.body || '',
    icon: ICON,
    badge: BADGE,
    data: { url: '/' }
  };
  if (d.tag) options.tag = d.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
