/* Service worker — offline support for the hosted (GitHub Pages) PWA.
   Network-first for the app page (fresh when online, cached when offline),
   cache-first for static assets. Cache version is stamped at build time so a
   redeploy refreshes clients automatically. */
const CACHE = "pf2e-subsystems-20260913230939";
/* Every cache this app has ever made starts with PREFIX. The sweep below is
   scoped to it on purpose: the PF2e tools share an origin when they are
   served from one host (GitHub Pages does it, and so does the toolbox), and an
   unscoped sweep would delete the other two apps' offline caches every time
   this one activated. */
const PREFIX = "pf2e-subsystems-";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((r) =>
      r ||
      fetch(req).then((res) => {
        if (res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => r)
    )
  );
});
