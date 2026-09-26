import type { Camera } from '../render/camera';
import { H_DOCKS, H_DOWNTOWN, H_JAPAN, H_OLDTOWN, H_PARIS } from '../world/hoods';
import type { Vehicle } from '../world/traffic';
import type { EventMode } from '../world/events';
import { Radio } from './radio';

/** Everything the soundscape needs from one frame; sound never reaches into the game itself. */
export interface SoundState {
  dt: number;
  cam: Camera;
  mode: string;
  hood: number;
  /** Walking inside a building. */
  indoors: boolean;
  /** Name of the room program underfoot (e.g. 'NOODLE BAR'), or '' outdoors. */
  room: string;
  weather: string;
  /** 0 idle, 1 doors closing, 2 moving, 3 doors opening. */
  lift: number;
  cars: readonly Vehicle[];
  /** Standing at a crossing whose pedestrian signal says WALK. */
  crossing: boolean;
  /** How dark it is, 0 (day) to 1 (night): birds by day, fewer by night. */
  night: number;
  /** Riding in a cab (taxi or sky taxi), where the radio plays. */
  cab: boolean;
  /** Tuned station, or RADIO_OFF. */
  station: number;
  /** Distance to the nearest open market stall (Infinity if none). */
  market: number;
  /** How often neon signs fail: 'always' buzzes and snaps at random, 'periodic' only in the brownout. */
  events: EventMode;
  brownout: boolean;
}

interface Voice {
  filter: BiquadFilterNode;
  gain: GainNode;
  pan: StereoPannerNode;
  engine: OscillatorNode;
  engineGain: GainNode;
}

/** Pentatonic notes for Japantown's wind chimes. */
const CHIMES = [1568, 1760, 2093, 2349, 2637, 3136];

/** Kinds of sound that can be switched off one by one. */
export const SOUND_KINDS = ['ambience', 'traffic', 'lift', 'events', 'radio'] as const;
export type SoundKind = (typeof SOUND_KINDS)[number];
export const SOUND_KIND_LABELS: Record<SoundKind, string> = {
  ambience: 'City & weather',
  traffic: 'Traffic & rides',
  lift: 'Lifts',
  events: 'Fireworks, cats, thunder',
  radio: 'Taxi radio',
};
const MASTER = 0.8;

