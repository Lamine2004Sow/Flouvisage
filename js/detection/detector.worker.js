/**
 * Web Worker de détection : le modèle tourne hors du fil principal afin que
 * l'interface reste fluide pendant les longues analyses (vidéo notamment).
 * Il ne reçoit que des pixels déjà décodés et ne fait aucune requête réseau
 * en dehors du chargement initial du modèle (même origine).
 */
import { installPrivacyGuard } from '../privacy-guard.js';

installPrivacyGuard();

let core = null;

async function init({ baseUrl, backends }) {
  const { DetectorCore } = await import('./detector-core.js');
  core = new DetectorCore(baseUrl);
  const backend = await core.init(backends, (status) => postMessage({ type: 'status', status }));
  postMessage({ type: 'ready', backend });
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      await init(data);
    } catch (error) {
      postMessage({ type: 'init-error', code: error.code || 'no-backend', message: String(error.message || error) });
    }
    return;
  }

  if (data.type === 'detect') {
    const { id, source, tiles, minScore } = data;
    try {
      const faces = await core.detect(source, tiles, minScore);
      postMessage({ type: 'result', id, faces });
    } catch (error) {
      postMessage({ type: 'detect-error', id, message: String(error.message || error) });
    } finally {
      source?.close?.();
    }
  }
};

postMessage({ type: 'alive' });
