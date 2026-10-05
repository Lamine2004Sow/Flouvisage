/** Contrôleur image : chargement, détection, aperçu, retouches et export. */
import { loadImage, detectImage, renderImage } from '../image-processor.js';
import { encodeImage, downloadBlob, outputName, availableImageFormats } from '../export.js';
import { ZoneSet } from '../zones.js';
import { setStatus, STATUS } from '../ui/feedback.js';
import { ensureModel, readyStatus, plural } from './shared.js';

export class ImageController {
  kind = 'image';

  constructor(view) {
    this.view = view; // { canvas, editor, originalHost, getSettings, setCount, setMeta, showZones }
    this.original = null;
    this.zones = new ZoneSet();
    this.frame = 0;
    this.detecting = null;
  }

  async load(file) {
    this.file = file;
    setStatus(STATUS.processing, '(lecture de l’image)');
    const { canvas, width, height, scaled } = await loadImage(file);
    this.original = canvas;
    this.view.originalHost.replaceChildren(canvas);
    this.view.setMeta(`Image ${width} × ${height} px${scaled ? ' (réduite : mémoire du navigateur limitée)' : ''}`);
    this.render();
    await this.detect();
  }

  async detect() {
    const token = {};
    this.detecting = token;
    this.updateCount(this.view.getSettings());
    let faces;
    try {
      await ensureModel();
      setStatus(STATUS.analyzing);
      faces = await detectImage(this.original, this.view.getSettings().performance);
    } catch (error) {
      if (this.detecting === token) this.detecting = null;
      throw error;
    }
    if (this.detecting !== token || !this.original) return; // une détection plus récente a été lancée
    this.detecting = null;
    this.zones.setDetected(faces);
    this.render();
    readyStatus();
  }

  rerunDetection() {
    return this.detect();
  }

  scheduleRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  render() {
    if (!this.original) return;
    const settings = this.view.getSettings();
    const zones = this.zones.zones(settings);
    renderImage(this.view.canvas, this.original, zones, settings);
    this.view.editor.setZones(zones, this.original.width, this.original.height);
    this.updateCount(settings);
  }

  updateCount(settings) {
    if (this.detecting) {
      this.view.setCount('Recherche des visages…');
      return;
    }
    const { auto, manual } = this.zones.counts(settings);
    if (!auto && !manual) {
      this.view.setCount('Aucun visage détecté. Baissez le seuil, essayez le mode « Précis » ou ajoutez une zone à la main.');
      return;
    }
    const parts = [plural(auto, 'visage détecté', 'visages détectés')];
    if (manual) parts.push(plural(manual, 'zone manuelle', 'zones manuelles'));
    this.view.setCount(parts.join(' et '));
  }

  onSettingsChange(name) {
    if (name === 'performance') {
      this.detect().catch((error) => this.view.onError(error));
      return;
    }
    this.scheduleRender();
  }

  /** Ajoute une zone au centre de l'image ; l'utilisateur la place ensuite. */
  addZone() {
    const side = Math.min(this.original.width, this.original.height) * 0.2;
    const id = this.zones.addManual({
      x: (this.original.width - side) / 2,
      y: (this.original.height - side) / 2,
      w: side,
      h: side * 1.2,
    });
    this.render();
    return id;
  }

  updateZone(id, box) {
    const newId = this.zones.update(id, box);
    this.scheduleRender();
    return newId;
  }

  removeZone(id) {
    this.zones.remove(id);
    this.render();
  }

  exportFormats() {
    return availableImageFormats();
  }

  defaultFormat(file = this.file) {
    const type = file?.type;
    if (type === 'image/png') return 'png';
    if (type === 'image/webp' && availableImageFormats().some((f) => f.key === 'webp')) return 'webp';
    return 'jpeg';
  }

  async export({ format, quality }) {
    setStatus(STATUS.exporting);
    this.render();
    const blob = await encodeImage(this.view.canvas, format, quality);
    const ext = availableImageFormats().find((f) => f.key === format)?.ext ?? 'png';
    downloadBlob(blob, outputName(this.file.name, ext));
    readyStatus();
    return blob;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    if (this.original) {
      this.original.width = 0;
      this.original.height = 0;
    }
    this.original = null;
    this.view.originalHost.replaceChildren();
    this.zones.reset();
  }
}
