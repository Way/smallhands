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
