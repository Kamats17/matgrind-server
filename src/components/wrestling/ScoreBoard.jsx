import React from 'react';
import { useColorblind, p1TextClass, p2TextClass } from '../../lib/ColorblindContext';

const MAX_STAMINA = 200;

const POSITION_LABELS = { neutral: 'NEUTRAL', top: 'TOP', bottom: 'BOTTOM' };

// Short codes for condition chips so 3+ active buffs don't wrap to new lines
// and push the picker down. Falls back to the prettified id when absent.
const CONDITION_SHORT = {
  front_headlock_control: 'FHL',
  front_headlock_trapped: 'FHL×',
  control_established: 'CTRL',
  top_pressure: 'PRESS',
  broken_down: 'BD',
  good_base: 'BASE',
  base_built: 'BASE+',
  hand_fighting: 'HF',
  hand_fighting_control: 'HF',
  recovering: 'REC',
  inside_position: 'IN',
  leg_attack_secured: 'LEG',
  leg_attack_trapped: 'LEG×',
  scramble: 'SCR',
  tie_up: 'TIE',
  rear_standing: 'REAR',
};
const shortCond = (c) => CONDITION_SHORT[c] || c.replace(/_/g, ' ');

function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Stamina reads at a glance: thicker bar + segmented pip overlay + bolder
// numerics. Under 25% the whole gauge pulses red so fatigue is impossible
// to miss - it's the single biggest strategic signal in the match UI and
// used to be an afterthought 1.5px stripe. Pips divide the gauge into 5
// chunks so the player sees "4/5 left" not just "some blue bar."
function StaminaBar({ value, color }) {
  const pct = Math.max(0, Math.min(100, (value / MAX_STAMINA) * 100));
  const isLow = pct <= 25;
  const isMid = pct <= 50 && !isLow;
  const barColor = isLow ? 'bg-red-600' : isMid ? 'bg-amber-500' : color;
  const label = isLow ? 'LOW' : isMid ? 'TIRED' : 'FRESH';
  const labelColor = isLow ? 'text-red-400' : isMid ? 'text-amber-400' : 'text-emerald-400';
  const glow = isLow ? 'shadow-[0_0_10px_rgba(239,68,68,0.6)]' : '';
  return (
    <div className={isLow ? 'animate-pulse' : ''}>
      <div className="flex items-center justify-between mb-0.5">
        <span className="flex items-center gap-0.5">
          <span className={`text-[9px]`} aria-hidden="true">⚡</span>
          <span className={`text-[10px] font-black tracking-wider ${labelColor}`}>{label}</span>
        </span>
        <span className="text-zinc-300 text-[11px] font-mono font-bold">
          {Math.round(value)}<span className="text-zinc-600 text-[9px]">/{MAX_STAMINA}</span>
        </span>
      </div>
      <div className={`relative h-3 w-full bg-zinc-800 rounded-full overflow-hidden border border-zinc-700 ${glow}`}>
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
        {/* Pip dividers - 5 chunks, 4 dividers at 20/40/60/80% */}
        <div className="absolute inset-0 flex pointer-events-none">
          {[20, 40, 60, 80].map(p => (
            <div key={p} className="absolute top-0 bottom-0 w-px bg-zinc-950/70" style={{ left: `${p}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ScoreBoard({ state }) {
  const { p1, p2, period, clock, momentum, p1Conditions, p2Conditions, neutralStaleCount, wrestlingStyle, activityClock, maxPeriods, phase, stallCount } = state;
  const { colorblind } = useColorblind();
  const p1Cls = p1TextClass(colorblind);
  const p2Cls = p2TextClass(colorblind);
  const p1Dot = colorblind ? 'bg-sky-500' : 'bg-emerald-500';
  const p2Dot = colorblind ? 'bg-amber-500' : 'bg-red-500';
  const p1Bar = colorblind ? 'bg-sky-500' : 'bg-emerald-500';
  const p2Bar = colorblind ? 'bg-amber-500' : 'bg-red-500';
  const p1CondBg = colorblind ? 'bg-sky-900/40 text-sky-400 border-sky-800/50' : 'bg-emerald-900/40 text-emerald-400 border-emerald-800/50';
  const p2CondBg = colorblind ? 'bg-amber-900/40 text-amber-400 border-amber-800/50' : 'bg-red-900/40 text-red-400 border-red-800/50';
  const p1Label = colorblind ? 'BLU' : 'GRN';
  const p2Label = colorblind ? 'AMB' : 'RED';
  const isFreestyle = wrestlingStyle === 'freestyle';
  const isGreco = wrestlingStyle === 'greco';
  const isWomensFreestyle = wrestlingStyle === 'womens_freestyle';
  // International ruleset = freestyle + greco + women's freestyle.
  const isIntl = isFreestyle || isGreco || isWomensFreestyle;
  const totalPeriods = maxPeriods || (isIntl ? 2 : 3);
  const lead = p1.score - p2.score;
  const clockStr = formatClock(clock);
  const isUrgent = clock <= 30;
  const isOvertime = phase === 'overtime';
  const showPassivityWarning = isIntl && (activityClock || 0) >= 3;
  const showStallingWarning = !isIntl && neutralStaleCount >= 3;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden">
      {/* Period / Clock / Lead bar */}
      <div className="flex items-center justify-between px-2 py-1 bg-zinc-950 border-b border-zinc-800">
        <div className="flex items-center gap-1.5">
          {isOvertime ? (
            <span className="text-purple-400 text-xs font-black uppercase tracking-wider">OT</span>
          ) : (
            <>
              <span className="text-zinc-600 text-xs font-bold uppercase tracking-wider">P</span>
              <div className="flex gap-1">
                {Array.from({length: totalPeriods}, (_, i) => i + 1).map(n => (
                  <div key={n} className={`w-5 h-5 rounded text-xs font-black flex items-center justify-center ${
                    n < period ? 'bg-zinc-700 text-zinc-400' :
                    n === period ? (isWomensFreestyle ? 'bg-teal-500 text-black' : isGreco ? 'bg-red-500 text-black' : isFreestyle ? 'bg-orange-500 text-black' : 'bg-yellow-500 text-black') :
                    'bg-zinc-800 text-zinc-600'
                  }`}>{n}</div>
                ))}
              </div>
            </>
          )}
          {isGreco && (
            <span className="text-red-400 text-xs font-bold ml-1">GR</span>
          )}
          {isFreestyle && (
            <span className="text-orange-400 text-xs font-bold ml-1">FS</span>
          )}
          {isWomensFreestyle && (
            <span className="text-teal-400 text-xs font-bold ml-1">WFS</span>
          )}
        </div>
        <div className={`font-mono font-black text-lg tracking-wider ${isUrgent ? 'text-red-400 animate-pulse' : 'text-white'}`}>
          {clockStr}
        </div>
        <div className="flex items-center gap-1.5">
          {showPassivityWarning && (
            <span className="text-amber-400 text-xs font-black animate-pulse" title="Passivity warning">⚠</span>
          )}
          {showStallingWarning && (
            <span className="text-amber-400 text-xs font-black animate-pulse">⚠</span>
          )}
          <div className="text-xs font-bold">
            {lead > 0 ? <span className={p1Cls}>{p1Label} +{lead}</span> :
             lead < 0 ? <span className={p2Cls}>{p2Label} +{Math.abs(lead)}</span> :
             <span className="text-zinc-500">TIED</span>}
          </div>
        </div>
      </div>

      {/* Wrestlers */}
      <div className="grid grid-cols-3 gap-0">
        {/* P1 */}
        <div className="px-2 py-1.5 border-r border-zinc-800">
          <div className="flex items-center gap-1 mb-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${p1Dot} flex-shrink-0`} />
            <span className={`${p1Cls} font-bold text-[10px] truncate`}>{p1.name}</span>
            {momentum === 'p1' && <span className="text-yellow-400 text-[10px] ml-auto">⚡</span>}
          </div>
          <div className="flex items-center gap-1 mb-0.5">
            <div className="text-white font-black text-2xl leading-none" aria-live="polite" aria-label={`${p1.name}: ${p1.score} points`}>{p1.score}</div>
            {stallCount?.p1 > 0 && (
              <span
                className="text-amber-400 text-[10px] font-black bg-amber-950/60 border border-amber-700/50 rounded px-1 py-0.5"
                title={`Stalling warnings: ${stallCount.p1}/2`}
              >⚠×{stallCount.p1}</span>
            )}
          </div>
          <div className={`inline-block text-[10px] font-bold px-1 py-0.5 rounded mb-1 ${
            p1.position === 'top' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-600/40' :
            p1.position === 'bottom' ? 'bg-zinc-700 text-zinc-400 border border-zinc-600' :
            'bg-zinc-800 text-zinc-400 border border-zinc-700'
          }`}>{POSITION_LABELS[p1.position]}</div>
          <StaminaBar value={p1.stamina} color={p1Bar} />
          {p1Conditions?.length > 0 && (
            <div className="flex gap-0.5 mt-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {p1Conditions.map(c => (
                <span key={c} className={`text-[10px] ${p1CondBg} px-1 py-0.5 rounded leading-tight border flex-shrink-0 uppercase tracking-wide font-bold`}>
                  {shortCond(c)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Center - position image */}
        <div className="flex flex-col items-center justify-center py-1 px-1 bg-zinc-950 rounded-lg mx-0.5 my-0.5">
          {(() => {
            const isNeutral = p1.position === 'neutral' && p2.position === 'neutral';
            const p1IsTop = p1.position === 'top';
            if (isNeutral) {
              return <img src="/positions/neutral.png" alt="Neutral" className="h-16 object-contain" draggable={false} />;
            }
            return <img src={p1IsTop ? '/positions/green-top.png' : '/positions/red-top.png'} alt={p1IsTop ? 'Green top' : 'Red top'} className="h-14 object-contain" draggable={false} />;
          })()}
          <div className="text-zinc-500 text-[10px] font-bold mt-0.5">
            {lead > 0 ? <span className={p1Cls}>{p1Label} +{lead}</span> :
             lead < 0 ? <span className={p2Cls}>{p2Label} +{Math.abs(lead)}</span> :
             <span>EVEN</span>}
          </div>
        </div>

        {/* P2 */}
        <div className="px-2 py-1.5 border-l border-zinc-800">
          <div className="flex items-center gap-1 mb-0.5 flex-row-reverse">
            <div className={`w-1.5 h-1.5 rounded-full ${p2Dot} flex-shrink-0`} />
            <span className={`${p2Cls} font-bold text-[10px] truncate text-right`}>{p2.name}</span>
            {momentum === 'p2' && <span className="text-yellow-400 text-[10px] mr-auto">⚡</span>}
          </div>
          <div className="flex items-center justify-end gap-1 mb-0.5">
            {stallCount?.p2 > 0 && (
              <span
                className="text-amber-400 text-[10px] font-black bg-amber-950/60 border border-amber-700/50 rounded px-1 py-0.5"
                title={`Stalling warnings: ${stallCount.p2}/2`}
              >⚠×{stallCount.p2}</span>
            )}
            <div className="text-white font-black text-2xl leading-none text-right" aria-live="polite" aria-label={`${p2.name}: ${p2.score} points`}>{p2.score}</div>
          </div>
          <div className={`inline-block text-[10px] font-bold px-1 py-0.5 rounded mb-1 float-right ${
            p2.position === 'top' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-600/40' :
            p2.position === 'bottom' ? 'bg-zinc-700 text-zinc-400 border border-zinc-600' :
            'bg-zinc-800 text-zinc-400 border border-zinc-700'
          }`}>{POSITION_LABELS[p2.position]}</div>
          <div className="clear-both" />
          <StaminaBar value={p2.stamina} color={p2Bar} />
          {p2Conditions?.length > 0 && (
            <div className="flex gap-0.5 mt-1 justify-end overflow-x-auto whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {p2Conditions.map(c => (
                <span key={c} className={`text-[10px] ${p2CondBg} px-1 py-0.5 rounded leading-tight border flex-shrink-0 uppercase tracking-wide font-bold`}>
                  {shortCond(c)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
