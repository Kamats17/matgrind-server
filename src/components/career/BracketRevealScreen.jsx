// Career Depth Pass v1 - BracketRevealScreen.
//
// Tournament bracket flip-reveal. Shown when the player enters a career
// tournament event, before the first bracket round begins.
//
//  - For small brackets (<=16 entries), every seed flips in sequence.
//  - For larger brackets (32/64), the seed CARDS are shown in a grid but
//    the player's seed is highlighted last with a flourish so the reveal
//    completes in <=2.5s.
//  - Always skippable via a Skip button (auto-sim path passes skip=true).
//  - Calls onContinue() when the reveal completes or is skipped.
//
// No engine touch; pure presentation over buildSeededBracket output.

import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const REVEAL_TOTAL_MS = 2200;
const PLAYER_FLIP_DELAY_MS = 1800;

export default function BracketRevealScreen({
  bracket = [],
  playerSeed = 0,
  eventName = 'Tournament',
  onContinue = () => {},
  skip = false,
}) {
  const [phase, setPhase] = useState(skip ? 'done' : 'reveal');

  useEffect(() => {
    if (skip) {
      onContinue();
      return;
    }
    const t = setTimeout(() => {
      setPhase('done');
      onContinue();
    }, REVEAL_TOTAL_MS);
    return () => clearTimeout(t);
  }, [skip, onContinue]);

  const handleSkip = useCallback(() => {
    setPhase('done');
    onContinue();
  }, [onContinue]);

  if (phase === 'done') return null;

  const size = bracket.length;
  // Stagger each NPC card by a tiny delay; player's seed flips last.
  const baseDelay = Math.min(60, Math.floor(PLAYER_FLIP_DELAY_MS / Math.max(1, size)));

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 px-4">
      <button
        onClick={handleSkip}
        className="absolute top-4 right-4 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-wider"
      >
        Skip
      </button>
      <div className="text-amber-400 text-[10px] font-black uppercase tracking-[0.28em] mb-2">
        Bracket Revealed
      </div>
      <h2 className="text-white text-xl font-black mb-6 text-center">{eventName}</h2>
      <div className={`grid gap-2 max-w-md w-full ${size > 16 ? 'grid-cols-4' : 'grid-cols-2'}`}>
        <AnimatePresence>
          {bracket.map((entry, i) => {
            const isPlayer = i === playerSeed || entry?.isPlayer;
            const delay = isPlayer ? PLAYER_FLIP_DELAY_MS / 1000 : (i * baseDelay) / 1000;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.6, rotateY: 90 }}
                animate={{ opacity: 1, scale: 1, rotateY: 0 }}
                transition={{ delay, duration: 0.25 }}
                className={[
                  'rounded-lg px-2 py-2 text-center text-xs font-bold border',
                  isPlayer
                    ? 'bg-emerald-700/40 border-emerald-400 text-white shadow-lg shadow-emerald-900/30'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-300',
                ].join(' ')}
              >
                <div className="text-[9px] uppercase tracking-wide text-zinc-500">Seed {i + 1}</div>
                <div className="truncate">{entry?.name || 'TBD'}</div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
