import React from 'react';
import { useColorblind } from '../../lib/ColorblindContext';
import { describeMatchPosition } from '../../lib/wrestlingEngine.js';

const POSITION_LABELS = { neutral: 'Neutral', top: 'Top', bottom: 'Bottom' };
const DEFAULT_P1_COLOR = '#34d399';
const DEFAULT_P2_COLOR = '#f87171';
const CB_P1_COLOR = '#38bdf8';
const CB_P2_COLOR = '#fbbf24';

export default function MatView({ state, p1Color, p2Color }) {
  const { p1, p2, initiative, chainActive, lastResult } = state;
  const { colorblind } = useColorblind();
  const isNeutral = p1.position === 'neutral' && p2.position === 'neutral';
  const p1IsTop = p1.position === 'top';

  const p1c = p1Color || (colorblind ? CB_P1_COLOR : DEFAULT_P1_COLOR);
  const p2c = p2Color || (colorblind ? CB_P2_COLOR : DEFAULT_P2_COLOR);

  const lastMsg = lastResult?.message;
  const lastType = lastResult?.type;

  const msgColor = {
    takedown: 'text-emerald-400',
    escape: 'text-amber-400',
    reversal: 'text-yellow-300',
    near_fall: 'text-emerald-300',
    pin: 'text-red-400',
    tech_fall: 'text-purple-400',
    counter: 'text-sky-400',
    control: 'text-blue-300',
    scramble: 'text-yellow-300',
    boundary_reset: 'text-amber-400',
    period: 'text-zinc-500',
    setup: 'text-zinc-400',
    stalemate: 'text-zinc-400',
    defense: 'text-zinc-400',
  };

  const positionIcon = (pos, isP1) => {
    const color = isP1 ? p1c : p2c;
    if (pos === 'top') return <span className="text-xl font-black" style={{ color }}>▲</span>;
    if (pos === 'bottom') return <span className="text-xl font-black" style={{ color }}>▼</span>;
    return <span className="text-xl font-black" style={{ color }}>◆</span>;
  };

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-700 overflow-hidden">
      <div className="relative h-36 flex items-center justify-between px-6 bg-zinc-950">
        {/* Mat circle rings */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-28 h-28 rounded-full border border-zinc-800 opacity-60" />
          <div className="absolute w-20 h-20 rounded-full border border-zinc-800 opacity-40" />
          <div className="absolute w-10 h-10 rounded-full border border-zinc-800 opacity-30" />
        </div>

        {/* Chain indicator */}
        {chainActive && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
            <span className="bg-purple-900 border border-purple-700 text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">
              CHAIN
            </span>
          </div>
        )}

        {/* P1 */}
        <div className="flex flex-col items-center gap-1 z-10">
          <div className={`transition-transform duration-200 ${initiative === 'p1' ? 'scale-125' : 'scale-100'}`}>
            {positionIcon(p1.position, true)}
          </div>
          <div className="text-xs font-bold" style={{ color: p1c }}>{p1.name}</div>
          <div className={`text-xs px-2 py-0.5 rounded font-bold ${
            p1.position === 'top' ? 'bg-yellow-900/60 text-yellow-300' :
            p1.position === 'bottom' ? 'bg-zinc-800 text-zinc-400' :
            'bg-zinc-800 text-zinc-400'
          }`}>{POSITION_LABELS[p1.position]}</div>
          {initiative === 'p1' && (
            <span className="text-yellow-400 text-xs font-black">⚡ INIT</span>
          )}
        </div>

        {/* Center */}
        <div className="text-center z-10 px-4">
          {isNeutral ? (
            <div className="text-zinc-600 text-xs font-bold uppercase tracking-widest">Neutral</div>
          ) : (
            <div className="flex flex-col items-center gap-0.5">
              <div className="text-zinc-400 text-xs font-semibold">{p1IsTop ? p1.name : p2.name}</div>
              <div className="text-yellow-400 text-xs font-black tracking-wide">ON TOP</div>
              <div className="w-px h-3 bg-zinc-700" />
              <div className="text-zinc-500 text-xs font-black tracking-wide">BOTTOM</div>
              <div className="text-zinc-400 text-xs font-semibold">{p1IsTop ? p2.name : p1.name}</div>
            </div>
          )}
        </div>

        {/* P2 */}
        <div className="flex flex-col items-center gap-1 z-10">
          <div className={`transition-transform duration-200 ${initiative === 'p2' ? 'scale-125' : 'scale-100'}`}>
            {positionIcon(p2.position, false)}
          </div>
          <div className="text-xs font-bold" style={{ color: p2c }}>{p2.name}</div>
          <div className={`text-xs px-2 py-0.5 rounded font-bold ${
            p2.position === 'top' ? 'bg-yellow-900/60 text-yellow-300' :
            p2.position === 'bottom' ? 'bg-zinc-800 text-zinc-400' :
            'bg-zinc-800 text-zinc-400'
          }`}>{POSITION_LABELS[p2.position]}</div>
          {initiative === 'p2' && (
            <span className="text-yellow-400 text-xs font-black">⚡ INIT</span>
          )}
        </div>
      </div>

      {/* Position chip - persistent state-of-the-mat indicator. Always
          visible, always current. Tells the player WHERE the action stands
          (FHL, leg secured, on base, broken down, scramble, etc.) so the
          next card pick is informed. */}
      {(() => {
        const { tag, tone } = describeMatchPosition(state);
        if (!tag) return null;
        const toneCls = tone === 'urgent'
          ? 'bg-amber-950/60 border-amber-700 text-amber-200'
          : tone === 'top'
            ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
            : tone === 'bottom'
              ? 'bg-rose-950/40 border-rose-800 text-rose-200'
              : 'bg-zinc-900 border-zinc-800 text-zinc-300';
        return (
          <div className="border-t border-zinc-800 px-4 py-1 flex items-center justify-center bg-zinc-950">
            <span className={`text-[10px] font-black uppercase tracking-[0.18em] px-2 py-0.5 rounded border ${toneCls}`}>
              {tag}
            </span>
          </div>
        );
      })()}

      {/* Cards played banner */}
      {lastResult?.p1CardName && lastResult?.p2CardName && (
        <div className="border-t border-zinc-800 px-4 py-1.5 flex items-center justify-between bg-zinc-950/80">
          <span className="text-xs font-bold" style={{ color: p1c }}>{lastResult.p1CardName}</span>
          <span className="text-zinc-600 text-xs font-semibold">vs</span>
          <span className="text-xs font-bold" style={{ color: p2c }}>{lastResult.p2CardName}</span>
        </div>
      )}

      {/* Action banner */}
      <div className="border-t border-zinc-800 px-4 py-2 min-h-[36px] flex items-center justify-center bg-zinc-900/90">
        {lastMsg ? (
          <p className={`text-xs font-semibold text-center ${msgColor[lastType] || 'text-zinc-300'}`}>
            {lastMsg}
          </p>
        ) : (
          <p className="text-zinc-700 text-xs text-center italic">Waiting for first move...</p>
        )}
      </div>
    </div>
  );
}