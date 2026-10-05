/** Détection des fonctionnalités du navigateur au runtime. */

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * WebGL émulé par le processeur (pilote graphique bloqué, machine virtuelle) :
 * WebAssembly est alors bien plus rapide. L'information reste locale.
 */
function isSoftwareWebGL() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  } catch {
    return false;
  }
}

function hasCanvasFilter() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof ctx.filter !== 'string') return false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 9, 1);
    const probe = document.createElement('canvas');
    probe.width = 9;
    probe.height = 1;
    const pctx = probe.getContext('2d');
    pctx.filter = 'blur(2px)';
    pctx.drawImage(canvas, 4, 0, 1, 1, 4, 0, 1, 1);
    // Si le flou est appliqué, le pixel voisin n'est plus totalement transparent.
    return pctx.getImageData(3, 0, 1, 1).data[3] > 0;
  } catch {
    return false;
  }
}

function canEncode(type) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL(type).startsWith(`data:${type}`);
  } catch {
    return false;
  }
}

function recorderTypes() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return [];
  // Par ordre de préférence ; un seul choix est gardé par conteneur.
  const candidates = [
    { label: 'MP4 (H.264)', mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4' },
    { label: 'MP4 (H.264)', mime: 'video/mp4;codecs=avc1,mp4a', ext: 'mp4' },
    { label: 'MP4', mime: 'video/mp4', ext: 'mp4' },
    { label: 'WebM (VP9)', mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { label: 'WebM (VP8)', mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { label: 'WebM', mime: 'video/webm', ext: 'webm' },
  ];
  const result = [];
  for (const c of candidates) {
    if (result.some((r) => r.ext === c.ext)) continue;
    if (MediaRecorder.isTypeSupported(c.mime)) result.push(c);
  }
  return result;
}

let cached = null;

export function getCapabilities() {
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  cached = {
    webgl: hasWebGL(),
    softwareWebGL: isSoftwareWebGL(),
    webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    wasm: typeof WebAssembly === 'object',
    worker: typeof Worker === 'function',
    offscreenCanvas: typeof OffscreenCanvas === 'function',
    createImageBitmap: typeof createImageBitmap === 'function',
    canvasFilter: hasCanvasFilter(),
    webp: canEncode('image/webp'),
    captureStream: typeof canvas.captureStream === 'function',
    mediaRecorder: typeof MediaRecorder === 'function',
    recorderTypes: recorderTypes(),
    videoFrameCallback: typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    audioContext: typeof (window.AudioContext || window.webkitAudioContext) === 'function',
    serviceWorker: 'serviceWorker' in navigator && window.isSecureContext,
  };
  return cached;
}
