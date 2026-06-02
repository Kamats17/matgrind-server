/**
 * Web Audio API sound engine - oscillator-based sound effects.
 * No audio files needed. Tiny footprint, instant playback.
 */

const VOLUME_KEY = 'pinned_sound_volume';
const MUTED_KEY = 'pinned_sound_muted';

/**
 * Create a sound engine instance.
 * Call once at app level, share via context.
 */
export function createSoundEngine() {
  let ctx = null;
  let volume = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '0.5');
  let muted = localStorage.getItem(MUTED_KEY) === 'true';

  function getContext() {
    if (!ctx || ctx.state === 'closed') {
      const Ctor = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
      ctx = new Ctor();
    }
    // Resume suspended context (browser autoplay policy)
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function getGain() {
    return muted ? 0 : volume;
  }

  // ── Sound definitions ─────────────────────────────────────────────────────

  function playTone(freq, duration, waveform = 'sine', freqEnd = null, vol = 1) {
    const ac = getContext();
    const gain = ac.createGain();
    gain.gain.setValueAtTime(getGain() * vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    gain.connect(ac.destination);

    const osc = ac.createOscillator();
    osc.type = waveform;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(freqEnd, ac.currentTime + duration);
    }
    osc.connect(gain);
    osc.start(ac.currentTime);
    osc.stop(ac.currentTime + duration);
  }

  function playNoise(duration, vol = 1) {
    const ac = getContext();
    const bufferSize = ac.sampleRate * duration;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ac.createBufferSource();
    source.buffer = buffer;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(getGain() * vol * 0.3, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    gain.connect(ac.destination);
    source.connect(gain);
    source.start(ac.currentTime);
  }

  const sounds = {
    card_play() {
      playTone(800, 0.05, 'square', null, 0.3);
    },

    takedown() {
      playTone(150, 0.2, 'sawtooth', 80, 0.7);
      setTimeout(() => playNoise(0.08, 0.5), 50);
    },

    escape() {
      playTone(400, 0.15, 'sine', 600, 0.5);
    },

    reversal() {
      playTone(300, 0.2, 'sine', 700, 0.6);
    },

    near_fall() {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => playTone(600, 0.08, 'triangle', null, 0.5), i * 120);
      }
    },

    pin() {
      playTone(100, 0.3, 'sawtooth', null, 0.8);
      setTimeout(() => playTone(80, 0.4, 'sawtooth', 50, 0.6), 150);
    },

    period_buzzer() {
      playTone(440, 0.5, 'square', null, 0.4);
    },

    match_end() {
      // Ascending fanfare: C5 → E5 → G5
      playTone(523, 0.15, 'sine', null, 0.5);
      setTimeout(() => playTone(659, 0.15, 'sine', null, 0.5), 150);
      setTimeout(() => playTone(784, 0.3, 'sine', null, 0.6), 300);
    },

    counter() {
      playNoise(0.1, 0.6);
      playTone(200, 0.08, 'square', 150, 0.4);
    },

    scramble() {
      playTone(500, 0.1, 'sawtooth', 300, 0.4);
      setTimeout(() => playTone(400, 0.1, 'sawtooth', 250, 0.3), 80);
    },

    setup() {
      playTone(350, 0.1, 'triangle', 450, 0.3);
    },

    stalemate() {
      playTone(220, 0.2, 'sine', null, 0.3);
    },
  };

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    play(name) {
      if (muted) return;
      const fn = sounds[name];
      if (fn) {
        try { fn(); } catch (e) { console.warn('[sound]', e); }
      }
    },

    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      localStorage.setItem(VOLUME_KEY, String(volume));
    },

    getVolume() {
      return volume;
    },

    toggleMute() {
      muted = !muted;
      localStorage.setItem(MUTED_KEY, String(muted));
      return muted;
    },

    isMuted() {
      return muted;
    },
  };
}
