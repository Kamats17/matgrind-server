import React, { useEffect, useState } from 'react';
import { nextTip } from '../../lib/matchTips.js';

export default function WelcomeScreen({ onLogin }) {
  // Rotating tip: shows a fresh tip every 5s so the reviewer sees multiple
  // hints (including a pointer to Game Center) during the sign-in pause.
  const [tipState, setTipState] = useState(() => nextTip(null));
  useEffect(() => {
    const id = setInterval(() => {
      setTipState((prev) => nextTip(prev.index));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="fixed inset-0 bg-zinc-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full text-center">
        {/* Logo */}
        <div className="mb-8">
          <div className="text-6xl font-black text-yellow-400 tracking-tight mb-2">PINNED</div>
          <div className="text-zinc-500 text-sm font-semibold uppercase tracking-[0.2em]">A Wrestling Card Game</div>
        </div>

        {/* Style badges */}
        <div className="flex justify-center gap-2 mb-8">
          <span className="px-3 py-1 rounded-full bg-yellow-500/10 border border-yellow-600/30 text-yellow-400 text-xs font-bold">Folkstyle</span>
          <span className="px-3 py-1 rounded-full bg-orange-500/10 border border-orange-600/30 text-orange-400 text-xs font-bold">Freestyle</span>
          <span className="px-3 py-1 rounded-full bg-red-500/10 border border-red-600/30 text-red-400 text-xs font-bold">Greco</span>
        </div>

        {/* Buttons */}
        <div className="space-y-3">
          <button
            onClick={onLogin}
            className="w-full bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black font-black py-3.5 rounded-xl transition-all tracking-wide text-sm"
          >
            LOG IN
          </button>
          <button
            onClick={onLogin}
            className="w-full bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold py-3.5 rounded-xl transition-all border border-zinc-700 text-sm"
          >
            CREATE ACCOUNT
          </button>
        </div>

        {/* Rotating tip */}
        <div className="mt-8 min-h-[44px]">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500/70 mb-1">TIP</div>
          <div key={tipState.index} className="text-zinc-400 text-xs leading-snug transition-opacity">
            {tipState.tip}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-zinc-700 text-xs">
          Takedowns, near-falls, pins - all on the mat.
        </div>
      </div>
    </div>
  );
}
