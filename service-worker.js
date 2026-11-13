const CACHE_NAME = "vestibulando-geo-v43-sensor-atlas-original";
const MAP_CACHE_NAME = "vestibulando-geo-maps-v2";
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

const MAP_DATA_URLS = [
  "https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson",
  "https://pamgia.ibama.gov.br/server/rest/services/01_Publicacoes_Bases/biomas_ibge_250k_2019/MapServer/2/query?where=1%3D1&outFields=bioma&returnGeometry=true&outSR=4326&f=geojson"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const appCache = await caches.open(CACHE_NAME);
    // O núcleo do app é obrigatório: se algum arquivo local faltar, a instalação falha
    // e o navegador mantém o service worker anterior, em vez de ativar um cache incompleto.
    await appCache.addAll(FILES_TO_CACHE);

    // Os mapas são complementares: tenta baixá-los agora para uso offline,
    // mas uma indisponibilidade dos serviços geográficos não impede a instalação.
    const mapCache = await caches.open(MAP_CACHE_NAME);
    await Promise.allSettled(MAP_DATA_URLS.map(async (url) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok && (response.type === "cors" || response.type === "basic")) {
          await mapCache.put(url, response.clone());
        }
      } finally {
        clearTimeout(timeout);
      }
    }));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => ![CACHE_NAME, MAP_CACHE_NAME].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // GeoJSON: tenta atualizar pela rede; sem conexão, usa a cópia já armazenada.
  if (MAP_HOSTS.has(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(MAP_CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok && (response.type === "cors" || response.type === "basic")) {
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    })());
    return;
  }

  // Não intercepta serviços externos como Supabase/CDN: eles não são necessários
  // para abrir a jornada, responder questões e salvar o progresso local.
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
