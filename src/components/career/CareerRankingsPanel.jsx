// ─── CareerRankingsPanel ────────────────────────────────────────────────────
// Home-tab widget showing the player's conference / section / state rank
// at their weight class. Fed by career.rankings, which is updated each
// event by updateRankingsWeekly in careerState.recordEventResult.
//
// Visual grammar matches CareerDashboard's existing cards:
// rounded-xl + border-zinc-800 + bg-zinc-900/60.

import React from 'react';
import { formatWeight } from '../../lib/career/careerWeights.js';
import { getRankingLabels } from '../../lib/career/careerRankings.js';

function rankColor(rank) {
  if (rank <= 3) return 'text-amber-300';
  if (rank <= 10) return 'text-emerald-300';
  if (rank <= 25) return 'text-zinc-200';
  return 'text-zinc-400';
}

export default function CareerRankingsPanel({ rankings, wrestler, onOpenRankings }) {
  if (!rankings) return null;
  const { conference, section, state } = rankings;
  // Labels track the tier: HS uses State, college uses Collegiate, senior
  // uses World. The underlying data keys (conference/section/state) stay
  // stable - only the user-facing labels change.
  const labels = getRankingLabels(wrestler?.tier);

  const rows = [
    { label: labels.conference, value: conference },
    { label: labels.section, value: section },
    { label: labels.state, value: state },
  ];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-xs uppercase tracking-widest text-zinc-500">
          Rankings
        </div>
        <div className="flex items-baseline gap-2">
          <div className="text-[10px] text-zinc-500">
            {formatWeight(wrestler.weightClass, wrestler.tier)}
          </div>
          {onOpenRankings && (
            <button
              onClick={onOpenRankings}
              className="text-[10px] uppercase tracking-wider text-sky-400 hover:text-sky-300"
            >
              See all →
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rows.map(r => (
          <button
            key={r.label}
            onClick={onOpenRankings}
            className={`rounded border border-zinc-800 bg-zinc-950 py-2 text-center transition-colors ${
              onOpenRankings ? 'hover:border-sky-700 hover:bg-zinc-900 active:scale-95' : ''
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {r.label}
            </div>
            <div className={`text-lg font-bold ${rankColor(r.value)}`}>
              #{r.value}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
