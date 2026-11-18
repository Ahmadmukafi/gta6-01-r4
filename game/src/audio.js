// DUSTLINE — audio.js
// All sound is synthesized live with WebAudio: no audio files, no network.
// Engine hum, desert wind, police sirens, gunshots, pickups, mission stings,
// and a sparse desert-blues bass line that plays while driving.

export class DustAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.windSrc = null;
    this.windGain = null;
    this.windFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = null;
    this.musicOn = false;
    this.muted = false;
    this._musicStep = 0;
  }

  // Must be called from a user gesture (click / key) the first time.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // --- engine: two detuned saws through a lowpass ---
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const engFilter = this.ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 420;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'sawtooth';
    this.engineOsc2.frequency.value = 55.7;
    this.engineOsc.connect(engFilter);
    this.engineOsc2.connect(engFilter);
    engFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();

    // --- wind: looped noise buffer through a bandpass ---
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.windSrc = this.ctx.createBufferSource();
    this.windSrc.buffer = buf;
    this.windSrc.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 480;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.05;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSrc.start();

    // --- siren: triangle that wails between two tones ---
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 720;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
  }

  // Called every frame with the driving state.
  update(dt, { speed, inCar, wanted, storm, time }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Engine pitch follows speed; silent on foot.
    const rpm = inCar ? 48 + Math.abs(speed) * 2.4 : 0;
    const target = inCar ? 0.05 + Math.min(0.09, Math.abs(speed) * 0.0022) : 0;
    this.engineOsc.frequency.setTargetAtTime(rpm, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(rpm * 1.012 + 1.5, t, 0.08);
    this.engineGain.gain.setTargetAtTime(target, t, 0.12);
    // Wind rises with speed and with the sandstorm.
    const wind = 0.03 + Math.min(0.10, Math.abs(speed) * 0.0028) + storm * 0.16;
    this.windGain.gain.setTargetAtTime(wind, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(380 + storm * 500 + Math.abs(speed) * 8, t, 0.3);
    // Siren wails while wanted, louder at higher heat.
    if (wanted > 0) {
      const wail = 660 + 240 * Math.sin(time * 2.4);
      this.sirenOsc.frequency.setTargetAtTime(wail, t, 0.1);
      this.sirenGain.gain.setTargetAtTime(0.02 + wanted * 0.011, t, 0.4);
    } else {
      this.sirenGain.gain.setTargetAtTime(0, t, 0.4);
    }
  }

  // Short one-shot helpers.
  blip(freq, dur, type = 'sine', vol = 0.16) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  gunshot() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.16;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    const g = this.ctx.createGain();
    g.gain.value = 0.5;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    this.blip(90, 0.12, 'square', 0.2);
  }

  // Dust kick: a low whoosh of sand.
  dustWhoosh() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.7;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.sin((i / len) * Math.PI);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(220, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.value = 0.4;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
  }

  pickup() {
    this.blip(880, 0.09, 'sine', 0.18);
    setTimeout(() => this.blip(1318, 0.14, 'sine', 0.18), 70);
  }

  missionSting(win) {
    const notes = win ? [392, 523, 659, 784] : [330, 262, 196];
    notes.forEach((n, i) => setTimeout(() => this.blip(n, 0.22, 'triangle', 0.2), i * 110));
  }

  crash() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.25;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = 0.45;
    src.connect(g);
    g.connect(this.master);
    src.start(t);
    this.blip(70, 0.2, 'square', 0.25);
  }

  // Sparse desert-blues bass line, one step every 260 ms, A minor pentatonic.
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const bass = [55, 0, 55, 0, 65.4, 0, 49, 0, 55, 0, 82.4, 0, 73.4, 65.4, 49, 0];
    const lead = [220, 0, 0, 261.6, 0, 0, 329.6, 0, 0, 0, 392, 0, 329.6, 0, 261.6, 0];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) return;
      const i = this._musicStep % 16;
      this._musicStep++;
      const b = bass[i];
      if (b) this.blip(b, 0.24, 'triangle', 0.10);
      const l = lead[i];
      if (l && this._musicStep % 32 > 15) this.blip(l, 0.3, 'sine', 0.05);
    }, 260);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicOn = false;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
}
