// Seeded pseudo-randomness, shared by the level generator and the sim.
//
// Two users, two reasons: the generator needs the same seed to redraw the same
// map (that is what a daily challenge *is*), and the sim needs it so a run that
// plays itself to a win is reproducible — an unseeded `Math.random()` inside the
// tick makes every headless suite a sample rather than a proof (card #65).
//
// Keep both functions pure and allocation-free: they run in the tick.

// String → 32-bit seed. Lets callers seed from anything readable
// ('daily-2026-07-24', a level id) instead of hunting for a magic number.
export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

// Small fast 32-bit generator: returns floats in [0, 1) like Math.random().
export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The one-liner both callers actually want: a seeded Math.random() stand-in.
export function seededRandom(seed: string): () => number {
  return mulberry32(xmur3(seed)());
}
