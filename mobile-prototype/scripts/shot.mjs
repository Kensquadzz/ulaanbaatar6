// Dev helper: opens the built game in headless Chromium at an iPhone-landscape viewport and saves screenshots.
// usage: node scripts/shot.mjs <url> <outDir> [hour] [weather] [landmark]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // global install in CI/cloud; or npm i -D playwright
import fs from 'node:fs';
const [url, out, hour, wx, lm, q = 'medium', yaw, pitch] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => !document.getElementById('btnPlay').disabled, null, { timeout: 120000 });
await page.screenshot({ path: out + '/loading.png' });
await page.evaluate(() => { document.getElementById('btnPlay').click(); }); await page.evaluate((q) => window.__ub6.setQuality(q), q);
if (hour) await page.evaluate((h) => window.__ub6.setTime(Number(h)), hour);
if (wx) await page.evaluate((w) => window.__ub6.setWeather(w), wx);
if (lm) { await page.evaluate((l) => window.__ub6.travel(l), lm); await page.waitForFunction(() => !window.__ub6.stats().pending, null, { timeout: 120000 }); }
if (yaw) await page.evaluate(([y, p]) => window.__ub6.look(Number(y), Number(p)), [yaw, pitch || 0.25]);
await page.waitForTimeout(7000);
await page.screenshot({ path: out + `/game_${hour || 'live'}_${wx || 'live'}_${lm || 'spawn'}.png` });
console.log(JSON.stringify(await page.evaluate(() => window.__ub6.stats())));
await browser.close();
