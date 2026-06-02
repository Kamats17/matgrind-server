// ─── CareerRankingsScreen ───────────────────────────────────────────────────
// Full-screen rankings board. Three tabs - Conference (top 25), Section
// (top 50), State (top 100). Each row shows rank, name, school, overall,
// and season W-L record. The player's own row is highlighted and uses
// their real season record; all other rows come from the weekly sim on
// career.rankingPool (scope-tagged: conference | section | state).

import React, { useMemo, useState } from 'react';
import NavBar from '../ui/NavBar.jsx';
import { buildRankingsViews, RANKED_THRESHOLD, getRankingLabels } from '../../lib/career/careerRankings.js';
import { formatWeight } from '../../lib/career/careerWeights.js';

// Tier-aware scope labels. The IDs stay stable so buildRankingsViews keeps
// working off conference/section/state keys; only the tab labels change.
function buildScopes(tier) {
  const l = getRankingLabels(tier);
  return [
    { id: 'conference', label: l.conference, cap: RANKED_THRESHOLD.conference },
    { id: 'section',    label: l.section,    cap: RANKED_THRESHOLD.section },
    { id: 'state',      label: l.state,      cap: RANKED_THRESHOLD.state },
  ];
}

function rankColor(rank) {
  if (rank <= 3) return 'text-amber-300';
  if (rank <= 10) return 'text-emerald-300';
  if (rank <= 25) return 'text-zinc-200';
  return 'text-zinc-500';
}

function playerOverall(wrestler) {
  const s = wrestler?.stats || {};
  const { str = 55, spd = 55, tec = 55, end = 55, grt = 55 } = s;
  return Math.round((str + spd + tec + end + grt) / 5);
}

export default function CareerRankingsScreen({ career, onBack }) {
  const [scope, setScope] = useState('conference');

  const views = useMemo(() => {
    if (!career) return { conference: [], section: [], state: [] };
    const player = {
      name: career.wrestler?.name || 'You',
      school: career.wrestler?.school || 'Your School',
      overall: playerOverall(career.wrestler),
      wins: career.record?.seasonWins || 0,
      losses: career.record?.seasonLosses || 0,
    };
    return buildRankingsViews(career.rankingPool || [], { player });
  }, [career]);

  if (!career) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-zinc-400">No career loaded.</div>
      </div>
    );
  }

  const scopes = buildScopes(career.wrestler?.tier);
  const fullList = views[scope] || [];
  const cap = scopes.find(s => s.id === scope)?.cap || fullList.length;
  // Cap at the ranked-threshold so the leaderboard only shows wrestlers who
  // actually deserve a numeric rank. Always include the player row even if
  // they're below the cutoff - they need to see their own position.
  const ranked = fullList.filter(r => r.rank <= cap);
  const playerInRanked = ranked.some(r => r.isPlayer);
  const playerRow = !playerInRanked ? fullList.find(r => r.isPlayer) : null;
  const list = playerRow ? [...ranked, playerRow] : ranked;
  const unrankedCount = Math.max(0, fullList.length - ranked.length - (playerRow ? 1 : 0));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Rankings" onBack={onBack} />

      <div className="px-4 pt-3 max-w-md mx-auto w-full">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 mb-3">
          <div className="flex items-baseline justify-between">
            <div className="text-xs uppercase tracking-widest text-zinc-500">
              {formatWeight(career.wrestler.weightClass, career.wrestler.tier)}
            </div>
            <div className="text-[10px] text-zinc-500">
              Season {career.schedule?.seasonYear ?? 1}
            </div>
          </div>
          <div className="mt-1 text-sm text-zinc-300">
            Top {cap}
            {unrankedCount > 0 && (
              <span className="text-zinc-500 text-xs ml-2">+ {unrankedCount} unranked</span>
            )}
          </div>
        </div>

        {/* Scope tabs */}
        <div className="flex gap-1 border-b border-zinc-800 mb-3">
          {scopes.map(s => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={`py-2 px-3 text-xs font-semibold uppercase tracking-wider flex-1 border-b-2 transition-colors ${
                scope === s.id
                  ? 'border-emerald-500 text-emerald-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {s.label}
              <span className="block text-[9px] text-zinc-600 normal-case tracking-normal font-normal">
                top {s.cap}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pb-6 max-w-md mx-auto w-full">
        <div className="space-y-1">
          {list.length === 0 && (
            <div className="text-zinc-500 text-sm text-center py-8">
              No rankings data yet - play an event to generate standings.
            </div>
          )}
          {list.map(row => {
            const gp = (row.wins || 0) + (row.losses || 0);
            return (
              <div
                key={row.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                  row.isPlayer
                    ? 'bg-emerald-950/40 border-emerald-700/60'
                    : 'bg-zinc-900/40 border-zinc-800'
                }`}
              >
                <div className={`font-black w-10 text-right tabular-nums ${rankColor(row.rank)}`}>
                  #{row.rank}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`truncate ${row.isPlayer ? 'text-emerald-200 font-bold' : 'text-zinc-200'}`}>
                    {row.name}
                    {row.isPlayer && (
                      <span className="ml-2 text-[9px] text-emerald-400 uppercase tracking-wider">You</span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    {row.school} · OVR {row.overall}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`text-sm font-bold tabular-nums ${
                    row.isPlayer ? 'text-emerald-300' : 'text-zinc-300'
                  }`}>
                    <span className="text-emerald-400">{row.wins || 0}</span>
                    <span className="text-zinc-600">-</span>
                    <span className="text-red-400">{row.losses || 0}</span>
                  </div>
                  {gp > 0 && (
                    <div className="text-[9px] text-zinc-500 tabular-nums">
                      {Math.round(((row.wins || 0) / gp) * 100)}%
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {unrankedCount > 0 && (
          <div className="mt-3 text-center text-[11px] text-zinc-500 uppercase tracking-wider">
            + {unrankedCount} unranked at this weight class
          </div>
        )}

        {list.length > 0 && (
          <div className="mt-4 text-[10px] text-zinc-600 text-center leading-relaxed">
            Records update each week. The ~125-wrestler pool covers your
            conference, section, and state - your rank is computed exactly,
            not extrapolated.
          </div>
        )}
      </div>
    </div>
  );
}
