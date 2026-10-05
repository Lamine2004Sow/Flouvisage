/**
 * Suivi simple des visages entre deux détections.
 *
 * L'analyse produit des détections à intervalle régulier. On les relie en
 * pistes (association par recouvrement et proximité), on lisse légèrement les
 * positions, puis on interpole la boîte à n'importe quel instant. Comme toute
 * la vidéo est analysée avant le rendu, chaque piste est aussi prolongée un
 * peu avant sa première détection et après la dernière : un visage qui
 * apparaît entre deux analyses est déjà masqué.
 */
import { iou, center, lerpBox } from '../geometry.js';

let trackCounter = 0;

function predict(track, t) {
  const keys = track.keys;
  const last = keys[keys.length - 1];
  if (keys.length < 2) return last.box;
  const prev = keys[keys.length - 2];
  const dt = last.t - prev.t;
  if (dt <= 0) return last.box;
  const ahead = Math.min(t - last.t, dt * 2);
  const factor = (ahead / dt) * 0.7; // vitesse amortie
  return {
    x: last.box.x + (last.box.x - prev.box.x) * factor,
    y: last.box.y + (last.box.y - prev.box.y) * factor,
    w: last.box.w,
    h: last.box.h,
  };
}

function matchScore(predicted, det) {
  const overlap = iou(predicted, det);
  const a = center(predicted);
  const b = center(det);
  const size = Math.max(predicted.w, predicted.h, det.w, det.h);
  const distance = Math.hypot(a.x - b.x, a.y - b.y) / size;
  const ratio = (det.w * det.h) / Math.max(1e-6, predicted.w * predicted.h);
  if (ratio < 0.4 || ratio > 2.5) return -1;
  if (overlap < 0.05 && distance > 0.9) return -1;
  return overlap + (1 - Math.min(1, distance));
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Lissage 1-2-1 des centres et tailles ; la boîte finale couvre toujours la détection brute. */
function smooth(keys) {
  if (keys.length < 3) return;
  const raw = keys.map((k) => k.box);
  for (let i = 1; i < keys.length - 1; i += 1) {
    const [a, b, c] = [raw[i - 1], raw[i], raw[i + 1]];
    const cx = (center(a).x + 2 * center(b).x + center(c).x) / 4;
    const cy = (center(a).y + 2 * center(b).y + center(c).y) / 4;
    const w = Math.max(b.w, (a.w + 2 * b.w + c.w) / 4);
    const h = Math.max(b.h, (a.h + 2 * b.h + c.h) / 4);
    keys[i] = { ...keys[i], box: union({ x: cx - w / 2, y: cy - h / 2, w, h }, b) };
  }
}

const EDGE_FOLLOW = 2; // secondes de suivi d'un visage qui sort (ou entre) par un bord

function nearEdge(box, width, height) {
  return box.x < box.w * 0.5 || box.y < box.h * 0.5 || box.x + box.w > width - box.w * 0.5 || box.y + box.h > height - box.h * 0.5;
}

/** Vitesse (px/s) entre deux images clés, si la piste touche un bord de l'image. */
function edgeVelocity(a, b, width, height, edgeBox) {
  if (!a || !b || !nearEdge(edgeBox, width, height)) return null;
  const dt = b.t - a.t;
  if (dt <= 0) return null;
  return { x: (center(b.box).x - center(a.box).x) / dt, y: (center(b.box).y - center(a.box).y) / dt };
}

/**
 * @param samples [{ t, boxes: [{x,y,w,h,score}] }] en pixels de la vidéo source
 * @param threshold seuil de confiance
 * @param interval intervalle entre deux analyses (s)
 * @param size { width, height } de la vidéo source
 */
export function buildTracks(samples, threshold, interval, { width, height }) {
  const maxGap = Math.max(1, interval * 2.5);
  const tracks = [];
  let active = [];

  for (const sample of samples) {
    // Seuil abaissé pour la continuité : une piste confirmée ne doit pas perdre
    // un visage dont le score fléchit un instant (profil, flou de mouvement).
    const detections = sample.boxes.filter((b) => b.score >= threshold * 0.8);
    active = active.filter((track) => sample.t - track.keys[track.keys.length - 1].t <= maxGap);

    const pairs = [];
    active.forEach((track, ti) => {
      const predicted = predict(track, sample.t);
      detections.forEach((det, di) => {
        const score = matchScore(predicted, det);
        if (score >= 0) pairs.push({ ti, di, score });
      });
    });
    pairs.sort((a, b) => b.score - a.score);

    const usedTracks = new Set();
    const usedDets = new Set();
    for (const { ti, di } of pairs) {
      if (usedTracks.has(ti) || usedDets.has(di)) continue;
      usedTracks.add(ti);
      usedDets.add(di);
      const det = detections[di];
      active[ti].keys.push({ t: sample.t, score: det.score, box: { x: det.x, y: det.y, w: det.w, h: det.h } });
      active[ti].maxScore = Math.max(active[ti].maxScore, det.score);
    }

    detections.forEach((det, di) => {
      if (usedDets.has(di)) return;
      const track = {
        id: `track${++trackCounter}`,
        keys: [{ t: sample.t, score: det.score, box: { x: det.x, y: det.y, w: det.w, h: det.h } }],
        maxScore: det.score,
      };
      tracks.push(track);
      active.push(track);
    });
  }

  // Un vrai visage est détecté avec un score élevé de façon régulière, alors
  // qu'une fausse alerte (main, motif) n'a qu'un score moyen par intermittence :
  // la médiane des scores de la piste les distingue bien. Une détection isolée
  // doit en plus être assez sûre.
  const kept = tracks.filter((t) => median(t.keys.map((k) => k.score)) >= threshold && (t.keys.length > 1 || t.maxScore >= Math.max(threshold, 0.6)));
  for (const track of kept) {
    smooth(track.keys);
    const k = track.keys;
    track.start = k[0].t;
    track.end = k[k.length - 1].t;
    // Un visage qui quitte l'image n'est plus détecté quand il est à moitié coupé :
    // on prolonge son mouvement pour qu'il reste masqué jusqu'à sa sortie.
    track.exit = edgeVelocity(k[k.length - 2], k[k.length - 1], width, height, k[k.length - 1].box);
    track.entry = edgeVelocity(k[0], k[1], width, height, k[0].box);
  }
  return kept;
}

function shift(box, velocity, dt) {
  return { x: box.x + velocity.x * dt, y: box.y + velocity.y * dt, w: box.w, h: box.h };
}

function visible(box, size) {
  return box.x + box.w > 0 && box.y + box.h > 0 && box.x < size.width && box.y < size.height;
}

/** Nombre maximal de visages présents en même temps (pour l'affichage). */
export function peakConcurrent(tracks, samples) {
  let peak = 0;
  for (const { t } of samples) {
    peak = Math.max(peak, tracks.filter((tr) => tr.start <= t && t <= tr.end).length);
  }
  return peak;
}

/** Boîte d'une piste à l'instant t (pixels source), ou null si la piste est inactive. */
export function boxAt(track, t, hold, size) {
  const keys = track.keys;
  if (t > track.end && track.exit && t - track.end <= EDGE_FOLLOW) {
    const box = shift(keys[keys.length - 1].box, track.exit, t - track.end);
    if (visible(box, size)) return box;
  }
  if (t < track.start && track.entry && track.start - t <= EDGE_FOLLOW) {
    const box = shift(keys[0].box, track.entry, t - track.start);
    if (visible(box, size)) return box;
  }
  if (t < track.start - hold || t > track.end + hold) return null;
  if (t <= track.start) return keys[0].box;
  if (t >= track.end) return keys[keys.length - 1].box;

  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  const box = lerpBox(a.box, b.box, f);
  // Marge de mouvement : couvre l'incertitude entre deux détections.
  const padX = Math.abs(center(b.box).x - center(a.box).x) * 0.25;
  const padY = Math.abs(center(b.box).y - center(a.box).y) * 0.25;
  return { x: box.x - padX, y: box.y - padY, w: box.w + padX * 2, h: box.h + padY * 2 };
}
