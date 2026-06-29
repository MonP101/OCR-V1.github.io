const CACHE = "ocr-v2-cache-v1";

const ASSETS = [
  "./index.html",
  "./style.css",
  "./ocr_v2.js",
  "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js",
  "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"
];

// Cài đặt: cache tất cả assets
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      console.log("[SW] Caching assets...");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Kích hoạt: xóa cache cũ
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch: cache-first
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache response mới
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline và không có cache
        console.warn("[SW] Offline, không tìm thấy cache cho:", event.request.url);
      });
    })
  );
});
