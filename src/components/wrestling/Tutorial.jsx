// src/components/wrestling/Tutorial.jsx
//
// Tutorial driver. Reads TUTORIAL_STEPS as pure data and routes by `kind`
// to the matching interactive surface. Each "minigame" step renders the
// SAME mechanic component the live game uses, so the player practices the
// real UI - not a tutorial-only mock.

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, RotateCcw } from 'lucide-react';
import {
  TUTORIAL_STEPS,
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_COMPLETED_KEY,
} from '../../lib/tutorialSteps.js';
import { CARDS } from '../../lib/wrestlingCards.js';
import { getCategoryTheme } from '../../lib/cardCategoryTheme.js';
import { SKILL_TIERS } from '../../lib/cardArchetypeMechanics.js';
import NavBar from '../ui/NavBar';
import ChargeMechanic from './skillMechanics/ChargeMechanic.jsx';
import ReactionMechanic from './skillMechanics/ReactionMechanic.jsx';
import TraceMechanic from './skillMechanics/TraceMechanic.jsx';
import BurstMechanic from './skillMechanics/BurstMechanic.jsx';
import PeriodChoiceModal from './PeriodChoiceModal.jsx';

// ─── Tier display helpers ────────────────────────────────────────────────────

const TIER_STYLE = {
  PERFECT: { label: 'PERFECT',  color: 'text-emerald-400', ring: 'ring-emerald-500/30' },
  GOOD:    { label: 'GOOD',     color: 'text-yellow-400',  ring: 'ring-yellow-500/30'  },
  MISS:    { label: 'MISS',     color: 'text-zinc-400',    ring: 'ring-zinc-700/40'    },
};

// ─── Sub-renderers ───────────────────────────────────────────────────────────

function StepText({ body }) {
  return (
    <div className="space-y-3 text-zinc-300 text-sm leading-relaxed">
      {body.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  );
}

function CardAnatomy({ cardId }) {
  const card = CARDS[cardId];
  if (!card) return <div className="text-red-400 text-xs">Unknown card: {cardId}</div>;
  const theme = getCategoryTheme(card.category);
  const counterNames = (card.counters || []).map(id => CARDS[id]?.name || id).join(', ') || '-';
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="h-1.5 w-full" style={{ background: theme.color }} />
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={`text-[10px] font-black uppercase tracking-widest ${theme.textClass}`}>
              {theme.icon} {theme.label}
            </div>
            <div className="text-white text-xl font-black uppercase tracking-wide leading-tight">
              {card.name}
            </div>
          </div>
          <div className="text-right">
            <div className="text-yellow-400 text-sm font-mono font-bold">{card.staminaCost}⚡</div>
            <div className="text-zinc-500 text-[10px] uppercase">Stamina</div>
          </div>
        </div>
        <div className="text-zinc-300 text-sm">{card.description}</div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-zinc-800 text-xs">
          <div>
            <div className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold">Power</div>
            <div className="text-white font-mono font-bold">{card.basePower ?? '-'}</div>
          </div>
          <div>
            <div className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold">Position</div>
            <div className="text-white font-mono font-bold">{card.position}</div>
          </div>
          <div>
            <div className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold">Mini-game</div>
            <div className="text-emerald-400 font-mono font-bold">Charge</div>
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-800">
          <div className="text-sky-500 text-[10px] font-black uppercase tracking-widest mb-1">Counters</div>
          <div className="text-sky-300 text-xs">{counterNames}</div>
        </div>
      </div>
    </div>
  );
}

function MinigameStep({ mechanic, promptCardName, onResolved, resetKey }) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    setResult(null);
  }, [resetKey]);

  const handleResolve = (r) => {
    setResult(r);
    onResolved(r);
  };

  const Mechanic = (
    mechanic === 'charge'   ? ChargeMechanic   :
    mechanic === 'reaction' ? ReactionMechanic :
    mechanic === 'trace'    ? TraceMechanic    :
    mechanic === 'burst'    ? BurstMechanic    :
    null
  );

  return (
    <div className="space-y-4">
      {promptCardName && (
        <div className="text-center text-zinc-400 text-xs">
          Imagine you just committed <span className="text-white font-bold">{promptCardName}</span>.
        </div>
      )}
      {!result && Mechanic && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex justify-center">
          <Mechanic key={resetKey} onResolve={handleResolve} />
        </div>
      )}
      {result && <ResultBanner result={result} />}
    </div>
  );
}

