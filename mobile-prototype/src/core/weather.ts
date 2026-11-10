// Live weather for Ulaanbaatar. Rule (same as server/ub6server): weather is never fabricated.
// Order: 1) the project's own weather server (/v1/world) when VITE_UB6_SERVER_URL is set or the
// dev proxy answers - provider keys stay on that server; 2) Open-Meteo directly, which needs no
// key at all, so nothing secret ever reaches the browser. If both fail the last good observation
// is shown as stale; if there has never been one, weather is "unavailable" and the world stays neutral.
import { ORIGIN_LAT, ORIGIN_LON, UB_UTC_OFFSET_S } from './geo';

export interface Weather {
  observed_at: number; wmo_code: number; temperature_c: number; feels_like_c: number | null;
  humidity_pct: number | null; wind_speed_ms: number | null; wind_direction_deg: number | null;
  cloud_cover_pct: number | null; rain_mm_h: number; snowfall_cm_h: number;
  snow_depth_m: number | null; visibility_m: number | null;
}
export type Freshness = 'live' | 'stale' | 'unavailable';
export interface WeatherState {
  weather: Weather | null; provider: string | null; attribution: string | null;
  fetchedAt: number | null; error: string | null;
}

export const REFRESH_S = 300;
export const LIVE_MAX_AGE_S = 20 * 60;
const STORE_KEY = 'ub6.weather.lastGood';
const OPEN_METEO =
  'https://api.open-meteo.com/v1/forecast?latitude=' + ORIGIN_LAT + '&longitude=' + ORIGIN_LON +
  '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,showers,snowfall,' +
  'weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,snow_depth,visibility' +
  '&wind_speed_unit=ms&timezone=Asia%2FUlaanbaatar&forecast_days=1';

const localIsoToUnix = (s: string) => Math.round(Date.parse(s + (s.length <= 16 ? ':00' : '') + 'Z') / 1000) - UB_UTC_OFFSET_S;
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

/** Same normalisation as OpenMeteoProvider.parse in server/ub6server/providers.py. Throws on bad payloads. */
export function parseOpenMeteo(d: any): Weather {
  const c = d?.current;
  if (!c || typeof c.temperature_2m !== 'number' || typeof c.weather_code !== 'number' || typeof c.time !== 'string') {
    throw new Error('unexpected Open-Meteo payload');
  }
  const perHour = 3600 / (c.interval || 900);
  return {
    observed_at: localIsoToUnix(c.time), wmo_code: Math.trunc(c.weather_code),
    temperature_c: c.temperature_2m, feels_like_c: num(c.apparent_temperature),
    humidity_pct: num(c.relative_humidity_2m), wind_speed_ms: num(c.wind_speed_10m),
    wind_direction_deg: num(c.wind_direction_10m), cloud_cover_pct: num(c.cloud_cover),
    rain_mm_h: ((c.rain || 0) + (c.showers || 0)) * perHour, snowfall_cm_h: (c.snowfall || 0) * perHour,
    snow_depth_m: num(c.snow_depth), visibility_m: num(c.visibility),
  };
}

/** Parses the project's weather server snapshot (GET /v1/world). */
export function parseServerWorld(d: any): WeatherState {
  if (!d || typeof d.server_time_utc !== 'number') throw new Error('unexpected /v1/world payload');
  const w = d.weather;
  if (!w || typeof w.temperature_c !== 'number') {
    return { weather: null, provider: null, attribution: null, fetchedAt: null, error: 'server has no observation' };
  }
  return {
    weather: {
      observed_at: w.observed_at, wmo_code: w.wmo_code, temperature_c: w.temperature_c,
      feels_like_c: num(w.feels_like_c), humidity_pct: num(w.humidity_pct), wind_speed_ms: num(w.wind_speed_ms),
      wind_direction_deg: num(w.wind_direction_deg), cloud_cover_pct: num(w.cloud_cover_pct),
      rain_mm_h: w.rain_mm_h || 0, snowfall_cm_h: w.snowfall_cm_h || 0,
      snow_depth_m: num(w.snow_depth_m), visibility_m: num(w.visibility_m),
    },
    provider: d.provider, attribution: d.attribution, fetchedAt: d.fetched_at, error: null,
  };
}

