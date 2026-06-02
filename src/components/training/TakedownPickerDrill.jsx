// src/components/training/TakedownPickerDrill.jsx
//
// 5-prompt "read the setup, pick the takedown" drill. For each prompt we
// show a setup tag (e.g. "opponent over-extends their lead arm"), hand the
// player 4 options (one correct, three plausible distractors from the
// neutral_attack pool), and mark the pick immediately. Score = hits / 5.
//
// This is intentionally config-only (no engine edits per the v2.0 constraints):
// the SETUPS list below is the entire ruleset. Correct pairings reflect
// canonical wrestling cues - double leg vs. over-extension, shot defense
// vs. deep level change, etc. - without touching wrestlingCards.js or
// wrestlingEngine.js.

import React, { useState, useEffect } from 'react';
import NavBar from '../ui/NavBar';
import { haptic } from '../../lib/haptics';
import { CARDS } from '../../lib/wrestlingCards';
import { BEST_KEYS } from './TrainingHub.jsx';

const PROMPT_COUNT = 5;

// Setup → correct card-id. Every correct id must exist in CARDS; this is
// asserted at mount-time in a dev check below.
const SETUPS = [
  { id: 'over_extend', prompt: 'Opponent over-extends their lead arm past center.', correct: 'double_leg' },
  { id: 'wrist_control', prompt: 'You own inside wrist control on both sides.',     correct: 'snap_down' },
  { id: 'high_tie',      prompt: 'Opponent posts high on your head from a tie-up.', correct: 'ankle_pick' },
  { id: 'hips_back',     prompt: 'Opponent drops hips back, weight on their heels.', correct: 'high_crotch' },
  { id: 'collar_tie',    prompt: 'Opponent has heavy collar tie, head down.',       correct: 'snap_down' },
  { id: 'square_stance', prompt: 'Opponent stands square, weight centered.',        correct: 'single_leg' },
  { id: 'long_reach',    prompt: 'Opponent reaches long for a wrist tie.',          correct: 'duck_under' },
  { id: 'overhook',      prompt: 'You just hit a solid overhook with shoulder pressure.', correct: 'duck_under' },
];

// Plausible distractor pool - neutral attacks only. We filter to cards
// that actually exist in CARDS at runtime so a future wrestlingCards.js
// change doesn't surface a ghost option.
const DISTRACTORS = [
  'double_leg', 'single_leg', 'high_crotch', 'snap_down',
  'ankle_pick', 'duck_under', 'fireman_carry', 'arm_drag',
  'head_inside_single', 'low_single',
];

