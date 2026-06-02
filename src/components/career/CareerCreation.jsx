// ─── CareerCreation ──────────────────────────────────────────────────────────
// Compact 4-step wizard: gender → name → state → weight class. Corner is
// not a career setting (it flips per match like real wrestling). Emits an
// onCreated(career) callback when the wizard finishes; the parent
// (WrestlingGame) is responsible for persisting via saveCareer().

import React, { useState } from 'react';
import NavBar from '../ui/NavBar.jsx';
import { createCareer } from '../../lib/career/careerState.js';
import { HS_WEIGHTS, WOMENS_HS_WEIGHTS } from '../../lib/career/careerWeights.js';
import {
  STATES_BY_REGION,
  DEFAULT_STATE,
  getStateStars,
  getStateTier,
  getStateTierName,
} from '../../lib/career/careerStates.js';

const TIER_BLURB = {
  S: 'PIAA depth is its own conversation. The toughest path, the most prestige.',
  A: 'Stacked from top to bottom. State title means a lot.',
  B: 'Solid programs across the state. Deep but not stacked.',
  C: 'Balanced field with real talent. Room to make your mark.',
  D: 'Smaller scene where every match matters. Earned wins still carry weight.',
};

// Default starting weight by gender. Boys 138 (existing default; mid-pack
// in NFHS 14-class). Girls 130 (mid-pack in NFHS Girls 14-class).
const DEFAULT_WEIGHT_BY_GENDER = { male: 138, female: 130 };

function StarPips({ count }) {
  return (
    <span className="text-amber-400 tracking-tighter">
      {'★'.repeat(count)}
      <span className="text-zinc-700">{'★'.repeat(5 - count)}</span>
    </span>
  );
}

