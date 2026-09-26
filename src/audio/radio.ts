export interface Station {
  name: string;
  genre: string;
}

export const STATIONS: readonly Station[] = [
  { name: '88.1 GLYPH FM', genre: 'lo-fi beats' },
  { name: '93.7 NEON DRIVE', genre: 'synthwave' },
  { name: '101.3 KISSA', genre: 'after-hours jazz' },
  { name: '107.9 HARBOUR', genre: 'ambient' },
];
/** Index past the last station: the radio is off. */
export const RADIO_OFF = STATIONS.length;

interface Program {
  bpm: number;
  /** Steps per bar: 16 for sixteenths, 12 for a swung triplet feel, 8 for slow eighths. */
  steps: number;
  /** Share of each pair of steps given to the first one; 0.5 is straight. */
  swing: number;
  /** Bars each chord lasts. */
  barsPerChord: number;
  chords: readonly Chord[];
  /** Level trim so every station plays about as loud. */
  gain: number;
}

interface Chord {
  bass: number;
  notes: readonly number[];
}

const LOFI: Program = {
  bpm: 76, steps: 16, swing: 0.58, barsPerChord: 1, gain: 1,
  chords: [
    { bass: 43, notes: [58, 62, 65, 69] },
    { bass: 36, notes: [58, 62, 64, 69] },
    { bass: 41, notes: [57, 60, 64, 67] },
    { bass: 38, notes: [53, 57, 60, 64] },
  ],
};
const SYNTH: Program = {
  bpm: 100, steps: 16, swing: 0.5, barsPerChord: 1, gain: 0.75,
  chords: [
    { bass: 33, notes: [57, 60, 64] },
    { bass: 29, notes: [53, 57, 60] },
    { bass: 36, notes: [55, 60, 64] },
    { bass: 31, notes: [55, 59, 62] },
  ],
};
const JAZZ: Program = {
  bpm: 132, steps: 12, swing: 0.5, barsPerChord: 1, gain: 1.45,
  chords: [
    { bass: 36, notes: [51, 55, 58, 62] },
    { bass: 41, notes: [51, 55, 57, 62] },
    { bass: 46, notes: [50, 53, 57, 60] },
    { bass: 43, notes: [53, 56, 59, 63] },
  ],
};
const AMBIENT: Program = {
  bpm: 64, steps: 8, swing: 0.5, barsPerChord: 2, gain: 0.9,
  chords: [
    { bass: 36, notes: [55, 59, 64, 67] },
    { bass: 33, notes: [52, 55, 59, 64] },
    { bass: 29, notes: [52, 57, 60, 64] },
    { bass: 31, notes: [50, 55, 59, 64] },
  ],
};
const PROGRAMS = [LOFI, SYNTH, JAZZ, AMBIENT];
const BUS_GAIN = 0.46;
const F_PENTA = [65, 67, 69, 72, 74, 77, 79, 81];
const C_PENTA = [72, 74, 76, 79, 81, 84, 86, 88];

function hz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * A car radio whose stations are composed on the fly: a lookahead scheduler places every note a
 * fraction of a second ahead on the audio clock, and all instruments are a few oscillators each.
 * The output goes through a band-limited "dashboard speaker" so it sits inside the cab.
 */
export class Radio {
  private readonly out: GainNode;
  private readonly bus: GainNode;
  private station = RADIO_OFF;
  private playing = false;
  private step = 0;
  private nextT = 0;
  private crackle: AudioBufferSourceNode | null = null;
  private readonly vinyl: AudioBuffer;

