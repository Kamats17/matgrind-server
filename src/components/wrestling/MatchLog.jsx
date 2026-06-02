import React, { useEffect, useRef } from 'react';

const TYPE_STYLES = {
  takedown:       'text-emerald-400 font-semibold',
  escape:         'text-amber-400',
  reversal:       'text-yellow-300 font-semibold',
  near_fall:      'text-emerald-300 font-semibold',
  pin:            'text-red-400 font-black',
  tech_fall:      'text-purple-400 font-black',
  control:        'text-blue-300',
  counter:        'text-sky-400',
  scramble:       'text-yellow-300',
  stalemate:      'text-zinc-500',
  boundary_reset: 'text-amber-400',
  period:         'text-zinc-600 italic',
  setup:          'text-zinc-500',
  reset:          'text-zinc-600',
};

export default function MatchLog({ log }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log]);

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
      <div className="bg-zinc-950 px-3 py-2 flex items-center gap-2 border-b border-zinc-800">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        <span className="text-zinc-400 text-xs font-bold uppercase tracking-widest">Match Log</span>
        {log.length > 0 && (
          <span className="ml-auto text-zinc-700 text-xs font-mono">{log.length} actions</span>
        )}
      </div>
      <div className="h-40 overflow-y-auto px-3 py-2 space-y-0.5 scrollbar-thin">
        {log.length === 0 ? (
          <div className="text-zinc-700 text-xs italic text-center pt-8">No actions yet...</div>
        ) : (
          log.map((entry, i) => (
            <div key={i} className="flex gap-2 text-xs py-0.5 border-b border-zinc-800/40 last:border-0">
              <span className="text-zinc-700 shrink-0 tabular-nums w-5 text-right font-mono">{entry.round}</span>
              <div className="flex-1 min-w-0">
                <span className={TYPE_STYLES[entry.type] || 'text-zinc-400'}>{entry.entry}</span>
                {entry.position && (
                  <span className="ml-1.5 inline-block text-[9px] font-mono uppercase tracking-wider text-zinc-600 bg-zinc-950 border border-zinc-800 rounded px-1 align-middle">
                    {entry.position}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}