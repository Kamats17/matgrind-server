import React, { useEffect, useState } from 'react';
import {
  getState as getQueueState,
  onState as onQueueState,
  cancelQueue,
} from '../../lib/queueManager.js';

export default function QueueBanner() {
  const [snap, setSnap] = useState(() => getQueueState());
  const [, tick] = useState(0);

  useEffect(() => onQueueState(setSnap), []);

  useEffect(() => {
    if (snap.status !== 'searching') return;
    const id = setInterval(() => tick((n) => (n + 1) % 1000), 1000);
    return () => clearInterval(id);
  }, [snap.status]);

  const { status, startedAt } = snap;
  if (status !== 'searching' && status !== 'connecting' && status !== 'reconnecting') return null;

  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const label =
    status === 'connecting' ? 'Connecting…' :
    status === 'reconnecting' ? 'Reconnecting…' :
    `Searching  ${mm}:${ss}`;

  return (
    <div
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
      className="fixed top-0 left-0 right-0 z-[110] pointer-events-auto"
    >
      <div className="bg-zinc-900/80 backdrop-blur-sm border-b border-amber-500/20 flex items-center justify-between px-4 h-10">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-xs font-black uppercase tracking-wider text-amber-200">{label}</span>
        </div>
        <button
          onClick={cancelQueue}
          aria-label="Cancel search"
          className="text-zinc-500 hover:text-white text-sm font-bold transition-colors leading-none pl-3"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