/**
 * A soundscape made entirely from oscillators and one noise buffer, so it adds nothing to download.
 * Outdoor sounds share a bus that is low-passed when you walk inside, which does most of the work of
 * making interiors feel enclosed.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private outdoor!: GainNode;
  private muffle!: BiquadFilterNode;
  private indoor!: GainNode;
  private noise!: AudioBuffer;
  private sizzle!: AudioBuffer;
  private city!: GainNode;
  private rainBed!: GainNode;
  private wind!: GainNode;
  private murmur!: GainNode;
  private fry!: GainNode;
  private hum!: GainNode;
  private motor!: GainNode;
  private rumble!: GainNode;
  private voices: Voice[] = [];
  /** A gain per kind on each side of the muffle filter, so any kind can be silenced indoors and out. */
  private readonly kinds = {} as Record<SoundKind, { out: GainNode; in: GainNode }>;
  private readonly off = new Set<SoundKind>();
  private volume = 1;
  private radio: Radio | null = null;
  private t = 0;
  private lastLift = 0;
  private nextChirp = 0;
  private inBrownout = false;
  private next: Record<string, number> = {};
  private honked = new Map<number, number>();
  private on = true;

  get enabled(): boolean {
    return this.on;
  }

  /** One line for the stats overlay. */
  get status(): string {
    if (!this.ctx) return 'waiting for a tap or key press';
    const off = this.off.size > 0 ? `, off: ${[...this.off].join(' ')}` : '';
    return `${this.ctx.state}, ${(this.ctx.sampleRate / 1000).toFixed(1)} kHz, volume ${Math.round(this.volume * 100)}%${this.on ? '' : ' (muted)'}${off}`;
  }

  /** Browsers only start audio from a user gesture; call this from every tap and key press. */
  unlock(): void {
    if (document.hidden) return;
    if (!this.ctx) this.init();
    else if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Silence (and stop the audio clock) while the page is in the background, e.g. after switching apps. */
  pause(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.on = on;
    this.applyMaster();
  }

  /** 0 to 1. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }

  setKind(kind: SoundKind, on: boolean): void {
    if (on) this.off.delete(kind);
    else this.off.add(kind);
    const k = this.kinds[kind];
    if (!this.ctx || !k) return;
    const now = this.ctx.currentTime;
    k.out.gain.setTargetAtTime(on ? 1 : 0, now, 0.05);
    k.in.gain.setTargetAtTime(on ? 1 : 0, now, 0.05);
  }

  private applyMaster(): void {
    // Squared so the slider feels even: loudness is roughly logarithmic.
    if (this.ctx) this.master.gain.setTargetAtTime(this.on ? MASTER * this.volume * this.volume : 0, this.ctx.currentTime, 0.05);
  }

  private outside(kind: SoundKind): GainNode {
    return this.kinds[kind].out;
  }

  private inside(kind: SoundKind): GainNode {
    return this.kinds[kind].in;
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = this.gainNode(this.on ? MASTER * this.volume * this.volume : 0, comp);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 16000;
    this.muffle.connect(this.master);
    this.outdoor = this.gainNode(1, this.muffle);
    this.indoor = this.gainNode(1, this.master);
    for (const k of SOUND_KINDS) {
      const v = this.off.has(k) ? 0 : 1;
      this.kinds[k] = { out: this.gainNode(v, this.outdoor), in: this.gainNode(v, this.indoor) };
    }

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let k = 0; k < n.length; k++) n[k] = Math.random() * 2 - 1;
    // Frying: quiet hiss with sparse crackles.
    this.sizzle = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const s = this.sizzle.getChannelData(0);
    for (let k = 0; k < s.length; k++) s[k] = (Math.random() * 2 - 1) * (Math.random() < 0.002 ? 1 : 0.12);

    this.city = this.bed('lowpass', 420, 0.7, this.outside('ambience'));
    this.rainBed = this.bed('highpass', 900, 0.5, this.outside('ambience'));
    this.wind = this.bed('bandpass', 380, 0.5, this.outside('ambience'));
    this.rumble = this.bed('lowpass', 160, 0.7, this.inside('traffic'));
    this.hum = this.bed('lowpass', 200, 0.7, this.inside('ambience'));
    this.motor = this.bed('lowpass', 110, 1.5, this.inside('lift'));
    this.fry = this.gainNode(0, this.inside('ambience'));
    const fs = ctx.createBufferSource();
    fs.buffer = this.sizzle;
    fs.loop = true;
    const fh = ctx.createBiquadFilter();
    fh.type = 'highpass';
    fh.frequency.value = 2500;
    fs.connect(fh).connect(this.fry);
    fs.start();

    // Crowd murmur: band-passed noise whose loudness wobbles on two slow, unrelated rhythms.
    this.murmur = this.gainNode(0, this.inside('ambience'));
    const am = this.gainNode(0.6, this.murmur);
    const ms = this.loop(this.noise);
    const mf = ctx.createBiquadFilter();
    mf.type = 'bandpass';
    mf.frequency.value = 480;
    mf.Q.value = 1.3;
    ms.connect(mf).connect(am);
    for (const [f, d] of [[0.7, 0.25], [1.9, 0.15]]) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = f;
      lfo.connect(this.gainNode(d, am.gain));
      lfo.start();
    }

    for (let k = 0; k < 3; k++) {
      const src = this.loop(this.noise);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.9;
      const pan = ctx.createStereoPanner();
      pan.connect(this.outside('traffic'));
      const gain = this.gainNode(0, pan);
      src.connect(filter).connect(gain);
      const engine = ctx.createOscillator();
      engine.type = 'sawtooth';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      const engineGain = this.gainNode(0, pan);
      engine.connect(lp).connect(engineGain);
      engine.start();
      this.voices.push({ filter, gain, pan, engine, engineGain });
    }
    this.radio = new Radio(ctx, this.inside('radio'), this.noise);
  }

  // ---- building blocks ----

  private gainNode(v: number, dest: AudioNode | AudioParam): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    if (dest instanceof AudioParam) g.connect(dest);
    else g.connect(dest);
    return g;
  }

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.start(0, Math.random() * buf.duration);
    return src;
  }

  /** Endless filtered noise, silent until its gain is raised. */
  private bed(type: BiquadFilterType, freq: number, q: number, dest: AudioNode): GainNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.gainNode(0, dest);
    this.loop(this.noise).connect(f).connect(g);
    return g;
  }

  private level(g: GainNode, v: number, tc = 0.3): void {
    g.gain.setTargetAtTime(v, this.ctx!.currentTime, tc);
  }

  /** One-shot noise burst through a filter. */
  private burst(type: BiquadFilterType, freq: number, q: number, dur: number, gain: number, dest: AudioNode, delay = 0, pan = 0): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(dest);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  /** One-shot tone with an optional glide, fast attack and exponential decay. */
  private tone(freq: number, dur: number, gain: number, dest: AudioNode, opts: { type?: OscillatorType; to?: number; delay?: number; pan?: number; attack?: number } = {}): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan ?? 0;
    o.connect(g).connect(p).connect(dest);
    o.start(t0);
    o.stop(t0 + a + dur + 0.05);
  }

  /** True once every `min`..`max` seconds for the named event. */
  private every(name: string, min: number, max: number): boolean {
    const at = this.next[name];
    if (at === undefined) {
      this.next[name] = this.t + min * Math.random() + 1;
      return false;
    }
    if (this.t < at) return false;
    this.next[name] = this.t + min + Math.random() * (max - min);
    return true;
  }

  // ---- events the game triggers directly ----

  thunder(): void {
    if (!this.ctx) return;
    const delay = 0.4 + Math.random() * 1.6;
    this.burst('lowpass', 140, 0.8, 3.8, 0.9, this.outside('events'), delay);
    this.burst('lowpass', 600, 0.6, 0.6, 0.35, this.outside('events'), delay);
  }

  shutter(): void {
    if (!this.ctx) return;
    this.burst('highpass', 2500, 0.7, 0.025, 0.4, this.inside('events'));
    this.burst('highpass', 1800, 0.7, 0.04, 0.3, this.inside('events'), 0.09);
  }

  /** A cat: sawtooth through a formant that opens and closes, "mi-a-ow". */
  meow(pan = 0, gain = 0.25): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(480, t0);
    o.frequency.linearRampToValueAtTime(720, t0 + 0.18);
    o.frequency.linearRampToValueAtTime(420, t0 + 0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(900, t0);
    f.frequency.linearRampToValueAtTime(1800, t0 + 0.2);
    f.frequency.linearRampToValueAtTime(800, t0 + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.05);
    g.gain.setValueAtTime(gain, t0 + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(f).connect(g).connect(p).connect(this.inside('events'));
    o.start(t0);
    o.stop(t0 + 0.75);
  }

  /** Short rising blip, for finding things. */
  chime(): void {
    if (!this.ctx) return;
    this.tone(1320, 0.25, 0.12, this.inside('events'));
    this.tone(1980, 0.4, 0.1, this.inside('events'), { delay: 0.1 });
  }

  /**
   * A firework event `dist` metres away at bearing `pan`. Sound travels at 343 m/s, so a far burst is
   * seen a second or two before its boom arrives.
   */
  firework(kind: 'launch' | 'burst' | 'crackle', pan: number, dist: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const o = this.outside('events');
    const delay = dist / 343;
    const near = 1 / (1 + dist / 90);
    if (kind === 'launch') {
      this.burst('lowpass', 300, 0.7, 0.12, 0.2 * near, o, delay, pan);
      this.tone(900, 1.3, 0.035 * near, o, { to: 2600, delay, pan, attack: 0.2 });
    } else if (kind === 'burst') {
      this.burst('lowpass', 170, 0.7, 1.8, 0.75 * near, o, delay, pan);
      this.burst('bandpass', 1100, 0.6, 0.3, 0.3 * near, o, delay, pan);
    } else {
      for (let k = 0; k < 14; k++) this.burst('highpass', 3200, 0.7, 0.018, 0.1 * near, o, delay + 0.7 + Math.random() * 0.9, pan + (Math.random() - 0.5) * 0.3);
    }
  }

  // ---- per frame ----

  update(s: SoundState): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.t += s.dt;
    const out = !s.indoors;
    const fog = s.weather === 'fog', snow = s.weather === 'snow';
    this.muffle.frequency.setTargetAtTime(out ? (fog ? 6000 : 16000) : 650, ctx.currentTime, 0.15);
    this.level(this.outdoor, out ? 1 : 0.55);

    // Snow hushes the city; the only sound left is a soft wind.
    this.level(this.city, (s.hood === H_DOWNTOWN ? 0.35 : 0.22) * (s.cam.y > 60 ? 0.5 : 1) * (snow ? 0.5 : 1));
    this.level(this.rainBed, s.weather === 'rain' ? 0.07 : 0, 0.8);
    this.level(this.wind, snow ? 0.12 : 0, 1.5);
    this.traffic(s);
    this.lift(s);
    this.room(s);
    this.district(s);
    this.ride(s);
    this.radio?.update(s.cab, s.station);

    if (s.crossing && this.t >= this.nextChirp) {
      this.nextChirp = this.t + 0.55;
      this.tone(2900, 0.06, 0.05, this.outside('ambience'), { to: 3700 });
    }
  }

  /** The three nearest cars get a voice: tyre noise and engine, panned and Doppler-shifted. */
  private traffic(s: SoundState): void {
    const cam = s.cam;
    const near = s.cars
      .map((v) => ({ v, d: Math.hypot(v.x - cam.x, v.y - cam.y, v.z - cam.z) }))
      .filter((e) => e.d < 70)
      .sort((a, b) => a.d - b.d)
      .slice(0, this.voices.length);
    const now = this.ctx!.currentTime;
    this.voices.forEach((voice, k) => {
      const e = near[k];
      if (!e) {
        voice.gain.gain.setTargetAtTime(0, now, 0.2);
        voice.engineGain.gain.setTargetAtTime(0, now, 0.2);
        return;
      }
      const { v, d } = e;
      const dx = v.x - cam.x, dz = v.z - cam.z;
      const vx = Math.sin(v.yaw) * v.vel, vz = Math.cos(v.yaw) * v.vel;
      const radial = d > 0.1 ? (vx * dx + vz * dz) / d : 0;
      const doppler = 343 / (343 + radial);
      const bearing = Math.atan2(dx, dz) - cam.yaw;
      const fall = 1 / (1 + (d / 7) ** 2);
      const speed = Math.min(1, v.vel / 12);
      voice.pan.pan.setTargetAtTime(Math.sin(bearing) * 0.9, now, 0.05);
      voice.filter.frequency.setTargetAtTime(240 * doppler * (0.7 + v.vel / 22), now, 0.05);
      voice.gain.gain.setTargetAtTime(0.5 * fall * (0.25 + speed), now, 0.08);
      voice.engine.frequency.setTargetAtTime((38 + v.vel * 3.2) * doppler, now, 0.08);
      voice.engineGain.gain.setTargetAtTime(0.1 * fall, now, 0.08);
      // A car that flashes its lights at you also leans on the horn, once.
      if (v.flash > 0 && d < 45) {
        const last = this.honked.get(v.seed) ?? -99;
        if (this.t - last > 4) {
          this.honked.set(v.seed, this.t);
          const pan = Math.sin(bearing) * 0.8;
          this.tone(392, 0.35, 0.12 * Math.max(fall, 0.2), this.outside('traffic'), { type: 'square', pan });
          this.tone(494, 0.35, 0.1 * Math.max(fall, 0.2), this.outside('traffic'), { type: 'square', pan });
        }
      }
    });
  }

  private lift(s: SoundState): void {
    const phase = s.lift;
    if (phase !== this.lastLift) {
      if (phase === 1 || phase === 3) this.burst('bandpass', 700, 0.8, 0.7, 0.12, this.inside('lift'));
      if (phase === 3) {
        this.tone(1319, 0.9, 0.12, this.inside('lift'));
        this.tone(1047, 1.2, 0.1, this.inside('lift'), { delay: 0.18 });
      }
      this.lastLift = phase;
    }
    this.level(this.motor, phase === 2 ? 0.35 : 0, 0.25);
  }

  /** Each kind of room has its own background: murmur, frying, humming machines, arcade bleeps. */
  private room(s: SoundState): void {
    const r = s.room;
    const busy = ['CAFE', 'BAR', 'LOBBY', 'NOODLE BAR', 'BAKERY', 'SKY LOUNGE'].includes(r);
    // Out at the night market: chatter and sizzling pans, fading over the length of the stalls.
    const stalls = !s.indoors && s.mode === 'walk' ? Math.max(0, 1 - s.market / 22) : 0;
    this.level(this.murmur, Math.max(busy ? (r === 'BAR' || r === 'SKY LOUNGE' ? 0.55 : 0.4) : 0, stalls * 0.45));
    this.level(this.fry, Math.max(r === 'NOODLE BAR' ? 0.3 : 0, stalls * stalls * 0.22));
    const humming = r === 'OFFICES' || r === 'SHIPPING OFFICE' || r === 'WAREHOUSE' || r === 'SHOP';
    this.level(this.hum, humming ? (r === 'WAREHOUSE' ? 0.5 : 0.25) : s.indoors ? 0.08 : 0);
    if ((r === 'CAFE' || r === 'BAR') && this.every('clink', 2, 7)) this.tone(2800 + Math.random() * 900, 0.3, 0.04, this.inside('ambience'));
    if (r === 'ARCADE' && this.every('bleep', 0.06, 0.25)) {
      this.tone(220 * 2 ** (Math.floor(Math.random() * 24) / 12), 0.08, 0.07, this.inside('ambience'), { type: 'square', pan: Math.random() * 1.6 - 0.8 });
    }
    if (r === 'WAREHOUSE' && this.every('clank', 5, 14)) {
      for (const f of [310, 437, 596]) this.tone(f, 1.4, 0.05, this.inside('ambience'), { pan: 0.4 });
    }
    if (r === 'TATAMI ROOM' && this.every('chimeIn', 6, 14)) this.windChime(0.3);
  }

  private windChime(pan: number): void {
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      this.tone(CHIMES[Math.floor(Math.random() * CHIMES.length)], 2.4, 0.045, this.outside('ambience'), { delay: k * (0.12 + Math.random() * 0.25), pan });
    }
  }

  /** A signature sound per district, heard outdoors (and muffled through the walls). */
  private district(s: SoundState): void {
    const o = this.outside('ambience');
    // Neon districts at night: the buzz and snap of failing signs, now and then or all at once in a brownout.
    const neon = (s.hood === H_DOWNTOWN || s.hood === H_JAPAN) && s.night > 0.5;
    if (neon && s.events === 'always' && this.every('neon', 5, 13)) this.neonZap(Math.random() * 1.4 - 0.7);
    if (neon && s.brownout && !this.inBrownout) for (let k = 0; k < 4; k++) this.neonZap(Math.random() * 1.6 - 0.8, k * 0.4);
    this.inBrownout = s.brownout;
    switch (s.hood) {
      case H_JAPAN:
        if (this.every('chime', 4, 10)) this.windChime(Math.random() * 1.2 - 0.6);
        break;
      case H_DOCKS:
        if (this.every('foghorn', s.weather === 'fog' ? 14 : 30, s.weather === 'fog' ? 28 : 60)) {
          for (const f of [98, 49]) this.tone(f, 2.6, 0.18, o, { type: 'sawtooth', attack: 0.9 });
        }
        if (this.every('gull', 5, 14)) {
          const pan = Math.random() * 1.6 - 0.8;
          for (let k = 0; k < 3; k++) this.tone(1700, 0.22, 0.045, o, { to: 1150, delay: k * 0.28, pan });
        }
        break;
      case H_PARIS:
        if (this.every('bell', 45, 90)) this.bell(196, 4, o);
        break;
      case H_OLDTOWN:
        if (s.night < 0.6 && this.every('bird', 1.5, 5)) {
          const pan = Math.random() * 1.6 - 0.8, f = 3000 + Math.random() * 1500;
          for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) this.tone(f, 0.07, 0.03, o, { to: f * 1.3, delay: k * 0.11, pan });
        }
        if (this.every('bellOld', 70, 140)) this.bell(262, 3, o);
        break;
      case H_DOWNTOWN:
        if (this.every('siren', 40, 90)) {
          for (let k = 0; k < 4; k++) this.tone(720, 0.5, 0.03, o, { to: 1050, delay: k * 0.55, pan: 0.6 });
        }
        break;
    }
  }

  /** A mains-hum buzz chopped into a few stutters, like a neon tube struggling to strike. */
  private neonZap(pan: number, start = 0): void {
    const n = 2 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const delay = start + k * (0.05 + Math.random() * 0.12);
      this.tone(120, 0.07 + Math.random() * 0.08, 0.018, this.outside('ambience'), { type: 'sawtooth', delay, pan });
      this.burst('bandpass', 3500, 1.5, 0.03, 0.05, this.outside('ambience'), delay, pan);
    }
  }

  /** Church bell: inharmonic partials with long decays, struck `n` times. */
  private bell(f: number, n: number, dest: AudioNode): void {
    for (let k = 0; k < n; k++) {
      for (const [m, g] of [[1, 0.06], [2, 0.04], [2.4, 0.035], [3, 0.025], [4.2, 0.015]]) {
        this.tone(f * m, 4, g, dest, { delay: k * 1.6, pan: -0.3 });
      }
    }
  }

  /** Riding along: clacking monorail bogies, or the hum of a taxi. */
  private ride(s: SoundState): void {
    const riding = s.mode === 'rail' || s.mode === 'taxi' || s.mode === 'sky';
    this.level(this.rumble, riding ? (s.mode === 'sky' ? 0.12 : 0.25) : 0);
    if (s.mode === 'rail' && this.every('clack', 0.55, 0.6)) {
      this.burst('lowpass', 1400, 1, 0.05, 0.25, this.inside('traffic'));
      this.burst('lowpass', 1200, 1, 0.05, 0.2, this.inside('traffic'), 0.14);
    }
  }
}
