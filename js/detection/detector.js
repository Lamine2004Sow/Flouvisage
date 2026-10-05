/**
 * Façade de détection utilisée par l'application.
 *
 * Stratégie :
 *  1. Web Worker (module) avec WebGL ou WebGPU : l'interface reste fluide ;
 *  2. sinon, si la page dispose de WebGL, détection dans la page ;
 *  3. sinon WebAssembly (dans le Worker si possible), puis CPU en dernier recours.
 * Le modèle n'est chargé qu'une fois puis réutilisé.
 */
import { getCapabilities } from '../capabilities.js';
import { planTiles } from './tiling.js';

const BASE_URL = new URL('../../', import.meta.url).href;
const WORKER_START_TIMEOUT = 15000;
const DETECT_FLOOR = 0.1;

export const BACKEND_LABELS = {
  webgl: 'WebGL',
  webgpu: 'WebGPU',
  wasm: 'WebAssembly',
  cpu: 'CPU (lent)',
};

export class DetectorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class WorkerDetector {
  constructor() {
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  start(backends, onStatus) {
    return new Promise((resolve, reject) => {
      let alive = false;
      let worker;
      try {
        worker = new Worker(new URL('./detector.worker.js', import.meta.url), { type: 'module' });
      } catch (error) {
        reject(new DetectorError('worker', String(error)));
        return;
      }
      this.worker = worker;
      const timer = setTimeout(() => {
        if (!alive) {
          worker.terminate();
          reject(new DetectorError('worker', 'Le Worker ne répond pas'));
        }
      }, WORKER_START_TIMEOUT);

      worker.onerror = (event) => {
        event.preventDefault?.();
        clearTimeout(timer);
        worker.terminate();
        reject(new DetectorError('worker', event.message || 'Worker module non pris en charge'));
      };

      worker.onmessage = ({ data }) => {
        switch (data.type) {
          case 'alive':
            alive = true;
            clearTimeout(timer);
            worker.postMessage({ type: 'init', baseUrl: BASE_URL, backends });
            break;
          case 'status':
            onStatus(data.status);
            break;
          case 'ready':
            worker.onerror = (event) => this.failAll(event.message || 'Erreur du Worker');
            resolve(data.backend);
            break;
          case 'init-error':
            worker.terminate();
            reject(new DetectorError(data.code, data.message));
            break;
          case 'result':
          case 'detect-error': {
            const job = this.pending.get(data.id);
            if (!job) break;
            this.pending.delete(data.id);
            if (data.type === 'result') job.resolve(data.faces);
            else job.reject(new DetectorError('detect', data.message));
            break;
          }
          default:
        }
      };
    });
  }

  async detect(canvas, tiles, minScore) {
    let source;
    let transfer = [];
    if (typeof createImageBitmap === 'function') {
      source = await createImageBitmap(canvas);
      transfer = [source];
    } else {
      source = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      transfer = [source.data.buffer];
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'detect', id, source, tiles, minScore }, transfer);
    });
  }

  failAll(message) {
    for (const job of this.pending.values()) job.reject(new DetectorError('detect', message));
    this.pending.clear();
  }

  dispose() {
    this.failAll('Détection interrompue');
    this.worker?.terminate();
    this.worker = null;
  }
}

class PageDetector {
  async start(backends, onStatus) {
    const { DetectorCore } = await import('./detector-core.js');
    this.core = new DetectorCore(BASE_URL);
    return this.core.init(backends, onStatus);
  }

  detect(canvas, tiles, minScore) {
    return this.core.detect(canvas, tiles, minScore);
  }

  dispose() {}
}

export class FaceDetector {
  constructor() {
    this.engine = null;
    this.backend = null;
    this.mode = null;
    this.loading = null;
    this.queue = Promise.resolve();
  }

  get ready() {
    return Boolean(this.engine);
  }

  /** Charge le modèle une seule fois ; les appels suivants réutilisent la même promesse. */
  load(onStatus = () => {}) {
    if (!this.loading) {
      this.loading = this.boot(onStatus).catch((error) => {
        this.loading = null;
        throw error;
      });
    }
    return this.loading;
  }

  async boot(onStatus) {
    const caps = getCapabilities();
    const errors = [];

    // WebGL logiciel : WebAssembly passe en premier.
    const gpuFirst = caps.webgl && !caps.softwareWebGL;
    if (caps.worker && caps.offscreenCanvas) {
      const worker = new WorkerDetector();
      try {
        const backend = await worker.start(gpuFirst ? ['webgl', 'webgpu', 'wasm'] : ['wasm', 'webgpu', 'webgl'], onStatus);
        if (backend !== 'wasm' || !gpuFirst) return this.use(worker, backend, 'worker');
        worker.dispose(); // WebGL dans la page sera plus rapide que WASM dans le Worker.
      } catch (error) {
        worker.dispose();
        errors.push(error);
        if (error.code === 'model-load') throw new DetectorError('model-load', error.message);
      }
    }

    const page = new PageDetector();
    const order = gpuFirst ? ['webgl', 'webgpu', 'wasm', 'cpu'] : ['wasm', 'webgpu', 'webgl', 'cpu'];
    const backends = order.filter((b) => (b === 'webgl' ? caps.webgl : b === 'wasm' ? caps.wasm : true));
    try {
      const backend = await page.start(backends, onStatus);
      return this.use(page, backend, 'page');
    } catch (error) {
      errors.push(error);
      const code = errors.some((e) => e.code === 'model-load') ? 'model-load' : 'no-backend';
      throw new DetectorError(code, errors.map((e) => e.message).join(' | '));
    }
  }

  use(engine, backend, mode) {
    this.engine = engine;
    this.backend = backend;
    this.mode = mode;
    return { backend, mode };
  }

  /**
   * Détecte les visages sur un canvas d'analyse (déjà réduit).
   * Les appels sont sérialisés pour ne pas saturer le GPU.
   */
  detect(canvas, levels) {
    const tiles = planTiles(canvas.width, canvas.height, levels);
    const run = () => this.engine.detect(canvas, tiles, DETECT_FLOOR);
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  dispose() {
    this.engine?.dispose();
    this.engine = null;
    this.loading = null;
  }
}

export const detector = new FaceDetector();
