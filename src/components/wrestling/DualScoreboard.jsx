import React from 'react';
import { weightLabel } from '../../lib/ncaaWeights.js';
import { isClinched } from '../../lib/dualMeetState.js';

const METHOD_ABBREV = { pin: 'PIN', tech_fall: 'TF', major: 'MD', decision: 'DEC', draw: 'DR', forfeit: 'FF', dq: 'DQ' };

/**
 * Between-bout scoreboard: shows running team score, per-bout recap (so far),
 * and the next bout preview. Tapping "Next bout" calls `onStartNextBout()`.
 *
 * `onSimulateBout` (optional): when provided, renders a secondary "Simulate
 * Bout" button so the player can roll the next bout via dice instead of
 * playing it. Used by career mode dual meets to let the player mix played
 * + simulated bouts in a `full_dual` run (play 3-4, sim the rest to finish
 * faster). Standalone dual menu callers leave this undefined and the
 * button is hidden.
 */
export default function DualScoreboard({ dual, onStartNextBout, onSimulateBout, onQuit }) {
  if (!dual) return null;
  const clinched = isClinched(dual);
  const nextBout = dual.bouts[dual.currentBoutIndex] || null;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <button onClick={onQuit} className="text-zinc-500 hover:text-zinc-300 text-sm font-semibold">
          ← Quit
        </button>
        <div className="text-center">
          <div className="text-amber-400 text-xs font-black uppercase tracking-[0.2em]">Dual Meet</div>
          <div className="text-zinc-500 text-xs">
            Bout {Math.min(dual.currentBoutIndex + 1, dual.bouts.length)} / {dual.bouts.length}
          </div>
        </div>
        <div className="w-12" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-5 space-y-5">
          {/* Team score */}
          <section className="bg-zinc-900 border border-zinc-700 rounded-2xl p-4">
            <div className="grid grid-cols-3 items-center gap-2">
              <div className="text-center">
                <div className="text-zinc-400 text-xs uppercase tracking-wider truncate">{dual.playerTeamName}</div>
                <div className="text-4xl font-black text-emerald-400 mt-1">{dual.teamScore.player}</div>
              </div>
              <div className="text-center text-zinc-600 text-sm font-black">vs</div>
              <div className="text-center">
                <div className="text-zinc-400 text-xs uppercase tracking-wider truncate">{dual.opponentTeamName}</div>
                <div className="text-4xl font-black text-red-400 mt-1">{dual.teamScore.opponent}</div>
              </div>
            </div>
            {clinched && (
              <div className="mt-3 text-center text-amber-400 text-xs font-bold">
                Dual clinched - finish the card for bonus XP!
              </div>
            )}
          </section>

          {/* Next bout */}
          {nextBout && dual.phase === 'between' && (
            <section className="bg-zinc-900/70 border border-amber-600/40 rounded-2xl p-4">
              <div className="text-amber-400 text-xs font-black uppercase tracking-wider mb-2">
                Next Bout · {weightLabel(nextBout.weight)} lb
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-zinc-500 text-[10px] uppercase">You</div>
                  <div className="text-emerald-300 font-bold text-sm truncate">
                    {nextBout.playerWrestler.name}
                    {nextBout.playerWrestler.isHero && <span className="text-amber-400 text-[10px] ml-1">HERO</span>}
                    {nextBout.playerWrestler.isAiFill && <span className="text-zinc-500 text-[10px] ml-1">(teammate)</span>}
                  </div>
                </div>
                <div className="text-zinc-600 text-xs font-black">vs</div>
                <div className="min-w-0 flex-1 text-right">
                  <div className="text-zinc-500 text-[10px] uppercase">Opponent</div>
                  <div className="text-red-300 font-bold text-sm truncate">{nextBout.opponentWrestler.name}</div>
                </div>
              </div>
            </section>
          )}

          {/* Bout results so far */}
          <section>
            <div className="text-zinc-500 text-xs uppercase tracking-wider mb-2">Card</div>
            <div className="space-y-1">
              {dual.bouts.map((bout, i) => {
                const status = bout.result
                  ? bout.result.isDraw ? 'draw' : bout.result.playerWon ? 'win' : 'loss'
                  : i === dual.currentBoutIndex && dual.phase !== 'complete' ? 'up_next' : 'pending';
                const pts = bout.teamPointsAwarded;
                const methodLbl = pts ? (METHOD_ABBREV[pts.method] || pts.method?.toUpperCase() || '') : '';
                // Show the actual bout scoreline (p1Score-p2Score), not the
                // team-point payout. The team score up top already reflects
                // the payout; the per-bout row should read like a real
                // wrestling boxscore - a tech-fall loss shows "10-25", not
                // "0-5". Fall back to the team-point payout only if the
                // engine never recorded scores (forfeit, DQ, etc.).
                const p1Sc = bout.result?.p1Score ?? null;
                const p2Sc = bout.result?.p2Score ?? null;
                const scoreText = (p1Sc !== null && p2Sc !== null)
                  ? `${p1Sc}-${p2Sc}`
                  : (pts ? `${pts.player}-${pts.opponent}` : '');
                return (
                  <div
                    key={bout.weight}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border text-xs ${
                      status === 'win'    ? 'bg-emerald-950/40 border-emerald-800/50' :
                      status === 'loss'   ? 'bg-red-950/40 border-red-800/50' :
                      status === 'draw'   ? 'bg-amber-950/40 border-amber-800/50' :
                      status === 'up_next'? 'bg-zinc-900 border-amber-500/60' :
                                            'bg-zinc-900/40 border-zinc-800'
                    }`}
                  >
                    <span className="text-zinc-500 font-black w-10">{weightLabel(bout.weight)}</span>
                    <span className="flex-1 truncate text-zinc-300">
                      <span className={bout.playerWrestler.isHero ? 'text-amber-300 font-bold' : ''}>
                        {bout.playerWrestler.name}
                      </span>
                      <span className="text-zinc-600"> vs </span>
                      <span>{bout.opponentWrestler.name}</span>
                    </span>
                    {bout.result ? (
                      <>
                        <span className="text-zinc-500 text-[10px]">{methodLbl}</span>
                        <span className={`font-black ${status === 'win' ? 'text-emerald-400' : status === 'loss' ? 'text-red-400' : 'text-amber-400'}`}>
                          {scoreText}
                        </span>
                      </>
                    ) : status === 'up_next' ? (
                      <span className="text-amber-400 font-bold text-[10px]">UP NEXT</span>
                    ) : (
                      <span className="text-zinc-600 text-[10px]">-</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      <div className="border-t border-zinc-800 bg-zinc-950 px-4 py-3 space-y-2">
        <button
          onClick={onStartNextBout}
          className="w-full bg-amber-500 hover:bg-amber-400 active:scale-95 text-zinc-950 font-black py-3 rounded-xl transition-all tracking-wide text-sm"
        >
          Start Next Bout
        </button>
        {onSimulateBout && dual.phase === 'between' && (
          <button
            onClick={onSimulateBout}
            className="w-full bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-zinc-200 font-bold py-2.5 rounded-xl transition-all tracking-wide text-xs border border-zinc-700"
          >
            Simulate Bout
          </button>
        )}
      </div>
    </div>
  );
}