function StateGroup({ region, list, selected, onSelect }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">{region}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {list.map(s => {
          const isSel = s.code === selected;
          return (
            <button
              key={s.code}
              onClick={() => onSelect(s.code)}
              className={`flex items-center justify-between px-2.5 py-2 rounded-lg border text-left active:scale-[0.98] transition ${
                isSel
                  ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300'
              }`}
            >
              <span className="text-sm font-semibold truncate">{s.name}</span>
              <StarPips count={getStateStars(s.code)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function CareerCreation({ onBack, onCreated, defaultName = '' }) {
  const [step, setStep] = useState(1);
  const [gender, setGender] = useState('male');
  const [name, setName] = useState(defaultName);
  const [stateCode, setStateCode] = useState(DEFAULT_STATE);
  const [weightClass, setWeightClass] = useState(DEFAULT_WEIGHT_BY_GENDER.male);

  // When the user changes gender, snap the default weight to match the
  // gender's table. This avoids a stale weight from the prior gender's
  // table (e.g., 138 lbs - boys-only - left over after switching to
  // women's, where 138 isn't valid and createCareer would throw).
  function handleGenderChange(g) {
    setGender(g);
    setWeightClass(DEFAULT_WEIGHT_BY_GENDER[g]);
  }

  const isFemale = gender === 'female';
  const weightTable = isFemale ? WOMENS_HS_WEIGHTS : HS_WEIGHTS;
  const accentBorder = isFemale ? 'border-teal-600' : 'border-emerald-600';
  const accentBg = isFemale ? 'bg-teal-950/40 text-teal-200' : 'bg-emerald-950/40 text-emerald-200';
  const accentBtn = isFemale ? 'bg-teal-700' : 'bg-emerald-700';
  const accentInput = isFemale ? 'focus:border-teal-600' : 'focus:border-emerald-600';

  const canAdvance =
    step === 1 ? !!gender :
    step === 2 ? name.trim().length >= 2 :
    step === 3 ? !!stateCode :
    true;

  function finish() {
    try {
      const career = createCareer({
        name: name.trim(),
        weightClass,
        state: stateCode,
        gender,
      });
      onCreated?.(career);
    } catch (err) {
      console.warn('[CareerCreation] create failed:', err);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="New Career" onBack={onBack} />
      <div className="flex-1 px-4 py-6 max-w-md mx-auto w-full">
        <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">
          Step {step} of 4
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <div className="text-sm text-zinc-400 mb-1">Choose your path</div>
              <div className="text-[11px] text-zinc-500">
                Boys' / men's wrestling: NFHS folkstyle (HS) → NCAA folkstyle (college) →
                senior international with both Freestyle and Greco-Roman events.
                Girls' / women's wrestling: NFHS Girls (HS) → NCAA Women's
                (college) → senior international Women's Freestyle.
              </div>
            </div>

            <button
              onClick={() => handleGenderChange('male')}
              className={`w-full text-left rounded-2xl border-2 p-4 active:scale-[0.99] transition ${
                gender === 'male'
                  ? 'border-emerald-600 bg-emerald-950/30'
                  : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
              }`}
            >
              <div className="text-base font-black tracking-tight mb-0.5">Boys' / Men's Wrestling</div>
              <div className="text-[11px] text-zinc-400">
                NFHS folkstyle → NCAA folkstyle → Senior Freestyle + Greco-Roman.
              </div>
            </button>

            <button
              onClick={() => handleGenderChange('female')}
              className={`w-full text-left rounded-2xl border-2 p-4 active:scale-[0.99] transition ${
                gender === 'female'
                  ? 'border-teal-600 bg-teal-950/30'
                  : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
              }`}
            >
              <div className="text-base font-black tracking-tight mb-0.5">Girls' / Women's Wrestling</div>
              <div className="text-[11px] text-zinc-400">
                NFHS Girls → NCAA Women's → Senior Women's Freestyle.
                The fastest-growing US scholastic sport.
              </div>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <label className="text-sm text-zinc-400">Wrestler name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder="Your name"
                className={`w-full mt-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 focus:outline-none ${accentInput}`}
              />
            </div>

            <div className={`rounded-lg border ${isFemale ? 'border-teal-800/40 bg-teal-950/20' : 'border-emerald-800/40 bg-emerald-950/20'} p-3 text-xs text-zinc-400`}>
              <div className={`${isFemale ? 'text-teal-300' : 'text-emerald-300'} text-sm font-semibold mb-1`}>
                HS Freshman year - {isFemale ? "Women's" : "Men's"} Wrestling
              </div>
              Start at age 14. Wrestle a full {isFemale ? 'NFHS Girls' : 'NFHS'} season:
              duals, tournaments, conference, regionals, and state. Win to earn skill
              points; offseason you'll allocate them.
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div>
              <div className="text-sm text-zinc-400 mb-1">Pick your state</div>
              <div className="text-[11px] text-zinc-500">
                The state you wrestle in determines the depth of your competition.
                Pick a powerhouse for the hardest path - your state title means more there.
              </div>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-baseline gap-2">
                  <span className="text-zinc-200 font-semibold">{stateCode}</span>
                  <span className={`text-[10px] uppercase tracking-wider ${isFemale ? 'text-teal-400' : 'text-emerald-400'} font-bold`}>
                    {getStateTierName(stateCode)}
                  </span>
                </div>
                <StarPips count={getStateStars(stateCode)} />
              </div>
              <div className="text-zinc-400 mt-1">{TIER_BLURB[getStateTier(stateCode)]}</div>
            </div>
            <div className="max-h-[55vh] overflow-y-auto -mx-1 px-1">
              {Object.entries(STATES_BY_REGION).map(([region, list]) => (
                <StateGroup
                  key={region}
                  region={region}
                  list={list}
                  selected={stateCode}
                  onSelect={setStateCode}
                />
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div>
              <label className="text-sm text-zinc-400">
                Weight class ({isFemale ? 'NFHS Girls' : 'NFHS'})
              </label>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {weightTable.map(w => (
                  <button
                    key={w}
                    onClick={() => setWeightClass(w)}
                    className={`py-3 rounded-lg border text-sm font-semibold ${weightClass === w ? `${accentBorder} ${accentBg}` : 'border-zinc-800 bg-zinc-900 text-zinc-300'} active:scale-95 transition`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-xs text-zinc-500">
              {isFemale ? 'NFHS Girls 14-class weights.' : 'NFHS 14 standard weights.'} You can cut down or move up between seasons.
            </div>
          </div>
        )}

        <div className="mt-8 flex gap-2">
          {step > 1 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 active:scale-95 transition"
            >
              Back
            </button>
          )}
          {step < 4 ? (
            <button
              disabled={!canAdvance}
              onClick={() => canAdvance && setStep(step + 1)}
              className={`flex-1 py-3 rounded-lg ${accentBtn} text-white disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition font-semibold`}
            >
              Next
            </button>
          ) : (
            <button
              onClick={finish}
              className={`flex-1 py-3 rounded-lg ${accentBtn} text-white active:scale-95 transition font-semibold`}
            >
              Start Career
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
