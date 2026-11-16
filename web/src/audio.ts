/**
 * Procedural sound for the Ignis experience. Everything is synthesised in the browser with the
 * Web Audio API, so there are no audio files to license or download.
 *
 * - Ambience: a low two-oscillator drone plus filtered noise, like the hum inside a spacecraft.
 * - Radio: rare, faint band-passed chirps, like a distant ground-station link.
 * - Cues: soft pings for selections and a sweep for scene changes.
 *
 * Browsers only allow audio after a user gesture, so nothing plays until enable() is called
 * from a click. The mute choice is remembered.
 */
const KEY = "ignis-sound";

class IgnisAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private oscA: OscillatorNode | null = null;
  private oscB: OscillatorNode | null = null;
  private chirpTimer: number | undefined;
  private listeners = new Set<() => void>();
  /** When each cue last played (ms), so rapid repeats cannot pile up into a buzz. */
  private lastCue: Record<string, number> = {};
  private sweepBuf: AudioBuffer | null = null;
  private _on = false;

  get on() {
    return this._on;
  }
  get preferred(): boolean {
    try {
      return localStorage.getItem(KEY) !== "off";
    } catch {
      return true;
    }
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((f) => f());
  }

  /** Call from a click handler. */
  async enable() {
    if (!this.ctx) this.build();
    if (!this.ctx || !this.master) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0.7, this.ctx.currentTime, 0.9);
    this._on = true;
    try {
      localStorage.setItem(KEY, "on");
    } catch {
      /* ignore */
    }
    this.scheduleChirp();
    this.emit();
  }

  mute() {
    if (!this.ctx || !this.master) {
      this._on = false;
      this.emit();
      return;
    }
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    this._on = false;
    window.clearTimeout(this.chirpTimer);
    try {
      localStorage.setItem(KEY, "off");
    } catch {
      /* ignore */
    }
    this.emit();
  }

  toggle() {
    return this._on ? this.mute() : this.enable();
  }

  private build() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    // a gentle limiter before the speakers, so overlapping sounds never clip and crackle
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);
    this.master = master;

    // gentle low-pass so nothing is harsh
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3200;
    tone.connect(master);

    const drone = ctx.createGain();
    drone.gain.value = 0.5;
    drone.connect(tone);
    this.drone = drone;

    const a = ctx.createOscillator();
    a.type = "sine";
    a.frequency.value = 55;
    const b = ctx.createOscillator();
    b.type = "sine";
    b.frequency.value = 82.6;
    const g2 = ctx.createGain();
    g2.gain.value = 0.55;
    a.connect(drone);
    b.connect(g2).connect(drone);
    a.start();
    b.start();
    this.oscA = a;
    this.oscB = b;

    // slow wobble on the fifth so the drone breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.6;
    lfo.connect(lfoGain).connect(b.frequency);
    lfo.start();

    // brown-ish noise bed
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.2;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 420;
    this.filter = nf;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    noise.connect(nf).connect(ng).connect(tone);
    noise.start();

    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.05;
    const l2g = ctx.createGain();
    l2g.gain.value = 160;
    lfo2.connect(l2g).connect(nf.frequency);
    lfo2.start();
  }

  /** True if this cue has not played in the last `gapMs` milliseconds (and marks it as played). */
  private allow(cue: string, gapMs: number) {
    const now = performance.now();
    if (now - (this.lastCue[cue] ?? -Infinity) < gapMs) return false;
    this.lastCue[cue] = now;
    return true;
  }

  /** 0 = calm opening, 1 = intense analysis. Shifts the drone's pitch and brightness. */
  setIntensity(x: number) {
    if (!this.ctx || !this.oscA || !this.oscB || !this.filter) return;
    const t = this.ctx.currentTime;
    const v = Math.max(0, Math.min(1, x));
    this.oscA.frequency.setTargetAtTime(55 + 12 * v, t, 1.5);
    this.filter.frequency.setTargetAtTime(380 + 700 * v, t, 1.5);
  }

  private scheduleChirp() {
    window.clearTimeout(this.chirpTimer);
    if (!this._on) return;
    this.chirpTimer = window.setTimeout(() => {
      this.chirp();
      this.scheduleChirp();
    }, 7000 + Math.random() * 9000);
  }

  /** A faint two-tone ground-station style blip. */
  private chirp() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this._on) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    bp.Q.value = 6;
    out.connect(bp).connect(master);
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(1500, t);
    o.frequency.setValueAtTime(2100, t + 0.09);
    o.connect(out);
    out.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
    out.gain.setValueAtTime(0.08, t + 0.16);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.start(t);
    o.stop(t + 0.25);
  }

  /** Soft ping for a selection. */
  ping(freq = 880, cue = "ping", gapMs = 90) {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this._on || !this.allow(cue, gapMs)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.75);
  }

  /**
   * The sound of text decoding: a quick, quiet run of tiny high blips, one per "character", as the
   * headings scramble into place when a page opens. About half a second, then silence.
   */
  decode() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this._on || !this.allow("decode", 400)) return;
    const t0 = ctx.currentTime + 0.05;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2400;
    bp.Q.value = 3;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    bp.connect(out).connect(master);
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.032 + Math.random() * 0.01;
      const o = ctx.createOscillator();
      o.type = "square";
      // pitches step up a little through the run, like characters locking in
      o.frequency.value = 1400 + Math.random() * 1400 + i * 40;
      const g = ctx.createGain();
      const peak = 0.1 * (1 - i / (n * 1.4));
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      o.connect(g).connect(bp);
      o.start(t);
      o.stop(t + 0.035);
    }
  }

  /** A short filtered noise sweep for scene transitions. */
  sweep() {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this._on || !this.allow("sweep", 400)) return;
    const t = ctx.currentTime;
    // the noise is made once and reused
    if (!this.sweepBuf) {
      const len = Math.floor(ctx.sampleRate * 1.4);
      this.sweepBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.sweepBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.sweepBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(200, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 1.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }
}

export const audio = new IgnisAudio();
