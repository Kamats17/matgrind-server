// src/components/training/MovesCountersGlossary.jsx
//
// Browse-every-move screen for the Training tab. Lists CARDS grouped by
// category, with a search box and per-row expansion that mirrors the
// info shown in CardDetailSheet (counters, strong-against, setups,
// stamina, score effect, mini-game type).
//
// No mutations - pure read-only browser.

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import NavBar from '../ui/NavBar';
import { CARDS } from '../../lib/wrestlingCards.js';
import { CATEGORY_THEME, CATEGORY_ORDER, getCategoryTheme } from '../../lib/cardCategoryTheme.js';
import { getMechanicForCard, MECHANIC_TYPES } from '../../lib/cardArchetypeMechanics.js';
import { haptic } from '../../lib/haptics';

const MECHANIC_LABEL = {
  [MECHANIC_TYPES.CHARGE]:   { label: 'Charge',   color: 'text-orange-300', bg: 'bg-orange-900/30 border-orange-800/40' },
  [MECHANIC_TYPES.REACTION]: { label: 'Reaction', color: 'text-sky-300',    bg: 'bg-sky-900/30 border-sky-800/40' },
  [MECHANIC_TYPES.TRACE]:    { label: 'Trace',    color: 'text-emerald-300', bg: 'bg-emerald-900/30 border-emerald-800/40' },
  [MECHANIC_TYPES.BURST]:    { label: 'Burst',    color: 'text-purple-300', bg: 'bg-purple-900/30 border-purple-800/40' },
  [MECHANIC_TYPES.NONE]:     { label: 'No mini-game', color: 'text-zinc-400', bg: 'bg-zinc-800/40 border-zinc-700/40' },
};

const CONDITION_LABELS = {
  front_headlock_control: 'Front Headlock',
  front_headlock_trapped: 'FHL Trapped',
  control_established:    'Control',
  broken_down:            'Broken Down',
  good_base:              'Good Base',
  hand_fighting:          'Hand Fighting',
  hand_fighting_control:  'Hand Fighting',
  recovering:             'Recovering',
  inside_position:        'Inside Position',
  leg_attack_secured:     'Leg Secured',
  leg_attack_trapped:     'Leg Trapped',
  scramble:               'Scramble!',
  tie_up:                 'Tie-Up',
};

function condLabel(c) {
  return CONDITION_LABELS[c] || c.replace(/_/g, ' ');
}

function cardName(id) {
  return CARDS[id]?.name || id.replace(/_/g, ' ');
}

function matchesSearch(card, q) {
  if (!q) return true;
  const t = q.toLowerCase();
  if (card.name.toLowerCase().includes(t)) return true;
  if (card.description?.toLowerCase().includes(t)) return true;
  if ((card.counters || []).some(id => cardName(id).toLowerCase().includes(t))) return true;
  if ((card.strongAgainst || []).some(id => cardName(id).toLowerCase().includes(t))) return true;
  return false;
}

