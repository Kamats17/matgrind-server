// ─── CareerTrophyCase ───────────────────────────────────────────────────────
// CSS-only trophy case overview. Trophies arranged on shelves grouped by
// season; horizontal swipe between seasons. Tapping a trophy lazy-loads the
// 3D detail modal so the three.js bundle isn't paid until the user opens it.

import React, { Suspense, lazy, useMemo, useState } from 'react';
import NavBar from '../ui/NavBar.jsx';
import { groupTrophiesBySeason, trophyColors, trophyTypeLabel, trophyIcon, PRESTIGE_BADGES } from '../../lib/career/careerTrophies.js';

const CareerTrophy3DDetail = lazy(() => import('./CareerTrophy3DDetail.jsx'));

function TrophyShape({ trophy, onTap }) {
  const c = trophyColors(trophy);
  const icon = trophyIcon(trophy);
  const isCup = icon === 'cup';
  const isMedal = icon === 'medal';

  return (
    <button
      onClick={onTap}
      className="flex flex-col items-center gap-1 group focus:outline-none"
    >
      <div
        className="relative"
        style={{
          width: 64,
          height: 80,
          perspective: '600px',
        }}
      >
        {/* The 'cup' shape: bowl + stem + base */}
        {isCup && (
          <div
            className="absolute inset-0 transition-transform group-active:scale-95"
            style={{
              transform: 'rotateY(-12deg) rotateX(2deg)',
              filter: `drop-shadow(0 6px 18px ${c.glow})`,
            }}
          >
            {/* Bowl */}
            <div
              style={{
                position: 'absolute', top: 0, left: 8, width: 48, height: 36,
                borderRadius: '50% 50% 30% 30% / 60% 60% 40% 40%',
                background: `linear-gradient(135deg, ${c.primary} 0%, ${c.secondary} 100%)`,
                boxShadow: `inset -4px -2px 6px rgba(0,0,0,0.35), inset 3px 2px 5px rgba(255,255,255,0.45)`,
              }}
            />
            {/* Handles */}
            <div style={{ position: 'absolute', top: 6, left: 0, width: 10, height: 22, borderRadius: '50%', border: `3px solid ${c.primary}`, borderRight: 'none' }} />
            <div style={{ position: 'absolute', top: 6, right: 0, width: 10, height: 22, borderRadius: '50%', border: `3px solid ${c.primary}`, borderLeft: 'none' }} />
            {/* Stem */}
            <div style={{ position: 'absolute', top: 36, left: 26, width: 12, height: 18, background: `linear-gradient(180deg, ${c.secondary}, ${c.primary})` }} />
            {/* Base */}
            <div style={{ position: 'absolute', top: 54, left: 14, width: 36, height: 12, background: `linear-gradient(180deg, ${c.primary}, ${c.secondary})`, borderRadius: 3, boxShadow: `0 2px 4px rgba(0,0,0,0.5)` }} />
            {/* Plate */}
            <div style={{ position: 'absolute', top: 66, left: 20, width: 24, height: 4, background: c.secondary, borderRadius: 1 }} />
          </div>
        )}
        {/* The 'medal' shape: round disc on a ribbon */}
        {isMedal && (
          <div
            className="absolute inset-0 transition-transform group-active:scale-95"
            style={{
              transform: 'rotateY(-8deg)',
              filter: `drop-shadow(0 6px 14px ${c.glow})`,
            }}
          >
            {/* Ribbon */}
            <div style={{ position: 'absolute', top: 0, left: 22, width: 8, height: 32, background: '#1d4ed8', clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 90%, 0 100%)' }} />
            <div style={{ position: 'absolute', top: 0, right: 22, width: 8, height: 32, background: '#dc2626', clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 90%, 0 100%)' }} />
            {/* Disc */}
            <div style={{
              position: 'absolute', top: 20, left: 12, width: 40, height: 40,
              borderRadius: '50%',
              background: `radial-gradient(circle at 35% 30%, ${c.primary} 0%, ${c.secondary} 100%)`,
              boxShadow: `inset -3px -3px 6px rgba(0,0,0,0.4), inset 3px 3px 6px rgba(255,255,255,0.4)`,
            }} />
          </div>
        )}
        {/* The 'plaque' shape: rectangular slab */}
        {!isCup && !isMedal && (
          <div
            className="absolute inset-0 transition-transform group-active:scale-95"
            style={{
              transform: 'rotateX(8deg)',
              filter: `drop-shadow(0 6px 14px ${c.glow})`,
            }}
          >
            <div style={{
              position: 'absolute', top: 14, left: 6, width: 52, height: 50,
              background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
              border: `2px solid ${c.secondary}`,
              borderRadius: 4,
              boxShadow: `inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -2px 4px rgba(0,0,0,0.4)`,
            }} />
            <div style={{
              position: 'absolute', top: 24, left: 12, width: 40, height: 30,
              background: 'rgba(0,0,0,0.45)',
              borderRadius: 2,
            }} />
          </div>
        )}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-400 max-w-[90px] truncate text-center">
        {trophyTypeLabel(trophy)}
      </div>
    </button>
  );
}

function Shelf({ season, trophies, onTapTrophy }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-2 px-1">
        <div className="text-xs uppercase tracking-widest text-zinc-500">
          Season {season}
        </div>
        <div className="text-[10px] text-zinc-600">{trophies.length} trophy{trophies.length === 1 ? '' : 's'}</div>
      </div>
      <div
        className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-950/80 p-3 relative overflow-hidden"
        style={{
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), inset 0 -1px 0 rgba(0,0,0,0.5)',
        }}
      >
        {/* Glass reflection */}
        <div
          className="absolute inset-x-0 top-0 h-8 pointer-events-none"
          style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 100%)' }}
        />
        <div className="flex flex-wrap gap-3 justify-around items-end relative">
          {trophies.map((t, i) => (
            <TrophyShape key={t.id || i} trophy={t} onTap={() => onTapTrophy?.(t)} />
          ))}
        </div>
        {/* Shelf bar */}
        <div className="mt-2 h-1.5 rounded bg-gradient-to-b from-amber-900/40 to-amber-950/60 border-t border-amber-800/30" />
      </div>
    </div>
  );
}

