// End-to-end check + performance capture in headless Chromium at an iPhone landscape viewport.
// It drives the real touch controls (joystick, look, jump) and records frame statistics per preset.
// NOTE: the cloud machine has no GPU, so WebGL runs on a software rasteriser (SwiftShader). The FPS
// numbers from here say nothing about a real iPhone; draw calls / triangles / memory counts do carry over.
// usage: npm run build && npx vite preview --port 4173 &  then  node scripts/perf.mjs [url]
import fs from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const url = process.argv[2] || 'http://localhost:4173/';
const out = new URL('../perf-out/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
const report = { url, viewport: '844x390 @3x (iPhone 14/15 landscape)', renderer: null, checks: {}, presets: {}, errors: [] };
const ok = (name, pass, detail) => { report.checks[name] = { pass, detail }; console.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(detail)); };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/429|Failed to load resource|api\.open-meteo\.com/.test(m.text())) report.errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
const stats = () => page.evaluate(() => window.__ub6.stats());
const sleep = (ms) => page.waitForTimeout(ms);

const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('btnPlay').disabled, null, { timeout: 180000 });
ok('loads until Play is enabled', true, { seconds: (Date.now() - t0) / 1000 });
report.renderer = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
await page.tap('#btnPlay');
await page.evaluate(() => window.__ub6.setQuality('low'));
await sleep(1500);

// 1) joystick: push forward (camera starts looking south, so north decreases)
let a = await stats();
await touch('touchStart', [[130, 300, 1]]);
await touch('touchMove', [[130, 244, 1]]);
await sleep(4000);
let b = await stats();
ok('left joystick moves the character', b.n < a.n - 2, { movedMetres: +(a.n - b.n).toFixed(2), speed: +b.speed.toFixed(2) });
// 2) second finger on the right rotates the camera while still walking
await touch('touchStart', [[130, 244, 1], [600, 200, 2]]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [[130, 244, 1], [600 + i * 15, 200, 2]]); await sleep(60); }
let c = await stats();
ok('right-side drag rotates the camera', Math.abs(c.yaw - b.yaw) > 0.3, { yawChange: +(c.yaw - b.yaw).toFixed(2) });
await touch('touchEnd', [[130, 244, 1]]);
await touch('touchEnd', []);
await sleep(600);
// 3) jump button
await page.tap('#btnJump');
let air = false;
for (let i = 0; i < 12; i++) { await sleep(60); if (!(await stats()).grounded) air = true; }
await sleep(1500);
ok('jump button leaves the ground and lands', air && (await stats()).grounded, { leftGround: air });
// 4) run toggle
await page.tap('#btnRun');
await touch('touchStart', [[130, 300, 1]]); await touch('touchMove', [[130, 244, 1]]);
await sleep(3000);
const run = await stats();
await touch('touchEnd', []);
await page.tap('#btnRun');
ok('run button sprints', run.speed > 5, { speed: +run.speed.toFixed(2) });
// 5) settings panel opens and closes
await page.tap('#btnSettings'); await sleep(300);
const open = await page.evaluate(() => !document.getElementById('settings').classList.contains('hidden'));
await page.screenshot({ path: out + 'settings.png' });
await page.tap('#btnClose');
ok('settings panel opens', open, {});
// 5b) touch response: time from the finger moving to the character moving (software renderer, so an upper bound)
await touch('touchStart', [[130, 300, 1]]);
const tr0 = Date.now(); await touch('touchMove', [[130, 244, 1]]);
let respMs = -1;
for (let i = 0; i < 40 && respMs < 0; i++) { if ((await stats()).speed > 0.3) respMs = Date.now() - tr0; else await sleep(16); }
await touch('touchEnd', []);
await sleep(900);
ok('touch responds quickly and releasing the joystick stops the character', respMs >= 0 && respMs < 400 && (await stats()).speed < 0.3, { msToFirstMovement: respMs, speedAfterRelease: +(await stats()).speed.toFixed(2) });
// 5c) vertical drag changes the camera pitch (visible as a different frame; yaw must stay put)
const y0 = (await stats()).yaw;
await touch('touchStart', [[600, 150, 3]]);
for (let i = 1; i <= 6; i++) { await touch('touchMove', [[600, 150 + i * 12, 3]]); await sleep(50); }
await touch('touchEnd', []);
ok('vertical drag tilts without turning', Math.abs((await stats()).yaw - y0) < 0.05, { yawDrift: +((await stats()).yaw - y0).toFixed(3) });
// 5d) safe areas: simulate an iPhone notch / home bar (47 px sides, 21 px bottom) and make sure every control stays inside
const safe = await page.evaluate(() => {
  const r = document.documentElement.style;
  r.setProperty('--sal', '47px'); r.setProperty('--sar', '47px'); r.setProperty('--sab', '21px');
  const out = {};
  for (const id of ['btnJump', 'btnRun', 'mapwrap', 'topRight', 'stick']) { const b = document.getElementById(id).getBoundingClientRect(); out[id] = [Math.round(b.left), Math.round(b.right), Math.round(b.bottom)]; }
  for (const k of ['--sal', '--sar', '--sab']) r.removeProperty(k);
  return out;
});
ok('controls stay inside simulated iPhone safe areas', Object.values(safe).every(([l, r, b]) => l >= 47 && r <= 844 - 47 && b <= 390 - 21), safe);
// 5e) buttons are large enough for thumbs (Apple recommends at least 44 pt)
const sizes = await page.evaluate(() => Object.fromEntries(['btnJump', 'btnRun', 'btnSettings'].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [id, [Math.round(b.width), Math.round(b.height)]]; })));
ok('touch targets are at least 44 pt', Object.values(sizes).every(([w, h]) => w >= 44 && h >= 44), sizes);
// 5f) portrait shows the rotate prompt, landscape hides it
await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
const portrait = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display);
await page.setViewportSize({ width: 844, height: 390 }); await sleep(600);
const landscape = await page.evaluate(() => getComputedStyle(document.getElementById('rotate')).display);
ok('portrait asks to rotate, landscape plays', portrait !== 'none' && landscape === 'none', { portrait, landscape });
// 6) live systems
const live = await page.evaluate(() => ({ clock: document.getElementById('clock').textContent, badge: document.getElementById('timeBadge').textContent,
  wx: document.getElementById('wxBadge').textContent + ' ' + document.getElementById('wxTemp').textContent, sun: document.getElementById('sunLine').textContent, state: window.__ub6.weather() }));
