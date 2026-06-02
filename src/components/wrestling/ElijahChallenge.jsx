import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronDown, Instagram } from 'lucide-react';
import {
  PARTNERSHIP_ACTIVE,
  computeBossOverall,
  ELIJAH_TRASH_TALK,
} from '../../lib/career/elijahJoles.js';
import { getLevelFromXP } from '../../lib/profileUtils.js';

// Boss Challenge screen for the Elijah Joles featured-wrestler partnership.
// All UI reads PARTNERSHIP_ACTIVE - flipping the constant off in
// elijahJoles.js gracefully retires the experience (a "no longer active"
// notice shown to anyone deep-linking /#elijah). Existing badges in player
// profiles survive retirement.
//
// Asset mapping:
//   HERO_PHOTO     = the Adidas Folkstyle Nationals All-American promo
//                    card. Already a finished branded poster (EJ shield +
//                    Adidas Nationals shield + name + 5 gold stars baked
//                    in), so the hero block carries no extra text overlays.
//   SECONDARY_PHOTO = the Windsor Open #1 podium candid. Used in the
//                    bio collapsible as a humanizing photo.
//   LOGO_FALLBACK_SVG = the WRESTLE THROUGH wordmark would be redundant on
//                    the hero (the promo already contains the EJ shield);
//                    instead, the fallback hero shows the wordmark if the
//                    promo image fails to load.

const HERO_PHOTO = '/elijah/photo-allamerican.jpg';
const SECONDARY_PHOTO = '/elijah/photo-podium.jpg';
const LOGO = '/elijah/wordmark.png';
const INSTAGRAM_URL = 'https://instagram.com/EJwrestle';

// Stat-bar colors. spd is highlighted, end muted - visual tell that matches
// his stated funky-fast / lower-stamina profile.
function StatBar({ label, value, accent = null }) {
  const pct = Math.max(0, Math.min(99, value || 0));
  const barColor =
    accent === 'highlight' ? 'bg-red-500'
    : accent === 'muted'   ? 'bg-zinc-600'
    : 'bg-zinc-400';
  const labelColor =
    accent === 'highlight' ? 'text-red-300'
    : accent === 'muted'   ? 'text-zinc-500'
    : 'text-zinc-300';
  return (
    <div className="flex items-center gap-2">
      <div className={`w-10 text-[10px] font-black uppercase tracking-wider ${labelColor}`}>{label}</div>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-7 text-right text-xs font-bold text-white tabular-nums">{value}</div>
    </div>
  );
}

