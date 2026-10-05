/**
 * Point d'entrée : thème, dépôt de fichier, aiguillage image / vidéo,
 * vues de l'aperçu, retouches et export.
 */
import { installPrivacyGuard } from './privacy-guard.js';
import { getCapabilities } from './capabilities.js';
import { detector } from './detection/detector.js';
import { validateFile, ACCEPT_ATTRIBUTE, formatSize } from './file-validation.js';
import { releaseScratch } from './anonymizer.js';
import { videoExportSupport } from './video/video-exporter.js';
import { ZoneEditor } from './ui/zone-editor.js';
import { DEFAULT_SETTINGS, readSettings, writeSettings, bindSettings } from './ui/settings-panel.js';
import { setStatus, STATUS, showAlert, hideAlert } from './ui/feedback.js';
import { ImageController } from './controllers/image-controller.js';
import { VideoController } from './controllers/video-controller.js';
import { describeError, ensureModel } from './controllers/shared.js';
import { availableImageFormats } from './export.js';

installPrivacyGuard();

const $ = (id) => document.getElementById(id);
const caps = getCapabilities();

const state = {
  controller: null,
  view: 'result',
  busy: false,
  loadToken: 0,
};

/* ---------- Thème ---------- */

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.classList.toggle('is-dark', dark);
  $('theme-toggle').setAttribute('aria-label', dark ? 'Activer le thème clair' : 'Activer le thème sombre');
}

function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem('theme');
  } catch {
    /* stockage indisponible : thème du système */
  }
  applyTheme(saved);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!document.documentElement.dataset.theme) applyTheme(null);
  });
  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.classList.contains('is-dark') ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* ignoré */
    }
  });
}

/* ---------- Vue partagée par les contrôleurs ---------- */

const editor = new ZoneEditor($('zone-layer'), {
  onChange: (id, box) => state.controller?.updateZone(id, box),
  onRemove: (id) => state.controller?.removeZone(id),
  onSelect: (zone) => {
    $('delete-zone').disabled = !zone;
  },
});

const view = {
  canvas: $('result-canvas'),
  originalHost: $('compare-original'),
  editor,
  getSettings: readSettings,
  currentView: () => state.view,
  setCount: (text) => {
    $('face-count').textContent = text;
  },
  setMeta: (text) => {
    $('file-meta').textContent = text;
  },
  setBusy: (busy) => {
    state.busy = busy;
    updateActions();
  },
  onError: (error) => reportError(error),
};

function reportError(error) {
  const described = describeError(error);
  if (!described) return;
  console.error(error);
  setStatus(STATUS.error);
  showAlert(described.message, described.technical);
  updateActions();
}

/* ---------- Chargement d'un fichier ---------- */

function resetWorkspace() {
  state.controller?.dispose();
  state.controller = null;
  releaseScratch();
  editor.setZones([], 1, 1);
  editor.select(null);
  const canvas = $('result-canvas');
  canvas.width = 0;
  canvas.height = 0;
}

async function openFile(file) {
  hideAlert();
  let kind;
  try {
    kind = validateFile(file);
  } catch (error) {
    reportError(error);
    return;
  }

  const token = ++state.loadToken;
  resetWorkspace();
  document.body.classList.add('has-file');
  $('workspace').hidden = false;
  $('file-name').textContent = file.name;
  $('file-meta').textContent = formatSize(file.size);
  configureForKind(kind);
  setView('result');

  const controller = kind === 'image' ? new ImageController(view) : new VideoController(view);
  state.controller = controller;
  if (kind === 'image') {
    $('image-format').value = controller.defaultFormat(file);
    updateQualityField();
  }
  updateActions();
  try {
    await controller.load(file);
  } catch (error) {
    if (token !== state.loadToken) return;
    // Fichier illisible : retour à l'écran de dépôt. Une erreur après le
    // chargement (ex. modèle) laisse l'aperçu affiché.
    if (!controller.original && !controller.preview) {
      resetWorkspace();
      document.body.classList.remove('has-file');
      $('workspace').hidden = true;
    }
    reportError(error);
  }
  if (token === state.loadToken) updateActions();
}

