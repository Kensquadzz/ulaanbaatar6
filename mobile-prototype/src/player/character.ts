// Player character: an ORIGINAL figure built in code (no third-party model), with human proportions
// (1.75 m, about 7.5 heads), jointed limbs (shoulder, elbow, hip, knee, ankle) and procedural
// walk / run / jump / idle poses that blend smoothly.
//
// Honest status: this is an improved stylised stand-in wearing everyday city winter clothes
// (quilted jacket, scarf, beanie, jeans, trainers). It is NOT a finished realistic character:
// there is no smooth skinning, no facial detail, no cloth simulation and no motion-captured animation.
//
// Performance: the ~50 body parts are merged into ONE rigidly skinned mesh (13 bones, vertex
// colours, one material), so the figure costs one draw call in the main pass and one in the
// shadow pass instead of about fifty in each.
// A properly licensed rigged model (glTF) should replace it; the joint layout below matches a
// standard humanoid so that swap stays local to this file.
import * as THREE from 'three';

type Pose = Record<string, number>;
const JOINTS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'shL', 'shR', 'shLz', 'shRz', 'elL', 'elR',
  'lean', 'twist', 'pelvisTwist', 'bob', 'head', 'crouch'] as const;
const zero = (): Pose => Object.fromEntries(JOINTS.map((j) => [j, 0]));
const ease = (x: number) => x * x * (3 - 2 * x);

/** Body of revolution with horizontal quilting, hanging down from the origin (y = 0 to -len). */
function quilted(rTop: number, rBot: number, len: number, rings: number, puff: number, seg = 12): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = rings * 4;
  pts.push(new THREE.Vector2(0.001, 0));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = rTop + (rBot - rTop) * t + Math.abs(Math.sin(t * rings * Math.PI)) * puff;
    pts.push(new THREE.Vector2(r, -t * len));
  }
  pts.push(new THREE.Vector2(0.001, -len));
  pts.reverse();                                   // lathe wants increasing y for outward normals
  return new THREE.LatheGeometry(pts, seg);
}
const tube = (rTop: number, rBot: number, len: number, seg = 10) => new THREE.CylinderGeometry(rTop, rBot, len, seg).translate(0, -len / 2, 0);

