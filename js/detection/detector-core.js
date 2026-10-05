/**
 * Cœur de détection basé sur @vladmandic/human (modèle BlazeFace uniquement).
 * Utilisé dans le Web Worker, ou directement dans la page en solution de repli.
 *
 * Seule la présence et la position des visages sont calculées : les modèles
 * de description (reconnaissance), d'âge, d'émotion, etc. sont désactivés et
 * ne sont jamais téléchargés.
 */
import { Human } from '../../vendor/human/human.esm.js';
import { mergeDetections } from '../geometry.js';

const INPUT_SIZE = 256;
const CHUNK = 8;

/** Convertit les visages d'une tuile en boîtes normalisées dans le repère de la source. */
function collect(result, tile, minScore, found) {
  for (const face of result?.face ?? []) {
    const score = face.boxScore ?? face.score ?? 0;
    if (score < minScore) continue;
    const [bx, by, bw, bh] = face.boxRaw;
    found.push({ x: tile.x + bx * tile.w, y: tile.y + by * tile.h, w: bw * tile.w, h: bh * tile.h, score });
  }
}

function humanConfig(baseUrl, backend) {
  return {
    backend,
    modelBasePath: new URL('models/', baseUrl).href,
    wasmPath: new URL('vendor/tfjs-wasm/', baseUrl).href,
    wasmPlatformFetch: false,
    debug: false,
    async: true,
    warmup: 'none',
    cacheModels: false,
    cacheSensitivity: 0,
    skipAllowed: false,
    deallocate: true,
    filter: { enabled: false },
    gesture: { enabled: false },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    segmentation: { enabled: false },
    face: {
      enabled: true,
      detector: {
        modelPath: 'blazeface.json',
        rotation: false,
        maxDetected: 50,
        minConfidence: 0.1,
        minSize: 0,
        iouThreshold: 0.3,
        scale: 1.0,
        square: false,
        skipFrames: 0,
        skipTime: 0,
        return: false,
        mask: false,
      },
      mesh: { enabled: false },
      attention: { enabled: false },
      iris: { enabled: false },
      emotion: { enabled: false },
      description: { enabled: false },
      antispoof: { enabled: false },
      liveness: { enabled: false },
      gear: { enabled: false },
    },
  };
}

export class DetectorCore {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.human = null;
    this.backend = null;
  }

  /** Essaie chaque backend dans l'ordre et garde le premier qui fonctionne réellement. */
  async init(backends, onStatus = () => {}) {
    const failures = [];
    for (const backend of backends) {
      try {
        onStatus(`Initialisation (${backend})`);
        const human = this.human ?? new Human(humanConfig(this.baseUrl, backend));
        human.config.backend = backend;
        await human.init();
        if (human.tf.getBackend() !== backend) throw new Error(`backend ${backend} indisponible`);
        onStatus('Chargement du modèle');
        await human.load();
        this.human = human;
        await this.selfTest();
        this.backend = backend;
        return backend;
      } catch (error) {
        failures.push(`${backend}: ${error?.message ?? error}`);
      }
    }
    const error = new Error(`Aucun moteur de calcul utilisable (${failures.join(' ; ')})`);
    error.code = failures.some((f) => /model|fetch|json|404/i.test(f)) ? 'model-load' : 'no-backend';
    throw error;
  }

  async selfTest() {
    const tf = this.human.tf;
    const probe = tf.zeros([1, 64, 64, 3]);
    try {
      const result = await this.human.detect(probe);
      if (!result || result.error) throw new Error(result?.error || 'détection impossible');
    } finally {
      probe.dispose();
    }
  }

  /**
   * Détecte les visages dans `source` (ImageBitmap, ImageData, canvas).
   * `tiles` : régions carrées normalisées à analyser. Retourne des boîtes
   * normalisées { x, y, w, h, score } dans le repère de la source.
   */
  async detect(source, tiles, minScore = 0.1) {
    const human = this.human;
    const tf = human.tf;
    const pixels = tf.tidy(() => tf.expandDims(tf.cast(tf.browser.fromPixels(source), 'float32'), 0));
    const found = [];
    try {
      // Les tuiles sont découpées par lots pour limiter la mémoire graphique.
      for (let start = 0; start < tiles.length; start += CHUNK) {
        const chunk = tiles.slice(start, start + CHUNK);
        const crops = tf.tidy(() => {
          const boxes = tf.tensor2d(chunk.map((t) => [t.y, t.x, t.y + t.h, t.x + t.w]));
          const indices = tf.zeros([chunk.length], 'int32');
          return tf.image.cropAndResize(pixels, boxes, indices, [INPUT_SIZE, INPUT_SIZE], 'bilinear', 0);
        });
        try {
          for (let i = 0; i < chunk.length; i += 1) {
            const input = tf.slice(crops, [i, 0, 0, 0], [1, -1, -1, -1]);
            let result;
            try {
              result = await human.detect(input);
            } finally {
              input.dispose();
            }
            if (result?.error) throw new Error(result.error);
            collect(result, chunk[i], minScore, found);
          }
        } finally {
          crops.dispose();
        }
      }
    } finally {
      pixels.dispose();
    }
    return mergeDetections(found);
  }

  memory() {
    try {
      return this.human?.tf.memory();
    } catch {
      return null;
    }
  }
}
