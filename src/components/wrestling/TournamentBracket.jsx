import React, { useState, useEffect, useRef } from 'react';
import { COLOR_PRESETS } from '../../lib/wrestlerColors.js';
import { resolveNextNonPlayerMatch, finishSimulation, checkConsolationSetup, resolveByeRounds, advanceToLBMatch, findPlayerNextMatch } from '../../lib/tournamentState.js';
import NavBar from '../ui/NavBar';

function getColorHex(appearance) {
  if (!appearance?.primaryColor) return '#34d399';
  const preset = COLOR_PRESETS.find(c => c.id === appearance.primaryColor);
  return preset?.primary || '#34d399';
}

const METHOD_ICON = { pin: 'PIN', tech_fall: 'TF', major_decision: 'MD', decision: 'DEC' };

function MatchSlot({ match, bracket, playerSeed, isCurrentMatch, isSimulating }) {
  const [s1, s2] = match.bracketSlots;
  const w1 = s1 !== null ? bracket[s1] : null;
  const w2 = s2 !== null ? bracket[s2] : null;
  const isResolved = match.winner !== null;

  return (
    <div className={`rounded-xl border-2 overflow-hidden transition-all ${
      isSimulating
        ? 'border-yellow-500/60 shadow-[0_0_12px_rgba(234,179,8,0.15)]'
        : isCurrentMatch
          ? 'border-amber-500 shadow-[0_0_16px_rgba(245,158,11,0.25)]'
          : isResolved
            ? 'border-zinc-700'
            : 'border-zinc-800'
    }`}>
      {/* Wrestler 1 */}
      <div className={`flex items-center gap-2 px-3 py-2 ${
        isResolved && match.winner === s1 ? 'bg-zinc-800' : 'bg-zinc-900/60'
      }`}>
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{
          backgroundColor: w1 ? getColorHex(w1.appearance) : '#3f3f46',
        }} />
        <span className={`text-xs font-bold truncate flex-1 ${
          w1?.isPlayer ? 'text-emerald-400' : isResolved && match.winner === s1 ? 'text-white' : 'text-zinc-400'
        }`}>
          {w1?.name || 'TBD'}
          {w1?.isPlayer && <span className="text-emerald-600 text-[10px] ml-1">(you)</span>}
        </span>
        {isResolved && (
          <span className={`text-xs font-black ${match.winner === s1 ? 'text-amber-400' : 'text-zinc-600'}`}>
            {match.p1Score}
          </span>
        )}
        {isResolved && match.winner === s1 && (
          <span className="text-[9px] text-zinc-500 font-bold">{METHOD_ICON[match.winMethod] || ''}</span>
        )}
      </div>

      <div className="h-px bg-zinc-800" />

      {/* Wrestler 2 */}
      <div className={`flex items-center gap-2 px-3 py-2 ${
        isResolved && match.winner === s2 ? 'bg-zinc-800' : 'bg-zinc-900/60'
      }`}>
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{
          backgroundColor: w2 ? getColorHex(w2.appearance) : '#3f3f46',
        }} />
        <span className={`text-xs font-bold truncate flex-1 ${
          w2?.isPlayer ? 'text-emerald-400' : isResolved && match.winner === s2 ? 'text-white' : 'text-zinc-400'
        }`}>
          {w2?.name || 'TBD'}
          {w2?.isPlayer && <span className="text-emerald-600 text-[10px] ml-1">(you)</span>}
        </span>
        {isResolved && (
          <span className={`text-xs font-black ${match.winner === s2 ? 'text-amber-400' : 'text-zinc-600'}`}>
            {match.p2Score}
          </span>
        )}
        {isResolved && match.winner === s2 && (
          <span className="text-[9px] text-zinc-500 font-bold">{METHOD_ICON[match.winMethod] || ''}</span>
        )}
      </div>
    </div>
  );
}

