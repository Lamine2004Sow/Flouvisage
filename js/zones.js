/**
 * Modèle des zones à anonymiser pour une image (ou un plan fixe de vidéo).
 *
 * - Les détections automatiques sont gardées brutes (sans marge) avec leur
 *   score : changer le seuil ou la marge ne nécessite pas de relancer l'IA.
 * - Une zone automatique modifiée à la main devient une zone manuelle dont le
 *   rectangle est exactement celui affiché (marge comprise).
 */
import { expandFaceBox } from './geometry.js';

let counter = 0;
export const newId = (prefix) => `${prefix}${++counter}`;

export class ZoneSet {
  constructor() {
    this.reset();
  }

  reset() {
    this.detected = [];
    this.removed = new Set();
    this.manual = [];
  }

  setDetected(boxes) {
    this.detected = boxes.map((b) => ({ ...b, id: newId('auto') }));
    this.removed.clear();
  }

  /** Zones actives, dans le repère de l'image, avec la marge appliquée. */
  zones({ threshold, margin }) {
    const auto = this.detected
      .filter((d) => d.score >= threshold && !this.removed.has(d.id))
      .map((d) => ({ ...expandFaceBox(d, margin), id: d.id, origin: 'auto', score: d.score }));
    const manual = this.manual.map((m) => ({ ...m, origin: 'manual' }));
    return [...auto, ...manual];
  }

  counts(settings) {
    const zones = this.zones(settings);
    return {
      auto: zones.filter((z) => z.origin === 'auto').length,
      manual: zones.filter((z) => z.origin === 'manual').length,
    };
  }

  addManual(box) {
    const zone = { id: newId('manual'), x: box.x, y: box.y, w: box.w, h: box.h };
    this.manual.push(zone);
    return zone.id;
  }

  /** Met à jour une zone ; une zone automatique est convertie en zone manuelle. */
  update(id, box) {
    const manual = this.manual.find((m) => m.id === id);
    if (manual) {
      Object.assign(manual, box);
      return id;
    }
    this.removed.add(id);
    return this.addManual(box);
  }

  remove(id) {
    const index = this.manual.findIndex((m) => m.id === id);
    if (index >= 0) this.manual.splice(index, 1);
    else this.removed.add(id);
  }
}
