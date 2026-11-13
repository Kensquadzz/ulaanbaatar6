// ULAANBAATAR 6 - iPhone playable web prototype. Separate from (and not a replacement for) the
// Unreal Engine project in ../unreal; it reuses the same real geographic tiles from ../data/tiles.
import * as THREE from 'three';
import './ui/style.css';
import { QUALITY, SPAWN, TARGET_FPS, type QualityName } from './config';
import { CHUNK_M, ORIGIN_LAT, ORIGIN_LON, UB_UTC_OFFSET_S, enuToGeo } from './core/geo';
import { sunPosition, sunTimes, type SunTimes } from './core/solar';
import { NEUTRAL_SCENE, WeatherClient, freshness, sceneFromWeather, type SceneWeather } from './core/weather';
import { FollowCamera } from './player/camera';
import { Character } from './player/character';
import { Player, type World } from './player/player';
import { Vehicle } from './player/vehicle';
import { CrowdManager } from './world/npcs';
import { TrafficManager } from './world/traffic';
import { AudioSystem } from './audio/audio';
import { Hud, type QualityChoice, type WeatherChoice } from './ui/hud';
import { t } from './ui/i18n';
import { Input } from './ui/input';
import { ChunkManager } from './world/chunks';
import { createMaterials } from './world/materials';
import { Precipitation } from './world/precip';
import { SkySystem } from './world/sky';
import type { ChunkData, Landmark, Manifest, Overview } from './world/types';

import { pointInRing } from './core/geo';
interface District { name: string; name_en: string; rings: [number, number][][] }
/** Counts what the main pass would draw right now, by kind (frustum-tested like the renderer does). */
function auditScene(scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) {
  const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const kinds: Record<string, { calls: number; tris: number }> = {};
  const sphere = new THREE.Sphere();
  const walk = (o: THREE.Object3D, kind: string) => {
    if (!o.visible) return;
    kind = (o.userData.kind as string) ?? kind;
    const m = o as THREE.Mesh;
    if (m.isMesh || (o as THREE.Points).isPoints) {
      const mat = m.material as THREE.Material;
      let seen = mat.visible;
      if (seen && o.frustumCulled) {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh) { if (!im.boundingSphere) im.computeBoundingSphere(); sphere.copy(im.boundingSphere!); }
        else { if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere(); sphere.copy(m.geometry.boundingSphere!); }
        seen = fr.intersectsSphere(sphere.applyMatrix4(o.matrixWorld));
      }
      if (seen) {
        const k = (kinds[kind] ??= { calls: 0, tris: 0 });
        const g = m.geometry, n = g.index ? g.index.count : g.getAttribute('position').count;
        k.calls++; k.tris += m.isMesh ? Math.round((n / 3) * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1)) : 0;
      }
    }
    for (const c of o.children) walk(c, kind);
  };
  walk(scene, 'other');
  const main = Object.values(kinds).reduce((a, k) => a + k.calls, 0);
  // Estimated GPU memory of what is loaded (not only what is in view): vertex/index buffers and
  // colour textures with mipmaps. An estimate from sizes, because WebGL reports no real figure.
  const geos = new Set<THREE.BufferGeometry>(), texs = new Set<THREE.Texture>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const map = (m.material as THREE.MeshLambertMaterial | undefined)?.map;
    if (map) texs.add(map);
  });
  let geoBytes = 0, texBytes = 0;
  geos.forEach((g) => { for (const a of Object.values(g.attributes)) geoBytes += (a as THREE.BufferAttribute).array.byteLength; if (g.index) geoBytes += g.index.array.byteLength; });
  texs.forEach((t) => { const im = t.image as { width?: number; height?: number } | undefined; texBytes += ((t.userData.pixels as number) ?? (im?.width ?? 0) * (im?.height ?? 0)) * 4 * 1.33; });
  texBytes += (9 * 512 * 512 + 9 * 256 * 256) * 4 * 1.33;                    // the two facade texture arrays
  const sm = renderer.shadowMap.enabled ? (scene.getObjectByProperty('isDirectionalLight', true) as THREE.DirectionalLight | undefined)?.shadow.mapSize.x ?? 0 : 0;
  const mb = (b: number) => +(b / 1048576).toFixed(1);
  return { kinds, memoryMB: { geometry: mb(geoBytes), textures: mb(texBytes), shadowMap: mb(sm * sm * 4), jsHeap: mb((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) }, mainPass: main, total: renderer.info.render.calls, shadowPass: renderer.info.render.calls - main,
    textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs?.length ?? 0 };
}
const DATA = import.meta.env.BASE_URL + 'data/';
const MANUAL: Record<Exclude<WeatherChoice, 'live'>, SceneWeather> = {
  clear: { cloud: 0.05, fog: 0, rain: 0, snow: 0, snowCover: 0, windMs: 1 },
  cloudy: { cloud: 0.9, fog: 0, rain: 0, snow: 0, snowCover: 0, windMs: 3 },
  snow: { cloud: 0.95, fog: 0.25, rain: 0, snow: 0.8, snowCover: 1, windMs: 3 },
  rain: { cloud: 0.95, fog: 0.15, rain: 0.8, snow: 0, snowCover: 0, windMs: 4 },
  fog: { cloud: 0.6, fog: 0.9, rain: 0, snow: 0, snowCover: 0, windMs: 0.5 },
};
const $ = (id: string) => document.getElementById(id)!;

