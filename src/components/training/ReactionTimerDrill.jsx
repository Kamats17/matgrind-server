// src/components/training/ReactionTimerDrill.jsx
//
// 5-round reaction-timer drill. User taps the screen as soon as a colored
// flash appears; we measure milliseconds from flash-onset to tap. A
// pre-flash tap ("jumped the count") disqualifies the round and requires
// a retry, which matches how wrestlers train out-of-stance reactions.
//
// Why it's here (4.2): a reflex mini-game is a game feature with no
// web-site equivalent - it requires instant haptic + visual feedback
// timing that only makes sense on a dedicated native surface.
//
// Persistence: best average (lower = better) is written to localStorage
// via the shared BEST_KEYS map in TrainingHub.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import NavBar from '../ui/NavBar';
import { haptic } from '../../lib/haptics';
import { BEST_KEYS } from './TrainingHub.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { updateReactionLeaderboard } from '../../lib/leaderboardService.js';
import ChargeMechanic from '../wrestling/skillMechanics/ChargeMechanic.jsx';
import ReactionMechanic from '../wrestling/skillMechanics/ReactionMechanic.jsx';
import TraceMechanic from '../wrestling/skillMechanics/TraceMechanic.jsx';
import BurstMechanic from '../wrestling/skillMechanics/BurstMechanic.jsx';
import DrillCurriculum from './DrillCurriculum.jsx';

const ROUNDS = 5;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 4000;

// Tab labels for the skill-mechanic practice modes (Task 13). Each tab maps
// to one of the in-match micro-mechanics so players can drill them outside
// of a live match without the cost of a bad pick.
const DRILL_TABS = [
  { id: 'reaction',     label: 'Reaction'      },
  { id: 'charge',       label: 'Drive Through' },
  { id: 'trace',        label: 'Trace'         },
  { id: 'burst',        label: 'Burst'         },
];

