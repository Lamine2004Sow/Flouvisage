/** Validation des fichiers déposés : type MIME, extension et taille. */

export const LIMITS = {
  image: 100 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024,
};

const TYPES = {
  image: {
    extensions: ['jpg', 'jpeg', 'png', 'webp'],
    mimes: ['image/jpeg', 'image/pjpeg', 'image/png', 'image/webp'],
  },
  video: {
    extensions: ['mp4', 'm4v', 'webm', 'mov'],
    mimes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'],
  },
};

export const ACCEPT_ATTRIBUTE = [
  ...TYPES.image.extensions.map((e) => `.${e}`),
  ...TYPES.image.mimes,
  ...TYPES.video.extensions.map((e) => `.${e}`),
  ...TYPES.video.mimes,
].join(',');

export class FileError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function formatSize(bytes) {
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0).replace('.', ',')} ${units[unit]}`;
}

/** Retourne 'image' ou 'video', ou lève une FileError explicite. */
export function validateFile(file) {
  if (!file) throw new FileError('empty', 'Aucun fichier sélectionné.');
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  const kind = Object.keys(TYPES).find((k) => TYPES[k].extensions.includes(extension));
  if (!kind) {
    throw new FileError(
      'unsupported',
      `Le format « .${extension || '?'} » n'est pas pris en charge. Formats acceptés : JPG, PNG, WebP, MP4, WebM.`,
    );
  }
  // Certains systèmes ne fournissent pas de type MIME : l'extension suffit alors.
  if (mime && !TYPES[kind].mimes.includes(mime)) {
    throw new FileError('mismatch', `Le contenu du fichier (${mime}) ne correspond pas à son extension « .${extension} ».`);
  }
  if (file.size === 0) throw new FileError('empty', 'Le fichier est vide.');
  if (file.size > LIMITS[kind]) {
    throw new FileError(
      'too-large',
      `Fichier trop volumineux (${formatSize(file.size)}). Taille maximale pour ${kind === 'image' ? 'une image' : 'une vidéo'} : ${formatSize(LIMITS[kind])}.`,
    );
  }
  return kind;
}

export { formatSize };
