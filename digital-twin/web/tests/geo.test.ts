import { test } from "node:test";
import assert from "node:assert/strict";
import { geodesicDistance, polygonArea, search, latinToCyrillic, resampleHeights, terrariumHeight, formatDistance } from "../lib/geo.ts";

test("Vincenty distance matches a known geodesic (Flinders Peak to Buninyong, 54972.271 m)", () => {
  const d = geodesicDistance([144.42486788888888, -37.95103341666667], [143.92649552777777, -37.65282113888889]);
  assert.ok(Math.abs(d - 54972.271) < 0.01, String(d));
});

test("Sukhbaatar Square to Zaisan is about 4.4 km", () => {
  const d = geodesicDistance([106.917580, 47.918873], [106.9175, 47.8790]);
  assert.ok(d > 4300 && d < 4500, String(d));
});

test("polygon area of a 0.01 x 0.01 degree cell at 47.9 N is about 0.83 km2", () => {
  const a = polygonArea([[106.9, 47.9], [106.91, 47.9], [106.91, 47.91], [106.9, 47.91]]);
  const expected = 0.01 * 111320 * Math.cos((47.905 * Math.PI) / 180) * 0.01 * 111200;
  assert.ok(Math.abs(a - expected) / expected < 0.01, `${a} vs ${expected}`);
});

test("terrarium decoding", () => {
  assert.equal(terrariumHeight(128, 0, 0), 0);
  assert.equal(terrariumHeight(133, 20, 128), 1300.5);
});

test("resampling keeps a constant field constant and corners exact", () => {
  const src = new Float32Array(256 * 256).fill(1350);
  const out = resampleHeights(src, 65);
  assert.ok(out.every((v) => v === 1350));
  const ramp = new Float32Array(256 * 256).map((_, i) => i % 256);
  const r = resampleHeights(ramp, 65);
  assert.equal(r[0], 0);
  assert.equal(r[64], 255);
});

test("search finds districts in Cyrillic and Latin", () => {
  const items = [
    { n: "Хан-Уул дүүрэг", e: "Khan-Uul District", t: "district", x: 106.9, y: 47.85 },
    { n: "Зайсан", t: "bus_stop", x: 106.91, y: 47.88 },
    { n: "Сүхбаатарын талбай", t: "historic_site", x: 106.9176, y: 47.9189 },
  ];
  assert.equal(search(items, "хан")[0].n, "Хан-Уул дүүрэг");
  assert.equal(search(items, "zaisan")[0].n, "Зайсан");
  assert.equal(search(items, "сухбаатар")[0].n, "Сүхбаатарын талбай");
  assert.equal(search(items, "khan-uul")[0].t, "district");
  assert.equal(search(items, "x").length, 0);
});

test("transliteration and formatting", () => {
  assert.equal(latinToCyrillic("khan"), "хан");
  assert.equal(formatDistance(1234.5), "1.234 км");
});
