// src/components/modes/TournamentSetupScreen.jsx
//
// Tournament entry flow under the Modes tab. Restores the pre-1.2.5
// MainMenu tournament-config modal as a dedicated full screen so the
// user can pick wrestling style and bracket size (and, when signed
// out, a guest name) before the engine call.
//
// Format is fixed: every standalone tournament is double-elimination.
// The engine id for that path is 'consolation' (see tournamentState.js
// "both are double elim in wrestling"); handleContinue passes it as a
// literal. Bracket size still defaults to 8 to match the old modal.
//
// Guest-name plumbing: a signed-in user must NEVER trigger the
// `guestName || 'Guest'` branch inside startTournament. So:
//   - signed-in: guest input is not rendered; onConfirm is called with
//     `null` for guestName.
//   - guest:    guest input is required; Continue stays disabled until
//     a non-empty trimmed value exists; onConfirm receives the trimmed
//     value (never an empty string).
//
// Lifted via React.lazy from WrestlingGame.jsx like ModesScreen.

import React, { useState } from 'react';
import NavBar from '../ui/NavBar';
import { WRESTLING_STYLES, resolveStyle } from '../../lib/namePools.js';

const BRACKET_SIZES = /** @type {const} */ ([8, 16, 24, 32, 64, 128]);

export default function TournamentSetupScreen({
  onBack,
  onConfirm,
  wrestlerProfile,
  isAuthenticated,
}) {
  const [bracketSize, setBracketSize] = useState(8);
  // Wrestling style. Initialized from the Main Menu's stored default; the
  // pick here is the explicit event style and decides the opponent name
  // pool (Women's Freestyle -> women's names).
  const [style, setStyle] = useState(
    () => resolveStyle({
      storedDefault: typeof localStorage !== 'undefined' && localStorage.getItem('matgrind_default_style'),
    }),
  );
  const [guestName, setGuestName] = useState('');

  // Treat absence of either flag as "guest" so a logged-out user without a
  // profile still gets the name prompt instead of a silent "Guest" entry.
  const needsGuestName = !isAuthenticated || !wrestlerProfile;
  const trimmedGuest = guestName.trim();
  const canContinue = !needsGuestName || trimmedGuest.length > 0;

  const handleContinue = () => {
    if (!canContinue) return;
    // INVARIANT: never pass an empty string. Signed-in players get null.
    const guestArg = needsGuestName ? trimmedGuest : null;
    // Format is fixed double-elimination; 'consolation' is its engine id.
    onConfirm(bracketSize, 'consolation', guestArg, style);
  };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Tournament Setup" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md md:max-w-2xl mx-auto w-full space-y-5">
        <section>
          <h3 className="text-zinc-500 text-xs font-black uppercase tracking-wider mb-2 px-1">
            Style
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {WRESTLING_STYLES.map(s => {
              const active = style === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setStyle(s.id)}
                  aria-pressed={active}
                  className={`py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                    active
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h3 className="text-zinc-500 text-xs font-black uppercase tracking-wider mb-2 px-1">
            Bracket Size
          </h3>
          <div className="grid grid-cols-3 gap-2">
            {BRACKET_SIZES.map(size => {
              const active = bracketSize === size;
              return (
                <button
                  key={size}
                  onClick={() => setBracketSize(size)}
                  aria-pressed={active}
                  className={`py-3 rounded-xl text-sm font-black transition-all ${
                    active
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </section>

        {needsGuestName && (
          <section>
            <h3 className="text-zinc-500 text-xs font-black uppercase tracking-wider mb-2 px-1">
              Guest Wrestler Name
            </h3>
            <input
              type="text"
              value={guestName}
              onChange={e => setGuestName(e.target.value)}
              placeholder="Enter wrestler name"
              maxLength={20}
              className="w-full bg-zinc-900 border border-zinc-800 text-white rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-purple-600 transition-colors"
            />
            <p className="text-zinc-600 text-[10px] mt-2 px-1">
              Guests use balanced stats (60 across all attributes). Create an
              account to use your custom build.
            </p>
          </section>
        )}

        <div className="pt-2">
          <button
            onClick={handleContinue}
            disabled={!canContinue}
            className={`w-full py-3 rounded-xl text-sm font-black uppercase tracking-wider transition-all ${
              canContinue
                ? 'bg-purple-600 text-white hover:bg-purple-500 active:scale-[0.98]'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
