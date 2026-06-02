import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  createInitialMatchState,
  resolveRound,
  resolvePinStage1,
  resolvePinStage2,
  resolvePinStage3,
  applyPeriodChoice,
} from '../../lib/wrestlingEngine.js';
import ScoreBoard from './ScoreBoard';
import MatView from './MatView';
import WrestlerVisual from './WrestlerVisual';
import MatchLog from './MatchLog';
import { getWrestlerColors } from '../../lib/wrestlerColors.js';
import { useColorblind } from '../../lib/ColorblindContext';
import NavBar from '../ui/NavBar';

const METHOD_LABELS = {
  pin: 'PIN', tech_fall: 'TECH FALL', decision: 'DECISION',
  draw: 'DRAW', overtime: 'SUDDEN VICTORY',
};

export default function ReplayViewer({ replay, onClose }) {
  const { colorblind } = useColorblind();
  const [stepIndex, setStepIndex] = useState(0);
  const [states, setStates] = useState([]);
  const [playing, setPlaying] = useState(false);
  const playTimer = useRef(null);

  // Build all states on mount by replaying all events
  useEffect(() => {
    if (!replay) return;
    const { config, events } = replay;
    const initial = createInitialMatchState(
      config.p1Name, config.p2Name,
      config.style || 'folkstyle',
      config.p1Stats || null, config.p2Stats || null,
      config.difficulty || 'medium',
      config.initiative || null
    );
    const stateHistory = [initial];
    let current = initial;

    for (const event of events) {
      try {
        if (event.type === 'round') {
          current = resolveRound(current, event.p1CardId, event.p2CardId);
          stateHistory.push(current);
        } else if (event.type === 'period_choice') {
          current = applyPeriodChoice(current, event.chooser, event.choice);
          stateHistory.push(current);
        } else if (event.type === 'pin') {
          if (event.stage === 1) {
            current = resolvePinStage1(current, event.offenseCardId, event.defenseCardId);
          } else if (event.stage === 2) {
            current = resolvePinStage2(current, event.offenseCardId, event.defenseCardId);
          } else {
            current = resolvePinStage3(current, event.offenseCardId, event.defenseCardId);
          }
          stateHistory.push(current);
        }
      } catch {
        break; // Stop on any engine error
      }
    }

    // If we have the stored match log & result, patch the final state to match reality
    // (re-simulation can diverge due to Math.random() in the engine)
    if (replay.matchLog && replay.result) {
      const lastState = { ...stateHistory[stateHistory.length - 1] };
      lastState.log = replay.matchLog;
      lastState.winner = replay.result.winner;
      lastState.winMethod = replay.result.winMethod;
      lastState.p1 = { ...lastState.p1, score: replay.result.p1Score };
      lastState.p2 = { ...lastState.p2, score: replay.result.p2Score };
      lastState.phase = 'finished';
      stateHistory[stateHistory.length - 1] = lastState;
    }

    setStates(stateHistory);
    setStepIndex(0);
  }, [replay]);

  const currentState = states[stepIndex] || null;
  const totalSteps = states.length;

  const goForward = useCallback(() => {
    setStepIndex(prev => Math.min(prev + 1, totalSteps - 1));
  }, [totalSteps]);

  const goBack = useCallback(() => {
    setStepIndex(prev => Math.max(prev - 1, 0));
  }, []);

  const goStart = useCallback(() => {
    setStepIndex(0);
    setPlaying(false);
  }, []);

  const goEnd = useCallback(() => {
    setStepIndex(totalSteps - 1);
    setPlaying(false);
  }, [totalSteps]);

  // Auto-play
  useEffect(() => {
    clearInterval(playTimer.current);
    if (!playing) return;
    playTimer.current = setInterval(() => {
      setStepIndex(prev => {
        if (prev >= totalSteps - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);
    return () => clearInterval(playTimer.current);
  }, [playing, totalSteps]);

  const togglePlay = useCallback(() => {
    if (stepIndex >= totalSteps - 1) {
      setStepIndex(0);
      setPlaying(true);
    } else {
      setPlaying(p => !p);
    }
  }, [stepIndex, totalSteps]);

  if (!currentState) {
    return (
      <div className="min-h-full bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm">Loading replay...</div>
      </div>
    );
  }

  const p1Colors = getWrestlerColors(null, 'p1', colorblind);
  const p2Colors = getWrestlerColors(null, 'p2', colorblind);
  const event = replay.events[stepIndex - 1];
  const result = replay.result;
  const isFinished = stepIndex === totalSteps - 1 && result;
  const progressPct = totalSteps > 1 ? (stepIndex / (totalSteps - 1)) * 100 : 0;

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      {/* iOS-style NavBar - right slot shows step counter */}
      <NavBar
        title={`Replay · ${replay.config.p1Name} vs ${replay.config.p2Name}`}
        onBack={onClose}
        right={
          <div className="text-zinc-600 text-xs font-mono pr-1">
            {stepIndex}/{totalSteps - 1}
          </div>
        }
      />

      {/* Game view */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 max-w-md md:max-w-2xl mx-auto w-full">
        <ScoreBoard state={currentState} />

        <div className="h-36">
          <WrestlerVisual state={currentState} p1Colors={p1Colors} p2Colors={p2Colors} />
        </div>

        <MatView state={currentState} p1Color={p1Colors.primary} p2Color={p2Colors.primary} />

        {/* Current event label */}
        {event && (
          <div className="text-center py-1">
            <span className="text-zinc-500 text-xs font-semibold">
              {event.type === 'round' && `Round: ${event.p1CardId} vs ${event.p2CardId}`}
              {event.type === 'period_choice' && `${event.chooser.toUpperCase()} chose ${event.choice}`}
              {event.type === 'pin' && `Pin Stage ${event.stage}: ${event.offenseCardId} vs ${event.defenseCardId}`}
            </span>
          </div>
        )}

        {/* Final result overlay */}
        {isFinished && result && (
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-center">
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-1">
              {METHOD_LABELS[result.winMethod] || 'DECISION'}
            </div>
            <div className="text-xl font-black text-white">
              {result.winner === 'draw' ? 'DRAW' : (result.winner === 'p1' ? replay.config.p1Name : replay.config.p2Name) + ' WINS'}
            </div>
            <div className="text-zinc-400 text-sm font-bold mt-1">
              {result.p1Score} - {result.p2Score}
            </div>
          </div>
        )}

        {/* Match log */}
        {currentState.log?.length > 0 && (
          <MatchLog log={currentState.log} />
        )}
      </div>

      {/* Playback controls */}
      <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-3">
        {/* Progress bar */}
        <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-3">
          <div
            className="bg-yellow-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        <div className="flex items-center justify-center gap-3">
          <button onClick={goStart} className="text-zinc-400 hover:text-white px-2 py-1 text-lg" title="Start">
            ⏮
          </button>
          <button onClick={goBack} disabled={stepIndex <= 0} className="text-zinc-400 hover:text-white disabled:text-zinc-700 px-3 py-1.5 rounded-lg bg-zinc-800 text-sm font-bold">
            ◀ Prev
          </button>
          <button onClick={togglePlay} className="px-4 py-1.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-black font-black text-sm min-w-[70px]">
            {playing ? '⏸ Pause' : '▶ Play'}
          </button>
          <button onClick={goForward} disabled={stepIndex >= totalSteps - 1} className="text-zinc-400 hover:text-white disabled:text-zinc-700 px-3 py-1.5 rounded-lg bg-zinc-800 text-sm font-bold">
            Next ▶
          </button>
          <button onClick={goEnd} className="text-zinc-400 hover:text-white px-2 py-1 text-lg" title="End">
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}
