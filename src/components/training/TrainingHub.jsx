// src/components/training/TrainingHub.jsx
//
// Training tab landing screen. Lists the three training modes and shows
// each drill's personal best (read from localStorage - no Firestore
// round-trip so offline-first is preserved).
//
// When a drill or the tutorial is active, we replace the hub with the
// active component and pass an onExit callback. The parent (WrestlingGame)
// derives hideTabBar from this subscreen state, so the full-screen drill
// experience is uninterrupted.

import React, { useState } from 'react';
import { Target, Timer, BookOpen, Library, ChevronRight } from 'lucide-react';
import NavBar from '../ui/NavBar';
import Tutorial from '../wrestling/Tutorial.jsx';
import ReactionTimerDrill from './ReactionTimerDrill.jsx';
import TakedownPickerDrill from './TakedownPickerDrill.jsx';
import MovesCountersGlossary from './MovesCountersGlossary.jsx';
import DailyGoalCard from '../wrestling/DailyGoalCard.jsx';
import { haptic } from '../../lib/haptics';
import { CURRICULA, loadProgress, totalSteps } from '../../lib/drillCurricula.js';
import { loadFeaturedDailyGoal } from '../../lib/profileUtils.js';

const BEST_KEYS = {
  reaction:        'drill:reaction:best',         // best avg ms over 5 rounds (lower = better)
  reaction_single: 'drill:reaction:best_single',  // best single-round ms (lower = better)
  takedown:        'drill:takedown:best',          // best hits out of 5 (higher = better)
};

function getBest(id) {
  try {
    const v = localStorage.getItem(BEST_KEYS[id]);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

export default function TrainingHub({ onBack, wrestlerProfile }) {
  const [active, setActive] = useState(null); // 'tutorial' | 'reaction' | 'takedown' | null

  if (active === 'tutorial') {
    return <Tutorial onBack={() => setActive(null)} />;
  }
  if (active === 'reaction') {
    return <ReactionTimerDrill onBack={() => setActive(null)} />;
  }
  if (active === 'takedown') {
    return <TakedownPickerDrill onBack={() => setActive(null)} />;
  }
  if (active === 'moves') {
    return <MovesCountersGlossary onBack={() => setActive(null)} />;
  }

  const reactionBest = getBest('reaction');
  const takedownBest = getBest('takedown');

  // Curriculum progress: sum of completed steps across all four mechanics.
  // Surfaced as a single "x/y steps" badge so the player has one clear
  // target to grind toward without cluttering the card with four counters.
  const curriculumDone = Object.keys(CURRICULA).reduce((sum, m) => sum + loadProgress(m), 0);
  const curriculumTotal = Object.keys(CURRICULA).reduce((sum, m) => sum + totalSteps(m), 0);

  const launch = (id) => {
    try { haptic.light(); } catch { /* silent */ }
    setActive(id);
  };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Training" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md md:max-w-2xl mx-auto w-full space-y-3">
        {/* Featured daily goal - same card as MainMenu, repeated here so
            training-focused players have it in view while picking a drill. */}
        <DailyGoalCard goal={loadFeaturedDailyGoal(wrestlerProfile)} />

        <p className="text-zinc-400 text-sm leading-relaxed">
          Sharpen the fundamentals. Each drill targets one thing: reading the
          setup, choosing the right counter, and reacting fast enough to make
          the play.
        </p>

        <DrillCard
          icon={BookOpen}
          title="Tutorial"
          subtitle="Learn takedowns, counters, turns, escapes, chains, and pins"
          meta={null}
          tint="yellow"
          onPress={() => launch('tutorial')}
        />

        <DrillCard
          icon={Timer}
          title="Skill Drills"
          subtitle="Practice all 4 in-match mechanics: Drive Through, Reaction, Trace, Burst. Learn each step-by-step or grind reps in Free Play."
          meta={
            reactionBest != null
              ? `Reaction best avg: ${reactionBest}ms · Curriculum ${curriculumDone}/${curriculumTotal}`
              : `Curriculum ${curriculumDone}/${curriculumTotal} steps complete`
          }
          tint="emerald"
          onPress={() => launch('reaction')}
        />

        <DrillCard
          icon={Target}
          title="Takedown Picker"
          subtitle="Read the setup, pick the best takedown. 5 prompts."
          meta={takedownBest != null ? `Best: ${takedownBest}/5 correct` : 'No best yet'}
          tint="red"
          onPress={() => launch('takedown')}
        />

        <DrillCard
          icon={Library}
          title="Moves & Counters"
          subtitle="Browse every move in the game with its counters, setups, and mini-game type."
          meta={null}
          tint="sky"
          onPress={() => launch('moves')}
        />
      </div>
    </div>
  );
}

const TINTS = {
  yellow:  { icon: 'text-yellow-400',  border: 'border-yellow-800/40',  ring: 'ring-yellow-500/20'  },
  emerald: { icon: 'text-emerald-400', border: 'border-emerald-800/40', ring: 'ring-emerald-500/20' },
  red:     { icon: 'text-red-400',     border: 'border-red-800/40',     ring: 'ring-red-500/20'     },
  sky:     { icon: 'text-sky-400',     border: 'border-sky-800/40',     ring: 'ring-sky-500/20'     },
};

function DrillCard({ icon: Icon, title, subtitle, meta, tint, onPress }) {
  const t = TINTS[tint] || TINTS.emerald;
  return (
    <button
      onClick={onPress}
      className={
        `w-full text-left bg-zinc-900 border ${t.border} rounded-2xl p-4 ` +
        `flex items-center gap-3 active:scale-[0.98] hover:bg-zinc-800/60 ` +
        `transition-all ring-1 ${t.ring}`
      }
    >
      <div className={`w-10 h-10 rounded-xl bg-zinc-950 flex items-center justify-center ${t.icon} flex-shrink-0`}>
        <Icon size={20} strokeWidth={2.2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white font-black text-base">{title}</div>
        <div className="text-zinc-400 text-xs leading-snug mt-0.5">{subtitle}</div>
        {meta && <div className="text-zinc-500 text-[11px] font-semibold mt-1">{meta}</div>}
      </div>
      <ChevronRight className="text-zinc-600 flex-shrink-0" size={18} />
    </button>
  );
}

export { BEST_KEYS };
