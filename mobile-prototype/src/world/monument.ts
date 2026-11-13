// Sukhbaatar equestrian statue in the centre of Sukhbaatar Square (sculptor S. Choimbol, 1946).
//
// HONEST STATUS: hand-modelled from the owner's reference photos (2026-11-13), not a scan.
// From the photos: a bronze rider on a rearing horse, right arm raised; the horse faces EAST (seen in
// profile from the south with the palace behind); it stands on a rough natural rock with a bronze
// relief on the south face and an inscription panel on the east end; the rock sits on a stepped red
// granite base; a ring of stone lions on posts joined by iron chains surrounds it; flower beds round
// the outside. ESTIMATED: every size, the lion count, the rider's shape (simple forms), the horse's
// pose (the low-poly horse from the owner's Higgsfield project, tipped back to rear).
// Built with front +Z (the way the horse faces), ground at y = 0.
import * as THREE from 'three';
import { loadHf, bakeGroup } from './hfassets';
import { bakeByMaterial, canvasTex, limb, std } from './proc';

const BRONZE = std('monument bronze', 0x4b4232, 0.42, 0.75);
const RED_GRANITE = std('monument red granite', 0x7d5249, 0.6, 0.05);
const ROCK = new THREE.MeshStandardMaterial({ name: 'monument rock (lit)', color: 0xb9a78b, roughness: 0.95, metalness: 0, flatShading: true });
ROCK.emissive.set(0xffcf90); ROCK.userData.glow = 0.12;
const LION = new THREE.MeshStandardMaterial({ name: 'monument stone lions', color: 0xd7d1c6, roughness: 0.85, flatShading: true });
const IRON = std('monument chains', 0x2b2b2b, 0.5, 0.8);
const GREY = std('monument grey granite', 0x9b968e, 0.75, 0.02);
let flowerMat: THREE.MeshStandardMaterial | null = null;
/** Materials of the monument that light up at night (floodlit rock). */
export const MONUMENT_GLOW = [ROCK];

/** Fence square half size (m): the stone lions and chains; used as the collider. */
export const MONUMENT_HALF = { x: 6.5, z: 6.5 };
export const PEDESTAL_H = 7.2;

let horseGeo: Promise<THREE.BufferGeometry | null> | null = null;
/** The Higgsfield horse baked into one geometry, facing +Z, or null if it failed. Cached. */
export function loadHorse(): Promise<THREE.BufferGeometry | null> {
  horseGeo ??= loadHf('props/hf-horse.glb').then((h) => {
    const g = bakeGroup(h);
    if (g) { g.rotateY(Math.PI); g.computeBoundingBox(); }   // the horse model faces -Z
    return g;
  }).catch((err) => { console.warn('horse model failed', err); return null; });
  return horseGeo;
}

/** Rough natural rock: a subdivided box, tapered, rounded and dented by a fixed pseudo-noise. */
function rock(w: number, h: number, d: number) {
  const g = new THREE.BoxGeometry(w, h, d, 7, 6, 9);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = (x: number, y: number, z: number) =>
    Math.sin(x * 2.1 + y * 1.3) * Math.cos(z * 1.7 - x * 0.9) * 0.5 + Math.sin(y * 3.7 + z * 2.3) * 0.25 + Math.cos(x * 4.1 - z * 3.3 + y) * 0.2;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = (y + h / 2) / h;
    const taper = 1 - 0.18 * t;
    const ux = x / (w / 2), uz = z / (d / 2), uy = y / (h / 2);
    const round = 1 - 0.1 * (ux * ux * uz * uz) - 0.08 * Math.max(0, uy) * (ux * ux + uz * uz) / 2;
    const k = n(x, y, z) * (t > 0.97 ? 0.08 : 0.32);
    const len = Math.hypot(x, z) || 1;
    x = x * taper * round + (x / len) * k; z = z * taper * round + (z / len) * k;
    if (t > 0.97) y = h / 2 - 0.05 * Math.abs(n(x, 0, z)); else y += k * 0.3 * (t > 0.05 ? 1 : 0);
    p.setXYZ(i, x, y, z);
  }
  const out = g.toNonIndexed(); g.dispose(); out.computeVertexNormals();
  return out;
}

