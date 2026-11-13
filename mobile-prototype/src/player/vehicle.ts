// Original compact city sedan and touch-first driving physics for ULAANBAATAR 6.
// Built from procedural geometry, not copied from any commercial game.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Collider } from '../world/collision';

export interface VehicleWorld {
  heightAt(east: number, north: number): number;
  colliders: {
    resolve(position: [number, number], minY: number, maxY: number, radius: number, stepUp: number, scratch: Collider[]): void;
  };
  bounds: { minE: number; maxE: number; minN: number; maxN: number };
}
export interface DriveInput { x: number; y: number; run: boolean; brake: boolean }

const moveToward = (v: number, target: number, amount: number) =>
  v < target ? Math.min(target, v + amount) : Math.max(target, v - amount);
const mat = (color: number, roughness = 0.55, metalness = 0.12) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

/** Lightweight original compact hybrid sedan, with separate wheels, glass, lamps and trim. */
export class Vehicle {
  readonly root = new THREE.Group();
  east = 0; north = 0; y = 0; heading = 0; speed = 0;
  private wheels: THREE.Group[] = [];
  private frontWheels: THREE.Group[] = [];
  private scratch: Collider[] = [];
  private readonly wheelRadius = 0.34;
  private procedural = new THREE.Group();
  private loadedWheels: { node: THREE.Object3D; front: boolean }[] = [];
  private loader = new GLTFLoader();

  constructor() {
    this.root.name = 'UB6 original compact sedan';
    this.root.userData.kind = 'vehicle';
    this.root.add(this.procedural);
    const body = mat(0x858f98, 0.28, 0.66);
    const dark = mat(0x252b31, 0.68, 0.24);
    const glass = new THREE.MeshStandardMaterial({ color: 0x203a4e, roughness: 0.16, metalness: 0.3, transparent: true, opacity: 0.88 });
    const rubber = mat(0x141619, 0.96, 0.01);
    const alloy = mat(0xb5bdc5, 0.24, 0.78);
    const head = new THREE.MeshStandardMaterial({ color: 0xeaf5ff, emissive: 0x7897bd, emissiveIntensity: 0.9, roughness: 0.22 });
    const tail = new THREE.MeshStandardMaterial({ color: 0xb52a1c, emissive: 0x8d1007, emissiveIntensity: 0.65, roughness: 0.3 });
    const add = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
      this.procedural.add(m); return m;
    };

    // Chassis, bumpers and sculpted cabin.
    add(new THREE.BoxGeometry(1.82, 0.42, 4.3), body, 0, 0.62, 0);
    add(new THREE.BoxGeometry(1.86, 0.18, 3.85), dark, 0, 0.42, 0);
    add(new THREE.BoxGeometry(1.58, 0.73, 2.05), glass, 0, 1.16, -0.16);
    add(new THREE.BoxGeometry(1.50, 0.13, 1.72), body, 0, 1.57, -0.2);
    const windshield = add(new THREE.BoxGeometry(1.43, 0.50, 0.05), glass, 0, 1.18, 0.88);
    windshield.rotation.x = -0.34;
    const rearGlass = add(new THREE.BoxGeometry(1.42, 0.46, 0.05), glass, 0, 1.18, -1.22);
    rearGlass.rotation.x = 0.34;
    for (const side of [-1, 1]) {
      add(new THREE.BoxGeometry(0.055, 0.62, 1.95), body, side * 0.79, 1.18, -0.16);
      add(new THREE.BoxGeometry(0.025, 0.36, 1.34), glass, side * 0.802, 1.2, -0.16);
      add(new THREE.BoxGeometry(0.18, 0.13, 0.27), body, side * 0.92, 1.04, 0.62);
      add(new THREE.BoxGeometry(0.09, 0.09, 0.42), dark, side * 0.9, 0.5, 0.04);
      add(new THREE.BoxGeometry(0.43, 0.15, 0.07), head, side * 0.61, 0.79, 2.17);
      add(new THREE.BoxGeometry(0.37, 0.14, 0.07), tail, side * 0.64, 0.78, -2.17);
      add(new THREE.BoxGeometry(0.045, 0.025, 2.45), mat(0x555d65), side * 0.92, 0.76, -0.05);
    }
    add(new THREE.BoxGeometry(0.78, 0.20, 0.04), dark, 0, 0.72, 2.18);
    add(new THREE.BoxGeometry(1.88, 0.18, 0.20), dark, 0, 0.5, 2.10);
    add(new THREE.BoxGeometry(1.88, 0.18, 0.20), dark, 0, 0.5, -2.10);

