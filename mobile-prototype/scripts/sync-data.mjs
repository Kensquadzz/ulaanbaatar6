// Copies the real geographic tiles from ../data/tiles into public/data (not committed twice)
// and derives a coarse terrain overview (64 m grid) from the chunk height grids for the far backdrop.
// Nothing is invented here: the overview is a strict subsample of the pipeline's heights.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../data/tiles');
const dst = path.resolve(here, '../public/data');
if (!fs.existsSync(path.join(src, 'manifest.json'))) {
  if (fs.existsSync(path.join(dst, 'manifest.json')) && fs.existsSync(path.join(dst, 'overview.json'))) {
    console.log('sync-data: source tiles not mounted; using bundled public/data release copy');
    process.exit(0);
  }
  console.error('sync-data: ' + src + ' not found and no bundled public/data release copy exists.');
  process.exit(1);
}
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.join(dst, 'chunks'), { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
fs.copyFileSync(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
fs.copyFileSync(path.join(src, 'landmarks.json'), path.join(dst, 'landmarks.json'));
// district outlines (Overture divisions, see pipeline/ub6pipeline/build_districts.py); optional
for (const f of ['districts.json', 'bridges.json', 'rail.json']) {      // optional extras (see pipeline/ub6pipeline)
  if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(dst, f));
}

const N = manifest.height_grid_n;            // 17
const STEP = 4;                               // every 4th sample -> 64 m
const per = (N - 1) / STEP;                   // 4 cells per chunk
const xs = manifest.chunks.map((c) => c.x), ys = manifest.chunks.map((c) => c.y);
const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
const w = (x1 - x0 + 1) * per + 1, h = (y1 - y0 + 1) * per + 1;
const grid = new Array(w * h).fill(0);
let bytes = 0;
for (const c of manifest.chunks) {
  const name = `${c.x}_${c.y}.json`;
  const raw = fs.readFileSync(path.join(src, 'chunks', name), 'utf8');
  fs.writeFileSync(path.join(dst, 'chunks', name), raw);
  bytes += raw.length;
  const g = JSON.parse(raw).height_grid_dm;
  for (let j = 0; j <= per; j++) for (let i = 0; i <= per; i++) {
    grid[((c.y - y0) * per + j) * w + (c.x - x0) * per + i] = g[j * STEP * N + i * STEP];
  }
}
fs.writeFileSync(path.join(dst, 'overview.json'), JSON.stringify({
  note: 'Subsample (64 m) of chunk height grids; decimetres; row-major from the south-west corner.',
  x0, y0, x1, y1, per, w, h, cell_m: manifest.chunk_size_m / per, height_dm: grid,
}));
console.log(`sync-data: ${manifest.chunks.length} chunks (${(bytes / 1e6).toFixed(1)} MB), overview ${w}x${h}`);
