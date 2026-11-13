import { describe, expect, it } from 'vitest';
import { closestSegSeg, pushCircleFromCars, resolveCars, type CarLike } from '../src/world/carcollide';

const car = (east: number, north: number, heading: number, speed: number): CarLike => ({ east, north, heading, speed, halfLength: 2.2, halfWidth: 0.9 });

describe('car collision', () => {
  it('finds closest points between crossing segments', () => {
    const [s, t] = closestSegSeg(-1, 0, 1, 0, 0, -1, 0, 1);
    expect(s).toBeCloseTo(0.5); expect(t).toBeCloseTo(0.5);
  });
  it('a car driving into a parked car is stopped and pushes it', () => {
    const a = car(0, 0, 0, 15), b = car(0, 4, 0, 0);     // a drives north into b (overlap 0.4 m)
    const hits = resolveCars([{ car: a, mass: 1.3 }, { car: b, mass: 1.3 }]);
    expect(hits.length).toBe(1);
    expect(hits[0].impact).toBeCloseTo(15, 0);
    expect(a.speed).toBeLessThan(6);
    expect(b.speed).toBeGreaterThan(5);
    const gap = b.north - a.north;
    expect(gap).toBeGreaterThanOrEqual(4.39);
  });
  it('side by side cars that do not touch are left alone', () => {
    const a = car(0, 0, 0, 10), b = car(2.0, 0, 0, 10);
    expect(resolveCars([{ car: a, mass: 1 }, { car: b, mass: 1 }]).length).toBe(0);
    expect(a.speed).toBe(10);
  });
  it('a person on foot is pushed out of a car', () => {
    const pos: [number, number] = [0.3, 0.5];
    expect(pushCircleFromCars(pos, 0.4, [car(0, 0, 0, 0)])).toBe(true);
    expect(Math.abs(pos[0])).toBeGreaterThanOrEqual(1.29);
  });
});