export default function ElijahChallenge({ wrestlerProfile, onBack, onStartMatch }) {
  const [bioOpen, setBioOpen] = useState(false);
  const [heroFailed, setHeroFailed] = useState(false);
  const [secondaryFailed, setSecondaryFailed] = useState(false);
  const [wordmarkFailed, setWordmarkFailed] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [bossWins, setBossWins] = useState(0);
  const launchLockRef = useRef(false);
  // Hold the pending debounce id so we can clear it on unmount and avoid
  // the "state update on unmounted component" warning when a successful
  // launch navigates away before the 600 ms window elapses.
  const launchTimeoutRef = useRef(null);

  useEffect(() => {
    try {
      const n = Number(localStorage.getItem('matgrind_elijah_boss_wins') || 0);
      setBossWins(Number.isFinite(n) ? n : 0);
    } catch { setBossWins(0); }
  }, []);

  // Cancel any in-flight launch debounce on unmount.
  useEffect(() => () => {
    if (launchTimeoutRef.current) {
      clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = null;
    }
  }, []);

  const playerLevel = wrestlerProfile?.level
    || getLevelFromXP(wrestlerProfile?.xp || 0)
    || 1;
  const overall = computeBossOverall(playerLevel, bossWins);
  // Display stat block matching the buildElijahBossOpponent skew: spd +6,
  // tec +4, str +0, end -8, grt +3 - capped 40..99.
  const clamp = (v) => Math.max(40, Math.min(99, v));
  const stats = useMemo(() => ({
    str: clamp(overall + 0),
    spd: clamp(overall + 6),
    tec: clamp(overall + 4),
    end: clamp(overall - 8),
    grt: clamp(overall + 3),
  }), [overall]);

  const teaserLine = useMemo(() => {
    const lines = ELIJAH_TRASH_TALK?.pre_match || [];
    if (lines.length === 0) return null;
    return lines[Math.floor(Math.random() * lines.length)];
  }, []);

  if (!PARTNERSHIP_ACTIVE) {
    return (
      <div className="min-h-[100dvh] bg-black text-white px-4 pt-6 pb-10 max-w-lg md:max-w-2xl mx-auto">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-zinc-400 hover:text-white text-sm font-bold mb-6"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center">
          <div className="text-zinc-400 text-sm">
            The Elijah Joles featured-athlete partnership has wrapped. Thanks for playing!
          </div>
        </div>
      </div>
    );
  }

  const handleLaunch = () => {
    if (launchLockRef.current) return;
    launchLockRef.current = true;
    setLaunching(true);
    // 600 ms debounce - re-enable after the match-init animations settle so
    // a stuck launch (e.g. lazy-import failure) doesn't permanently lock the
    // button. Successful launches navigate away, so the timeout is cleared
    // by the unmount cleanup effect above before it can fire stale state.
    if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
    launchTimeoutRef.current = setTimeout(() => {
      launchLockRef.current = false;
      setLaunching(false);
      launchTimeoutRef.current = null;
    }, 600);
    try { onStartMatch?.(); } catch { /* defensive - parent handles errors */ }
  };

  return (
    <div className="min-h-[100dvh] bg-black text-white pb-12">
      {/* Back chip */}
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 pt-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-zinc-400 hover:text-white text-sm font-bold"
          aria-label="Back to menu"
        >
          <ChevronLeft className="w-4 h-4" /> Menu
        </button>
      </div>

      {/* Hero: All-American promo card. Text/branding is baked into the image
          so no overlays are added. Fallback shows the wordmark + name on a red gradient. */}
      <div className="max-w-lg md:max-w-2xl mx-auto mt-3 px-4">
        <div className="relative overflow-hidden rounded-xl border border-red-700/60 bg-zinc-950">
          <div className="relative aspect-[2/3]">
            {!heroFailed ? (
              <img
                src={HERO_PHOTO}
                alt="Elijah Joles - Adidas Folkstyle Nationals All-American"
                className="absolute inset-0 w-full h-full object-cover"
                onError={() => setHeroFailed(true)}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-red-950 via-black to-red-900 flex flex-col items-center justify-center px-6 text-center">
                {!wordmarkFailed ? (
                  <img
                    src={LOGO}
                    alt="EJ WRESTLE - Wrestle Through"
                    className="max-w-[80%] max-h-24 mb-4"
                    onError={() => setWordmarkFailed(true)}
                  />
                ) : (
                  <div className="text-white text-3xl font-black tracking-wide mb-3">
                    EJ WRESTLE
                  </div>
                )}
                <div className="text-red-300 text-[10px] font-black uppercase tracking-[0.25em] mb-1">
                  Featured Wrestler
                </div>
                <div className="text-white text-3xl font-black">
                  Elijah Joles
                </div>
                <div className="text-zinc-300 text-xs mt-1">
                  Adidas Folkstyle Nationals All-American
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Identity card: clean readout below the hero so the promo can breathe */}
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 mt-3">
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-red-300 text-[10px] font-black uppercase tracking-[0.22em]">
              Featured MatGrind Athlete
            </div>
            <div className="text-white text-xl font-black leading-tight mt-0.5">
              Elijah Joles
            </div>
            <div className="text-zinc-400 text-xs mt-0.5">
              Station Camp HS · 165 lb · Tennessee
            </div>
          </div>
          <div className="text-right">
            <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wider">Style</div>
            <div className="text-red-300 text-sm font-black">Freestyle</div>
            <div className="text-zinc-500 text-[10px]">Funky / Unorthodox</div>
          </div>
        </div>
      </div>

      {/* Boss-tier readout */}
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 mt-3">
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wider">Boss Tier</div>
              <div className="text-white text-2xl font-black leading-none mt-0.5">
                Overall {overall}
              </div>
            </div>
            <div className="text-right">
              <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wider">Boss Wins</div>
              <div className="text-white text-2xl font-black leading-none mt-0.5 tabular-nums">{bossWins}</div>
            </div>
          </div>
          <div className="space-y-1.5">
            <StatBar label="STR" value={stats.str} />
            <StatBar label="SPD" value={stats.spd} accent="highlight" />
            <StatBar label="TEC" value={stats.tec} />
            <StatBar label="END" value={stats.end} accent="muted" />
            <StatBar label="GRT" value={stats.grt} />
          </div>
          <div className="mt-3 text-[11px] text-zinc-500 leading-snug">
            Stats scale with your level - each Boss Win bumps him +3 (cap +12).
          </div>
        </div>
      </div>

      {/* Trash-talk teaser */}
      {teaserLine && (
        <div className="max-w-lg md:max-w-2xl mx-auto px-4 mt-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wider mb-1">
              From the boss
            </div>
            <div className="italic text-zinc-300 text-sm">"{teaserLine}"</div>
          </div>
        </div>
      )}

      {/* Bio collapsible */}
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 mt-3">
        <button
          type="button"
          onClick={() => setBioOpen(v => !v)}
          aria-expanded={bioOpen}
          className="w-full flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl px-4 py-3 text-left transition-colors"
        >
          <div className="text-white text-sm font-black uppercase tracking-wider">About Elijah</div>
          <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${bioOpen ? 'rotate-180' : ''}`} />
        </button>
        {bioOpen && (
          <div className="mt-2 bg-zinc-950 border border-zinc-800 rounded-xl p-4">
            <p className="text-zinc-300 text-sm leading-relaxed">
              Elijah Joles is a 15-year-old freestyle wrestler out of Station Camp HS in
              Tennessee. He wrestles 165 lb at the high-school level and trains for international
              freestyle competition. His style is built around speed, agility, and unorthodox
              attacks - granby escapes, slide-bys, ankle picks, and his signature "cow catcher"
              from a tie-up. Olympic gold is the goal.
            </p>
            <div className="mt-4">
              <div className="text-zinc-500 text-[10px] font-black uppercase tracking-wider mb-2">
                Accomplishments
              </div>
              <ul className="text-zinc-300 text-xs space-y-1 list-disc list-inside">
                <li>Adidas Folkstyle Nationals All-American</li>
                <li>Team USA AAU - Gold medalist</li>
                <li>Windsor Open - Champion</li>
              </ul>
            </div>
            {!secondaryFailed && (
              <img
                src={SECONDARY_PHOTO}
                alt="Elijah Joles - Windsor Open champion"
                className="mt-4 w-full rounded-lg border border-zinc-800"
                onError={() => setSecondaryFailed(true)}
              />
            )}
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-red-300 hover:text-red-200 text-xs font-bold"
            >
              <Instagram className="w-4 h-4" /> @EJwrestle
            </a>
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 mt-5">
        <button
          type="button"
          onClick={handleLaunch}
          disabled={launching}
          className={`w-full bg-red-600 hover:bg-red-500 active:scale-[0.98] text-white font-black text-base py-4 rounded-xl uppercase tracking-wider transition-all ${launching ? 'opacity-70 cursor-wait' : ''}`}
        >
          {launching ? 'Loading...' : 'Begin Boss Challenge'}
        </button>
      </div>

      {/* Disclaimer */}
      <div className="max-w-lg md:max-w-2xl mx-auto px-4 mt-4 text-center">
        <p className="text-zinc-600 text-[10px] leading-relaxed">
          Featured wrestler appears with permission. (c) Elijah Joles 2026.
        </p>
      </div>
    </div>
  );
}
