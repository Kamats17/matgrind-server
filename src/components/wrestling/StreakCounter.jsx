import React from 'react';
import { getStreakData, getActiveBonus, getNextMilestone } from '../../lib/streakRewards';

export default function StreakCounter() {
  const { currentStreak } = getStreakData();
  const bonus = getActiveBonus(currentStreak);
  const next = getNextMilestone(currentStreak);

  if (currentStreak < 1) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 mb-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{bonus ? bonus.icon : '🔥'}</span>
          <div>
            <div className="text-white text-sm font-bold">
              {currentStreak}-Day Streak
            </div>
            {bonus ? (
              <div className="text-amber-400 text-xs font-bold">
                +{Math.round(bonus.multiplier * 100)}% XP Bonus
              </div>
            ) : next ? (
              <div className="text-zinc-500 text-xs">
                {next.daysRemaining} more day{next.daysRemaining !== 1 ? 's' : ''} until +{Math.round(next.multiplier * 100)}% XP
              </div>
            ) : null}
          </div>
        </div>

        {/* Streak flame visualization */}
        <div className="flex gap-0.5">
          {Array.from({ length: Math.min(currentStreak, 7) }).map((_, i) => (
            <div
              key={i}
              className={`w-1.5 rounded-full ${
                bonus ? 'bg-amber-400' : 'bg-zinc-600'
              }`}
              style={{ height: `${12 + i * 3}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
