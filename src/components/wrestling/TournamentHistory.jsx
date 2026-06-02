import React from 'react';
import { loadTournamentHistory, getTournamentStats } from '../../lib/tournamentHistory.js';
import NavBar from '../ui/NavBar';

// Placement labels cover 1 / 2 / 3 / 5 / 9 / 17 - the values emitted by
// computePlacement in tournamentScoring.js for 8/16/24/32 brackets.
const PLACEMENT_LABELS = {
  1: 'CHAMPION',
  2: 'Finals',
  3: 'Semifinals',
  5: 'Quarterfinals',
  9: 'Round of 16',
  17: 'Round of 32',
};
const PLACEMENT_COLORS = {
  1: 'text-yellow-400',
  2: 'text-zinc-200',      // silver
  3: 'text-amber-600',     // bronze
  5: 'text-zinc-400',
  9: 'text-zinc-500',
  17: 'text-zinc-600',
};
const STYLE_LABELS = { folkstyle: 'Folk', freestyle: 'Free', greco: 'Greco' };

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {object} [props.profile]       - signed-in wrestler profile; used
 *   for the Firestore-backed stats (points, streak). Falls back to local
 *   history derivation when null.
 * @param {() => void} [props.onLeaderboard] - optional link to global leaderboard
 */
export default function TournamentHistory({ onBack, profile = null, onLeaderboard }) {
  const history = loadTournamentHistory();
  const stats = getTournamentStats(profile);

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Tournaments" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md md:max-w-2xl mx-auto w-full">

        {/* Header logo */}
        <div className="flex justify-center mb-4">
          <img src="/icon-tournament-history-source.png" className="w-48 h-48 object-contain" alt="Tournament History" draggable={false} />
        </div>

        {/* Stats summary */}
        {stats && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
            <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">Career Stats</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-yellow-400 text-2xl font-black">{stats.wins}</div>
                <div className="text-zinc-500 text-xs">Titles</div>
              </div>
              <div>
                <div className="text-white text-2xl font-black">{stats.total}</div>
                <div className="text-zinc-500 text-xs">Entered</div>
              </div>
              <div>
                <div className="text-emerald-400 text-2xl font-black">{stats.winRate}%</div>
                <div className="text-zinc-500 text-xs">Win Rate</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3 text-center mt-3 pt-3 border-t border-zinc-800">
              <div>
                <div className="text-sky-400 text-lg font-bold">{stats.points}</div>
                <div className="text-zinc-600 text-xs">Points</div>
              </div>
              <div>
                <div className="text-white text-lg font-bold">{stats.totalMatchWins}</div>
                <div className="text-zinc-600 text-xs">Match W</div>
              </div>
              <div>
                <div className="text-zinc-400 text-lg font-bold">{stats.totalMatchLosses}</div>
                <div className="text-zinc-600 text-xs">Match L</div>
              </div>
              <div>
                <div className="text-yellow-400 text-lg font-bold">{stats.bestStreak}</div>
                <div className="text-zinc-600 text-xs">Streak</div>
              </div>
            </div>
            {onLeaderboard && (
              <button
                onClick={onLeaderboard}
                className="mt-3 w-full text-center text-sky-400 text-xs font-black uppercase tracking-widest py-2 border border-sky-900/40 rounded-lg hover:bg-sky-950/30 transition"
              >
                🏅 View Global Tournament Leaderboard
              </button>
            )}
          </div>
        )}

        {/* History list */}
        {history.length === 0 ? (
          <div className="text-center text-zinc-600 text-sm mt-8">
            No tournaments completed yet. Enter a tournament from the main menu!
          </div>
        ) : (
          <div className="space-y-2">
            {history.map(t => (
              <div key={t.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-sm font-black ${PLACEMENT_COLORS[t.placement] || 'text-zinc-500'}`}>
                    {t.placement === 1 ? '🏆 ' : ''}{PLACEMENT_LABELS[t.placement] || `#${t.placement}`}
                  </span>
                  <span className="text-zinc-600 text-xs">{formatDate(t.timestamp)}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400 flex-wrap">
                  <span className="bg-zinc-800 px-1.5 py-0.5 rounded capitalize">
                    {STYLE_LABELS[t.style] || t.style}
                  </span>
                  <span className="bg-zinc-800 px-1.5 py-0.5 rounded capitalize">{t.difficulty}</span>
                  <span className="bg-zinc-800 px-1.5 py-0.5 rounded">{t.bracketSize || 8} wrestlers</span>
                  {typeof t.pointsEarned === 'number' && t.pointsEarned > 0 && (
                    <span className="bg-sky-950/60 text-sky-300 px-1.5 py-0.5 rounded font-bold">
                      +{t.pointsEarned} pts
                    </span>
                  )}
                  <span className="ml-auto font-bold">
                    {t.wins || 0}W {t.losses || 0}L
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
