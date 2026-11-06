/* Background worker for client reminders. Lives next to index.html in the repo.
   It only shows notifications sent by the reminders job; it does not cache or change the app. */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBk5f1ERJ96o-i682adFx2iYf9NPSGkVNQ',
  authDomain: 'hw-coaching.firebaseapp.com',
  projectId: 'hw-coaching',
  storageBucket: 'hw-coaching.firebasestorage.app',
  messagingSenderId: '998540984995',
  appId: '1:998540984995:web:1aa4dc782a0a350690b516'
});

/* Notifications sent with a title and body are shown automatically, and a tap opens the
   client's own dashboard link (set by the sender). */
firebase.messaging();
