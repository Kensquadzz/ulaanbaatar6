import { describe, expect, it } from 'vitest';
import { LIVE_MAX_AGE_S, freshness, parseOpenMeteo, parseServerWorld, sceneFromWeather, wmoKind } from '../src/core/weather';

const sample = {
  current: { time: '2026-11-10T16:15', interval: 900, temperature_2m: 5.6, relative_humidity_2m: 30, apparent_temperature: 1.9,
    precipitation: 0, rain: 0, showers: 0, snowfall: 0, weather_code: 0, cloud_cover: 0, pressure_msl: 1021,
    wind_speed_10m: 1.1, wind_direction_10m: 270, wind_gusts_10m: 3, snow_depth: 0, visibility: 24000 },
};

describe('weather', () => {
  it('parses an Open-Meteo payload like the server does', () => {
    const w = parseOpenMeteo(sample);
    expect(w.temperature_c).toBe(5.6);
    expect(w.observed_at).toBe(Date.UTC(2026, 10, 10, 8, 15) / 1000);     // 16:15 UB = 08:15 UTC
    expect(w.rain_mm_h).toBe(0);
    expect(wmoKind(w.wmo_code)).toBe('clear');
  });
  it('scales interval precipitation to hourly rates', () => {
    const w = parseOpenMeteo({ current: { ...sample.current, weather_code: 73, snowfall: 0.2, rain: 0.5 } });
    expect(w.snowfall_cm_h).toBeCloseTo(0.8); expect(w.rain_mm_h).toBeCloseTo(2);
  });
  it('rejects malformed payloads instead of inventing values', () => {
    expect(() => parseOpenMeteo({})).toThrow();
    expect(() => parseOpenMeteo({ current: { time: 'x', weather_code: 1 } })).toThrow();
    expect(() => parseServerWorld({})).toThrow();
  });
  it('reads the project weather server snapshot, including the no-observation case', () => {
    const none = parseServerWorld({ server_time_utc: 1, weather: null });
    expect(none.weather).toBeNull();
    const s = parseServerWorld({ server_time_utc: 100, fetched_at: 90, provider: 'open-meteo', attribution: 'a',
      weather: { observed_at: 80, wmo_code: 71, temperature_c: -12, rain_mm_h: 0, snowfall_cm_h: 1, snow_depth_m: 0.1 } });
    expect(s.weather?.temperature_c).toBe(-12); expect(s.fetchedAt).toBe(90);
  });
  it('labels freshness: live, then stale, and unavailable when there has never been data', () => {
    const st = { weather: parseOpenMeteo(sample), provider: 'x', attribution: null, fetchedAt: 1000, error: null };
    expect(freshness(st, 1000 + LIVE_MAX_AGE_S)).toBe('live');
    expect(freshness(st, 1001 + LIVE_MAX_AGE_S)).toBe('stale');
    expect(freshness({ ...st, weather: null, fetchedAt: null }, 1000)).toBe('unavailable');
  });
  it('never changes the world without an observation', () => {
    expect(sceneFromWeather(null)).toEqual({ cloud: 0, fog: 0, rain: 0, snow: 0, snowCover: 0, windMs: 0 });
  });
  it('turns snow, rain and fog observations into scene effects', () => {
    const base = parseOpenMeteo(sample);
    const snow = sceneFromWeather({ ...base, wmo_code: 73, snowfall_cm_h: 1, snow_depth_m: 0.2, cloud_cover_pct: 100 });
    expect(snow.snow).toBeGreaterThan(0.3); expect(snow.rain).toBe(0); expect(snow.snowCover).toBe(1); expect(snow.cloud).toBe(1);
    expect(sceneFromWeather({ ...base, wmo_code: 63, rain_mm_h: 3 }).rain).toBeGreaterThan(0.3);
    expect(sceneFromWeather({ ...base, wmo_code: 45, visibility_m: 300 }).fog).toBeGreaterThan(0.7);
    expect(sceneFromWeather(base).snow).toBe(0);
  });
});
