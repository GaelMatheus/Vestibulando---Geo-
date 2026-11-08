const CACHE_NAME = "vestibulando-geo-v29";
const MAP_CACHE_NAME = "vestibulando-geo-maps-v1";
const MAP_HOSTS = new Set([
  "raw.githubusercontent.com",
  "servicodados.ibge.gov.br",
  "pamgia.ibama.gov.br"
]);

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./lessons.js",
  "./manifest.webmanifest",
  "./logo.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![CACHE_NAME, MAP_CACHE_NAME].includes(key))
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Camadas geográficas externas: rede primeiro e cache como alternativa offline.
  if (MAP_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(MAP_CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Arquivos do próprio aplicativo: rede primeiro, cache se estiver sem conexão.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        return (await caches.match("./index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});
