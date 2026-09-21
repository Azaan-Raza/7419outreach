// Service worker: keeps the app shell available offline and makes the home-screen install work.
// App files are network-first (so updates land right away) with a cache fallback.
// The Supabase client library is cached after first use. API calls are never cached.

const VERSION = "outreach-v2";
const SHELL = [
  "./", "./index.html", "./admin.html", "./config.js", "./manifest.webmanifest",
  "./css/primer.css", "./css/app.css", "./js/icons.js", "./js/ui.js", "./js/photo.js", "./js/photos-ui.js", "./js/db.js", "./js/app.js", "./js/admin.js",
  "./icons/logo.svg", "./icons/icon-192.png", "./icons/apple-touch-icon.png", "./icons/favicon-32.png",
];
const EXT = ["cdn.jsdelivr.net"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== VERSION + "-ext").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
    );
    return;
  }

  if (EXT.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(
      caches.open(VERSION + "-ext").then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    );
  }
  // anything else (Supabase API, storage) goes straight to the network
});
