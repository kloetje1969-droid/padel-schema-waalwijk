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

// Vang achtergrondberichten op als de app op de achtergrond staat of gesloten is
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Ontvangen achtergrondbericht:', payload);
  
  // Haal de data op uit notification of val terug op de data-payload
  const notificationTitle = payload.notification?.title || payload.data?.title || 'Padel Update';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'Er is een nieuw bericht in de padel app',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: {
      url: payload.notification?.click_action || payload.data?.click_action || '/'
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Zorg ervoor dat de app opent wanneer er op de melding wordt geklikt
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Melding aangeklikt:', event);
  event.notification.close();

  const clickURL = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Als de app al open staat in een tabblad, focus daar dan op
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === clickURL && 'focus' in client) {
          return client.focus();
        }
      }
      // Anders open je een nieuw venster/tabblad op de juiste URL
      if (clients.openWindow) {
        return clients.openWindow(clickURL);
      }
    })
  );
});


