// Tiny WebAudio synth — all sound effects generated at runtime, no assets.

// The engine's whole vocabulary for "what is this made of". Clicks and harvests
// both key off it, on purpose: the HUD and the world should agree about what iron
// sounds like. The engine deliberately does not know about trees or veins — the
// caller maps its own entities onto these three.
export type Material = 'wood' | 'stone' | 'metal';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    vol = 1,
    slide = 0,
    delay = 0
  ): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol * 0.5, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // `cutoff` defaults to the original 1400Hz so the cues written against this
  // primitive are unchanged; the crate thud needs it far lower to read as a slam
  // rather than as a hiss.
  private noise(dur: number, vol = 0.5, delay = 0, cutoff = 1400): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = vol * 0.3;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff;
    src.connect(filt).connect(gain).connect(this.master);
    src.start(t0);
  }

  // ---- click primitives ---------------------------------------------------------
  // `tone` keeps its 8ms attack deliberately: fourteen cues are voiced against it,
  // and shortening it there would retune the whole game at once. The click is the
  // one cue that cannot live with it — 8ms of ramp is longer than the entire
  // transient a click is *made of*, which is why a lone square read as a soft beep
  // instead of as contact. So the click is built from its own two primitives, and
  // every click is one of each: the contact, then the material.

  // The contact. A filtered noise spit with a sub-millisecond attack, band-passed
  // rather than low-passed the way `noise` is — the character of a tap lives in a
  // narrow band, and wide-open noise reads as a hiss rather than as a knock.
  private tick(dur: number, vol: number, freq: number, q = 1.1): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // cubic decay, not the linear one `noise` uses: all the energy belongs in the
    // first few milliseconds, or the spit turns into a rattle.
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol * 0.3, t0 + 0.0005);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    src.connect(bp).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.01);
  }

  // The material. A short pitched body that falls as it decays — the fall is what
  // makes a tap sound *struck*; hold the pitch flat and it reads as a played note.
  private body(freq: number, drop: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq - drop), t0 + dur * 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol * 0.5, t0 + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // The click takes the material of whatever was clicked, so a log pill and an iron
  // pill do not answer in the same voice.
  //
  // `wood` is the default, and that is why none of the ~20 existing callers need an
  // argument: menus, buttons and toolbar chips are the game's neutral surface, and
  // wood is its neutral material.
  click(material: Material = 'wood'): void {
    if (material === 'stone') {
      // a nail on slate: tight, bright, almost no body
      this.tick(0.018, 0.85, 5200, 0.9);
      this.body(640, 130, 0.026, 'sine', 0.42);
      return;
    }
    if (material === 'metal') {
      // A dense, dull tap rather than a ring — and the contrast with `harvest`
      // is deliberate, not an inconsistency. Struck *ore* rings; worked iron is
      // dead weight. A ring at click frequency would also nag, which is the one
      // thing a UI cue must never do.
      this.tick(0.03, 0.7, 1200, 1.4);
      this.body(240, 115, 0.08, 'sine', 0.6);
      return;
    }
    // wood — a knuckle on a plank, and the one that sits under the other wooden
    // cues (`chop`, `built`) without competing with them
    this.tick(0.024, 0.9, 2400, 1.2);
    this.body(340, 145, 0.042, 'triangle', 0.5);
  }

  // Terrain tiles — a ladder rung, a ramp, a plank bridge. Light and quick,
  // because the player's drag *is* the labor and a heavy cue on a ten-tile drag
  // would hammer ten times. Buildings get `placeBuilding` instead.
  place(): void {
    this.tone(392, 0.07, 'square', 0.6);
    this.tone(523, 0.09, 'square', 0.5, 0, 0.05);
  }

  // Setting down a heavy crate. Three layers landing together: a low-passed slam
  // for the contact, a deep body that drops fast and then rings on (the boom), and
  // a timber knock just above it so the weight reads as *wood* rather than as a
  // drum. The body is the loudest thing the engine plays — a blueprint is the
  // heaviest commitment the player makes, and it should feel like it.
  placeBuilding(): void {
    this.noise(0.06, 0.55, 0, 420);
    this.body(105, 63, 0.34, 'sine', 0.95);
    this.body(180, 50, 0.09, 'triangle', 0.4);
  }

  // Struck metal: inharmonic partials over a long decay. The inharmonicity is the
  // whole trick — whole-number ratios read as a bell or a plucked note, and ore
  // wants to read as a dull clang.
  private ring(f: number, dur: number, vol: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime;
    // plate-like ratios, deliberately not harmonic
    const partials: [number, number, number][] = [
      [1, 1, dur],
      [2.76, 0.5, dur * 0.62],
      [5.4, 0.22, dur * 0.34],
    ];
    for (const [mult, g, d] of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * mult;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol * g * 0.5, t0 + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0008, t0 + d);
      osc.connect(gain).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + d + 0.02);
    }
  }

  // One cue per resource, and they are separated by **decay and harmonicity**, not
  // by pitch: pitch-shift a single cue three ways and it is audibly the same cue
  // three times, which is the thing this is meant to avoid. Wood cracks and is
  // gone, stone is the shortest and most brittle, metal rings on far longer than
  // either. The engine speaks materials rather than node kinds — the caller owns
  // the mapping, so nothing here needs to know what a `vein` is.
  harvest(material: Material): void {
    if (material === 'stone') {
      // a pick chipping rock: tight bright contact, almost no body, grit behind it
      this.tick(0.016, 0.95, 3600, 2.2);
      this.body(420, 210, 0.035, 'square', 0.35);
      this.noise(0.05, 0.45, 0.01, 2200);
      return;
    }
    if (material === 'metal') {
      this.tick(0.014, 0.8, 4200, 2);
      this.ring(520, 0.42, 0.3);
      this.body(150, 60, 0.06, 'sine', 0.3);
      return;
    }
    // wood: the axe bite, a woody crack, and a short fibre tear under it
    this.tick(0.03, 0.75, 1800, 1);
    this.body(210, 90, 0.09, 'triangle', 0.55);
    this.noise(0.06, 0.35, 0, 900);
  }

  invalid(): void {
    this.tone(180, 0.12, 'sawtooth', 0.5, -60);
  }

  // Kept as the wood harvest under its old name so callers that mean "chopping"
  // still read that way; `harvest` is the one that varies by material.
  chop(): void {
    this.harvest('wood');
  }

  // a shovel biting into earth: a soft soil-crumble with a low, muffled thud
  dig(): void {
    this.noise(0.12, 0.5);
    this.tone(104, 0.08, 'triangle', 0.4, -28);
  }

  deposit(): void {
    this.tone(587, 0.06, 'triangle', 0.5);
    this.tone(784, 0.08, 'triangle', 0.45, 0, 0.05);
  }

  goalDeposit(): void {
    this.tone(659, 0.08, 'square', 0.55);
    this.tone(880, 0.1, 'square', 0.5, 0, 0.07);
    this.tone(1047, 0.14, 'square', 0.45, 0, 0.14);
  }

  built(): void {
    this.noise(0.12, 0.6);
    this.tone(440, 0.1, 'triangle', 0.6);
    this.tone(660, 0.14, 'triangle', 0.55, 0, 0.09);
  }

  // the counterweight hoist starting a swap: a wooden wheel-creak, then the
  // rope running — a low groan sliding down while a light whistle rises
  hoistCycle(): void {
    this.tone(140, 0.22, 'sawtooth', 0.35, -50);
    this.tone(220, 0.3, 'triangle', 0.3, 90, 0.1);
    this.noise(0.2, 0.25, 0.05);
  }

  upgraded(): void {
    const notes = [392, 494, 587, 784];
    notes.forEach((f, i) => this.tone(f, 0.16, 'square', 0.5, 0, i * 0.1));
  }

  spawn(): void {
    this.tone(880, 0.06, 'sine', 0.4, 120);
  }

  demolish(): void {
    this.noise(0.16, 0.9);
    this.tone(120, 0.14, 'sawtooth', 0.4, -50);
  }

  win(): void {
    const melody = [523, 659, 784, 1047, 784, 1047, 1319];
    melody.forEach((f, i) => this.tone(f, 0.22, 'square', 0.5, 0, i * 0.13));
    this.noise(0.3, 0.4, 0.9);
  }

  hint(): void {
    this.tone(988, 0.09, 'sine', 0.35);
    this.tone(1319, 0.12, 'sine', 0.3, 0, 0.08);
  }

  splash(): void {
    this.noise(0.22, 0.7);
    this.tone(240, 0.16, 'sine', 0.4, -140);
  }
}

