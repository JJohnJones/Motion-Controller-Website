'use strict';
// Bump VERSION whenever shell assets change. No sensor samples or tokens are cached.
const VERSION = 'motion-controller-shell-v11-sword';
const ASSETS = ['./', './index.html', './styles.css?v=11', './motion-math.js?v=11', './hold-button.js?v=11', './controller.js?v=11', './controller-layouts.js?v=11', './controller-ui.js?v=11', './config.js?v=11', './lan-transport.js?v=11', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('motion-controller-shell-') && key !== VERSION).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  // Only cache the fixed app shell; unrelated same-origin requests are left alone.
  if (!ASSETS.some(path => new URL(path, self.registration.scope).href === url.href)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(VERSION).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request)));
});
