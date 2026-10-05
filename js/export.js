/** Export des résultats : encodage d'image et téléchargement local. */
import { getCapabilities } from './capabilities.js';

export const IMAGE_FORMATS = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG (sans perte)', lossy: false },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPEG', lossy: true },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true },
};

export function availableImageFormats() {
  return Object.entries(IMAGE_FORMATS)
    .filter(([key]) => key !== 'webp' || getCapabilities().webp)
    .map(([key, value]) => ({ key, ...value }));
}

export class ExportError extends Error {
  code = 'export';
}

/**
 * Encode le canvas. L'export repart des pixels : les métadonnées EXIF
 * (dont la position GPS) de l'original ne sont pas conservées.
 */
export function encodeImage(canvas, formatKey, quality) {
  const format = IMAGE_FORMATS[formatKey] ?? IMAGE_FORMATS.png;
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new ExportError("Le navigateur n'a pas pu encoder l'image (mémoire insuffisante ?)."));
          else if (blob.type !== format.mime) reject(new ExportError(`Le format ${format.label} n'est pas pris en charge par ce navigateur.`));
          else resolve(blob);
        },
        format.mime,
        format.lossy ? quality : undefined,
      );
    } catch (error) {
      reject(new ExportError(`Export impossible : ${error.message}`));
    }
  });
}

export function outputName(originalName, ext) {
  const base = (originalName || 'fichier').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 80);
  return `${base || 'fichier'}_anonymise.${ext}`;
}

/** Déclenche le téléchargement d'un Blob généré localement (aucun envoi réseau). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Laisse au navigateur le temps de démarrer le téléchargement avant de libérer.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
