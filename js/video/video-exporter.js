/**
 * Export vidéo dans le navigateur : la vidéo est relue en temps réel, chaque
 * image est anonymisée sur un canvas, puis enregistrée par MediaRecorder via
 * canvas.captureStream(). L'audio d'origine est récupéré par Web Audio, sans
 * être joué sur les haut-parleurs. Rien n'est envoyé sur le réseau.
 */
import { getCapabilities } from '../capabilities.js';
import { createVideo, releaseVideo, seek, abortError, VideoError } from './video-utils.js';
import { fixWebmDuration } from './webm-duration.js';

export function videoExportSupport() {
  const caps = getCapabilities();
  if (!caps.mediaRecorder) return { ok: false, reason: "Ce navigateur ne prend pas en charge l'enregistrement vidéo (MediaRecorder)." };
  if (!caps.captureStream) return { ok: false, reason: "Ce navigateur ne permet pas de capturer un canvas (captureStream)." };
  if (!caps.recorderTypes.length) return { ok: false, reason: "Aucun format vidéo d'export (MP4 ou WebM) n'est pris en charge par ce navigateur." };
  return { ok: true, formats: caps.recorderTypes };
}

function outputSize(width, height, maxSide) {
  const scale = maxSide ? Math.min(1, maxSide / Math.max(width, height)) : 1;
  // Les encodeurs exigent des dimensions paires.
  const even = (v) => Math.max(2, Math.round((v * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

function connectAudio(video) {
  const caps = getCapabilities();
  if (!caps.audioContext) return null;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const context = new Ctx();
    const source = context.createMediaElementSource(video);
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    return { context, track: destination.stream.getAudioTracks()[0] };
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ blob: Blob, audio: boolean, ext: string }>}
 */
export async function exportVideo({ session, format, quality, maxSide, render, signal, onProgress }) {
  const video = await createVideo(session.url, { muted: false });
  const { width, height } = outputSize(video.videoWidth, video.videoHeight, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const audio = connectAudio(video);
  if (!audio) video.muted = true;
  await audio?.context.resume().catch(() => {});

  await seek(video, 0);
  render(ctx, video, 0);

  const stream = canvas.captureStream();
  if (audio?.track) stream.addTrack(audio.track);

  const bitsPerPixel = 0.06 + quality * 0.14; // qualité 0..1
  const recorder = new MediaRecorder(stream, {
    mimeType: format.mime,
    videoBitsPerSecond: Math.round(width * height * 30 * bitsPerPixel),
    audioBitsPerSecond: 128000,
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };

  let frameHandle = null;
  let finished = false;
  const duration = video.duration;

  const drawLoop = () => {
    if (finished) return;
    const draw = (_, meta) => {
      if (finished) return;
      const t = meta?.mediaTime ?? video.currentTime;
      render(ctx, video, t);
      onProgress?.({ time: t, duration });
      drawLoop();
    };
    frameHandle = 'requestVideoFrameCallback' in video ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(() => draw(0, null));
  };

  const cleanup = () => {
    finished = true;
    if (frameHandle != null) {
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(frameHandle);
      cancelAnimationFrame(frameHandle);
    }
    stream.getTracks().forEach((track) => track.stop());
    audio?.context.close().catch(() => {});
    releaseVideo(video);
    canvas.width = 0;
    canvas.height = 0;
  };

  const result = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (event) => reject(new VideoError('export', `Erreur d'encodage : ${event.error?.message ?? 'inconnue'}`));
    video.onended = () => {
      render(ctx, video, duration);
      setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 150);
    };
    video.onerror = () => reject(new VideoError('decode', 'La lecture de la vidéo a échoué pendant l’export.'));
    signal?.addEventListener('abort', () => {
      if (recorder.state !== 'inactive') recorder.stop();
      reject(abortError());
    });
  });

  try {
    recorder.start(1000);
    drawLoop();
    try {
      await video.play();
    } catch {
      // Lecture avec son refusée par le navigateur : on exporte sans audio.
      video.muted = true;
      await video.play();
    }
    await result;
  } catch (error) {
    cleanup();
    throw error;
  }
  const hadAudio = Boolean(audio?.track) && !video.muted;
  cleanup();

  let blob = new Blob(chunks, { type: format.mime.split(';')[0] });
  chunks.length = 0;
  if (!blob.size) throw new VideoError('export', "L'encodeur n'a produit aucune donnée.");
  if (format.ext === 'webm') blob = await fixWebmDuration(blob, duration);
  return { blob, audio: hadAudio, ext: format.ext, width, height };
}
