// Deterministic 30-second chiptune backing track for the teaser, synthesized
// straight to public/music.wav (44.1 kHz stereo 16-bit PCM). No dependencies —
// same spirit as the game's procedural WebAudio, but rendered offline so
// Remotion can mix it into the MP4.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const BPM = 112;
const BEAT = 60 / BPM; // 0.5357s -> 56 beats = 30s
const BARS = 14;
const DUR = BARS * 4 * BEAT;
const N = Math.round(DUR * SR);
const L = new Float32Array(N);
const R = new Float32Array(N);

// -- tiny deterministic PRNG (mulberry32) ------------------------------------
let seed = 1337;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// -- note helpers -------------------------------------------------------------
const HZ = (midi) => 440 * 2 ** ((midi - 69) / 12);
// C major pentatonic around C5
const PENTA = [72, 74, 76, 79, 81, 84];
// chord roots per bar: C G Am F ×3, then C G
const PROG = [0, 7, 9, 5, 0, 7, 9, 5, 0, 7, 9, 5, 0, 7].map((s) => 48 + s); // C3-based
const CHORD_TONES = { 48: [72, 76, 79], 55: [74, 79, 83], 57: [72, 76, 81], 53: [72, 77, 81] };

function osc(kind, f, t) {
  const ph = (f * t) % 1;
  if (kind === 'tri') return 4 * Math.abs(ph - 0.5) - 1;
  if (kind === 'sq25') return ph < 0.25 ? 1 : -1; // thin NES-style pulse
  if (kind === 'sq50') return ph < 0.5 ? 1 : -1;
  return Math.sin(2 * Math.PI * ph);
}

// Add one voiced note: start/dur in seconds, envelope = quick attack, exp decay.
function note(kind, midi, start, dur, vol, pan = 0, vib = 0) {
  const s0 = Math.max(0, Math.round(start * SR));
  const s1 = Math.min(N, Math.round((start + dur) * SR));
  const f = HZ(midi);
  const gl = vol * (1 - pan) * 0.5 + vol * 0.5;
  const gr = vol * (1 + pan) * 0.5 + vol * 0.5;
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const env = Math.min(1, t / 0.012) * Math.exp(-t / (dur * 0.55));
    const fm = vib ? f * (1 + vib * Math.sin(2 * Math.PI * 5.2 * t)) : f;
    const v = osc(kind, fm, t) * env;
    L[i] += v * gl * 0.5;
    R[i] += v * gr * 0.5;
  }
}

function kick(start) {
  const s0 = Math.round(start * SR);
  const s1 = Math.min(N, s0 + Math.round(0.09 * SR));
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const f = 140 * Math.exp(-t * 26) + 45;
    const v = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 22) * 0.5;
    L[i] += v;
    R[i] += v;
  }
}

function hat(start, vol) {
  const s0 = Math.round(start * SR);
  const s1 = Math.min(N, s0 + Math.round(0.03 * SR));
  let hp = 0;
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR;
    const n = rand() * 2 - 1;
    hp = 0.7 * hp + n - 0.7 * n; // crude high-pass flavour
    const v = (n - hp * 0.5) * Math.exp(-t * 90) * vol;
    L[i] += v * 0.8;
    R[i] += v * 1.2;
  }
}

// -- arrangement ---------------------------------------------------------------
// Bass: root on 1 & 3, fifth on 4 (triangle, one octave down feel)
for (let bar = 0; bar < BARS; bar++) {
  const root = PROG[bar];
  const t0 = bar * 4 * BEAT;
  note('tri', root, t0, BEAT * 0.9, 0.34);
  note('tri', root, t0 + 2 * BEAT, BEAT * 0.9, 0.3);
  note('tri', root + 7, t0 + 3 * BEAT, BEAT * 0.8, 0.24);
}

// Melody: a 2-bar seeded motif, repeated with light variation; rests breathe.
const motif = [];
for (let step = 0; step < 16; step++) {
  const play = step % 4 === 0 ? true : rand() < 0.62;
  motif.push(play ? PENTA[Math.floor(rand() * PENTA.length)] : null);
}
for (let bar = 2; bar < BARS; bar += 2) {
  const t0 = bar * 4 * BEAT;
  const chord = CHORD_TONES[PROG[bar]] ?? [72, 76, 79];
  for (let step = 0; step < 16; step++) {
    let m = motif[step];
    if (m === null) continue;
    // pull the motif toward the current chord + occasional sparkle an octave up
    if (step % 8 === 0) m = chord[Math.floor(rand() * chord.length)];
    if (rand() < 0.08) m += 12;
    const start = t0 + step * (BEAT / 2);
    const len = (BEAT / 2) * (rand() < 0.25 ? 1.7 : 0.92);
    note('sq25', m, start, len, 0.16, step % 2 ? 0.25 : -0.25, 0.004);
  }
}

// A soft supporting chord pad (square, very quiet, arpeggiated slow)
for (let bar = 0; bar < BARS; bar++) {
  const chord = CHORD_TONES[PROG[bar]] ?? [72, 76, 79];
  const t0 = bar * 4 * BEAT;
  chord.forEach((m, k) => note('sq50', m - 12, t0 + k * BEAT, BEAT * 1.6, 0.05, k % 2 ? 0.4 : -0.4));
}

// Percussion: kick on 1 & 3, hats on the off-beats (skip the first two bars)
for (let beat = 0; beat < BARS * 4; beat++) {
  const t0 = beat * BEAT;
  if (beat >= 8 && beat % 2 === 0) kick(t0);
  if (beat >= 8) hat(t0 + BEAT / 2, 0.09);
}

// -- dotted-eighth echo + master fade + soft clip -------------------------------
const delay = Math.round(BEAT * 0.75 * SR);
for (let i = delay; i < N; i++) {
  L[i] += L[i - delay] * 0.3;
  R[i] += R[i - delay] * 0.3;
}
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.6) * Math.min(1, Math.max(0, (DUR - t) / 2.5));
  L[i] = Math.tanh(L[i] * 1.4) * fade;
  R[i] = Math.tanh(R[i] * 1.4) * fade;
}

// -- write WAV -------------------------------------------------------------------
const pcm = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), i * 4);
  pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(2, 22); // stereo
header.writeUInt32LE(SR, 24);
header.writeUInt32LE(SR * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const out = join(dirname(fileURLToPath(import.meta.url)), 'public', 'music.wav');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, Buffer.concat([header, pcm]));
console.log(`wrote ${out} (${DUR.toFixed(1)}s, ${((44 + pcm.length) / 1e6).toFixed(1)} MB)`);