// Career Depth Pass v1 (Step 5) - Prestige badge grid. Locked badges
// render at low opacity with their description; unlocked badges show the
// icon in full color with season-year + tier metadata.
function PrestigeBadgeGrid({ earned }) {
  const earnedById = new Map((Array.isArray(earned) ? earned : []).map(b => [b.id, b]));
  const allBadges = Object.values(PRESTIGE_BADGES);
  return (
    <div className="mb-6">
      <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2 px-1">
        Prestige Badges
      </div>
      <div className="text-[10px] text-zinc-600 mb-3 px-1">
        Earned from new seasons after Career Depth Pass v1.
      </div>
      <div className="grid grid-cols-2 gap-3">
        {allBadges.map(def => {
          const got = earnedById.get(def.id);
          return (
            <div
              key={def.id}
              className={[
                'rounded-xl border p-3',
                got
                  ? 'border-amber-700/60 bg-amber-950/30'
                  : 'border-zinc-800 bg-zinc-900/40 opacity-60',
              ].join(' ')}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl" aria-hidden="true">{def.icon}</span>
                <span className={got ? 'text-amber-200 font-black text-sm' : 'text-zinc-400 font-bold text-sm'}>
                  {def.name}
                </span>
              </div>
              <div className="text-[10px] text-zinc-400 leading-snug">{def.description}</div>
              {got && (
                <div className="text-[10px] text-amber-400/80 mt-1 font-semibold">
                  Season {got.seasonYear} &middot; {got.tier?.toUpperCase()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CareerTrophyCase({ trophies, careerName, onBack, prestigeBadges = [] }) {
  const grouped = useMemo(() => groupTrophiesBySeason(trophies || []), [trophies]);
  const [active, setActive] = useState(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Trophy Case" onBack={onBack} />
      <div className="flex-1 px-4 py-4 max-w-md mx-auto w-full">
        <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
          {careerName || 'Career'}
        </div>
        <div className="text-sm text-zinc-300 mb-4">
          {trophies?.length || 0} trophy{(trophies?.length || 0) === 1 ? '' : 's'} earned
        </div>

        <PrestigeBadgeGrid earned={prestigeBadges} />

        {grouped.length === 0 && (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-8 text-center">
            <div className="text-zinc-500 text-sm mb-1">No trophies yet</div>
            <div className="text-zinc-600 text-xs">Win a tournament or championship to start your case.</div>
          </div>
        )}

        {grouped.map(g => (
          <Shelf
            key={g.season}
            season={g.season}
            trophies={g.trophies}
            onTapTrophy={setActive}
          />
        ))}
      </div>

      {active && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-zinc-950/95 flex items-center justify-center">
            <div className="text-zinc-400 text-sm">Loading 3D view…</div>
          </div>
        }>
          <CareerTrophy3DDetail trophy={active} onClose={() => setActive(null)} />
        </Suspense>
      )}
    </div>
  );
}
