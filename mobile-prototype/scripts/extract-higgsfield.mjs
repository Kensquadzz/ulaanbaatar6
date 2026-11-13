// Splits the Higgsfield 3D Jutsu scene export (assets/higgsfield/source/ub6-3d-jutsu-r12.glb,
// project f4c92c39-70f4-49bd-9f43-19fd49db7cdf, revision 12) into separate runtime GLBs under
// public/models/higgsfield/.
//
// Each asset is re-centred (ground at y = 0, centre of its footprint at x = z = 0), faces +Z,
// keeps the Higgsfield materials, and has meshes that share a material joined to save draw calls.
// Vehicles get one pivot node per wheel (wheel_front_left ...) so the game can spin and steer them.
// Characters get limb pivot nodes (hip_left, shoulder_right ...) for the procedural walk cycle.
//
// Nothing here decides where an asset stands in Ulaanbaatar: positions come from the map data.
// Run: node scripts/extract-higgsfield.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clearNodeParent, clearNodeTransform, dedup, getBounds, join, prune, simplify, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../assets/higgsfield/source/ub6-3d-jutsu-r12.glb');
const OUT = path.resolve(here, '../public/models/higgsfield');
// assets the game does not load yet are written next to the source instead of being shipped in the app
const LIBRARY = path.resolve(here, '../../assets/higgsfield/library');

/**
 * kind: how the asset is rigged; rotateY: extra turn (radians) so the asset faces +Z;
 * simplify: target triangle ratio for meshoptimizer (mobile budget), applied after welding.
 */
