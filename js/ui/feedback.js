/** Retours visuels : état du traitement, messages d'erreur et progression. */
import { formatTime } from '../video/video-utils.js';

const $ = (id) => document.getElementById(id);

export const STATUS = {
  idle: { state: 'idle', text: "En attente d'un fichier" },
  loadingModel: { state: 'busy', text: 'Chargement du modèle…' },
  modelReady: { state: 'ready', text: 'Modèle prêt' },
  analyzing: { state: 'busy', text: 'Analyse…' },
  processing: { state: 'busy', text: 'Traitement…' },
  exporting: { state: 'busy', text: 'Export…' },
  error: { state: 'error', text: 'Erreur' },
};

export function setStatus(status, detail = '') {
  const el = $('status');
  el.dataset.state = status.state;
  $('status-text').textContent = detail ? `${status.text} ${detail}` : status.text;
}

/** Affiche un message compréhensible, avec le détail technique repliable. */
export function showAlert(message, technical = '') {
  $('alert-message').textContent = message;
  $('alert-technical').textContent = technical;
  $('alert-details').hidden = !technical;
  const alert = $('alert');
  alert.hidden = false;
  alert.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function hideAlert() {
  $('alert').hidden = true;
}

export const progress = {
  start(title, hint = '') {
    $('progress-title').textContent = title;
    $('progress-hint').textContent = hint;
    $('progress-hint').hidden = !hint;
    $('progress-bar').value = 0;
    $('progress-bar').removeAttribute('aria-valuetext');
    $('progress-time').textContent = '0:00';
    $('progress-faces').textContent = '0';
    $('progress-box').hidden = false;
  },
  update({ ratio, time, duration, faces }) {
    const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100);
    const bar = $('progress-bar');
    bar.value = pct;
    bar.setAttribute('aria-valuetext', `${pct} %, ${formatTime(time)} sur ${formatTime(duration)}`);
    $('progress-time').textContent = `${formatTime(time)} / ${formatTime(duration)}`;
    if (faces != null) $('progress-faces').textContent = `≈ ${faces}`;
  },
  end() {
    $('progress-box').hidden = true;
  },
};
