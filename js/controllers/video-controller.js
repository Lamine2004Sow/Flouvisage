/** Contrôleur vidéo : analyse, aperçu anonymisé en lecture, zones fixes et export. */
import { VideoSession } from '../video/video-processor.js';
import { createVideo, releaseVideo, formatTime } from '../video/video-utils.js';
import { exportVideo, videoExportSupport } from '../video/video-exporter.js';
import { downloadBlob, outputName } from '../export.js';
import { setStatus, STATUS, progress } from '../ui/feedback.js';
import { ensureModel, readyStatus, plural } from './shared.js';

const PREVIEW_MAX_SIDE = 1280;
const $ = (id) => document.getElementById(id);

export class VideoController {
  kind = 'video';

  constructor(view) {
    this.view = view;
    this.session = null;
    this.preview = null;
    this.job = null;
    this.frameHandle = null;
    this.listeners = new AbortController();
    this.analyzing = false;
  }

  async load(file) {
    this.file = file;
    setStatus(STATUS.processing, '(lecture de la vidéo)');
    this.session = new VideoSession(file);
    await this.session.probe();
    const { width, height, duration } = this.session;
    this.view.setMeta(`Vidéo ${width} × ${height} px, ${formatTime(duration)}`);

    this.preview = await createVideo(this.session.url);
    this.preview.muted = false;
    const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(width, height));
    this.view.canvas.width = Math.round(width * scale);
    this.view.canvas.height = Math.round(height * scale);
    this.bindControls();
    this.render();
    await this.analyze();
  }

  bindControls() {
    const opts = { signal: this.listeners.signal };
    const video = this.preview;
    const seekInput = $('seek');
    $('play-toggle').addEventListener('click', () => this.togglePlay(), opts);
    seekInput.addEventListener('input', () => {
      video.currentTime = (Number(seekInput.value) / 1000) * this.session.duration;
    }, opts);
    video.addEventListener('play', () => this.onPlayState(true), opts);
    video.addEventListener('pause', () => this.onPlayState(false), opts);
    video.addEventListener('ended', () => this.onPlayState(false), opts);
    video.addEventListener('seeked', () => this.render(), opts);
    video.addEventListener('timeupdate', () => this.updateTime(), opts);
    this.updateTime();
  }

  togglePlay() {
    if (this.preview.paused) {
      if (this.preview.ended) this.preview.currentTime = 0;
      this.preview.play().catch(() => {
        this.preview.muted = true;
        this.preview.play().catch(() => {});
      });
    } else {
      this.preview.pause();
    }
  }

  onPlayState(playing) {
    $('video-controls').classList.toggle('is-playing', playing);
    $('play-toggle').setAttribute('aria-label', playing ? 'Mettre en pause' : 'Lire la vidéo');
    if (playing) {
      this.view.editor.select(null);
      this.view.editor.setZones([], this.view.canvas.width, this.view.canvas.height);
      this.loop();
    } else {
      this.render();
    }
  }

  loop() {
    const video = this.preview;
    if (!video || video.paused) return;
    const step = (_, meta) => {
      this.render(meta?.mediaTime);
      this.loop();
    };
    this.frameHandle = 'requestVideoFrameCallback' in video
      ? video.requestVideoFrameCallback(step)
      : requestAnimationFrame(() => step(0, null));
  }

  updateTime() {
    const { currentTime } = this.preview;
    const { duration } = this.session;
    $('time-label').textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
    const seekInput = $('seek');
    if (document.activeElement !== seekInput) seekInput.value = String(Math.round((currentTime / duration) * 1000));
    seekInput.setAttribute('aria-valuetext', `${formatTime(currentTime)} sur ${formatTime(duration)}`);
  }

  async analyze() {
    await ensureModel();
    const settings = this.view.getSettings();
    this.job = new AbortController();
    this.analyzing = true;
    this.view.setBusy(true);
    this.updateCount();
    setStatus(STATUS.analyzing);
    progress.start('Analyse de la vidéo', 'Les visages sont recherchés image par image. Vous pourrez ensuite prévisualiser puis exporter.');
    try {
      await this.session.analyze({
        performance: settings.performance,
        rate: settings.rate,
        signal: this.job.signal,
        onProgress: (p) => progress.update({ ratio: p.done / p.total, time: p.time, duration: p.duration, faces: p.faces }),
      });
      this.session.updateTracks(settings.threshold);
      readyStatus();
    } catch (error) {
      if (error.name === 'AbortError') setStatus(STATUS.modelReady, '(analyse annulée)');
      else throw error;
    } finally {
      this.analyzing = false;
      this.job = null;
      progress.end();
      this.view.setBusy(false);
      this.refreshReanalyze();
      this.render();
    }
  }

  rerunDetection() {
    return this.analyze();
  }

  refreshReanalyze() {
    const s = this.view.getSettings();
    $('reanalyze').hidden = !this.session || (this.session.analyzed && !this.session.needsAnalysis(s.performance, s.rate));
  }

  render(mediaTime) {
    if (!this.preview || !this.session) return;
    const settings = this.view.getSettings();
    const ctx = this.view.canvas.getContext('2d');
    const t = mediaTime ?? this.preview.currentTime;
    const zones = this.session.renderFrame(ctx, this.preview, t, settings, settings, this.view.currentView() === 'original');
    if (this.preview.paused) {
      this.view.editor.setZones(
        zones.map((z) => ({ ...z, editable: z.origin === 'manual' })),
        this.view.canvas.width,
        this.view.canvas.height,
      );
    }
    this.updateCount();
  }

  updateCount() {
    if (this.analyzing) {
      this.view.setCount('Analyse de la vidéo en cours…');
      return;
    }
    if (!this.session?.analyzed) {
      this.view.setCount('Vidéo non analysée. Lancez l’analyse pour détecter les visages.');
      return;
    }
    const tracks = this.session.activeTracks().length;
    const fixed = this.session.staticZones.length;
    if (!tracks && !fixed) {
      this.view.setCount('Aucun visage détecté. Baissez le seuil, augmentez la fréquence ou ajoutez une zone fixe.');
      return;
    }
    const peak = this.session.peakFaces();
    const parts = [tracks ? `Jusqu’à ${plural(peak, 'visage', 'visages')} à la fois (${plural(tracks, 'piste suivie', 'pistes suivies')})` : 'Aucun visage détecté'];
    if (fixed) parts.push(plural(fixed, 'zone fixe', 'zones fixes'));
    this.view.setCount(parts.join(' et '));
  }

  onSettingsChange(name) {
    if (name === 'threshold') this.session?.updateTracks(this.view.getSettings().threshold);
    if (name === 'performance' || name === 'rate') this.refreshReanalyze();
    if (this.preview?.paused) this.render();
  }

  /** Zone fixe appliquée sur toute la durée de la vidéo. */
  addZone() {
    this.preview.pause();
    const { width, height } = this.session;
    const side = Math.min(width, height) * 0.2;
    const id = this.session.addStaticZone({ x: (width - side) / 2, y: (height - side) / 2, w: side, h: side * 1.2 });
    this.render();
    return id;
  }

  toSource(box) {
    const sx = this.session.width / this.view.canvas.width;
    const sy = this.session.height / this.view.canvas.height;
    return { x: box.x * sx, y: box.y * sy, w: box.w * sx, h: box.h * sy };
  }

  updateZone(id, box) {
    this.session.updateZone(id, this.toSource(box));
    this.render();
    return id;
  }

  removeZone(id) {
    this.session.removeZone(id);
    this.render();
  }

  canExport() {
    return Boolean(this.session?.analyzed) && !this.analyzing && videoExportSupport().ok;
  }

  async export({ format, quality, maxSide }) {
    this.preview.pause();
    const settings = { ...this.view.getSettings() };
    this.job = new AbortController();
    this.view.setBusy(true);
    setStatus(STATUS.exporting);
    progress.start('Export de la vidéo', 'L’export se fait en temps réel : il dure aussi longtemps que la vidéo. Gardez cet onglet ouvert et visible.');
    const hiddenWarning = () => {
      if (document.hidden) $('progress-hint').textContent = 'Onglet masqué : le navigateur peut ralentir ou suspendre l’export. Revenez sur cet onglet.';
    };
    document.addEventListener('visibilitychange', hiddenWarning);
    try {
      const result = await exportVideo({
        session: this.session,
        format,
        quality,
        maxSide,
        signal: this.job.signal,
        render: (ctx, video, t) => this.session.renderFrame(ctx, video, t, settings, settings),
        onProgress: ({ time, duration }) => progress.update({ ratio: time / duration, time, duration }),
      });
      downloadBlob(result.blob, outputName(this.file.name, result.ext));
      readyStatus(result.audio ? '' : ' — vidéo exportée sans son');
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        setStatus(STATUS.modelReady, '(export annulé)');
        return null;
      }
      throw error;
    } finally {
      document.removeEventListener('visibilitychange', hiddenWarning);
      this.job = null;
      progress.end();
      this.view.setBusy(false);
    }
  }

  cancel() {
    this.job?.abort();
  }

  dispose() {
    this.cancel();
    this.listeners.abort();
    if (this.frameHandle != null && this.preview) {
      if ('cancelVideoFrameCallback' in this.preview) this.preview.cancelVideoFrameCallback(this.frameHandle);
      cancelAnimationFrame(this.frameHandle);
    }
    releaseVideo(this.preview);
    this.preview = null;
    this.session?.dispose();
    this.session = null;
    $('video-controls').classList.remove('is-playing');
  }
}
