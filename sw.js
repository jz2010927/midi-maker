/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const CACHE_NAME = 'promptdj-midi-cache-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/index.css',
  '/manifest.webmanifest',
  '/locales/en.json',
  '/locales/zh-CN.json',
  'https://esm.sh/lit@^3.3.0',
  'https://esm.sh/lit@^3.3.0/directives/class-map.js',
  'https://esm.sh/lit@^3.3.0/directives/style-map.js',
  'https://esm.sh/@google/genai@^1.0.0'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});