export default function MovesCountersGlossary({ onBack }) {
  const [search, setSearch] = useState('');
  const [openCategories, setOpenCategories] = useState(() => new Set());
  const [expandedCardId, setExpandedCardId] = useState(null);

  const groups = useMemo(() => {
    const out = {};
    for (const cat of CATEGORY_ORDER) out[cat] = [];
    for (const card of Object.values(CARDS)) {
      if (!out[card.category]) out[card.category] = [];
      out[card.category].push(card);
    }
    for (const cat of Object.keys(out)) {
      out[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }, []);

  const trimmedSearch = search.trim();

  // Filtered groups + which categories should be open right now.
  const filteredGroups = useMemo(() => {
    const out = {};
    for (const [cat, cards] of Object.entries(groups)) {
      const filtered = cards.filter(c => matchesSearch(c, trimmedSearch));
      if (filtered.length > 0) out[cat] = filtered;
    }
    return out;
  }, [groups, trimmedSearch]);

  const effectiveOpen = useMemo(() => {
    if (!trimmedSearch) return openCategories;
    // Any category with matches is auto-opened during a search so the user
    // doesn't have to expand each one to see results.
    return new Set(Object.keys(filteredGroups));
  }, [openCategories, trimmedSearch, filteredGroups]);

  const toggleCategory = (cat) => {
    if (trimmedSearch) return; // ignore taps during search; auto-open governs
    try { haptic.light(); } catch { /* silent */ }
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const toggleCard = (id) => {
    try { haptic.light(); } catch { /* silent */ }
    setExpandedCardId(prev => (prev === id ? null : id));
  };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Moves & Counters" onBack={onBack} />

      {/* Search */}
      <div className="px-4 pt-3 pb-2 max-w-md md:max-w-2xl mx-auto w-full">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            inputMode="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search moves, counters, descriptions…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-yellow-500/50"
          />
        </div>
        <p className="text-zinc-500 text-[11px] mt-2 leading-snug">
          Tap a category to expand. Tap any move to see its counters, what it's strong against, setup needs, and which mini-game it triggers.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 max-w-md md:max-w-2xl mx-auto w-full space-y-2">
        {CATEGORY_ORDER.map(cat => {
          const cards = filteredGroups[cat];
          if (!cards || cards.length === 0) return null;
          const theme = CATEGORY_THEME[cat] || getCategoryTheme(cat);
          const isOpen = effectiveOpen.has(cat);
          return (
            <div key={cat} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-zinc-800/40 transition-colors"
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                  style={{ background: theme.soft, color: theme.color }}
                >
                  {theme.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-black uppercase tracking-wide ${theme.textClass}`}>
                    {theme.label}
                  </div>
                  <div className="text-zinc-500 text-[11px]">
                    {cards.length} move{cards.length === 1 ? '' : 's'}
                  </div>
                </div>
                {isOpen
                  ? <ChevronDown size={18} className="text-zinc-500" />
                  : <ChevronRight size={18} className="text-zinc-500" />}
              </button>

              {isOpen && (
                <div className="border-t border-zinc-800">
                  {cards.map(card => (
                    <CardRow
                      key={card.id}
                      card={card}
                      expanded={expandedCardId === card.id}
                      onToggle={() => toggleCard(card.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {Object.keys(filteredGroups).length === 0 && (
          <div className="text-center text-zinc-500 text-sm py-12">
            No moves match "{trimmedSearch}".
          </div>
        )}
      </div>
    </div>
  );
}

function CardRow({ card, expanded, onToggle }) {
  const theme = getCategoryTheme(card.category);
  const mech = MECHANIC_LABEL[getMechanicForCard(card)] || MECHANIC_LABEL[MECHANIC_TYPES.NONE];
  const scoreEffect = card.scoreEffect?.type;

  return (
    <div className="border-b border-zinc-800/60 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-zinc-800/40 transition-colors"
      >
        <div className="w-1 self-stretch rounded-full" style={{ background: theme.color }} />
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-bold truncate">{card.name}</div>
          <div className="text-zinc-500 text-[11px] truncate">{card.description}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-white font-mono text-xs font-bold">{card.basePower ?? '-'}<span className="text-zinc-600">PWR</span></div>
          <div className="text-yellow-400 font-mono text-[10px]">{card.staminaCost}⚡</div>
        </div>
        {expanded
          ? <ChevronDown size={16} className="text-zinc-600 shrink-0" />
          : <ChevronRight size={16} className="text-zinc-600 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 bg-zinc-950/60">
          {/* Stat strip */}
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className={`px-2 py-0.5 rounded border ${mech.bg} ${mech.color} font-bold`}>
              {mech.label}
            </span>
            {scoreEffect && (
              <span className="px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300 font-bold uppercase">
                {scoreEffect.replace(/_/g, ' ')}
              </span>
            )}
            {card.scoreEffect?.pinChance && (
              <span className="px-2 py-0.5 rounded border border-red-800 bg-red-950/40 text-red-300 font-bold">
                Pin Threat
              </span>
            )}
          </div>

          {card.flavor && (
            <div className="text-zinc-500 text-xs italic">"{card.flavor}"</div>
          )}

          {card.setupRequired?.length > 0 && (
            <Section label="Requires" tone="amber">
              {card.setupRequired.map(r => (
                <Chip key={r} tone="amber">{condLabel(r)}</Chip>
              ))}
            </Section>
          )}

          {card.strongAgainst?.length > 0 && (
            <Section label="Strong Against" tone="emerald">
              {card.strongAgainst.map(id => (
                <Chip key={id} tone="emerald">{cardName(id)}</Chip>
              ))}
            </Section>
          )}

          {card.counters?.length > 0 && (
            <Section label="Countered By" tone="sky">
              {card.counters.map(id => (
                <Chip key={id} tone="sky">{cardName(id)}</Chip>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

const TONE = {
  amber:   { label: 'text-amber-500',   chip: 'bg-amber-900/40 text-amber-300' },
  emerald: { label: 'text-emerald-500', chip: 'bg-emerald-900/40 text-emerald-300' },
  sky:     { label: 'text-sky-500',     chip: 'bg-sky-900/40 text-sky-300' },
};

function Section({ label, tone, children }) {
  const t = TONE[tone];
  return (
    <div>
      <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${t.label}`}>{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Chip({ tone, children }) {
  const t = TONE[tone];
  return <span className={`text-[11px] px-2 py-0.5 rounded ${t.chip}`}>{children}</span>;
}