const ASSETS = [
  { file: 'vehicles/hf-hybrid-sedan.glb', roots: ['HERO_UB_HYBRID_SEDAN'], kind: 'vehicle' },
  { file: 'vehicles/hf-city-car.glb', roots: ['UB6_CITY_SEDAN'], only: ['car_sedan_01'], kind: 'static', simplify: 0.4 },
  { file: 'vehicles/hf-city-bus.glb', roots: ['UB6_CITY_BUS_01'], kind: 'static', simplify: 0.35 },
  { file: 'characters/hf-player-winter.glb', roots: ['PLAYER_MONGOLIAN_WINTER_FIT'], kind: 'character', rotateY: Math.PI, simplify: 0.2, simplifyError: 0.02 },
  { file: 'characters/hf-woman-winter.glb', roots: ['NPC_WOMAN_WINTER'], kind: 'character', rotateY: Math.PI, simplify: 0.2, simplifyError: 0.02 },
  { file: 'props/hf-traffic-light.glb', roots: ['UB6_TRAFFIC_LIGHT_01'], kind: 'static', library: true },
  { file: 'props/hf-street-lamp.glb', roots: ['UB6_STREET_LAMP_01'], kind: 'static', library: true },
  { file: 'props/hf-bus-shelter.glb', roots: ['UB6_BUS_SHELTER_01'], kind: 'static', library: true },
  { file: 'props/hf-street-tree.glb', roots: ['UB6_STREET_TREE_CROWN', 'UB6_STREET_TREE_TRUNK'], exact: true, kind: 'static' },
  { file: 'props/hf-snow-drift.glb', roots: ['WINTER_SNOW_DRIFT'], exact: true, kind: 'static', library: true },
  { file: 'props/hf-ger.glb', roots: ['GER_BODY', 'GER_ROOF', 'GER_DOOR'], exact: true, kind: 'static', library: true },
  { file: 'props/hf-horse.glb', roots: ['UB6_MONGOLIAN_HORSE_BASE'], kind: 'static', library: true },
  { file: 'buildings/hf-apartment-block.glb', roots: ['UB6_APARTMENT_BLOCK_01'], kind: 'static', library: true },
  { file: 'buildings/hf-apartment-tower.glb', roots: ['UB6_APARTMENT_TOWER_01'], kind: 'static', library: true },
  { file: 'buildings/hf-glass-tower.glb', roots: ['UB6_GLASS_TOWER_01'], kind: 'static', library: true },
  // Stylised landmark studies from the diorama. Their size and shape are NOT the real buildings.
  { file: 'landmarks/hf-government-palace-study.glb', roots: ['GOV_PALACE_', 'PALACE_'], kind: 'static' },
  { file: 'landmarks/hf-state-department-store-study.glb', roots: ['STATE_DEPT_STORE', 'STATE_STORE_'], kind: 'static' },
  { file: 'landmarks/hf-shangri-la-study.glb', roots: ['SHANGRILA_'], kind: 'static' },
  { file: 'landmarks/hf-blue-sky-tower-study.glb', roots: ['BLUE_SKY_TOWER', 'BLUESKY_'], kind: 'static' },
  { file: 'landmarks/hf-sukhbaatar-monument-study.glb', roots: ['SQUARE_MONUMENT_BASE', 'MONUMENT_COLUMN'], kind: 'static', library: true },
  { file: 'landmarks/hf-zaisan-memorial-study.glb', roots: ['ZAISAN_MEMORIAL_'], kind: 'static' },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const RY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
const mul = (a, b) => {           // column-major 4x4: a * b
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const baseName = (n) => n.replace(/\.\d+$/, '');
const matches = (asset, name) => asset.roots.some((r) => asset.exact ? baseName(name) === r : name.startsWith(r));

const report = [];
for (const asset of ASSETS) {
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  const scene = root.getDefaultScene();
  // keep only the first instance of "exact" multi-instance props (one tree, one ger ...)
  const picked = [];
  for (const n of scene.listChildren()) {
    if (!matches(asset, n.getName())) { n.dispose(); continue; }
    if (asset.exact && picked.some((p) => baseName(p.getName()) === baseName(n.getName()))) { n.dispose(); continue; }
    picked.push(n);
  }
  for (const n of [...root.listNodes()]) if (n.getCamera()) n.setCamera(null);
  for (const n of [...root.listNodes()]) {
    const light = n.getExtension('KHR_lights_punctual'); if (light) n.setExtension('KHR_lights_punctual', null);
  }
  if (!picked.length) throw new Error('no nodes for ' + asset.file);
  // Bake every mesh into scene coordinates so the pieces can be regrouped freely.
  let meshNodes = [];
  for (const top of picked) top.traverse((n) => { if (n.getMesh()) meshNodes.push(n); });
  if (asset.only) {
    for (const n of meshNodes) if (!asset.only.includes(n.getName())) n.dispose();
    meshNodes = meshNodes.filter((n) => asset.only.includes(n.getName()));
  }
  for (const n of meshNodes) { clearNodeParent(n); clearNodeTransform(n); }
  for (const top of picked) if (!top.isDisposed() && !top.getMesh()) top.dispose();
  for (const n of scene.listChildren()) if (!n.getMesh() && !n.listChildren().length) n.dispose();

  // Centre on the footprint, ground at y = 0, then turn to face +Z.
  const b = getBounds(scene);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, y0 = b.min[1];
  const M = mul(RY(asset.rotateY ?? 0), T(-cx, -y0, -cz));
  const uniq = new Set();
  for (const n of meshNodes) {
    const m = n.getMesh();
    if (uniq.has(m)) { n.setMesh(m.clone()); }
    uniq.add(n.getMesh());
    transformMesh(n.getMesh(), M);
  }

  const top = doc.createNode(path.basename(asset.file, '.glb'));
  scene.addChild(top);
  const groups = new Map();
  const group = (name, pivot) => {
    if (!groups.has(name)) {
      const g = doc.createNode(name).setTranslation(pivot);
      top.addChild(g); groups.set(name, { node: g, pivot });
    }
    return groups.get(name);
  };
  const centre = (n) => { const bb = getBounds(n); return [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2); };
  for (const n of meshNodes) {
    scene.removeChild(n);
    const name = n.getName();
    let g = null;
    if (asset.kind === 'vehicle' && /TYRE|ALLOY_RIM|HUB/.test(name)) {
      const c = centre(n);
      const side = c[0] > 0 ? 'left' : 'right';         // car faces +Z, so +X is its left
      const axle = c[2] > 0 ? 'front' : 'rear';
      const key = `wheel_${axle}_${side}`;
      const existing = groups.get(key);
      g = existing ?? group(key, [Math.sign(c[0]) * 0.95, 0.42, c[2] > 0 ? 1.45 : -1.42].map((v, i) => i === 1 ? v - y0 + 0 : v));
    } else if (asset.kind === 'character') {
      const c = centre(n);
      const side = c[0] > 0 ? 'left' : 'right';          // character faces +Z after the turn
      if (/TROUSER|LOWER_LEG|WINTER_BOOT/.test(name)) g = group(`hip_${side}`, [Math.sign(c[0]) * 0.12, 0.86, 0]);
      else if (/SLEEVE_UPPER|SLEEVE_LOWER|GLOVE/.test(name)) g = group(`shoulder_${side}`, [Math.sign(c[0]) * 0.24, 1.36, 0]);
      else g = group('body', [0, 0, 0]);
    }
    if (g) {
      transformMesh(n.getMesh(), T(-g.pivot[0], -g.pivot[1], -g.pivot[2]));
      g.node.addChild(n);
    } else top.addChild(n);
  }
  if (asset.kind === 'vehicle') {
    // the wheel pivots were guessed from the source layout: re-centre each on its real tyre
    for (const { node } of groups.values()) {
      const bb = getBounds(node);
      const c = [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2);
      const t = node.getTranslation();
      const d = [c[0] - t[0], c[1] - t[1], c[2] - t[2]];
      for (const ch of node.listChildren()) transformMesh(ch.getMesh(), T(-d[0], -d[1], -d[2]));
      node.setTranslation(c);
    }
  }
  await doc.transform(join({ keepNamed: false }), dedup(), prune({ keepLeaves: false }));
  if (asset.simplify) {
    await MeshoptSimplifier.ready;
    // flat-shaded normals stop vertices from welding; drop them (the game recomputes normals when it
    // bakes these models) so the simplifier can collapse edges
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const n = p.getAttribute('NORMAL'); if (n) p.setAttribute('NORMAL', null); }
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: asset.simplify, error: asset.simplifyError ?? 0.01 }), prune({ keepLeaves: false }));
  }
  const fb = getBounds(scene);
  let tris = 0, draws = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { draws++; const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute('POSITION').getCount()) / 3; }
  const outFile = path.join(asset.library ? LIBRARY : OUT, asset.file);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await io.write(outFile, doc);
  const size = [0, 1, 2].map((i) => +(fb.max[i] - fb.min[i]).toFixed(2));
  report.push({ file: asset.file, shipped: !asset.library, size_m: size, triangles: tris, primitives: draws, bytes: fs.statSync(outFile).size });
}
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  source: 'Higgsfield 3D Jutsu project f4c92c39-70f4-49bd-9f43-19fd49db7cdf, revision 12 (GLB etag 0de6d6b12bbcfdfdf855c433b49ab418)',
  note: 'Extracted by scripts/extract-higgsfield.mjs. Landmark *-study files are stylised and are not the real buildings.',
  assets: report,
}, null, 2) + '\n');
console.table(report);
