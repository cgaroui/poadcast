/* Service worker : met l'app en cache pour un fonctionnement 100 % hors ligne. */
var CACHE = "carnet-ecoute-v4";
var ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "fonts/inter-latin-wght-normal.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-512-maskable.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // cache: "reload" force le téléchargement depuis le serveur (pas le cache HTTP du navigateur)
      return cache.addAll(ASSETS.map(function (url) { return new Request(url, { cache: "reload" }); }));
    })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // Pages : réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("index.html", copy); });
        return res;
      }).catch(function () {
        return caches.match("index.html").then(function (r) { return r || caches.match("./"); });
      })
    );
    return;
  }

  // Ressources : cache d'abord, puis réseau.
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
