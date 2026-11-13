// Standing golden Buddha in Buddha Park at the foot of Zaisan hill, hand-modelled from the owner's
// reference photo (2026-11-13).
//
// HONEST STATUS: modelled by eye, not surveyed. Position: centre of the OSM footway ring round the
// statue (the Overture place "Buddha Monument" lies 18 m west of it, inside the same park). Facing
// north: in the photo the statue faces the camera with Bogd Khan mountain behind it, so it looks
// toward the city. From the photo: a white two-level base with a wide front stair, red double doors
// between two stone lions, side stairs with white railings up to the top terrace, a golden lotus
// throne and the standing gilded Buddha with blue hair, right hand raised, left hand lowered.
// ESTIMATED: every size (total ~24 m), the robe and face (simple forms).
// Local frame: front +Z, ground at y = 0, statue centre at the origin.
import * as THREE from 'three';
import { bakeByMaterial, limb, std, tiledBox } from './proc';
import { lion } from './monument';

let M: ReturnType<typeof makeMaterials> | null = null;
function makeMaterials() {
  return {
    white: std('buddha base white stone (lit)', 0xe2ddd2, 0.8, 0.02, {}, { color: 0xfff0d0, k: 0.12 }),
    gold: std('buddha gold', 0xd9a62b, 0.28, 0.9, {}, { color: 0xffc040, k: 0.35 }),
    hair: std('buddha hair blue', 0x1d2f6b, 0.5, 0.3),
    red: std('buddha doors red', 0x8e1d22, 0.6, 0.1),
    grey: std('buddha steps', 0xa9a49a, 0.85, 0),
  };
}

export const BUDDHA = { at: [-409.5, -3587.0] as [number, number], faces: [-409.5, -3400] as [number, number] };
/** Half extents of the base (x across, z depth), for the collider. */
export const BUDDHA_HALF = { x: 11, z: 9 };

