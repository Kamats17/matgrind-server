// src/components/wrestling/RadialCardPicker.jsx
//
// Persistent 3x2 card-grid picker. Replaces the prior radial hub/ring
// layout. Cards are always visible; a single tap commits, and a small
// HelpCircle overlay opens the existing CardDetailSheet for read-only
// move browsing.
//
// What stayed the same:
//   - public prop signature (cards, selectedCard, onSelectCard, disabled,
//     position, conditions, playerColor, waiting, staminaPct,
//     backgroundImage, rerollsLeft, onReroll) so WrestlingGame.jsx mount
//     sites don't change
//   - isAvailable() rules: disabled/waiting/position/setupRequired
//   - backgroundImage arena layers (image @ opacity 0.8 + vignette
//     overlay) - copied verbatim from the radial implementation
//   - wrestling category colors via getCategoryTheme(card.category).color
//   - CardDetailSheet component + behavior
//
// What was removed (everything that made the picker radial):
//   - hub button, ring geometry, ResizeObserver, slotPosition math
//   - fan / spring expand-collapse animation, framer-motion entirely
//   - pointer capture + drag/long-press state machine
//   - per-card 3D flip front/back faces
//   - visible category emoji glyphs on the card face (theme.icon)
//
// Props that no longer have a render surface (playerColor, staminaPct,
// rerollsLeft, onReroll, selectedCard) are accepted for API parity. The
// reroll affordance lives in the action bar inside WrestlingGame.jsx and
// is unaffected.

import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { haptic } from '../../lib/haptics';
import { getCategoryTheme } from '../../lib/cardCategoryTheme.js';
import CardDetailSheet from './CardDetailSheet';

export default function RadialCardPicker({
  cards,
  selectedCard,        // accepted for API parity; not rendered separately
  onSelectCard,
  disabled,
  position,
  conditions = [],
  playerColor = 'green', // accepted for API parity; no separate surface
  // Optional v2 props - accepted so WrestlingGame.jsx doesn't have to
  // change shape. waiting still gates commits; staminaPct, rerollsLeft,
  // onReroll have no in-picker render surface (handled elsewhere in the
  // game shell).
  waiting = false,
  staminaPct = null,     // eslint-disable-line no-unused-vars
  backgroundImage = null,
  rerollsLeft = null,    // eslint-disable-line no-unused-vars
  onReroll = null,       // eslint-disable-line no-unused-vars
}) {
  const [detailCardId, setDetailCardId] = useState(null);

  // Defensive guard. Cards in `cards` are expected to already be
  // available (the parent filters per position/conditions), but if a
  // stale or wrong-position card slips through, fail muted - render at
  // reduced opacity and no-op on tap rather than throwing.
  const isAvailable = (card) => {
    if (disabled || waiting) return false;
    if (!card) return false;
    if (card.position !== null && card.position !== position) return false;
    if (card.setupRequired && card.setupRequired.length > 0) {
      return card.setupRequired.every(req => conditions.includes(req));
    }
    return true;
  };

  const commit = (card) => {
    if (!isAvailable(card)) return;
    try { haptic.medium(); } catch { /* silent */ }
    // Close any open detail sheet so a stale detailCardId can't
    // re-open the sheet on the next hand if an id happens to repeat.
    setDetailCardId(null);
    onSelectCard?.(card);
  };

  if (!cards || cards.length === 0) {
    return <div className="text-zinc-600 text-xs text-center py-8">No moves available</div>;
  }

  const hand = cards.slice(0, 6);
  const detailCard = detailCardId ? hand.find(c => c.id === detailCardId) : null;

  return (
    <div
      role="group"
      aria-label="Move picker"
      // pt-1.5 / pl-1.5 keep the corner HelpCircle pills (positioned at
      // -top-2 -left-2 of each card) inside the rounded clip box. Without
      // this, the top-row and left-column help pills would be clipped by
      // overflow-hidden. 6px gives a 2px safety margin over the 8px
      // negative offset minus the grid's 4px pt-1 / px-1 padding.
      className="relative w-full select-none overflow-hidden rounded-xl pt-1.5 pl-1.5"
    >
      {/* Branded arena backdrop - preserved verbatim from the radial
          implementation. Two layers (image @ opacity 0.8 + vignette)
          so the visual identity stays identical when match UI passes
          backgroundImage. Tutorial and drills omit the prop and the
          picker stays neutral. */}
      {backgroundImage && (
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: `url(${backgroundImage})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              opacity: 0.8,
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at center, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.38) 60%, rgba(0,0,0,0.62) 100%)',
            }}
          />
        </>
      )}

      {/* 3x2 always-visible card grid. Tap commits, HelpCircle opens
          details. No hub, no fan, no drag - the grid is the only
          committal surface. */}
      <div className="relative grid grid-cols-3 gap-2 px-1 pb-3 pt-1" aria-label="Card hand">
        {hand.map((card) => {
          const avail = isAvailable(card);
          const theme = getCategoryTheme(card.category);
          const color = theme.color;

          return (
            <div key={card.id} className="relative min-h-[108px]">
              <button
                type="button"
                disabled={!avail}
                onClick={() => commit(card)}
                aria-label={`Play ${card.name}${avail ? '' : ' (unavailable)'}`}
                className="absolute inset-0 rounded-2xl disabled:opacity-40 active:scale-[0.94] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <CardFace card={card} color={color} theme={theme} />
              </button>

              {/* Help / details button. 44px hit target wrapping a
                  24px visual pill, positioned just outside the
                  card's top-left corner. stopPropagation prevents
                  this tap from also committing the card. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  try { haptic.light(); } catch { /* silent */ }
                  setDetailCardId(card.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Details for ${card.name}`}
                className="absolute -top-2 -left-2 z-10 h-11 w-11 flex items-center justify-center"
              >
                <span className="h-6 w-6 rounded-full bg-black/55 border border-white/25 text-white/85 flex items-center justify-center backdrop-blur-sm active:bg-black/75">
                  <HelpCircle className="h-3 w-3" strokeWidth={2.4} />
                </span>
              </button>
            </div>
          );
        })}
      </div>

      <CardDetailSheet
        card={detailCard}
        open={!!detailCard}
        onClose={() => setDetailCardId(null)}
      />
    </div>
  );
}