export const audio = new AudioEngine();

// ---- background music ---------------------------------------------------------
// A live, generative chiptune bed — the same C–Am–F–G / soft-arp voice as the
// teaser soundtrack (tools/trailer/music.mjs), re-synthesized in WebAudio so it
// loops forever with no asset file. Deliberately quiet and slow-breathing: a
// 32-bar macro cycle swells the bass, hats and octave-doubled lead in and back
// out again so the loop never settles into a grating same-ness. Own
// AudioContext + master, independent of the SFX engine, so the Music toggle and
// the Sound toggle never touch each other.

const M_BPM = 112;
const M_BEAT = 60 / M_BPM;
const M_STEP = M_BEAT / 4; // sixteenth
const M_BAR = 4 * M_BEAT;

const midiFreq = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

// chord tones as midi offsets from C4=60: C, Am, F, G — two bars each
const M_PROG = [
  { root: 60, third: 64, fifth: 67 }, // C
  { root: 57, third: 60, fifth: 64 }, // Am
  { root: 53, third: 57, fifth: 60 }, // F
  { root: 55, third: 59, fifth: 62 }, // G
];
// sixteenth-step arp: indices into [root, third, fifth, octave], -1 = rest
const M_ARP = [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 5, 1, 2, 3, 2];
const M_TONE = (c: { root: number; third: number; fifth: number }, idx: number): number =>
  [c.root, c.third, c.fifth, c.root + 12, c.third + 12, c.fifth + 12][idx];

class MusicEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private leadBus: GainNode | null = null; // lead voices route here, then into the ping-pong delay
  private noiseBuf: AudioBuffer | null = null;
  private enabled = false; // user preference (options toggle)
  private scenePlaying = false; // the scene wants music (in a live level, tab visible)
  private playing = false; // audio graph is actively scheduling
  private timer: ReturnType<typeof setInterval> | null = null;
  private bar = 0;
  private nextBarTime = 0;

  // Raised from 0.13 now that a sustained pad carries the bed rather than a bare
  // arp: the old number was quiet because a lone pluck at any real level nags.
  // Still under the SFX master (0.35) so cues stay on top of the music.
  private vol = 0.19;

  // A/B knobs for the two new bed voices, so the draft can be judged by ear
  // (`__smallhands.music.padOn = false`) instead of by rebuild.
  padOn = true;
  pulseOn = true;

  // Build the persistent graph once: master → destination, plus a cross-feedback
  // ping-pong delay on the lead bus (dotted-eighth) for width without a chorus.
  private buildGraph(ctx: AudioContext): void {
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const leadBus = ctx.createGain();
    leadBus.connect(master); // dry lead

    const dtime = 1.5 * (M_BEAT / 2); // dotted-eighth echo
    const delayL = ctx.createDelay(1);
    const delayR = ctx.createDelay(1);
    delayL.delayTime.value = dtime;
    delayR.delayTime.value = dtime;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = 0.33;
    fbR.gain.value = 0.33;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.8;
    panR.pan.value = 0.8;
    // lead → delayL, bouncing delayL ⇄ delayR, each tap panned hard and mixed wet
    leadBus.connect(delayL);
    delayL.connect(fbR).connect(delayR);
    delayR.connect(fbL).connect(delayL);
    delayL.connect(panL).connect(master);
    delayR.connect(panR).connect(master);

    // one cached second of white noise, re-triggered for each hi-hat
    const nlen = Math.floor(ctx.sampleRate);
    const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;

    this.master = master;
    this.leadBus = leadBus;
    this.noiseBuf = nbuf;
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.buildGraph(this.ctx);
      } catch {
        this.ctx = null;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  // a plucked lead note: triangle body with a whisper of square, fast attack and
  // a short decay tail, routed through the delay bus.
  private lead(t0: number, dur: number, f: number, g: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.leadBus) return;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(g * 0.5, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    const o1 = ctx.createOscillator();
    o1.type = 'triangle';
    o1.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = f * 1.003; // slight detune warms the blend
    const o2g = ctx.createGain();
    o2g.gain.value = 0.32; // square kept quiet — it is the harsh one
    o1.connect(env);
    o2.connect(o2g).connect(env);
    env.connect(this.leadBus);
    o1.start(t0);
    o2.start(t0);
    o1.stop(t0 + dur + 0.05);
    o2.stop(t0 + dur + 0.05);
  }

  // sine bass with a soft second harmonic, kept dry (out of the delay).
  private bass(t0: number, dur: number, f: number, g: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(g, t0 + 0.012);
    env.gain.setValueAtTime(g, t0 + Math.max(0.02, dur - 0.08));
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.32;
    o.connect(env);
    o2.connect(o2g).connect(env);
    env.connect(this.master);
    o.start(t0);
    o2.start(t0);
    o.stop(t0 + dur + 0.05);
    o2.stop(t0 + dur + 0.05);
  }

  // The sustained bed — the one voice the old arrangement had no equivalent for.
  // Two saws a few cents apart through a gentle lowpass, slow swell, long tail,
  // held across a whole chord. Kept out of the delay bus on purpose: a sustained
  // voice through a dotted-eighth ping-pong smears into mud, and that delay exists
  // to give the *pluck* width, not the pad.
  private pad(t0: number, dur: number, f: number, g: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(g, t0 + 0.5);
    env.gain.setValueAtTime(g, t0 + Math.max(0.6, dur - 0.9));
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 780;
    lp.Q.value = 0.4;
    for (const detune of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = detune; // motion without a chorus node
      o.connect(lp);
      o.start(t0);
      o.stop(t0 + dur + 0.1);
    }
    lp.connect(env).connect(this.master);
  }

  // A soft low pulse on the downbeats. The only voice in the bed with a real
  // attack, so it supplies a walking pace rather than a backbeat — sine alone,
  // because layering noise on it reads as a drum kit, which this game is not.
  private pulse(t0: number, g: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t0);
    o.frequency.exponentialRampToValueAtTime(52, t0 + 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(g, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.2);
    o.connect(env).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.24);
  }

  // an offbeat hi-hat: a short white-noise tick through a highpass, kept dry.
  private hat(t0: number, g: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(g, t0);
    env.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.04);
    src.connect(hp).connect(env).connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.06);
  }

  private scheduleBar(bar: number, t: number): void {
    const chord = M_PROG[Math.floor(bar / 2) % M_PROG.length];
    // 32-bar macro cycle: section 0 is sparse (lead only), building to a full
    // section 3, then back — the slow breathe that keeps the loop from grating.
    const section = Math.floor(bar / 8) % 4;
    const withBass = section >= 1;
    const withHats = section >= 2;
    const doublePass = section >= 3;
    const leadScale = section === 0 ? 0.7 : 1;

    for (let s = 0; s < 16; s++) {
      const idx = M_ARP[s];
      if (idx < 0) continue;
      const ts = t + s * M_STEP;
      const accent = s % 4 === 0 ? 1 : 0.72;
      const g = 0.16 * accent * leadScale;
      const f = midiFreq(M_TONE(chord, idx) + 12); // arp lives an octave above the chord
      this.lead(ts, M_STEP * 1.9, f, g);
      if (doublePass && s % 2 === 0) this.lead(ts, M_STEP * 1.4, f * 2, g * 0.28);
    }

    if (withBass) {
      this.bass(t, 2 * M_BEAT, midiFreq(chord.root - 12), 0.2);
      this.bass(t + 2 * M_BEAT, 2 * M_BEAT, midiFreq(chord.fifth - 12), 0.16);
    }
    if (withHats) {
      for (let b = 0; b < 4; b++) this.hat(t + b * M_BEAT + M_BEAT / 2, 0.045);
    }

    // The pad plays from the sparse section onward, only quieter there: a bed that
    // arrives in section 1 is a build, not a bed. One voicing per *chord* rather
    // than per bar — the chord turns every two bars, and re-attacking a sustained
    // voice on the bar line inside it is audible as a swell that shouldn't be there.
    if (this.padOn && bar % 2 === 0) {
      const pg = 0.075 * (section === 0 ? 0.7 : 1);
      this.pad(t, 2 * M_BAR, midiFreq(chord.root), pg);
      this.pad(t, 2 * M_BAR, midiFreq(chord.fifth), pg * 0.6);
    }
    // Beats 1 and 3, weaker on 3, and never in the sparse section — the pulse is
    // what turns the bed from ambient into a pace, so it wants somewhere to enter.
    if (this.pulseOn && section >= 1) {
      this.pulse(t, 0.13);
      this.pulse(t + 2 * M_BEAT, 0.1);
    }
  }

  // lookahead scheduler: keep ~0.7s of bars queued ahead of the clock
  private tick = (): void => {
    const ctx = this.ctx;
    if (!ctx) return;
    while (this.nextBarTime < ctx.currentTime + 0.7) {
      this.scheduleBar(this.bar, this.nextBarTime);
      this.bar++;
      this.nextBarTime += M_BAR;
    }
  };

  private startPlayback(): void {
    const ctx = this.ensure();
    if (!ctx || !this.master || this.playing) return;
    this.playing = true;
    this.bar = 0; // each session begins sparse and builds up
    this.nextBarTime = ctx.currentTime + 0.15;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(this.vol, ctx.currentTime + 0.8); // ease in
    this.tick();
    this.timer = setInterval(this.tick, 250);
  }

  private stopPlayback(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const ctx = this.ctx;
    if (ctx && this.master) {
      // fade out; already-scheduled notes ring under the falling master and die
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, ctx.currentTime);
      this.master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    }
  }

  private sync(): void {
    const want = this.enabled && this.scenePlaying;
    if (want) this.startPlayback();
    else this.stopPlayback();
  }

  // user preference (options toggle). Persisted by the caller.
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sync();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  // The bed's level is the most argued-about number in any soundtrack, so it stays
  // settable at runtime rather than requiring a rebuild to compare two candidates.
  // Ramped rather than jumped: a step on a live master is an audible click.
  setVolume(v: number): void {
    this.vol = Math.max(0, Math.min(0.5, v));
    const ctx = this.ctx;
    if (ctx && this.master && this.playing) {
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setValueAtTime(this.master.gain.value, ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(this.vol, ctx.currentTime + 0.2);
    }
  }

  get volume(): number {
    return this.vol;
  }

  // scene control: true while a live level is on screen and the tab is visible.
  setPlaying(on: boolean): void {
    this.scenePlaying = on;
    this.sync();
  }
}

export const music = new MusicEngine();
