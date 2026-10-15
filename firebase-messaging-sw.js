importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC2TvKuO8vSfzmaGu-CictLit5iuRnRFNU",
  authDomain: "padel-app-b8362.firebaseapp.com",
  databaseURL: "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "padel-app-b8362",
  storageBucket: "padel-app-b8362.appspot.com",
  messagingSenderId: "453639626765",
  appId: "1:453639626765:web:f71b5164fca8c3bebef544"
});

const messaging = firebase.messaging();
const ICON = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3d3.png';

// Berichten met een "notification"-veld toont FCM zelf. Hier alleen data-only berichten tonen,
// anders zie je dezelfde melding dubbel.
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const d = payload.data || {};
  self.registration.showNotification(d.title || 'Padel Update', {
    body: d.body || 'Er is een nieuw bericht in de padel app',
    icon: ICON,
    data: { url: d.click_action || '/' }
  });
});

self.addEventListener('notificationclick', (event) => {
  // Door FCM getoonde melding met link: de Firebase-SDK opent die link zelf
  const fcm = event.notification.data && event.notification.data.FCM_MSG;
  if (fcm && ((fcm.fcmOptions && fcm.fcmOptions.link) || (fcm.notification && fcm.notification.click_action))) return;

  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) return client.focus();
      }
      return clients.openWindow(target);
    })
  );
});
