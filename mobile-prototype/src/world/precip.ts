// Rain / snow particles in a box that follows the camera. Only shown when the weather observation
// (or the player's explicit free-play choice) says it is raining or snowing.
import * as THREE from 'three';

const BOX = 34, HALF = BOX / 2, TALL = 22;

export class Precipitation {
  readonly points: THREE.Points;
  private pos: Float32Array; private seed: Float32Array;
  private mat: THREE.PointsMaterial;
  constructor(private max: number) {
    this.pos = new Float32Array(max * 3); this.seed = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * BOX; this.pos[i * 3 + 1] = Math.random() * TALL; this.pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
      this.seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.visible = false;
  }
  update(dt: number, cam: THREE.Vector3, rain: number, snow: number, windMs: number, daylight: number) {
    const amount = Math.max(rain, snow);
    this.points.visible = amount > 0.02;
    if (!this.points.visible) return;
    const isSnow = snow >= rain;
    const count = Math.floor(this.max * Math.min(1, 0.25 + amount));
    this.points.geometry.setDrawRange(0, count);
    this.mat.size = isSnow ? 0.11 : 0.05;
    const l = 0.35 + 0.65 * daylight;
    this.mat.color.setRGB(isSnow ? l : 0.6 * l, isSnow ? l : 0.68 * l, isSnow ? l : 0.8 * l);
    const fall = isSnow ? 1.6 : 13, drift = Math.min(6, windMs) * (isSnow ? 0.6 : 0.25);
    const p = this.pos;
    for (let i = 0; i < count; i++) {
      const s = this.seed[i];
      p[i * 3 + 1] -= fall * (0.7 + 0.6 * s) * dt;
      p[i * 3] += (drift + (isSnow ? Math.sin(p[i * 3 + 1] * 1.3 + s * 40) * 0.5 : 0)) * dt;
      if (p[i * 3 + 1] < -2) p[i * 3 + 1] += TALL;
      // keep the box centred on the camera by wrapping
      p[i * 3] = cam.x + ((((p[i * 3] - cam.x + HALF) % BOX) + BOX) % BOX) - HALF;
      p[i * 3 + 2] = cam.z + ((((p[i * 3 + 2] - cam.z + HALF) % BOX) + BOX) % BOX) - HALF;
    }
    this.points.position.y = cam.y - 4;
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
