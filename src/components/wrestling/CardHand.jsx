import React, { useState, useRef, useCallback } from 'react';
import { CARDS } from '../../lib/wrestlingCards';
import { haptic } from '../../lib/haptics';
import CardDetailSheet from './CardDetailSheet';

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;

// Build reverse lookup: cardId → [ids of cards that are strong against it]
const WEAK_AGAINST = {};
for (const [id, card] of Object.entries(CARDS)) {
  if (card.strongAgainst) {
    for (const targetId of card.strongAgainst) {
      if (!WEAK_AGAINST[targetId]) WEAK_AGAINST[targetId] = [];
      WEAK_AGAINST[targetId].push(id);
    }
  }
}

const CONDITION_LABELS = {
  front_headlock_control: 'Front Headlock',
  front_headlock_trapped: 'FHL Trapped',
  control_established: 'Control',
  broken_down: 'Broken Down',
  good_base: 'Good Base',
  hand_fighting: 'Hand Fighting',
  hand_fighting_control: 'Hand Fighting',
  recovering: 'Recovering',
  inside_position: 'Inside Position',
  leg_attack_secured: 'Leg Secured',
  leg_attack_trapped: 'Leg Trapped',
  scramble: 'Scramble!',
  tie_up: 'Tie-Up',
};

// Category palette - v2.0 unified scheme. Colors sorted by move archetype:
//   offense (orange), defense (sky), dominance/ride (amber), scoring (emerald),
//   escape/bottom (purple), throw (red), transition (yellow), special (fuchsia).
// The hex source of truth lives in src/lib/cardCategoryTheme.js; these
// Tailwind-class bundles mirror those hexes for the CardHand surface.
const CATEGORY_STYLES = {
  neutral_attack:  { bg: 'bg-orange-950/80',  border: 'border-orange-700',  stripe: 'bg-orange-500',  badge: 'bg-orange-800 text-orange-200',  label: 'ATTACK',    activeBorder: 'border-orange-500' },
  neutral_counter: { bg: 'bg-sky-950/80',     border: 'border-sky-700',     stripe: 'bg-sky-500',     badge: 'bg-sky-800 text-sky-200',         label: 'COUNTER',   activeBorder: 'border-sky-500' },
  top_control:     { bg: 'bg-amber-950/80',   border: 'border-amber-700',   stripe: 'bg-amber-500',   badge: 'bg-amber-800 text-amber-200',     label: 'RIDE',      activeBorder: 'border-amber-500' },
  top_turns:       { bg: 'bg-emerald-950/80', border: 'border-emerald-700', stripe: 'bg-emerald-500', badge: 'bg-emerald-800 text-emerald-200', label: 'TURN',      activeBorder: 'border-emerald-500' },
  bottom:          { bg: 'bg-purple-950/80',  border: 'border-purple-700',  stripe: 'bg-purple-500',  badge: 'bg-purple-800 text-purple-200',   label: 'ESCAPE',    activeBorder: 'border-purple-500' },
  special:         { bg: 'bg-fuchsia-950/80', border: 'border-fuchsia-700', stripe: 'bg-fuchsia-500', badge: 'bg-fuchsia-800 text-fuchsia-200', label: 'SPECIAL',   activeBorder: 'border-fuchsia-500' },
  par_terre_top:   { bg: 'bg-amber-950/80',   border: 'border-amber-700',   stripe: 'bg-amber-500',   badge: 'bg-amber-800 text-amber-200',     label: 'PAR TERRE', activeBorder: 'border-amber-500' },
  throw:           { bg: 'bg-red-950/80',     border: 'border-red-700',     stripe: 'bg-red-500',     badge: 'bg-red-800 text-red-200',         label: 'THROW',     activeBorder: 'border-red-500' },
  transition:      { bg: 'bg-yellow-950/80',  border: 'border-yellow-700',  stripe: 'bg-yellow-500',  badge: 'bg-yellow-800 text-yellow-200',   label: 'SETUP',     activeBorder: 'border-yellow-500' },
};