/** Sitting stone lion on a post (simple forms), facing +Z, base at the origin. */
export function lion(root: THREE.Object3D, x: number, z: number, ry: number) {
  const L = new THREE.Group(); L.position.set(x, 0, z); L.rotation.y = ry; root.add(L);
  const add = (g: THREE.BufferGeometry, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1, mat: THREE.Material = LION) => {
    const m = new THREE.Mesh(g, mat); m.position.set(px, py, pz); m.scale.set(sx, sy, sz); L.add(m);
  };
  add(new THREE.BoxGeometry(1.0, 0.9, 1.0), 0, 0.45, 0, 1, 1, 1, GREY);          // post
  add(new THREE.SphereGeometry(0.42, 8, 6), 0, 1.25, -0.1, 1, 1.15, 1.1);        // haunches and body
  add(new THREE.IcosahedronGeometry(0.36, 0), 0, 1.85, 0.12, 1.15, 1.05, 0.9);   // mane
  add(new THREE.BoxGeometry(0.34, 0.28, 0.3), 0, 1.78, 0.42);                     // muzzle
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.16, 0.6, 0.18), s * 0.17, 1.2, 0.32);   // front legs
}

/** Builds the monument (front +Z), ground at y = 0. Falls back to simple forms if the horse fails. */
export async function buildSukhbaatarMonument(): Promise<THREE.Group> {
  const root = new THREE.Group();
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); parent.add(m); return m;
  };
  const slab = (mat: THREE.Material, w: number, h: number, d: number, y: number) => add(new THREE.BoxGeometry(w, h, d), mat, 0, y + h / 2, 0);

  // platform with two steps, red granite base in two steps, the rock
  slab(GREY, 17, 0.3, 17, -0.6); slab(GREY, 17, 0.3, 17, -0.3); slab(GREY, 15.6, 0.3, 15.6, 0);
  slab(RED_GRANITE, 7.8, 0.9, 10.2, 0.3);
  slab(RED_GRANITE, 6.6, 0.9, 8.8, 1.2);
  const RW = 4.8, RH = 5.0, RD = 7.0, rockY = 2.1;
  add(rock(RW, RH, RD), ROCK, 0, rockY + RH / 2, 0);
  // bronze relief on the south face (local -X when the horse faces east) and the inscription panel
  const relief = add(new THREE.BoxGeometry(0.5, 1.7, 3.6), BRONZE, -RW / 2 * 0.92 - 0.1, rockY + 2.4, 0);
  relief.rotation.z = 0.05;
  add(new THREE.BoxGeometry(1.1, 2.6, 0.5), BRONZE, 0, rockY + 2.2, RD / 2 * 0.9 + 0.1);

  // stone lions on posts round the fence, iron chains sagging between them
  const F = MONUMENT_HALF.x, posts: THREE.Vector3[] = [];
  for (let side = 0; side < 4; side++) for (let i = 0; i < 3; i++) {
    const a = -F + (i * 2 * F) / 3;
    const [x, z] = side === 0 ? [a, -F] : side === 1 ? [F, a] : side === 2 ? [-a, F] : [-F, -a];
    posts.push(new THREE.Vector3(x, 0.3, z));
    lion(root, x, z, Math.atan2(x, z));
  }
  for (let i = 0; i < posts.length; i++) {
    const a = posts[i].clone().setY(1.05), b = posts[(i + 1) % posts.length].clone().setY(1.05);
    const mid = a.clone().lerp(b, 0.5); mid.y -= 0.55;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    add(new THREE.TubeGeometry(curve, 10, 0.07, 4, false), IRON);
  }
  // flower beds outside the fence on the north and south sides (layout ESTIMATED)
  flowerMat ??= std('monument flower beds', 0xffffff, 0.9, 0, {
    map: canvasTex(128, 128, (c) => {
      c.fillStyle = '#3f6b2a'; c.fillRect(0, 0, 128, 128);
      const cols = ['#d6243a', '#f3d12b', '#8a4fc9', '#f2f2f2', '#e86aa0', '#d6243a'];
      let s = 7;
      const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 900; i++) { c.fillStyle = cols[Math.floor(r() * cols.length)]; c.beginPath(); c.arc(r() * 128, r() * 128, 1.6 + r() * 1.6, 0, 7); c.fill(); }
    }),
  });
  for (const s of [-1, 1]) {
    const bed = new THREE.BoxGeometry(3.2, 0.5, 13);
    const uv = bed.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1, uv.getY(i) * 4);
    add(bed, flowerMat, s * 10.4, -0.35, 0);
    add(new THREE.BoxGeometry(3.6, 0.42, 13.4), GREY, s * 10.4, -0.4, 0);
  }

  // the statue: horse rearing on its hind legs, rider with the right arm raised
  const statue = new THREE.Group(); statue.position.y = rockY + RH - 0.1; root.add(statue);
  const horse = await loadHorse();
  const LEN = 4.4;                                  // horse length (larger than life, ESTIMATED)
  let backY = 2.0, seatZ = -0.2, k = LEN / 2.4;
  const rear = new THREE.Group(); statue.add(rear);
  if (horse) {
    const b = horse.boundingBox!, sz = b.getSize(new THREE.Vector3()), s = LEN / sz.z;
    const mesh = new THREE.Mesh(horse, BRONZE);
    mesh.scale.setScalar(s);
    // pivot on the hind hooves, then tip the front up
    rear.position.z = -LEN * 0.32;
    mesh.position.set(-(b.min.x + b.max.x) / 2 * s, -b.min.y * s, -b.min.z * s - LEN * 0.18);
    rear.add(mesh);
    backY = sz.y * s * 0.62; seatZ = LEN * 0.3;
  } else {
    const body = add(new THREE.CapsuleGeometry(0.45 * k, LEN * 0.5, 4, 8), BRONZE, 0, 1.6 * k, LEN * 0.32, rear);
    body.rotation.x = Math.PI / 2;
    rear.position.z = -LEN * 0.32; backY = 1.85 * k; seatZ = LEN * 0.3;
  }
  rear.rotation.x = -0.6;
  rider(rear, 0, backY, seatZ, k);

  const baked = bakeByMaterial(root, 'Сүхбаатарын хөшөө (зургаас загварчилсан)');
  root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry !== horse) m.geometry.dispose(); });
  return baked;
}

