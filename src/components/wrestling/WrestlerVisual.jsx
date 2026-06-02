import React from 'react';

// ─── Position visuals using actual wrestling silhouette images ──────────────
// Neutral: logo/neutral image, Ground: green-top/red-top, FHL: SVG fallback

const DEFAULT_P1 = { primary: '#34d399', dark: '#059669' };
const DEFAULT_P2 = { primary: '#f87171', dark: '#dc2626' };

// ── Neutral: Logo image showing two wrestlers facing off ──────────────────
function NeutralImage() {
  return (
    <img
      src="/positions/neutral.png"
      alt="Neutral position"
      className="w-full h-full object-contain"
      draggable={false}
    />
  );
}

// ── Ground: Silhouette images showing who is in control ───────────────────
function GroundImage({ p1IsTop }) {
  return (
    <img
      src={p1IsTop ? '/positions/green-top.png' : '/positions/red-top.png'}
      alt={p1IsTop ? 'Green wrestler on top' : 'Red wrestler on top'}
      className="w-full h-full object-contain"
      draggable={false}
    />
  );
}

// ── Front Headlock: SVG fallback (no image provided) ──────────────────────
function FrontHeadlockSVG({ p1HasControl, p1Colors, p2Colors }) {
  const ctrlFill = p1HasControl ? p1Colors.primary : p2Colors.primary;
  const ctrlDark = p1HasControl ? p1Colors.dark : p2Colors.dark;
  const trapFill = p1HasControl ? p2Colors.primary : p1Colors.primary;
  const trapDark = p1HasControl ? p2Colors.dark : p1Colors.dark;

  return (
    <svg viewBox="0 0 320 150" className="w-full h-full">
      <g>
        <ellipse cx="148" cy="78" rx="11" ry="12" fill={trapFill} />
        <path d="M140 88 Q130 92 118 98 Q108 104 100 112 L110 118 Q116 110 126 102 Q136 96 144 92 Z" fill={trapFill} />
        <path d="M100 112 Q94 120 90 130 L102 134 Q105 126 110 118 Z" fill={trapFill} />
        <path d="M130 96 Q122 108 118 122 Q116 130 116 136 L126 136 Q126 128 128 120 Q132 108 138 98 Z" fill={trapDark} />
        <path d="M145 90 Q152 100 155 112 Q156 120 156 126 L146 126 Q146 118 145 110 Q142 100 140 94 Z" fill={trapDark} />
        <path d="M90 130 Q82 136 76 142 L88 146 Q92 140 98 134 Z" fill={trapFill} />
        <path d="M100 126 Q108 134 115 142 L104 146 Q98 138 92 130 Z" fill={trapDark} />
      </g>
      <g>
        <ellipse cx="172" cy="34" rx="13" ry="14" fill={ctrlFill} />
        <path d="M166 46 Q160 52 155 60 Q150 68 148 76 L158 80 Q160 72 164 64 Q168 56 172 50 Z" fill={ctrlFill} />
        <path d="M172 48 Q178 56 182 66 Q184 74 184 80 L174 80 Q174 72 172 64 Q168 54 166 48 Z" fill={ctrlDark} />
        <path d="M155 62 Q148 68 142 74 Q138 78 136 82 L144 86 Q146 82 150 76 Q156 70 160 66 Z" fill={ctrlFill} />
        <path d="M178 64 Q172 72 166 78 Q160 84 158 86 L164 90 Q168 86 174 80 Q180 72 184 66 Z" fill={ctrlDark} />
        <path d="M158 78 Q170 92 185 108 Q196 120 208 132 Q216 138 222 142 L214 148 Q206 142 196 132 Q184 120 172 106 Q162 94 152 82 Z" fill={ctrlFill} />
        <path d="M178 80 Q188 94 200 112 Q210 126 220 136 Q226 140 232 144 L224 148 Q218 144 208 134 Q196 122 186 108 Q176 92 170 82 Z" fill={ctrlDark} />
        <ellipse cx="138" cy="83" rx="5" ry="4" fill={ctrlDark} />
        <ellipse cx="160" cy="88" rx="5" ry="4" fill={ctrlDark} />
      </g>
    </svg>
  );
}

export default function WrestlerVisual({ state, p1Colors: p1ColorsOverride, p2Colors: p2ColorsOverride }) {
  const { p1, p2, p1Conditions, p2Conditions } = state;
  const p1Colors = p1ColorsOverride || DEFAULT_P1;
  const p2Colors = p2ColorsOverride || DEFAULT_P2;
  const p1Conds = p1Conditions || [];
  const p2Conds = p2Conditions || [];
  const isNeutral = p1.position === 'neutral' && p2.position === 'neutral';
  const p1IsTop = p1.position === 'top';

  const fhlActive = p1Conds.includes('front_headlock_control') ||
                    p2Conds.includes('front_headlock_control');
  const p1HasFHLControl = p1Conds.includes('front_headlock_control');

  const legAttackActive = p1Conds.includes('leg_attack_secured') ||
                          p2Conds.includes('leg_attack_secured');
  const scrambleActive = p1Conds.includes('scramble');
  const tieUpActive = p1Conds.includes('tie_up') || p2Conds.includes('tie_up');

  let posLabel = 'Neutral';
  if (fhlActive) posLabel = 'Front Headlock';
  else if (legAttackActive) posLabel = 'Leg Attack';
  else if (scrambleActive) posLabel = 'Scramble';
  else if (tieUpActive) posLabel = 'Tie-Up';
  else if (!isNeutral) posLabel = p1IsTop ? `${p1.name} TOP` : `${p2.name} TOP`;

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="relative">
        {/* Position diagram - compact to fit single screen */}
        <div className="flex items-center justify-center bg-zinc-900 rounded-lg mx-2 my-1" style={{ height: isNeutral ? 90 : 68 }}>
          <div className="h-full flex items-center justify-center" style={{ maxWidth: isNeutral ? 240 : 180 }}>
            {fhlActive ? (
              <FrontHeadlockSVG p1HasControl={p1HasFHLControl} p1Colors={p1Colors} p2Colors={p2Colors} />
            ) : isNeutral ? (
              <NeutralImage />
            ) : (
              <GroundImage p1IsTop={p1IsTop} />
            )}
          </div>
        </div>

        {/* Compact position label */}
        <div className="absolute inset-x-0 bottom-0 flex justify-center pointer-events-none pb-0.5">
          <span className="text-zinc-500 text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-900/80">
            {posLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
