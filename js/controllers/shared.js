/** Éléments partagés par les contrôleurs image et vidéo. */
import { detector, BACKEND_LABELS } from '../detection/detector.js';
import { getCapabilities } from '../capabilities.js';
import { setStatus, STATUS } from '../ui/feedback.js';

/** Charge le modèle une fois (les fichiers suivants le réutilisent). */
export async function ensureModel() {
  if (!detector.ready) setStatus(STATUS.loadingModel);
  const { backend, mode } = await detector.load((detail) => {
    if (/Chargement/.test(detail)) setStatus(STATUS.loadingModel);
  });
  const info = document.getElementById('engine-info');
  const caps = getCapabilities();
  const notes = [];
  if (!caps.webgl) notes.push('WebGL indisponible');
  if (backend === 'cpu') notes.push('détection lente sur cet appareil');
  info.textContent = `Moteur de détection : ${BACKEND_LABELS[backend] ?? backend}${mode === 'worker' ? ' (Web Worker)' : ''}${notes.length ? ` (${notes.join(', ')})` : ''}.`;
  return backend;
}

export function readyStatus(extra = '') {
  setStatus(STATUS.modelReady, `(${BACKEND_LABELS[detector.backend] ?? detector.backend})${extra}`);
}

export function plural(n, singular, pluralForm) {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

/** Traduit une erreur en message clair pour l'utilisateur. Retourne null pour une annulation. */
export function describeError(error) {
  if (!error) return { message: 'Une erreur inconnue est survenue.' };
  if (error.name === 'AbortError') return null;
  const technical = String(error.stack || error.message || error);
  switch (error.code) {
    case 'model-load':
      return {
        message: "Le modèle de détection n'a pas pu être chargé. Lors de la première utilisation, une connexion est nécessaire pour le télécharger ; vérifiez-la puis réessayez.",
        technical,
      };
    case 'no-backend':
      return {
        message: "Votre navigateur ne peut pas exécuter le modèle de détection : WebGL, WebGPU et WebAssembly sont indisponibles ou bloqués. Essayez une version récente de Chrome, Edge, Firefox ou Safari.",
        technical,
      };
    case 'detect':
      return {
        message: "La détection a échoué, probablement par manque de mémoire graphique. Essayez le mode « Rapide » ou fermez d'autres onglets.",
        technical,
      };
    default:
      if (typeof error.code === 'string') return { message: error.message, technical: '' };
      return { message: "Une erreur inattendue est survenue pendant le traitement.", technical };
  }
}