export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group();        // faces +z; rotated so heading 0 looks north
  private pelvis = new THREE.Bone();
  private spine = new THREE.Bone();
  private headG = new THREE.Bone();
  private j: Record<string, THREE.Object3D> = {};
  private skin: THREE.SkinnedMesh;
  private pbr = true;
  private blob: THREE.Mesh;
  private phase = 0;
  private wMove = 0; private wAir = 0; private land = 0; private wasGrounded = true;
  private gait = 0;                        // smoothed speed driving the walk-to-run blend
  private idleT = 0;
  private pose = zero();

  constructor(pbr: boolean) {
    const jacket = 0x1d3a4a, jacketTrim = 0x12242e, scarf = 0xb5562b, skin = 0xd3a07a;
    const hair = 0x15110f, beanie = 0x2a2c31, jeans = 0x2b3b55, shoe = 0xe9e7e2, sole = 0x1b1b1d, dark = 0x121316;
    const bones: THREE.Bone[] = [];
    const parts: { geo: THREE.BufferGeometry; color: number; bone: number; local: THREE.Matrix4 }[] = [];
    const bone = (o: THREE.Object3D) => { bones.push(o as THREE.Bone); return bones.length - 1; };
    const boneOf = new Map<THREE.Object3D, number>();
    const Q0 = new THREE.Quaternion();
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
      if (!boneOf.has(parent)) boneOf.set(parent, bone(parent));
      parts.push({ geo, color, bone: boneOf.get(parent)!, local: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q0, new THREE.Vector3(sx, sy, sz)) });
    };
    const joint = (name: string, parent: THREE.Object3D, x: number, y: number, z = 0) => {
      const g = new THREE.Bone(); g.position.set(x, y, z); parent.add(g); this.j[name] = g; return g;
    };

    // ---- pelvis and legs (hip joints at 0.93 m) ----
    this.pelvis.position.y = 0.93;
    this.body.add(this.pelvis);
    add(this.pelvis, new THREE.SphereGeometry(0.17, 12, 8), jeans, 0, 0, 0, 1.02, 0.62, 0.72);
    for (const [s, n] of [[-1, 'L'], [1, 'R']] as const) {
      const hip = joint('hip' + n, this.pelvis, 0.095 * s, -0.02);
      add(hip, tube(0.092, 0.066, 0.44), jeans);
      add(hip, new THREE.SphereGeometry(0.088, 10, 8), jeans);
      const knee = joint('knee' + n, hip, 0, -0.44);
      add(knee, new THREE.SphereGeometry(0.063, 10, 8), jeans);
      add(knee, tube(0.066, 0.05, 0.4), jeans);
      const ankle = joint('ankle' + n, knee, 0, -0.42);
      // trainer: upper, toe cap and a dark sole; the foot is 26 cm long
      add(ankle, new THREE.SphereGeometry(0.055, 10, 8), shoe, 0, 0.0, -0.005, 1, 0.9, 1.1);
      add(ankle, new THREE.CapsuleGeometry(0.046, 0.13, 3, 8).rotateX(Math.PI / 2), shoe, 0, -0.035, 0.06, 1.05, 0.85, 1);
      add(ankle, new THREE.BoxGeometry(0.1, 0.025, 0.26), sole, 0, -0.068, 0.05);
    }

    // ---- torso: quilted jacket from the hips to the shoulders ----
    this.spine.position.y = 0.02;
    this.pelvis.add(this.spine);
    add(this.spine, quilted(0.2, 0.185, 0.62, 5, 0.014, 14), jacket, 0, 0.56, 0, 1, 1, 0.68);
    add(this.spine, new THREE.CylinderGeometry(0.19, 0.19, 0.05, 14), jacketTrim, 0, -0.045, 0, 1, 1, 0.68);     // hem band
    add(this.spine, new THREE.SphereGeometry(0.2, 14, 8), jacket, 0, 0.5, 0, 1.08, 0.42, 0.66);                  // shoulder yoke
    add(this.spine, new THREE.BoxGeometry(0.012, 0.56, 0.01), dark, 0, 0.26, 0.134);                             // zip
    add(this.spine, new THREE.TorusGeometry(0.085, 0.036, 8, 14).rotateX(Math.PI / 2), scarf, 0, 0.6, 0.005, 1, 1.25, 1);
    add(this.spine, new THREE.BoxGeometry(0.07, 0.2, 0.03), scarf, 0.035, 0.49, 0.125);                          // scarf end
    add(this.spine, new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(-Math.PI * 0.62), jacketTrim, 0, 0.56, -0.07, 1, 0.7, 0.8);   // folded hood

    // ---- head ----
    this.headG.position.y = 0.63;
    this.spine.add(this.headG);
    add(this.headG, new THREE.CylinderGeometry(0.048, 0.055, 0.09, 10), skin, 0, 0.03, 0);
    add(this.headG, new THREE.SphereGeometry(0.1, 16, 12), skin, 0, 0.165, 0.004, 0.94, 1.14, 1.02);
    add(this.headG, new THREE.SphereGeometry(0.02, 8, 6), skin, 0, 0.15, 0.1, 0.9, 1.1, 1);                      // nose
    for (const s of [-1, 1]) {
      add(this.headG, new THREE.SphereGeometry(0.025, 8, 6), skin, 0.095 * s, 0.16, -0.002, 0.45, 1, 0.75);      // ears
      add(this.headG, new THREE.SphereGeometry(0.011, 6, 5), dark, 0.036 * s, 0.185, 0.089);                     // eyes
      add(this.headG, new THREE.BoxGeometry(0.036, 0.007, 0.01), hair, 0.036 * s, 0.207, 0.09);                  // brows
    }
    add(this.headG, new THREE.SphereGeometry(0.104, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, 0, 0.17, -0.012, 0.97, 1.12, 1.03);
    add(this.headG, new THREE.SphereGeometry(0.108, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.46), beanie, 0, 0.19, -0.004, 0.99, 1.16, 1.05);
    add(this.headG, new THREE.TorusGeometry(0.103, 0.018, 6, 16).rotateX(Math.PI / 2), beanie, 0, 0.212, -0.002, 1, 1.5, 1.04);   // beanie cuff

    // ---- arms (shoulder joints at 1.44 m) ----
    for (const [s, n] of [[-1, 'L'], [1, 'R']] as const) {
      const sh = joint('sh' + n, this.spine, 0.218 * s, 0.5);
      add(sh, new THREE.SphereGeometry(0.076, 10, 8), jacket);
      add(sh, quilted(0.066, 0.056, 0.29, 3, 0.012, 10), jacket);
      const el = joint('el' + n, sh, 0, -0.29);
      add(el, new THREE.SphereGeometry(0.058, 10, 8), jacket);
      add(el, quilted(0.055, 0.047, 0.25, 3, 0.01, 10), jacket);
      add(el, new THREE.CylinderGeometry(0.046, 0.044, 0.035, 10), jacketTrim, 0, -0.255, 0);                    // cuff
      // hand: palm, fingers and thumb as three simple volumes
      add(el, new THREE.SphereGeometry(0.04, 8, 6), skin, 0, -0.31, 0.005, 0.62, 1.25, 1.1);
      add(el, new THREE.SphereGeometry(0.034, 8, 6), skin, 0, -0.365, 0.012, 0.56, 1.2, 0.95);
      add(el, new THREE.SphereGeometry(0.014, 6, 5), skin, -0.012 * s, -0.31, 0.04, 1, 1.9, 1);
    }

    // ---- bake every part into one skinned mesh (each vertex follows exactly one bone) ----
    this.body.updateMatrixWorld(true);
    const pos: number[] = [], nor: number[] = [], col: number[] = [], si: number[] = [], sw: number[] = [], idx: number[] = [];
    const c = new THREE.Color(), m = new THREE.Matrix4();
    for (const p of parts) {
      const g = p.geo.index ? p.geo : p.geo.toNonIndexed();
      g.applyMatrix4(m.multiplyMatrices(bones[p.bone].matrixWorld, p.local));
      const off = pos.length / 3, P = g.getAttribute('position'), N = g.getAttribute('normal');
      c.setHex(p.color);                               // converted to linear, as vertex colours expect
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i));
        col.push(c.r, c.g, c.b); si.push(p.bone, 0, 0, 0); sw.push(1, 0, 0, 0);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
      else for (let i = 0; i < P.count; i++) idx.push(i + off);
      g.dispose(); p.geo.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    geo.setIndex(idx);
    this.skin = new THREE.SkinnedMesh(geo, this.material(pbr));
    this.skin.castShadow = true; this.skin.frustumCulled = false; this.skin.userData.kind = 'character';
    this.body.add(this.skin);
    this.skin.bind(new THREE.Skeleton(bones), new THREE.Matrix4());
    this.pbr = pbr;

    this.root.add(this.body);
    // soft contact shadow used when real shadows are off (low preset, night)
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.04;
    this.root.add(this.blob);
    this.body.rotation.y = Math.PI;        // authored facing +z; heading 0 (north) is -z
  }

  private material(pbr: boolean): THREE.Material {
    return pbr ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
  }
  /** HIGH uses the physically based material, LOW and MEDIUM the cheaper Lambert one. */
  setPbr(pbr: boolean) {
    if (pbr === this.pbr) return;
    (this.skin.material as THREE.Material).dispose();
    this.skin.material = this.material(pbr); this.pbr = pbr;
  }
  get triangles() { return this.skin.geometry.index!.count / 3; }
  setBlob(on: boolean) { this.blob.visible = on; }

  /** Joint angles of the locomotion cycle. `run` 0 = walk, 1 = sprint; angles in radians, forward positive. */
  private locomotion(run: number, out: Pose) {
    const p = this.phase;
    const hipA = 0.42 + 0.48 * run, kneeSwing = 0.95 + 0.95 * run, kneeStance = 0.1 + 0.22 * run;
    const armA = 0.38 + 0.62 * run, elbow = 0.3 + 1.15 * run;
    for (const [n, ph] of [['L', p], ['R', p + Math.PI]] as const) {
      const s = Math.sin(ph), c = Math.cos(ph);
      out['hip' + n] = hipA * s + 0.1 * run;
      // the knee folds while the leg swings forward and stays nearly straight in stance
      out['knee' + n] = kneeStance * (0.5 - 0.5 * Math.cos(2 * ph)) + kneeSwing * Math.pow(Math.max(0, c), 1.6);
      out['ankle' + n] = -0.25 * s + 0.18 * Math.max(0, c);
    }
    // arms counter-swing: left arm goes with the right leg
    out.shL = -armA * Math.sin(p); out.shR = armA * Math.sin(p);
    out.elL = elbow + 0.25 * Math.max(0, -Math.sin(p)) * (0.5 + run); out.elR = elbow + 0.25 * Math.max(0, Math.sin(p)) * (0.5 + run);
    out.shLz = -0.07 - 0.05 * run; out.shRz = 0.07 + 0.05 * run;
    out.lean = 0.04 + 0.2 * run;
    out.twist = 0.1 * (0.6 + run) * Math.sin(p); out.pelvisTwist = -0.07 * (0.5 + run) * Math.sin(p);
    out.bob = -(0.012 + 0.03 * run) * (0.5 + 0.5 * Math.cos(2 * p)) - 0.02 * run;
    out.head = -0.03 - 0.1 * run; out.crouch = 0;
  }

  /** heading: radians clockwise from north. */
  update(dt: number, x: number, y: number, z: number, heading: number, speed: number, grounded: boolean, vy: number) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = -heading;
    const k = (r: number) => 1 - Math.exp(-dt * r);
    (this.blob.material as THREE.MeshBasicMaterial).opacity += ((grounded ? 0.32 : 0.12) - (this.blob.material as THREE.MeshBasicMaterial).opacity) * k(10);

    // blend weights ease toward their targets, so no pose ever snaps
    const moving = grounded && speed > 0.2;
    this.wMove += ((moving ? 1 : 0) - this.wMove) * k(9);
    this.wAir += ((grounded ? 0 : 1) - this.wAir) * k(grounded ? 14 : 9);
    this.gait += (speed - this.gait) * k(6);
    if (grounded && !this.wasGrounded) this.land = 1;            // landing squash
    this.wasGrounded = grounded;
    this.land = Math.max(0, this.land - dt * 3.2);
    this.idleT += dt;

    // stride lengthens with speed: one full cycle covers about 1.7 m walking and 3.6 m sprinting
    const g = Math.max(this.gait, speed * 0.6);
    if (moving || this.wMove > 0.05) this.phase += dt * (2 * Math.PI * Math.max(0.6, g)) / (1.1 + 0.36 * g);
    const run = ease(Math.max(0, Math.min(1, (this.gait - 1.9) / 4.6)));

    const idle = zero(), move = zero(), air = zero();
    const breath = Math.sin(this.idleT * 1.6);
    idle.shLz = -0.08; idle.shRz = 0.08; idle.elL = 0.14 + 0.02 * breath; idle.elR = 0.14 - 0.02 * breath;
    idle.shL = 0.03 * breath; idle.shR = 0.03 * breath; idle.bob = 0.004 * breath; idle.twist = 0.015 * Math.sin(this.idleT * 0.7);
    this.locomotion(run, move);
    const up = vy > 0 ? 1 : 0;                                  // rising: tuck; falling: reach for the ground
    air.hipL = 0.75 * up + 0.25; air.kneeL = 1.15 * up + 0.35; air.hipR = 0.15 * up - 0.1; air.kneeR = 0.55 * up + 0.3;
    air.ankleL = air.ankleR = 0.3 - 0.2 * up;
    air.shL = 0.9 * up + 0.3; air.shR = 0.5 * up + 0.5; air.shLz = -0.35; air.shRz = 0.35; air.elL = 0.9; air.elR = 0.7;
    air.lean = 0.12 * up - 0.03; air.head = 0.05;

    const P = this.pose, sq = Math.sin(this.land * Math.PI) * this.land;
    for (const n of JOINTS) {
      const ground = idle[n] + (move[n] - idle[n]) * this.wMove;
      const target = ground + (air[n] - ground) * this.wAir;
      P[n] += (target - P[n]) * k(22);
    }
    const crouch = sq * 0.55;
    const J = this.j;
    J.hipL.rotation.x = -(P.hipL + crouch * 0.9); J.hipR.rotation.x = -(P.hipR + crouch * 0.9);
    J.kneeL.rotation.x = P.kneeL + crouch * 1.7; J.kneeR.rotation.x = P.kneeR + crouch * 1.7;
    J.ankleL.rotation.x = -(P.ankleL + crouch * 0.8) ; J.ankleR.rotation.x = -(P.ankleR + crouch * 0.8);
    J.shL.rotation.x = -P.shL; J.shR.rotation.x = -P.shR; J.shL.rotation.z = P.shLz; J.shR.rotation.z = P.shRz;
    J.elL.rotation.x = -P.elL; J.elR.rotation.x = -P.elR;
    this.pelvis.position.y = 0.93 + P.bob - crouch * 0.2;
    this.pelvis.rotation.y = P.pelvisTwist;
    this.spine.rotation.x = P.lean + crouch * 0.35; this.spine.rotation.y = P.twist - P.pelvisTwist;
    this.headG.rotation.x = P.head - crouch * 0.2; this.headG.rotation.y = -P.twist * 0.8;
  }
}
