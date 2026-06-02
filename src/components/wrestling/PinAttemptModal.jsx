import React, { useEffect } from 'react';
import { PIN_OFFENSE_CARDS, PIN_DEFENSE_CARDS } from '../../lib/wrestlingEngine.js';
import { useColorblind, p1TextClass, p2TextClass } from '../../lib/ColorblindContext';
import { haptic } from '../../lib/haptics';
import useReducedMotion from '../../lib/useReducedMotion';
import PinActionPad from './PinActionPad.jsx';

export default function PinAttemptModal({ state, onOffenseChoice, onDefenseChoice, humanPlayer = 'p1', pendingOffense, pendingDefense }) {
  const { colorblind } = useColorblind();
  const reduceMotion = useReducedMotion();
  const { pinAttempt } = state;

  // Haptic on pin attempt mount - must be before early return (Rules of Hooks)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (pinAttempt) haptic.warning(); }, []);

  if (!pinAttempt) return null;

  const { attacker, pinChance, stage = 1, burnedDefCards = [] } = pinAttempt;
  const defender = attacker === 'p1' ? 'p2' : 'p1';
  const attackerData = state[attacker];
  const defenderData = state[defender];
  const isP1Attacker = attacker === 'p1';

  // Display chance varies by stage. Stage 1 subtracts the fresh-defender
  // bonus (engine: FRESH_DEFENDER_BONUS = 0.18) so the % shown matches the
  // chance actually rolled. Lower-clamp to 0.03 mirrors the engine clamp.
  const stageModifier = stage === 1 ? -0.18 : stage === 2 ? 0.00 : 0.06;
  const stageCap = stage === 1 ? 0.72 : stage === 2 ? 0.80 : 0.92;
  const displayChance = Math.max(0.03, Math.min(stageCap, pinChance + stageModifier));
  const pctDisplay = Math.round(displayChance * 100);
  const dangerColor = pctDisplay >= 50 ? 'text-red-400' : pctDisplay >= 30 ? 'text-amber-400' : 'text-yellow-300';
  const barColor = pctDisplay >= 50 ? 'bg-red-500' : pctDisplay >= 30 ? 'bg-amber-500' : 'bg-yellow-400';

  // Stage 1: no pin_finish, no pin_power_drive; Stage 2: no pin_finish; Stage 3: all cards
  const allOffenseCards = Object.values(PIN_OFFENSE_CARDS);
  const availableOffenseCards = stage === 1
    ? allOffenseCards.filter(c => c.id !== 'pin_finish' && c.id !== 'pin_power_drive')
    : stage === 2
    ? allOffenseCards.filter(c => c.id !== 'pin_finish')
    : allOffenseCards;

  // Grayed-out offense cards for display
  const lockedOffenseCards = stage === 1
    ? allOffenseCards.filter(c => c.id === 'pin_power_drive' || c.id === 'pin_finish')
    : stage === 2
    ? allOffenseCards.filter(c => c.id === 'pin_finish')
    : [];

  const defenseCards = Object.values(PIN_DEFENSE_CARDS);

  // Stage-specific flavor text
  const stageFlavorText = stage === 1
    ? 'Fight off the lock - your choice is burned for Stage 2'
    : stage === 2
    ? 'Attacker adjusting pressure - one defense card spent!'
    : 'Going for the finish - two defense cards spent!';

  const stageChanceLabel = stage === 1
    ? 'base pin probability'
    : stage === 2
    ? 'pin probability (adjusting pressure)'
    : 'pin probability (+6% exhausted)';

  // Render only the local player's column. Opponent's choices are never shown -
  // the engine resolves the AI / remote side server-side and the player learns
  // the result from the chance bar + outcome animation, not from a "CPU choosing"
  // placeholder. Spectators see neither pad (header/chance bar only).
  const humanIsAttacker = humanPlayer === attacker;
  const humanIsDefender = humanPlayer === defender;
  const isSpectator = !humanIsAttacker && !humanIsDefender;

  const offenseDone = !!pendingOffense;
  const defenseDone = !!pendingDefense;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-sm p-4 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-label="Pin attempt"
    >
      {/* Centered focus-modal - not a dismissible sheet, since swipe-to-dismiss
          mid-pin would break the match state machine. We still adopt the sheet's
          visual language (rounded-3xl, drag-handle pill, zinc-900 chrome) so it
          reads consistently with the other iOS-style sheets in the app. */}
      <div className="bg-zinc-900 border border-red-900 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden max-h-[92dvh] overflow-y-auto">
        {/* Non-functional drag handle pill - visual continuity with BottomSheet */}
        <div className="pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1.5 rounded-full bg-zinc-800" aria-hidden="true" />
        </div>

        <div className="px-6 pb-6">

        {/* Header */}
        <div className="text-center mb-4">
          {/* Stage indicator */}
          <div className="flex items-center justify-center gap-2 mb-1">
            <div className={`text-xs font-black uppercase tracking-[0.2em] ${stage === 3 ? 'text-red-400' : stage === 2 ? 'text-orange-400' : 'text-amber-400'}`}>
              📌 Pin Attempt - Stage {stage} of 3
            </div>
          </div>
          <div className="text-zinc-500 text-xs mb-3">
            {stageFlavorText}
          </div>

          {/* Stage progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-3">
            {[1, 2, 3].map(s => (
              <div
                key={s}
                className={`w-2 h-2 rounded-full ${
                  s < stage
                    ? 'bg-red-500'
                    : s === stage
                      ? reduceMotion ? 'bg-amber-400' : 'bg-amber-400 animate-pulse'
                      : 'bg-zinc-700'
                }`}
              />
            ))}
          </div>

          {/* Stage transition callout */}
          {stage >= 2 && (
            <div className={`text-xs font-bold mb-2 border rounded-lg px-3 py-1.5 ${
              stage === 3 ? 'text-red-400 bg-red-950/40 border-red-800/40' : 'text-amber-400 bg-amber-950/40 border-amber-800/40'
            }`}>
              {stage === 3 ? '🔥 Defender exhausted - final stage!' : '⚠ Defender worn down - pin chance elevated'}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 mb-1">
            <span className={`font-black text-base ${isP1Attacker ? p1TextClass(colorblind) : p2TextClass(colorblind)}`}>
              {attackerData.name}
            </span>
            <span className="text-zinc-500 text-sm">driving for the fall on</span>
            <span className={`font-black text-base ${!isP1Attacker ? p1TextClass(colorblind) : p2TextClass(colorblind)}`}>
              {defenderData.name}
            </span>
          </div>
          <div className={`text-3xl font-black ${dangerColor} mt-1`}>
            {pctDisplay}%
          </div>
          <div className="text-zinc-500 text-xs mb-2">
            {stageChanceLabel}
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2.5">
            <div className={`h-2.5 rounded-full ${barColor} transition-all`} style={{ width: `${Math.min(100, pctDisplay)}%` }} />
          </div>
        </div>

        {/* Screen-reader announcement of stage + progress. Re-announced when stage
            or pin probability changes because the text content of the live region
            changes, which is enough for polite live regions. */}
        <div className="sr-only" role="status" aria-live="polite">
          Pin attempt. Stage {stage} of 3. {stageFlavorText} Current pin probability {pctDisplay} percent.
        </div>

        {humanIsAttacker && (
          <div>
            <div className={`text-xs font-black uppercase tracking-wider mb-2 ${isP1Attacker ? p1TextClass(colorblind) : p2TextClass(colorblind)}`}>
              {attackerData.name}
            </div>
            {stage === 1 && (
              <div className="text-zinc-600 text-xs mb-1.5 italic">Earn the finish first</div>
            )}
            {pendingOffense ? (
              <div className="flex flex-col items-center justify-center h-full py-6 gap-2">
                <div className="text-emerald-400 text-xs font-bold text-center">✓ Ready</div>
              </div>
            ) : (
              <PinActionPad
                cards={availableOffenseCards}
                onCommit={(cardId) => onOffenseChoice(cardId)}
                accentColor="emerald"
                seed={`off-${stage}`}
                helperText="Hold the pad, then flick toward your attack."
              />
            )}
            {lockedOffenseCards.length > 0 && !pendingOffense && (
              <div className="mt-2 space-y-1">
                {lockedOffenseCards.map(card => (
                  <div key={card.id} className="p-1.5 rounded-lg border border-zinc-800 bg-zinc-900 opacity-40 text-center">
                    <div className="text-zinc-600 font-bold text-[11px]">{card.name}</div>
                    <div className="text-zinc-700 text-[10px]">Locked - {card.id === 'pin_finish' ? 'Stage 3' : 'Stage 2'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {humanIsDefender && (
          <div>
            <div className={`text-xs font-black uppercase tracking-wider mb-2 ${!isP1Attacker ? p1TextClass(colorblind) : p2TextClass(colorblind)}`}>
              {defenderData.name}
            </div>
            {burnedDefCards.length > 0 && (
              <div className="text-amber-600 text-xs mb-1.5 italic">{burnedDefCards.length} card{burnedDefCards.length > 1 ? 's' : ''} spent</div>
            )}
            {pendingDefense ? (
              <div className="flex flex-col items-center justify-center h-full py-6 gap-2">
                <div className="text-blue-400 text-xs font-bold text-center">✓ Defending</div>
              </div>
            ) : (
              <PinActionPad
                cards={defenseCards}
                onCommit={(cardId) => onDefenseChoice(cardId)}
                accentColor="blue"
                seed={`def-${stage}-${burnedDefCards.join(',')}`}
                disabledCardIds={burnedDefCards}
                helperText="Hold the pad, then flick toward your escape."
              />
            )}
          </div>
        )}

        {!isSpectator && (
          <div className="mt-4 flex justify-center text-xs">
            {humanIsAttacker && (
              <span className={offenseDone ? 'text-emerald-400 font-bold' : 'text-zinc-600'}>
                {offenseDone ? '✓ Offense ready' : 'Offense: choose...'}
              </span>
            )}
            {humanIsDefender && (
              <span className={defenseDone ? 'text-blue-400 font-bold' : 'text-zinc-600'}>
                {defenseDone ? '✓ Defense ready' : 'Defense: choose...'}
              </span>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