export function freshness(s: WeatherState, nowUnix: number): Freshness {
  if (!s.weather || s.fetchedAt === null) return 'unavailable';
  return nowUnix - s.fetchedAt <= LIVE_MAX_AGE_S ? 'live' : 'stale';
}

export type WmoKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder' | 'unknown';
/** WMO weather interpretation codes (same table the core uses). */
export function wmoKind(code: number): WmoKind {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'thunder';
  return 'unknown';
}

/** What the renderer needs, derived only from an observation (or neutral when there is none). */
export interface SceneWeather { cloud: number; fog: number; rain: number; snow: number; snowCover: number; windMs: number }
export const NEUTRAL_SCENE: SceneWeather = { cloud: 0, fog: 0, rain: 0, snow: 0, snowCover: 0, windMs: 0 };
export function sceneFromWeather(w: Weather | null): SceneWeather {
  if (!w) return { ...NEUTRAL_SCENE };
  const kind = wmoKind(w.wmo_code);
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const cloud = w.cloud_cover_pct !== null ? clamp(w.cloud_cover_pct / 100)
    : kind === 'clear' ? 0.05 : kind === 'partly' ? 0.45 : 0.9;
  let fog = kind === 'fog' ? 0.8 : 0;
  if (w.visibility_m !== null && w.visibility_m < 8000) fog = Math.max(fog, clamp(1 - w.visibility_m / 8000));
  const rain = kind === 'rain' || kind === 'drizzle' || kind === 'thunder'
    ? clamp(Math.max(w.rain_mm_h / 6, kind === 'drizzle' ? 0.25 : 0.4)) : 0;
  const snow = kind === 'snow' ? clamp(Math.max(w.snowfall_cm_h / 2, 0.35)) : 0;
  const snowCover = w.snow_depth_m !== null ? clamp(w.snow_depth_m / 0.05) : 0;
  return { cloud, fog, rain, snow, snowCover, windMs: w.wind_speed_ms ?? 0 };
}

export class WeatherClient {
  state: WeatherState = { weather: null, provider: null, attribution: null, fetchedAt: null, error: null };
  private lastAttempt = 0;
  private busy = false;
  constructor(private serverUrl: string | undefined = (import.meta as any).env?.VITE_UB6_SERVER_URL) {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) { const s = JSON.parse(raw); if (s?.weather && typeof s.fetchedAt === 'number') this.state = s; }
    } catch { /* storage unavailable: fine */ }
  }

  /** Call often; it fetches at most every REFRESH_S. */
  async tick(nowUnix: number): Promise<void> {
    if (this.busy || nowUnix - this.lastAttempt < (this.state.weather ? REFRESH_S : 30)) return;
    this.busy = true; this.lastAttempt = nowUnix;
    try {
      this.state = await this.fetchOnce();
      try { localStorage.setItem(STORE_KEY, JSON.stringify(this.state)); } catch { /* ignore */ }
    } catch (e) {
      this.state = { ...this.state, error: String((e as Error).message || e) };
    } finally { this.busy = false; }
  }

  private async fetchOnce(): Promise<WeatherState> {
    const errors: string[] = [];
    const base = this.serverUrl !== undefined ? this.serverUrl.replace(/\/$/, '') : (import.meta as any).env?.DEV ? '' : null;
    if (base !== null) {
      try {
        const s = parseServerWorld(await getJson(base + '/v1/world'));
        if (s.weather) return s;
        errors.push('server: no observation');
      } catch (e) { errors.push('server: ' + (e as Error).message); }
    }
    try {
      const w = parseOpenMeteo(await getJson(OPEN_METEO));
      return { weather: w, provider: 'open-meteo', attribution: 'Weather data by Open-Meteo.com (CC BY 4.0)',
        fetchedAt: Math.floor(Date.now() / 1000), error: null };
    } catch (e) { errors.push('open-meteo: ' + (e as Error).message); }
    throw new Error(errors.join('; '));
  }
}

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
