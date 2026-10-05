/**
 * Éditeur de zones superposé à l'aperçu : sélection, déplacement,
 * redimensionnement et suppression, à la souris, au doigt ou au clavier.
 *
 * Les zones sont exprimées en pixels du canvas affiché ; l'éditeur les place
 * en pourcentages pour suivre le redimensionnement responsive.
 *
 * Clavier : Tab pour parcourir les zones, flèches pour déplacer,
 * Maj + flèches pour redimensionner, Suppr pour supprimer, Échap pour désélectionner.
 */

const MIN_SIZE = 8;
const CORNERS = ['nw', 'ne', 'sw', 'se'];

export class ZoneEditor {
  /**
   * @param layer élément superposé au canvas
   * @param callbacks { onChange(id, box, final) → id, onRemove(id), onSelect(zone|null) }
   */
  constructor(layer, callbacks) {
    this.layer = layer;
    this.callbacks = callbacks;
    this.zones = [];
    this.width = 1;
    this.height = 1;
    this.selectedId = null;
    this.drag = null;
    this.visible = false;

    layer.addEventListener('pointerdown', (event) => {
      if (event.target === layer) this.select(null);
    });
  }

  setVisible(visible) {
    this.visible = visible;
    this.layer.hidden = !visible;
    if (!visible) this.select(null);
  }

  /** Remplace les zones affichées (sauf pendant un glisser, pour ne pas perdre la prise). */
  setZones(zones, width, height) {
    this.zones = zones;
    this.width = width;
    this.height = height;
    if (this.selectedId && !zones.some((z) => z.id === this.selectedId)) this.select(null, false);
    if (!this.drag) this.draw();
  }

  get selected() {
    return this.zones.find((z) => z.id === this.selectedId) ?? null;
  }

  select(id, notify = true) {
    this.selectedId = id;
    for (const el of this.layer.querySelectorAll('.zone')) {
      el.classList.toggle('is-selected', el.dataset.id === id);
      el.setAttribute('aria-selected', String(el.dataset.id === id));
    }
    if (notify) this.callbacks.onSelect?.(this.selected);
  }

  removeSelected() {
    const zone = this.selected;
    if (!zone) return;
    this.selectedId = null;
    this.callbacks.onRemove(zone.id);
    this.callbacks.onSelect?.(null);
  }

  draw() {
    if (!this.visible) return;
    const hadFocus = this.layer.contains(document.activeElement);
    this.layer.replaceChildren(
      ...this.zones.map((zone, index) => {
        const el = document.createElement('div');
        el.className = `zone zone--${zone.origin}${zone.editable === false ? ' zone--locked' : ''}`;
        el.dataset.id = zone.id;
        el.tabIndex = 0;
        el.setAttribute('role', 'option');
        el.setAttribute('aria-selected', String(zone.id === this.selectedId));
        const label = zone.origin === 'auto' ? `Visage détecté ${index + 1}` : `Zone manuelle ${index + 1}`;
        const score = zone.score ? `, confiance ${Math.round(zone.score * 100)} %` : '';
        el.setAttribute('aria-label', `${label}${score}`);
        if (zone.id === this.selectedId) el.classList.add('is-selected');
        this.place(el, zone);

        if (zone.editable !== false) {
          for (const corner of CORNERS) {
            const handle = document.createElement('span');
            handle.className = `zone__handle zone__handle--${corner}`;
            handle.dataset.corner = corner;
            el.append(handle);
          }
        }
        el.addEventListener('pointerdown', (event) => this.startDrag(event, zone));
        el.addEventListener('keydown', (event) => this.onKey(event, zone));
        el.addEventListener('focus', () => this.select(zone.id));
        return el;
      }),
    );
    if (hadFocus && this.selectedId) this.layer.querySelector(`[data-id="${this.selectedId}"]`)?.focus({ preventScroll: true });
  }

  place(el, box) {
    el.style.left = `${(box.x / this.width) * 100}%`;
    el.style.top = `${(box.y / this.height) * 100}%`;
    el.style.width = `${(box.w / this.width) * 100}%`;
    el.style.height = `${(box.h / this.height) * 100}%`;
  }

  startDrag(event, zone) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.select(zone.id);
    const el = event.currentTarget;
    el.focus({ preventScroll: true });
    if (zone.editable === false) return;

    const corner = event.target.dataset.corner ?? null;
    const rect = this.layer.getBoundingClientRect();
    this.drag = {
      id: zone.id,
      el,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      scaleX: this.width / rect.width,
      scaleY: this.height / rect.height,
      origin: { x: zone.x, y: zone.y, w: zone.w, h: zone.h },
      box: null,
    };
    el.setPointerCapture(event.pointerId);
    const move = (e) => this.onDrag(e);
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      const { box, id } = this.drag;
      this.drag = null;
      if (box) this.commit(id, box, true);
      this.draw();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  onDrag(event) {
    const d = this.drag;
    if (!d) return;
    const dx = (event.clientX - d.startX) * d.scaleX;
    const dy = (event.clientY - d.startY) * d.scaleY;
    const o = d.origin;
    let box;
    if (!d.corner) {
      box = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h };
    } else {
      let x1 = o.x;
      let y1 = o.y;
      let x2 = o.x + o.w;
      let y2 = o.y + o.h;
      if (d.corner.includes('w')) x1 = Math.min(x2 - MIN_SIZE, x1 + dx);
      if (d.corner.includes('e')) x2 = Math.max(x1 + MIN_SIZE, x2 + dx);
      if (d.corner.includes('n')) y1 = Math.min(y2 - MIN_SIZE, y1 + dy);
      if (d.corner.includes('s')) y2 = Math.max(y1 + MIN_SIZE, y2 + dy);
      box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    d.box = this.constrain(box);
    this.place(d.el, d.box);
    d.id = this.commit(d.id, d.box, false);
    d.el.dataset.id = d.id;
  }

  constrain(box) {
    const w = Math.min(Math.max(MIN_SIZE, box.w), this.width);
    const h = Math.min(Math.max(MIN_SIZE, box.h), this.height);
    return {
      x: Math.min(Math.max(box.x, -w / 2), this.width - w / 2),
      y: Math.min(Math.max(box.y, -h / 2), this.height - h / 2),
      w,
      h,
    };
  }

  commit(id, box, final) {
    const newId = this.callbacks.onChange(id, box, final) ?? id;
    if (newId !== id && this.selectedId === id) this.selectedId = newId;
    return newId;
  }

  onKey(event, zone) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.removeSelected();
      return;
    }
    if (event.key === 'Escape') {
      this.select(null);
      event.currentTarget.blur();
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[event.key];
    if (!dir || zone.editable === false) return;
    event.preventDefault();
    const step = Math.max(1, Math.round(Math.min(this.width, this.height) * 0.01));
    const box = { x: zone.x, y: zone.y, w: zone.w, h: zone.h };
    if (event.shiftKey) {
      box.w += dir[0] * step * 2;
      box.h += dir[1] * step * 2;
    } else {
      box.x += dir[0] * step;
      box.y += dir[1] * step;
    }
    this.commit(zone.id, this.constrain(box), true);
  }
}
