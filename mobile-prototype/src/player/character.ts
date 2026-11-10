// TEMPORARY PLACEHOLDER character: an original figure assembled from primitives in code (a simple
// deel-style coat, sash, boots and hat) with a procedural walk/run/jump cycle. It stands in until
// a proper rigged, licensed character model exists. No third-party assets are used.
import * as THREE from 'three';

export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL: THREE.Group; private legR: THREE.Group; private armL: THREE.Group; private armR: THREE.Group;
  private phase = 0;
  private blob: THREE.Mesh;

  constructor(pbr: boolean) {
    const mat = (c: number, r = 0.8) => (pbr ? new THREE.MeshStandardMaterial({ color: c, roughness: r }) : new THREE.MeshLambertMaterial({ color: c }));
    const coat = mat(0x1f4f8f), sash = mat(0xd8862a), skin = mat(0xd9a57a, 0.7), boot = mat(0x2a1d16), hat = mat(0x3b2a20), trouser = mat(0x2b2f3a);
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o;
    };
    // torso + coat skirt (hips at y = 0.92)
    add(this.body, new THREE.CylinderGeometry(0.19, 0.23, 0.56, 12), coat, 0, 1.22, 0);
    add(this.body, new THREE.CylinderGeometry(0.235, 0.3, 0.42, 12), coat, 0, 0.78, 0);
    add(this.body, new THREE.CylinderGeometry(0.24, 0.24, 0.07, 12), sash, 0, 0.98, 0);
    add(this.body, new THREE.SphereGeometry(0.2, 12, 8), coat, 0, 1.47, 0).scale.set(1.15, 0.5, 0.8);   // shoulders
    add(this.body, new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), skin, 0, 1.56, 0);
    add(this.body, new THREE.SphereGeometry(0.115, 14, 10), skin, 0, 1.67, 0);
    add(this.body, new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hat, 0, 1.7, 0);
    add(this.body, new THREE.ConeGeometry(0.06, 0.1, 8), sash, 0, 1.86, 0);
    const limb = (x: number, y: number, len: number, rad: number, m: THREE.Material, foot: boolean) => {
      const g = new THREE.Group(); g.position.set(x, y, 0);
      add(g, new THREE.CapsuleGeometry(rad, len - rad * 2, 3, 8), m, 0, -len / 2, 0);
      if (foot) add(g, new THREE.BoxGeometry(0.11, 0.1, 0.26), boot, 0, -len + 0.03, 0.05);
      else add(g, new THREE.SphereGeometry(0.05, 8, 6), skin, 0, -len, 0);
      this.body.add(g); return g;
    };
    this.legL = limb(-0.1, 0.9, 0.88, 0.075, trouser, true); this.legR = limb(0.1, 0.9, 0.88, 0.075, trouser, true);
    this.armL = limb(-0.28, 1.44, 0.6, 0.055, coat, false); this.armR = limb(0.28, 1.44, 0.6, 0.055, coat, false);
    this.root.add(this.body);
    // soft contact shadow used when real shadows are off (low preset, night)
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.04;
    this.root.add(this.blob);
    // the model is authored facing +z; rotate so heading 0 (north) faces -z
    this.body.rotation.y = Math.PI;
  }

  setBlob(on: boolean) { this.blob.visible = on; }

  /** heading: radians clockwise from north. */
  update(dt: number, x: number, y: number, z: number, heading: number, speed: number, grounded: boolean, vy: number) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = -heading;
    (this.blob.material as THREE.MeshBasicMaterial).opacity = grounded ? 0.32 : 0.12;
    const run = Math.min(1, speed / 7);
    if (grounded && speed > 0.15) {
      this.phase += dt * (3.2 + speed * 1.55);
      const swing = 0.35 + run * 0.65, s = Math.sin(this.phase);
      this.legL.rotation.x = s * swing; this.legR.rotation.x = -s * swing;
      this.armL.rotation.x = -s * swing * 0.9; this.armR.rotation.x = s * swing * 0.9;
      this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.035 * (0.5 + run);
      this.body.rotation.x = -run * 0.16;
    } else if (!grounded) {
      const up = vy > 0 ? 1 : 0.4;
      this.legL.rotation.x = 0.5 * up; this.legR.rotation.x = -0.25 * up;
      this.armL.rotation.x = -1.1 * up; this.armR.rotation.x = -0.9 * up;
      this.body.rotation.x = -0.05;
    } else {
      const k = Math.min(1, dt * 10);
      for (const l of [this.legL, this.legR, this.armL, this.armR]) l.rotation.x *= 1 - k;
      this.body.position.y *= 1 - k; this.body.rotation.x *= 1 - k;
      this.armL.rotation.z = -0.06; this.armR.rotation.z = 0.06;
    }
  }
}
