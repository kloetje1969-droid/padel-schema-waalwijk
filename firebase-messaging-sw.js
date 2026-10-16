// Service worker voor pushmeldingen.
// Elke melding wordt hier door ons zelf getoond (precies één keer), ook als de app open staat.
// Zo voorkomt dit dubbele meldingen en de standaardmelding van Chrome.

const ICON = '/icon-192.png';
const BADGE = '/badge-96.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
