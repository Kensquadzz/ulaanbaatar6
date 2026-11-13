// Street trees from the Higgsfield 3D Jutsu project (props/hf-street-tree.glb), instanced along the
// sidewalks of the near streets: one draw call for every tree in view.
//
// HONEST STATUS: tree positions are ESTIMATED street dressing, not mapped trees (the source data has
// no tree records). They follow the procedural streetlight spacing: one tree midway between every
// second pair of lamps, set back from the curb, and skipped where it would stand inside a building.
import * as THREE from 'three';
import type { ColliderSet, Collider } from './collision';
import type { HeightField } from './terrain';
import type { Lamp } from './street';
import { bakeGroup, loadHf } from './hfassets';

const CAP = 1200;

export class StreetTrees {
  readonly root = new THREE.Group();
  private mesh: THREE.InstancedMesh | null = null;
  private pending: { lamps: Lamp[]; hh: HeightField; col: ColliderSet } | null = null;
  private scratch: Collider[] = [];
  count = 0;

  constructor() {
    this.root.name = 'UB6 street trees (estimated positions)';
    loadHf('props/hf-street-tree.glb').then((scene) => {
      const geo = bakeGroup(scene);
      if (!geo) return;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
      this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
      this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = false;
      this.mesh.userData.kind = 'street trees';
      this.root.add(this.mesh);
      if (this.pending) this.set(this.pending.lamps, this.pending.hh, this.pending.col);
    }).catch((err) => console.warn('Higgsfield street tree failed; no trees', err));
  }

  set(near: Lamp[], hh: HeightField, col: ColliderSet) {
    this.pending = { lamps: near, hh, col };
    const mesh = this.mesh; if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < near.length && n < CAP; i += 2) {
      const l = near[i];
      // along the road (perpendicular to the lamp's road direction), then 0.9 m back from the curb
      const e = l.e - l.dn * 7 - l.de * 0.9, no = l.n + l.de * 7 - l.dn * 0.9;
      const y = hh.heightAt(e, no);
      if (col.inside(e, no, y + 1.5, this.scratch)) continue;
      const h = Math.abs(Math.sin(e * 12.9898 + no * 78.233)) % 1;
      q.setFromAxisAngle(up, h * Math.PI * 2);
      const k = 1.6 + h * 0.6;
      m.compose(p.set(e, y - 0.05, -no), q, s.set(k, k * (0.95 + h * 0.2), k));
      mesh.setMatrixAt(n++, m);
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
    this.count = n;
  }
}
