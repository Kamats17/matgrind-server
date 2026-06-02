import React, { createContext, useContext, useState, useCallback } from 'react';

const ColorblindContext = createContext(null);

const STORAGE_KEY = 'matgrind_colorblind';

export function ColorblindProvider({ children }) {
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true');

  const setEnabled = useCallback((val) => {
    setEnabledState(val);
    localStorage.setItem(STORAGE_KEY, val ? 'true' : 'false');
  }, []);

  const toggle = useCallback(() => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  return (
    <ColorblindContext.Provider value={{ colorblind: enabled, setColorblind: setEnabled, toggleColorblind: toggle }}>
      {children}
    </ColorblindContext.Provider>
  );
}

export function useColorblind() {
  const ctx = useContext(ColorblindContext);
  if (!ctx) return { colorblind: false, setColorblind: () => {}, toggleColorblind: () => {} };
  return ctx;
}

// ── UI color helpers ──
// In colorblind mode, swap green/red for blue/orange throughout UI chrome.

export function p1TextClass(colorblind) {
  return colorblind ? 'text-sky-400' : 'text-emerald-400';
}

export function p2TextClass(colorblind) {
  return colorblind ? 'text-amber-400' : 'text-red-400';
}

export function p1BorderClass(colorblind) {
  return colorblind ? 'border-sky-900/60' : 'border-emerald-900/60';
}

export function p2BorderClass(colorblind) {
  return colorblind ? 'border-amber-900/60' : 'border-red-900/60';
}

// Default corner SVG colors (when no custom appearance is set)
export const CB_P1 = { primary: '#38bdf8', dark: '#0284c7' }; // sky
export const CB_P2 = { primary: '#fbbf24', dark: '#d97706' }; // amber
