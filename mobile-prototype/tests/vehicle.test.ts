import { describe, expect, it } from 'vitest';
import { Vehicle, type VehicleWorld } from '../src/player/vehicle';

const world = {
  heightAt: () => 0,
  colliders: { resolve: () => {} },
  bounds: { minE: -100, maxE: 100, minN: -100, maxN: 100 },
} as unknown as VehicleWorld;

describe('vehicle controller', () => {
  it('accelerates north from a stationary start', () => {
    const car = new Vehicle();
    car.place(0, 0, 0);
    for (let i = 0; i < 60; i++) car.update(1 / 30, { x: 0, y: 1, run: false, brake: false }, world);
    expect(car.speed).toBeGreaterThan(5);
    expect(car.north).toBeGreaterThan(1);
    expect(car.east).toBeCloseTo(0, 3);
  });
  it('brakes and can reverse', () => {
    const car = new Vehicle();
    car.place(0, 0, 0);
    for (let i = 0; i < 60; i++) car.update(1 / 30, { x: 0, y: 1, run: false, brake: false }, world);
    const before = car.speed;
    for (let i = 0; i < 20; i++) car.update(1 / 30, { x: 0, y: 0, run: false, brake: true }, world);
    expect(car.speed).toBeLessThan(before);
    for (let i = 0; i < 90; i++) car.update(1 / 30, { x: 0, y: -1, run: false, brake: false }, world);
    expect(car.speed).toBeLessThan(0);
  });
  it('steers and keeps speed inside the designed cap', () => {
    const car = new Vehicle();
    car.place(0, 0, 0);
    for (let i = 0; i < 90; i++) car.update(1 / 30, { x: 1, y: 1, run: true, brake: false }, world);
    expect(Math.abs(car.heading)).toBeGreaterThan(0.2);
    expect(Math.abs(car.speed)).toBeLessThanOrEqual(34);
  });
});

describe('vehicle facing', () => {
  it('the model front (+Z) points the way the car drives, for any heading', async () => {
    const THREE = await import('three');
    const { Vehicle } = await import('../src/player/vehicle');
    const world = { heightAt: () => 0, colliders: { resolve() {} }, bounds: { minE: -1e9, maxE: 1e9, minN: -1e9, maxN: 1e9 } };
    for (const h of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const v = new Vehicle(); v.heading = h; v.place(0, 0, 0);
      for (let i = 0; i < 30; i++) v.update(0.033, { x: 0, y: 1, run: false, brake: false }, world as never);
      v.root.updateMatrixWorld(true);
      const front = v.root.localToWorld(new THREE.Vector3(0, 0, 1)).sub(v.root.position).normalize();
      const moved = v.root.position.clone().setY(0).normalize();
      expect(front.dot(moved)).toBeGreaterThan(0.99);
    }
  });
});
