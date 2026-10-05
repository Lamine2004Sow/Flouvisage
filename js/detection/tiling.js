/**
 * Plan de découpage pour la détection.
 *
 * Le détecteur BlazeFace travaille sur une entrée de 256 × 256 px : sur une
 * grande image, les petits visages deviennent trop petits pour être vus. On
 * analyse donc l'image entière (sans déformation, avec bandes noires) puis,
 * selon le niveau de précision, des tuiles carrées qui se chevauchent.
 * Les tuiles sont exprimées en coordonnées normalisées (0..1) de la source.
 */

// `levels` : 1 = image entière, n = grille d'environ n × n tuiles (visages plus petits).
// La vidéo utilise moins de tuiles car chaque seconde contient plusieurs analyses.
export const PERFORMANCE_PRESETS = {
  fast: { label: 'Rapide', imageLevels: [1], videoLevels: [1], imageMaxSide: 1024, videoMaxSide: 640 },
  balanced: { label: 'Équilibré', imageLevels: [1, 2, 3], videoLevels: [1, 2], imageMaxSide: 1600, videoMaxSide: 960 },
  precise: { label: 'Haute précision', imageLevels: [1, 3, 6], videoLevels: [1, 2, 3], imageMaxSide: 2048, videoMaxSide: 1280 },
};

const OVERLAP = 0.25;

function positions(length, side) {
  if (side >= length) return [(length - side) / 2];
  const count = Math.ceil((length - side) / (side * (1 - OVERLAP))) + 1;
  const step = (length - side) / (count - 1);
  return Array.from({ length: count }, (_, i) => i * step);
}

export function planTiles(width, height, levels) {
  const tiles = [];
  for (const level of levels) {
    if (level === 1) {
      const side = Math.max(width, height);
      tiles.push({ x: (width - side) / 2, y: (height - side) / 2, side });
      continue;
    }
    const side = Math.min(Math.min(width, height), (Math.min(width, height) / level) * (1 + OVERLAP));
    for (const y of positions(height, side)) {
      for (const x of positions(width, side)) tiles.push({ x, y, side });
    }
  }
  return tiles.map((t) => ({ x: t.x / width, y: t.y / height, w: t.side / width, h: t.side / height }));
}