// Sub-component: free-play loop for the in-match mechanics. Shows the last
// few tier results and a running tally so the player can track improvement
// over a session without worrying about a hard round count.
function MechanicLoop({ Component }) {
  // Running totals - never decremented. Separate from the visual dot window
  // so adding reps past the cap doesn't remove older entries from the count.
  const [totals, setTotals] = useState({ PERFECT: 0, GOOD: 0, MISS: 0 });
  // Visual dot history - capped at 12 for display only.
  const [dots, setDots] = useState([]);
  const [iteration, setIteration] = useState(0); // forces remount → reset

  const handleResolve = (result) => {
    setTotals(prev => ({ ...prev, [result.tier]: prev[result.tier] + 1 }));
    setDots(prev => [result.tier, ...prev].slice(0, 12));
    // Brief pause so the player sees the haptic land before remount.
    setTimeout(() => setIteration(i => i + 1), 700);
  };

  const total = totals.PERFECT + totals.GOOD + totals.MISS;

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="text-zinc-400 text-xs uppercase tracking-widest">
        Reps: {total}
        {total > 0 && (
          <>
            {' · '}
            <span className="text-emerald-400">{totals.PERFECT} Perfect</span>
            {' · '}
            <span className="text-amber-400">{totals.GOOD} Good</span>
            {' · '}
            <span className="text-zinc-500">{totals.MISS} Miss</span>
          </>
        )}
      </div>
      {/* Remount on iteration so the mechanic resets each rep. */}
      <Component key={iteration} onResolve={handleResolve} />
      {dots.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap justify-center max-w-xs">
          {dots.map((tier, i) => (
            <span
              key={i}
              className={
                tier === 'PERFECT' ? 'w-2 h-2 rounded-full bg-emerald-400' :
                tier === 'GOOD'    ? 'w-2 h-2 rounded-full bg-amber-400'   :
                                     'w-2 h-2 rounded-full bg-zinc-700'
              }
              title={tier}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReactionTimerDrill({ onBack }) {
  const { user } = useAuth();

  // Active drill tab - defaults to the legacy reaction-time drill so the
  // existing TrainingHub entry point opens the same screen everyone knows.
  const [drillTab, setDrillTab] = useState('reaction');
  // Sub-mode: 'learn' steps through the per-mechanic curriculum (3-5 guided
  // steps); 'practice' is the existing free-play / 5-round loop. Default
  // 'practice' so returning users see the screen they remember; new users
  // discover Learn via the toggle.
  const [subMode, setSubMode] = useState('practice');

  // phase: 'ready' (pre-round), 'waiting' (delay counting), 'go' (flash on),
  //        'result' (just reacted), 'done' (5 rounds finished)
  const [phase, setPhase] = useState('ready');
  const [round, setRound] = useState(0);
  const [times, setTimes] = useState([]);
  const [lastMs, setLastMs] = useState(null);
  const [earlyTap, setEarlyTap] = useState(false);

  const timeoutRef = useRef(null);
  const flashStartRef = useRef(0);

  const clearPending = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => () => clearPending(), []);

  const startRound = useCallback(() => {
    clearPending();
    setPhase('waiting');
    setEarlyTap(false);
    setLastMs(null);
    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    timeoutRef.current = setTimeout(() => {
      flashStartRef.current = performance.now();
      try { haptic.light(); } catch { /* silent */ }
      setPhase('go');
    }, delay);
  }, []);

  const handleTap = () => {
    if (phase === 'ready' || phase === 'done') {
      // Start / restart the whole session
      setRound(0);
      setTimes([]);
      setLastMs(null);
      startRound();
      return;
    }
    if (phase === 'waiting') {
      // Too early!
      clearPending();
      try { haptic.warning(); } catch { /* silent */ }
      setEarlyTap(true);
      setPhase('result');
      return;
    }
    if (phase === 'go') {
      const ms = Math.round(performance.now() - flashStartRef.current);
      try { haptic.success(); } catch { /* silent */ }
      setLastMs(ms);
      setTimes(prev => [...prev, ms]);
      setPhase('result');
    }
  };

  const handleNext = () => {
    if (earlyTap) {
      // Retry the round without advancing
      startRound();
      return;
    }
    if (round + 1 >= ROUNDS) {
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const single = Math.min(...times);

      // Persist best avg
      let newAvgBest = avg;
      try {
        const prevAvg = JSON.parse(localStorage.getItem(BEST_KEYS.reaction) || 'null');
        if (prevAvg == null || avg < prevAvg) {
          localStorage.setItem(BEST_KEYS.reaction, JSON.stringify(avg));
        } else {
          newAvgBest = prevAvg;
        }
      } catch { /* silent */ }

      // Persist best single
      let newSingleBest = single;
      try {
        const prevSingle = JSON.parse(localStorage.getItem(BEST_KEYS.reaction_single) || 'null');
        if (prevSingle == null || single < prevSingle) {
          localStorage.setItem(BEST_KEYS.reaction_single, JSON.stringify(single));
        } else {
          newSingleBest = prevSingle;
        }
      } catch { /* silent */ }

      // Submit all-time bests to leaderboard (fire-and-forget)
      if (user?.uid) {
        const username = user.displayName || user.email?.split('@')[0] || 'Unknown';
        updateReactionLeaderboard(user.uid, username, newSingleBest, newAvgBest).catch(() => {});
      }

      setPhase('done');
    } else {
      setRound(r => r + 1);
      startRound();
    }
  };

  // Big tappable surface color depends on phase - gray waiting, green go.
  const surfaceClass =
    phase === 'go'         ? 'bg-emerald-500 active:bg-emerald-400' :
    phase === 'waiting'    ? 'bg-zinc-800 active:bg-zinc-700' :
    phase === 'result'     ? (earlyTap ? 'bg-red-900/60' : 'bg-zinc-900') :
                             'bg-zinc-900';

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Skill Drills" onBack={onBack} />

      <div className="flex-1 flex flex-col p-4 max-w-md md:max-w-2xl mx-auto w-full">
        {/* Tab bar - one tab per in-match micro-mechanic */}
        <div className="flex gap-2 mb-4">
          {DRILL_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setDrillTab(t.id)}
              className={
                'flex-1 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors ' +
                (drillTab === t.id
                  ? 'bg-emerald-500 text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Sub-mode toggle: Learn (curriculum) vs Practice (free-play /
            5-round legacy timer). Same control across all four tabs so the
            UX is consistent - the only thing that changes per tab is which
            mechanic the toggle is operating on. */}
        <div className="flex gap-1 mb-4 bg-zinc-900 rounded-lg p-1">
          {[
            { id: 'learn',    label: 'Learn' },
            { id: 'practice', label: drillTab === 'reaction' ? '5-Round' : 'Free Play' },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => {
                try { haptic.light(); } catch { /* silent */ }
                setSubMode(m.id);
              }}
              className={
                'flex-1 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors ' +
                (subMode === m.id
                  ? 'bg-zinc-700 text-emerald-400'
                  : 'text-zinc-500 hover:text-zinc-300')
              }
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* LEARN mode - guided curriculum for the selected mechanic. Each
            mechanic gets its own 3-5 step practice path defined in
            drillCurricula.js. */}
        {subMode === 'learn' && drillTab === 'reaction' && (
          <DrillCurriculum mechanic="reaction" Component={ReactionMechanic} />
        )}
        {subMode === 'learn' && drillTab === 'charge' && (
          <DrillCurriculum mechanic="charge" Component={ChargeMechanic} />
        )}
        {subMode === 'learn' && drillTab === 'trace' && (
          <DrillCurriculum mechanic="trace" Component={TraceMechanic} />
        )}
        {subMode === 'learn' && drillTab === 'burst' && (
          <DrillCurriculum mechanic="burst" Component={BurstMechanic} />
        )}

        {/* PRACTICE mode - free-play loop for the in-match mechanics. */}
        {subMode === 'practice' && drillTab === 'charge' && <MechanicLoop Component={ChargeMechanic} />}
        {subMode === 'practice' && drillTab === 'trace'  && <MechanicLoop Component={TraceMechanic}  />}
        {subMode === 'practice' && drillTab === 'burst'  && <MechanicLoop Component={BurstMechanic}  />}

        {/* Legacy reaction-timer drill - kept as the Practice mode for the
            reaction tab so the original 5-round average-time drill is still
            available alongside the new curriculum. */}
        {subMode === 'practice' && drillTab === 'reaction' && (<>
        {/* Round counter */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-zinc-500 text-xs font-bold">
            {phase === 'done' ? 'FINISHED' : `ROUND ${Math.min(round + 1, ROUNDS)} / ${ROUNDS}`}
          </div>
          {times.length > 0 && (
            <div className="text-zinc-400 text-xs font-mono">
              avg {Math.round(times.reduce((a,b)=>a+b,0) / times.length)}ms
            </div>
          )}
        </div>

        {/* Main surface */}
        {phase !== 'done' && (
          <button
            onClick={handleTap}
            className={
              `flex-1 rounded-3xl flex items-center justify-center ` +
              `transition-colors duration-75 select-none ${surfaceClass}`
            }
            style={{ minHeight: 320, touchAction: 'manipulation' }}
            aria-label="Reaction surface"
          >
            <div className="text-center px-6">
              {phase === 'ready' && (
                <>
                  <div className="text-5xl mb-3">⚡</div>
                  <div className="text-white font-black text-xl mb-1">Tap to start</div>
                  <div className="text-zinc-400 text-sm">Wait for the flash. Don't jump the count.</div>
                </>
              )}
              {phase === 'waiting' && (
                <>
                  <div className="text-zinc-500 text-5xl mb-3">•</div>
                  <div className="text-zinc-500 font-bold">Wait for it...</div>
                </>
              )}
              {phase === 'go' && (
                <>
                  <div className="text-black text-6xl font-black">TAP!</div>
                </>
              )}
              {phase === 'result' && earlyTap && (
                <>
                  <div className="text-5xl mb-3">❌</div>
                  <div className="text-red-300 font-black text-xl mb-1">Too early!</div>
                  <div className="text-zinc-400 text-sm">You jumped the count. Try again.</div>
                </>
              )}
              {phase === 'result' && !earlyTap && (
                <>
                  <div className="text-emerald-400 text-6xl font-black">{lastMs}<span className="text-2xl">ms</span></div>
                  <div className="text-zinc-400 text-sm mt-2">
                    {lastMs < 250 ? 'Elite reflexes.' :
                     lastMs < 350 ? 'Competitive.' :
                     lastMs < 500 ? 'Solid - keep drilling.' :
                                    'Work on reading the setup.'}
                  </div>
                </>
              )}
            </div>
          </button>
        )}

        {phase === 'done' && (
          <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3">
            <div className="text-6xl">🏁</div>
            <div className="text-3xl font-black text-emerald-400">
              {Math.round(times.reduce((a,b)=>a+b,0) / times.length)}ms
            </div>
            <div className="text-zinc-400 text-sm">Average over {ROUNDS} rounds</div>
            <div className="flex items-center justify-center gap-4 mt-1">
              <div className="text-center">
                <div className="text-yellow-400 font-black text-lg">{Math.min(...times)}ms</div>
                <div className="text-zinc-600 text-[10px] uppercase tracking-wider">Best single</div>
              </div>
              <div className="text-zinc-700 text-lg">·</div>
              <div className="text-center">
                <div className="text-zinc-300 font-black text-lg">{Math.max(...times)}ms</div>
                <div className="text-zinc-600 text-[10px] uppercase tracking-wider">Slowest</div>
              </div>
            </div>
            <div className="text-zinc-500 text-xs font-mono">
              {times.map(t => `${t}ms`).join(' · ')}
            </div>
          </div>
        )}

        {/* Action row */}
        <div className="mt-3 flex gap-2">
          {phase === 'result' && (
            <button
              onClick={handleNext}
              className="flex-1 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black font-black py-3 rounded-xl"
            >
              {earlyTap ? 'Retry Round' : (round + 1 >= ROUNDS ? 'Finish' : 'Next Round →')}
            </button>
          )}
          {phase === 'done' && (
            <button
              onClick={handleTap}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-black font-black py-3 rounded-xl"
            >
              ▶ Run again
            </button>
          )}
        </div>
        </>)}
      </div>
    </div>
  );
}
