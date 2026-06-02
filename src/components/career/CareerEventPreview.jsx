// ─── CareerEventPreview ──────────────────────────────────────────────────────
// Pre-match screen for a career event. Shows opponent info, H2H if a rival,
// and a big "Wrestle" CTA that kicks a vs_ai match via the game dispatcher.
//
// Phase A: duals only (single match). Tournaments/championships reuse the
// existing tournament engine and are wired in Phase C via a small shim.

import React, { useEffect, useMemo } from 'react';
import NavBar from '../ui/NavBar.jsx';
import { formatWeight, formatStyle, formatStakes } from '../../lib/career/careerWeights.js';
import { getRankingLabels } from '../../lib/career/careerRankings.js';
import { applyCareerMatchModifiers } from '../../lib/career/careerMatchModifiers.js';
import { computeScoutingBlurb, getCoachLine } from '../../lib/career/careerCoach.js';
import CoachBlurb from './CoachBlurb.jsx';

export default function CareerEventPreview({ career, event, onBack, onWrestle }) {
  // Land at the top of the screen so the event title is visible without
  // a scroll-up. Without this, navigating in from a scrolled-down career
  // dashboard inherits the scroll position and hides the header.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }, [event?.id]);

  // Career Depth Pass v1: pre-match honesty. Surface (a) the tempBuff
  // banners the player will go into the match with, (b) a coach scouting
  // blurb derived from opponent's top stat, and (c) a coach pre-match line.
  // Pure preview - applyCareerMatchModifiers does NOT consume the buffs;
  // consumption happens via the WrestlingGame match-start ref pattern.
  const modPreview = useMemo(
    () => (career?.wrestler ? applyCareerMatchModifiers(career.wrestler) : null),
    [career?.wrestler]
  );
  const scoutingBlurb = useMemo(
    () => (event?.opponent ? computeScoutingBlurb(event.opponent) : null),
    [event?.opponent]
  );
  const preMatchLine = useMemo(
    () => (career?.coach?.id ? getCoachLine(career.coach.id, 'pre_match') : null),
    [career?.coach?.id, event?.id]
  );

  if (!event) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-zinc-400">No event selected.</div>
      </div>
    );
  }

  const isDual = event.type === 'dual';
  const isTournament = event.type === 'tournament' || event.type === 'championship';
  const opponent = event.opponent;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title={event.name} onBack={onBack} />
      <div className="flex-1 px-4 py-4 max-w-md mx-auto w-full">

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
            Week {event.week} · Season {event.seasonYear}
          </div>
          <div className="text-lg font-semibold">{event.name}</div>
          <div className="text-sm text-zinc-400 mt-1">
            {formatWeight(event.weightClass, career.wrestler.tier)} · {formatStyle(event.style)}
          </div>
          {event.stakes && event.stakes !== 'regular' && (
            <div className="mt-2 inline-block text-[10px] bg-amber-900/40 text-amber-200 border border-amber-800 rounded px-2 py-0.5 uppercase tracking-wide">
              {formatStakes(event.stakes)} stakes
            </div>
          )}
        </div>

        {isDual && opponent && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
            <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">Opponent</div>
            <div className="text-lg font-semibold truncate">{opponent.name}</div>
            <div className="text-sm text-zinc-400 mt-0.5 truncate">{opponent.school}</div>
            <div className="mt-2 grid grid-cols-5 gap-1 text-[10px] uppercase tracking-wider text-zinc-400">
              <Stat label="STR" value={opponent.stats.str} />
              <Stat label="SPD" value={opponent.stats.spd} />
              <Stat label="TEC" value={opponent.stats.tec} />
              <Stat label="END" value={opponent.stats.end} />
              <Stat label="GRT" value={opponent.stats.grt} />
            </div>
            {event.opponentIsRival && opponent.h2h && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] bg-red-900/40 text-red-200 border border-red-800 rounded px-2 py-0.5 uppercase tracking-wide">
                  Rival
                </span>
                <span className="text-xs text-zinc-400">
                  H2H {opponent.h2h.wins}-{opponent.h2h.losses}
                </span>
              </div>
            )}
          </div>
        )}

        {isTournament && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
            <div className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Bracket</div>
            <div className="text-sm text-zinc-300">
              {event.bracketSize}-wrestler bracket · {formatStakes(event.stakes)} stakes
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Full bracket. Seeded by your {getRankingLabels(career?.wrestler?.tier).seedHint} rank.
            </div>
          </div>
        )}

        {/* Career Depth Pass v1: pre-match tempBuff banners. Surfaces the
            stat/stamina effects the player is walking into so a debuff like
            "Tweaked back" is visible BEFORE the match, not just after. */}
        {modPreview && modPreview.banners.length > 0 && (
          <div className="rounded-xl border border-amber-700/50 bg-amber-950/25 p-3 mb-4">
            <div className="text-amber-300 text-[10px] font-black uppercase tracking-[0.22em] mb-2">
              In Effect This Match
            </div>
            <ul className="space-y-1">
              {modPreview.banners.map((b, i) => (
                <li key={i} className="text-amber-200 text-xs">- {b}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Career Depth Pass v1: coach scouting + pre-match line. */}
        {(scoutingBlurb || preMatchLine) && career?.coach && (
          <CoachBlurb
            coachName={career.coach.name}
            line={scoutingBlurb ? `${scoutingBlurb}${preMatchLine ? ` -- ${preMatchLine}` : ''}` : preMatchLine}
            tone="scouting"
            label="Coach Scouting"
          />
        )}

        <button
          onClick={() => onWrestle?.(event)}
          className="w-full py-4 rounded-lg bg-emerald-700 text-white font-semibold active:scale-95 transition text-lg"
        >
          Wrestle
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-center">
      <div className="text-zinc-500">{label}</div>
      <div className="text-zinc-200 text-sm font-semibold">{value}</div>
    </div>
  );
}
