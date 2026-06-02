import React, { useState } from 'react';
import SingletTemplate from './SingletTemplate.jsx';
import {
  SINGLET_DEFAULTS,
  SINGLET_COLORS,
  buildSinglet,
} from '../../lib/singletDesign.js';

// Editor for the singlet design. Controlled component: parent owns state.
// On any swatch click or input edit, calls `onChange(nextSingletObject)`.
//
// Props:
//   value     full singlet object (shape from SINGLET_DEFAULTS); falls back
//             to defaults if undefined / null
//   onChange  (nextSinglet) => void
//   defaults  optional { teamText, lastNameText, weightClassText } pre-fill
//             values so an empty editor shows the user's existing username/
//             team/weight class as a starting point. User can override.
export default function SingletCreator({ value, onChange, defaults }) {
  const singlet = buildSinglet(value, defaults);
  const [bigView, setBigView] = useState('front');

  const setField = (key, val) => {
    onChange({ ...singlet, [key]: val });
  };

  return (
    <div className="space-y-4">
      {/* Preview: front + back side by side. Larger one is the active view;
          tap rotate to swap. */}
      <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
        <div className="flex justify-center items-end gap-3 flex-wrap">
          <SingletPreview view="front" singlet={singlet} large={bigView === 'front'} />
          <SingletPreview view="back"  singlet={singlet} large={bigView === 'back'}  />
        </div>
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => setBigView(bigView === 'front' ? 'back' : 'front')}
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
          >
            Rotate
          </button>
        </div>
      </div>

      {/* Zone color pickers */}
      <ZoneRow label="Chest"  zone="chestColor"  current={singlet.chestColor}  onPick={hex => setField('chestColor', hex)} />
      <ZoneRow label="Sides"  zone="sidesColor"  current={singlet.sidesColor}  onPick={hex => setField('sidesColor', hex)} />
      <ZoneRow label="Text"   zone="textColor"   current={singlet.textColor}   onPick={hex => setField('textColor', hex)} />

      {/* Text fields */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
        <TextField
          label="Team Name (chest)"
          value={singlet.teamText}
          maxLength={25}
          onChange={v => setField('teamText', v)}
        />
        <TextField
          label="Wrestler Last Name (back)"
          value={singlet.lastNameText}
          maxLength={20}
          onChange={v => setField('lastNameText', v)}
        />
        <TextField
          label="Weight Class (lbs)"
          value={singlet.weightClassText}
          maxLength={4}
          inputMode="numeric"
          onChange={v => setField('weightClassText', v)}
        />
      </div>
    </div>
  );
}

function SingletPreview({ view, singlet, large }) {
  const width = large ? 200 : 100;
  return (
    <div className="flex flex-col items-center gap-1">
      <div style={{ opacity: large ? 1 : 0.85 }}>
        <SingletTemplate view={view} singlet={singlet} width={width} />
      </div>
      <span className="text-[10px] uppercase tracking-widest text-zinc-500">
        {view}
      </span>
    </div>
  );
}

function ZoneRow({ label, zone, current, onPick }) {
  const lower = (current || '').toLowerCase();
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">{label}</span>
        <span
          className="w-4 h-4 rounded border border-white/10"
          style={{ backgroundColor: current }}
          aria-hidden
        />
      </div>
      <div className="grid grid-cols-7 gap-2">
        {SINGLET_COLORS.map(c => {
          const isActive = c.hex.toLowerCase() === lower;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onPick(c.hex)}
              title={c.label}
              aria-label={`${label} ${c.label}${isActive ? ' (selected)' : ''}`}
              className={`aspect-square rounded-md border-2 transition-all active:scale-90 ${
                isActive
                  ? 'border-amber-400 scale-110 shadow-[0_0_8px_rgba(251,191,36,0.4)]'
                  : 'border-zinc-700 hover:border-zinc-500'
              }`}
              style={{ backgroundColor: c.hex }}
            />
          );
        })}
        {/* Custom hex picker via native color input */}
        <label
          className="aspect-square rounded-md border border-dashed border-zinc-600 hover:border-zinc-400 cursor-pointer relative overflow-hidden"
          title="Custom color"
        >
          <input
            type="color"
            value={current}
            onChange={e => onPick(e.target.value)}
            data-zone={zone}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            aria-label={`${label} custom color`}
          />
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-400 pointer-events-none">+</span>
        </label>
      </div>
    </div>
  );
}

function TextField({ label, value, maxLength, onChange, inputMode = undefined }) {
  return (
    <label className="block">
      <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider block mb-1">
        {label}
      </span>
      <input
        type="text"
        value={value || ''}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm uppercase tracking-wider focus:outline-none focus:border-emerald-600 transition-colors"
      />
    </label>
  );
}

export { SINGLET_DEFAULTS };
