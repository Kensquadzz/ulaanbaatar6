import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chunkOf, enuToGeo, geoToEnu, ORIGIN_LAT, ORIGIN_LON } from '../src/core/geo';

const landmarks = JSON.parse(fs.readFileSync(new URL('../../data/tiles/landmarks.json', import.meta.url), 'utf8')).found;

describe('geo', () => {
  it('maps the origin to zero', () => {
    const o = geoToEnu(ORIGIN_LAT, ORIGIN_LON);
    expect(Math.hypot(o.east, o.north, o.up)).toBeLessThan(1e-6);
  });
  it('agrees with the pipeline for every landmark (lat/lon are stored to 6 decimals, about 0.1 m)', () => {
    for (const key of Object.keys(landmarks)) {
      const l = landmarks[key];
      const p = geoToEnu(l.lat, l.lon);
      expect(Math.abs(p.east - l.east), key).toBeLessThan(0.15);
      expect(Math.abs(p.north - l.north), key).toBeLessThan(0.15);
      const g = enuToGeo(l.east, l.north);
      expect(Math.abs(g.lat - l.lat), key).toBeLessThan(2e-6);
      expect(Math.abs(g.lon - l.lon), key).toBeLessThan(2e-6);
    }
  });
  it('round-trips far from the origin', () => {
    const g = enuToGeo(-2500, -5300, 0);
    const p = geoToEnu(g.lat, g.lon, g.h);
    expect(Math.hypot(p.east + 2500, p.north + 5300)).toBeLessThan(1e-4);
  });
  it('assigns chunks with floor semantics', () => {
    expect(chunkOf(-0.1, 255.9)).toEqual([-1, 0]);
    expect(chunkOf(256, -256)).toEqual([1, -1]);
  });
});
