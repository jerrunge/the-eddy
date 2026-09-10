/* The Harbor service worker v1. No caching: the Harbor always loads fresh. It exists
   so the installed Harbor can receive its own knocks (Walks and Talks requests, and
   nothing from the Eddy). Bump VERSION on every change. */
const VERSION = "harbor-v2"; // v2: a knock that carries a url opens that url (the 29:11 face uses this rail)

self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener("push", (e) => {
  let data = {};
  try { data = e.data.json(); } catch { }
  e.waitUntil(self.registration.showNotification(data.title || "The Harbor", {
    body: data.body || "Something new landed in the Harbor.",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: data.kind || "harbor",
    data: { url: data.url || "./", kind: data.kind || null },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url && c.url.indexOf(url.replace(/\.\/$/, "")) === 0 && "focus" in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});
