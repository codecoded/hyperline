// Everything is synthesised with WebAudio: engine, wind, effects and a small
// step-sequenced soundtrack. No audio files.
const NOTE = (n) => 440 * 2 ** ((n - 69) / 12);

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.step = 0;
    this.nextStepTime = 0;
    this.musicOn = false;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10; limiter.ratio.value = 8;
    this.master.connect(limiter).connect(ctx.destination);

    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // engine: detuned saws + sub through a resonant low-pass
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass'; this.engineFilter.Q.value = 5;
    this.engineOsc = [['sawtooth', 1, 0.5], ['sawtooth', 1.012, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2.02, 0.18]].map(([type, ratio, level]) => {
      const osc = ctx.createOscillator(); osc.type = type;
      const g = ctx.createGain(); g.gain.value = level;
      osc.connect(g).connect(this.engineFilter);
      osc.start();
      return { osc, ratio };
    });
    this.engineFilter.connect(this.engineGain).connect(this.master);

    // wind: band-passed noise that opens up with speed
    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuffer; wind.loop = true;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    this.nextStepTime = ctx.currentTime + 0.1;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  setEngine(speedN, throttle, boosting, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const freq = 48 + speedN * 150 + (boosting ? 30 : 0);
    for (const { osc, ratio } of this.engineOsc) osc.frequency.setTargetAtTime(freq * ratio, t, 0.06);
    this.engineFilter.frequency.setTargetAtTime(260 + speedN * 1500 + throttle * 700 + (boosting ? 1400 : 0), t, 0.08);
    this.engineGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.05 : 0, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + speedN * 2600, t, 0.1);
    this.windGain.gain.setTargetAtTime(active ? speedN * speedN * 0.16 : 0, t, 0.1);
  }

  noise(duration, freqFrom, freqTo, gain, type = 'bandpass', dest = this.master, when = this.ctx.currentTime) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter(); filter.type = type; filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(freqFrom, when);
    filter.frequency.exponentialRampToValueAtTime(freqTo, when + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + duration);
    src.connect(filter).connect(g).connect(dest);
    src.start(when, Math.random()); src.stop(when + duration + 0.05);
  }

  tone(freq, duration, gain, type = 'sine', dest = this.master, when = this.ctx.currentTime, glideTo = null) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator(); osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, when + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(g).connect(dest);
    osc.start(when); osc.stop(when + duration + 0.05);
  }

  boost() {
    if (!this.ctx) return;
    this.noise(0.9, 300, 5000, 0.35);
    this.tone(160, 0.7, 0.18, 'sawtooth', this.master, this.ctx.currentTime, 900);
  }

  hit(strength) {
    if (!this.ctx) return;
    const g = Math.min(0.6, 0.12 + strength * 0.012);
    this.noise(0.25, 2400, 300, g);
    this.tone(90, 0.22, g, 'sine', this.master, this.ctx.currentTime, 40);
  }

  beep(high) {
    if (!this.ctx) return;
    this.tone(high ? 1320 : 660, high ? 0.7 : 0.22, 0.25, 'square');
  }

  lap() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [76, 83, 88].forEach((n, i) => this.tone(NOTE(n), 0.25, 0.14, 'triangle', this.master, t + i * 0.09));
  }

  setMusic(on) { this.musicOn = on; }

  /** Call every frame; schedules sequencer steps slightly ahead of the clock. */
  update() {
    if (!this.ctx || !this.musicOn) {
      if (this.ctx) this.nextStepTime = this.ctx.currentTime + 0.05;
      return;
    }
    const stepLen = 60 / 138 / 4;
    while (this.nextStepTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step++, this.nextStepTime, stepLen);
      this.nextStepTime += stepLen;
    }
  }

  playStep(step, t, len) {
    const out = this.musicGain;
    const s = step % 16, bar = Math.floor(step / 16);
    const roots = [45, 45, 41, 43, 45, 45, 48, 43]; // A minor: A A F G A A C G
    const root = roots[bar % roots.length];
    if (s % 4 === 0) this.tone(150, 0.22, 0.6, 'sine', out, t, 42);
    if (s % 4 === 2) this.noise(0.05, 8000, 6000, 0.1, 'highpass', out, t);
    if (s === 4 || s === 12) this.noise(0.16, 1800, 900, 0.22, 'bandpass', out, t);
    if (s % 2 === 1 || s === 14) this.tone(NOTE(root - 12), len * 0.9, 0.2, 'sawtooth', out, t);
    if (bar >= 2) {
      const arp = [0, 7, 12, 15, 19, 15, 12, 7][(s + bar) % 8];
      if (s % 2 === 0) this.tone(NOTE(root + 12 + arp), len * 1.6, 0.045, 'square', out, t);
    }
    if (bar >= 4 && s === 0) {
      for (const n of [0, 3, 7]) this.tone(NOTE(root + 24 + n), len * 15, 0.03, 'sawtooth', out, t);
    }
  }
}
