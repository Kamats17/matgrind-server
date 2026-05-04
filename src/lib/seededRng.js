// Deterministic PRNG for online-multiplayer synchronization.
//
// Both clients run the match engine locally. Without a shared RNG, every
// `Math.random()` call diverges between phones - pin success rolls are binary,
// so one client sees "pinned" while the other sees "defender survived", and
// the room desyncs. The server issues a 32-bit seed for each resolution event
// (round_picks, pin_picks) and both clients rebuild an identical PRNG from
// that seed and thread it through the engine.
//
// Algorithm: mulberry32. Tiny, deterministic across JS runtimes, sufficient
// quality for game-RNG use.

export function makeRng(seed) {
  let a = (seed | 0) >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Server uses this to pick a fresh seed per resolution event. Engine code
// receives its RNG from the server and must NOT call this.
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296);
}