async function boot() {
  const canvas = $('game') as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch {
    $('loadText').textContent = t('noWebgl'); $('loadText').classList.add('error');
    return;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.info.autoReset = false;

  let manifest: Manifest, overview: Overview, landmarks: Record<string, Landmark>;
  const getJson = async (name: string) => { const r = await fetch(DATA + name); if (!r.ok) throw new Error(name + ' HTTP ' + r.status); return r.json(); };
  try {
    [manifest, overview, landmarks] = await Promise.all([getJson('manifest.json'), getJson('overview.json'), getJson('landmarks.json').then((l) => l.found)]);
  } catch (e) {
    console.error(e);
    $('loadText').textContent = t('dataError'); $('loadText').classList.add('error');
    return;
  }

  // ---- state ---------------------------------------------------------------------------------
  let started = false, paused = false;
  let choice: QualityChoice = 'auto', qName: QualityName = 'medium', resScale = 1;
  let timeLive = true, freeHour = 12, weatherChoice: WeatherChoice = 'live';
  let pendingPlace: { e: number; n: number } | null = { e: SPAWN.east, n: SPAWN.north };
  const dest: Landmark | null = landmarks.zaisan_hill ?? null;
  const audio = new AudioSystem();
  let inVehicle = false;
  let vehicleControl: (forceExit?: boolean) => void = () => {};

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 14000);
  const hud = new Hud({
    onPlay: () => { started = true; input.enabled = true; void audio.start(); hud.start(); last = performance.now(); },
    onQuality: (q) => applyQuality(q),
    onTimeMode: (live, hour) => { timeLive = live; freeHour = hour; hudTimer = 0; },
    onWeather: (w) => { weatherChoice = w; hudTimer = 0; },
    onTravel: (key) => { const l = landmarks[key]; if (l) { if (inVehicle) vehicleControl(true); pendingPlace = { e: l.east, n: l.north }; player.e = l.east; player.n = l.north; input.stopRun(); } },
    onPause: (open) => { paused = open; input.enabled = started && !open; },
  }, landmarks, manifest.attribution);
  choice = hud.prefs.quality;
  qName = choice === 'auto' ? 'medium' : choice;

  let mats = createMaterials(QUALITY[qName]);
  const chunks = new ChunkManager(DATA, manifest, overview, mats, QUALITY[qName]);
  scene.add(chunks.root);
  const sky = new SkySystem(scene, QUALITY[qName].shadowMap);
  let precip = new Precipitation(QUALITY[qName].particles);
  scene.add(precip.points);
  const character = new Character(QUALITY[qName].pbr);
  character.root.userData.kind = 'character';
  scene.add(character.root);
  const vehicle = new Vehicle();
  // Player car: the hybrid sedan from the Higgsfield 3D Jutsu project (to scale, wheels spin and
  // steer); the Kenney CC0 sedan, then the procedural car, remain as fallbacks.
  void vehicle.loadModel(import.meta.env.BASE_URL + 'models/higgsfield/vehicles/hf-hybrid-sedan.glb', { native: true })
    .then((ok) => ok || vehicle.loadModel(import.meta.env.BASE_URL + 'models/vehicles/sedan.glb'));
  scene.add(vehicle.root);
  const crowd = new CrowdManager();
  scene.add(crowd.root);
  void crowd.useHiggsfield(QUALITY[qName].pbr);
  const traffic = new TrafficManager(import.meta.env.BASE_URL + 'models/');
  scene.add(traffic.root);
  const player = new Player();
  player.e = SPAWN.east; player.n = SPAWN.north; player.heading = Math.PI;
  const follow = new FollowCamera(camera);
  follow.yaw = Math.PI;                         // start looking south, toward Peace Avenue and Zaisan
  const input = new Input($('touch'), $('stick'), $('knob'), $('btnJump'), $('btnRun'), $('btnBrake'));
  const weather = new WeatherClient();

  const xs = manifest.chunks.map((c) => c.x), ys = manifest.chunks.map((c) => c.y);
  const world: World = {
    heightAt: (e, n) => chunks.height.heightAt(e, n),
    colliders: chunks.colliders,
    bounds: { minE: Math.min(...xs) * CHUNK_M + 4, maxE: (Math.max(...xs) + 1) * CHUNK_M - 4, minN: Math.min(...ys) * CHUNK_M + 4, maxN: (Math.max(...ys) + 1) * CHUNK_M - 4 },
  };

  // First drivable city sedan is parked beside the Sukhbaatar Square spawn.
  vehicle.place(SPAWN.east + 5.5, SPAWN.north - 4.5, world.heightAt(SPAWN.east + 5.5, SPAWN.north - 4.5));
  const carButton = $('btnCar') as HTMLButtonElement;
  const syncVehicleHud = () => {
    const nearCar = Math.hypot(vehicle.east - player.e, vehicle.north - player.n) < 7.5;
    carButton.textContent = inVehicle ? 'БУУХ' : 'МАШИН';
    carButton.classList.toggle('ready', !inVehicle && nearCar);
    carButton.classList.toggle('hidden', !inVehicle && !nearCar);
    $('btnJump').classList.toggle('hidden', inVehicle);
    $('btnBrake').classList.toggle('hidden', !inVehicle);
    $('vehicleHud').classList.toggle('hidden', !inVehicle);
    $('btnRun').textContent = inVehicle ? 'BOOST' : t('run').toUpperCase();
  };
  vehicleControl = (forceExit = false) => {
    if (!inVehicle) {
      const distance = Math.hypot(vehicle.east - player.e, vehicle.north - player.n);
      if (distance > 7.5) return;
      inVehicle = true; audio.vehicleEvent(true);
      player.e = vehicle.east; player.n = vehicle.north; player.y = vehicle.y;
      player.heading = vehicle.heading; player.ve = player.vn = player.vy = 0; player.speed = 0;
      input.stopRun(); follow.distance = 7.4; follow.snap();
      hud.toast('ЖОЛООДЛОГО · joystick · BOOST · ТОРМОЗ');
    } else {
      if (!forceExit && Math.abs(vehicle.speed) > 0.65) {
        hud.toast('Машиныг зогсоогоод бууна уу.'); return;
      }
      inVehicle = false; audio.vehicleEvent(false);
      const h = vehicle.heading;
      player.place(vehicle.east - Math.cos(h) * 2.0, vehicle.north + Math.sin(h) * 2.0, world);
      player.heading = h; player.speed = 0;
      follow.distance = 4.9; follow.snap(); input.stopRun();
      hud.toast(forceExit ? 'Очих газрыг сонголоо.' : 'Машинаас буулаа.');
    }
    syncVehicleHud();
  };
  carButton.addEventListener('click', () => vehicleControl());
  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'KeyE' && !ev.repeat && started && !paused) vehicleControl();
  });
  syncVehicleHud();

  function applyPixelRatio() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[qName].pixelRatio) * resScale);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    applyPixelRatio();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep a comfortable horizontal view on very wide phones
    camera.fov = w / h > 2 ? 52 : 62;
    follow?.setBaseFov(camera.fov);
    camera.updateProjectionMatrix();
  }
  function setQuality(name: QualityName) {
    qName = name;
    const q = QUALITY[name], old = mats;
    mats = createMaterials(q);
    chunks.setQuality(q, mats);
    old.dispose();
    applyShadows(q);
    sky.configureShadows(q.shadowMap);
    character.setPbr(q.pbr);
    scene.remove(precip.points); precip.points.geometry.dispose();
    precip = new Precipitation(q.particles); scene.add(precip.points);
    scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && !Array.isArray(m)) m.needsUpdate = true; });
    resize();
    noteQuality();
  }
  function applyShadows(q: typeof QUALITY[QualityName]) {
    renderer.shadowMap.enabled = q.shadowMap > 0;
    renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }
  function applyQuality(c: QualityChoice) {
    choice = c; resScale = 1; govLow = govHigh = 0; promoted = demoted = false;
    setQuality(c === 'auto' ? 'medium' : c);
  }
  function noteQuality() {
    hud.setQualityNote(`${qName.toUpperCase()} · ${Math.round(resScale * 100)}% · ${renderer.domElement.width}×${renderer.domElement.height}`);
  }
  applyShadows(QUALITY[qName]);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  // ---- adaptive quality (AUTO only). Browsers expose no temperature reading, so the measured
  // frame rate is the signal: a phone that heats up and throttles shows up here as falling fps.
  // Down: resolution in steps to 70 %, then one profile lower (HIGH > MEDIUM > LOW).
  // Up: resolution back to 100 %; one single attempt at the next profile if 55+ fps is held for
  // 15 s, and never again after any downgrade, so the game cannot flip back and forth.
  let govLow = 0, govHigh = 0, fpsFrames = 0, fpsTime = 0, fps = 0, worstMs = 0, warm = 0, promoted = false, demoted = false;
  const ORDER: QualityName[] = ['low', 'medium', 'high'];
  function govern() {
    if (choice !== 'auto' || warm < 6 || paused || chunks.streaming) return;
    if (fps < TARGET_FPS - 3) { govLow++; govHigh = 0; } else if (fps > 50) { govHigh++; govLow = 0; } else { govLow = govHigh = 0; }
    if (govLow >= 2) {
      govLow = 0;
      if (resScale > 0.72) { resScale = Math.max(0.7, resScale - 0.15); resize(); noteQuality(); }
      else if (qName !== 'low') { demoted = true; resScale = 0.85; setQuality(ORDER[ORDER.indexOf(qName) - 1]); }
    } else if (govHigh >= 6 && resScale < 1) { govHigh = 0; resScale = Math.min(1, resScale + 0.1); resize(); noteQuality(); }
    else if (govHigh >= 15 && fps >= 55 && !promoted && !demoted && qName !== 'high') { govHigh = 0; promoted = true; warm = 0; setQuality(ORDER[ORDER.indexOf(qName) + 1]); }
  }

  // ---- helpers -------------------------------------------------------------------------------
  const nowUnix = () => {
    const real = Date.now() / 1000;
    if (timeLive) return real;
    const local = real + UB_UTC_OFFSET_S;
    return local - (((local % 86400) + 86400) % 86400) - UB_UTC_OFFSET_S + freeHour * 3600;
  };
  // real district outlines (Overture divisions); the name is simply absent if the file is missing
  let districts: District[] = [];
  fetch(DATA + 'districts.json').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.districts) districts = d.districts; }).catch(() => { /* optional */ });
  function districtAt(e: number, n: number): string | null {
    for (const d of districts) for (const ring of d.rings) if (pointInRing(ring, e, n)) return hud.prefs.lang === 'mn' ? d.name : d.name_en;
    return null;
  }
  const nearData: ChunkData[] = [];
  function nearestNames(): [string | null, string | null] {
    let best = 45 * 45, name: string | null = null, sub: string | null = null, bestB = 110 * 110;
    const mn = hud.prefs.lang === 'mn';
    for (const c of nearData) {
      for (const r of c.roads) {
        if (!r.name) continue;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const a = r.pts[i], b = r.pts[i + 1], de = b[0] - a[0], dn = b[1] - a[1], l2 = de * de + dn * dn || 1;
          const tt = Math.max(0, Math.min(1, ((player.e - a[0]) * de + (player.n - a[1]) * dn) / l2));
          const d2 = (player.e - a[0] - de * tt) ** 2 + (player.n - a[1] - dn * tt) ** 2;
          if (d2 < best) { best = d2; name = mn ? r.name : r.name_en ?? r.name; }
        }
      }
      for (const b of c.buildings) {
        if (!b.name) continue;
        const p = b.rings[0][0], d2 = (p[0] - player.e) ** 2 + (p[1] - player.n) ** 2;
        if (d2 < bestB) { bestB = d2; sub = mn ? b.name : b.name_en ?? b.name; }
      }
    }
    return [name, sub];
  }

  // ---- main loop -----------------------------------------------------------------------------
  let last = performance.now(), hudTimer = 0, mapTimer = 0, crowdTimer = 0, clockS = 0, sunT: SunTimes | null = null, sunDay = -1;
  let lastInput = { x: 0, y: 0, run: false, jump: false, brake: false, lookDX: 0, lookDY: 0 };
  const focus = new THREE.Vector3();
  let sceneW: SceneWeather = { ...NEUTRAL_SCENE };

  function frame(now: number) {
    requestAnimationFrame(frame);
    const rawMs = now - last;
    const dt = Math.min(0.05, Math.max(0.001, rawMs / 1000));
    last = now;
    clockS += dt;

    // streaming: generous budget behind the loading screen, tight while playing
    chunks.update(player.e, player.n, started ? 5 : 40);
    const terrainReady = chunks.hasTerrain(player.e, player.n);
    if (pendingPlace && terrainReady && chunks.nearProgress() >= 1) {
      player.place(pendingPlace.e, pendingPlace.n, world);
      pendingPlace = null; follow.snap(); hud.toast(null);
    }
    character.setBlob(QUALITY[qName].shadowMap === 0 || !sky.sun.castShadow);
    if (!started) hud.setLoading(pendingPlace ? Math.min(0.97, chunks.nearProgress()) : 1);
    else if (pendingPlace) hud.toast(t('areaLoading'));

    const inp = input.frame();
    lastInput = inp;
    if (started && !paused) {
      follow.look(inp.lookDX, inp.lookDY, hud.prefs.sens);
      if (!pendingPlace && terrainReady) {
        if (inVehicle) {
          vehicle.update(dt, inp, world, sceneW.snowCover, sceneW.rain);
          player.e = vehicle.east; player.n = vehicle.north; player.y = vehicle.y;
          player.heading = vehicle.heading; player.speed = Math.abs(vehicle.speed);
        } else player.update(dt, inp, follow.yaw, world);
      }
    }
    const px = player.e, py = pendingPlace ? world.heightAt(player.e, player.n) : (inVehicle ? vehicle.y : player.y), pz = -player.n;
    crowdTimer -= dt;
    if (started && !pendingPlace && crowdTimer <= 0) {
      const crowdData: ChunkData[] = [];
      chunks.forNearData(2, (d) => crowdData.push(d));
      crowd.rebuild(crowdData, player.e, player.n);
      traffic.rebuild(crowdData, player.e, player.n, world.heightAt);
      crowdTimer = 6;
    }
    if (started) { crowd.update(dt, world.heightAt); traffic.update(dt, world, sceneW.snowCover, sceneW.rain); }
    audio.update(dt, inVehicle ? Math.abs(vehicle.speed) : player.speed, inVehicle, sceneW.rain, sceneW.snow);
    if (!inVehicle) character.update(dt, px, py, pz, player.heading, player.speed, player.grounded, player.vy);
    follow.update(dt, px, inVehicle ? py - 0.25 : py, pz, world.heightAt, chunks.colliders, player.speed);
    character.root.visible = !inVehicle && follow.current > 1.3;

    // live systems
    const unix = nowUnix();
    const sun = sunPosition(unix, ORIGIN_LAT, ORIGIN_LON);
    weather.tick(Date.now() / 1000);
    const target = weatherChoice === 'live' ? sceneFromWeather(weather.state.weather) : MANUAL[weatherChoice];
    const k = Math.min(1, dt * 0.8);          // weather changes ease in, never snap
    (Object.keys(sceneW) as (keyof SceneWeather)[]).forEach((key) => { sceneW[key] += (target[key] - sceneW[key]) * k; });
    focus.set(px, py, pz);
    sky.update(sun, sceneW, focus, camera, (QUALITY[qName].farRings + 0.5) * CHUNK_M, clockS);
    mats.setNight(sky.night); mats.setSnow(sceneW.snowCover);
    precip.update(dt, camera.position, sceneW.rain, sceneW.snow, sceneW.windMs, sky.daylight);

    renderer.info.reset();
    renderer.render(scene, camera);

    // HUD (throttled) and statistics
    if (started) { fpsFrames++; fpsTime += rawMs; worstMs = Math.max(worstMs, rawMs); }
    if (fpsTime >= 1000) {
      fps = (fpsFrames * 1000) / fpsTime; warm++;
      const r = renderer.info.render;
      hud.setFps(`${fps.toFixed(0)} fps  worst ${worstMs.toFixed(0)} ms\n${r.calls} calls  ${(r.triangles / 1000).toFixed(0)}k tris\n${chunks.builtChunks} chunks  ${qName} ${Math.round(resScale * 100)}%`);
      stats = { fps, worstMs, calls: r.calls, triangles: r.triangles, chunks: chunks.builtChunks, quality: qName, resScale,
        width: renderer.domElement.width, height: renderer.domElement.height, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries };
      fpsFrames = 0; fpsTime = 0; worstMs = 0;
      govern();
    }
    hudTimer -= dt; mapTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.5;
      const day = Math.floor((unix + UB_UTC_OFFSET_S) / 86400);
      if (day !== sunDay || !sunT) { sunDay = day; sunT = sunTimes(unix, ORIGIN_LAT, ORIGIN_LON, UB_UTC_OFFSET_S); }
      hud.setClock(unix, timeLive, sunT);
      const real = Date.now() / 1000;
      hud.setWeather(weather.state, freshness(weather.state, real), weatherChoice, real);
      nearData.length = 0; chunks.forNearData(1, (d) => nearData.push(d));
      const [street, sub] = nearestNames();
      hud.setStreet(street, sub, districtAt(player.e, player.n));
      syncVehicleHud();
      $('vehicleSpeed').textContent = String(Math.round(Math.abs(vehicle.speed) * 3.6));
      if (dest) {
        const d = Math.hypot(dest.east - player.e, dest.north - player.n);
        const g = enuToGeo(player.e, player.n);
        hud.setDest(t('lm_zaisan_hill'), d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m', `${g.lat.toFixed(5)}° N  ${g.lon.toFixed(5)}° E`);
      }
    }
    if (mapTimer <= 0 && started) {
      mapTimer = 0.15;
      // the 2D map is redrawn only when something on it changed (standing still costs nothing)
      const key = `${Math.round(player.e)},${Math.round(player.n)},${player.heading.toFixed(2)},${follow.yaw.toFixed(2)},${nearData.length}`;
      if (key !== mapKey) hud.drawMinimap(nearData, player.e, player.n, player.heading, follow.yaw, landmarks, dest);
      mapKey = key;
    }
  }
  let mapKey = '';
  let stats: Record<string, unknown> = {};
  noteQuality();
  // small hook for automated tests and performance captures (scripts/perf.mjs)
  (window as any).__ub6 = {
    stats: () => ({ ...stats, e: player.e, n: player.n, y: player.y, speed: player.speed, grounded: player.grounded, yaw: follow.yaw, near: chunks.nearProgress(), colliders: chunks.colliders.count, pending: !!pendingPlace, streaming: chunks.streaming, worstBuildMs: chunks.worstBuildMs, inVehicle, vehicleSpeed: vehicle.speed, vehicleEast: vehicle.east, vehicleNorth: vehicle.north, input: lastInput, pedestrians: crowd.count, traffic: traffic.count, trafficModelsReady: traffic.modelsReady, trafficModelStates: traffic.modelStates, vehicleAsset: vehicle.root.userData.assetStatus, vehicleUrl: vehicle.root.userData.asset, pedestrianBodies: crowd.bodyStyle, hfLandmarks: [...chunks.landmarks.ready] }),
    enterCar: () => { vehicle.place(player.e + 3, player.n, world.heightAt(player.e + 3, player.n)); vehicleControl(); },
    place: (e: number, n: number) => { pendingPlace = { e, n }; player.e = e; player.n = n; },
    travel: (key: string) => { const l = landmarks[key]; if (l) { pendingPlace = { e: l.east, n: l.north }; player.e = l.east; player.n = l.north; } },
    setTime: (hour: number | null) => { timeLive = hour === null; if (hour !== null) freeHour = hour; hudTimer = 0; },
    setWeather: (w: WeatherChoice) => { weatherChoice = w; },
    setQuality: (q: QualityChoice) => applyQuality(q),
    look: (yaw: number, pitch: number) => { follow.yaw = yaw; follow.pitch = pitch; follow.snap(); },
    zoom: (d: number) => { follow.distance = d; follow.snap(); },
    face: (h: number) => { player.heading = h; },
    weather: () => weather.state,
    audit: () => auditScene(scene, camera, renderer),
    scene: () => scene,
  };
  requestAnimationFrame(frame);
}

boot();