    // Four free-spinning tyres; the front pair can steer independently.
    for (const side of [-1, 1]) for (const z of [-1.38, 1.38]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.96, 0.36, z);
      this.procedural.add(pivot);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(this.wheelRadius, this.wheelRadius, 0.24, 14), rubber);
      tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; pivot.add(tyre);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.246, 12), alloy);
      rim.rotation.z = Math.PI / 2; pivot.add(rim);
      this.wheels.push(pivot);
      if (z > 0) this.frontWheels.push(pivot);
    }

    // Direction is +Z on the model; a 180° offset makes heading 0 point north in UB world space.
    this.place(0, 0, 0);
  }

  /** Load a licensed GLB vehicle. The procedural car remains as a fallback if loading fails. */
  async loadModel(url: string): Promise<boolean> {
    try {
      const gltf = await this.loader.loadAsync(url);
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.x) || size.x <= 0 || size.y <= 0 || size.z <= 0) return false;
      const scale = new THREE.Vector3(1.82 / size.x, 1.72 / size.y, 3.82 / size.z);
      const wrapper = new THREE.Group();
      wrapper.scale.copy(scale);
      wrapper.position.y = -box.min.y * scale.y;
      wrapper.add(model);
      this.loadedWheels = [];
      model.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) { mesh.castShadow = false; mesh.receiveShadow = false; }
        const name = node.name.toLowerCase();
        if (name.includes('wheel')) this.loadedWheels.push({ node, front: name.includes('front') });
      });
      this.root.add(wrapper);
      this.procedural.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material.dispose());
      });
      this.procedural.clear();
      this.procedural.visible = false;
      this.wheels = [];
      this.frontWheels = [];
      this.root.userData.asset = url;
      this.root.userData.assetStatus = 'loaded';
      return true;
    } catch (error) {
      console.warn('Vehicle GLB failed; procedural fallback remains active', url, error);
      this.root.userData.assetStatus = 'fallback';
      return false;
    }
  }

  place(east: number, north: number, y: number) {
    this.east = east; this.north = north; this.y = y; this.speed = 0;
    this.root.position.set(east, y, -north);
    this.root.rotation.y = Math.PI + this.heading;
  }

  update(dt: number, input: DriveInput, world: VehicleWorld, snow = 0, rain = 0) {
    const h = Math.min(0.05, Math.max(0.001, dt));
    const grip = Math.max(0.38, 1 - snow * 0.55 - rain * 0.18);
    const throttle = Math.max(0, Math.min(1, input.y));
    const reverse = Math.max(0, Math.min(1, -input.y));

    if (input.brake) this.speed = moveToward(this.speed, 0, 15 * h);
    else if (reverse > 0.08) {
      if (this.speed > 0.5) this.speed = moveToward(this.speed, 0, 10 * reverse * h);
      else this.speed = Math.max(-7, this.speed - 3.0 * reverse * h);
    } else if (throttle > 0.08) {
      const cap = input.run ? 34 : 26;
      this.speed = Math.min(cap, this.speed + (4.8 + (input.run ? 2.7 : 0)) * throttle * grip * h);
    } else {
      this.speed *= Math.exp(-0.78 * h);
      if (Math.abs(this.speed) < 0.04) this.speed = 0;
    }

    // Reduced steering at high speed; snow/rain lower available grip.
    const steer = input.x * (0.52 / (1 + Math.abs(this.speed) * 0.05)) * grip;
    if (Math.abs(this.speed) > 0.05) this.heading += (this.speed / 2.72) * Math.tan(steer) * h;

    const beforeE = this.east, beforeN = this.north;
    const pos: [number, number] = [
      this.east + Math.sin(this.heading) * this.speed * h,
      this.north + Math.cos(this.heading) * this.speed * h,
    ];
    world.colliders.resolve(pos, this.y, this.y + 1.75, 1.02, 0, this.scratch);
    const b = world.bounds;
    this.east = Math.max(b.minE, Math.min(b.maxE, pos[0]));
    this.north = Math.max(b.minN, Math.min(b.maxN, pos[1]));
    const moved = Math.hypot(this.east - beforeE, this.north - beforeN);
    if (moved < Math.abs(this.speed) * h * 0.2) this.speed *= 0.12;

    this.y = world.heightAt(this.east, this.north);
    this.root.position.set(this.east, this.y, -this.north);
    this.root.rotation.y = Math.PI + this.heading;
    this.frontWheels.forEach(w => { w.rotation.y = -steer; });
    this.wheels.forEach(w => {
      const tyre = w.children[0] as THREE.Mesh;
      const rim = w.children[1] as THREE.Mesh;
      tyre.rotation.x += this.speed * h / this.wheelRadius;
      rim.rotation.x += this.speed * h / this.wheelRadius;
    });
    this.loadedWheels.forEach(({ node, front }) => {
      node.rotation.x += this.speed * h / this.wheelRadius;
      if (front) node.rotation.y = -steer;
    });
  }
}
