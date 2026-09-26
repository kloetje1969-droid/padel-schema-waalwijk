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

// Vang het achtergrondbericht op (wanneer de app gesloten is of op de achtergrond staat)
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Ontvangen achtergrondbericht:', payload);
    
    // Haal de titel en body uit payload.data
    const notificationTitle = payload.data?.title || 'Padel Update';
    const notificationOptions = {
        body: payload.data?.body || 'Er is een nieuw bericht.',
        icon: '/favicon.ico',
        badge: '/favicon.ico'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Vang eventuele berichten direct vanuit de app op
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(event.data.title, {
            body: event.data.body,
            icon: '/favicon.ico',
            badge: '/favicon.ico'
        });
    }
});

