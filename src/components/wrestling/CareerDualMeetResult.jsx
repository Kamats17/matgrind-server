// Career-context dual-meet result screen. Distinct from the standalone
// DualResultScreen so the CTAs route back to the career dashboard (not the
// main menu) and the XP shown is the career XP captured from
// recordCareerDualMeetResult, not the standalone profile dual-meet bonus.

import React, { useEffect } from 'react';
import { formatWinMethod } from '../../lib/career/careerWeights.js';

function teamWinnerLabel(teamWinner) {
  if (teamWinner === 'player') return 'Win';
  if (teamWinner === 'opponent') return 'Loss';
  if (teamWinner === 'draw') return 'Draw';
  return 'Final';
}

export default function CareerDualMeetResult({
  career,
  event,
  dual,
  xpGained,
  teamWinner,
  onReturn,
}) {
  // Land at the top of the result screen so the Team Win/Loss header is
  // visible without scrolling - matches the behavior of the setup screen.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, []);

  const teamScore = dual?.teamScore || { player: 0, opponent: 0 };
  const playerName = career?.wrestler?.school?.name
    || career?.wrestler?.school
    || 'Your Team';
  const opponentName = dual?.opponentTeamName || event?.opponentTeamName || 'Visitors';
  const winnerLabel = teamWinnerLabel(teamWinner);
  const winnerColor = teamWinner === 'player' ? 'text-emerald-300'
    : teamWinner === 'opponent' ? 'text-rose-400'
    : 'text-amber-300';

  const heroIdx = typeof dual?.heroIdx === 'number' ? dual.heroIdx : -1;
  const heroBout = heroIdx >= 0 ? dual?.bouts?.[heroIdx] : null;
  const heroWon = heroBout?.result?.playerWon === true;
  const heroResultText = heroBout?.result
    ? heroWon
      ? `Won by ${formatWinMethod(heroBout.result.winMethod)} (${heroBout.result.p1Score}-${heroBout.result.p2Score})`
      : `Lost by ${formatWinMethod(heroBout.result.winMethod)} (${heroBout.result.p1Score}-${heroBout.result.p2Score})`
    : 'Result pending';

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-6 flex flex-col">
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-5 flex-1">
        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-5 md:p-6 text-center">
          <div className="text-zinc-500 text-xs font-black uppercase tracking-[0.25em] mb-1">
            Dual Meet Complete
          </div>
          <div className={`text-3xl md:text-4xl font-black mb-3 ${winnerColor}`}>
            Team {winnerLabel}
          </div>
          <div className="grid grid-cols-2 gap-3 text-center max-w-md mx-auto">
            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-3">
              <div className="text-zinc-500 text-xs uppercase tracking-wider">{playerName}</div>
              <div className="text-2xl font-black text-emerald-300">{teamScore.player}</div>
            </div>
            <div className="rounded-lg bg-zinc-950/60 border border-zinc-800 p-3">
              <div className="text-zinc-500 text-xs uppercase tracking-wider">{opponentName}</div>
              <div className="text-2xl font-black text-rose-300">{teamScore.opponent}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-5">
          <div className="text-zinc-400 text-xs font-black uppercase tracking-[0.2em] mb-2">
            Your Bout
          </div>
          <div className={`text-lg font-bold ${heroWon ? 'text-emerald-300' : 'text-rose-300'}`}>
            {heroResultText}
          </div>
          {typeof xpGained === 'number' && xpGained > 0 && (
            <div className="text-sm text-amber-300 mt-2">+{xpGained} career XP</div>
          )}
        </div>

        <div className="mt-auto pt-4">
          <button
            type="button"
            onClick={onReturn}
            className="w-full py-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-black text-lg"
          >
            Back to Career Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
