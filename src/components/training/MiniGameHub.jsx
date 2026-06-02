// src/components/training/MiniGameHub.jsx
//
// Free-play practice hub for the four in-match skill mechanics.
// No round limit, no curriculum - just rep the mechanic until it feels natural.
// Each resolve bumps the rep counter and restarts the mechanic after a brief pause.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import NavBar from '../ui/NavBar';
import { haptic } from '../../lib/haptics';
import ChargeMechanic   from '../wrestling/skillMechanics/ChargeMechanic';
import ReactionMechanic from '../wrestling/skillMechanics/ReactionMechanic';
import TraceMechanic    from '../wrestling/skillMechanics/TraceMechanic';
import BurstMechanic    from '../wrestling/skillMechanics/BurstMechanic';

const GAMES = [
  {
    id:        'charge',
    name:      'Drive Through',
    emoji:     '💪',
    desc:      'Hold the bar - release when it hits the green zone.',
    usedBy:    'Takedowns & Throws',
    Component: ChargeMechanic,
    tint:      { active: 'bg-orange-500 text-zinc-950', ring: 'ring-orange-500/40', dot: 'bg-orange-400' },
  },
  {
    id:        'reaction',
    name:      'Reaction',
    emoji:     '⚡',
    desc:      'Wait for the button to turn green, then tap as fast as you can.',
    usedBy:    'Counters',
    Component: ReactionMechanic,
    tint:      { active: 'bg-emerald-500 text-zinc-950', ring: 'ring-emerald-500/40', dot: 'bg-emerald-400' },
  },
  {
    id:        'burst',
    name:      'Burst',
    emoji:     '🔥',
    desc:      'Tap the button as many times as possible in the window.',
    usedBy:    'Escapes',
    Component: BurstMechanic,
    tint:      { active: 'bg-amber-500 text-zinc-950', ring: 'ring-amber-500/40', dot: 'bg-amber-400' },
  },
  {
    id:        'trace',
    name:      'Trace',
    emoji:     '→',
    desc:      'Swipe in the shown arrow directions - start a new swipe for each arrow.',
    usedBy:    'Top Turns',
    Component: TraceMechanic,
    tint:      { active: 'bg-blue-500 text-zinc-950', ring: 'ring-blue-500/40', dot: 'bg-blue-400' },
  },
];

const TIER_COLOR = {
  PERFECT: 'bg-emerald-400',
  GOOD:    'bg-amber-400',
  MISS:    'bg-zinc-700',
};

// Endless free-play loop for a single mechanic. Remounts the mechanic on each
// new rep so all state resets cleanly.
function FreePlayLoop({ game }) {
  const [totals,    setTotals]    = useState({ PERFECT: 0, GOOD: 0, MISS: 0 });
  const [dots,      setDots]      = useState([]);
  const [iteration, setIteration] = useState(0);

  const handleResolve = (result) => {
    setTotals(prev => ({ ...prev, [result.tier]: (prev[result.tier] || 0) + 1 }));
    setDots(prev => [result.tier, ...prev].slice(0, 16));
    // Short pause so the haptic lands before the mechanic remounts.
    setTimeout(() => setIteration(i => i + 1), 650);
  };

  const total = totals.PERFECT + totals.GOOD + totals.MISS;

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      {/* Rep counter */}
      <div className="text-zinc-400 text-xs uppercase tracking-widest text-center">
        {total === 0 ? 'Get started below' : (
          <>
            {total} {total === 1 ? 'rep' : 'reps'}
            {' · '}
            <span className="text-emerald-400">{totals.PERFECT}P</span>
            {' · '}
            <span className="text-amber-400">{totals.GOOD}G</span>
            {' · '}
            <span className="text-zinc-500">{totals.MISS}M</span>
          </>
        )}
      </div>

      {/* The mechanic - key on iteration forces a clean remount each rep */}
      <game.Component key={iteration} onResolve={handleResolve} />

      {/* History dots */}
      {dots.length > 0 && (
        <div className="flex gap-1.5 flex-wrap justify-center max-w-xs">
          {dots.map((tier, i) => (
            <motion.span
              key={`${iteration}-${i}`}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className={`w-2.5 h-2.5 rounded-full ${TIER_COLOR[tier]}`}
              title={tier}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function MiniGameHub({ onBack }) {
  const [selectedId, setSelectedId] = useState('charge');
  const game = GAMES.find(g => g.id === selectedId);

  const selectGame = (id) => {
    try { haptic.light(); } catch { /* silent */ }
    setSelectedId(id);
  };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Mini Games" onBack={onBack} />

      <div className="flex-1 flex flex-col px-4 py-4 max-w-md md:max-w-2xl mx-auto w-full gap-4">

        {/* 2×2 game selector */}
        <div className="grid grid-cols-2 gap-2">
          {GAMES.map(g => {
            const active = g.id === selectedId;
            return (
              <button
                key={g.id}
                onClick={() => selectGame(g.id)}
                className={
                  `rounded-2xl p-3 text-left transition-all active:scale-[0.97] ` +
                  `ring-1 ${active ? `${g.tint.active} ${g.tint.ring} shadow-lg` : 'bg-zinc-900 text-zinc-400 ring-zinc-800 hover:bg-zinc-800/70'}`
                }
              >
                <div className="text-2xl mb-1">{g.emoji}</div>
                <div className={`font-black text-sm ${active ? '' : 'text-white'}`}>{g.name}</div>
                <div className={`text-[10px] mt-0.5 font-semibold uppercase tracking-wider ${active ? 'opacity-70' : 'text-zinc-600'}`}>
                  {g.usedBy}
                </div>
              </button>
            );
          })}
        </div>

        {/* Description of selected mechanic */}
        <motion.div
          key={selectedId}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          className="text-center text-zinc-400 text-sm leading-relaxed"
        >
          {game.desc}
        </motion.div>

        {/* Free-play loop - key on selectedId resets rep counter on switch */}
        <FreePlayLoop key={selectedId} game={game} />

      </div>
    </div>
  );
}
