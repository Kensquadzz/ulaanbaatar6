// Visual upgrade V1: the styling layer must never alter what the data says, and its procedural
// parts (heights for default-only buildings, sidewalks, lamps) must be valid and deterministic.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildBuildings, buildingLook, ringArea, STYLE_COUNT } from '../src/world/meshing';
import { buildStreet, mergeMeshes } from '../src/world/street';
import { buildRoads } from '../src/world/meshing';
import { HeightField } from '../src/world/terrain';
import { pointInRing } from '../src/core/geo';
import type { ChunkData } from '../src/world/types';

const tiles = path.resolve(__dirname, '../../data/tiles');
const load = (x: number, y: number) => JSON.parse(fs.readFileSync(path.join(tiles, 'chunks', `${x}_${y}.json`), 'utf8')) as ChunkData;
const manifest = JSON.parse(fs.readFileSync(path.join(tiles, 'manifest.json'), 'utf8'));

describe('building looks', () => {
  const all = manifest.chunks.flatMap((c: { x: number; y: number }) => load(c.x, c.y).buildings);
  it('keeps every height the source actually provides', () => {
    let kept = 0;
    for (const b of all) {
      if (b.height_src === 'estimated_default' || b.name === 'Засгийн газрын ордон') continue;
      const look = buildingLook(b, Math.abs(ringArea(b.rings[0])), b.rings[0].length);
      expect(look.height).toBe(b.height); expect(look.visual).toBe(false); kept++;
    }
    expect(kept).toBeGreaterThan(1500);
  });
  it('gives default-only buildings varied, plausible, repeatable heights and several styles', () => {
    const heights = new Set<number>(), styles = new Set<number>();
    for (const b of all) {
      const A = Math.abs(ringArea(b.rings[0]));
      const a = buildingLook(b, A, b.rings[0].length), again = buildingLook(b, A, b.rings[0].length);
      expect(a).toEqual(again);
      expect(a.height).toBeGreaterThan(1.5);
      if (a.visual) expect(a.height).toBeLessThanOrEqual(45);
      expect(a.style).toBeGreaterThanOrEqual(0); expect(a.style).toBeLessThan(STYLE_COUNT);
      heights.add(a.height); styles.add(a.style);
    }
    expect(heights.size).toBeGreaterThan(15);
    expect(styles.size).toBeGreaterThanOrEqual(5);
  });
});

describe('street dressing', () => {
  it('builds valid sidewalks, crossings and lamps from the real roads without touching buildings', () => {
    const hf = new HeightField(manifest.height_grid_n);
    let lamps = 0, walk = 0, cross = 0;
    for (const [x, y] of [[0, -1], [-1, -1], [0, -2], [-3, -1]]) {
      const d = load(x, y);
      hf.setChunk(x, y, d.height_grid_dm);
      const hAt = (e: number, n: number) => hf.heightAt(e, n);
      const s = buildStreet(d.roads, d.buildings, x, y, hAt, true);
      const m = mergeMeshes(buildRoads(d.roads, x, y, hAt, true), s);
      const nv = m.position.length / 3;
      expect(m.normal.length).toBe(nv * 3); expect(m.uv.length).toBe(nv * 2); expect(m.color!.length).toBe(nv * 3);
      for (const v of m.position) expect(Number.isFinite(v)).toBe(true);
      for (const i of m.index) expect(i).toBeLessThan(nv);
      for (const l of s.lamps) {
        expect(l.e).toBeGreaterThanOrEqual(x * 256); expect(l.e).toBeLessThan((x + 1) * 256);
        for (const b of d.buildings) expect(pointInRing(b.rings[0], l.e, l.n)).toBe(false);
      }
      expect(buildStreet(d.roads, d.buildings, x, y, hAt, true).lamps).toEqual(s.lamps);
      expect(buildStreet(d.roads, d.buildings, x, y, hAt, false).index.length).toBe(0);
      lamps += s.lamps.length; walk += s.sidewalkM; cross += s.crossings;
    }
    expect(lamps).toBeGreaterThan(20); expect(walk).toBeGreaterThan(500); expect(cross).toBeGreaterThan(0);
  });
});

describe('districts', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(tiles, 'districts.json'), 'utf8'));
  const at = (e: number, n: number) => doc.districts.filter((d: { rings: [number, number][][] }) => d.rings.some((r) => pointInRing(r, e, n))).map((d: { name: string }) => d.name);
  it('places known landmarks in their real district', () => {
    expect(at(3.6, -6.9)).toEqual(['Сүхбаатар дүүрэг']);              // Sukhbaatar Square
    expect(at(-155, -3878)).toEqual(['Хан-Уул дүүрэг']);               // Zaisan Hill
  });
});

describe('building mesh', () => {
  it('carries one style index per vertex and still builds every footprint', () => {
    const d = load(0, -1);
    const m = buildBuildings(d.buildings, 0, -1);
    expect(m.style!.length).toBe(m.position.length / 3);
    for (const s of m.style!) { expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(STYLE_COUNT); }
    expect(m.colliders.length).toBeGreaterThanOrEqual(d.buildings.length);
    expect(buildBuildings(d.buildings, 0, -1, undefined, false).index.length).toBeLessThanOrEqual(m.index.length);
  });
});
