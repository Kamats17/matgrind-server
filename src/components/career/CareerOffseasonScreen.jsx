// ─── CareerOffseasonScreen ──────────────────────────────────────────────────
// Shown between seasons (career.phase === 'offseason'). Surfaces the
// season summary, lets the wrestler spend skill points on the tree, and
// offers the Advance / Retire decision the old inline card handled.
//
// Owner (WrestlingGame) is responsible for:
//   - passing the current career + callbacks
//   - persisting the wrestler change when the tree modifies it (onWrestlerChange)

import React, { useState } from 'react';
import NavBar from '../ui/NavBar.jsx';
import CareerSkillTree from './CareerSkillTree.jsx';
import { getSeasonSummary } from '../../lib/career/careerState.js';
import { computeCareerLevel, xpForLevel } from '../../lib/career/careerLeveling.js';
import { getWeightsForTier, formatWeight } from '../../lib/career/careerWeights.js';

function Stat({ label, value, accent = 'text-zinc-200' }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 py-2 px-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-lg font-bold ${accent}`}>{value}</div>
    </div>
  );
}

export default function CareerOffseasonScreen({
  career,
  onWrestlerChange,
  onAdvanceSeason,
  onRetire,
  onBack,
}) {
  const [treeOpen, setTreeOpen] = useState(false);
  // Pre-retire confirmation gate. Mirrors CareerRecruitingScreen +
  // CareerSeniorStyleChoice. Click Retire -> setConfirmRetire(true) ->
  // modal shows -> Cancel closes, Retire fires onRetire.
  const [confirmRetire, setConfirmRetire] = useState(false);
  const { wrestler, record, schedule } = career;
  // getSeasonSummary counts EVENT wins (championship 1st place) not match
  // wins. For the season header we want individual-match W/L, which comes
  // from record.seasonWins / record.seasonLosses (tracked per-match across
  // duals + tournament rounds in recordEventResult). The legacy `summary`
  // is still used below for `titles` (championship list).
  const summary = getSeasonSummary(career);
  const seasonWins = record?.seasonWins || 0;
  const seasonLosses = record?.seasonLosses || 0;

  const xpInfo = computeCareerLevel(wrestler.xp || 0);
  const xpToNext = xpForLevel(wrestler.level + 1) - (wrestler.xp || 0);

  const pts = wrestler?.skillTree?.pointsAvailable || 0;
  const bonus = career.lastSeasonBonus;

  // Tier-aware advance button copy. The advanceToNextSeason() reducer
  // routes HS year 4 -> recruiting, college year 4 -> senior style choice,
  // senior year 8 -> retired. We surface the next destination explicitly
  // so the player knows what they're walking into.
  let advanceLabel = 'Advance Season';
  if (wrestler.tier === 'hs' && wrestler.year >= 4) {
    advanceLabel = 'Continue to Recruiting';
  } else if (wrestler.tier === 'college' && wrestler.year >= 4) {
    advanceLabel = 'Continue to Senior International';
  } else if (wrestler.tier === 'senior' && wrestler.year >= 8) {
    advanceLabel = 'Finish Career';
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Offseason" onBack={onBack} />

      <div className="flex-1 px-4 py-4 max-w-md mx-auto w-full overflow-auto">
        {/* Season header */}
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 mb-4">
          <div className="text-xs uppercase tracking-widest text-amber-300 mb-1">
            Season {schedule.seasonYear} Complete
          </div>
          <div className="text-xl font-bold">{wrestler.name}</div>
          <div className="text-sm text-zinc-400 mt-0.5">
            {seasonWins}-{seasonLosses} this season ·
            <span className="ml-1">{record.careerWins}-{record.careerLosses} career</span>
          </div>
        </div>

        {/* Summary grid */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <Stat label="Pins" value={record.pins || 0} accent="text-amber-300" />
          <Stat label="Tech Falls" value={record.techs || 0} accent="text-cyan-300" />
          <Stat label="Titles" value={record.titles?.length || 0} accent="text-amber-300" />
          <Stat label="Level" value={wrestler.level || 1} accent="text-emerald-300" />
        </div>

        {/* XP bar */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs uppercase tracking-widest text-zinc-500">
              Career XP
            </div>
            <div className="text-[10px] text-zinc-500">
              Level {wrestler.level}
            </div>
          </div>
          <div className="h-2 rounded bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-emerald-600"
              style={{
                width: `${Math.min(100, Math.max(0, (xpInfo.xpIntoLevel / Math.max(1, xpInfo.xpForNext)) * 100))}%`,
              }}
            />
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">
            {xpInfo.xpIntoLevel} / {xpInfo.xpForNext} xp
            {xpToNext > 0 && xpToNext < 99999 && ` · ${xpToNext} to L${wrestler.level + 1}`}
          </div>
          {bonus && bonus.xpGained > 0 && (
            <div className="text-xs text-emerald-300 mt-2">
              +{bonus.xpGained} xp season bonus
              {bonus.leveledUp && bonus.skillPointsGained > 0 && (
                <span className="ml-2 text-amber-300">
                  +{bonus.skillPointsGained} skill point{bonus.skillPointsGained !== 1 ? 's' : ''}!
                </span>
              )}
            </div>
          )}
        </div>

        {/* Skill points CTA */}
        <div className={`rounded-xl border p-4 mb-4 ${
          pts > 0
            ? 'border-emerald-700/50 bg-emerald-950/20'
            : 'border-zinc-800 bg-zinc-900/60'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-widest text-zinc-500">
                Skill Points
              </div>
              <div className={`text-2xl font-bold ${pts > 0 ? 'text-emerald-300' : 'text-zinc-400'}`}>
                {pts}
              </div>
            </div>
            <button
              onClick={() => setTreeOpen(true)}
              className={`py-2.5 px-4 rounded-lg font-semibold active:scale-95 transition ${
                pts > 0
                  ? 'bg-emerald-700 text-white'
                  : 'border border-zinc-700 bg-zinc-900 text-zinc-300'
              }`}
            >
              {pts > 0 ? 'Spend Points' : 'View Tree'}
            </button>
          </div>
        </div>

        {/* Weight class picker. Required between seasons - the creation
            screen promises "you can cut down or move up between seasons"
            but until now there was no UI to actually do it. The new
            weight is read by advanceToNextSeason -> generateSeasonSchedule
            so the upcoming season uses the picked weight. */}
        <WeightClassPicker
          tier={wrestler.tier}
          style={wrestler.style || 'folkstyle'}
          gender={wrestler.gender || 'male'}
          weightClass={wrestler.weightClass}
          onChange={(newWeight) => {
            if (!onWrestlerChange) return;
            onWrestlerChange({ ...wrestler, weightClass: newWeight });
          }}
        />

        {/* Advance / Retire */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => onAdvanceSeason?.()}
            className="flex-1 py-3 rounded-lg bg-amber-700 text-white font-semibold active:scale-95 transition"
          >
            {advanceLabel}
          </button>
          <button
            onClick={() => setConfirmRetire(true)}
            className="px-4 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 active:scale-95 transition"
          >
            Retire
          </button>
        </div>
      </div>

      {treeOpen && (
        <CareerSkillTree
          wrestler={wrestler}
          onChange={onWrestlerChange}
          onClose={() => setTreeOpen(false)}
        />
      )}

      {confirmRetire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-red-800/60 bg-zinc-950 p-5">
            <div className="text-red-300 text-xs font-black uppercase tracking-[0.2em] mb-2">Retire</div>
            <div className="text-white font-bold text-lg mb-1 break-words">End {wrestler?.name}'s career?</div>
            <div className="text-zinc-400 text-sm mb-4">
              The wrestler is preserved in your Hall of Fame. This cannot be undone.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRetire(false)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmRetire(false);
                  onRetire?.();
                }}
                className="flex-1 py-3 rounded-lg bg-red-700 hover:bg-red-600 text-white font-black"
              >
                Retire
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline weight-class picker. Shows the current weight and adjacent
// weight classes (one above, one below if they exist). For HS/college
// the units are lbs; senior international is kg. Tier-aware via
// getWeightsForTier so college and senior surfaces work the same way.
function WeightClassPicker({ tier, style, gender = 'male', weightClass, onChange }) {
  const weights = getWeightsForTier(tier, style, gender);
  const currentIdx = weights.indexOf(weightClass);
  // If we can't find the current weight in the table (data drift), fall
  // back to showing the full list so the player can pick fresh.
  const showFullList = currentIdx === -1;

  if (showFullList) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
        <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">
          Weight Class
        </div>
        <div className="grid grid-cols-4 gap-2">
          {weights.map(w => (
            <button
              key={w}
              onClick={() => onChange?.(w)}
              className={`py-2 rounded-lg border text-sm font-semibold ${
                w === weightClass
                  ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-300'
              } active:scale-95 transition`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const lower = currentIdx > 0 ? weights[currentIdx - 1] : null;
  const upper = currentIdx < weights.length - 1 ? weights[currentIdx + 1] : null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs uppercase tracking-widest text-zinc-500">
          Weight Class
        </div>
        <div className="text-[10px] text-zinc-500">Cut down or move up</div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => lower != null && onChange?.(lower)}
          disabled={lower == null}
          className={`py-3 rounded-lg border text-sm font-semibold transition ${
            lower == null
              ? 'border-zinc-900 bg-zinc-950 text-zinc-700 cursor-not-allowed'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 active:scale-95'
          }`}
        >
          {lower != null ? `↓ ${formatWeight(lower, tier)}` : '-'}
        </button>
        <div className="py-3 rounded-lg border border-emerald-700/60 bg-emerald-950/20 text-emerald-200 text-sm font-bold text-center">
          {formatWeight(weightClass, tier)}
        </div>
        <button
          onClick={() => upper != null && onChange?.(upper)}
          disabled={upper == null}
          className={`py-3 rounded-lg border text-sm font-semibold transition ${
            upper == null
              ? 'border-zinc-900 bg-zinc-950 text-zinc-700 cursor-not-allowed'
              : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 active:scale-95'
          }`}
        >
          {upper != null ? `↑ ${formatWeight(upper, tier)}` : '-'}
        </button>
      </div>
      <div className="text-[10px] text-zinc-500 mt-2">
        New weight applies to next season&apos;s rivals + schedule.
      </div>
    </div>
  );
}
