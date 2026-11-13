// Small helpers for the hand-modelled square landmarks (Government Palace, State Department Store,
// Sukhbaatar monument): canvas textures, limbs, boxes with tiled UVs, and a baker that merges a
// whole object tree into one mesh per material (few draw calls on phones).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Materials that light up after dusk; LandmarkModels.setNight drives them. */
export const PROC_GLOW: THREE.MeshStandardMaterial[] = [];

export function std(name: string, color: number, roughness: number, metalness: number,
                    extra: Partial<THREE.MeshStandardMaterialParameters> = {}, glow?: { color: number; k: number }) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  m.name = name;
  if (glow) {
    m.emissive.set(glow.color); m.userData.glow = glow.k; m.emissiveIntensity = 0.03 * glow.k;
    PROC_GLOW.push(m);
  }
  return m;
}

export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** A cylinder from a to b (a limb, a pole, a chain link run). */
export function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, seg = 8) {
  const d = b.clone().sub(a), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/**
 * Box whose side UVs are in tiles (tileW metres wide, tileH metres tall) so a window tile texture
 * repeats per bay and floor. Top and bottom faces sample the tile's corner (frame colour).
 */
export function tiledBox(w: number, h: number, d: number, tileW: number, tileH: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z; four vertices each
  const faceW = [d, d, 0, 0, w, w];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    if (!faceW[f]) { uv.setXY(k, 0.01, 0.01); continue; }
    uv.setXY(k, uv.getX(k) * Math.max(1, Math.round(faceW[f] / tileW)), uv.getY(k) * Math.max(1, Math.round(h / tileH)));
  }
  return g;
}

/**
 * Merges every mesh below `root` into one geometry per material, expressed in root's space.
 * Returns a new group holding one mesh per material.
 */
export function bakeByMaterial(root: THREE.Object3D, name: string): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), rel = new THREE.Matrix4();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {};
    rel.multiplyMatrices(inv, mesh.matrixWorld);
    g.applyMatrix4(rel);
    // mirrored transforms flip the winding; keep faces pointing out
    if (rel.determinant() < 0) {
      const p = g.attributes.position.array as Float32Array, n = g.attributes.normal.array as Float32Array, u = g.attributes.uv.array as Float32Array;
      for (let i = 0; i < p.length; i += 9) for (const arr of [p, n]) for (let c = 0; c < 3; c++) { const t = arr[i + 3 + c]; arr[i + 3 + c] = arr[i + 6 + c]; arr[i + 6 + c] = t; }
      for (let i = 0; i < u.length; i += 6) for (let c = 0; c < 2; c++) { const t = u[i + 2 + c]; u[i + 2 + c] = u[i + 4 + c]; u[i + 4 + c] = t; }
    }
    g.clearGroups();
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    let list = byMat.get(mat); if (!list) byMat.set(mat, list = []);
    list.push(g);
  });
  const out = new THREE.Group(); out.name = name;
  byMat.forEach((parts, mat) => {
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) return;
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, mat);
    m.name = name + ' / ' + mat.name;
    m.castShadow = true; m.receiveShadow = true;
    out.add(m);
  });
  return out;
}

/** Concave "ger roof" dome profile (glass roofs of the palace). */
export function gerDome(radius: number, height: number, seg = 24) {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, 0), new THREE.Vector2(radius * 1.04, 0), new THREE.Vector2(radius, height * 0.06)];
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(Math.max(0.001, radius * Math.pow(1 - t, 1.25) * 0.9 + radius * 0.1 * (1 - t)), height * (0.06 + 0.94 * t)));
  }
  return new THREE.LatheGeometry(pts, seg);
}

/** Mongolian national flag (red, blue, red; yellow emblem simplified to a bar mark). */
export function flagTexture() {
  return canvasTex(96, 48, (c) => {
    c.fillStyle = '#c4272f'; c.fillRect(0, 0, 96, 48);
    c.fillStyle = '#015197'; c.fillRect(32, 0, 32, 48);
    c.fillStyle = '#f9cf02';
    c.beginPath(); c.arc(16, 9, 3.2, 0, Math.PI * 2); c.fill();
    c.fillRect(11, 14, 10, 2); c.fillRect(11, 36, 10, 2);
    c.fillRect(8, 16, 3, 22); c.fillRect(21, 16, 3, 22);
    c.beginPath(); c.arc(16, 26, 4, 0, Math.PI * 2); c.fill();
  }, false);
}
