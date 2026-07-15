// Teaser soundtrack: a small, deterministic chiptune composed in code — soft
// square/triangle arpeggios over a C–Am–F–G loop with a sine bass, offbeat
// noise hats and a ping-pong delay, in the same hand-synthesized spirit as the
// game's WebAudio engine (src/engine/audio.ts). Renders straight to a 16-bit
// stereo WAV buffer; no dependencies, same output every run.
const SR = 44100;
const BPM = 112;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // sixteenth note

// mulberry32 — seeded noise so every render is identical
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

// chord tones as midi offsets from C4=60: C, Am, F, G — two bars each
const PROG = [
  { root: 60, third: 64, fifth: 67 }, // C
  { root: 57, third: 60, fifth: 64 }, // Am
  { root: 53, third: 57, fifth: 60 }, // F
  { root: 55, third: 59, fifth: 62 }, // G
];
// sixteenth-step arp: indices into [root, third, fifth, octave], -1 = rest
const ARP = [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 5, 1, 2, 3, 2];
const TONE = (c, idx) => [c.root, c.third, c.fifth, c.root + 12, c.third + 12, c.fifth + 12][idx];

// one lead voice sample: square/triangle blend, gently saturated
function leadSample(phase) {
  const x = phase % 1;
  const sq = x < 0.5 ? 1 : -1;
  const tri = 4 * Math.abs(x - 0.5) - 1;
  return Math.tanh(1.6 * (0.5 * sq + 0.5 * tri)) * 0.62;
}

function addLead(buf, ch, t0, dur, f, gain) {
  const n0 = Math.floor(t0 * SR);
  const n1 = Math.min(buf.length, Math.floor((t0 + dur) * SR));
  let phase = 0;
  const dp = f / SR;
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const a = Math.min(1, t / 0.004) * Math.exp(-t * 5.5); // pluck: fast attack, ~180ms tail
    buf[n] += leadSample(phase) * a * gain;
    phase += dp;
    void ch;
  }
}

function addBass(buf, t0, dur, f, gain) {
  const n0 = Math.floor(t0 * SR);
  const n1 = Math.min(buf.length, Math.floor((t0 + dur) * SR));
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const rel = Math.min(1, Math.max(0, (dur - t) / 0.08));
    const a = Math.min(1, t / 0.012) * rel * (0.55 + 0.45 * Math.exp(-t * 2.5));
    const ph = 2 * Math.PI * f * t;
    buf[n] += (Math.sin(ph) + 0.35 * Math.sin(2 * ph)) * a * gain;
  }
}

function addHat(buf, t0, rnd, gain) {
  const n0 = Math.floor(t0 * SR);
  const n1 = Math.min(buf.length, n0 + Math.floor(0.035 * SR));
  let prev = 0;
  for (let n = n0; n < n1; n++) {
    const t = (n - n0) / SR;
    const w = rnd() * 2 - 1;
    buf[n] += (w - prev) * Math.exp(-t * 90) * gain; // first difference ≈ highpass
    prev = w;
  }
}

export function renderMusicWav(seconds) {
  const len = Math.ceil(seconds * SR);
  const leadL = new Float64Array(len);
  const leadR = new Float64Array(len);
  const bed = new Float64Array(len); // bass + hats, kept out of the delay
  const rnd = rng(20260715);

  const BAR = 4 * BEAT;
  const tail = 3.2; // reserved for the closing chord + fadeout
  const loopEnd = seconds - tail;

  let bar = 0;
  for (let t = 0.0; t + BAR <= loopEnd; t += BAR, bar++) {
    const chord = PROG[Math.floor(bar / 2) % PROG.length];
    const pass = Math.floor((bar / 2) / PROG.length); // 0: first pass, 1+: fuller
    const withBass = bar >= 2;
    const withHats = bar >= 4;

    // lead arp, sixteenths with a light beat accent; second pass doubles +1 octave
    for (let s = 0; s < 16; s++) {
      const idx = ARP[s];
      if (idx < 0) continue;
      const ts = t + s * STEP;
      const accent = s % 4 === 0 ? 1 : 0.72;
      const g = 0.16 * accent * (bar === 0 ? 0.8 : 1);
      const f = freq(TONE(chord, idx) + 12); // arp lives an octave above the chord
      // slight stereo detune widens the lead without a chorus effect
      addLead(leadL, 0, ts, STEP * 1.9, f * 0.9987, g);
      addLead(leadR, 1, ts, STEP * 1.9, f * 1.0013, g);
      if (pass >= 1 && s % 2 === 0) {
        addLead(leadL, 0, ts, STEP * 1.4, f * 2 * 0.9987, g * 0.28);
        addLead(leadR, 1, ts, STEP * 1.4, f * 2 * 1.0013, g * 0.28);
      }
    }

    if (withBass) {
      // root + fifth in half notes, one octave down
      addBass(bed, t, 2 * BEAT, freq(chord.root - 12), 0.2);
      addBass(bed, t + 2 * BEAT, 2 * BEAT, freq(chord.fifth - 12), 0.16);
    }
    if (withHats) {
      for (let b = 0; b < 4; b++) addHat(bed, t + b * BEAT + BEAT / 2, rnd, 0.05);
    }
  }

  // closing chord: a held C major, letting the delay tails ring out
  const endT = Math.max(0, loopEnd);
  for (const [m, g] of [[48, 0.16], [60, 0.12], [64, 0.1], [67, 0.1], [72, 0.08]]) {
    addBass(bed, endT, tail - 0.4, freq(m), g);
  }

  // ping-pong delay on the lead bus (dotted-eighth), then mix with the bed
  const dSamp = Math.floor(1.5 * (BEAT / 2) * SR);
  for (let n = 0; n < len; n++) {
    if (n >= dSamp) {
      leadL[n] += leadR[n - dSamp] * 0.33;
      leadR[n] += leadL[n - dSamp] * 0.33;
    }
  }

  const out = new Float64Array(len * 2);
  for (let n = 0; n < len; n++) {
    const t = n / SR;
    let master = Math.min(1, t / 0.6); // ease in
    const fadeStart = seconds - 2.6;
    if (t > fadeStart) master *= Math.max(0, 1 - (t - fadeStart) / 2.6);
    out[n * 2] = (leadL[n] + bed[n]) * master;
    out[n * 2 + 1] = (leadR[n] + bed[n]) * master;
  }

  // normalize to a comfortable teaser level (peak ≈ -4 dBFS)
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  const scale = peak > 0 ? 0.63 / peak : 1;

  // 16-bit stereo PCM WAV
  const data = Buffer.alloc(out.length * 2);
  for (let i = 0; i < out.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, out[i] * scale)) * 32767), i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0);
  hdr.writeUInt32LE(36 + data.length, 4);
  hdr.write('WAVE', 8);
  hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20); // PCM
  hdr.writeUInt16LE(2, 22); // stereo
  hdr.writeUInt32LE(SR, 24);
  hdr.writeUInt32LE(SR * 4, 28); // byte rate
  hdr.writeUInt16LE(4, 32); // block align
  hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36);
  hdr.writeUInt32LE(data.length, 40);
  return Buffer.concat([hdr, data]);
}
