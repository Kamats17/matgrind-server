import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { haptic } from '../../lib/haptics';
import useReducedMotion from '../../lib/useReducedMotion';

/**
 * PinActionPad - tap-and-hold + directional-swipe commit.
 *
 * Replaces the legacy "tap the card you want" grid. The pin stage now reads
 * as a split-second physical mini-game: the player presses the pad with
 * their thumb, sees four cards arranged around a compass, and flicks toward
 * the one they want. Because the direction→card mapping is reshuffled every
 * stage, reviewers (and players) can't rely on muscle memory - each stage
 * demands a fresh read, which keeps the pin sequence tense instead of a
 * rubber-stamp button tap.
 *
 * Why this is randomized:
 *  - Position of each card around the compass is shuffled per stage.
 *  - If there are fewer than 4 available cards, empty slots are randomised
 *    too so "up" isn't always the committed slot.
 *
 * Engine compatibility: when the player releases over a valid slot we still
 * call `onCommit(cardId)` with a real wrestlingEngine card id, so nothing in
 * `wrestlingEngine.js` or the scoring rules needs to move. This component
 * is purely an input-method swap.
 */

const DIRECTIONS = [
  { id: 'up',    label: '↑', dx: 0,  dy: -1, angle: -90 },
  { id: 'right', label: '→', dx: 1,  dy: 0,  angle: 0 },
  { id: 'down',  label: '↓', dx: 0,  dy: 1,  angle: 90 },
  { id: 'left',  label: '←', dx: -1, dy: 0,  angle: 180 },
];

// Fisher-Yates for small arrays. Fresh shuffle per stage keeps the mapping
// unpredictable so there's no "always swipe up for finish" exploit.
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const HOLD_MS = 350;              // how long before a swipe is accepted
const SWIPE_THRESHOLD_PX = 42;    // minimum drag distance to count as a swipe
const RADIUS = 88;                // px from pad center to slot center