function pickN(arr, n, exclude = []) {
  const pool = arr.filter(x => !exclude.includes(x));
  const out = [];
  while (out.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

function buildRound(setup) {
  const correctCard = CARDS[setup.correct];
  if (!correctCard) return null; // defensive - skip rounds whose correct answer isn't in CARDS
  const distractors = pickN(
    DISTRACTORS.filter(id => CARDS[id]),
    3,
    [setup.correct],
  ).map(id => CARDS[id]);
  const options = [correctCard, ...distractors].sort(() => Math.random() - 0.5);
  return { setup, options, correctId: setup.correct };
}

function buildPrompts() {
  // Pick 5 unique setups whose correct card exists
  const validSetups = SETUPS.filter(s => CARDS[s.correct]);
  const shuffled = [...validSetups].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, PROMPT_COUNT).map(buildRound).filter(Boolean);
}

export default function TakedownPickerDrill({ onBack }) {
  const [prompts, setPrompts] = useState(() => buildPrompts());
  const [idx, setIdx] = useState(0);
  const [picks, setPicks] = useState([]); // array of { correct: bool, chosenId }
  const [revealed, setRevealed] = useState(null); // { correct, chosenId }

  const current = prompts[idx];
  const done = idx >= prompts.length;

  useEffect(() => {
    if (done) {
      const hits = picks.filter(p => p.correct).length;
      try {
        const prev = JSON.parse(localStorage.getItem(BEST_KEYS.takedown) || 'null');
        if (prev == null || hits > prev) {
          localStorage.setItem(BEST_KEYS.takedown, JSON.stringify(hits));
        }
      } catch { /* silent */ }
    }
  }, [done, picks]);

  const onPick = (card) => {
    if (revealed || !current) return;
    const correct = card.id === current.correctId;
    try {
      if (correct) haptic.success(); else haptic.warning();
    } catch { /* silent */ }
    setRevealed({ correct, chosenId: card.id });
  };

  const onNext = () => {
    if (!revealed) return;
    setPicks(prev => [...prev, revealed]);
    setRevealed(null);
    setIdx(i => i + 1);
  };

  const onRestart = () => {
    setPrompts(buildPrompts());
    setIdx(0);
    setPicks([]);
    setRevealed(null);
  };

  if (done) {
    const hits = picks.filter(p => p.correct).length;
    return (
      <div className="min-h-full bg-zinc-950 text-white flex flex-col">
        <NavBar title="Takedown Picker" onBack={onBack} />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 space-y-4">
          <div className="text-6xl">{hits >= 4 ? '🏆' : hits >= 3 ? '🎯' : '💪'}</div>
          <div className="text-4xl font-black text-yellow-400">{hits} / {PROMPT_COUNT}</div>
          <div className="text-zinc-400 text-sm">
            {hits === PROMPT_COUNT ? 'Perfect read. Tournament-ready.' :
             hits >= 4 ? 'Great read - you\'re seeing the setups.' :
             hits >= 3 ? 'Solid. Work on reading the second cue.' :
                         'Keep drilling. Every rep sharpens the eye.'}
          </div>
          <div className="flex gap-2 w-full max-w-xs">
            <button
              onClick={onRestart}
              className="flex-1 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black font-black py-3 rounded-xl"
            >
              ▶ Run again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="min-h-full bg-zinc-950 text-white flex items-center justify-center">
        <div className="text-zinc-500 text-sm">No drills available.</div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Takedown Picker" onBack={onBack} />

      <div className="flex-1 flex flex-col px-4 py-4 max-w-md md:max-w-2xl mx-auto w-full">
        <div className="flex items-center justify-between mb-3">
          <div className="text-zinc-500 text-xs font-bold">
            PROMPT {idx + 1} / {PROMPT_COUNT}
          </div>
          <div className="text-zinc-400 text-xs font-mono">
            {picks.filter(p => p.correct).length} hits
          </div>
        </div>

        {/* Setup prompt */}
        <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-2xl p-4 mb-4">
          <div className="text-yellow-400 text-xs font-black uppercase tracking-wider mb-1">
            Read the setup
          </div>
          <p className="text-zinc-200 text-base font-semibold leading-snug">
            {current.setup.prompt}
          </p>
        </div>

        {/* Options grid */}
        <div className="grid grid-cols-2 gap-2">
          {current.options.map(card => {
            const isChosen = revealed && revealed.chosenId === card.id;
            const isCorrectReveal = revealed && card.id === current.correctId;
            const showRed = isChosen && !revealed.correct;
            const showGreen = isCorrectReveal;
            return (
              <button
                key={card.id}
                onClick={() => onPick(card)}
                disabled={!!revealed}
                className={
                  `text-left rounded-xl border p-3 transition-all active:scale-[0.98] ` +
                  (showGreen ? 'bg-emerald-900/40 border-emerald-500 ' :
                   showRed   ? 'bg-red-900/40 border-red-500 ' :
                               'bg-zinc-900 border-zinc-700 hover:bg-zinc-800 ')
                }
              >
                <div className="text-white font-black text-sm leading-tight">
                  {card.name}
                </div>
                <div className="text-zinc-500 text-[10px] uppercase mt-1 tracking-wider">
                  {card.category?.split('_')[0] || 'move'}
                </div>
              </button>
            );
          })}
        </div>

        {/* Feedback + advance */}
        {revealed && (
          <div className="mt-4 space-y-2">
            <div className={`rounded-xl border p-3 text-center ${
              revealed.correct
                ? 'bg-emerald-950/30 border-emerald-700/50 text-emerald-300'
                : 'bg-red-950/30 border-red-700/50 text-red-300'
            }`}>
              <div className="font-black text-sm">
                {revealed.correct ? '✓ Nice read' : '✗ Not this time'}
              </div>
              <div className="text-zinc-400 text-xs mt-1">
                Canonical answer: <span className="text-white font-bold">{CARDS[current.correctId]?.name}</span>
              </div>
            </div>
            <button
              onClick={onNext}
              className="w-full bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black font-black py-3 rounded-xl"
            >
              {idx + 1 >= PROMPT_COUNT ? 'See results' : 'Next prompt →'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
