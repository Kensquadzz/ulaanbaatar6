// Runs the mesh builders, terrain sampling and collision over the REAL tiles in ../data/tiles.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHUNK_M, ORIGIN_GROUND_M } from '../src/core/geo';
import { ColliderSet, makeCollider, pointInRing, pushOut, type Collider } from '../src/world/collision';
import { buildBuildings, buildRoads, buildTerrain, groundRange, ringArea, type MeshData } from '../src/world/meshing';
import { HeightField } from '../src/world/terrain';
import type { ChunkData, Manifest } from '../src/world/types';
import { Player, RADIUS, type World } from '../src/player/player';

const dir = new URL('../../data/tiles/', import.meta.url);
const manifest: Manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', dir), 'utf8'));
const load = (x: number, y: number): ChunkData => JSON.parse(fs.readFileSync(new URL(`chunks/${x}_${y}.json`, dir), 'utf8'));

function checkMesh(m: MeshData, label: string) {
  const v = m.position.length / 3;
  expect(m.normal.length, label).toBe(v * 3);
  expect(m.uv.length, label).toBe(v * 2);
  expect(m.index.length % 3, label).toBe(0);
  for (let i = 0; i < m.position.length; i++) if (!Number.isFinite(m.position[i])) throw new Error(label + ': non-finite position');
  for (let i = 0; i < m.index.length; i++) if (m.index[i] >= v) throw new Error(label + ': index out of range');
}

describe('real tiles', () => {
  it('has the expected slice', () => {
    expect(manifest.format).toBe('ub6-chunks-v1');
    expect(manifest.chunks.length).toBe(520);
    expect(manifest.chunk_size_m).toBe(CHUNK_M);
  });

  it('meshes every chunk: terrain, roads and all building footprints with exact roof area', () => {
    const hf = new HeightField(manifest.height_grid_n);
    let buildings = 0, tris = 0, worst = 0;
    for (const c of manifest.chunks) {
      const d = load(c.x, c.y);
      const grid = hf.setChunk(c.x, c.y, d.height_grid_dm);
      const hAt = (e: number, n: number) => hf.heightAt(e, n);
      const terrain = buildTerrain(grid, d.grid_n, c.x, c.y, hAt);
      checkMesh(terrain, `terrain ${c.x},${c.y}`);
      const roads = buildRoads(d.roads, c.x, c.y, hAt, true);
      checkMesh(roads, `roads ${c.x},${c.y}`);
      expect(buildRoads(d.roads, c.x, c.y, hAt, false).index.length).toBeLessThanOrEqual(roads.index.length);
      const b = buildBuildings(d.buildings, c.x, c.y);
      checkMesh(b, `buildings ${c.x},${c.y}`);
      let area = 0;
      for (const bd of d.buildings) for (const r of bd.rings) if (r.length >= 3 && Math.abs(ringArea(r)) >= 0.5) area += Math.abs(ringArea(r));
      expect(Math.abs(b.roofArea - area), `roof area ${c.x},${c.y}`).toBeLessThan(Math.max(0.5, area * 1e-4));
      buildings += d.buildings.length;
      const t = (terrain.index.length + roads.index.length + b.index.length) / 3;
      tris += t; worst = Math.max(worst, t);
      hf.removeChunk(c.x, c.y);
    }
    expect(buildings).toBe(manifest.stats.buildings);
    // geometry budget: the densest chunk stays far below what a phone draws comfortably
    expect(worst).toBeLessThan(40000);
    console.log(`all chunks: ${tris} triangles, densest chunk ${worst}`);
  });

  it('samples terrain exactly at grid points and continuously across chunk borders', () => {
    const hf = new HeightField(manifest.height_grid_n);
    const a = load(0, 0), b = load(1, 0);
    hf.setChunk(0, 0, a.height_grid_dm); hf.setChunk(1, 0, b.height_grid_dm);
    expect(hf.heightAt(0, 0)).toBeCloseTo(a.height_grid_dm[0] / 10 - ORIGIN_GROUND_M, 3);
    expect(hf.heightAt(16, 32)).toBeCloseTo(a.height_grid_dm[2 * 17 + 1] / 10 - ORIGIN_GROUND_M, 3);
    for (let n = 3; n < 256; n += 17) expect(Math.abs(hf.heightAt(255.999, n) - hf.heightAt(256.001, n))).toBeLessThan(0.02);
    // origin ground is about 1298 m, so world Y near the square is near zero
    expect(Math.abs(hf.heightAt(3.6, -6.9))).toBeLessThan(3);
  });

  it('keeps road ribbons on the ground', () => {
    const hf = new HeightField(manifest.height_grid_n);
    const d = load(0, -1);
    hf.setChunk(0, -1, d.height_grid_dm);
    const m = buildRoads(d.roads, 0, -1, (e, n) => hf.heightAt(e, n), true);
    expect(m.index.length).toBeGreaterThan(0);
    for (let i = 0; i < m.position.length; i += 3) {
      const e = m.position[i], n = -m.position[i + 2] - 256;
      if (e < 0 || e > 256 || n < -256 || n > 0) continue;        // edges past the chunk use the clamped fallback
      const gap = m.position[i + 1] - hf.heightAt(e, n);
      expect(gap).toBeGreaterThan(0.03); expect(gap).toBeLessThan(0.12);
    }
  });
});