export default function PinActionPad({
  cards,               // array of card objects from wrestlingEngine
  onCommit,            // (cardId) => void
  accentColor = 'emerald',
  disabled = false,
  seed,                // stage number or similar - changing this reshuffles
  helperText,          // short prompt, e.g. "Hold, then swipe toward your move"
  disabledCardIds = [],// cards to grey out (e.g. already-spent defense cards)
}) {
  const reduceMotion = useReducedMotion();
  const padRef = useRef(null);
  const activePointer = useRef(null);
  const holdTimer = useRef(null);

  const [holding, setHolding] = useState(false);
  const [armed, setArmed] = useState(false);
  const [pointerDelta, setPointerDelta] = useState({ dx: 0, dy: 0 });

  // Assignment of cards → compass directions. Reshuffled whenever `seed` or
  // the pool of cards changes so each pin stage is a fresh puzzle.
  const assignment = useMemo(() => {
    const slots = shuffle(DIRECTIONS);
    const pool = shuffle(cards);
    return slots.map((dir, i) => ({ dir, card: pool[i] || null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, cards.length]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearHoldTimer();
    activePointer.current = null;
    setHolding(false);
    setArmed(false);
    setPointerDelta({ dx: 0, dy: 0 });
  }, [clearHoldTimer]);

  useEffect(() => reset, [seed, reset]);

  const getLocalDelta = (e) => {
    const rect = padRef.current?.getBoundingClientRect();
    if (!rect) return { dx: 0, dy: 0 };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return { dx: e.clientX - cx, dy: e.clientY - cy };
  };

  const handlePointerDown = (e) => {
    if (disabled) return;
    if (activePointer.current !== null) return;
    e.preventDefault();
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setHolding(true);
    haptic.light();
    clearHoldTimer();
    holdTimer.current = setTimeout(() => {
      setArmed(true);
      haptic.medium();
    }, HOLD_MS);
  };

  const handlePointerMove = (e) => {
    if (activePointer.current !== e.pointerId) return;
    setPointerDelta(getLocalDelta(e));
  };

  const handlePointerUp = (e) => {
    if (activePointer.current !== e.pointerId) return;
    const { dx, dy } = getLocalDelta(e);
    const distance = Math.hypot(dx, dy);
    const wasArmed = armed;
    reset();

    if (!wasArmed) {
      // Released before the hold completed - treat as cancel, no penalty.
      haptic.warning();
      return;
    }
    if (distance < SWIPE_THRESHOLD_PX) {
      // Held long enough but never committed a direction - cancel softly.
      haptic.warning();
      return;
    }

    // Map release vector to nearest compass direction.
    const angle = Math.atan2(dy, dx) * (180 / Math.PI); // -180..180
    let pick = 'right';
    if (angle >= -45 && angle < 45) pick = 'right';
    else if (angle >= 45 && angle < 135) pick = 'down';
    else if (angle >= -135 && angle < -45) pick = 'up';
    else pick = 'left';

    const slot = assignment.find((s) => s.dir.id === pick);
    if (!slot || !slot.card) {
      haptic.warning();
      return;
    }
    if (disabledCardIds.includes(slot.card.id)) {
      haptic.warning();
      return;
    }
    haptic.heavy();
    onCommit(slot.card.id);
  };

  const handlePointerCancel = (e) => {
    if (activePointer.current !== e.pointerId) return;
    reset();
  };

  // Visual: which direction is the pointer currently nearest? Only shown
  // while armed so early movement doesn't flicker highlight.
  const liveHighlight = (() => {
    if (!armed) return null;
    const { dx, dy } = pointerDelta;
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD_PX) return null;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angle >= -45 && angle < 45) return 'right';
    if (angle >= 45 && angle < 135) return 'down';
    if (angle >= -135 && angle < -45) return 'up';
    return 'left';
  })();

  const accent = {
    emerald: { ring: 'ring-emerald-500/70', fill: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-600' },
    blue:    { ring: 'ring-blue-500/70',    fill: 'bg-blue-500',    text: 'text-blue-300',    border: 'border-blue-600' },
    red:     { ring: 'ring-red-500/70',     fill: 'bg-red-500',     text: 'text-red-300',     border: 'border-red-600' },
  }[accentColor] || { ring: 'ring-emerald-500/70', fill: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-600' };

  return (
    <div className="w-full flex flex-col items-center select-none">
      <div
        ref={padRef}
        className="relative"
        style={{ width: RADIUS * 2 + 96, height: RADIUS * 2 + 96, touchAction: 'none' }}
      >
        {/* Directional slot cards */}
        {assignment.map(({ dir, card }) => {
          const isDisabled = !card || disabledCardIds.includes(card?.id);
          const isHighlight = liveHighlight === dir.id && !isDisabled;
          const x = RADIUS * dir.dx;
          const y = RADIUS * dir.dy;
          return (
            <div
              key={dir.id}
              className={`absolute top-1/2 left-1/2 w-28 -translate-x-1/2 -translate-y-1/2 text-center rounded-xl p-2 border transition-all
                ${isDisabled
                  ? 'border-zinc-800 bg-zinc-900/60 opacity-40'
                  : isHighlight
                    ? `${accent.border} bg-zinc-800 ${reduceMotion ? '' : 'scale-110'} shadow-lg ring-2 ${accent.ring}`
                    : 'border-zinc-700 bg-zinc-800/80'}`}
              style={{
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))${isHighlight && !reduceMotion ? ' scale(1.1)' : ''}`,
              }}
              aria-hidden="true"
            >
              <div className={`text-[10px] font-black uppercase tracking-wider mb-0.5 ${isDisabled ? 'text-zinc-600' : accent.text}`}>
                {dir.label}
              </div>
              {card ? (
                <>
                  <div className={`text-xs font-bold ${isDisabled ? 'text-zinc-600' : 'text-white'}`}>{card.name}</div>
                  <div className="text-[10px] text-zinc-500 leading-tight mt-0.5 line-clamp-2">{card.description}</div>
                  <div className={`text-[10px] font-mono mt-1 ${isDisabled ? 'text-zinc-700' : accent.text}`}>
                    {typeof card.bonus === 'number'
                      ? `+${Math.round(card.bonus * 100)}%`
                      : typeof card.resistance === 'number'
                        ? `-${Math.round(card.resistance * 100)}%`
                        : ''}
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-zinc-700">-</div>
              )}
            </div>
          );
        })}

        {/* Center hold pad */}
        <button
          type="button"
          disabled={disabled}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          aria-label="Hold and swipe toward your chosen move"
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-24 h-24 rounded-full
            flex items-center justify-center font-black text-xs uppercase tracking-widest
            border-2 transition-all
            ${disabled
              ? 'bg-zinc-900 border-zinc-800 text-zinc-700 cursor-not-allowed'
              : armed
                ? `${accent.fill} border-white text-black ${reduceMotion ? '' : 'scale-105 animate-pulse'}`
                : holding
                  ? `bg-zinc-700 ${accent.border} text-white ${reduceMotion ? '' : 'scale-95'}`
                  : `bg-zinc-800 ${accent.border} text-white hover:bg-zinc-700 active:scale-95`}
          `}
        >
          {disabled ? 'Waiting' : armed ? 'Swipe!' : holding ? 'Hold…' : 'Hold'}
        </button>
      </div>

      {helperText && (
        <p className="text-[11px] text-zinc-500 mt-2 text-center max-w-[18rem] leading-tight">{helperText}</p>
      )}
    </div>
  );
}
