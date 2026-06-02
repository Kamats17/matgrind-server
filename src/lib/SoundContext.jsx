import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import { createSoundEngine } from './soundEngine.js';

const SoundContext = createContext(null);

export function SoundProvider({ children }) {
  const engineRef = useRef(null);
  const [muted, setMuted] = useState(() => localStorage.getItem('pinned_sound_muted') === 'true');
  const [volume, setVolumeState] = useState(() => parseFloat(localStorage.getItem('pinned_sound_volume') ?? '0.5'));

  function getEngine() {
    if (!engineRef.current) {
      engineRef.current = createSoundEngine();
    }
    return engineRef.current;
  }

  const play = useCallback((name) => {
    getEngine().play(name);
  }, []);

  const toggleMute = useCallback(() => {
    const nowMuted = getEngine().toggleMute();
    setMuted(nowMuted);
    return nowMuted;
  }, []);

  const setVolume = useCallback((v) => {
    getEngine().setVolume(v);
    setVolumeState(v);
  }, []);

  return (
    <SoundContext.Provider value={{ play, toggleMute, isMuted: muted, volume, setVolume }}>
      {children}
    </SoundContext.Provider>
  );
}

export function useSoundContext() {
  const ctx = useContext(SoundContext);
  if (!ctx) {
    // Fallback for components rendered outside provider (shouldn't happen, but safe)
    return { play: () => {}, toggleMute: () => false, isMuted: true, volume: 0.5, setVolume: () => {} };
  }
  return ctx;
}