  constructor(private readonly ctx: AudioContext, dest: AudioNode, private readonly noise: AudioBuffer) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1600;
    mid.gain.value = 3;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(hp).connect(mid).connect(lp).connect(dest);
    this.bus = ctx.createGain();
    this.bus.gain.value = BUS_GAIN;
    this.bus.connect(this.out);
    // Vinyl surface: soft hiss with sparse pops.
    this.vinyl = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const v = this.vinyl.getChannelData(0);
    for (let k = 0; k < v.length; k++) v[k] = (Math.random() * 2 - 1) * 0.04 + (Math.random() < 0.0004 ? (Math.random() * 2 - 1) * 0.9 : 0);
  }

  /** `station` is the tuned station, or RADIO_OFF; `on` is whether anyone is in a cab to hear it. */
  update(on: boolean, station: number): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const live = on && station < RADIO_OFF;
    if (station !== this.station) {
      if (on && this.playing) this.tuneStatic();
      this.station = station;
      this.step = 0;
      this.nextT = now + (this.playing ? 0.35 : 0.05);
      this.setCrackle(station === 0);
      if (station < RADIO_OFF) this.bus.gain.setTargetAtTime(BUS_GAIN * PROGRAMS[station].gain, now, 0.05);
    }
    if (live !== this.playing) {
      this.playing = live;
      this.out.gain.setTargetAtTime(live ? 1 : 0, now, live ? 0.15 : 0.3);
      if (live) {
        this.step = 0;
        this.nextT = now + 0.05;
      }
    }
    if (!live) return;
    const prog = PROGRAMS[this.station];
    const beat = 60 / prog.bpm;
    const pair = (beat * 4 * 2) / prog.steps;
    // Catch up after a stall (tab hidden) instead of firing a burst of old notes.
    if (this.nextT < now - 0.1) this.nextT = now + 0.05;
    while (this.nextT < now + 0.2) {
      this.play(prog, this.step, this.nextT, beat);
      this.nextT += pair * (this.step % 2 === 0 ? prog.swing : 1 - prog.swing);
      this.step++;
    }
  }

  private setCrackle(on: boolean): void {
    if (on && !this.crackle) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.vinyl;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0.5;
      src.connect(g).connect(this.out);
      src.start();
      this.crackle = src;
    } else if (!on && this.crackle) {
      this.crackle.stop();
      this.crackle = null;
    }
  }

  /** Between stations: a sweep of static. */
  private tuneStatic(): void {
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(3500, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random(), 0.45);
  }

  private play(p: Program, k: number, t: number, beat: number): void {
    const s = k % p.steps;
    const bar = Math.floor(k / p.steps);
    const chord = p.chords[Math.floor(bar / p.barsPerChord) % p.chords.length];
    const next = p.chords[Math.floor((bar + 1) / p.barsPerChord) % p.chords.length];
    const r = Math.random();
    switch (p) {
      case LOFI:
        if (s === 0) this.chordEp(chord.notes, t, beat * 3.2, 0.2);
        if ((s === 6 || s === 10) && r < 0.3) this.chordEp(chord.notes, t, beat, 0.12);
        if (s === 0 || (s === 10 && r < 0.7)) this.bass(hz(chord.bass), t, beat * 1.4, 0.34, 'triangle', 420);
        if (s === 7 && r < 0.4) this.bass(hz(chord.bass + 7), t, beat * 0.6, 0.26, 'triangle', 420);
        if (s === 0 || s === 10 || (s === 7 && r < 0.35)) this.kick(t, 0.55);
        if (s === 4 || s === 12) this.snare(t, 0.2, 0.22);
        if (s % 2 === 0) this.hat(t, s % 4 === 0 ? 0.07 : 0.045, false);
        else if (r < 0.15) this.hat(t, 0.03, false);
        if (s % 2 === 0 && s > 0 && r < 0.14) this.ep(hz(pick(F_PENTA)), t, beat * 1.5, 0.1);
        break;
      case SYNTH:
        if (s % 2 === 0) this.bass(hz(chord.bass + (s % 4 === 2 ? 12 : 0)), t, beat * 0.45, 0.2, 'sawtooth', 700);
        if (s % 4 === 0) this.kick(t, 0.6);
        if (s === 4 || s === 12) this.snare(t, 0.3, 0.38);
        if (s % 4 === 2) this.hat(t, 0.06, s === 14);
        else if (s % 2 === 1) this.hat(t, 0.025, false);
        this.pluck(hz(chord.notes[s % chord.notes.length] + 12 + (s >= 8 ? 12 : 0)), t, beat * 0.5, 0.06);
        if (s === 0) this.pad(chord.notes.map(hz), t, beat * 4, 0.05);
        break;
      case JAZZ: {
        if (s % 3 === 0) {
          // Walking bass: root on one, chord tones in the middle, a half-step lead-in to the next root on four.
          const b = s === 0 ? chord.bass : s === 9 ? next.bass + (r < 0.5 ? 1 : -1) : chord.bass + pick([3, 4, 7, 10, 12]);
          this.bass(hz(b), t, beat * 0.9, 0.34, 'triangle', 900);
        }
        if (s === 0 || s === 3 || s === 5 || s === 6 || s === 9 || s === 11) this.ride(t, s % 3 === 0 ? 0.07 : 0.045);
        if (s === 3 || s === 9) this.hat(t, 0.05, false);
        if ((s === 2 || s === 5 || s === 8 || s === 11) && r < 0.28) this.chordEp(chord.notes, t, beat * 0.6, 0.1);
        if (s === 0 && r < 0.2) this.chordEp(chord.notes, t, beat * 0.9, 0.1);
        if (s % 2 === 1 && r < 0.12) this.snare(t, 0.04, 0.1);
        break;
      }
      case AMBIENT:
        if (s === 0 && bar % p.barsPerChord === 0) {
          this.pad(chord.notes.map(hz), t, beat * 8.5, 0.06);
          this.sub(hz(chord.bass), t, beat * 8.5);
        }
        if (r < 0.22) this.bell(hz(pick(C_PENTA)), t, 3.5, 0.05);
        break;
    }
  }

  // ---- instruments ----

  private gainEnv(t: number, attack: number, peak: number, dur: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    g.connect(this.bus);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, dest: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseBurst(t: number, dur: number, type: BiquadFilterType, freq: number, q: number, dest: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private kick(t: number, v: number): void {
    const g = this.gainEnv(t, 0.002, v, 0.32);
    const o = this.osc('sine', 140, t, 0.35, g);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.11);
  }

  private snare(t: number, v: number, tail: number): void {
    this.noiseBurst(t, tail, 'bandpass', 1900, 0.7, this.gainEnv(t, 0.002, v, tail));
    this.osc('triangle', 185, t, 0.08, this.gainEnv(t, 0.002, v * 0.6, 0.07));
  }

  private hat(t: number, v: number, open: boolean): void {
    const d = open ? 0.18 : 0.035;
    this.noiseBurst(t, d, 'highpass', 7200, 0.7, this.gainEnv(t, 0.001, v, d));
  }

  private ride(t: number, v: number): void {
    this.noiseBurst(t, 0.45, 'bandpass', 6400, 1.4, this.gainEnv(t, 0.001, v, 0.45));
    this.osc('sine', 4100, t, 0.3, this.gainEnv(t, 0.001, v * 0.15, 0.3));
  }

  private bass(f: number, t: number, dur: number, v: number, type: OscillatorType, cutoff: number): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.connect(this.gainEnv(t, 0.006, v, dur));
    this.osc(type, f, t, dur, lp);
  }

  /** Electric piano: a sine carrier frequency-modulated at the same pitch, the modulation dying away first. */
  private ep(f: number, t: number, dur: number, v: number): void {
    const ctx = this.ctx;
    const amp = this.gainEnv(t, 0.004, v, dur);
    const car = this.osc('sine', f, t, dur, amp);
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.3, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.08, t + 0.5);
    mod.connect(idx).connect(car.frequency);
    mod.start(t);
    mod.stop(t + dur + 0.05);
  }

  private chordEp(notes: readonly number[], t: number, dur: number, v: number): void {
    notes.forEach((n, k) => this.ep(hz(n), t + k * 0.012, dur, v / Math.sqrt(notes.length)));
  }

  private pluck(f: number, t: number, dur: number, v: number): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    lp.connect(this.gainEnv(t, 0.003, v, dur));
    this.osc('square', f, t, dur, lp);
  }

  private pad(fs: readonly number[], t: number, dur: number, v: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + dur * 0.25);
    g.gain.setValueAtTime(v, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    lp.connect(g).connect(this.bus);
    for (const f of fs) {
      for (const d of [-6, 6]) this.osc('sawtooth', f * 2 ** (d / 1200), t, dur, lp);
    }
  }

  private sub(f: number, t: number, dur: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 1.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(this.bus);
    this.osc('sine', f, t, dur, g);
  }

  /** Glassy bell: inharmonic FM (ratio 3.5) with the brightness fading faster than the tone. */
  private bell(f: number, t: number, dur: number, v: number): void {
    const ctx = this.ctx;
    const car = this.osc('sine', f, t, dur, this.gainEnv(t, 0.003, v, dur));
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 2, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.5);
    mod.connect(idx).connect(car.frequency);
    mod.start(t);
    mod.stop(t + dur + 0.05);
  }
}
