import React, { useEffect, useRef } from 'react';

export default function MoveTimer({ seconds, maxSeconds = 30, paused = false, onExpire }) {
  const expiredRef = useRef(false);

  useEffect(() => {
    if (seconds <= 0 && !paused && !expiredRef.current) {
      expiredRef.current = true;
      onExpire?.();
    }
    if (seconds > 0) {
      expiredRef.current = false;
    }
  }, [seconds, paused, onExpire]);

  const pct = Math.max(0, (seconds / maxSeconds) * 100);
  const color = seconds > 15 ? 'bg-emerald-500' : seconds > 5 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div
        className={`h-full ${color} transition-all duration-1000 ease-linear ${seconds <= 5 && !paused ? 'animate-pulse' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
