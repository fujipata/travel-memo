// アプリ本体を変更するリリースでは、このバージョンも更新する。
const VERSION = 'v6';
const BASE = new URL('./', self.location.href);
const PREFIX = 'travel-memo:' + BASE.pathname + ':';
const CACHE = PREFIX + VERSION;
const ASSETS = ['index.html', 'offline.js'].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
  // 全ファイルが揃わなければインストール失敗。既存版を継続する。
  event.waitUntil(caches.open(CACHE).then(cache =>
    cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'})))
  ));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') {
    event.waitUntil(self.skipWaiting());
  }
  if (event.data?.type === 'CHECK_OFFLINE' && event.ports[0]) {
    event.waitUntil((async () => {
      try {
        const cache = await caches.open(CACHE);
        const present = await Promise.all(ASSETS.map(url => cache.match(url)));
        event.ports[0].postMessage({ready: present.every(Boolean), version: VERSION});
      } catch (error) {
        event.ports[0].postMessage({ready: false});
      }
    })());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== BASE.origin) return;
  let asset;
  if (request.mode === 'navigate' &&
      (url.pathname === BASE.pathname || url.pathname === BASE.pathname + 'index.html')) {
    asset = ASSETS[0];
  } else if (url.pathname === BASE.pathname + 'offline.js') {
    asset = ASSETS[1];
  }
  if (!asset) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(asset);
    if (cached) return cached;
    // キャッシュが消えた場合はオンラインで再取得する。
    const response = await fetch(new Request(asset, {cache: 'reload'}));
    if (response.ok && !response.redirected) {
      try { await cache.put(asset, response.clone()); } catch (error) { /* 表示は続行 */ }
    }
    return response;
  })());
});

