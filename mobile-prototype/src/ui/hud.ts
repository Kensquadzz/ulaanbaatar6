// DOM heads-up display: clock, weather + freshness, street name, mini-map, settings panel, loading screen.
import { hhmm, ubClock } from '../core/geo';
import type { SunTimes } from '../core/solar';
import { wmoKind, type Freshness, type WeatherState } from '../core/weather';
import type { ChunkData, Landmark } from '../world/types';
import { getLang, setLang, t, type Lang } from './i18n';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
export type QualityChoice = 'auto' | 'low' | 'medium' | 'high';
export type WeatherChoice = 'live' | 'clear' | 'cloudy' | 'snow' | 'rain' | 'fog';
export interface Prefs { lang: Lang; quality: QualityChoice; sens: number; showFps: boolean; fpsCap: 30 | 60 }
export interface HudEvents {
  onPlay(): void; onQuality(q: QualityChoice): void; onTimeMode(live: boolean, hour: number): void;
  onWeather(w: WeatherChoice): void; onTravel(key: string): void; onPause(open: boolean): void;
}
const PREF_KEY = 'ub6.prefs';
export function loadPrefs(): Prefs {
  const d: Prefs = { lang: 'mn', quality: 'auto', sens: 1, showFps: false, fpsCap: 30 };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; } catch { return d; }
}
const ICON: Record<string, string> = { clear: '☀', partly: '⛅', cloudy: '☁', fog: '🌫', drizzle: '🌦', rain: '🌧', snow: '❄', thunder: '⛈', unknown: '·' };
const ROAD_W: Record<string, number> = { trunk: 5, primary: 4.5, secondary: 3.5, tertiary: 3, residential: 2, unclassified: 2, living_street: 1.6, service: 1.2 };

