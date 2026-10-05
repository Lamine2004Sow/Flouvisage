/**
 * Service Worker : met en cache uniquement les fichiers statiques de
 * l'application et le modèle IA, pour permettre l'utilisation hors ligne.
 *
 * Les photos et vidéos de l'utilisateur ne passent jamais par ici : elles
 * sont lues localement (File / blob:) et ne font l'objet d'aucune requête.
 * Par sécurité, seules les requêtes GET de même origine vers une liste de
 * dossiers statiques connus sont mises en cache.
 */
const VERSION = 'flouvisage-v1';

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'assets/icon.svg',
  'assets/icon-192.png',
  'assets/fonts/bricolage-grotesque.woff2',
  'js/app.js',
  'js/unsupported.js',
  'js/privacy-guard.js',
  'js/capabilities.js',
  'js/geometry.js',
  'js/zones.js',
  'js/file-validation.js',
  'js/anonymizer.js',
  'js/image-processor.js',
  'js/export.js',
  'js/detection/detector.js',
  'js/detection/detector-core.js',
  'js/detection/detector.worker.js',
  'js/detection/tiling.js',
  'js/video/video-processor.js',
  'js/video/video-exporter.js',
  'js/video/video-utils.js',
  'js/video/tracker.js',
  'js/video/webm-duration.js',
  'js/controllers/shared.js',
  'js/controllers/image-controller.js',
  'js/controllers/video-controller.js',
  'js/ui/feedback.js',
  'js/ui/settings-panel.js',
  'js/ui/zone-editor.js',
  'vendor/human/human.esm.js',
  'models/blazeface.json',
  'models/blazeface.bin',
];

// Fichiers statiques chargés à la demande (ex. WebAssembly) : mis en cache au premier usage.
const RUNTIME_PREFIXES = ['vendor/', 'models/', 'assets/', 'js/', 'css/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return false;
  const path = url.pathname.slice(scope.pathname.length);
  return path === '' || PRECACHE.includes(path) || RUNTIME_PREFIXES.some((prefix) => path.startsWith(prefix));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isCacheable(url)) return;

  // Navigation : réseau d'abord (mises à jour), cache si hors ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok) caches.open(VERSION).then((cache) => cache.put('index.html', copy));
          return response;
        })
        .catch(() => caches.match('index.html')),
    );
    return;
  }

  // Ressources statiques : cache d'abord, puis réseau avec mise en cache.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
