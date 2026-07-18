// Tiny WebAudio synth — all sound effects generated at runtime, no assets.

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

  private noise(dur: number, vol = 0.5, delay = 0): void {
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
    filt.frequency.value = 1400;
    src.connect(filt).connect(gain).connect(this.master);
    src.start(t0);
  }

  click(): void {
    this.tone(660, 0.05, 'square', 0.5);
  }

  place(): void {
    this.tone(392, 0.07, 'square', 0.6);
    this.tone(523, 0.09, 'square', 0.5, 0, 0.05);
  }

  invalid(): void {
    this.tone(180, 0.12, 'sawtooth', 0.5, -60);
  }

  chop(): void {
    this.noise(0.08, 0.8);
    this.tone(160, 0.05, 'triangle', 0.5, -40);
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

  private readonly VOL = 0.13; // gentle: well under the SFX master (0.35)

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
    this.master.gain.exponentialRampToValueAtTime(this.VOL, ctx.currentTime + 0.8); // ease in
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

  // scene control: true while a live level is on screen and the tab is visible.
  setPlaying(on: boolean): void {
    this.scenePlaying = on;
    this.sync();
  }
}

export const music = new MusicEngine();
