/**
 * Traitement des images : décodage, détection à résolution réduite avec
 * remappage vers la pleine résolution, et rendu du résultat.
 */
import { detector } from './detection/detector.js';
import { PERFORMANCE_PRESETS } from './detection/tiling.js';
import { anonymize } from './anonymizer.js';
import { FileError } from './file-validation.js';

const MAX_PIXELS = 100e6;

/** Vérifie que le navigateur peut réellement allouer un canvas de cette taille (limite iOS ≈ 16,7 Mpx). */
function canvasFits(width, height) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const ok = ctx.getImageData(width - 1, height - 1, 1, 1).data[3] === 255;
    canvas.width = 0;
    canvas.height = 0;
    return ok;
  } catch {
    return false;
  }
}

function decodeImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  return img
    .decode()
    .then(() => img)
    .catch(() => {
      throw new FileError('decode', "Impossible de décoder cette image. Le fichier est peut-être corrompu ou dans un format non pris en charge par votre navigateur.");
    })
    .finally(() => URL.revokeObjectURL(url));
}

/** Charge l'image dans un canvas (orientation EXIF appliquée par le navigateur). */
export async function loadImage(file) {
  const img = await decodeImage(file);
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (!width || !height) throw new FileError('decode', "L'image semble vide ou illisible.");
  if (width * height > MAX_PIXELS) {
    throw new FileError('too-large', `Image trop grande (${width} × ${height} px). Maximum : 100 mégapixels.`);
  }

  let scaled = false;
  while (!canvasFits(width, height)) {
    width = Math.floor(width * 0.85);
    height = Math.floor(height * 0.85);
    scaled = true;
    if (width < 256) throw new FileError('decode', "Votre navigateur n'a pas assez de mémoire pour afficher cette image.");
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  img.src = '';
  return { canvas, width, height, scaled };
}

/** Détection sur une copie réduite puis remappage des boîtes sur l'image d'origine. */
export async function detectImage(original, performance) {
  const preset = PERFORMANCE_PRESETS[performance] ?? PERFORMANCE_PRESETS.balanced;
  const scale = Math.min(1, preset.imageMaxSide / Math.max(original.width, original.height));
  const work = document.createElement('canvas');
  work.width = Math.max(1, Math.round(original.width * scale));
  work.height = Math.max(1, Math.round(original.height * scale));
  const ctx = work.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(original, 0, 0, work.width, work.height);
  try {
    const faces = await detector.detect(work, preset.imageLevels);
    return faces.map((f) => ({
      x: f.x * original.width,
      y: f.y * original.height,
      w: f.w * original.width,
      h: f.h * original.height,
      score: f.score,
    }));
  } finally {
    work.width = 0;
    work.height = 0;
  }
}

/** Dessine l'image d'origine puis applique l'effet sur chaque zone. */
export function renderImage(target, original, zones, effect) {
  if (target.width !== original.width || target.height !== original.height) {
    target.width = original.width;
    target.height = original.height;
  }
  const ctx = target.getContext('2d');
  ctx.drawImage(original, 0, 0);
  anonymize(ctx, zones, effect);
}