/** Rider in a deel and pointed hat, right arm raised, seated at (x, y, z) of the tipped horse. */
function rider(parent: THREE.Object3D, x: number, y: number, z: number, k: number) {
  const R = new THREE.Group(); R.position.set(x, y, z); R.rotation.x = 0.45; R.scale.setScalar(k); parent.add(R);
  const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
  const add = (g: THREE.BufferGeometry, px = 0, py = 0, pz = 0) => { const m = new THREE.Mesh(g, BRONZE); m.position.set(px, py, pz); R.add(m); return m; };
  add(new THREE.CylinderGeometry(0.2, 0.38, 0.5, 12), 0, 0.05, 0);          // deel skirt over the saddle
  add(new THREE.CylinderGeometry(0.22, 0.19, 0.6, 12), 0, 0.55, -0.02);     // torso
  add(new THREE.CylinderGeometry(0.205, 0.205, 0.08, 12), 0, 0.33, -0.02);  // belt
  add(new THREE.SphereGeometry(0.21, 12, 8), 0, 0.82, -0.02).scale.set(1.15, 0.6, 0.9);   // shoulders
  add(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), 0, 0.93, 0);          // neck
  add(new THREE.SphereGeometry(0.115, 12, 10), 0, 1.06, 0.01);              // head
  add(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 14), 0, 1.15, 0);        // hat brim
  add(new THREE.CylinderGeometry(0.1, 0.13, 0.13, 12), 0, 1.23, 0);         // hat crown
  add(new THREE.ConeGeometry(0.035, 0.12, 8), 0, 1.35, 0);                  // hat spike
  for (const s of [-1, 1]) {
    add(limb(V(s * 0.12, 0.05, 0), V(s * 0.27, -0.12, 0.3), 0.08, 0.07));   // thigh
    add(limb(V(s * 0.27, -0.12, 0.3), V(s * 0.29, -0.55, 0.25), 0.065, 0.055));   // shin
    add(new THREE.BoxGeometry(0.1, 0.1, 0.24), s * 0.29, -0.6, 0.31);       // boot, toe up
  }
  // right arm raised high and forward, open hand
  add(limb(V(0.22, 0.8, 0), V(0.32, 1.1, 0.12), 0.06, 0.055));
  add(limb(V(0.32, 1.1, 0.12), V(0.36, 1.48, 0.22), 0.05, 0.045));
  add(new THREE.BoxGeometry(0.06, 0.16, 0.1), 0.37, 1.58, 0.25);
  // left arm down to the reins, sword hanging at the left side
  add(limb(V(-0.22, 0.8, 0), V(-0.28, 0.52, 0.14), 0.06, 0.055));
  add(limb(V(-0.28, 0.52, 0.14), V(-0.12, 0.42, 0.4), 0.05, 0.045));
  add(limb(V(-0.26, 0.3, -0.05), V(-0.34, -0.55, 0.35), 0.022, 0.018));
}
