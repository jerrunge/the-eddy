/* The Eddy service worker v1. Shell cached for offline capture; push carries the
   park knocks. Bump VERSION on every deploy (the fortify-room lesson). */
const VERSION = "eddy-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin === location.origin || url.hostname.includes("fonts.g")) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok && e.request.method === "GET") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match("index.html")))
    );
  }
});
self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data.json(); } catch { }
  e.waitUntil(self.registration.showNotification(data.title || "The Eddy", {
    body: data.body || "A parked loop is ready for you.",
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { park_id: data.park_id || null },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return clients.openWindow("./");
  }));
});