export function buildBuddha(): THREE.Group {
  M ??= makeMaterials();
  const m = M;
  const root = new THREE.Group();
  const put = (g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = root) => { const mm = new THREE.Mesh(g, mat); mm.position.set(x, y, z); parent.add(mm); return mm; };
  const box = (mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
    put(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);

  // lower platform and the wide front stair down to the path
  const L = 1.8, T = 7.2;
  box(m.white, -11, 11, -1, L, -9, 9);
  for (let i = 0; i < 6; i++) box(m.grey, -6, 6, -1, L - (i + 1) * 0.3, 9 + i * 0.75, 9 + (i + 1) * 0.75);
  // upper block with the doors, lions and side stairs up to the top terrace
  put(tiledBox(15, T - L, 11, 15, T - L), m.white, 0, L + (T - L) / 2, -1.5);
  box(m.red, -2.4, -0.1, L, L + 3.2, 4, 4.1);
  box(m.red, 0.1, 2.4, L, L + 3.2, 4, 4.1);
  box(m.white, -3, 3, L + 3.2, L + 3.8, 3.8, 4.4);   // lintel
  lion(root, -5, 6.5, 0); lion(root, 5, 6.5, 0);
  for (const s of [-1, 1]) {
    // side stair running from the outer corner up to the terrace
    const n = 10;
    for (let i = 0; i < n; i++) {
      const x0 = s * (7.5 + ((n - i) * 3.4) / n), x1 = s * (7.5 + ((n - i - 1) * 3.4) / n);
      box(m.grey, Math.min(x0, x1), Math.max(x0, x1), L, L + ((i + 1) * (T - L)) / n, 1.2, 4.0);
    }
    for (let i = 0; i <= 6; i++) {   // railing posts along the stair
      const f = i / 6, x = s * (7.5 + 3.4 * (1 - f)), y = L + f * (T - L);
      box(m.white, x - 0.12, x + 0.12, y, y + 1.0, 3.75, 4.0);
    }
  }
  // terrace railing on the front edge
  for (let i = 0; i <= 10; i++) { const x = -7 + i * 1.4; box(m.white, x - 0.12, x + 0.12, T, T + 1.0, 3.75, 4.0); }
  box(m.white, -7.2, 7.2, T + 0.9, T + 1.05, 3.7, 4.05);

  // lotus throne: drum plus two rows of petals
  const lotusY = T;
  put(new THREE.CylinderGeometry(3.0, 3.3, 1.2, 24), m.gold, 0, lotusY + 0.6, -1.5);
  for (const [r, y, n, sz] of [[3.3, 0.9, 16, 1.0], [2.8, 1.8, 12, 0.9]] as const) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const petal = put(new THREE.SphereGeometry(sz, 8, 6), m.gold, Math.sin(a) * r, lotusY + y, -1.5 + Math.cos(a) * r);
      petal.scale.set(0.8, 1.15, 0.45); petal.rotation.y = a;
    }
  }
  put(new THREE.CylinderGeometry(2.6, 2.9, 0.6, 24), m.gold, 0, lotusY + 2.3, -1.5);

  // standing Buddha (about 14 m), robe as a lathe, simple head, blue hair, raised right hand
  const B = new THREE.Group(); B.position.set(0, lotusY + 2.6, -1.5); root.add(B);
  const prof = [[1.95, 0], [1.85, 0.6], [1.7, 2.5], [1.55, 5.5], [1.6, 8.0], [1.8, 9.8], [1.95, 10.8], [1.75, 11.5], [1.0, 11.9], [0.5, 12.1]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const robe = new THREE.LatheGeometry(prof, 28);
  robe.scale(1, 1, 0.62);
  put(robe, m.gold, 0, 0, 0, B);
  put(new THREE.CylinderGeometry(0.42, 0.5, 0.7, 14), m.gold, 0, 12.3, 0, B);                       // neck
  const head = put(new THREE.SphereGeometry(1.0, 20, 16), m.gold, 0, 13.4, 0.1, B); head.scale.set(0.95, 1.18, 1);
  const hair = put(new THREE.SphereGeometry(1.03, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), m.hair, 0, 13.55, 0.05, B); hair.scale.set(0.97, 1.15, 1.02);
  put(new THREE.SphereGeometry(0.42, 12, 10), m.hair, 0, 14.65, 0, B);                              // ushnisha
  put(new THREE.ConeGeometry(0.16, 0.4, 8), m.gold, 0, 15.1, 0, B);                                  // top jewel
  for (const s of [-1, 1]) put(new THREE.BoxGeometry(0.18, 0.95, 0.35), m.gold, s * 0.98, 13.0, 0.0, B);   // long ears
  const V = (a: number, b: number, c: number) => new THREE.Vector3(a, b, c);
  // right arm (statue's right = -X when it faces +Z): raised hand, palm forward
  put(limb(V(-1.75, 11.0, 0), V(-2.15, 8.5, 0.35), 0.45, 0.4), m.gold, 0, 0, 0, B);
  put(limb(V(-2.15, 8.5, 0.35), V(-2.3, 10.6, 1.0), 0.38, 0.32), m.gold, 0, 0, 0, B);
  put(new THREE.BoxGeometry(0.55, 1.1, 0.25), m.gold, -2.32, 11.1, 1.08, B);
  // left arm lowered, hand forward at the hip, sleeve hanging
  put(limb(V(1.75, 11.0, 0), V(2.1, 8.4, 0.3), 0.45, 0.4), m.gold, 0, 0, 0, B);
  put(limb(V(2.1, 8.4, 0.3), V(2.0, 7.2, 1.1), 0.38, 0.32), m.gold, 0, 0, 0, B);
  put(new THREE.BoxGeometry(0.5, 0.9, 0.25), m.gold, 2.0, 6.7, 1.2, B);
  put(new THREE.BoxGeometry(0.9, 5.5, 0.35), m.gold, 2.35, 5.2, 0.3, B);                             // sleeve fold

  const baked = bakeByMaterial(root, 'Буддагийн хөшөө (зургаас загварчилсан)');
  root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) g.dispose(); });
  return baked;
}
