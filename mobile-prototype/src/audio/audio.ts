// Runtime-generated sound layer: urban traffic bed, engine rev, soft tire rumble,
// footsteps and small vehicle interaction cues. Audio starts only after the user's Play action.
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private cityGain?: GainNode;
  private engineGain?: GainNode;
  private engineOsc?: OscillatorNode;
  private engineHarmonic?: OscillatorNode;
  private weatherGain?: GainNode;
  private noiseBuffer?: AudioBuffer;
  private stepTimer = 0;
  private enabled = true;

  async start() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const ctx = this.ctx;
      const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);

      const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 240; low.Q.value = 0.4; low.connect(master);
      const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 53;
      this.cityGain = ctx.createGain(); this.cityGain.gain.value = 0.025;
      hum.connect(this.cityGain); this.cityGain.connect(low); hum.start();

      this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let i = 0; i < data.length; i++) { const white = Math.random() * 2 - 1; brown = (brown + 0.025 * white) / 1.025; data[i] = brown * 3.2; }
      const traffic = ctx.createBufferSource(); traffic.buffer = this.noiseBuffer; traffic.loop = true;
      const trafficFilter = ctx.createBiquadFilter(); trafficFilter.type = 'lowpass'; trafficFilter.frequency.value = 540;
      const trafficGain = ctx.createGain(); trafficGain.gain.value = 0.08;
      traffic.connect(trafficFilter); trafficFilter.connect(trafficGain); trafficGain.connect(master); traffic.start();

      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
      const engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 430;
      this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 52;
      this.engineHarmonic = ctx.createOscillator(); this.engineHarmonic.type = 'triangle'; this.engineHarmonic.frequency.value = 104;
      const harmonicGain = ctx.createGain(); harmonicGain.gain.value = 0.22;
      this.engineOsc.connect(engineFilter); this.engineHarmonic.connect(harmonicGain); harmonicGain.connect(engineFilter);
      engineFilter.connect(this.engineGain); this.engineGain.connect(master);
      this.engineOsc.start(); this.engineHarmonic.start();

      this.weatherGain = ctx.createGain(); this.weatherGain.gain.value = 0;
      const weatherFilter = ctx.createBiquadFilter(); weatherFilter.type = 'highpass'; weatherFilter.frequency.value = 720;
      const wx = ctx.createBufferSource(); wx.buffer = this.noiseBuffer; wx.loop = true;
      wx.connect(weatherFilter); weatherFilter.connect(this.weatherGain); this.weatherGain.connect(master); wx.start();
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  update(dt: number, speed: number, inVehicle: boolean, rain: number, snow: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const velocity = Math.abs(speed);
    const rpm = 48 + Math.min(190, velocity * 8.4) + (inVehicle ? 12 : 0);
    this.engineOsc?.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineHarmonic?.frequency.setTargetAtTime(rpm * 2.02, t, 0.08);
    this.engineGain?.gain.setTargetAtTime(inVehicle ? 0.042 + Math.min(0.045, velocity * 0.0015) : 0, t, 0.12);
    this.cityGain?.gain.setTargetAtTime(inVehicle ? 0.018 : 0.026, t, 0.6);
    this.weatherGain?.gain.setTargetAtTime(Math.min(0.035, rain * 0.028 + snow * 0.013), t, 0.5);

    if (!inVehicle && velocity > 0.45) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = velocity > 4 ? 0.34 : 0.52;
        this.footstep(velocity > 4);
      }
    } else this.stepTimer = Math.min(this.stepTimer, 0.1);
  }

  vehicleEvent(entering: boolean) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter();
    osc.type = 'triangle'; osc.frequency.setValueAtTime(entering ? 145 : 110, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(entering ? 65 : 48, ctx.currentTime + 0.11);
    filter.type = 'lowpass'; filter.frequency.value = 420;
    gain.gain.setValueAtTime(0.12, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
    osc.connect(filter); filter.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.15);
  }

  private footstep(run: boolean) {
    const ctx = this.ctx; if (!ctx || !this.noiseBuffer) return;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = run ? 520 : 360;
    const gain = ctx.createGain(), now = ctx.currentTime;
    gain.gain.setValueAtTime(run ? 0.11 : 0.075, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    src.connect(filter); filter.connect(gain); gain.connect(ctx.destination); src.start(); src.stop(now + 0.1);
  }

  /** Crash or impact: a filtered noise burst plus a low thump, louder for harder hits. */
  crash(intensity: number) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running' || !this.noiseBuffer) return;
    const k = Math.max(0.15, Math.min(1, intensity)), now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.35 * k, now); g.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    src.connect(f); f.connect(g); g.connect(ctx.destination); src.start(now, Math.random()); src.stop(now + 0.4);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, now); o.frequency.exponentialRampToValueAtTime(38, now + 0.2);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.3 * k, now); og.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o.connect(og); og.connect(ctx.destination); o.start(now); o.stop(now + 0.26);
  }

  private sirenOsc?: OscillatorNode; private sirenGain?: GainNode; private sirenLfo?: OscillatorNode;
  /** Two-tone wail for police and ambulance. level 0 = silent, 1 = close. */
  siren(level: number) {
    const ctx = this.ctx; if (!ctx || ctx.state !== 'running') return;
    if (!this.sirenOsc) {
      this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle'; this.sirenOsc.frequency.value = 760;
      this.sirenLfo = ctx.createOscillator(); this.sirenLfo.type = 'sine'; this.sirenLfo.frequency.value = 0.55;
      const depth = ctx.createGain(); depth.gain.value = 210;
      this.sirenLfo.connect(depth); depth.connect(this.sirenOsc.frequency);
      this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      this.sirenOsc.connect(f); f.connect(this.sirenGain); this.sirenGain.connect(ctx.destination);
      this.sirenOsc.start(); this.sirenLfo.start();
    }
    this.sirenGain!.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.05, ctx.currentTime, 0.2);
  }

  setEnabled(enabled: boolean) { this.enabled = enabled; if (!enabled && this.ctx) void this.ctx.suspend(); }
}
