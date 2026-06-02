// ─── CareerDashboard ─────────────────────────────────────────────────────────
// Home screen for an active career. Tabs across the top: Home (wrestler
// header + next event), Schedule (full season list), Rivals (H2H), Skill
// Tree (placeholder until Phase B ships), Decks (jump to deck editor).
//
// "Play Next" is the primary CTA on the Home tab. Between seasons, the
// same slot surfaces "Advance Season" or "Retire" (for HS graduation the
// next phase adds recruiting).

import React, { useState } from 'react';
import NavBar from '../ui/NavBar.jsx';
import { getNextEvent } from '../../lib/career/careerState.js';
import { formatWeight, formatStyle, formatStakes } from '../../lib/career/careerWeights.js';
import { computeCareerLevel, MAX_CAREER_LEVEL } from '../../lib/career/careerLeveling.js';
import CareerRankingsPanel from './CareerRankingsPanel.jsx';
import CareerRivalsSnapshot from './CareerRivalsSnapshot.jsx';
import CareerSkillTree from './CareerSkillTree.jsx';
import CareerRankingsScreen from './CareerRankingsScreen.jsx';

const TIER_LABEL = {
  hs: 'High School',
  college: 'College',
  senior: 'Senior International',
};

const YEAR_LABEL_HS = ['Freshman', 'Sophomore', 'Junior', 'Senior'];
const YEAR_LABEL_COLLEGE = ['Freshman', 'Sophomore', 'Junior', 'Senior'];

function yearLabel(tier, year) {
  if (tier === 'hs') return YEAR_LABEL_HS[year - 1] || `Year ${year}`;
  if (tier === 'college') return YEAR_LABEL_COLLEGE[year - 1] || `Year ${year}`;
  return `Year ${year}`;
}