export class Hud {
  prefs = loadPrefs();
  private map = $<HTMLCanvasElement>('minimap');
  private ctx = this.map.getContext('2d')!;
  private mapPx = 0;
  private seg(id: string, value: string) {
    document.querySelectorAll<HTMLElement>(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
  }
  private onSeg(id: string, fn: (v: string) => void) {
    document.querySelectorAll<HTMLElement>(`#${id} button`).forEach((b) =>
      b.addEventListener('click', () => { this.seg(id, b.dataset.v!); fn(b.dataset.v!); }));
  }
  private save() { try { localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ } }

  constructor(private ev: HudEvents, landmarks: Record<string, Landmark>, attribution: string[]) {
    setLang(this.prefs.lang);
    this.seg('segLang', this.prefs.lang); this.seg('segQuality', this.prefs.quality); this.seg('segFps', String(this.prefs.fpsCap));
    this.seg('segTime', 'live'); this.seg('segWeather', 'live');
    $<HTMLInputElement>('sens').value = String(this.prefs.sens);
    $<HTMLInputElement>('showFps').checked = this.prefs.showFps;
    $('fps').classList.toggle('hidden', !this.prefs.showFps);
    $('attribution').textContent = attribution.join(' · ');

    $('btnPlay').addEventListener('click', () => ev.onPlay());
    const open = (o: boolean) => { $('settings').classList.toggle('hidden', !o); ev.onPause(o); };
    $('btnSettings').addEventListener('click', () => open(true));
    $('info').addEventListener('click', () => $('info').classList.toggle('open'));
    $('btnClose').addEventListener('click', () => open(false));
    $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) open(false); });
    this.onSeg('segLang', (v) => { this.prefs.lang = v as Lang; setLang(v as Lang); this.save(); this.fillTravel(landmarks, open); });
    this.onSeg('segQuality', (v) => { this.prefs.quality = v as QualityChoice; this.save(); ev.onQuality(v as QualityChoice); });
    this.onSeg('segFps', (v) => { this.prefs.fpsCap = v === '60' ? 60 : 30; this.save(); });
    const hour = $<HTMLInputElement>('hour');
    const emitTime = () => {
      const live = !document.querySelector('#segTime button[data-v="free"]')!.classList.contains('on');
      const h = Number(hour.value);
      $('freeTime').classList.toggle('hidden', live);
      $('hourLabel').textContent = `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
      ev.onTimeMode(live, h);
    };
    this.onSeg('segTime', emitTime); hour.addEventListener('input', emitTime);
    this.onSeg('segWeather', (v) => ev.onWeather(v as WeatherChoice));
    $<HTMLInputElement>('sens').addEventListener('input', (e) => { this.prefs.sens = Number((e.target as HTMLInputElement).value); this.save(); });
    $<HTMLInputElement>('showFps').addEventListener('change', (e) => {
      this.prefs.showFps = (e.target as HTMLInputElement).checked; this.save();
      $('fps').classList.toggle('hidden', !this.prefs.showFps);
    });
    this.fillTravel(landmarks, open);
  }

  private fillTravel(landmarks: Record<string, Landmark>, open: (o: boolean) => void) {
    const list = $('travelList');
    list.textContent = '';
    for (const key of Object.keys(landmarks)) {
      const b = document.createElement('button');
      b.textContent = t('lm_' + key) === 'lm_' + key ? landmarks[key].name : t('lm_' + key);
      b.addEventListener('click', () => { open(false); this.ev.onTravel(key); });
      list.appendChild(b);
    }
  }

  setLoading(p: number, error?: string) {
    $('barFill').style.width = Math.round(p * 100) + '%';
    if (error) { $('loadText').textContent = error; $('loadText').classList.add('error'); }
    $<HTMLButtonElement>('btnPlay').disabled = p < 1 || !!error;
    if (p >= 1 && !error) $('loadText').style.visibility = 'hidden';
  }
  start() { $('loading').classList.add('hidden'); $('hud').classList.remove('hidden'); }
  private toastTimer = 0;
  /** Shows a message at the bottom; with `seconds` it hides itself again. */
  toast(text: string | null, seconds = 0) {
    clearTimeout(this.toastTimer);
    $('toast').classList.toggle('hidden', !text); if (text) $('toast').textContent = text;
    if (text && seconds > 0) this.toastTimer = window.setTimeout(() => $('toast').classList.add('hidden'), seconds * 1000);
  }
  setFps(text: string) { if (this.prefs.showFps) $('fps').textContent = text; }
  setQualityNote(text: string) { $('qualityNote').textContent = text; }

  setClock(unix: number, live: boolean, sun: SunTimes) {
    const c = ubClock(unix);
    $('clock').textContent = hhmm(unix);
    const days = getLang() === 'mn' ? ['Ням', 'Дав', 'Мяг', 'Лха', 'Пүр', 'Баа', 'Бям'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    $('date').textContent = `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')} ${days[c.weekday]} · UB (UTC+8)`;
    const b = $('timeBadge');
    b.textContent = live ? t('live') : t('free'); b.className = 'badge ' + (live ? 'live' : 'free');
    $('sunLine').textContent = sun.valid ? `${t('sunrise')} ${hhmm(sun.sunrise)} · ${t('sunset')} ${hhmm(sun.sunset)}` : '';
  }

  setWeather(s: WeatherState, fresh: Freshness, manual: WeatherChoice, nowUnix: number) {
    const b = $('wxBadge');
    if (manual !== 'live') {
      $('wxIcon').textContent = ICON[manual === 'cloudy' ? 'cloudy' : manual] ?? '';
      $('wxTemp').textContent = ''; $('wxText').textContent = t('w_' + manual);
      b.textContent = t('manual'); b.className = 'badge free'; $('wxAge').textContent = '';
      return;
    }
    if (fresh === 'unavailable' || !s.weather) {
      $('wxIcon').textContent = ''; $('wxTemp').textContent = '—'; $('wxText').textContent = t('unavailable');
      b.textContent = 'OFF'; b.className = 'badge off'; $('wxAge').textContent = '';
      return;
    }
    const kind = wmoKind(s.weather.wmo_code);
    $('wxIcon').textContent = ICON[kind];
    $('wxTemp').textContent = `${s.weather.temperature_c.toFixed(1)}°C`;
    $('wxText').textContent = t('k_' + kind);
    b.textContent = t(fresh); b.className = 'badge ' + (fresh === 'live' ? 'live' : 'stale');
    $('wxAge').textContent = `${Math.max(0, Math.round((nowUnix - s.fetchedAt!) / 60))} ${t('ago')} · ${s.provider}`;
  }

  setStreet(name: string | null, sub: string | null, district: string | null = null) {
    const el = $('street');
    el.textContent = '';
    const line = (cls: string, text: string) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; el.appendChild(d); };
    if (district) line('district', district);
    if (name) line('name', name);
    if (sub) line('sub', sub);
  }
  setDest(name: string, dist: string, gps: string) {
    $('destName').textContent = name; $('destDist').textContent = dist; $('gps').textContent = gps;
  }

  /** North-relative mini-map rotated so the camera direction is up. All geometry is the real chunk data. */
  drawMinimap(chunks: ChunkData[], pe: number, pn: number, heading: number, camYaw: number,
              landmarks: Record<string, Landmark>, dest: Landmark | null) {
    const css = this.map.clientWidth || 118, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.mapPx !== css * dpr) { this.mapPx = css * dpr; this.map.width = this.map.height = this.mapPx; }
    const g = this.ctx, S = this.mapPx, R = 230, k = S / (2 * R);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#232a36'; g.fillRect(0, 0, S, S);
    g.translate(S / 2, S / 2); g.scale(k, -k); g.rotate(camYaw); g.translate(-pe, -pn);
    const reach = R * 1.45;
    const poly = (pts: [number, number][]) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); };
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const c of chunks) {
      for (const a of c.land_use) if (a.ring && (a.class === 'park' || a.class === 'grass' || a.class === 'pitch' || a.class === 'garden')) { poly(a.ring); g.fillStyle = '#2f4636'; g.fill(); }
      for (const a of c.water) { if (a.ring) { poly(a.ring); g.fillStyle = '#3f6f93'; g.fill(); } else if (a.line) { poly(a.line); g.strokeStyle = '#3f6f93'; g.lineWidth = 5; g.stroke(); } }
    }
    g.fillStyle = '#465066';
    for (const c of chunks) for (const b of c.buildings) {
      const p = b.rings[0][0];
      if (Math.abs(p[0] - pe) > reach || Math.abs(p[1] - pn) > reach) continue;
      for (const r of b.rings) { poly(r); g.fill(); }
    }
    for (const pass of [0, 1]) for (const c of chunks) for (const r of c.roads) {
      const major = r.drivable;
      if ((pass === 1) !== major) continue;
      const p = r.pts[0];
      if (Math.abs(p[0] - pe) > reach + 200 || Math.abs(p[1] - pn) > reach + 200) continue;
      g.beginPath(); r.pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
      g.strokeStyle = major ? (ROAD_W[r.class] >= 3 ? '#f1f3f7' : '#aab2c2') : '#69728a'; g.lineWidth = (major ? ROAD_W[r.class] ?? 1.5 : 0.6) / k * (S / 236);
      g.stroke();
    }
    g.fillStyle = '#f2a23a';
    for (const key in landmarks) { const l = landmarks[key]; g.beginPath(); g.arc(l.east, l.north, 4 / k * (S / 236), 0, 6.3); g.fill(); }
    // overlay in screen space
    g.setTransform(1, 0, 0, 1, S / 2, S / 2);
    const u = S / 118;
    if (dest) {
      const de = dest.east - pe, dn = dest.north - pn, d = Math.hypot(de, dn);
      if (d > R * 0.9) {
        const x = (de * Math.cos(camYaw) - dn * Math.sin(camYaw)) / d, y = -(de * Math.sin(camYaw) + dn * Math.cos(camYaw)) / d;
        g.save(); g.translate(x * (S / 2 - 9 * u), y * (S / 2 - 9 * u)); g.rotate(Math.atan2(y, x));
        g.fillStyle = '#f2a23a'; g.beginPath(); g.moveTo(7 * u, 0); g.lineTo(-4 * u, -5 * u); g.lineTo(-4 * u, 5 * u); g.closePath(); g.fill(); g.restore();
      }
    }
    // north marker
    const nx = -Math.sin(camYaw), ny = -Math.cos(camYaw);
    g.fillStyle = '#fff'; g.font = `700 ${11 * u}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', nx * (S / 2 - 9 * u), ny * (S / 2 - 9 * u));
    // view cone, then the player arrow
    const cone = g.createRadialGradient(0, 0, 0, 0, 0, 34 * u);
    cone.addColorStop(0, 'rgba(242,162,58,0.42)'); cone.addColorStop(1, 'rgba(242,162,58,0)');
    g.fillStyle = cone; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 34 * u, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
    g.rotate(heading - camYaw);
    g.fillStyle = '#fff'; g.strokeStyle = '#1b2230'; g.lineWidth = 1.5 * u;
    g.beginPath(); g.moveTo(0, -8 * u); g.lineTo(6 * u, 7 * u); g.lineTo(0, 3.5 * u); g.lineTo(-6 * u, 7 * u); g.closePath(); g.fill(); g.stroke();
  }
}
