import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fitTransform, footprintRect, LANDMARK_MODELS } from '../src/world/landmarks3d';
import { TRAFFIC_MODELS } from '../src/world/traffic';

const pub = path.resolve(__dirname, '../public/models');

describe('Higgsfield assets', () => {
  it('every runtime GLB referenced by the game is present and is a glTF binary', () => {
    const files = [
      'higgsfield/vehicles/hf-hybrid-sedan.glb',
      'higgsfield/characters/hf-player-winter.glb',
      'higgsfield/characters/hf-woman-winter.glb',
      ...LANDMARK_MODELS.map((l) => 'higgsfield/' + l.file),
      ...TRAFFIC_MODELS.map((m) => (m.url.startsWith('higgsfield/') ? m.url : 'vehicles/' + m.url)),
      ...TRAFFIC_MODELS.filter((m) => m.fallback).map((m) => 'vehicles/' + m.fallback),
    ];
    for (const f of files) {
      const buf = fs.readFileSync(path.join(pub, f));
      expect(buf.subarray(0, 4).toString('latin1'), f).toBe('glTF');
    }
  });

  it('minimum-area rectangle recovers a rotated 40 x 20 m footprint', () => {
    const a = 0.5, c = Math.cos(a), s = Math.sin(a);
    const ring: [number, number][] = [[-20, -10], [20, -10], [20, 10], [-20, 10]].map(([x, y]) => [100 + x * c - y * s, 50 + x * s + y * c]);
    const r = footprintRect(ring);
    expect(r.ce).toBeCloseTo(100, 5); expect(r.cn).toBeCloseTo(50, 5);
    expect([r.hu, r.hv].sort((p, q) => p - q)).toEqual([expect.closeTo(10, 5), expect.closeTo(20, 5)]);
  });

  it('fit puts the model front toward the target and stretches it to the footprint and height', () => {
    const ring: [number, number][] = [[-20, -10], [20, -10], [20, 10], [-20, 10]];
    const r = footprintRect(ring);
    const f = fitTransform(r, new THREE.Vector3(10, 5, 4), [0, -100], 2, 22);   // target due south
    expect(f.scale.x).toBeCloseTo(4, 5);      // 40 m wide front / 10 m model
    expect(f.scale.z).toBeCloseTo(5, 5);      // 20 m deep / 4 m model
    expect(f.scale.y).toBeCloseTo(4, 5);      // 20 m tall / 5 m model
    // model +Z rotated by yaw must point south (north = -z in three.js, so south = +z)
    const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
    expect(front.z).toBeCloseTo(1, 5);
    expect(f.position.y).toBe(2);
  });
});
