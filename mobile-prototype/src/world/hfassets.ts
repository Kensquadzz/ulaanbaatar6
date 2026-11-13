// Runtime access to the 3D models exported from the owner's Higgsfield 3D Jutsu project
// (project f4c92c39-70f4-49bd-9f43-19fd49db7cdf, revision 12). The single scene GLB is split into
// separate assets by scripts/extract-higgsfield.mjs; this module loads and prepares them.
//
// Every caller keeps its previous asset (procedural or Kenney CC0) as a fallback, so a missing or
// broken Higgsfield file never breaks the game.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const HF_BASE = import.meta.env.BASE_URL + 'models/higgsfield/';
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

/** Loads one extracted Higgsfield GLB (path relative to models/higgsfield/). Results are cached. */
export function loadHf(file: string): Promise<THREE.Group> {
  let p = cache.get(file);
  if (!p) {
    p = loader.loadAsync(HF_BASE + file).then((g) => g.scene);
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
}

/**
 * Bakes every mesh below `node` into ONE geometry expressed in `node`'s local space, with each
 * material's base colour (and a share of its emissive colour) written as vertex colours.
 * One geometry + one vertex-coloured material = one draw call, and it can be instanced.
 */
export function bakeGroup(node: THREE.Object3D): THREE.BufferGeometry | null {
  node.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  node.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    g.applyMatrix4(m);
    const count = g.attributes.position.count;
    const col = new Float32Array(count * 3);
    const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial;
      const c = (mat?.color ?? new THREE.Color(0xffffff)).clone();
      if (mat?.emissive && mat.emissive.getHex() !== 0) c.lerp(mat.emissive, 0.6);
      for (let i = gr.start; i < Math.min(count, gr.start + gr.count); i++) col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.clearGroups();
    parts.push(g);
  });
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (merged) merged.computeBoundingSphere();
  return merged;
}

export interface CharacterRig {
  /** Baked limb geometry plus its pivot in the character's own space (metres, faces +Z). */
  parts: Record<'body' | 'hip_left' | 'hip_right' | 'shoulder_left' | 'shoulder_right', { geo: THREE.BufferGeometry; pivot: THREE.Vector3 }>;
  height: number;
}

/** Loads a Higgsfield character GLB and bakes it into five rigid limb groups for instancing. */
export async function loadCharacterRig(file: string): Promise<CharacterRig> {
  const scene = await loadHf(file);
  const out: Partial<CharacterRig['parts']> = {};
  for (const key of ['body', 'hip_left', 'hip_right', 'shoulder_left', 'shoulder_right'] as const) {
    const node = scene.getObjectByName(key);
    if (!node) throw new Error(`${file}: missing ${key}`);
    const geo = bakeGroup(node);
    if (!geo) throw new Error(`${file}: empty ${key}`);
    out[key] = { geo, pivot: node.position.clone() };
  }
  const box = new THREE.Box3().setFromObject(scene);
  return { parts: out as CharacterRig['parts'], height: box.max.y - box.min.y };
}

/**
 * Collapses a Higgsfield vehicle (about 18 meshes) into one vertex-coloured body mesh plus one mesh
 * per wheel pivot, so a car costs 5 draw calls instead of 18. Glass loses its transparency and lamps
 * keep a brighter tint instead of a separate emissive material: a deliberate mobile trade-off.
 */
export function bakeVehicle(model: THREE.Object3D): void {
  model.updateMatrixWorld(true);
  const wheels: THREE.Object3D[] = [];
  model.traverse((o) => { if (o !== model && o.name.toLowerCase().includes('wheel')) wheels.push(o); });
  // glossy paint: low roughness picks up the environment reflections set up in render/post.ts
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.45 });
  for (const w of wheels) model.attach(w);
  for (const w of wheels) model.remove(w);
  const body = bakeGroup(model);
  model.clear();
  if (body) { const m = new THREE.Mesh(body, material); m.name = 'body'; model.add(m); }
  for (const w of wheels) {
    const geo = bakeGroup(w);
    w.clear();
    if (geo) { const m = new THREE.Mesh(geo, material); m.name = w.name + ' mesh'; w.add(m); }
    model.add(w);
  }
}
