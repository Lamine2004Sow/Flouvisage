/** Panneau de réglages : valeurs par défaut, lecture et affichage. */

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'blur',
  shape: 'ellipse',
  blur: 60,
  pixel: 12,
  color: '#111111',
  margin: 0.25,
  threshold: 0.5,
  performance: 'balanced',
  rate: 5,
});

const form = () => document.getElementById('settings');

export function readSettings() {
  const f = form();
  const data = new FormData(f);
  return {
    mode: data.get('mode'),
    shape: data.get('shape'),
    blur: Number(f.blur.value),
    pixel: Number(f.pixel.value),
    color: f.color.value,
    margin: Number(f.margin.value) / 100,
    threshold: Number(f.threshold.value) / 100,
    performance: data.get('performance'),
    rate: Number(f.rate.value),
  };
}

export function writeSettings(settings) {
  const f = form();
  for (const name of ['mode', 'shape', 'performance']) {
    for (const input of f.querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === settings[name];
  }
  f.blur.value = settings.blur;
  f.pixel.value = settings.pixel;
  f.color.value = settings.color;
  f.margin.value = Math.round(settings.margin * 100);
  f.threshold.value = Math.round(settings.threshold * 100);
  f.rate.value = String(settings.rate);
  refreshOutputs();
}

/** Met à jour les valeurs affichées et les champs propres à chaque mode. */
export function refreshOutputs() {
  const s = readSettings();
  document.getElementById('blur-value').textContent = `${s.blur} %`;
  document.getElementById('pixel-value').textContent = `${s.pixel} %`;
  document.getElementById('margin-value').textContent = `${Math.round(s.margin * 100)} %`;
  document.getElementById('threshold-value').textContent = `${Math.round(s.threshold * 100)} %`;
  for (const el of form().querySelectorAll('[data-for-mode]')) el.hidden = el.dataset.forMode !== s.mode;
}

/** Appelle onChange(nom du réglage) à chaque modification. */
export function bindSettings(onChange) {
  const f = form();
  const discrete = (el) => el.type === 'radio' || el.tagName === 'SELECT';
  f.addEventListener('input', (event) => {
    if (discrete(event.target)) return;
    refreshOutputs();
    if (event.target.name) onChange(event.target.name);
  });
  f.addEventListener('change', (event) => {
    // Radios et listes : « change » est le seul événement fiable partout.
    if (discrete(event.target)) {
      refreshOutputs();
      onChange(event.target.name);
    }
  });
  f.addEventListener('submit', (event) => event.preventDefault());
}
