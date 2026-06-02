import React from 'react';
import { loadReplays, deleteReplay, clearAllReplays } from '../../lib/replaySystem.js';
import NavBar from '../ui/NavBar';

const METHOD_LABELS = {
  pin: 'PIN', tech_fall: 'TECH', decision: 'DEC', draw: 'DRAW', overtime: 'OT',
};

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function ReplayList({ onWatch, onBack }) {
  const [replays, setReplays] = React.useState(() => loadReplays());

  const handleDelete = (id) => {
    deleteReplay(id);
    setReplays(loadReplays());
  };

  const handleClearAll = () => {
    clearAllReplays();
    setReplays([]);
  };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Replays" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-md md:max-w-2xl mx-auto w-full">
        {replays.length === 0 ? (
          <div className="text-center text-zinc-600 text-sm mt-16">
            <div className="text-3xl mb-3">🎬</div>
            No replays yet. Finish a match to save one automatically.
          </div>
        ) : (
          <div className="space-y-2">
            {replays.map(r => (
              <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">
                    {r.config.p1Name} vs {r.config.p2Name}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-zinc-500 text-xs">{formatDate(r.timestamp)}</span>
                    {r.result && (
                      <>
                        <span className="text-zinc-700">|</span>
                        <span className="text-xs font-bold text-zinc-400">
                          {r.result.p1Score}-{r.result.p2Score}
                        </span>
                        <span className="text-xs text-zinc-600">
                          {METHOD_LABELS[r.result.winMethod] || 'DEC'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onWatch(r)}
                  className="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-black text-xs font-black rounded-lg transition-all active:scale-95"
                >
                  Watch
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="px-2 py-1.5 text-zinc-600 hover:text-red-400 text-xs transition-colors"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {replays.length > 1 && (
          <button
            onClick={handleClearAll}
            className="mt-6 w-full py-2 rounded-lg border border-zinc-800 text-zinc-600 hover:text-red-400 hover:border-red-900 text-xs font-bold uppercase transition-all"
          >
            Clear All Replays
          </button>
        )}
      </div>
    </div>
  );
}
