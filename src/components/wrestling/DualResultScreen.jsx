import React, { useEffect, useRef } from 'react';
import { weightLabel } from '../../lib/ncaaWeights.js';
import { getDualMeetXPBonus, getDualMeetXPBreakdown, getDualWinner } from '../../lib/dualMeetState.js';
import { fireConfetti } from '../../lib/motionFeedback.js';

const METHOD_ABBREV = { pin: 'PIN', tech_fall: 'TF', major: 'MD', decision: 'DEC', draw: 'DR', forfeit: 'FF', dq: 'DQ' };

/**
 * Final dual-meet screen: team score, winner banner, bout-by-bout recap,
 * XP breakdown for CPU duals.
 */
export default function DualResultScreen({ dual, onMenu, onRematch }) {
  const confettiFired = useRef(false);
  const winner = getDualWinner(dual);
  const xpTotal = getDualMeetXPBonus(dual);
  const xpItems = getDualMeetXPBreakdown(dual);

  useEffect(() => {
    if (confettiFired.current) return;
    confettiFired.current = true;
    if (winner === 'player') {
      try { fireConfetti(); } catch { /* ignore */ }
    }
  }, [winner]);

  if (!dual) return null;

  const banner = winner === 'player' ? {
    text: 'Dual Meet Won!', color: 'text-emerald-400', bg: 'bg-emerald-950/40 border-emerald-700/50',
  } : winner === 'opponent' ? {
    text: 'Dual Meet Lost', color: 'text-red-400', bg: 'bg-red-950/40 border-red-700/50',
  } : {
    text: 'Dual Meet Drawn', color: 'text-amber-400', bg: 'bg-amber-950/40 border-amber-700/50',
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <button onClick={onMenu} className="text-zinc-500 hover:text-zinc-300 text-sm font-semibold">
          ← Menu
        </button>
        <div className="text-amber-400 text-xs font-black uppercase tracking-[0.2em]">Dual Meet · Final</div>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
          <section className={`rounded-2xl border ${banner.bg} p-5 text-center`}>
            <div className={`text-xs font-black uppercase tracking-[0.2em] ${banner.color}`}>{banner.text}</div>
            <div className="mt-3 flex items-center justify-center gap-4">
              <div className="text-center">
                <div className="text-zinc-400 text-xs uppercase">{dual.playerTeamName}</div>
                <div className="text-5xl font-black text-emerald-400 mt-1">{dual.teamScore.player}</div>
              </div>
              <div className="text-zinc-600 text-sm font-black">-</div>
              <div className="text-center">
                <div className="text-zinc-400 text-xs uppercase">{dual.opponentTeamName}</div>
                <div className="text-5xl font-black text-red-400 mt-1">{dual.teamScore.opponent}</div>
              </div>
            </div>
          </section>

          {xpItems.length > 0 && (
            <section className="bg-zinc-900/60 border border-zinc-700 rounded-2xl p-4">
              <div className="text-amber-400 text-xs font-black uppercase tracking-wider mb-2">XP Earned (dual bonus)</div>
              <div className="space-y-1">
                {xpItems.map((item, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-zinc-300">{item.label}</span>
                    <span className="text-amber-400 font-bold">+{item.xp}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-2 mt-2 border-t border-zinc-800 text-sm font-black">
                  <span className="text-white">Total</span>
                  <span className="text-amber-400">+{xpTotal} XP</span>
                </div>
                <div className="text-zinc-500 text-[11px] mt-1">Per-bout XP is awarded separately during each match.</div>
              </div>
            </section>
          )}

          <section>
            <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Full Card</div>
            <div className="space-y-1">
              {dual.bouts.map(bout => {
                const res = bout.result;
                const pts = bout.teamPointsAwarded;
                if (!res) {
                  return (
                    <div key={bout.weight} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs">
                      <span className="text-zinc-500 font-black w-10">{weightLabel(bout.weight)}</span>
                      <span className="flex-1 truncate text-zinc-500">skipped</span>
                    </div>
                  );
                }
                const status = res.isDraw ? 'draw' : res.playerWon ? 'win' : 'loss';
                const methodLbl = pts ? (METHOD_ABBREV[pts.method] || pts.method?.toUpperCase() || '') : '';
                // Show the actual bout scoreline (p1Score-p2Score), not the
                // team-point payout. Team points go up top in the banner; the
                // per-bout row should read like a real wrestling boxscore -
                // e.g. a tech fall shows "16-0", not "5-0". Fall back to the
                // team-point payout only if the engine never recorded scores
                // (forfeit, etc.).
                const p1Sc = res?.p1Score ?? null;
                const p2Sc = res?.p2Score ?? null;
                const scoreText = (p1Sc !== null && p2Sc !== null)
                  ? `${p1Sc}-${p2Sc}`
                  : (pts ? `${pts.player}-${pts.opponent}` : '');
                return (
                  <div
                    key={bout.weight}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${
                      status === 'win'  ? 'bg-emerald-950/40 border-emerald-800/50' :
                      status === 'loss' ? 'bg-red-950/40 border-red-800/50' :
                                          'bg-amber-950/40 border-amber-800/50'
                    }`}
                  >
                    <span className="text-zinc-500 font-black w-10">{weightLabel(bout.weight)}</span>
                    <span className="flex-1 truncate">
                      <span className={bout.playerWrestler.isHero ? 'text-amber-300 font-bold' : 'text-zinc-300'}>
                        {bout.playerWrestler.name}
                      </span>
                      <span className="text-zinc-600"> vs </span>
                      <span className="text-zinc-300">{bout.opponentWrestler.name}</span>
                    </span>
                    <span className="text-zinc-500 text-[10px]">{methodLbl}</span>
                    <span className={`font-black ${status === 'win' ? 'text-emerald-400' : status === 'loss' ? 'text-red-400' : 'text-amber-400'}`}>
                      {scoreText}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 flex gap-3">
        <button
          onClick={onMenu}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl"
        >
          Main Menu
        </button>
        {onRematch && (
          <button
            onClick={onRematch}
            className="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black py-3 rounded-xl"
          >
            New Dual
          </button>
        )}
      </div>
    </div>
  );
}
