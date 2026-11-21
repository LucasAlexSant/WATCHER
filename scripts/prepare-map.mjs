import { copyFile } from 'node:fs/promises';

await copyFile(
  new URL('../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url),
  new URL('../public/map-worker.mjs', import.meta.url),
);
