/**
 * Session vidéo : analyse (passe 1), construction des pistes, zones à un
 * instant donné et rendu d'une image anonymisée.
 *
 * Passe 1 — la vidéo est parcourue à la fréquence d'analyse choisie ; chaque
 * image analysée est réduite (selon le niveau de performance) avant la
 * détection. Les détections brutes sont conservées : changer le seuil ou la
 * marge reconstruit les pistes instantanément, sans relancer l'IA.
 */
import { detector } from '../detection/detector.js';
import { PERFORMANCE_PRESETS } from '../detection/tiling.js';
import { anonymize } from '../anonymizer.js';
import { expandFaceBox } from '../geometry.js';
import { newId } from '../zones.js';
import { buildTracks, boxAt, peakConcurrent } from './tracker.js';
import { createVideo, seek, releaseVideo, abortError } from './video-utils.js';

export class VideoSession {
  constructor(file) {
    this.file = file;
    this.url = URL.createObjectURL(file);
    this.width = 0;
    this.height = 0;
    this.duration = 0;
    this.samples = null;
    this.interval = 0.2;
    this.analysisKey = null;
    this.tracks = [];
    this.removedTracks = new Set();
    this.staticZones = [];
    this.trackKey = null;
  }

  /** Vérifie que la vidéo est décodable et lit ses dimensions. */
  async probe() {
    const video = await createVideo(this.url);
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    this.duration = video.duration;
    releaseVideo(video);
  }

  get analyzed() {
    return Boolean(this.samples);
  }

  /** Passe 1 : détection à intervalle régulier sur toute la vidéo. */
  async analyze({ performance, rate, signal, onProgress }) {
    const preset = PERFORMANCE_PRESETS[performance] ?? PERFORMANCE_PRESETS.balanced;
    const interval = 1 / rate;
    const video = await createVideo(this.url);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, preset.videoMaxSide / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: false });

    const duration = video.duration;
    const times = [];
    for (let t = 0; t < duration; t += interval) times.push(t);
    const last = Math.max(0, duration - 0.04);
    if (times.length === 0 || last - times[times.length - 1] > interval / 3) times.push(last);

    const samples = [];
    let peak = 0;
    try {
      for (let i = 0; i < times.length; i += 1) {
        if (signal?.aborted) throw abortError();
        await seek(video, times[i]);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const faces = await detector.detect(canvas, preset.videoLevels);
        const boxes = faces.map((f) => ({
          x: f.x * this.width,
          y: f.y * this.height,
          w: f.w * this.width,
          h: f.h * this.height,
          score: f.score,
        }));
        samples.push({ t: video.currentTime, boxes });
        peak = Math.max(peak, faces.filter((f) => f.score >= 0.5).length);
        onProgress?.({ done: i + 1, total: times.length, time: times[i], duration, faces: peak });
      }
    } finally {
      releaseVideo(video);
      canvas.width = 0;
      canvas.height = 0;
    }

    this.samples = samples;
    this.interval = interval;
    this.analysisKey = `${performance}|${rate}`;
    this.trackKey = null;
    this.removedTracks.clear();
  }

  needsAnalysis(performance, rate) {
    return this.analysisKey !== `${performance}|${rate}`;
  }

  /** Reconstruit les pistes si le seuil a changé. */
  updateTracks(threshold) {
    if (!this.samples || this.trackKey === threshold) return;
    this.tracks = buildTracks(this.samples, threshold, this.interval, { width: this.width, height: this.height });
    this.trackKey = threshold;
    this.peakCache = null;
    this.removedTracks.clear();
  }

  activeTracks() {
    return this.tracks.filter((t) => !this.removedTracks.has(t.id));
  }

  /** Nombre maximal de visages visibles simultanément. */
  peakFaces() {
    if (!this.samples) return 0;
    const key = `${this.trackKey}|${this.removedTracks.size}`;
    if (this.peakCache?.key !== key) this.peakCache = { key, value: peakConcurrent(this.activeTracks(), this.samples) };
    return this.peakCache.value;
  }

  /** Zones à l'instant t, dans le repère d'un canvas de sortie (outW × outH). */
  zonesAt(t, outW, outH, settings) {
    const sx = outW / this.width;
    const sy = outH / this.height;
    const hold = this.interval + 0.15;
    const zones = [];
    for (const track of this.activeTracks()) {
      const box = boxAt(track, t, hold, this);
      if (!box) continue;
      const e = expandFaceBox(box, settings.margin);
      zones.push({ id: track.id, x: e.x * sx, y: e.y * sy, w: e.w * sx, h: e.h * sy, origin: 'auto' });
    }
    for (const z of this.staticZones) {
      zones.push({ id: z.id, x: z.x * sx, y: z.y * sy, w: z.w * sx, h: z.h * sy, origin: 'manual' });
    }
    return zones;
  }

  renderFrame(ctx, video, t, settings, effect, showOriginal = false) {
    const { width, height } = ctx.canvas;
    ctx.drawImage(video, 0, 0, width, height);
    if (showOriginal) return [];
    const zones = this.zonesAt(t, width, height, settings);
    anonymize(ctx, zones, effect);
    return zones;
  }

  /** Zone fixe (toute la durée), en pixels source. */
  addStaticZone(box) {
    const zone = { id: newId('static'), ...box };
    this.staticZones.push(zone);
    return zone.id;
  }

  updateZone(id, box) {
    const zone = this.staticZones.find((z) => z.id === id);
    if (zone) Object.assign(zone, box);
  }

  removeZone(id) {
    const index = this.staticZones.findIndex((z) => z.id === id);
    if (index >= 0) this.staticZones.splice(index, 1);
    else this.removedTracks.add(id);
  }

  dispose() {
    URL.revokeObjectURL(this.url);
    this.samples = null;
    this.tracks = [];
  }
}
