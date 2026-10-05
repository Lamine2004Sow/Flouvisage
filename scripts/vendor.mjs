#!/usr/bin/env node
/**
 * Met à jour les dépendances embarquées à partir de node_modules
 * (après `npm install`). Le projet fonctionne sans cette étape : les fichiers
 * nécessaires sont déjà présents dans vendor/, models/ et assets/fonts/.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const nm = join(root, 'node_modules');

const files = [
  ['@vladmandic/human/dist/human.esm.js', 'vendor/human/human.esm.js'],
  ['@vladmandic/human/LICENSE', 'vendor/human/LICENSE'],
  ['@vladmandic/human/models/blazeface.json', 'models/blazeface.json'],
  ['@vladmandic/human/models/blazeface.bin', 'models/blazeface.bin'],
  ['@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm', 'vendor/tfjs-wasm/tfjs-backend-wasm.wasm'],
  ['@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm', 'vendor/tfjs-wasm/tfjs-backend-wasm-simd.wasm'],
  ['@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm', 'vendor/tfjs-wasm/tfjs-backend-wasm-threaded-simd.wasm'],
  ['@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2', 'assets/fonts/bricolage-grotesque.woff2'],
  ['@fontsource-variable/bricolage-grotesque/LICENSE', 'assets/fonts/OFL.txt'],
];

for (const [from, to] of files) {
  const target = join(root, to);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(nm, from), target);
  console.log(`✓ ${to}`);
}
console.log('Pensez à incrémenter VERSION dans sw.js pour invalider le cache hors ligne.');
