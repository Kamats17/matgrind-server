import React, { useEffect, useState } from 'react';

/**
 * Floating pill shown whenever the player is in the background matchmaking
 * queue. Renders nothing when status is 'idle'. Fixed-position bottom-right
 * so it overlays every screen without colliding with a specific layout.
 *
 * Props:
 *   status          - 'connecting' | 'searching' | 'reconnecting' | 'timed_out' | 'error' | 'found' | 'idle'
 *   startedAt       - ms epoch; null when idle
 *   errorMessage    - string, shown when status ∈ {error, timed_out}
 *   onCancel        - called when user taps Cancel (terminal states also treat as dismiss)
 *   hidden          - force-hide even when active (e.g. during a live tournament bout)
 */
export default function QueuePill({ status, startedAt, errorMessage, onCancel, hidden }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'searching' && status !== 'connecting' && status !== 'reconnecting') return;
    const id = setInterval(() => tick((n) => (n + 1) % 1000), 1000);
    return () => clearInterval(id);
  }, [status]);

  if (status === 'idle' || status === 'found') return null;
  if (hidden) return null;

  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  const mm = String(Math.floor(elapsed / 60)).padStart(1, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  const label =
    status === 'searching' ? `Searching ${mm}:${ss}` :
    status === 'connecting' ? 'Connecting…' :
    status === 'reconnecting' ? 'Reconnecting…' :
    status === 'timed_out' ? 'No opponent' :
    status === 'error' ? 'Queue error' :
    '';

  const tone =
    status === 'error' || status === 'timed_out'
      ? 'border-red-500/60 bg-red-950/80 text-red-200'
      : 'border-amber-500/60 bg-zinc-900/95 text-amber-200';

  const dotTone =
    status === 'error' || status === 'timed_out'
      ? 'bg-red-400'
      : status === 'reconnecting'
        ? 'bg-orange-400 animate-ping'
        : 'bg-amber-400 animate-pulse';

  return (
    <div
      className={`fixed bottom-4 right-4 z-[100] pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-full border shadow-lg backdrop-blur-sm ${tone}`}
      role="status"
      aria-live="polite"
    >
      <span className={`w-2 h-2 rounded-full ${dotTone}`} />
      <span className="text-xs font-black uppercase tracking-wider">{label}</span>
      {(status === 'error' || status === 'timed_out') && errorMessage && (
        <span className="text-[10px] text-zinc-400 max-w-[140px] truncate" title={errorMessage}>
          · {errorMessage}
        </span>
      )}
      <button
        onClick={onCancel}
        className="ml-1 text-[10px] font-bold text-zinc-400 hover:text-white uppercase tracking-wider"
      >
        {status === 'error' || status === 'timed_out' ? 'Dismiss' : 'Cancel'}
      </button>
    </div>
  );
}
