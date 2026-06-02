import React, { useState, useEffect } from 'react';
import { getDailyChallenges, getDailyProgress } from '../../lib/dailyChallenges.js';
import { getStreakData } from '../../lib/streakRewards.js';

const BONUS_XP = 25;

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

export default function DailyChallenges() {
  const [dateStr] = useState(getTodayString);
  const [challenges, setChallenges] = useState([]);
  const [completed, setCompleted] = useState([]);
  const { currentStreak } = getStreakData();

  useEffect(() => {
    setChallenges(getDailyChallenges(dateStr));
    setCompleted(getDailyProgress(dateStr).completed);
  }, [dateStr]);

  // Re-check progress periodically (in case match was just played)
  useEffect(() => {
    const interval = setInterval(() => {
      setCompleted(getDailyProgress(dateStr).completed);
    }, 2000);
    return () => clearInterval(interval);
  }, [dateStr]);

  if (challenges.length === 0) return null;

  const allDone = challenges.every(c => completed.includes(c.id));
  const totalXP = challenges.reduce((sum, c) => sum + c.xpReward, 0) + (allDone ? BONUS_XP : 0);

  const tierColors = {
    easy: 'text-emerald-400',
    medium: 'text-yellow-400',
    hard: 'text-red-400',
    career: 'text-amber-400',
    dual: 'text-sky-400',
    online: 'text-fuchsia-400',
  };
  const categoryLabel = {
    career: 'CAREER',
    dual: 'DUAL',
    online: 'ONLINE',
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <h3 className="text-white font-black text-sm tracking-wide">Daily Challenges</h3>
          <p className="text-zinc-500 text-[10px]">{formatDate(dateStr)}</p>
        </div>
        {currentStreak >= 1 && (
          <div className="flex items-center gap-1 text-amber-400 text-xs font-black">
            🔥 {currentStreak}-Day Streak
          </div>
        )}
        <div className="text-zinc-500 text-[10px] font-bold">
          {completed.filter(id => challenges.some(c => c.id === id)).length}/{challenges.length} done
        </div>
      </div>

      {/* Challenge rows */}
      <div className="space-y-1.5">
        {challenges.map(challenge => {
          const isDone = completed.includes(challenge.id);
          return (
            <div
              key={challenge.id}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors ${
                isDone ? 'bg-emerald-950/30 border border-emerald-800/40' : 'bg-zinc-800/60 border border-zinc-700/40'
              }`}
            >
              {/* Icon */}
              <span className="text-base flex-shrink-0 w-6 text-center">{challenge.icon}</span>

              {/* Label with category pill */}
              <span className={`flex-1 min-w-0 text-xs font-semibold ${isDone ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}>
                {challenge.category && (
                  <span className={`mr-1.5 inline-block text-[9px] font-black tracking-wider align-middle ${tierColors[challenge.category] || 'text-zinc-500'}`}>
                    {categoryLabel[challenge.category] || challenge.category.toUpperCase()}
                  </span>
                )}
                <span className="align-middle">{challenge.label}</span>
              </span>

              {/* XP reward / checkmark */}
              {isDone ? (
                <span className="text-emerald-400 text-sm font-black flex-shrink-0">&#10003;</span>
              ) : (
                <span className={`text-[10px] font-bold flex-shrink-0 ${tierColors[challenge.category] || tierColors[challenge.tier] || 'text-zinc-400'}`}>
                  +{challenge.xpReward} XP
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* All-done bonus */}
      {allDone && (
        <div className="mt-2.5 text-center py-1.5 bg-emerald-950/40 border border-emerald-700/50 rounded-lg">
          <span className="text-emerald-400 font-black text-xs">All Done! +{BONUS_XP} XP Bonus</span>
        </div>
      )}
    </div>
  );
}
