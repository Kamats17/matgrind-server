// ─── CareerTrophy3DDetail ───────────────────────────────────────────────────
// Single-trophy detail modal. CSS-3D version (no three.js dependency for v1).
// Trophy auto-rotates; drag horizontally to spin manually. The plan calls
// for a real three.js mesh - that's a follow-up once `three` and
// `@react-three/fiber` are added to the project. The CSS version preserves
// the wow-moment shape (lazy loaded, big trophy, rotates) without paying
// the 200KB+ bundle cost up front.

import React, { useEffect, useRef, useState } from 'react';
import { trophyColors, trophyTypeLabel, trophyIcon } from '../../lib/career/careerTrophies.js';
import { getStateName } from '../../lib/career/careerStates.js';

export default function CareerTrophy3DDetail({ trophy, onClose }) {
  const [angle, setAngle] = useState(0);
  const [autoSpin, setAutoSpin] = useState(true);
  const dragRef = useRef({ active: false, startX: 0, startAngle: 0 });
  const c = trophyColors(trophy);
  const icon = trophyIcon(trophy);

  // Auto-rotate while not dragging
  useEffect(() => {
    if (!autoSpin) return;
    let raf = 0;
    const tick = () => {
      setAngle(a => a + 0.4);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoSpin]);

  const onPointerDown = (e) => {
    setAutoSpin(false);
    dragRef.current = { active: true, startX: e.clientX, startAngle: angle };
    try { e.target.setPointerCapture(e.pointerId); } catch {}
  };
  const onPointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    setAngle(dragRef.current.startAngle + dx * 0.7);
  };
  const onPointerUp = () => {
    dragRef.current.active = false;
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur flex flex-col"
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div
        className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-widest text-zinc-500">{trophyTypeLabel(trophy)}</div>
          <div className="text-base font-bold text-zinc-100 truncate">{trophy.name}</div>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 text-sm active:scale-95 transition flex-shrink-0 ml-3"
        >
          Close
        </button>
      </div>

      <div
        className="flex-1 flex items-center justify-center px-4 select-none touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <div
          style={{
            width: 240,
            height: 320,
            perspective: '1200px',
            cursor: dragRef.current.active ? 'grabbing' : 'grab',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              transform: `rotateY(${angle}deg) rotateX(4deg)`,
              transformStyle: 'preserve-3d',
              filter: `drop-shadow(0 24px 60px ${c.glow})`,
              transition: dragRef.current.active ? 'none' : 'transform 60ms linear',
            }}
          >
            {icon === 'cup' && <BigCup colors={c} />}
            {icon === 'medal' && <BigMedal colors={c} />}
            {icon !== 'cup' && icon !== 'medal' && <BigPlaque colors={c} />}
          </div>
        </div>
      </div>

      <div className="border-t border-zinc-800 px-4 py-4 max-w-md mx-auto w-full">
        <div className="grid grid-cols-2 gap-3 text-xs">
          {trophy.season != null && (
            <Detail label="Season" value={`Year ${trophy.season}`} />
          )}
          {trophy.weightClass != null && (
            <Detail label="Weight" value={`${trophy.weightClass} lbs`} />
          )}
          {trophy.state && (
            <Detail label="State" value={getStateName(trophy.state)} />
          )}
          {trophy.prestige && (
            <Detail
              label="Prestige"
              value={trophy.prestige}
              accent={trophy.prestige === 'gold' ? 'text-amber-300' : 'text-zinc-300'}
            />
          )}
        </div>
        <div className="mt-3 text-[10px] text-zinc-600 text-center">
          Drag to rotate · Auto-rotates while idle
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, accent = null }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="text-[9px] uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`text-sm font-bold mt-0.5 capitalize ${accent || 'text-zinc-200'}`}>{value}</div>
    </div>
  );
}

function BigCup({ colors }) {
  const c = colors;
  return (
    <div className="relative w-full h-full">
      <div style={{ position: 'absolute', top: 30, left: 50, width: 140, height: 100,
        borderRadius: '50% 50% 30% 30% / 60% 60% 40% 40%',
        background: `linear-gradient(135deg, ${c.primary} 0%, ${c.secondary} 100%)`,
        boxShadow: `inset -10px -6px 18px rgba(0,0,0,0.4), inset 8px 6px 14px rgba(255,255,255,0.5)`,
      }} />
      <div style={{ position: 'absolute', top: 50, left: 22, width: 28, height: 60, borderRadius: '50%', border: `8px solid ${c.primary}`, borderRight: 'none', boxShadow: `inset -3px 0 4px rgba(0,0,0,0.3)` }} />
      <div style={{ position: 'absolute', top: 50, right: 22, width: 28, height: 60, borderRadius: '50%', border: `8px solid ${c.primary}`, borderLeft: 'none', boxShadow: `inset 3px 0 4px rgba(0,0,0,0.3)` }} />
      <div style={{ position: 'absolute', top: 130, left: 100, width: 40, height: 50, background: `linear-gradient(180deg, ${c.secondary}, ${c.primary})` }} />
      <div style={{ position: 'absolute', top: 180, left: 60, width: 120, height: 38, background: `linear-gradient(180deg, ${c.primary}, ${c.secondary})`, borderRadius: 8, boxShadow: `0 6px 12px rgba(0,0,0,0.6)` }} />
      <div style={{ position: 'absolute', top: 218, left: 80, width: 80, height: 12, background: c.secondary, borderRadius: 2 }} />
    </div>
  );
}

function BigMedal({ colors }) {
  const c = colors;
  return (
    <div className="relative w-full h-full">
      <div style={{ position: 'absolute', top: 0, left: 90, width: 24, height: 110, background: '#1d4ed8', clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 90%, 0 100%)' }} />
      <div style={{ position: 'absolute', top: 0, right: 90, width: 24, height: 110, background: '#dc2626', clipPath: 'polygon(0 0, 100% 0, 100% 100%, 50% 90%, 0 100%)' }} />
      <div style={{ position: 'absolute', top: 80, left: 60, width: 120, height: 120, borderRadius: '50%',
        background: `radial-gradient(circle at 35% 30%, ${c.primary} 0%, ${c.secondary} 100%)`,
        boxShadow: `inset -8px -8px 18px rgba(0,0,0,0.4), inset 8px 8px 18px rgba(255,255,255,0.4)`,
      }} />
    </div>
  );
}

function BigPlaque({ colors }) {
  const c = colors;
  return (
    <div className="relative w-full h-full">
      <div style={{ position: 'absolute', top: 40, left: 30, width: 180, height: 200,
        background: `linear-gradient(135deg, ${c.primary}, ${c.secondary})`,
        border: `4px solid ${c.secondary}`,
        borderRadius: 8,
        boxShadow: `inset 0 4px 8px rgba(255,255,255,0.4), inset 0 -4px 8px rgba(0,0,0,0.5)`,
      }} />
      <div style={{ position: 'absolute', top: 70, left: 50, width: 140, height: 140,
        background: 'rgba(0,0,0,0.45)', borderRadius: 4,
      }} />
    </div>
  );
}