function ResultBanner({ result }) {
  const t = TIER_STYLE[result.tier] || TIER_STYLE.MISS;
  const expected = SKILL_TIERS[result.tier];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-4 ring-1 ${t.ring} text-center`}
    >
      <div className={`text-2xl font-black ${t.color}`}>{t.label}</div>
      <div className="text-zinc-400 text-sm mt-1">
        +{expected?.bonus ?? result.bonus} power · ±{expected?.rngRange ?? result.rngRange} variance
      </div>
    </motion.div>
  );
}

function PinExplainer() {
  return (
    <div className="space-y-3">
      <div className="bg-zinc-900 border border-red-900/40 rounded-2xl p-4">
        <div className="text-red-400 text-xs font-black uppercase tracking-widest mb-2">📌 Pin Attempt</div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          {[1, 2, 3].map(s => (
            <div key={s} className={`rounded-lg border p-2 ${s === 1 ? 'border-amber-700 bg-amber-950/20 text-amber-400' : s === 2 ? 'border-orange-700 bg-orange-950/20 text-orange-400' : 'border-red-700 bg-red-950/20 text-red-400'}`}>
              <div className="font-black">Stage {s}</div>
              <div className="text-[10px] mt-0.5">
                {s === 1 ? 'Lock' : s === 2 ? 'Drive' : 'Finish'}
              </div>
            </div>
          ))}
        </div>
        <div className="text-zinc-500 text-[11px] mt-3">
          Each defense card you spend is locked out for the next stage. Last card standing wins the sequence.
        </div>
      </div>
    </div>
  );
}

function StaminaExplainer() {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-zinc-500 uppercase font-bold tracking-widest">Fresh</span>
          <span className="text-emerald-400 font-mono font-bold">200</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: '100%' }} /></div>
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-zinc-500 uppercase font-bold tracking-widest">Tiring</span>
          <span className="text-yellow-400 font-mono font-bold">120</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-yellow-500" style={{ width: '60%' }} /></div>
      </div>
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-zinc-500 uppercase font-bold tracking-widest">Gassed</span>
          <span className="text-red-400 font-mono font-bold">60</span>
        </div>
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-red-500" style={{ width: '30%' }} /></div>
      </div>
      <div className="text-zinc-500 text-[11px]">
        Below ~120 stamina, fatigue starts shaving power off every move - even a PERFECT mini-game won't fully compensate.
      </div>
    </div>
  );
}

// PeriodChoiceModal needs a state shape: period, p1, p2, pendingChoiceFor.
// Construct a minimal one rather than spinning up the engine for one screen.
//
// PeriodChoiceModal renders inside a BottomSheet (fixed inset-0 z-50) - a
// full-viewport overlay that covers the tutorial footer. In the live game,
// WrestlingGame.jsx controls the modal's lifetime by unmounting it once the
// engine receives the pick. We mirror that here: after the user chooses, we
// unmount the modal and show a confirmation card so the tutorial's Next
// button is uncovered. Without this, the Next button stays hidden behind
// the sheet and the user can't advance.
const CHOICE_LABEL = {
  top:     { label: 'Top',     sub: 'Start riding'    },
  bottom:  { label: 'Bottom',  sub: 'Start escaping'  },
  neutral: { label: 'Neutral', sub: 'Start standing'  },
  defer:   { label: 'Defer',   sub: 'Opponent chooses' },
};

function PeriodChoiceStep({ onChoose }) {
  const [picked, setPicked] = useState(null);
  const mockState = {
    period: 2,
    p1: { name: 'You',  score: 3 },
    p2: { name: 'CPU',  score: 1 },
    pendingChoiceFor: 'p1',
  };

  const handleChoice = (id) => {
    setPicked(id);
    onChoose(id);
  };

  if (picked) {
    const c = CHOICE_LABEL[picked] || { label: picked, sub: '' };
    return (
      <div className="bg-zinc-900 border border-emerald-700/40 rounded-2xl p-4 text-center">
        <div className="text-emerald-400 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
          Choice Locked
        </div>
        <div className="text-white text-xl font-black">{c.label}</div>
        {c.sub && <div className="text-zinc-400 text-xs mt-0.5">{c.sub}</div>}
        <div className="text-zinc-500 text-[11px] mt-3">Tap Next to continue.</div>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center">
      <div className="text-zinc-400 text-xs">
        End of Period 1. You're up 3-1. Pick your start for Period 2.
      </div>
      <PeriodChoiceModal
        state={mockState}
        onChoice={(_who, id) => handleChoice(id)}
        gameMode="vs_ai"
        humanPlayer="p1"
      />
      {/* Fallback: if the modal fails to render or its buttons are
          unreachable on a given device, this lets the user still
          advance the tutorial. Confirmed working on Build 17 web/iOS,
          but kept as a belt-and-suspenders escape hatch. */}
      <button
        onClick={() => handleChoice('neutral')}
        className="mt-3 text-zinc-500 hover:text-zinc-300 text-[11px] underline underline-offset-2"
      >
        Can't see the picker? Skip this step
      </button>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function Tutorial({ onBack }) {
  const savedStep = parseInt(localStorage.getItem(TUTORIAL_STORAGE_KEY) || '0', 10);
  const [currentStep, setCurrentStep] = useState(
    Math.min(Math.max(savedStep, 0), TUTORIAL_STEPS.length - 1),
  );
  // Bumped to remount minigame components when the user retries a step.
  const [resetKey, setResetKey] = useState(0);
  // For interactive steps, set true once the user has completed the action.
  const [interactionDone, setInteractionDone] = useState(false);

  const step = TUTORIAL_STEPS[currentStep];

  useEffect(() => {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, String(currentStep));
    setInteractionDone(false);
    setResetKey(k => k + 1);
  }, [currentStep]);

  const isInteractive = step.kind === 'minigame' || step.kind === 'period_choice';
  const canAdvance = !isInteractive || interactionDone;
  const isLast = currentStep === TUTORIAL_STEPS.length - 1;

  const handleNext = () => {
    if (!canAdvance) return;
    if (isLast) {
      localStorage.setItem(TUTORIAL_COMPLETED_KEY, 'true');
      localStorage.setItem(TUTORIAL_STORAGE_KEY, '0');
      onBack?.();
      return;
    }
    setCurrentStep(s => s + 1);
  };

  const handleRetry = () => {
    setInteractionDone(false);
    setResetKey(k => k + 1);
  };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar
        title="Tutorial"
        onBack={onBack}
        right={
          <div className="text-zinc-500 text-xs font-mono pr-1">
            {currentStep + 1}/{TUTORIAL_STEPS.length}
          </div>
        }
      />

      {/* Progress bar */}
      <div className="px-4 pt-2 max-w-lg md:max-w-2xl mx-auto w-full">
        <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-yellow-500 rounded-full transition-all duration-500"
            style={{ width: `${((currentStep + 1) / TUTORIAL_STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 max-w-lg md:max-w-2xl mx-auto w-full space-y-5">
        <AnimatePresence mode="wait">
          <motion.div
            key={step.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            <div>
              <h1 className="text-yellow-400 font-black text-xl tracking-tight">{step.title}</h1>
            </div>

            <StepText body={step.body} />

            {step.kind === 'card_anatomy' && <CardAnatomy cardId={step.cardId} />}

            {step.kind === 'minigame' && (
              <MinigameStep
                mechanic={step.mechanic}
                promptCardName={step.promptCardName}
                onResolved={() => setInteractionDone(true)}
                resetKey={resetKey}
              />
            )}

            {step.kind === 'period_choice' && (
              <PeriodChoiceStep onChoose={() => setInteractionDone(true)} />
            )}

            {step.kind === 'pin_explainer' && <PinExplainer />}

            {step.kind === 'stamina_explainer' && <StaminaExplainer />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer actions */}
      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 pb-safe max-w-lg md:max-w-2xl mx-auto w-full">
        <div className="flex gap-2">
          {step.kind === 'minigame' && interactionDone && (
            <button
              onClick={handleRetry}
              className="flex items-center justify-center gap-1.5 px-4 py-3 rounded-xl border border-zinc-700 bg-zinc-900 text-zinc-300 text-sm font-bold active:scale-[0.98] transition-all"
            >
              <RotateCcw size={14} /> Retry
            </button>
          )}
          <button
            onClick={handleNext}
            disabled={!canAdvance}
            className={
              `flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-black transition-all ` +
              (canAdvance
                ? 'bg-yellow-500 hover:bg-yellow-400 active:scale-[0.98] text-black'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed')
            }
          >
            {isLast
              ? 'Finish'
              : canAdvance
                ? 'Next'
                : step.kind === 'period_choice'
                  ? 'Pick a position first'
                  : 'Try the mini-game first'}
            {canAdvance && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
