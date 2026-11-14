// Headless check + screenshots: node scripts/shot.mjs <baseUrl> <outDir>
// Loads the explorer in Chromium (SwiftShader WebGL), waits for data and tiles, and
// captures views. Fails if the page logs errors or the buildings tileset does not load.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:8099";
const out = process.argv[3] ?? "screenshots";
mkdirSync(out, { recursive: true });

const ONLY = process.env.VIEWS?.split(",");
const allViews = [
  { name: "sukhbaatar-square", lon: 106.9176, lat: 47.9095, h: 1750, heading: 10, pitch: -35 },
  { name: "peace-avenue-west", lon: 106.893, lat: 47.9105, h: 1650, heading: 80, pitch: -28 },
  { name: "zaisan-south", lon: 106.9175, lat: 47.872, h: 1900, heading: 0, pitch: -30 },
  { name: "ger-district-north", lon: 106.925, lat: 47.945, h: 1900, heading: 200, pitch: -40 },
  { name: "whole-city", lon: 107.05, lat: 47.25, h: 95000, heading: 0, pitch: -50 },
];
const views = ONLY ? allViews.filter((v) => ONLY.includes(v.name)) : allViews;

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined;
const browser = await chromium.launch({ proxy, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const mobile = process.env.MOBILE === "1";
const page = await browser.newPage({
  viewport: mobile ? { width: 844, height: 390 } : { width: 1280, height: 760 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true,
  userAgent: mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined,
  hasTouch: mobile,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|ERR_PROXY/.test(m.text())) errors.push(m.text()); });
await page.goto(base + "/?" + (process.env.LAYERS ? "layers=" + process.env.LAYERS : "shot=1"), { waitUntil: "load" });
await page.waitForFunction(() => window.__twinReady === true, null, { timeout: 180000 });
const imagery = process.env.IMAGERY ?? "none";
await page.evaluate((m) => window.__twin.setImagery(m), imagery);

async function waitTiles() {
  await page.waitForFunction(() => {
    const t = window.__twin; const s = t.viewer.scene;
    s.requestRender();
    return t.buildings?.tilesLoaded && s.globe.tilesLoaded;
  }, null, { timeout: 240000, polling: 500 }).catch(async (e) => {
    const st = await page.evaluate(() => ({ b: window.__twin.buildings?.tilesLoaded, g: window.__twin.viewer.scene.globe.tilesLoaded }));
    console.error("tiles not loaded", st);
    await page.screenshot({ path: `${out}/_timeout.png` });
    throw e;
  });
  await page.waitForTimeout(Number(process.env.SETTLE ?? 2500));
}

const report = [];
for (const v of views) {
  await page.evaluate((v) => {
    const C = window.__twin.viewer.camera;
    const Cesium = window.__twin.viewer.scene.constructor; void Cesium;
    window.__twin.setView(v.lon, v.lat, v.h, v.heading, v.pitch);
  }, v);
  await waitTiles();
  const stats = await page.evaluate(() => {
    const t = window.__twin;
    return { features: t.buildings?.statistics?.numberOfFeaturesLoaded ?? null, tris: t.buildings?.statistics?.numberOfTrianglesSelected ?? null };
  });
  report.push({ view: v.name, ...stats });
  await page.screenshot({ path: `${out}/${v.name}.png`, timeout: 180000 });
}

// pick the building at screen centre on the square view
await page.evaluate((v) => window.__twin.setView(v.lon, v.lat, v.h, v.heading, v.pitch), views[0]);
await waitTiles();
console.log(JSON.stringify({ report, errors }, null, 1));
await browser.close();
if (errors.length) process.exit(1);
