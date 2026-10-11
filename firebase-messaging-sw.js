/* Firebase Cloud Messaging background handler — must live at site root */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDVfWYmz-20ygXfdm-T8DFcMWNtw_bfva8",
  authDomain: "meticulous-dd570.firebaseapp.com",
  projectId: "meticulous-dd570",
  storageBucket: "meticulous-dd570.firebasestorage.app",
  messagingSenderId: "1047679373820",
  appId: "1:1047679373820:web:bd75841126fa2561f82279"
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var title = (payload.notification && payload.notification.title) || 'Meticulous';
  var body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body: body,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png'
  });
});
