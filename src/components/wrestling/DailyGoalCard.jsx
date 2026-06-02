import React from 'react';
import { Target, CheckCircle2 } from 'lucide-react';

// Featured daily goal card - single rotating objective. Distinct from the
// 3-goal/2-weekly system: one prominent line, today's XP reward, progress
// bar. Used on MainMenu (top of home) and TrainingHub (above drill list).

/**
 * @param {{ goal: any, onClick?: () => void }} props
 */
export default function DailyGoalCard({ goal, onClick }) {
  if (!goal) return null;
  const pct = goal.target > 0
    ? Math.min(100, Math.round((goal.current / goal.target) * 100))
    : 0;
  const done = !!goal.completed;

  const body = (
    <div
      className={`relative rounded-xl ring-1 p-3 mb-4 bg-gradient-to-br ${
        done
          ? 'from-emerald-950/60 to-zinc-900 ring-emerald-500/40'
          : 'from-blue-950/40 to-zinc-900 ring-blue-500/30'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ring-1 ${
          done ? 'bg-emerald-500/15 ring-emerald-500/40' : 'bg-blue-500/15 ring-blue-500/30'
        }`}>
          {done
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : <Target className="w-4 h-4 text-blue-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-black uppercase tracking-[0.15em] text-blue-300">
              Today's Goal
            </div>
            <div className={`text-[11px] font-black tabular-nums ${done ? 'text-emerald-400' : 'text-yellow-400'}`}>
              +{goal.xpReward} XP
            </div>
          </div>
          <div className="text-white text-sm font-bold leading-snug mt-0.5">
            {goal.label}
          </div>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-zinc-500 mb-1">
              <span>{goal.current} / {goal.target}</span>
              <span>{done ? 'DONE' : `${pct}%`}</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  done ? 'bg-emerald-500' : 'bg-blue-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="w-full text-left active:scale-[0.99] transition-transform"
      >
        {body}
      </button>
    );
  }
  return body;
}
