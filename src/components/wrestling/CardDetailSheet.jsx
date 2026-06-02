// src/components/wrestling/CardDetailSheet.jsx
//
// Single-face info surface for a wrestling card. Reached via the
// HelpCircle button on each grid card in RadialCardPicker. The sheet
// shows everything about a card in one view - no flip, no `?` toggle,
// no duplicated fields. BottomSheet handles overflow if the content
// is taller than the viewport.
//
// Sections (top to bottom):
//   - category stripe (theme.color)
//   - header row: category pill (left) + stamina (right)
//   - card name (large)
//   - full description
//   - flavor (italic, optional)
//   - stats row (Power / Pin Threat / Chain) - only rendered when at
//     least one applies; stamina is intentionally omitted here because
//     it already lives in the header row
//   - Requires chips (setupRequired)
//   - Strong Against chips
//   - Weak Against chips (when consumer passes `weakAgainst`)
//   - Counters chips
//   - footer: Close + optional Play Move

import BottomSheet from '../ui/BottomSheet';
import { CARDS } from '../../lib/wrestlingCards';
import { haptic } from '../../lib/haptics';
import { getCategoryTheme } from '../../lib/cardCategoryTheme.js';

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

/**
 * @param {{
 *   card: any,
 *   weakAgainst?: any[],
 *   open?: boolean,
 *   onClose: () => void,
 *   onPlay?: () => void,
 *   canPlay?: boolean,
 * }} props
 */
export default function CardDetailSheet({ card, weakAgainst = [], open = true, onClose, onPlay, canPlay = true }) {
  if (!card) return null;
  const theme = getCategoryTheme(card.category);
  const label = theme.label;
  const isBranch = card.id?.startsWith('fhl_');

  const handlePlay = () => {
    try { haptic.light(); } catch { /* silent */ }
    onPlay?.();
    onClose?.();
  };

  const showStatsRow = card.basePower != null || card.scoreEffect?.pinChance || isBranch;

  return (
    <BottomSheet open={open} onClose={onClose} title={label} className="!p-0">
      <div className="-mx-5 -mb-6">
        {/* Category stripe */}
        <div className="h-1.5 w-full" style={{ background: theme.color }} />

        {/* Card body - single face, no flip */}
        <div className="px-5 pt-4 pb-3">
          {/* Header row: category pill (left) + stamina (right) */}
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em] px-2 py-0.5 rounded-full ring-1"
              style={{
                color: theme.color,
                borderColor: `${theme.color}88`,
                background: `${theme.color}14`,
              }}
            >
              {theme.icon ? <span aria-hidden>{theme.icon}</span> : null}
              {isBranch ? 'FHL · CHAIN' : label}
            </span>
            <div className="flex-1" />
            <span className="text-yellow-400 text-sm font-mono font-bold shrink-0">
              {card.staminaCost}⚡
            </span>
          </div>

          {/* Name */}
          <div className="text-white text-2xl font-black uppercase tracking-wide leading-tight mb-3">
            {card.name}
          </div>

          {/* Full description */}
          <div className="text-zinc-300 text-base leading-snug mb-2">
            {card.description}
          </div>

          {/* Flavor */}
          {card.flavor && (
            <div className="text-zinc-500 text-xs italic mb-3">"{card.flavor}"</div>
          )}

          {/* Stats row - stamina is in the header, so this only renders
              when Power / Pin Threat / Chain apply. */}
          {showStatsRow && (
            <div className="flex items-center gap-4 border-t border-zinc-800 pt-2 mb-2 text-xs">
              {card.basePower != null && (
                <div>
                  <div className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold">Power</div>
                  <div className="text-white font-mono font-bold">{card.basePower}</div>
                </div>
              )}
              {card.scoreEffect?.pinChance && (
                <div>
                  <div className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold">Pin Threat</div>
                  <div className="text-red-400 font-bold">Yes</div>
                </div>
              )}
              {isBranch && (
                <div>
                  <div className="text-zinc-600 uppercase tracking-widest text-[9px] font-bold">Chain</div>
                  <div className="text-purple-400 font-bold">FHL</div>
                </div>
              )}
            </div>
          )}

          {card.setupRequired?.length > 0 && (
            <div className="mb-2">
              <div className="text-amber-400 text-[10px] font-black uppercase tracking-widest mb-1">Requires</div>
              <div className="flex flex-wrap gap-1">
                {card.setupRequired.map(r => (
                  <span key={r} className="text-[11px] bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded">
                    {CONDITION_LABELS[r] || r.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {card.strongAgainst?.length > 0 && (
            <div className="mb-2">
              <div className="text-emerald-400 text-[10px] font-black uppercase tracking-widest mb-1">Strong Against</div>
              <div className="flex flex-wrap gap-1">
                {card.strongAgainst.map(id => (
                  <span key={id} className="text-[11px] bg-emerald-900/40 text-emerald-300 px-2 py-0.5 rounded">
                    {CARDS[id]?.name || id.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {weakAgainst.length > 0 && (
            <div className="mb-2">
              <div className="text-red-400 text-[10px] font-black uppercase tracking-widest mb-1">Weak Against</div>
              <div className="flex flex-wrap gap-1">
                {weakAgainst.map(id => (
                  <span key={id} className="text-[11px] bg-red-900/40 text-red-300 px-2 py-0.5 rounded">
                    {CARDS[id]?.name || id.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}

          {card.counters?.length > 0 && (
            <div className="mb-1">
              <div className="text-sky-400 text-[10px] font-black uppercase tracking-widest mb-1">Counters</div>
              <div className="flex flex-wrap gap-1">
                {card.counters.map(id => (
                  <span key={id} className="text-[11px] bg-sky-900/40 text-sky-300 px-2 py-0.5 rounded">
                    {CARDS[id]?.name || id.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex gap-2 px-5 pb-6 pt-2 border-t border-zinc-800">
          <button
            onClick={() => { try { haptic.light(); } catch { /* silent */ } onClose?.(); }}
            className="flex-1 py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] text-zinc-200 text-sm font-bold transition-all"
          >
            Close
          </button>
          {onPlay && canPlay && (
            <button
              onClick={handlePlay}
              className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-sm font-black uppercase tracking-wider transition-all"
            >
              Play Move
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
