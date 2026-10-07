// Service worker: receives push while the app is closed or in the background.
// Reuses your existing config so keys live in one place.
importScripts(
  "js/lib/firebase-app-compat.js",
  "js/lib/firebase-messaging-compat.js",
  "js/config.js" // defines firebaseConfig (the other consts in it are harmless here)
);

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// The server sends data-only messages, so we build the notification ourselves.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || "🚨 New campus alert", {
    body: d.body || "Open the dashboard to respond.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-96.png",
    tag: d.alertId || "uv-alert",
    renotify: true,
    requireInteraction: true, // stays on screen until dismissed (desktop/Android)
    vibrate: [500, 200, 500, 200, 500, 200, 500, 200, 500],
    data: { url: "/security.html?alarm=1" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) ||
    "/security.html?alarm=1";

  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const c of list) {
          if (c.url.includes("/security.html") && "focus" in c) {
            c.postMessage({ type: "alarm" }); // open page starts the siren
            return c.focus();
          }
        }
        return clients.openWindow(url); // ?alarm=1 makes the page start the siren
      })
  );
});

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));