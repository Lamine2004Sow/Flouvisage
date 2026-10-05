/** Utilitaires communs aux éléments <video> utilisés hors affichage. */

export class VideoError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function abortError() {
  return new DOMException('Opération annulée', 'AbortError');
}

const DECODE_MESSAGE =
  "Impossible de lire cette vidéo. Le codec n'est peut-être pas pris en charge par votre navigateur (essayez un MP4 H.264 ou un WebM).";

function once(target, events, timeout) {
  return new Promise((resolve, reject) => {
    let timer;
    const handlers = {};
    const cleanup = () => {
      clearTimeout(timer);
      for (const [name, fn] of Object.entries(handlers)) target.removeEventListener(name, fn);
    };
    for (const name of events) {
      handlers[name] = (event) => {
        cleanup();
        if (name === 'error') reject(new VideoError('decode', DECODE_MESSAGE));
        else resolve(event);
      };
      target.addEventListener(name, handlers[name]);
    }
    if (timeout) {
      timer = setTimeout(() => {
        cleanup();
        reject(new VideoError('timeout', 'La vidéo ne répond pas (décodage trop lent ou fichier endommagé).'));
      }, timeout);
    }
  });
}

/** Crée un élément vidéo caché, prêt à être lu image par image. */
export async function createVideo(url, { muted = true } = {}) {
  const video = document.createElement('video');
  video.muted = muted;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-hidden', 'true');
  video.className = 'offscreen-video';
  document.body.append(video);
  video.src = url;
  try {
    await once(video, ['loadedmetadata', 'error'], 30000);
    if (!video.videoWidth || !video.videoHeight) throw new VideoError('decode', DECODE_MESSAGE);
    await fixDuration(video);
    if (video.readyState < 2) {
      // iOS ne charge les images qu'après un début de lecture.
      const loaded = once(video, ['loadeddata', 'error'], 30000);
      if (muted) video.play().then(() => video.pause()).catch(() => {});
      await loaded;
    }
  } catch (error) {
    releaseVideo(video);
    throw error;
  }
  return video;
}

/** Certains WebM n'annoncent pas leur durée : on la force en cherchant la fin du fichier. */
async function fixDuration(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) return;
  video.currentTime = 1e7;
  await once(video, ['seeked', 'error'], 30000);
  video.currentTime = 0;
  await once(video, ['seeked', 'error'], 30000);
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    throw new VideoError('decode', 'Durée de la vidéo introuvable : le fichier semble incomplet.');
  }
}

/** Positionne la vidéo à l'instant t et attend que l'image correspondante soit disponible. */
export async function seek(video, t) {
  if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return;
  const frameReady =
    'requestVideoFrameCallback' in video
      ? new Promise((resolve) => {
          video.requestVideoFrameCallback(() => resolve());
        })
      : null;
  video.currentTime = t;
  await once(video, ['seeked', 'error'], 15000);
  // Safari peut signaler « seeked » avant que l'image soit réellement décodée.
  if (frameReady) await Promise.race([frameReady, new Promise((r) => setTimeout(r, 120))]);
}

export function releaseVideo(video) {
  if (!video) return;
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