function configureForKind(kind) {
  for (const el of document.querySelectorAll('[data-for-kind]')) el.hidden = el.dataset.forKind !== kind;
  $('video-controls').hidden = kind !== 'video';
  $('view-compare').hidden = kind !== 'image';
  $('reanalyze').hidden = true;
  $('add-zone').textContent = kind === 'video' ? 'Ajouter une zone fixe' : 'Ajouter une zone';
  $('zone-hint').textContent =
    kind === 'video'
      ? 'Mettez la vidéo en pause pour voir les zones. Une zone fixe couvre la même région pendant toute la vidéo ; un visage suivi peut être supprimé. Clavier : flèches pour déplacer, Maj + flèches pour redimensionner, Suppr pour supprimer.'
      : 'Glissez une zone pour la déplacer, ses coins pour la redimensionner. Clavier : flèches pour déplacer, Maj + flèches pour redimensionner, Suppr pour supprimer.';
  fillExportFormats(kind);
}

/* ---------- Vues : résultat, original, avant / après ---------- */

function setView(name) {
  state.view = name;
  for (const button of document.querySelectorAll('.view-switch [data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === name));
  }
  const isImage = state.controller?.kind !== 'video';
  const host = $('compare-original');
  host.hidden = !isImage || name === 'result';
  $('compare-range').hidden = !isImage || name !== 'compare';
  $('compare-line').hidden = !isImage || name !== 'compare';
  updateCompare();
  editor.setVisible($('show-zones').checked && name === 'result');
  if (!isImage) state.controller?.render();
}

function updateCompare() {
  const value = Number($('compare-range').value);
  const host = $('compare-original');
  // L'original est visible à gauche du curseur, le résultat à droite.
  host.style.clipPath = state.view === 'compare' ? `inset(0 ${100 - value}% 0 0)` : 'none';
  $('compare-line').style.left = `${value}%`;
}

/* ---------- Actions ---------- */

function updateActions() {
  const c = state.controller;
  const ready = Boolean(c) && !state.busy;
  $('auto-blur').disabled = !ready;
  $('add-zone').disabled = !ready;
  $('reanalyze').disabled = !ready;
  $('settings').querySelectorAll('input, select').forEach((el) => {
    el.disabled = state.busy && c?.kind === 'video';
  });

  const exportButton = $('export-button');
  const hint = $('export-hint');
  hint.textContent = '';
  if (!c) {
    exportButton.disabled = true;
    return;
  }
  if (c.kind === 'image') {
    exportButton.textContent = "Exporter l'image";
    exportButton.disabled = !ready || !c.original;
    return;
  }
  exportButton.textContent = 'Exporter la vidéo';
  const support = videoExportSupport();
  if (!support.ok) {
    hint.textContent = `${support.reason} L'aperçu reste disponible.`;
    exportButton.disabled = true;
    return;
  }
  exportButton.disabled = !ready || !c.canExport();
  if (!c.session?.analyzed && !state.busy) hint.textContent = "Analysez d'abord la vidéo pour pouvoir l'exporter.";
  else if (!c.session?.analyzed) hint.textContent = "L'export sera disponible à la fin de l'analyse.";
  else hint.textContent = 'Son d’origine conservé lorsque le navigateur le permet.';
}

function fillExportFormats(kind) {
  if (kind === 'image') {
    const select = $('image-format');
    select.replaceChildren(...availableImageFormats().map((f) => new Option(f.label, f.key)));
    if (!caps.webp) $('export-hint').textContent = "Le WebP n'est pas proposé : ce navigateur ne sait pas l'encoder.";
    return;
  }
  const support = videoExportSupport();
  const select = $('video-format');
  select.replaceChildren(...(support.formats ?? []).map((f, i) => new Option(f.label, String(i))));
  select.disabled = !support.ok;
}

function updateQualityField() {
  const c = state.controller;
  const format = $('image-format').value;
  $('quality-field').hidden = c?.kind === 'image' && format === 'png';
  $('quality-value').textContent = `${$('quality').value} %`;
}

async function runExport() {
  const c = state.controller;
  if (!c || state.busy) return;
  hideAlert();
  const quality = Number($('quality').value) / 100;
  try {
    if (c.kind === 'image') {
      state.busy = true;
      updateActions();
      await c.export({ format: $('image-format').value, quality });
    } else {
      const formats = videoExportSupport().formats;
      const format = formats[Number($('video-format').value)] ?? formats[0];
      await c.export({ format, quality, maxSide: Number($('video-size').value) });
    }
  } catch (error) {
    reportError(error);
  } finally {
    state.busy = false;
    updateActions();
  }
}

async function rerunDetection() {
  const c = state.controller;
  if (!c || state.busy) return;
  hideAlert();
  try {
    await c.rerunDetection();
  } catch (error) {
    reportError(error);
  }
  updateActions();
}

/* « Détecter et flouter tous les visages » : réglages par défaut puis détection complète. */
async function autoBlurAll() {
  const c = state.controller;
  if (!c || state.busy) return;
  writeSettings(DEFAULT_SETTINGS);
  $('show-zones').checked = false;
  setView('result');
  await rerunDetection();
}

/* ---------- Liaisons ---------- */

function bindDropzone() {
  const input = $('file-input');
  input.accept = ACCEPT_ATTRIBUTE;
  const pick = () => {
    detector.load().catch(() => {}); // préchargement du modèle pendant le choix du fichier
    input.click();
  };
  $('pick-file').addEventListener('click', pick);
  $('change-file').addEventListener('click', pick);
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) openFile(file);
  });

  const zone = $('dropzone');
  let depth = 0;
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    depth += 1;
    zone.classList.add('is-dragging');
    detector.load().catch(() => {});
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('is-dragging');
  });
  document.addEventListener('dragover', (event) => {
    if (hasFiles(event)) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth = 0;
    zone.classList.remove('is-dragging');
    const file = event.dataTransfer.files?.[0];
    if (state.busy) {
      showAlert('Un traitement est en cours. Annulez-le ou attendez la fin avant de déposer un autre fichier.');
      return;
    }
    if (file) openFile(file);
  });
}