// Single card chip. Border color, gradient tint, and the small footer
// label all derive from getCategoryTheme(card.category).color - same
// color tokens already shipped by cardCategoryTheme.js. The category
// emoji (theme.icon) is intentionally NOT rendered because the 11px
// glyph aliased badly on iOS WebView; the colored border + footer
// label carry the category cue instead.
function CardFace({ card, color, theme }) {
  return (
    <div
      className="relative w-full h-full rounded-2xl border-2 px-2 py-1.5 text-left flex flex-col items-stretch"
      style={{
        background: `linear-gradient(145deg, ${color}5e, ${color}1f 68%, rgba(20,20,23,0.94))`,
        borderColor: `${color}cc`,
        boxShadow: `0 0 8px ${color}33, 0 4px 12px rgba(0,0,0,0.35)`,
        color: '#fff',
      }}
    >
      <div
        className="flex items-center justify-between leading-none"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.78)' }}
      >
        {/* Left spacer keeps the stamina pill optically centered with
            the help-circle button that overlaps this corner. */}
        <span aria-hidden="true" className="w-6" />
        {/* Stamina cost. The trailing glyph is the lightning bolt
            (same as the scoreboard + detail sheet); the prior 's'
            suffix read as a '5' at this size. */}
        <span className="text-[9px] font-bold tabular-nums uppercase tracking-widest opacity-85">
          {Math.round(card.staminaCost ?? 0)}<span aria-hidden="true" className="ml-0.5">⚡</span>
        </span>
      </div>

      <div
        className="flex-1 flex flex-col justify-center mt-0.5 gap-0.5 text-center"
        style={{ textShadow: '0 1px 2px rgba(0,0,0,0.78)' }}
      >
        <div className="text-[11.5px] font-black leading-[1.15] line-clamp-2">
          {card.name}
        </div>
        {card.description && (
          <div className="text-[9.5px] font-medium leading-[1.2] line-clamp-2 text-white/80">
            {card.description}
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center justify-center">
        <span
          className="text-[8.5px] uppercase tracking-widest font-semibold"
          style={{ color }}
        >
          {theme.label}
        </span>
      </div>
    </div>
  );
}