function eventTypePill(type, stakes) {
  if (type === 'championship') {
    if (stakes === 'olympics' || stakes === 'olympic_trials') return { label: 'INTL GAMES', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    if (stakes === 'world_championship' || stakes === 'world_trials') return { label: 'WORLD', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    if (stakes === 'ncaa') return { label: 'NATIONALS', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    if (stakes === 'conference_d1') return { label: 'CONFERENCE', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    if (stakes === 'us_open') return { label: 'AM OPEN', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    if (stakes === 'state') return { label: 'STATE', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    if (stakes === 'regional') return { label: 'REGIONAL', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    if (stakes === 'district') return { label: 'DISTRICT', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' }; // v9
    if (stakes === 'conference') return { label: 'CONFERENCE', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
    return { label: 'CHAMPIONSHIP', cls: 'bg-amber-900/40 text-amber-200 border-amber-700' };
  }
  if (type === 'invitational') return { label: 'INVITATIONAL', cls: 'bg-violet-900/40 text-violet-200 border-violet-700' };
  if (type === 'tournament') return { label: 'TOURNAMENT', cls: 'bg-purple-900/40 text-purple-200 border-purple-700' };
  return { label: 'DUAL', cls: 'bg-sky-900/40 text-sky-200 border-sky-700' };
}

function resultBadge(event) {
  if (event.status === 'won') return { label: 'W', cls: 'bg-emerald-900/60 text-emerald-200 border-emerald-700' };
  if (event.status === 'lost') return { label: 'L', cls: 'bg-red-900/60 text-red-200 border-red-700' };
  return null;
}

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'rivals', label: 'Rivals' },
  { id: 'skills', label: 'Skills' },
  { id: 'decks', label: 'Decks' },
];

export default function CareerDashboard({ career, onBack, onStartEvent, onSimulateWeek, onAdvanceSeason, onRetire, onDecks, onWrestlerChange, onStartNewCareer, onDeleteCareer, onOpenTrophyCase }) {
  const [tab, setTab] = useState('home');
  const [treeOpen, setTreeOpen] = useState(false);
  const [rankingsOpen, setRankingsOpen] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Confirm-dialog state for the Simulate Week shortcut. The actual sim
  // logic lives in WrestlingGame (handleSimulateWeek) - this component just
  // gates the click behind a confirmation.
  const [showSimConfirm, setShowSimConfirm] = useState(false);

  if (!career) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="text-zinc-400">Loading career…</div>
      </div>
    );
  }

  // Rankings detail screen replaces the dashboard while open (full-screen
  // drill-in) rather than overlaying, so horizontal scroll and tab strips
  // don't compete for the same space.
  if (rankingsOpen) {
    return <CareerRankingsScreen career={career} onBack={() => setRankingsOpen(false)} />;
  }

  const next = getNextEvent(career);
  const { wrestler, record, schedule, rivals, rankings } = career;
  const xpInfo = computeCareerLevel(wrestler.xp || 0);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <NavBar title="Career" onBack={onBack} />

      {/* Wrestler header - always visible above the tabs so it's a
          persistent anchor like the profile header on iOS Health. */}
      <div className="px-4 pt-3 max-w-md mx-auto w-full">
        <div className="rounded-xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-zinc-950 p-4">
          <div className="flex items-baseline justify-between">
            <div className="text-xl font-bold">{wrestler.name}</div>
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              Age {wrestler.age}
            </div>
          </div>
          <div className="text-sm text-zinc-400 mt-1">
            {TIER_LABEL[wrestler.tier]} · {yearLabel(wrestler.tier, wrestler.year)} · {formatWeight(wrestler.weightClass, wrestler.tier)}
            {wrestler.style && wrestler.tier === 'senior' && (
              <span className="ml-1 text-emerald-300">
                · {formatStyle(wrestler.style)}
              </span>
            )}
          </div>
          {wrestler.school?.name && (
            <div className="text-[11px] text-emerald-300/80 mt-0.5">
              {wrestler.school.name}{wrestler.school.conference ? ` · ${wrestler.school.conference}` : ''}
            </div>
          )}
          <div className="mt-3 flex gap-4 text-sm">
            <div>
              <span className="text-emerald-400 font-semibold">{record.seasonWins}</span>
              <span className="text-zinc-500"> - </span>
              <span className="text-red-400 font-semibold">{record.seasonLosses}</span>
              <span className="ml-1 text-xs text-zinc-500">season</span>
            </div>
            <div>
              <span className="text-zinc-300 font-semibold">{record.careerWins}-{record.careerLosses}</span>
              <span className="ml-1 text-xs text-zinc-500">career</span>
            </div>
            {record.pins > 0 && (
              <div>
                <span className="text-amber-300 font-semibold">{record.pins}</span>
                <span className="ml-1 text-xs text-zinc-500">pins</span>
              </div>
            )}
            {record.techs > 0 && (
              <div>
                <span className="text-cyan-300 font-semibold">{record.techs}</span>
                <span className="ml-1 text-xs text-zinc-500">techs</span>
              </div>
            )}
          </div>
          {record.titles?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1 items-center">
              {record.titles.slice(-3).map(t => (
                <span key={t.id} className={`text-[10px] border rounded px-2 py-0.5 uppercase tracking-wide ${
                  t.prestige === 'gold' ? 'bg-amber-900/50 text-amber-200 border-amber-700' :
                  t.prestige === 'silver' ? 'bg-zinc-700/40 text-zinc-200 border-zinc-500' :
                                            'bg-amber-900/40 text-amber-200 border-amber-800'
                }`}>
                  {t.stakes ? `${formatStakes(t.stakes)} champ` : 'tournament'}
                </span>
              ))}
              {onOpenTrophyCase && (
                <button
                  onClick={onOpenTrophyCase}
                  className="text-[10px] uppercase tracking-wider text-emerald-400 hover:text-emerald-300 ml-1"
                >
                  Trophy Case →
                </button>
              )}
            </div>
          )}

          {/* Level + XP bar */}
          <div className="mt-3">
            <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-zinc-500">
              <span className="flex items-center gap-1.5">
                Level {wrestler.level || 1}
                {(wrestler.level || 0) > MAX_CAREER_LEVEL && (
                  <span
                    className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-black tracking-widest"
                    title={`Past the legacy career cap (Level ${MAX_CAREER_LEVEL}). Pure prestige.`}
                  >
                    PRESTIGE
                  </span>
                )}
              </span>
              <span>
                {xpInfo.xpIntoLevel}/{xpInfo.xpForNext} xp
              </span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-emerald-600"
                style={{
                  width: `${Math.min(100, Math.max(0, (xpInfo.xpIntoLevel / Math.max(1, xpInfo.xpForNext)) * 100))}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tab strip */}
      <div className="px-4 pt-3 max-w-md mx-auto w-full">
        <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-2 px-3 text-xs font-semibold uppercase tracking-wider flex-shrink-0 border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-emerald-500 text-emerald-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 py-4 max-w-md mx-auto w-full">
        {tab === 'home' && (
          <HomeTab
            next={next}
            schedule={schedule}
            wrestler={wrestler}
            rankings={rankings}
            rivals={rivals}
            rankingPool={career.rankingPool}
            onStartEvent={onStartEvent}
            onSimulateWeek={onSimulateWeek ? () => setShowSimConfirm(true) : null}
            onAdvanceSeason={onAdvanceSeason}
            onRetire={onRetire}
            onOpenRivals={() => setTab('rivals')}
            onOpenRankings={() => setRankingsOpen(true)}
          />
        )}
        {tab === 'schedule' && <ScheduleTab schedule={schedule} />}
        {tab === 'rivals' && <RivalsTab rivals={rivals} />}
        {tab === 'skills' && (
          <SkillsTab
            wrestler={wrestler}
            onOpenTree={() => setTreeOpen(true)}
            onRequestRestart={() => setShowRestartConfirm(true)}
            onRequestDelete={onDeleteCareer ? () => setShowDeleteConfirm(true) : null}
            onSpendStat={(key) => {
              if (!wrestler || !key) return;
              const pts = wrestler.statPointsAvailable || 0;
              const cur = wrestler.stats?.[key] ?? 0;
              const cap = wrestler?.tier === 'senior' ? 99 : wrestler?.tier === 'college' ? 90 : 80;
              if (pts <= 0 || cur >= cap) return;
              const next = {
                ...wrestler,
                stats: { ...wrestler.stats, [key]: cur + 1 },
                statPointsAvailable: pts - 1,
              };
              onWrestlerChange?.(next);
            }}
          />
        )}
        {tab === 'decks' && <DecksTab onDecks={onDecks} />}
      </div>

      {treeOpen && (
        <CareerSkillTree
          wrestler={wrestler}
          onChange={onWrestlerChange}
          onClose={() => setTreeOpen(false)}
        />
      )}

      {/* Slot-picker prompt: replaces the destructive "delete career"
          confirmation. With multi-slot careers, the user can manage multiple
          wrestlers without losing this one. */}
      {showRestartConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-700 bg-zinc-950 p-5">
            <div className="text-emerald-300 text-xs font-black uppercase tracking-[0.2em] mb-2">Career Slots</div>
            <div className="text-white font-bold text-lg mb-2">Switch or start a new career?</div>
            <div className="text-zinc-400 text-sm leading-relaxed mb-4">
              You can keep this career and start another in a different slot. Up to 3 careers per account.
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-xs text-zinc-300">
                <div>{wrestler.name} · {TIER_LABEL[wrestler.tier]} {yearLabel(wrestler.tier, wrestler.year)}</div>
                <div className="text-zinc-500 mt-1">
                  {record.careerWins}-{record.careerLosses} career · {record.titles?.length || 0} title{record.titles?.length === 1 ? '' : 's'} · Lvl {wrestler.level || 1}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowRestartConfirm(false)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowRestartConfirm(false);
                  onStartNewCareer?.();
                }}
                className="flex-1 py-3 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold"
              >
                Open Slot Picker
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-red-800/60 bg-zinc-950 p-5">
            <div className="text-red-300 text-xs font-black uppercase tracking-[0.2em] mb-2">⚠ Permanent Delete</div>
            <div className="text-white font-bold text-lg mb-2">
              Are you sure you want to permanently delete this career?
            </div>
            <div className="text-zinc-400 text-sm leading-relaxed mb-4">
              <span className="text-zinc-200 font-semibold">{wrestler.name}</span> will be removed and the slot freed. This cannot be undone.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  onDeleteCareer?.();
                }}
                className="flex-1 py-3 rounded-lg bg-red-700 hover:bg-red-600 text-white font-black"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Simulate Week confirmation. The result is rolled probabilistically
          from the player's stats and the field strength. */}
      {showSimConfirm && next && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-700 bg-zinc-950 p-5">
            <div className="text-amber-300 text-xs font-black uppercase tracking-[0.2em] mb-2">Simulate</div>
            <div className="text-white font-bold text-lg mb-2">Simulate this week?</div>
            <div className="text-zinc-400 text-sm leading-relaxed mb-4">
              Auto-resolves <span className="text-zinc-200 font-semibold">{next.name}</span>. The result will count toward your career and you won&apos;t be able to redo it.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowSimConfirm(false)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowSimConfirm(false);
                  onSimulateWeek?.(next);
                }}
                className="flex-1 py-3 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-bold"
              >
                Simulate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HomeTab({
  next, schedule, wrestler, rankings, rivals, rankingPool,
  onStartEvent, onSimulateWeek, onAdvanceSeason, onRetire, onOpenRivals, onOpenRankings,
}) {
  // Pre-retire confirmation gate for the "Season Complete fallback"
  // branch's Retire button. Mirrors CareerRecruitingScreen +
  // CareerSeniorStyleChoice + CareerOffseasonScreen pattern. This branch
  // is rarely reached post the career_offseason routing fix - the caller
  // routes phase='offseason' careers through CareerOffseasonScreen - but
  // the modal closes the parity gap and guards against future regressions.
  const [confirmRetire, setConfirmRetire] = useState(false);
  if (!next) {
    // Offseason fallback kept for safety, but the expected path is for the
    // caller (WrestlingGame) to route to CareerOffseasonScreen when phase
    // flips to 'offseason'. This branch remains in case the caller isn't
    // wired yet / or in dev tools.
    return (
      <>
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4 mb-4">
          <div className="text-xs uppercase tracking-widest text-amber-300 mb-1">Season Complete</div>
          <div className="text-sm text-zinc-300 mb-3">
            Season {schedule.seasonYear} finished. Advance to next season?
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onAdvanceSeason?.()}
              className="flex-1 py-3 rounded-lg bg-amber-700 text-white font-semibold active:scale-95 transition"
            >
              Advance Season
            </button>
            <button
              onClick={() => setConfirmRetire(true)}
              className="px-4 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-300 active:scale-95 transition"
            >
              Retire
            </button>
          </div>
        </div>
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
      </>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs uppercase tracking-widest text-emerald-300">Next Up · Week {next.week}</div>
          <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide ${eventTypePill(next.type, next.stakes).cls}`}>
            {eventTypePill(next.type, next.stakes).label}
          </span>
        </div>
        <div className="text-lg font-semibold">{next.name}</div>
        {next.opponent && (
          <div className="text-sm text-zinc-400 mt-1">
            vs {next.opponent.name}
            {next.opponentIsRival && <span className="ml-2 text-[10px] text-amber-300 font-semibold">RIVAL</span>}
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => onStartEvent?.(next)}
            className="flex-1 py-3 rounded-lg bg-emerald-700 text-white font-semibold active:scale-95 transition"
          >
            Play Next
          </button>
          {onSimulateWeek && (
            <button
              onClick={onSimulateWeek}
              className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold active:scale-95 transition"
            >
              Simulate
            </button>
          )}
        </div>
      </div>

      {/* Fills the gap below Play Next: rankings + rivals-at-a-glance. */}
      <CareerRankingsPanel rankings={rankings} wrestler={wrestler} onOpenRankings={onOpenRankings} />
      <CareerRivalsSnapshot rivals={rivals} rankingPool={rankingPool} onOpenRivals={onOpenRivals} />
    </>
  );
}

function ScheduleTab({ schedule }) {
  // Defensive guard: a partially-hydrated career or pre-Phase-B save can
  // arrive without `schedule`. Without this check, `schedule.events?.length`
  // throws "Undefined is not an object" before optional chaining reaches.
  if (!schedule?.events?.length) {
    return <div className="text-zinc-500 text-sm">No events scheduled.</div>;
  }
  return (
    <div className="space-y-1">
      {schedule.events.map(e => {
        const rb = resultBadge(e);
        return (
          <div
            key={e.id}
            className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
              e.status === 'upcoming' ? 'border-zinc-800 bg-zinc-900/60' : 'border-zinc-800/60 bg-zinc-900/30 opacity-80'
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-zinc-200 truncate">{e.name}</div>
              <div className="text-xs text-zinc-500">
                Week {e.week}
                {e.opponent ? ` · vs ${e.opponent.name}` : ''}
                {e.result ? ` · ${e.result.p1Score}-${e.result.p2Score}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 ml-2">
              {rb && (
                <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide font-bold ${rb.cls}`}>
                  {rb.label}
                </span>
              )}
              <span className={`text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide ${eventTypePill(e.type, e.stakes).cls}`}>
                {eventTypePill(e.type, e.stakes).label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RivalsTab({ rivals }) {
  if (!rivals?.length) {
    return <div className="text-zinc-500 text-sm">No rivals yet. They show up as the season unfolds.</div>;
  }
  return (
    <div className="space-y-1">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 px-1">
        Head-to-head record vs each rival
      </div>
      {rivals.map(r => {
        const meetings = (r.h2h?.wins || 0) + (r.h2h?.losses || 0);
        const hasHistory = meetings > 0;
        return (
          <div key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-200 font-semibold truncate">{r.name}</div>
                <div className="text-xs text-zinc-500 truncate">{r.school} · OVR {r.overall}</div>
              </div>
              <div className="text-xs text-right flex-shrink-0 ml-2">
                {hasHistory ? (
                  <>
                    <div>
                      <span className="text-emerald-400 font-bold">{r.h2h.wins}W</span>
                      <span className="text-zinc-500"> · </span>
                      <span className="text-red-400 font-bold">{r.h2h.losses}L</span>
                      {r.h2h.pins > 0 && (
                        <>
                          <span className="text-zinc-500"> · </span>
                          <span className="text-amber-300 font-bold">{r.h2h.pins}P</span>
                        </>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {meetings} meeting{meetings === 1 ? '' : 's'}
                    </div>
                  </>
                ) : (
                  <span className="text-zinc-500 italic text-[10px]">No meetings yet</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SkillsTab({ wrestler, onOpenTree, onRequestRestart, onRequestDelete, onSpendStat }) {
  const pts = wrestler?.skillTree?.pointsAvailable || 0;
  const owned = wrestler?.skillTree?.unlockedNodes?.length || 0;
  const statPts = wrestler?.statPointsAvailable || 0;
  // Tier-scaled cap: HS 80, College 90, Senior 99 - keeps "stud in HS"
  // from being 90 overall before they ever leave town.
  const STAT_CAP = wrestler?.tier === 'senior' ? 99 : wrestler?.tier === 'college' ? 90 : 80;
  const statRow = [
    ['STR', 'str'],
    ['SPD', 'spd'],
    ['TEC', 'tec'],
    ['END', 'end'],
    ['GRT', 'grt'],
  ];
  return (
    <div>
      <div className={`rounded-xl border p-4 mb-3 ${
        statPts > 0 ? 'border-emerald-700/50 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/60'
      }`}>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-xs uppercase tracking-widest text-zinc-500">Stats</div>
          {statPts > 0 && (
            <div className="text-xs text-emerald-300 font-bold">
              {statPts} pt{statPts !== 1 ? 's' : ''} to spend
            </div>
          )}
        </div>
        <div className="grid grid-cols-5 gap-2 text-center">
          {statRow.map(([label, key]) => {
            const v = wrestler.stats[key];
            const canSpend = statPts > 0 && v < STAT_CAP;
            return (
              <div key={key} className="rounded border border-zinc-800 bg-zinc-950 py-2 px-1 flex flex-col items-center gap-1">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
                <div className="text-lg font-bold text-zinc-200 leading-none">{v}</div>
                {onSpendStat && (
                  <button
                    onClick={() => canSpend && onSpendStat(key)}
                    disabled={!canSpend}
                    aria-label={`Add 1 to ${label}`}
                    className={`mt-0.5 text-[11px] font-black w-7 h-6 rounded transition ${
                      canSpend
                        ? 'bg-emerald-700 hover:bg-emerald-600 text-white active:scale-95'
                        : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    +1
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {statPts === 0 && (
          <div className="mt-3 text-[11px] text-zinc-500">
            Earn stat points by advancing seasons (+3 each offseason).
          </div>
        )}
      </div>

      <div className={`rounded-xl border p-4 ${
        pts > 0 ? 'border-emerald-700/50 bg-emerald-950/20' : 'border-zinc-800 bg-zinc-900/60'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-zinc-200 font-semibold">Skill Tree</div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">
              {owned} unlocked · {pts} point{pts !== 1 ? 's' : ''} available
            </div>
          </div>
          <button
            onClick={() => onOpenTree?.()}
            className={`px-4 py-2.5 rounded-lg font-semibold active:scale-95 transition ${
              pts > 0
                ? 'bg-emerald-700 text-white'
                : 'border border-zinc-700 bg-zinc-900 text-zinc-300'
            }`}
          >
            {pts > 0 ? 'Spend Points' : 'View Tree'}
          </button>
        </div>
        <div className="text-xs leading-relaxed text-zinc-400">
          Four branches (Scrambler · Rider · Technician · Gasser). Each
          node unlocks cards for your deck. You earn skill points by
          leveling up - win matches, place in tournaments, finish seasons.
        </div>
      </div>

      {/* Career management - opens the slot picker so the user can keep this
          career and start another in a free slot. Multi-slot is live, so
          starting a new career no longer wipes the old one. */}
      {onRequestRestart && (
        <div className="mt-6 pt-4 border-t border-zinc-800/60">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Career Slots</div>
          <button
            onClick={onRequestRestart}
            className="w-full py-3 rounded-lg border border-emerald-900/50 bg-emerald-950/20 text-emerald-300 font-semibold active:scale-95 transition hover:bg-emerald-950/40"
          >
            Switch or Start New Career
          </button>
          <div className="text-[10px] text-zinc-600 mt-1.5 text-center">
            Keeps this career. Up to 3 wrestlers per account.
          </div>
          {onRequestDelete && (
            <>
              <button
                onClick={onRequestDelete}
                className="mt-3 w-full py-3 rounded-lg border border-red-900/50 bg-red-950/20 text-red-300 font-semibold active:scale-95 transition hover:bg-red-950/40"
              >
                Delete Career
              </button>
              <div className="text-[10px] text-zinc-600 mt-1.5 text-center">
                Permanently removes this wrestler. Cannot be undone.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DecksTab({ onDecks }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="text-zinc-200 font-semibold mb-1">Your Deck</div>
      <div className="text-xs text-zinc-500 leading-relaxed mb-3">
        Edit the 24-card deck your wrestler brings into each match.
        Card unlocks via the Skill Tree will gate this pool once that's live.
      </div>
      <button
        onClick={() => onDecks?.()}
        className="w-full py-2.5 rounded-lg bg-sky-700 text-white font-semibold active:scale-95 transition"
      >
        Open Deck Editor
      </button>
    </div>
  );
}
