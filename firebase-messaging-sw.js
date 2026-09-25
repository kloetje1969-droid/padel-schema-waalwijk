importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC2TVkuO8vSfzmaGu-CictLit5iuRnRFNU",
  authDomain: "padel-app-b8362.firebaseapp.com",
  databaseURL: "https://padel-app-b8362-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "padel-app-b8362",
  storageBucket: "padel-app-b8362.appspot.com",
  messagingSenderId: "453639626765",
  appId: "1:453639626765:web:f71b5164fca8c3bebef544"
});

const messaging = firebase.messaging();