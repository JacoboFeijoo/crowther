// Caché de la carcasa de Crowther: no almacena proyectos ni recursos del usuario.
const CACHE_VERSION = "1.0.4";
const SCOPE_PATH = new URL(self.registration.scope).pathname
  .replace(/[^a-z0-9]+/gi, "-") || "root";
const CACHE_PREFIX = `crowther-shell-${SCOPE_PATH}-`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./LICENSE",
  "./COPYRIGHT-ATTRIBUTION.txt",
  "./RUNTIME-LICENSE-EXCEPTION.txt",
  "./manifest.webmanifest",
  "./styles.css",
  "./playable.css",
  "./Logo/Logo.svg",
  "./assets/pwa-icon-180.png",
  "./assets/pwa-icon-192.png",
  "./assets/pwa-icon-512.png",
  "./vendor/cytoscape.min.js",
  "./vendor/quill/quill.min.js",
  "./vendor/quill/quill.snow.css",
  "./vendor/quill/LICENSE",
  "./js/app.js",
  "./js/character-state.js",
  "./js/editor.js",
  "./js/inventory.js",
  "./js/model.js",
  "./js/playable-main.js",
  "./js/playable-runtime.js",
  "./js/player.js",
  "./js/pwa.js",
  "./js/rich-text.js",
  "./js/storage.js",
  "./js/workspace-state.js"
];

const shellUrls = new Set(SHELL_FILES.map((file) => new URL(file, self.registration.scope).href));
const appEntryUrl = new URL("./index.html", self.registration.scope);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match(request, { ignoreSearch: true }))
          || (await caches.match(appEntryUrl.href))
          || Response.error();
      }
    })());
    return;
  }

  const canonicalUrl = new URL(requestUrl.href);
  canonicalUrl.search = "";
  if (!shellUrls.has(canonicalUrl.href)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(canonicalUrl.href, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(request, { ignoreSearch: true })) || Response.error();
    }
  })());
});
