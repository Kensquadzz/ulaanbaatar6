// Sukhbaatar equestrian statue in the centre of Sukhbaatar Square (sculptor S. Choimbol, 1946).
//
// HONEST STATUS: a STYLISED stand-in, not a scan. Real: the square and its centre (map data), that it
// is a rider on a horse with a raised right arm on a stone pedestal. Estimated: size, pedestal shape,
// the direction it faces, and the rider's figure, which is built here from simple shapes. The horse
// body is the low-poly horse from the owner's Higgsfield 3D Jutsu project. All of it is drawn in one
// bronze and one granite material.
import * as THREE from 'three';
import { loadHf, bakeGroup } from './hfassets';

const BRONZE = new THREE.MeshStandardMaterial({ color: 0x4a4636, roughness: 0.45, metalness: 0.75 });
const GRANITE = new THREE.MeshStandardMaterial({ color: 0x5b4a45, roughness: 0.7, metalness: 0.05 });

/** Pedestal footprint (m), for the collider: half width (x) and half depth (z). */
export const MONUMENT_HALF = { x: 2.1, z: 3.4 };
export const PEDESTAL_H = 4.0;

/** Builds the statue (front +Z), ground at y = 0. Falls back to a rider-only figure if the horse fails. */
export async function buildSukhbaatarMonument(): Promise<THREE.Group> {
  const g = new THREE.Group();
  g.name = 'Сүхбаатарын хөшөө (стилизац)';
  g.userData.kind = 'monument (stylised)';
  // two-step granite pedestal with a plinth cap
  const step = (w: number, h: number, d: number, y: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), GRANITE); m.position.y = y + h / 2; m.castShadow = m.receiveShadow = true; g.add(m); };
  step(MONUMENT_HALF.x * 2 + 1.6, 0.35, MONUMENT_HALF.z * 2 + 1.6, 0);
  step(MONUMENT_HALF.x * 2, PEDESTAL_H - 0.65, MONUMENT_HALF.z * 2, 0.35);
  step(MONUMENT_HALF.x * 2 + 0.4, 0.3, MONUMENT_HALF.z * 2 + 0.4, PEDESTAL_H - 0.3);

  const statue = new THREE.Group();
  statue.position.y = PEDESTAL_H;
  g.add(statue);
  const S = 2.3;                                    // well larger than life
  try {
    const horse = await loadHf('props/hf-horse.glb');
    const geo = bakeGroup(horse);
    if (geo) { const m = new THREE.Mesh(geo, BRONZE); m.scale.setScalar(S); m.rotation.y = Math.PI; m.castShadow = true; statue.add(m); }   // the horse model faces -Z
  } catch (err) { console.warn('horse model failed; rider only', err); }

  // rider (simple shapes, bronze): seated over the horse's back, right arm raised
  const part = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, BRONZE); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; statue.add(m); return m;
  };
  const seat = 1.55 * S, back = -0.15 * S;
  part(new THREE.CapsuleGeometry(0.2 * S, 0.42 * S, 4, 8), 0, seat + 0.36 * S, back, -0.08);                    // torso
  part(new THREE.SphereGeometry(0.12 * S, 10, 8), 0, seat + 0.78 * S, back + 0.02 * S);                         // head
  part(new THREE.CylinderGeometry(0.13 * S, 0.14 * S, 0.16 * S, 10), 0, seat + 0.9 * S, back + 0.02 * S);      // hat
  part(new THREE.ConeGeometry(0.06 * S, 0.12 * S, 8), 0, seat + 1.03 * S, back + 0.02 * S);                     // hat point
  for (const s of [-1, 1]) {
    part(new THREE.CapsuleGeometry(0.08 * S, 0.36 * S, 3, 6), s * 0.24 * S, seat + 0.02 * S, back + 0.14 * S, -1.2, s * 0.25);   // thigh
    part(new THREE.CapsuleGeometry(0.07 * S, 0.34 * S, 3, 6), s * 0.33 * S, seat - 0.3 * S, back + 0.26 * S, 0.15, s * 0.1);    // shin
  }
  part(new THREE.CapsuleGeometry(0.06 * S, 0.5 * S, 3, 6), 0.27 * S, seat + 0.86 * S, back + 0.08 * S, 0.25, -0.35);          // right arm raised
  part(new THREE.CapsuleGeometry(0.06 * S, 0.42 * S, 3, 6), -0.25 * S, seat + 0.3 * S, back + 0.22 * S, -0.9, 0.2);          // left arm on the reins
  // cape over the shoulders
  part(new THREE.ConeGeometry(0.32 * S, 0.7 * S, 10, 1, true), 0, seat + 0.36 * S, back - 0.12 * S, 0.12);
  return g;
}