export default function TournamentBracket({ tournament, onStartMatch, onBack, onTournamentUpdate }) {
  const { bracket, matches, playerSeed } = tournament;
  const nextMatch = findPlayerNextMatch(tournament);
  const [simResult, setSimResult] = useState(null);
  const [simMatchIndex, setSimMatchIndex] = useState(null);
  const simTimerRef = useRef(null);

  // Mirror tournament + onTournamentUpdate into refs so the simulation
  // effect below (keyed on isSimulating only) can read the latest values
  // without re-firing - the setTimeout chain would otherwise be cancelled
  // and re-armed on every parent re-render.
  const tournamentRef = useRef(tournament);
  const onTournamentUpdateRef = useRef(onTournamentUpdate);
  useEffect(() => { tournamentRef.current = tournament; }, [tournament]);
  useEffect(() => { onTournamentUpdateRef.current = onTournamentUpdate; }, [onTournamentUpdate]);

  const isComplete = tournament.phase === 'complete';
  const isChampion = isComplete && !tournament.playerEliminated;
  const isSimulating = tournament.phase === 'simulating';

  // Sequential simulation effect
  // Tournament + onTournamentUpdate read via refs to avoid sim cancellation
  // when parent re-renders (simulation chain uses setTimeout - would be
  // cancelled and re-armed on every dep change).
   
  useEffect(() => {
    if (!isSimulating) return;

    function runNextSim() {
      const currentTournament = tournamentRef.current;
      // Check if consolation needs setup
      if (currentTournament.consolationPending) {
        checkConsolationSetup(currentTournament);
      }

      const result = resolveNextNonPlayerMatch(currentTournament);
      if (result) {
        setSimMatchIndex(result.matchIndex);
        setSimResult(result);

        simTimerRef.current = setTimeout(() => {
          setSimResult(null);
          setSimMatchIndex(null);
          // Schedule next
          simTimerRef.current = setTimeout(runNextSim, 300);
        }, 1500);
      } else {
        // No more matches to resolve - finish simulation
        setSimResult(null);
        setSimMatchIndex(null);
        const updated = finishSimulation(tournamentRef.current);
        if (onTournamentUpdateRef.current) onTournamentUpdateRef.current(updated);
      }
    }

    simTimerRef.current = setTimeout(runNextSim, 800);

    return () => {
      if (simTimerRef.current) clearTimeout(simTimerRef.current);
    };
  }, [isSimulating]);

  // Build round columns from roundRanges
  const roundRanges = tournament.roundRanges || [
    { label: 'Quarterfinals', key: 'qf', start: 0, end: 3 },
    { label: 'Semifinals', key: 'sf', start: 4, end: 5 },
    { label: 'Finals', key: 'finals', start: 6, end: 6 },
  ];

  const bracketSize = tournament.bracketSize || 8;
  const formatLabel = (tournament.tournamentFormat === 'double_elim' || tournament.tournamentFormat === 'consolation')
    ? 'Double Elimination'
    : 'Single Elimination';

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      {/* iOS-style NavBar - right slot carries the semantic back label
          ("Done" when tournament is finished, "Forfeit" mid-bracket) so the
          context isn't lost when we replace the text-button with a chevron. */}
      <NavBar
        title="Tournament"
        onBack={onBack}
        right={
          <div className={`text-xs font-bold pr-2 ${isComplete ? 'text-purple-300' : 'text-zinc-500'}`}>
            {isComplete ? 'Done' : 'Forfeit'}
          </div>
        }
      />
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-2">
        <p className="text-zinc-600 text-[10px] uppercase tracking-wider text-center max-w-3xl mx-auto">
          {bracketSize}-man {formatLabel} | {tournament.difficulty} | {tournament.wrestlingStyle}
        </p>
      </div>

      {/* Champion / Eliminated banner */}
      {isComplete && (
        <div className={`px-4 py-5 text-center ${
          isChampion ? 'bg-amber-950/30 border-b border-amber-800/40' : 'bg-red-950/20 border-b border-red-800/30'
        }`}>
          <div className="text-3xl mb-1">{isChampion ? '🏆' : '💪'}</div>
          <div className={`text-lg font-black ${isChampion ? 'text-amber-400' : 'text-red-400'}`}>
            {isChampion ? 'TOURNAMENT CHAMPION!' :
              tournament.inConsolation && tournament.consolationMatch?.winner === playerSeed
                ? '3RD PLACE!' : 'ELIMINATED'}
          </div>
          <div className="text-zinc-500 text-xs mt-1">
            {tournament.roundsWon} round{tournament.roundsWon !== 1 ? 's' : ''} won
            {tournament.roundsWon > 0 && ` (+${tournament.roundsWon * 50}${isChampion ? ' +200 champion' : ''} bonus XP)`}
          </div>
          {/* One-tap re-entry: skip the menu hop so momentum stays high */}
          <button
            onClick={onBack}
            className={`mt-4 px-8 py-2.5 rounded-xl font-black text-sm active:scale-95 transition-all ${
              isChampion
                ? 'bg-amber-500 hover:bg-amber-400 text-black'
                : 'bg-purple-600 hover:bg-purple-500 text-white'
            }`}
          >
            New Tournament →
          </button>
        </div>
      )}

      {/* Simulation toast */}
      {simResult && (
        <div className="px-4 py-2 bg-zinc-900/90 border-b border-zinc-800 animate-pulse">
          <div className="max-w-3xl mx-auto text-center">
            <span className="text-yellow-400 text-xs font-bold">{simResult.winnerName}</span>
            <span className="text-zinc-500 text-xs"> def. </span>
            <span className="text-zinc-400 text-xs font-bold">{simResult.loserName}</span>
            <span className="text-zinc-600 text-xs"> - {simResult.p1Score}-{simResult.p2Score} </span>
            <span className="text-zinc-500 text-[10px] font-bold">{METHOD_ICON[simResult.winMethod] || ''}</span>
          </div>
        </div>
      )}

      {/* Bracket display */}
      <div className="flex-1 px-4 py-4 max-w-3xl mx-auto w-full overflow-y-auto">
        <div className={`overflow-x-auto`}>
          <div className={`grid gap-3`} style={{
            gridTemplateColumns: `repeat(${roundRanges.length}, minmax(${bracketSize > 8 ? '140px' : '0'}, 1fr))`,
            minWidth: roundRanges.length > 3 ? `${roundRanges.length * 160}px` : undefined,
          }}>
            {roundRanges.map((range, colIdx) => {
              const roundMatches = [];
              for (let i = range.start; i <= range.end; i++) {
                roundMatches.push(i);
              }
              return (
                <div key={colIdx} className={`flex flex-col ${colIdx > 0 ? 'justify-around' : ''} space-y-3`}>
                  <div className="text-zinc-600 text-[10px] font-black uppercase tracking-widest text-center mb-1">
                    {range.label}
                  </div>
                  {roundMatches.map(i => (
                    <MatchSlot
                      key={i}
                      match={matches[i]}
                      bracket={bracket}
                      playerSeed={playerSeed}
                      isCurrentMatch={nextMatch?.matchIndex === i}
                      isSimulating={simMatchIndex === i}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Champion display */}
        {matches[matches.length - 1].winner !== null && (
          <div className="mt-4 text-center">
            <div className="text-amber-400 text-xs font-black uppercase tracking-wider">Champion</div>
            <div className="text-white text-sm font-bold mt-0.5 truncate px-4 max-w-full">{bracket[matches[matches.length - 1].winner]?.name}</div>
          </div>
        )}

        {/* Losers Bracket */}
        {tournament.losersMatches && tournament.losersMatches.length > 0 && tournament.playerLosses >= 1 && (
          <div className="mt-6">
            <div className="text-red-500/60 text-[10px] font-black uppercase tracking-widest text-center mb-3 flex items-center justify-center gap-2">
              <div className="h-px bg-red-800/30 flex-1" />
              Consolation Bracket
              <div className="h-px bg-red-800/30 flex-1" />
            </div>
            <div className="grid gap-3" style={{
              gridTemplateColumns: `repeat(${(tournament.losersRoundRanges || []).length}, minmax(0, 1fr))`,
              minWidth: (tournament.losersRoundRanges || []).length > 3 ? `${(tournament.losersRoundRanges || []).length * 160}px` : undefined,
            }}>
              {(tournament.losersRoundRanges || []).map((range, colIdx) => {
                const roundMatches = [];
                for (let i = range.start; i <= range.end; i++) {
                  roundMatches.push(i);
                }
                return (
                  <div key={colIdx} className={`flex flex-col ${colIdx > 0 ? 'justify-around' : ''} space-y-3`}>
                    <div className="text-red-600/50 text-[10px] font-black uppercase tracking-widest text-center mb-1">
                      {range.label}
                    </div>
                    {roundMatches.map(i => (
                      <MatchSlot
                        key={`loser_${i}`}
                        match={tournament.losersMatches[i]}
                        bracket={bracket}
                        playerSeed={playerSeed}
                        isCurrentMatch={nextMatch?.matchIndex === `losers_${i}`}
                        isSimulating={false}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Consolation match */}
        {tournament.consolationMatch && (
          <div className="mt-6">
            <div className="text-zinc-600 text-[10px] font-black uppercase tracking-widest text-center mb-2">
              3rd Place Match
            </div>
            <div className="max-w-xs mx-auto">
              <MatchSlot
                match={tournament.consolationMatch}
                bracket={bracket}
                playerSeed={playerSeed}
                isCurrentMatch={nextMatch?.matchIndex === 'consolation'}
                isSimulating={false}
              />
            </div>
          </div>
        )}

        {/* True Finals (double elim) */}
        {tournament.trueFinalsMatch && (
          <div className="mt-6">
            <div className="text-zinc-600 text-[10px] font-black uppercase tracking-widest text-center mb-2">
              True Finals
            </div>
            <div className="max-w-xs mx-auto">
              <MatchSlot
                match={tournament.trueFinalsMatch}
                bracket={bracket}
                playerSeed={playerSeed}
                isCurrentMatch={nextMatch?.matchIndex === 'true_finals'}
                isSimulating={false}
              />
            </div>
          </div>
        )}

        {/* Advance to Match - shown when player is in LB but opponent slot is empty */}
        {!nextMatch && !isComplete && !isSimulating && tournament.playerLosses >= 1 &&
          tournament.losersMatches?.some(m => {
            if (m.winner !== null) return false;
            const [s1, s2] = m.bracketSlots;
            const inMatch = s1 === playerSeed || s2 === playerSeed;
            const oppNull = (s1 === playerSeed ? s2 : s1) === null;
            return inMatch && oppNull;
          }) && (
          <div className="mt-6 text-center">
            <div className="text-zinc-500 text-xs mb-2">
              Simulate prior matches to set up your Losers Bracket matchup
            </div>
            <button
              onClick={() => {
                const updated = advanceToLBMatch(tournament);
                if (onTournamentUpdate) onTournamentUpdate({ ...updated });
              }}
              className="bg-red-700 hover:bg-red-600 active:scale-95 text-white font-black text-sm px-8 py-3 rounded-xl transition-all"
            >
              Advance to Match
            </button>
          </div>
        )}

        {/* Begin button - simulates bye/play-in rounds then drops player into first match */}
        {!nextMatch && !isComplete && !isSimulating && !(tournament.playerLosses >= 1) && (
          <div className="mt-6 text-center">
            <div className="text-zinc-500 text-xs mb-2">
              Simulate play-in matches, then you&apos;re up
            </div>
            <button
              onClick={() => {
                const updated = resolveByeRounds(tournament);
                if (onTournamentUpdate) onTournamentUpdate({ ...updated });
              }}
              className="bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-black text-sm px-8 py-3 rounded-xl transition-all animate-pulse"
            >
              Begin!
            </button>
          </div>
        )}

        {/* Start Match button */}
        {nextMatch && !isComplete && !isSimulating && (
          <div className="mt-6 text-center">
            <div className="text-zinc-500 text-xs mb-2">
              Next: <span className="text-purple-400 font-bold">{nextMatch.round}</span> vs{' '}
              <span className="text-white font-bold">{nextMatch.opponent.name}</span>
            </div>
            <button
              onClick={() => onStartMatch(nextMatch)}
              className="bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-black text-sm px-8 py-3 rounded-xl transition-all animate-pulse"
            >
              Wrestle
            </button>
          </div>
        )}

        {/* Simulating indicator */}
        {isSimulating && !simResult && (
          <div className="mt-6 text-center text-zinc-500 text-xs">
            Simulating bracket...
          </div>
        )}
      </div>
    </div>
  );
}

// findPlayerNextMatch moved to ../../lib/tournamentState.js so it can be
// unit-tested. The bracket-slot guard added there fixes the crash where a
// stale snapshot with an undefined opponent slot reached this UI.
