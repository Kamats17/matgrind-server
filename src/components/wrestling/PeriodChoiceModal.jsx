// src/components/wrestling/PeriodChoiceModal.jsx
//
// Period-break "choose your starting position" prompt. Forced choice - the
// match engine waits on the user's pick, so dismissal is disabled (no drag,
// no backdrop tap). Visually an iOS bottom sheet via <BottomSheet>.
//
// Caller (WrestlingGame.jsx) owns the show-flag and calls onChoice when the
// user makes their pick. The sheet itself does not manage dismissal.

import React from 'react';
import { useColorblind, p1TextClass, p2TextClass } from '../../lib/ColorblindContext';
import BottomSheet from '../ui/BottomSheet';

const ALL_CHOICES = [
  { id: 'top', label: 'Top', sub: 'Start riding', icon: '▲', color: 'border-yellow-600 bg-yellow-500/10 hover:bg-yellow-500/20 active:scale-[0.98] text-yellow-300' },
  { id: 'bottom', label: 'Bottom', sub: 'Start escaping', icon: '▼', color: 'border-zinc-600 bg-zinc-800/60 hover:bg-zinc-700/60 active:scale-[0.98] text-zinc-300' },
  { id: 'neutral', label: 'Neutral', sub: 'Start standing', icon: '◆', color: 'border-zinc-700 bg-zinc-900/60 hover:bg-zinc-800/60 active:scale-[0.98] text-zinc-400' },
  { id: 'defer', label: 'Defer', sub: 'Opponent chooses', icon: '↩', color: 'border-zinc-800 bg-zinc-950/60 hover:bg-zinc-900/60 active:scale-[0.98] text-zinc-500' },
];

export default function PeriodChoiceModal({ state, onChoice, gameMode, humanPlayer = 'p1' }) {
  const { period, p1, p2, pendingChoiceFor } = state;

  // Defer is only valid in period 2 for the initial choice-holder (p1).
  // Once deferred to p2, p2 must actually choose. Period 3: no defer at all.
  const deferAllowed = period === 2 && pendingChoiceFor === 'p1';
  const CHOICES = deferAllowed ? ALL_CHOICES : ALL_CHOICES.filter(c => c.id !== 'defer');
  const { colorblind } = useColorblind();
  const chooser = pendingChoiceFor;
  const chooserData = state[chooser];
  const isP1 = chooser === 'p1';
  const aiSide = humanPlayer === 'p1' ? 'p2' : 'p1';
  const isWaitingForAI = gameMode === 'vs_ai' && chooser === aiSide;

  return (
    <BottomSheet
      open
      dismissible={false}
      onClose={() => { /* forced choice - no dismiss path */ }}
      title={`Period ${period} Start`}
    >
      {/* Chooser name */}
      <div className="text-center mb-4">
        <div className={`text-xl font-black ${isP1 ? p1TextClass(colorblind) : p2TextClass(colorblind)}`}>
          {chooserData?.name}
        </div>
        <div className="text-zinc-400 text-sm mt-0.5">Choose your starting position</div>
      </div>

      {/* Score context */}
      <div className="grid grid-cols-3 items-center text-center bg-zinc-950 border border-zinc-800 rounded-xl p-3 mb-5">
        <div>
          <div className={`${p1TextClass(colorblind)} text-xs font-bold`}>{p1.name}</div>
          <div className="text-white text-2xl font-black">{p1.score}</div>
        </div>
        <div className="text-zinc-700 text-lg font-black">-</div>
        <div>
          <div className={`${p2TextClass(colorblind)} text-xs font-bold`}>{p2.name}</div>
          <div className="text-white text-2xl font-black">{p2.score}</div>
        </div>
      </div>

      {/* Choices */}
      {isWaitingForAI ? (
        <div className="text-center py-6 text-zinc-500 text-sm font-semibold">
          CPU is choosing...
        </div>
      ) : (
        <div className="space-y-2">
          {CHOICES.map(c => (
            <button
              key={c.id}
              onClick={() => onChoice(chooser, c.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${c.color}`}
            >
              <span className="text-xl font-black w-6 text-center">{c.icon}</span>
              <div className="text-left">
                <div className="font-black text-sm">{c.label}</div>
                <div className="text-xs opacity-70">{c.sub}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
