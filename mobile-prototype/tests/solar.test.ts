import { describe, expect, it } from 'vitest';
import { ORIGIN_LAT, ORIGIN_LON, UB_UTC_OFFSET_S, hhmm, ubClock } from '../src/core/geo';
import { sunPosition, sunTimes } from '../src/core/solar';

const utc = (y: number, m: number, d: number, h = 0, mi = 0) => Date.UTC(y, m - 1, d, h, mi) / 1000;

describe('solar (port of core/src/Solar.cpp)', () => {
  it('matches the sunrise and sunset recorded in docs/STATUS.md for 2026-11-10', () => {
    const t = sunTimes(utc(2026, 11, 10, 4), ORIGIN_LAT, ORIGIN_LON, UB_UTC_OFFSET_S);
    expect(t.valid).toBe(true);
    expect(hhmm(t.sunrise)).toBe('07:50');
    expect(hhmm(t.sunset)).toBe('17:21');
    expect(t.civilDawn).toBeLessThan(t.sunrise);
    expect(t.civilDusk).toBeGreaterThan(t.sunset);
  });
  it('puts the noon sun due south at the right height on the solstices', () => {
    for (const [m, d, want] of [[6, 21, 90 - ORIGIN_LAT + 23.44], [12, 21, 90 - ORIGIN_LAT - 23.44]] as const) {
      const noon = sunTimes(utc(2026, m, d, 4), ORIGIN_LAT, ORIGIN_LON, UB_UTC_OFFSET_S).solarNoon;
      const p = sunPosition(noon, ORIGIN_LAT, ORIGIN_LON);
      expect(p.elevationDeg).toBeCloseTo(want, 0);
      expect(Math.abs(p.azimuthDeg - 180)).toBeLessThan(1);
    }
  });
  it('has the sun below the horizon at local midnight and rising in the east', () => {
    expect(sunPosition(utc(2026, 11, 10, 16), ORIGIN_LAT, ORIGIN_LON).elevationDeg).toBeLessThan(-30);
    const t = sunTimes(utc(2026, 11, 10, 4), ORIGIN_LAT, ORIGIN_LON, UB_UTC_OFFSET_S);
    const rise = sunPosition(t.sunrise, ORIGIN_LAT, ORIGIN_LON);
    expect(Math.abs(rise.elevationDeg)).toBeLessThan(1.2);
    expect(rise.azimuthDeg).toBeGreaterThan(90); expect(rise.azimuthDeg).toBeLessThan(135);
  });
  it('converts to Ulaanbaatar wall-clock time across a year boundary', () => {
    const c = ubClock(utc(2026, 12, 31, 18, 30));
    expect([c.year, c.month, c.day, c.hour, c.minute]).toEqual([2027, 1, 1, 2, 30]);
  });
});
