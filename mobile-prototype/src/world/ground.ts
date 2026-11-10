// Paints one chunk's ground texture from the real land-use and water polygons.
import * as THREE from 'three';
import { CHUNK_M } from '../core/geo';
import type { AreaData, ChunkData } from './types';

const BASE = '#857e6c';
// [colour, draw priority]. Colours are a styling choice for a dry November steppe city.
const LAND: Record<string, [string, number]> = {
  nature_reserve: ['#7c7653', 0], residential: ['#8d8776', 1], garages: ['#827d72', 1], industrial: ['#7b7569', 1],
  brownfield: ['#7b7362', 1], construction: ['#8a7d66', 1], greenfield: ['#80795f', 1], landfill: ['#756f62', 1],
  military: ['#807a6b', 1], school: ['#938c7b', 2], kindergarten: ['#938c7b', 2], university: ['#938c7b', 2],
  college: ['#938c7b', 2], hospital: ['#958f80', 2], retail: ['#979185', 2], commercial: ['#979185', 2],
  religious: ['#8f8873', 2], theme_park: ['#84835c', 2], recreation_ground: ['#77794f', 3], stadium: ['#7a7a5a', 3],
  park: ['#6a7748', 4], village_green: ['#6a7748', 4], dog_park: ['#6f7a4a', 4], grass: ['#727b4c', 5],
  meadow: ['#787a4e', 5], garden: ['#66764a', 5], flowerbed: ['#7a7450', 6], playground: ['#b19a72', 6],
  pitch: ['#5f8750', 6], track: ['#9c6450', 6], pedestrian: ['#a5a096', 7], plaza: ['#aaa59b', 7],
};
const WATER = '#55748a';
const WATER_LINE_M: Record<string, number> = { river: 9, stream: 3, drain: 2, ditch: 1.5, canal: 3 };

export function paintGround(c: ChunkData, size: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const e0 = c.chunk[0] * CHUNK_M, n0 = c.chunk[1] * CHUNK_M, k = size / CHUNK_M;
  const X = (e: number) => (e - e0) * k, Y = (n: number) => size - (n - n0) * k;
  const path = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
  };
  g.fillStyle = BASE; g.fillRect(0, 0, size, size);
  const areas = c.land_use.filter((a) => a.ring && LAND[a.class ?? '']).sort((a, b) => LAND[a.class!][1] - LAND[b.class!][1]);
  for (const a of areas) { path(a.ring!); g.closePath(); g.fillStyle = LAND[a.class!][0]; g.fill(); }
  const water = (a: AreaData) => {
    if (a.ring) { path(a.ring); g.closePath(); g.fillStyle = WATER; g.fill(); }
    else if (a.line) {
      path(a.line); g.strokeStyle = WATER; g.lineCap = 'round'; g.lineJoin = 'round';
      g.lineWidth = Math.max(1, (WATER_LINE_M[a.class ?? ''] ?? 2) * k); g.stroke();
    }
  };
  c.water.forEach(water);
  // paved squares: slab joints every 4 m, clipped to the real plaza / pedestrian polygon
  for (const a of areas) {
    if (a.class !== 'plaza' && a.class !== 'pedestrian') continue;
    g.save(); path(a.ring!); g.closePath(); g.clip();
    g.strokeStyle = 'rgba(0,0,0,0.10)'; g.lineWidth = 1;
    const step = Math.max(4, 4 * k);
    for (let x = 0; x <= size; x += step) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, size); g.stroke(); }
    for (let y = 0; y <= size; y += step) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(size, y + 0.5); g.stroke(); }
    g.restore();
  }
  // baked contact shadow: the ground darkens toward every building footprint
  g.lineJoin = 'round';
  for (const w of [7, 4, 2]) {
    g.strokeStyle = 'rgba(12,14,22,0.10)'; g.lineWidth = Math.max(1.5, w * k);
    for (const b of c.buildings) for (const ring of b.rings) { if (ring.length < 3) continue; path(ring); g.closePath(); g.stroke(); }
  }
  // fine grain so large flat areas are not a single flat colour
  let s = ((c.chunk[0] * 73856093) ^ (c.chunk[1] * 19349663)) >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const dots = (size * size) / 24;
  for (let i = 0; i < dots; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
    const d = 1 + r() * 2;
    g.fillRect(r() * size, r() * size, d, d);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2;
  return t;
}
