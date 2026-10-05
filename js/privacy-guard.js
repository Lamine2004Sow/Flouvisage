/**
 * Garde réseau : garantit côté code qu'aucune donnée ne quitte le navigateur.
 *
 * Seules les requêtes GET vers la même origine (fichiers JS, modèles IA, WASM)
 * sont autorisées. Tout envoi de corps (POST, PUT…), toute requête vers un
 * autre domaine, WebSocket, EventSource et sendBeacon sont bloqués.
 * Les URL blob: et data: sont locales et restent autorisées en lecture.
 *
 * Ce module fonctionne dans la page et dans les Web Workers.
 * Il complète la Content-Security-Policy (connect-src 'self').
 */

const scope = globalThis;
const blocked = [];

function origin() {
  return scope.location?.origin ?? '';
}

function isLocalUrl(raw) {
  try {
    const url = new URL(String(raw), scope.location?.href);
    if (url.protocol === 'blob:' || url.protocol === 'data:') return true;
    return url.origin === origin();
  } catch {
    return false;
  }
}

function deny(kind, target) {
  const message = `Requête réseau bloquée (${kind}) : ${target}`;
  blocked.push({ kind, target: String(target), at: Date.now() });
  console.warn(`[confidentialité] ${message}`);
  return new Error(message);
}

export function installPrivacyGuard() {
  if (scope.__privacyGuardInstalled) return;
  scope.__privacyGuardInstalled = true;

  if (typeof scope.fetch === 'function') {
    const nativeFetch = scope.fetch.bind(scope);
    scope.fetch = (input, init = {}) => {
      const url = typeof input === 'string' || input instanceof URL ? input : input?.url;
      const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return Promise.reject(deny(`fetch ${method}`, url));
      if (init.body != null) return Promise.reject(deny('fetch avec contenu', url));
      if (!isLocalUrl(url)) return Promise.reject(deny('fetch externe', url));
      return nativeFetch(input, init);
    };
  }

  if (typeof scope.XMLHttpRequest === 'function') {
    const proto = scope.XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    proto.open = function open(method, url, ...rest) {
      const m = String(method).toUpperCase();
      if ((m !== 'GET' && m !== 'HEAD') || !isLocalUrl(url)) throw deny(`XHR ${m}`, url);
      return nativeOpen.call(this, method, url, ...rest);
    };
    proto.send = function send(body) {
      if (body != null) throw deny('XHR avec contenu', '');
      return nativeSend.call(this);
    };
  }

  for (const name of ['WebSocket', 'EventSource', 'WebTransport', 'RTCPeerConnection']) {
    if (typeof scope[name] === 'function') {
      scope[name] = function Blocked(target) {
        throw deny(name, target ?? '');
      };
    }
  }

  if (scope.navigator && typeof scope.navigator.sendBeacon === 'function') {
    try {
      Object.defineProperty(scope.navigator, 'sendBeacon', {
        configurable: true,
        value: (url) => {
          deny('sendBeacon', url);
          return false;
        },
      });
    } catch {
      /* propriété non modifiable : la CSP reste active */
    }
  }
}

export function blockedRequests() {
  return blocked.slice();
}
