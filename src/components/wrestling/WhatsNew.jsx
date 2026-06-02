import React, { useState, useEffect } from 'react';
import { APP_VERSION } from '../../lib/version';

const RELEASE_NOTES = {
  '1.1.0': {
    date: '2026-04-16',
    highlights: [
      { icon: '🏆', text: 'Trophy Case - show off your achievements on your profile' },
      { icon: '🎯', text: 'Daily Challenges - 3 new challenges every day for bonus XP' },
      { icon: '👑', text: 'Leaderboard Banners - top 8 players get special flair' },
      { icon: '🔥', text: 'Streak Rewards - play daily for XP bonuses' },
    ],
  },
  '1.0.0': {
    date: '2026-04-15',
    highlights: [
      { icon: '🤼', text: 'Folkstyle, Freestyle, and Greco-Roman wrestling' },
      { icon: '🤖', text: 'AI opponents with Easy, Medium, and Hard difficulty' },
      { icon: '🌐', text: 'Online multiplayer battles' },
      { icon: '🏟️', text: 'Tournament mode with brackets' },
      { icon: '📌', text: '150+ wrestling technique cards' },
      { icon: '🏅', text: 'Achievements, leaderboards, and match replays' },
    ],
  },
};

const STORAGE_KEY = 'matgrind_last_seen_version';

export default function WhatsNew() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const lastSeen = localStorage.getItem(STORAGE_KEY);
      if (lastSeen !== APP_VERSION) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, APP_VERSION);
    } catch {
      // localStorage unavailable
    }
  };

  if (!visible) return null;

  const notes = RELEASE_NOTES[APP_VERSION];
  if (!notes) {
    // No notes for this version - silently mark as seen
    try { localStorage.setItem(STORAGE_KEY, APP_VERSION); } catch {}
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="What's new">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-b from-yellow-950/40 to-transparent border-b border-zinc-800 px-5 pt-5 pb-4">
          <div className="text-yellow-400 text-xs font-black uppercase tracking-[0.2em] mb-1">What's New</div>
          <div className="text-white text-2xl font-black">v{APP_VERSION}</div>
          <div className="text-zinc-500 text-xs mt-0.5">{notes.date}</div>
        </div>

        {/* Content */}
        <div className="px-5 py-4 max-h-64 overflow-y-auto">
          <div className="space-y-3">
            {notes.highlights.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="text-lg shrink-0 mt-0.5">{item.icon}</span>
                <span className="text-sm text-zinc-300 leading-tight">{item.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Dismiss */}
        <div className="px-5 pb-5 pt-2">
          <button
            onClick={dismiss}
            className="w-full bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black font-black py-3 rounded-xl transition-all text-sm tracking-wide"
          >
            LET'S GO
          </button>
        </div>
      </div>
    </div>
  );
}