export default function CardHand({ cards, selectedCard, onSelectCard, disabled, position, conditions = [], playerColor = 'green', highlightedCardIds = null }) {
  const [hovered, setHovered] = useState(null);
  const [detailCard, setDetailCard] = useState(null);

  // Long-press state - we use a pointer-aware timer so a genuine short tap
  // still plays the card but holding the button for ~450ms surfaces the
  // detail sheet. We only skip onSelectCard when the long-press actually
  // fired, so the tap gesture is unaffected on both touch and mouse.
  const pressTimer = useRef(null);
  const pressStart = useRef({ x: 0, y: 0 });
  const longPressFired = useRef(false);
  const pressedCardId = useRef(null);

  const clearPressTimer = useCallback(() => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }, []);

  if (!cards || cards.length === 0) {
    return <div className="text-zinc-600 text-xs text-center py-4">No moves available</div>;
  }

  const isAvailable = (card) => {
    if (disabled) return false;
    if (card.position !== null && card.position !== position) return false;
    if (card.setupRequired && card.setupRequired.length > 0) {
      return card.setupRequired.every(req => conditions.includes(req));
    }
    return true;
  };

  const isFHL = (card) => card.id?.startsWith('fhl_');

  const hoveredCard = hovered ? cards.find(c => c.id === hovered) : null;

  // Pointer handlers per card - wired inline in the map below.
  const onPointerDown = (e, card) => {
    longPressFired.current = false;
    pressedCardId.current = card.id;
    pressStart.current = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      pressTimer.current = null;
      try { haptic.medium(); } catch { /* silent */ }
      setHovered(null);
      setDetailCard(card);
    }, LONG_PRESS_MS);
  };

  const onPointerMove = (e) => {
    if (!pressTimer.current) return;
    const dx = (e.clientX ?? 0) - pressStart.current.x;
    const dy = (e.clientY ?? 0) - pressStart.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearPressTimer();
  };

  const onPointerUp = (card, available) => {
    const wasLongPress = longPressFired.current;
    clearPressTimer();
    longPressFired.current = false;
    pressedCardId.current = null;
    if (wasLongPress) return; // Sheet is open; don't play
    if (!available) return;
    setHovered(null);
    haptic.light();
    onSelectCard?.(card);
  };

  const onPointerCancel = () => {
    clearPressTimer();
    longPressFired.current = false;
    pressedCardId.current = null;
  };

  return (
    <div role="group" aria-label="Your wrestling moves">
      <div className="grid grid-cols-3 gap-2">
        {cards.map(card => {
          const available = isAvailable(card);
          const selected = selectedCard?.id === card.id;
          const styles = CATEGORY_STYLES[card.category] || CATEGORY_STYLES.special;
          const isBranch = isFHL(card);
          const isHighlighted = highlightedCardIds ? highlightedCardIds.includes(card.id) : null;
          const isDimmed = highlightedCardIds && !isHighlighted;

          return (
            <button
              key={card.id}
              disabled={!available}
              aria-label={`${card.name} - ${card.staminaCost} stamina${card.scoreEffect ? ', ' + card.scoreEffect.type : ''}. Long-press for details.`}
              onPointerDown={(e) => onPointerDown(e, card)}
              onPointerMove={onPointerMove}
              onPointerUp={() => onPointerUp(card, available)}
              onPointerLeave={onPointerCancel}
              onPointerCancel={onPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
              onMouseEnter={() => setHovered(card.id)}
              onMouseLeave={() => setHovered(null)}
              onTouchStart={() => setHovered(null)}
              className={`
                relative rounded-lg border-2 p-0 overflow-hidden text-left transition-all duration-150 select-none
                ${available
                  ? selected
                    ? `${styles.bg} ${styles.activeBorder} ring-2 ring-white/20 scale-105 shadow-[0_0_12px_rgba(255,255,255,0.15)]`
                    : isDimmed
                      ? `${styles.bg} ${styles.border} opacity-40 cursor-pointer`
                      : `${styles.bg} ${styles.border} hover:brightness-125 hover:scale-[1.03] cursor-pointer`
                  : 'bg-zinc-900/50 border-zinc-800 opacity-30 cursor-not-allowed'
                }
                ${isBranch && available ? 'ring-1 ring-purple-500/40' : ''}
                ${isHighlighted && available ? 'ring-2 ring-yellow-400 shadow-[0_0_16px_rgba(250,204,21,0.3)]' : ''}
              `}
            >
              <div className="px-2.5 pt-2 pb-2">
                {/* Row: badge + stamina */}
                <div className="flex items-center justify-between mb-1">
                  <div className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${available ? styles.badge : 'bg-zinc-800 text-zinc-600'}`}>
                    {isBranch ? 'FHL' : styles.label}
                  </div>
                  <div className={`text-sm font-bold font-mono ${available ? 'text-yellow-400' : 'text-zinc-700'}`}>
                    {card.staminaCost}⚡
                  </div>
                </div>

                {/* Card name - ALL CAPS */}
                <div className={`text-sm font-black uppercase tracking-wide leading-tight ${available ? 'text-white' : 'text-zinc-600'}`}>
                  {card.name}
                </div>

                {/* Description */}
                <div className={`text-[11px] leading-snug mt-0.5 ${available ? 'text-zinc-400' : 'text-zinc-700'}`}>
                  {card.description}
                </div>

                {/* Strong vs indicator */}
                {card.strongAgainst?.length > 0 && available && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    <span className="text-[8px] text-emerald-500 font-bold uppercase mr-0.5">VS:</span>
                    {card.strongAgainst.slice(0, 3).map(id => (
                      <span key={id} className="text-[8px] bg-emerald-900/40 text-emerald-400 px-1 rounded">
                        {CARDS[id]?.name || id.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {card.strongAgainst.length > 3 && (
                      <span className="text-[8px] text-emerald-600">+{card.strongAgainst.length - 3}</span>
                    )}
                  </div>
                )}

                {/* Weak against indicator - for cards without strongAgainst */}
                {!card.strongAgainst?.length && WEAK_AGAINST[card.id]?.length > 0 && available && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    <span className="text-[8px] text-red-500 font-bold uppercase mr-0.5">WEAK:</span>
                    {WEAK_AGAINST[card.id].slice(0, 3).map(id => (
                      <span key={id} className="text-[8px] bg-red-900/40 text-red-400 px-1 rounded">
                        {CARDS[id]?.name || id.replace(/_/g, ' ')}
                      </span>
                    ))}
                    {WEAK_AGAINST[card.id].length > 3 && (
                      <span className="text-[8px] text-red-600">+{WEAK_AGAINST[card.id].length - 3}</span>
                    )}
                  </div>
                )}

                {/* PIN THREAT indicator */}
                {card.scoreEffect?.pinChance && available && (
                  <div className="text-[9px] font-bold uppercase tracking-wider text-red-400 mt-1">PIN THREAT</div>
                )}

                {/* Chain move indicator */}
                {isBranch && available && (
                  <div className="text-[9px] text-purple-400 font-bold uppercase tracking-wider mt-1">CHAIN</div>
                )}
              </div>

              {/* Selected indicator */}
              {selected && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full flex items-center justify-center shadow-md">
                  <div className={`w-2 h-2 rounded-full ${playerColor === 'green' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                </div>
              )}

              {/* Lock overlay */}
              {card.setupRequired?.length > 0 && !available && (
                <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/70">
                  <span className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">LOCKED</span>
                  <span className="text-zinc-600 text-[9px] mt-0.5">
                    Requires: {card.setupRequired.map(r => CONDITION_LABELS[r] || r.replace(/_/g, ' ')).join(' + ')}
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hoveredCard && (() => {
        const hoveredStyles = CATEGORY_STYLES[hoveredCard.category] || CATEGORY_STYLES.special;
        return (
          <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-950 pointer-events-none overflow-hidden select-none z-0 relative">
            <div className={`h-1 w-full ${hoveredStyles.stripe}`} />
            <div className="p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${hoveredStyles.badge}`}>
                  {hoveredStyles.label}
                </span>
                <span className="text-white font-black text-sm uppercase tracking-wide">{hoveredCard.name}</span>
              </div>
              <div className="text-zinc-300 text-xs mt-1">{hoveredCard.description}</div>
              <div className="text-zinc-600 text-xs italic mt-1">"{hoveredCard.flavor}"</div>
              <div className="flex items-center gap-3 mt-2 border-t border-zinc-800 pt-2">
                <div className="text-yellow-400 text-xs font-mono font-bold">{hoveredCard.staminaCost}⚡</div>
                <div className="text-zinc-500 text-xs">Power: {hoveredCard.basePower}</div>
                {hoveredCard.setupRequired?.length > 0 && (
                  <div className="text-amber-500 text-xs">
                    Req: {hoveredCard.setupRequired.map(r => CONDITION_LABELS[r] || r.replace(/_/g,' ')).join(', ')}
                  </div>
                )}
              </div>
              {hoveredCard.strongAgainst?.length > 0 && (
                <div className="mt-1.5 text-emerald-400 text-xs">
                  Strong vs: {hoveredCard.strongAgainst.map(id => CARDS[id]?.name || id.replace(/_/g, ' ')).join(', ')}
                </div>
              )}
              {WEAK_AGAINST[hoveredCard.id]?.length > 0 && (
                <div className="mt-1.5 text-red-400 text-xs">
                  Weak vs: {WEAK_AGAINST[hoveredCard.id].map(id => CARDS[id]?.name || id.replace(/_/g,' ')).join(', ')}
                </div>
              )}
              {hoveredCard.counters?.length > 0 && (
                <div className="mt-1.5 text-sky-400 text-xs">
                  Counters: {hoveredCard.counters.join(', ').replace(/_/g, ' ')}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Mobile long-press detail sheet */}
      <CardDetailSheet
        card={detailCard}
        weakAgainst={detailCard ? (WEAK_AGAINST[detailCard.id] || []) : []}
        open={!!detailCard}
        onClose={() => setDetailCard(null)}
        canPlay={detailCard ? isAvailable(detailCard) : false}
        onPlay={detailCard && isAvailable(detailCard) ? () => onSelectCard?.(detailCard) : undefined}
      />
    </div>
  );
}