function bindWorkspace() {
  for (const button of document.querySelectorAll('.view-switch [data-view]')) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
  $('compare-range').addEventListener('input', updateCompare);

  $('show-zones').addEventListener('change', () => {
    if ($('show-zones').checked && state.view !== 'result') setView('result');
    editor.setVisible($('show-zones').checked && state.view === 'result');
    state.controller?.render();
  });

  $('add-zone').addEventListener('click', () => {
    const c = state.controller;
    if (!c || state.busy) return;
    $('show-zones').checked = true;
    if (state.view !== 'result') setView('result');
    editor.setVisible(true);
    const id = c.addZone();
    editor.select(id);
    $('zone-layer').querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true });
  });

  $('delete-zone').addEventListener('click', () => editor.removeSelected());
  $('auto-blur').addEventListener('click', autoBlurAll);
  $('reanalyze').addEventListener('click', rerunDetection);
  $('reset-settings').addEventListener('click', () => {
    writeSettings(DEFAULT_SETTINGS);
    state.controller?.onSettingsChange('performance');
    state.controller?.onSettingsChange('threshold');
  });
  $('export-button').addEventListener('click', runExport);
  $('cancel-job').addEventListener('click', () => state.controller?.cancel?.());
  $('image-format').addEventListener('change', updateQualityField);
  $('quality').addEventListener('input', updateQualityField);
  $('alert-close').addEventListener('click', hideAlert);

  bindSettings((name) => state.controller?.onSettingsChange(name));
}

/* ---------- Hors ligne (PWA) ---------- */

function registerServiceWorker() {
  if (!caps.serviceWorker) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* l'application fonctionne sans mode hors ligne */
    });
  });
}

function reportMissingFeatures() {
  const missing = [];
  if (!document.createElement('canvas').getContext('2d')) missing.push('Canvas 2D');
  if (!caps.wasm && !caps.webgl) missing.push('WebGL ou WebAssembly');
  if (missing.length) {
    showAlert(`Votre navigateur ne prend pas en charge des fonctions indispensables (${missing.join(', ')}). Utilisez une version récente de Chrome, Edge, Firefox ou Safari.`);
    $('pick-file').disabled = true;
  }
}

function init() {
  initTheme();
  writeSettings(DEFAULT_SETTINGS);
  bindDropzone();
  bindWorkspace();
  updateQualityField();
  updateActions();
  setStatus(STATUS.idle);
  reportMissingFeatures();
  registerServiceWorker();
  // Exposé pour les tests de bout en bout et le débogage local.
  window.__flouvisage = { state, detector, ensureModel };
}

init();
