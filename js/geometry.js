/** Boîtes : { x, y, w, h } en pixels (ou en coordonnées normalisées 0..1). */

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function area(b) {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function intersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a, b) {
  const inter = intersection(a, b);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

export function center(b) {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

export function lerpBox(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  };
}

export function clampBox(b, width, height) {
  const x = clamp(b.x, 0, width);
  const y = clamp(b.y, 0, height);
  return {
    x,
    y,
    w: clamp(b.x + b.w, 0, width) - x,
    h: clamp(b.y + b.h, 0, height) - y,
  };
}

/**
 * Agrandit une boîte de visage pour couvrir front, oreilles, menton et cheveux.
 * `margin` va de 0 (boîte brute) à 1 (+100 %). L'agrandissement est un peu plus
 * marqué vers le haut, où se trouvent le front et les cheveux.
 */
export function expandFaceBox(b, margin) {
  const grow = Math.max(0, margin);
  const w = b.w * (1 + grow);
  const h = b.h * (1 + grow * 1.15);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2 - b.h * grow * 0.08;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Suppression des doublons issus de plusieurs passes (image entière + tuiles).
 * Garde la détection la plus sûre ; une boîte qui chevauche fortement ou qui est
 * majoritairement contenue dans une boîte gardée est un doublon. Si le doublon a
 * un score comparable, la boîte gardée est élargie à leur union (un visage
 * coupé au bord d'une tuile reste ainsi entièrement couvert).
 */
export function mergeDetections(boxes, iouLimit = 0.3, containLimit = 0.6) {
  const sorted = boxes.slice().sort((a, b) => b.score - a.score);
  const kept = [];
  for (const box of sorted) {
    const match = kept.find((k) => {
      if (iou(k, box) > iouLimit) return true;
      const inter = intersection(k, box);
      return inter / Math.max(1e-9, Math.min(area(k), area(box))) > containLimit;
    });
    if (!match) {
      kept.push({ ...box });
    } else if (box.score >= match.score * 0.6) {
      const x2 = Math.max(match.x + match.w, box.x + box.w);
      const y2 = Math.max(match.y + match.h, box.y + box.h);
      match.x = Math.min(match.x, box.x);
      match.y = Math.min(match.y, box.y);
      match.w = x2 - match.x;
      match.h = y2 - match.y;
    }
  }
  return kept;
}
