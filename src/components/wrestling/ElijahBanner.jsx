import React from 'react';
import { PARTNERSHIP_ACTIVE } from '../../lib/career/elijahJoles.js';

// Home-screen banner promoting the Elijah Joles Boss Challenge.
//
// Renders the supplied partnership artwork (640x122) as an <img> at its
// native 640/122 ratio so it never stretches or crops. The whole banner
// is a single <button> that launches the vs-AI boss match.
//
// PARTNERSHIP_ACTIVE flag retires the banner cleanly at end of 2026 by
// returning null.
export default function ElijahBanner({ onChallenge }) {
  if (!PARTNERSHIP_ACTIVE) return null;

  return (
    <button
      type="button"
      onClick={onChallenge}
      aria-label="Beat the Boss - Wrestle Elijah Joles"
      className="group block w-full mb-4 overflow-hidden rounded-xl hover:brightness-110 active:scale-[0.98] transition-all"
    >
      <img
        src="/elijah/beat-the-boss-banner.png"
        alt=""
        className="block w-full h-auto"
        style={{ aspectRatio: '640 / 122' }}
      />
    </button>
  );
}