describe('collision', () => {
  const square: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const c = makeCollider(square, 0, 9);
  it('detects inside / outside', () => {
    expect(pointInRing(c.ring, 5, 5)).toBe(true);
    expect(pointInRing(c.ring, -1, 5)).toBe(false);
  });
  it('pushes a circle out through the nearest wall, from outside and from inside', () => {
    const p: [number, number] = [-0.1, 5];
    expect(pushOut(c, p, 0.35)).toBe(true);
    expect(p[0]).toBeCloseTo(-0.35); expect(p[1]).toBeCloseTo(5);
    const q: [number, number] = [9.5, 4];
    expect(pushOut(c, q, 0.35)).toBe(true);
    expect(q[0]).toBeCloseTo(10.35);
    const far: [number, number] = [-3, 5];
    expect(pushOut(c, far, 0.35)).toBe(false);
  });

  it('never buries a building in the terrain bulge under it (Government Palace)', () => {
    const hf = new HeightField(manifest.height_grid_n);
    for (let x = -2; x <= 1; x++) for (let y = -1; y <= 1; y++) hf.setChunk(x, y, load(x, y).height_grid_dm);
    const hAt = (e: number, n: number) => hf.heightAt(e, n);
    const palace = load(-1, 0).buildings.filter((b) => b.name === 'Засгийн газрын ордон');
    expect(palace.length).toBe(1);
    const [lo, hi] = groundRange(palace[0].rings[0], hAt);
    expect(hi - lo).toBeGreaterThan(palace[0].height);          // the raw placement would be buried
    const m = buildBuildings(palace, -1, 0, hAt);
    let top = -Infinity, bottom = Infinity;
    for (let i = 1; i < m.position.length; i += 3) { top = Math.max(top, m.position[i]); bottom = Math.min(bottom, m.position[i]); }
    expect(top).toBeGreaterThanOrEqual(hi + palace[0].height);   // drawn at least as tall as the data says, above the bulge
    expect(bottom).toBeLessThanOrEqual(lo);
  });

  it('stops the player at a real building wall and lets them slide along it', () => {
    const hf = new HeightField(manifest.height_grid_n);
    const set = new ColliderSet();
    for (let x = -1; x <= 1; x++) for (let y = -2; y <= 0; y++) {
      const d = load(x, y);
      hf.setChunk(x, y, d.height_grid_dm);
      set.set(x + ',' + y, buildBuildings(d.buildings, x, y).colliders);
    }
    const world: World = { heightAt: (e, n) => hf.heightAt(e, n), colliders: set, bounds: { minE: -256, maxE: 512, minN: -512, maxN: 256 } };
    // Blue Sky Tower (landmarks.json): walk at it from 60 m west for 40 s of game time
    const target = { e: 82.63, n: -265.65 };
    const p = new Player();
    p.place(target.e - 60, target.n, world);
    const scratch: Collider[] = [];
    let moved = 0;
    for (let i = 0; i < 40 * 30; i++) {
      const before = p.e;
      p.update(1 / 30, { x: 0, y: 1, run: true, jump: i % 45 === 0 }, Math.PI / 2, world);   // camera looks east
      moved += Math.abs(p.e - before);
      expect(set.inside(p.e, p.n, p.y + 0.9, scratch), `inside a building at step ${i}`).toBe(false);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.y).toBeGreaterThanOrEqual(hf.heightAt(p.e, p.n) - 1e-3);
    }
    expect(moved).toBeGreaterThan(20);
    // the footprint was never entered: the nearest footprint edge is at least a body radius away
    const near = set.near(p.e, p.n, 1, []);
    for (const col of near) if (p.y < col.top - 0.5) expect(pointInRing(col.ring, p.e, p.n)).toBe(false);
    expect(RADIUS).toBeGreaterThan(0);
  });

  it('jumps about one metre and lands back on the ground', () => {
    const hf = new HeightField(manifest.height_grid_n);
    hf.setChunk(0, -1, load(0, -1).height_grid_dm);
    const world: World = { heightAt: (e, n) => hf.heightAt(e, n), colliders: new ColliderSet(), bounds: { minE: 0, maxE: 256, minN: -256, maxN: 0 } };
    const p = new Player();
    p.place(100, -100, world);
    const ground = p.y;
    let peak = 0;
    p.update(1 / 60, { x: 0, y: 0, run: false, jump: true }, 0, world);
    for (let i = 0; i < 120; i++) { p.update(1 / 60, { x: 0, y: 0, run: false, jump: false }, 0, world); peak = Math.max(peak, p.y - ground); }
    expect(peak).toBeGreaterThan(0.8); expect(peak).toBeLessThan(1.3);
    expect(p.grounded).toBe(true); expect(p.y).toBeCloseTo(ground, 5);
  });
});