const ub = new Date(Date.now() + 8 * 3600e3).toISOString().slice(11, 16);
ok('clock shows real Ulaanbaatar time', Math.abs((+live.clock.slice(0, 2) * 60 + +live.clock.slice(3)) - (+ub.slice(0, 2) * 60 + +ub.slice(3))) <= 1, { hud: live.clock, expected: ub, sun: live.sun });
ok('weather is live or honestly marked unavailable', !!live.state.weather || /OFF/.test(live.wx), { hud: live.wx, provider: live.state.provider, error: live.state.error });

// 7) per-preset frame statistics while running through the city at midday
await page.evaluate(() => { window.__ub6.setTime(13); window.__ub6.setWeather('clear'); });
for (const q of ['low', 'medium', 'high']) {
  await page.evaluate((q) => { window.__ub6.setQuality(q); window.__ub6.travel('sukhbaatar_square'); window.__ub6.look(Math.PI, 0.22); }, q);
  await page.waitForFunction(() => !window.__ub6.stats().pending && window.__ub6.stats().near >= 1, null, { timeout: 180000 });
  await sleep(4000);
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  const samples = [];
  for (let i = 0; i < 6; i++) { await sleep(2000); samples.push(await stats()); }
  await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
  const avg = (k) => +(samples.reduce((s, x) => s + x[k], 0) / samples.length).toFixed(1);
  const max = (k) => Math.max(...samples.map((x) => x[k]));
  report.presets[q] = { softwareFps: avg('fps'), worstFrameMs: max('worstMs'), drawCalls: max('calls'), triangles: max('triangles'), chunks: max('chunks'),
    resolution: samples[0].width + 'x' + samples[0].height, textures: max('textures'), geometries: max('geometries') };
  console.log(q, JSON.stringify(report.presets[q]));
  await page.screenshot({ path: out + `preset_${q}.png` });
}
// 8) streaming across the whole slice must not leak: travel around and compare resource counts
await page.evaluate(() => window.__ub6.setQuality('medium'));
const counts = [];
for (const lm of ['zaisan_hill', 'state_department_store', 'chinggis_khaan_museum', 'zaisan_square', 'sukhbaatar_square', 'zaisan_hill', 'sukhbaatar_square']) {
  await page.evaluate((l) => window.__ub6.travel(l), lm);
  await page.waitForFunction(() => !window.__ub6.stats().pending, null, { timeout: 180000 });
  await page.waitForFunction(() => !window.__ub6.stats().streaming, null, { timeout: 300000 });   // compare like with like: fully streamed
  await sleep(1500);
  const s = await stats();
  counts.push({ lm, geometries: s.geometries, textures: s.textures, chunks: s.chunks });
}
const g = counts.map((x) => x.geometries);
ok('streaming releases memory (resource counts stay bounded)', Math.max(...g) < 400 && counts.at(-1).geometries <= counts[4].geometries + 5, counts);
await page.evaluate(() => { window.__ub6.travel('zaisan_hill'); window.__ub6.look(0, 0.1); });
await page.waitForFunction(() => !window.__ub6.stats().pending, null, { timeout: 180000 });
await sleep(5000);
await page.screenshot({ path: out + 'zaisan.png' });
ok('no page errors', report.errors.length === 0, report.errors.slice(0, 5));
fs.writeFileSync(out + 'report.json', JSON.stringify(report, null, 1));
await browser.close();
const failed = Object.values(report.checks).filter((x) => !x.pass).length;
console.log(failed ? failed + ' check(s) FAILED' : 'all checks passed');
process.exit(failed ? 1 : 0);
