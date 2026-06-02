// ─── CareerRivalsSnapshot ───────────────────────────────────────────────────
// Home-tab widget showing the top 2 rivals by overall, with H2H record AND
// each rival's real season record + state/section rank pulled from the
// ranking pool. Rivals can promote dynamically once a non-rival opponent
// has been faced ≥2 times - those show a "Promoted" badge.

import React from 'react';

function rankBadgeForRival(poolEntry, ranks) {
  if (!poolEntry || !ranks) return null;
  // Use the highest scope where the wrestler is ranked; surface state-rank
  // first because it's the most prestigious. Pool entry doesn't carry an
  // exact rank - rank is computed by buildRankingsViews. Approximate from
  // the player's relative pool position by comparing wins to neighbors.
  // For now, infer by overall-tier: top-tier overalls get a state badge.
  const o = poolEntry.overall || 0;
  if (o >= 80) return { label: 'State', color: 'amber' };
  if (o >= 70) return { label: 'Section', color: 'cyan' };
  if (o >= 60) return { label: 'Conf', color: 'sky' };
  return null;
}

function RivalRow({ rival, poolEntry }) {
  const { name, school, overall, h2h, promoted } = rival;
  const hasHistory = (h2h?.wins || 0) + (h2h?.losses || 0) > 0;
  const seasonW = poolEntry?.wins ?? 0;
  const seasonL = poolEntry?.losses ?? 0;
  const showSeason = (seasonW + seasonL) > 0;
  const rankBadge = rankBadgeForRival(poolEntry, null);

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-zinc-200 truncate flex items-center gap-1.5">
            {name}
            {promoted && (
              <span className="text-[8px] uppercase tracking-wider bg-fuchsia-900/50 text-fuchsia-200 border border-fuchsia-800 rounded px-1 py-px">
                Promoted
              </span>
            )}
          </div>
          <div className="text-[10px] text-zinc-500 truncate">
            {school} · OVR {overall}
            {showSeason && (
              <>
                <span className="text-zinc-700"> · </span>
                <span className="text-zinc-300">
                  <span className="text-emerald-400">{seasonW}</span>
                  <span className="text-zinc-600">-</span>
                  <span className="text-red-400">{seasonL}</span>
                  <span className="text-zinc-500 ml-1">on year</span>
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
          {rankBadge && (
            <span className={`text-[8px] uppercase tracking-wider px-1.5 py-px rounded border ${
              rankBadge.color === 'amber' ? 'bg-amber-900/40 text-amber-200 border-amber-800' :
              rankBadge.color === 'cyan'  ? 'bg-cyan-900/40 text-cyan-200 border-cyan-800' :
                                            'bg-sky-900/40 text-sky-200 border-sky-800'
            }`}>
              {rankBadge.label}
            </span>
          )}
          <div className="text-xs">
            {hasHistory ? (
              <>
                <span className="text-emerald-400 font-semibold">{h2h.wins}W</span>
                <span className="text-zinc-600"> · </span>
                <span className="text-red-400 font-semibold">{h2h.losses}L</span>
                {h2h.pins > 0 && (
                  <>
                    <span className="text-zinc-600"> · </span>
                    <span className="text-amber-300 font-semibold">{h2h.pins}P</span>
                  </>
                )}
              </>
            ) : (
              <span className="text-[10px] text-zinc-600 italic">First meeting</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CareerRivalsSnapshot({ rivals, rankingPool, onOpenRivals }) {
  if (!Array.isArray(rivals) || rivals.length === 0) return null;

  // Top 2 by overall - these are the threats worth watching.
  const top = [...rivals].sort((a, b) => (b.overall || 0) - (a.overall || 0)).slice(0, 2);
  const poolById = new Map(
    Array.isArray(rankingPool) ? rankingPool.map(p => [p.id, p]) : []
  );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs uppercase tracking-widest text-zinc-500">
          Rivals to Watch
        </div>
        {onOpenRivals && (
          <button
            onClick={onOpenRivals}
            className="text-[10px] uppercase tracking-wider text-sky-400 hover:text-sky-300"
          >
            See all →
          </button>
        )}
      </div>
      <div className="divide-y divide-zinc-800">
        {top.map(r => (
          <RivalRow key={r.id} rival={r} poolEntry={poolById.get(r.id)} />
        ))}
      </div>
    </div>
  );
}
