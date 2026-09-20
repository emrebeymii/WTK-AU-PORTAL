/* ============================================================
   WTK PORTAL — Service Worker
   Amaç: sadece "uygulama kabuğunu" (index.html + manifest + ikonlar +
   Firebase SDK modülleri) önbelleğe alıp, çevrimdışıyken bile portalın
   AÇILABİLMESİNİ sağlamak. Firestore/Authentication gibi CANLI verilere
   ASLA dokunulmaz — onlar her zaman doğrudan ağa gider, hiç önbellek
   araya girmez (aksi halde eski/yanlış veri gösterilebilir).

   CACHE_NAME'i her önemli güncellemede bir üst sürüme çekin (v1 -> v2 ...);
   activate aşaması eski sürümdeki önbellekleri otomatik temizler, bu
   yüzden depolama zamanla şişmez. ============================================================ */

const CACHE_NAME = 'wtk-portal-shell-v2';

// Yalnızca gerçekten gereken dosyalar — "her şeyi önbelleğe al" YOK.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  // Firebase SDK modülleri: bunlar önbellekte olmazsa çevrimdışıyken
  // index.html'in <script type="module"> importları başarısız olur ve
  // portal hiç açılmaz (boş/bozuk ekran). Önbellekte olduklarında portal
  // en azından AÇILIR; Firestore/Auth çağrılarının kendisi tabii ki
  // çevrimdışıyken çalışmaz, ama bu beklenen ve normal bir durumdur.
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('SW install: bazı dosyalar önbelleğe alınamadı', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* Bir isteğin Firebase/Google canlı servislerine mi gittiğini anlar —
   bunlara ASLA önbellekten cevap verilmez, ASLA önbelleğe de yazılmaz. */
function isLiveServiceRequest(url) {
  return (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebaseinstallations.googleapis.com') ||
    url.hostname.endsWith('.firebaseio.com')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // yazma istekleri (Firestore vb.) her zaman doğrudan ağa gider

  const url = new URL(req.url);
  if (isLiveServiceRequest(url)) return; // dokunma — doğrudan ağa

  // Sayfa navigasyonu (index.html açılışı): ÖNCE ağ, olmazsa önbellek.
  // Böylece portal her zaman en güncel sürümü göstermeye çalışır; sadece
  // gerçekten çevrimdışıyken önbellekteki kabuğa düşer.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Uygulama kabuğu / Firebase SDK dosyaları: ÖNCE önbellek (hızlı,
  // nadiren değişir), olmazsa ağ (ve ağdan gelirse önbelleği güncelle).
  const isShellAsset = APP_SHELL.some((asset) => req.url.endsWith(asset.replace('./', '')));
  if (isShellAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        });
      })
    );
    return;
  }

  // Geri kalan her şey (varsa harici kaynaklar): normal ağ isteği,
  // önbelleğe yazılmaz — gereksiz önbellek büyümesini engeller.
});
