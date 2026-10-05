/**
 * Effets d'anonymisation appliqués sur un contexte Canvas 2D.
 * Les zones sont en pixels du canvas et incluent déjà la marge de sécurité.
 */
import { getCapabilities } from './capabilities.js';
import { clampBox } from './geometry.js';

export const DEFAULT_EFFECT = {
  mode: 'blur', // blur | pixelate | mask
  shape: 'ellipse', // ellipse | rect
  blur: 60, // 1..100, relatif à la taille du visage
  pixel: 12, // taille des blocs en % de la taille du visage
  color: '#111111',
};

// Canvas temporaires réutilisés pour éviter les allocations à chaque image.
const pool = {};
function scratch(name, width, height) {
  let canvas = pool[name];
  if (!canvas) {
    canvas = document.createElement('canvas');
    pool[name] = canvas;
  }
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  } else {
    canvas.getContext('2d').clearRect(0, 0, w, h);
  }
  return canvas;
}

/** Libère la mémoire des canvas temporaires (appelé lors d'un changement de fichier). */
export function releaseScratch() {
  for (const key of Object.keys(pool)) {
    pool[key].width = 0;
    pool[key].height = 0;
    delete pool[key];
  }
}

function shapePath(ctx, box, shape, dx = 0, dy = 0) {
  ctx.beginPath();
  if (shape === 'ellipse') {
    ctx.ellipse(box.x - dx + box.w / 2, box.y - dy + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.rect(box.x - dx, box.y - dy, box.w, box.h);
  }
}

/**
 * Découpe la forme dans un canvas temporaire placé en (dx, dy) : tout ce qui
 * est hors de l'ellipse ou du rectangle devient transparent. On évite ainsi
 * ctx.clip(), dont le rendu est peu fiable sur certains GPU quand la forme
 * dépasse du bord de l'image.
 */
function cutShape(canvas, box, shape, dx, dy) {
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = '#000';
  shapePath(ctx, box, shape, dx, dy);
  ctx.fill();
  ctx.restore();
}

function faceSize(box) {
  return Math.sqrt(box.w * box.h);
}

/** Copie floutée de la zone, toujours entièrement opaque (aucun détail ne transparaît sur les bords). */
function blurredRegion(source, box, strength) {
  const radius = Math.max(2, faceSize(box) * (strength / 100) * 0.35);
  const pad = Math.ceil(radius * 2);
  const region = clampBox(
    { x: Math.floor(box.x - pad), y: Math.floor(box.y - pad), w: Math.ceil(box.w + pad * 2), h: Math.ceil(box.h + pad * 2) },
    source.width,
    source.height,
  );
  const raw = scratch('raw', region.w, region.h);
  raw.getContext('2d').drawImage(source, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);

  // Fond opaque : version très réduite de la zone, étirée.
  const tiny = scratch('tiny', 4, 4);
  const tctx = tiny.getContext('2d');
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(raw, 0, 0, 4, 4);

  const out = scratch('blurred', region.w, region.h);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true;
  octx.drawImage(tiny, 0, 0, region.w, region.h);

  if (getCapabilities().canvasFilter) {
    octx.filter = `blur(${radius.toFixed(1)}px)`;
    octx.drawImage(raw, 0, 0);
    octx.filter = 'none';
  } else {
    // Repli sans ctx.filter (Safari) : réduction puis agrandissement lissé, en deux passes.
    const factor = Math.max(2, radius / 1.5);
    for (const f of [factor, factor / 2]) {
      const small = scratch('small', region.w / f, region.h / f);
      const sctx = small.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(f === factor ? raw : out, 0, 0, small.width, small.height);
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(small, 0, 0, region.w, region.h);
    }
  }
  return { canvas: out, region };
}

function drawBlur(ctx, box, effect) {
  const { canvas, region } = blurredRegion(ctx.canvas, box, effect.blur);
  cutShape(canvas, box, effect.shape, region.x, region.y);
  ctx.drawImage(canvas, region.x, region.y);
}

function drawPixelate(ctx, box, effect) {
  const area = clampBox(
    { x: Math.floor(box.x), y: Math.floor(box.y), w: Math.ceil(box.w), h: Math.ceil(box.h) },
    ctx.canvas.width,
    ctx.canvas.height,
  );
  if (area.w < 1 || area.h < 1) return;
  const block = Math.max(2, faceSize(box) * (effect.pixel / 100));
  const small = scratch('pixels', area.w / block, area.h / block);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(ctx.canvas, area.x, area.y, area.w, area.h, 0, 0, small.width, small.height);

  const patch = scratch('pixelated', area.w, area.h);
  const pctx = patch.getContext('2d');
  pctx.imageSmoothingEnabled = false;
  pctx.drawImage(small, 0, 0, small.width, small.height, 0, 0, area.w, area.h);
  cutShape(patch, box, effect.shape, area.x, area.y);
  ctx.drawImage(patch, area.x, area.y);
}

function drawMask(ctx, box, effect) {
  ctx.save();
  ctx.fillStyle = effect.color;
  shapePath(ctx, box, effect.shape);
  ctx.fill();
  ctx.restore();
}

const DRAWERS = { blur: drawBlur, pixelate: drawPixelate, mask: drawMask };

/** Applique l'effet choisi sur chaque zone ; le canvas doit déjà contenir l'image. */
export function anonymize(ctx, boxes, effect) {
  const draw = DRAWERS[effect.mode] ?? drawBlur;
  for (const box of boxes) {
    if (box.w >= 1 && box.h >= 1) draw(ctx, box, effect);
  }
}
