/* Vestibulando Geo — PWA Update System */
'use strict';

const CACHE_NAME = 'vestibulando-geo-v6';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './lessons.js',
  './script.js',
  './manifest.webmanifest',
  './logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

/* INSTALAÇÃO */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ATIVAÇÃO */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ATUALIZAÇÃO DOS ARQUIVOS */

self.addEventListener('fetch', event => {

  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // HTML: sempre tenta buscar a versão mais recente.
  if (request.mode === 'navigate') {

    event.respondWith(
      fetch(request)
        .then(response => {

          if (response.ok) {
            const copy = response.clone();

            event.waitUntil(
              caches.open(CACHE_NAME)
                .then(cache => cache.put('./index.html', copy))
            );
          }

          return response;
        })
        .catch(() => caches.match('./index.html'))
    );

    return;
  }

  // JavaScript e CSS: prioriza a versão online.
  const isCode =
    /\.(js|css)$/i.test(url.pathname);

  if (isCode) {

    event.respondWith(
      fetch(request)
        .then(response => {

          if (response.ok) {
            const copy = response.clone();

            event.waitUntil(
              caches.open(CACHE_NAME)
                .then(cache => cache.put(request, copy))
            );
          }

          return response;
        })
        .catch(() => caches.match(request))
    );

    return;
  }

  // Outros recursos: prioriza o cache.
  event.respondWith(
    caches.match(request)
      .then(cached => {

        if (cached) return cached;

        return fetch(request).then(response => {

          if (response.ok) {
            const copy = response.clone();

            event.waitUntil(
              caches.open(CACHE_NAME)
                .then(cache => cache.put(request, copy))
            );
          }

          return response;
        });
      })
  );

});