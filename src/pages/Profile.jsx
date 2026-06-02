// src/pages/Profile.jsx
//
// v2.0 "modern app" Profile overhaul.
//
// The goal here is engagement: a profile tab that feels like it rewards the
// player for coming back. The hero block shows a level ring that fills with
// XP, a rank / streak badge row, animated stat chips, a "next goal" nudge,
// and an achievement teaser. All existing Profile mechanics (name edit,
// singlet color, attribute allocation with respec, goals list, trophy case,
// full match history, delete-account flow) remain intact inside a familiar
// tab structure so nothing a returning player knows how to do is gone.
//
// Why this shape: App Store 4.2 reviewers pattern-match "modern game" on
// four things - a hero block that announces identity/level, a progression
// ring they instantly recognize, stat chips that animate on appear, and a
// next-step nudge that tells the player what to do next. This file delivers
// all four while respecting reduced-motion (every framer-motion animation
// collapses to a static variant when the user prefers it).

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Edit3, Flame, Trophy, Zap, TrendingUp, Award, ChevronRight, Target as TargetIcon, BarChart3, Timer, Target } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import HonorBadge from '../components/wrestling/HonorBadge';
import { toast } from '../components/ui/use-toast.jsx';
import { getProfile, saveProfile, getMatchHistory, respecStats } from '../lib/firestoreService.js';
import { loadGuestProfile, saveGuestProfile, loadGuestHistory } from '../lib/guestProfile.js';
import { COLOR_PRESETS, chestColorToPresetId, getDefaultSinglet } from '../lib/wrestlerColors.js';
import { buildSinglet } from '../lib/singletDesign.js';
import SingletCreator from '../components/wrestling/SingletCreator.jsx';
import {
  getLevelFromXP, getXPProgress, getXPToNextLevel, getTitleForLevel,
  loadGoals, getDailyGoals, getWeeklyGoals, ACHIEVEMENTS,
  getBetaTesterMedals, isFoundersClubMember,
  getStatCap, ABS_STAT_CEILING, STAT_CAP_LEVEL_THRESHOLD, STAT_CAP_LEVELS_PER_POINT,
} from '../lib/profileUtils.js';
import TrophyCase from '../components/wrestling/TrophyCase.jsx';
import { getLeaderboard, CATEGORIES } from '../lib/leaderboardService.js';
import { BEST_KEYS } from '../components/training/TrainingHub.jsx';
import NavBar from '../components/ui/NavBar';
import useReducedMotion from '../lib/useReducedMotion.js';
import { haptic } from '../lib/haptics.js';

const CATEGORY_LABEL = { wins: 'Wins', level: 'Level', streak: 'Streak', pins: 'Pins' };

const RESULT_COLOR = { win: 'text-emerald-400', loss: 'text-red-400', draw: 'text-zinc-400' };
const METHOD_LABEL = { pin: 'Pin', tech_fall: 'Tech Fall', decision: 'Decision', draw: 'Draw' };
const METHOD_COLOR = { pin: 'text-red-400', tech_fall: 'text-purple-400', decision: 'text-zinc-400', draw: 'text-zinc-600' };

function timeUntil(isoString) {
  const ms = new Date(isoString).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Count-up number ────────────────────────────────────────────────────────
// Drives a brief "slot machine" feel on the stat chips the first time the
// profile opens. Reduced-motion players see the final value immediately.
/**
 * @param {{ value: number, duration?: number, className?: string, suffix?: string }} props
 */
function CountUp({ value, duration = 0.8, className = '', suffix = '' }) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (reduce) { setDisplay(value); return; }
    const start = performance.now();
    const from = 0;
    const to = value;
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [value, duration, reduce]);

  return <span className={className}>{display}{suffix}</span>;
}

// ─── Level ring ─────────────────────────────────────────────────────────────
// SVG ring with the XP-to-next fill in front. Avatar initials live in the
// middle along with the level number - iconography matches Duolingo / Strava
// / Apple Fitness so the shape reads as "progression" with zero copy.
function LevelRing({ level, progress, needed, title, color, initials, reduce }) {
  const RING_SIZE = 140;
  const STROKE = 8;
  const r = (RING_SIZE - STROKE) / 2;
  const C = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, needed > 0 ? progress / needed : 0));
  const dashOffset = C * (1 - pct);

  return (
    <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} className="rotate-[-90deg]">
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={r}
          stroke="rgba(63,63,70,0.6)"
          strokeWidth={STROKE}
          fill="transparent"
        />
        <motion.circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={r}
          stroke="url(#lvlgrad)"
          strokeWidth={STROKE}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={reduce ? { strokeDashoffset: dashOffset } : { strokeDashoffset: C }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={reduce ? { duration: 0 } : { duration: 1.1, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="lvlgrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fde047" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`text-[10px] font-black uppercase tracking-wider ${color}`}>{title}</div>
        <div className="text-white text-3xl font-black leading-none mt-0.5">{initials}</div>
        <div className="text-zinc-400 text-[11px] font-bold mt-1">Lvl {level}</div>
      </div>
    </div>
  );
}

/**
 * @param {{ goal: any, weekly?: boolean }} props
 */
function GoalCard({ goal, weekly = false }) {
  const pct = Math.min(100, Math.round((goal.current / goal.target) * 100));
  return (
    <div className={`rounded-xl border p-3 ${
      goal.completed
        ? 'bg-emerald-950/30 border-emerald-800/40'
        : weekly
          ? 'bg-zinc-900 border-yellow-900/40'
          : 'bg-zinc-900 border-zinc-800'
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className={`text-xs font-bold ${goal.completed ? 'text-emerald-400' : 'text-white'}`}>
            {goal.completed && '✓ '}{goal.label}
          </div>
          <div className="text-yellow-500 text-xs mt-0.5">+{goal.xpReward} XP</div>
        </div>
        <div className="text-zinc-400 text-xs font-mono ml-2 shrink-0">
          {goal.current}/{goal.target}
        </div>
      </div>
      <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${goal.completed ? 'bg-emerald-500' : weekly ? 'bg-yellow-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const STAT_INFO = [
  { key: 'str', label: 'Strength',  short: 'STR', desc: 'Powers takedowns, turns & pins' },
  { key: 'spd', label: 'Speed',     short: 'SPD', desc: 'Powers counters, escapes & scrambles' },
  { key: 'tec', label: 'Technique', short: 'TEC', desc: 'Reduces repeat-move penalties; boosts chains' },
  { key: 'end', label: 'Endurance', short: 'END', desc: 'More starting stamina, lower fatigue cost' },
  { key: 'grt', label: 'Grit',      short: 'GRT', desc: 'Powers bottom escapes; resists pins & STR' },
];

// Local wrapper around SingletCreator that owns its own draft state + Save
// button so the rest of Profile doesn't have to round-trip every keystroke
// through Firestore. Persists on Save click only.
function SingletEditorBlock({ profile, setProfile, userUid }) {
  const initial = profile?.appearance?.singlet || getDefaultSinglet(profile);
  const [draft, setDraft] = useState(buildSinglet(initial, getDefaultSinglet(profile)));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Re-seed draft if the underlying profile.appearance.singlet changes from
  // outside (e.g. a fresh load completes after the editor mounted).
  useEffect(() => {
    setDraft(buildSinglet(profile?.appearance?.singlet, getDefaultSinglet(profile)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Keep legacy primaryColor / accentColor in sync so existing renderers
      // (MatchResultModal, TournamentBracket, careerBrackets, dualMeetTeams)
      // keep producing the right tints without per-call lookups.
      const presetId = chestColorToPresetId(draft.chestColor);
      const preset = COLOR_PRESETS.find(c => c.id === presetId);
      const newAppearance = {
        ...(profile?.appearance || {}),
        primaryColor: presetId !== 'custom' ? presetId : 'emerald',
        accentColor:  preset?.dark || draft.chestColor,
        singlet:      draft,
      };
      if (userUid) {
        await saveProfile(userUid, { appearance: newAppearance });
      }
      setProfile(prev => ({ ...prev, appearance: newAppearance }));
      setSaved(true);
      try { haptic.light(); } catch { /* silent */ }
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.warn('[Profile] singlet save failed:', err);
    }
    setSaving(false);
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="text-zinc-500 text-xs font-black uppercase tracking-wider">Singlet Design</div>
      <SingletCreator
        value={draft}
        onChange={setDraft}
        defaults={getDefaultSinglet(profile)}
      />
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 active:scale-95 text-black font-black text-sm py-3 rounded-xl transition-all"
      >
        {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Singlet'}
      </button>
    </div>
  );
}

export default function Profile({ onBack, fallbackProfile, onSignIn, onViewLeaderboard }) {
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [editTeam, setEditTeam] = useState(false);
  const [teamInput, setTeamInput] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingStats, setPendingStats] = useState(null);
  const [statSaving, setStatSaving] = useState(false);
  const [respecConfirm, setRespecConfirm] = useState(false);
  const [respecLoading, setRespecLoading] = useState(false);
  const [rankBadge, setRankBadge] = useState(null);
  const { user, logout, deleteAccount } = useAuth();
  const reduce = useReducedMotion();

  const handleDeleteAccount = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      // Full account deletion - Firestore data AND the Firebase Auth user
      // (required by Apple 5.1.1(v)). AuthContext.deleteAccount owns both
      // sides so we don't accidentally skip the Auth half again.
      await deleteAccount();
      // deleteUser clears the auth state, which onAuthStateChanged picks up
      // and the UI reacts to. No explicit logout() needed. Close the modal
      // explicitly so this component (still mounted briefly) doesn't show
      // a stale dialog over the post-signout view.
      setShowDeleteConfirm(false);
      toast({ title: 'Account deleted', description: 'Your data has been removed.' });
    } catch (e) {
      console.error('Failed to delete account:', e);
      setShowDeleteConfirm(false);
      // Firebase requires a fresh sign-in to delete an Auth user that
      // hasn't authenticated recently. Surface that to the user instead
      // of silently logging them out - otherwise the button looks broken.
      if (e?.code === 'auth/requires-recent-login') {
        toast({
          title: 'Sign in again to finish deleting',
          description: 'For security, please sign in again, then try Delete Account once more.',
          variant: 'destructive',
        });
        // Sign out so the next sign-in is "recent" and the retry works.
        try { await logout(); } catch { /* best-effort */ }
      } else {
        toast({
          title: 'Delete failed',
          description: e?.message || 'Could not delete account. Check your connection and try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setDeleting(false);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    if (user?.uid) {
      try {
        const [profileData, matches] = await Promise.all([
          getProfile(user.uid),
          getMatchHistory(user.uid, 30),
        ]);
        const p = profileData || fallbackProfile || null;
        if (p) {
          setProfile(p);
          setNameInput(p.username || '');
          setTeamInput(p.team || '');
        }
        setHistory(matches);
      } catch (err) {
        console.warn('[Profile] Load error:', err);
        if (fallbackProfile) {
          setProfile(fallbackProfile);
          setNameInput(fallbackProfile.username || '');
          setTeamInput(fallbackProfile.team || '');
        }
      }
    } else {
      const guestProfile = loadGuestProfile() || fallbackProfile;
      if (guestProfile) {
        setProfile(guestProfile);
        setNameInput(guestProfile.username || '');
        setTeamInput(guestProfile.team || '');
      }
      // Guest history is kept locally too - same shape as Firestore so the
      // same render path works.
      setHistory(loadGuestHistory());
    }
    setLoading(false);
  }, [user?.uid, fallbackProfile]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          CATEGORIES.map(async (cat) => {
            const entries = await getLeaderboard(cat, 8);
            const idx = entries.findIndex(e => /** @type {any} */ (e).uid === user.uid);
            return idx >= 0 ? { rank: idx + 1, category: cat } : null;
          })
        );
        if (cancelled) return;
        const valid = results.filter(Boolean);
        if (valid.length > 0) {
          valid.sort((a, b) => a.rank - b.rank);
          setRankBadge(valid[0]);
        }
      } catch (_err) { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Stat allocation persistence.
  //
  // Prior iteration required an explicit "Save Stats" tap after adjusting -
  // in practice players would tap +, feel like they were done, and navigate
  // away without pressing Save, losing the change. This shipped as a real
  // "my points didn't save" bug report. Auto-save eliminates that class of
  // failure: every +/- click schedules a Firestore write ~700ms later,
  // which also debounces rapid multi-click allocation into a single
  // updateDoc instead of thrashing the network.
  //
  // Refs mirror the live state so the unmount-cleanup and the debounce
  // timer can flush the latest pendingStats without going through stale
  // closures.
  const saveTimer = useRef(null);
  const pendingStatsRef = useRef(null);
  const profileRef = useRef(null);
  const uidRef = useRef(null);
  useEffect(() => { pendingStatsRef.current = pendingStats; }, [pendingStats]);
  useEffect(() => { profileRef.current = profile; }, [profile]);
  useEffect(() => { uidRef.current = user?.uid; }, [user?.uid]);

  const flushStats = useCallback(async () => {
    const ps = pendingStatsRef.current;
    const prof = profileRef.current;
    const uid = uidRef.current;
    if (!ps || !prof) return;
    const spentOnPending = Object.values(ps).reduce((a, b) => a + b, 0);
    const original = Object.values(prof.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 }).reduce((a, b) => a + b, 0);
    const spent = spentOnPending - original;
    const newAvailable = (prof.stat_points_available || 0) - spent;
    const nextProfile = {
      ...prof,
      stats: ps,
      stat_points_available: Math.max(0, newAvailable),
    };
    setStatSaving(true);
    try {
      if (uid) {
        const saved = await saveProfile(uid, nextProfile);
        setProfile(saved);
      } else {
        // Guest: persist directly so attribute changes survive reload
        // and get migrated on sign-in.
        saveGuestProfile(nextProfile);
        setProfile(nextProfile);
      }
      setPendingStats(null);
      try { haptic.success(); } catch { /* silent */ }
    } catch (err) { console.warn('[Profile] Stat save error:', err); }
    setStatSaving(false);
  }, []);

  // Explicit-save handler kept for the "Save now" button so players who
  // want the reassurance of a button press still get it.
  const saveStats = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    return flushStats();
  }, [flushStats]);

  // Debounced auto-save whenever pendingStats changes.
  useEffect(() => {
    if (!pendingStats) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { flushStats(); }, 700);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [pendingStats, flushStats]);

  // Force-flush on unmount (tab-switch / back navigation with unsaved edits).
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pendingStatsRef.current) { flushStats(); }
    };
  }, [flushStats]);

  const handleRespec = async () => {
    setRespecLoading(true);
    try {
      if (user?.uid) {
        const updated = await respecStats(user.uid);
        setProfile(updated);
      } else {
        // Guest respec: same 3-lifetime cap, enforced against local storage.
        const prof = profileRef.current;
        if (!prof) throw new Error('Profile not found');
        const MAX_RESPECS = 3;
        const used = prof.respecs_used || 0;
        if (used >= MAX_RESPECS) throw new Error('No respecs remaining');
        const baseStats = prof.base_stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
        const pointsToRefund = (prof.level || 1) - 1;
        const next = {
          ...prof,
          stats: { ...baseStats },
          stat_points_available: pointsToRefund,
          respecs_used: used + 1,
        };
        saveGuestProfile(next);
        setProfile(next);
      }
      setPendingStats(null);
      setRespecConfirm(false);
    } catch (err) {
      console.warn('[Profile] Respec error:', err);
      alert(err.message === 'No respecs remaining' ? 'No respecs remaining! You\'ve used all 3.' : 'Failed to reset stats.');
    }
    setRespecLoading(false);
  };

  const saveName = async () => {
    if (!nameInput.trim()) return;
    // Client-side profanity check - Firestore rules are the real gate,
    // this surfaces a readable error instead of permission-denied.
    let cleanName;
    try {
      const { filterOrThrow } = await import('../lib/profanity.js');
      cleanName = filterOrThrow(nameInput);
    } catch (e) {
      if (e?.code === 'PROFANITY') {
        alert('Please try a different name. (DM me if you think this is a mistake.)');
        return;
      }
      throw e;
    }
    try {
      const data = profile
        ? { ...profile, username: cleanName }
        : { username: cleanName, wins: 0, losses: 0, draws: 0, pins: 0, tech_falls: 0, total_points: 0, xp: 0, level: 1 };
      if (user?.uid) {
        const saved = await saveProfile(user.uid, data);
        setProfile(saved);
      } else {
        setProfile(data);
        saveGuestProfile(data);
      }
      try { haptic.light(); } catch { /* silent */ }
    } catch (err) { console.warn('[Profile] Save error:', err); }
    setEditName(false);
  };

  const saveTeam = async () => {
    let cleanTeam;
    try {
      const { filterOrThrow } = await import('../lib/profanity.js');
      cleanTeam = filterOrThrow(teamInput);
    } catch (e) {
      if (e?.code === 'PROFANITY') {
        alert('Please try a different team name. (DM me if you think this is a mistake.)');
        return;
      }
      throw e;
    }
    try {
      const data = { ...(profile || {}), team: cleanTeam };
      if (user?.uid) {
        const saved = await saveProfile(user.uid, data);
        setProfile(saved);
      } else {
        setProfile(data);
        saveGuestProfile(data);
      }
      try { haptic.light(); } catch { /* silent */ }
    } catch (err) { console.warn('[Profile] Save team error:', err); }
    setEditTeam(false);
  };

  const saveVisibility = async (next) => {
    if (!profile) return;
    const data = { ...profile, profile_visibility: next };
    try {
      if (user?.uid) {
        const saved = await saveProfile(user.uid, data);
        setProfile(saved);
      } else {
        setProfile(data);
        saveGuestProfile(data);
      }
      try { haptic.light(); } catch { /* silent */ }
    } catch (err) { console.warn('[Profile] Save visibility error:', err); }
  };

  const switchTab = (id) => {
    if (id === activeTab) return;
    try { haptic.light(); } catch { /* silent */ }
    setActiveTab(id);
  };

  // Goals (hook-safe: must compute BEFORE any conditional return so that
  // the useMemo below runs unconditionally on every render).
  const goals       = loadGoals(profile?.goals_json);
  const dailyGoals  = goals.filter(g => g.type === 'daily');
  const weeklyGoals = goals.filter(g => g.type === 'weekly');

  // Next goal - closest-to-completion uncompleted daily goal. Drives the
  // "what should I do next" nudge under the stat chips.
  const nextGoal = useMemo(() => {
    const remaining = dailyGoals.filter(g => !g.completed);
    if (remaining.length === 0) return null;
    return [...remaining].sort((a, b) => {
      const pa = a.target > 0 ? a.current / a.target : 0;
      const pb = b.target > 0 ? b.current / b.target : 0;
      return pb - pa;
    })[0];
    // dailyGoals is rebuilt from profile.goals_json each render; key off the raw string.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.goals_json]);

  if (loading) {
    return (
      <div className="min-h-full bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm animate-pulse">Loading profile...</div>
      </div>
    );
  }

  // Auth race: on first navigation, Firebase auth may not have resolved yet.
  // `loadData` runs the guest path (no profile), sets loading=false, then auth
  // settles and re-fires loadData with the real uid. Show a holding state so
  // the full profile UI never renders with all-default/empty values.
  if (!profile) {
    if (user?.uid) {
      // Authenticated but fetch failed or is in flight - show spinner + retry.
      return (
        <div className="h-full bg-zinc-950 text-white flex flex-col">
          <NavBar title="Wrestler Profile" onBack={onBack} />
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-zinc-500 text-sm animate-pulse">Loading profile…</div>
            <button
              onClick={loadData}
              className="text-yellow-400 text-xs font-bold mt-2 active:scale-95"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    // Guest with no profile yet - encourage them to play or sign in.
    return (
      <div className="h-full bg-zinc-950 text-white flex flex-col">
        <NavBar title="Wrestler Profile" onBack={onBack} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="text-5xl">🤼</div>
          <div className="text-white font-black text-lg">No profile yet</div>
          <div className="text-zinc-400 text-sm leading-relaxed">
            Play a match to start building your record, or sign in to load your saved progress.
          </div>
          {onSignIn && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onSignIn('signup')}
                className="bg-emerald-500 text-black font-black px-4 py-2 rounded-xl text-sm active:scale-95"
              >
                Create Account
              </button>
              <button
                onClick={() => onSignIn('login')}
                className="border border-zinc-700 text-zinc-300 font-bold px-4 py-2 rounded-xl text-sm active:scale-95"
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const xp       = profile?.xp || 0;
  const level    = getLevelFromXP(xp);
  const title    = getTitleForLevel(level);
  const progress = getXPProgress(xp);
  const needed   = getXPToNextLevel(xp);
  const wins     = profile?.wins || 0;
  const losses   = profile?.losses || 0;
  const draws    = profile?.draws || 0;
  const total    = wins + losses + draws;
  // Win%: wins / (wins+losses+draws), 1-decimal. Em-dash when no matches
  // played so the chip doesn't claim "0.0%" before the first match.
  const winPctStr = total > 0
    ? `${((wins / total) * 100).toFixed(1)}%`
    : '-';
  const xpToNext = Math.max(0, needed - progress);

  // Derived
  const totalTDs = history.reduce((s, m) => s + (m.player_takedowns || 0), 0);
  const totalEsc = history.reduce((s, m) => s + (m.player_escapes   || 0), 0);
  const totalNF  = history.reduce((s, m) => s + (m.player_near_falls|| 0), 0);
  const avgScore = history.length > 0
    ? (history.reduce((s, m) => s + (m.player_score || 0), 0) / history.length).toFixed(1)
    : '-';
  const pinWins  = history.filter(m => m.result === 'win' && m.win_method === 'pin').length;
  // Pin%: pins / wins, 1-decimal. Em-dash when no wins yet.
  const pinRateStr = wins > 0
    ? `${((pinWins / wins) * 100).toFixed(1)}%`
    : '-';

  let currentStreak = 0;
  for (const m of history) {
    if (m.result === 'win') currentStreak++;
    else break;
  }

  const earnedIds = (() => {
    try { return JSON.parse(profile?.achievements_json || '[]'); }
    catch { return []; }
  })();

  // Most recent earned achievement + next-to-unlock preview
  const recentAch = earnedIds.length > 0
    ? ACHIEVEMENTS.find(a => a.id === earnedIds[earnedIds.length - 1])
    : null;
  const nextAch = ACHIEVEMENTS.find(a => !earnedIds.includes(a.id));

  const levelColor =
    level >= 100 ? 'text-yellow-200' :
    level >= 91  ? 'text-yellow-300' :
    level >= 76  ? 'text-amber-400'  :
    level >= 61  ? 'text-emerald-300':
    level >= 41  ? 'text-emerald-400':
    level >= 21  ? 'text-blue-400'   : 'text-zinc-400';

  const initials = (profile?.username || 'W')
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'W';

  const primaryPreset = COLOR_PRESETS.find(c => c.id === profile?.appearance?.primaryColor) || COLOR_PRESETS.find(c => c.id === 'emerald') || COLOR_PRESETS[0];

  // Attrs
  const wrestlerStats = pendingStats || profile?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
  const statPointsAvailable = (profile?.stat_points_available || 0) - (pendingStats
    ? Object.values(pendingStats).reduce((a, b) => a + b, 0) - Object.values(profile?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 }).reduce((a, b) => a + b, 0)
    : 0);
  const hasUnspentPoints = (profile?.stat_points_available || 0) > 0;
  // Per-stat cap rises with profile level past STAT_CAP_LEVEL_THRESHOLD
  // (every STAT_CAP_LEVELS_PER_POINT levels = +1 cap, until ABS_STAT_CEILING).
  // Sourced from profileUtils so the engine, allocation UI, and progress
  // bars all agree on the same value.
  const statCap = getStatCap(profile?.level);

  const adjustPendingStat = (key, delta) => {
    const base = pendingStats || profile?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
    const newVal = Math.max(1, Math.min(statCap, base[key] + delta));
    const newStats = { ...base, [key]: newVal };
    const spentChange = newVal - base[key];
    const available = profile?.stat_points_available || 0;
    const alreadySpent = pendingStats
      ? Object.values(pendingStats).reduce((a, b) => a + b, 0) - Object.values(profile?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 }).reduce((a, b) => a + b, 0)
      : 0;
    if (alreadySpent + spentChange > available) return;
    if (alreadySpent + spentChange < 0) return;
    try { haptic.light(); } catch { /* silent */ }
    setPendingStats(newStats);
  };

  const heroVariants = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.15 } } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' } } };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title="Wrestler Profile" onBack={onBack} />

      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <motion.div
        className="flex-shrink-0 mx-4 mb-3"
        initial={heroVariants.initial}
        animate={heroVariants.animate}
      >
        <div
          className="relative overflow-hidden rounded-2xl border border-zinc-700/70 p-4"
          style={{
            background: `linear-gradient(140deg, ${primaryPreset.primary}33 0%, rgba(24,24,27,0.95) 55%, rgba(9,9,11,1) 100%)`,
          }}
        >
          {/* Decorative blob */}
          <div
            aria-hidden="true"
            className="absolute -top-10 -right-10 w-40 h-40 rounded-full blur-3xl opacity-30 pointer-events-none"
            style={{ background: primaryPreset.primary }}
          />

          <div className="relative flex items-center gap-4">
            <LevelRing
              level={level}
              progress={progress}
              needed={needed}
              title={title}
              color={levelColor}
              initials={initials}
              reduce={reduce}
            />

            <div className="flex-1 min-w-0">
              {editName ? (
                <div className="flex gap-2 items-center">
                  <input
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    className="bg-zinc-800 border border-zinc-600 text-white rounded px-2 py-1 text-sm w-full max-w-[160px] focus:outline-none focus:border-yellow-500"
                    autoFocus maxLength={20}
                    onKeyDown={e => e.key === 'Enter' && saveName()}
                  />
                  <button onClick={saveName} className="text-emerald-400 text-xs font-bold px-2 py-1 active:scale-95">Save</button>
                  <button onClick={() => setEditName(false)} className="text-zinc-500 text-xs active:scale-95">✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="text-white font-black text-lg truncate max-w-[180px]">
                    {profile?.username || 'Unnamed Wrestler'}
                  </div>
                  <button
                    onClick={() => setEditName(true)}
                    aria-label="Edit name"
                    className="text-zinc-500 hover:text-zinc-300 active:scale-90 p-0.5"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Team line - free-text school/club. Inline-edit pattern
                  matches username above. Profanity-filtered on save. */}
              {editTeam ? (
                <div className="flex gap-2 items-center mt-1">
                  <input
                    value={teamInput}
                    onChange={e => setTeamInput(e.target.value)}
                    placeholder="Team (e.g. your club or school)"
                    className="bg-zinc-800 border border-zinc-600 text-white rounded px-2 py-1 text-xs w-full max-w-[200px] focus:outline-none focus:border-yellow-500"
                    autoFocus maxLength={40}
                    onKeyDown={e => e.key === 'Enter' && saveTeam()}
                  />
                  <button onClick={saveTeam} className="text-emerald-400 text-xs font-bold px-2 py-1 active:scale-95">Save</button>
                  <button onClick={() => { setEditTeam(false); setTeamInput(profile?.team || ''); }} className="text-zinc-500 text-xs active:scale-95">✕</button>
                </div>
              ) : (
                <button
                  onClick={() => setEditTeam(true)}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 active:scale-95 mt-1"
                >
                  <span>🏫</span>
                  <span className="truncate max-w-[180px]">{profile?.team || 'Add team'}</span>
                  <Edit3 className="w-3 h-3 opacity-60" />
                </button>
              )}

              {/* Badge row: rank + streak + next-level tease */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {/* Founders Club + Beta Tester chips - pinned legacy awards.
                    Tapping jumps to the Badges tab where the full cards live. */}
                {isFoundersClubMember(profile) && (
                  <button
                    onClick={() => switchTab('achievements')}
                    className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-gradient-to-r from-indigo-500/25 to-violet-500/10 text-indigo-300 ring-1 ring-indigo-400/50 active:scale-95 transition-all"
                    title="Founders Club - tap to view"
                  >
                    🎖️ Founders Club
                  </button>
                )}
                {getBetaTesterMedals(profile).length > 0 && (
                  <button
                    onClick={() => switchTab('achievements')}
                    className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-gradient-to-r from-yellow-500/25 to-amber-500/10 text-yellow-300 ring-1 ring-yellow-400/50 active:scale-95 transition-all"
                    title="Beta Tester - tap to view medals"
                  >
                    🧪 Beta Tester
                    {getBetaTesterMedals(profile).length > 1 && (
                      <span className="text-yellow-400/80">×{getBetaTesterMedals(profile).length}</span>
                    )}
                  </button>
                )}
                {rankBadge && (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full ${
                    rankBadge.rank === 1
                      ? 'bg-yellow-500/20 text-yellow-400 ring-1 ring-yellow-500/40'
                      : rankBadge.rank <= 3
                        ? 'bg-zinc-400/15 text-zinc-200 ring-1 ring-zinc-400/30'
                        : 'bg-amber-700/20 text-amber-400 ring-1 ring-amber-700/30'
                  }`}>
                    <Trophy className="w-3 h-3" /> #{rankBadge.rank} {CATEGORY_LABEL[rankBadge.category]}
                  </span>
                )}
                {currentStreak >= 2 && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 ring-1 ring-orange-500/40">
                    <Flame className="w-3 h-3" /> {currentStreak}-win streak
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30">
                  <Zap className="w-3 h-3" /> {xpToNext.toLocaleString()} XP to Lvl {level + 1}
                </span>
              </div>

              {/* XP progress bar */}
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
                  <span>{xp.toLocaleString()} XP total</span>
                  <span>{progress}/{needed}</span>
                </div>
                <div className="h-2 bg-zinc-900/80 rounded-full overflow-hidden ring-1 ring-zinc-800">
                  <motion.div
                    className="h-full bg-gradient-to-r from-yellow-400 to-amber-500 rounded-full"
                    initial={reduce ? { width: `${Math.min(100, (progress / needed) * 100)}%` } : { width: 0 }}
                    animate={{ width: `${Math.min(100, (progress / needed) * 100)}%` }}
                    transition={reduce ? { duration: 0 } : { duration: 1.1, ease: 'easeOut' }}
                  />
                </div>
              </div>
            </div>
            <HonorBadge uid={user?.uid} size="lg" />
          </div>
        </div>
      </motion.div>

      {/* ── GUEST SIGN-IN CTA ──────────────────────────────────────────── */}
      {/* Profile still renders for guests (local/fallback profile) so they
          can see stats they've accumulated offline. But Online Multiplayer
          and cross-device history require an account - surface the entry
          point here so "Go to your profile to sign in" (from the network
          lobby gate) actually lands on something actionable. */}
      {!user?.uid && onSignIn && (
        <div className="flex-shrink-0 mx-4 mb-3 rounded-2xl border border-emerald-800/50 bg-gradient-to-br from-emerald-950/60 via-zinc-900/80 to-zinc-950 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-emerald-400 text-[10px] font-black uppercase tracking-wider">Playing as guest</div>
              <div className="text-white text-xs font-bold mt-0.5">Sign in to unlock online play, rankings & cross-device saves.</div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => onSignIn('signup')}
              className="py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] text-black font-black text-xs transition-all"
            >
              Create Account
            </button>
            <button
              onClick={() => onSignIn('login')}
              className="py-2 rounded-lg border border-emerald-700/60 bg-emerald-950/40 hover:bg-emerald-900/40 active:scale-[0.98] text-emerald-300 font-black text-xs transition-all"
            >
              Sign In
            </button>
          </div>
        </div>
      )}

      {/* ── QUICK STAT CHIPS (4-up) ─────────────────────────────────────── */}
      <div className="flex-shrink-0 mx-4 mb-3 grid grid-cols-4 gap-2">
        {[
          { label: 'Wins',  value: wins,    color: 'text-emerald-400', bg: 'from-emerald-500/10 to-emerald-500/0', ring: 'ring-emerald-700/30' },
          // Win% is a pre-formatted string ('X.Y%' or '-') - skip CountUp
          // so the decimal + zero-state render correctly.
          { label: 'Win%',  text: winPctStr, color: 'text-blue-400',    bg: 'from-blue-500/10 to-blue-500/0',    ring: 'ring-blue-700/30' },
          { label: 'Pins',  value: profile?.pins || 0, color: 'text-red-400', bg: 'from-red-500/10 to-red-500/0', ring: 'ring-red-700/30' },
          { label: 'TFs',   value: profile?.tech_falls || 0, color: 'text-purple-400', bg: 'from-purple-500/10 to-purple-500/0', ring: 'ring-purple-700/30' },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: reduce ? 0 : 0.1 + i * 0.05, duration: 0.25 }}
            className={`rounded-xl bg-gradient-to-b ${s.bg} ring-1 ${s.ring} p-2 text-center`}
          >
            <div className={`text-xl font-black ${s.color} tabular-nums`}>
              {s.text != null ? s.text : <CountUp value={s.value} suffix={s.suffix || ''} />}
            </div>
            <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mt-0.5">{s.label}</div>
          </motion.div>
        ))}
      </div>

      {/* ── NEXT-STEP NUDGE (daily goal) + achievement teaser row ─────── */}
      <div className="flex-shrink-0 mx-4 mb-3 space-y-2">
        {nextGoal && (
          <button
            onClick={() => switchTab('goals')}
            className="w-full flex items-center gap-3 rounded-xl bg-zinc-900/80 ring-1 ring-zinc-800 hover:ring-blue-700/50 active:scale-[0.99] p-3 text-left transition-all"
          >
            <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-blue-500/15 ring-1 ring-blue-500/30 flex items-center justify-center">
              <TargetIcon className="w-4 h-4 text-blue-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <div className="text-white text-xs font-black truncate">{nextGoal.label}</div>
                <div className="text-zinc-500 text-[10px] font-mono ml-2">
                  {nextGoal.current}/{nextGoal.target}
                </div>
              </div>
              <div className="mt-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${Math.min(100, (nextGoal.current / nextGoal.target) * 100)}%` }}
                />
              </div>
              <div className="text-yellow-500 text-[10px] font-bold mt-1">+{nextGoal.xpReward} XP reward</div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
          </button>
        )}

        {(recentAch || nextAch) && (
          <div className="grid grid-cols-2 gap-2">
            {recentAch && (
              <button
                onClick={() => switchTab('achievements')}
                className="flex items-center gap-2 rounded-xl bg-zinc-900/80 ring-1 ring-emerald-800/40 hover:ring-emerald-600/60 active:scale-[0.99] p-2 text-left transition-all"
              >
                <div className="text-xl flex-shrink-0">{recentAch.icon}</div>
                <div className="min-w-0">
                  <div className="text-[9px] font-black uppercase tracking-wider text-emerald-400">Latest</div>
                  <div className="text-white text-[11px] font-bold truncate">{recentAch.name}</div>
                </div>
              </button>
            )}
            {nextAch && (
              <button
                onClick={() => switchTab('achievements')}
                className="flex items-center gap-2 rounded-xl bg-zinc-900/80 ring-1 ring-zinc-800 hover:ring-amber-700/50 active:scale-[0.99] p-2 text-left transition-all"
              >
                <div className="text-xl opacity-50 grayscale flex-shrink-0">{nextAch.icon}</div>
                <div className="min-w-0">
                  <div className="text-[9px] font-black uppercase tracking-wider text-amber-500">Next up</div>
                  <div className="text-white text-[11px] font-bold truncate">{nextAch.name}</div>
                </div>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── TAB BAR ───────────────────────────────────────────────────── */}
      {/* Sticks under NavBar as the page scrolls so the active tab and the
          unspent-stat dot stay visible. bg + backdrop-blur keep content
          from bleeding through during the scroll. */}
      <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm flex gap-1 px-4 py-2">
        {[
          { id: 'overview',     label: 'Stats'    },
          { id: 'attributes',   label: hasUnspentPoints ? `Attrs ●` : 'Attrs' },
          { id: 'goals',        label: 'Goals'    },
          { id: 'achievements', label: 'Badges'   },
          { id: 'history',      label: 'History'  },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 ${
              activeTab === tab.id
                ? 'bg-yellow-500 text-zinc-950 shadow-[0_2px_8px_rgba(234,179,8,0.35)]'
                : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300 border border-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── CONTENT ───────────────────────────────────────────────────── */}
      {/* No nested scroll container - AppShell's <main> owns scroll so the
          tab bar above can stick to its top. pb-[env(safe-area-inset-bottom)]
          keeps the last card above the iPhone home-indicator. */}
      <div className="px-4 pt-3 pb-6 pb-[env(safe-area-inset-bottom)] space-y-3 md:max-w-2xl md:mx-auto w-full">

        {activeTab === 'overview' && (
          <>
            {/* Training bests + Leaderboard shortcut.
                These migrated off the now-retired Progress tab. Training
                bests live in localStorage and are written by TrainingHub
                drills; the Leaderboard row deep-links into the existing
                global Leaderboard screen. */}
            <ProfileTrainingBestsAndLeaderboard onViewLeaderboard={onViewLeaderboard} />

            {/* Detailed stats card with entry animation */}
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
            >
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-3.5 h-3.5 text-zinc-500" />
                <div className="text-zinc-500 text-xs font-black uppercase tracking-wider">Career Breakdown</div>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: 'Overall Win Rate',    value: winPctStr },
                  { label: 'Takedowns (career)', value: totalTDs },
                  { label: 'Escapes (career)',    value: totalEsc },
                  { label: 'Near-Falls (career)', value: totalNF  },
                  { label: 'Avg Score / Match',   value: avgScore },
                  { label: 'Pin Rate (of wins)',  value: pinRateStr },
                  { label: 'Current Win Streak',  value: currentStreak || '-' },
                  { label: 'Losses',              value: losses },
                  { label: 'Draws',               value: draws },
                  { label: 'Total Points',        value: (profile?.total_points || 0).toLocaleString() },
                ].map(s => (
                  <div key={s.label} className="flex justify-between items-center border-b border-zinc-800/50 pb-2 last:border-0 last:pb-0">
                    <span className="text-zinc-400 text-xs">{s.label}</span>
                    <span className="text-white text-xs font-bold tabular-nums">{s.value}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Recent matches preview (last 5) */}
            {history.length > 0 && (
              <motion.div
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: 0.05 }}
                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <div className="flex items-center gap-2">
                    <Award className="w-3.5 h-3.5 text-zinc-500" />
                    <div className="text-zinc-500 text-xs font-black uppercase tracking-wider">Recent Matches</div>
                  </div>
                  <button
                    onClick={() => switchTab('history')}
                    className="text-blue-400 text-[11px] font-bold active:scale-95"
                  >
                    See all →
                  </button>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {history.slice(0, 5).map(m => (
                    <div key={m.id} className={`px-4 py-2 flex items-center justify-between border-l-2 ${
                      m.result === 'win'  ? 'border-emerald-600' :
                      m.result === 'loss' ? 'border-red-800'     : 'border-zinc-700'
                    }`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-black text-[10px] uppercase ${RESULT_COLOR[m.result]}`}>{m.result}</span>
                          <span className={`text-[10px] ${METHOD_COLOR[m.win_method]}`}>{METHOD_LABEL[m.win_method]}</span>
                        </div>
                        <div className="text-zinc-500 text-[10px] mt-0.5 truncate">vs {m.opponent_name}</div>
                      </div>
                      <div className="text-right ml-2 flex-shrink-0">
                        <div className="text-white text-xs font-bold tabular-nums">{m.player_score}-{m.opponent_score}</div>
                        <div className="text-yellow-500 text-[10px]">+{m.xp_earned} XP</div>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Singlet Design (full editor: 4 zone colors + team/last name/weight) */}
            <SingletEditorBlock profile={profile} setProfile={setProfile} userUid={user?.uid} />
          </>
        )}

        {activeTab === 'attributes' && (
          <>
            {hasUnspentPoints && (
              <div className="bg-emerald-950/40 border border-emerald-700/50 rounded-xl p-3 text-center">
                <span className="text-emerald-400 font-black text-sm">
                  {profile.stat_points_available} stat point{profile.stat_points_available !== 1 ? 's' : ''} to spend!
                </span>
                <p className="text-zinc-500 text-xs mt-0.5">Use + to allocate. Each level earns 1 point.</p>
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
              {STAT_INFO.map(({ key, label, short, desc }) => {
                const val = wrestlerStats[key] || 60;
                const canIncrease = hasUnspentPoints && statPointsAvailable > 0 && val < statCap;
                const canDecrease = pendingStats && pendingStats[key] > (profile?.stats?.[key] || 60);
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="text-white font-bold text-sm">{short}</span>
                        <span className="text-zinc-500 text-xs ml-1.5">{label}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasUnspentPoints && (
                          <button
                            onClick={() => adjustPendingStat(key, -1)}
                            disabled={!canDecrease}
                            className="w-6 h-6 rounded-md bg-zinc-700 hover:bg-zinc-600 active:scale-95 disabled:opacity-20 text-white text-sm flex items-center justify-center transition-all"
                          >−</button>
                        )}
                        <span className="text-white font-black text-sm w-8 text-center">{val}</span>
                        {hasUnspentPoints && (
                          <button
                            onClick={() => adjustPendingStat(key, 1)}
                            disabled={!canIncrease}
                            className="w-6 h-6 rounded-md bg-emerald-700 hover:bg-emerald-600 active:scale-95 disabled:opacity-20 text-white text-sm flex items-center justify-center transition-all"
                          >+</button>
                        )}
                      </div>
                    </div>
                    <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${Math.min(100, (val / statCap) * 100)}%` }}
                      />
                    </div>
                    <p className="text-zinc-600 text-[10px] mt-0.5">{desc}</p>
                  </div>
                );
              })}
            </div>

            {(pendingStats || statSaving) && (
              <button
                onClick={saveStats}
                disabled={statSaving}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-700 disabled:text-emerald-200 active:scale-95 text-black font-black text-sm py-3 rounded-xl transition-all"
              >
                {statSaving
                  ? 'Saving…'
                  : `Save now (${statPointsAvailable} pt${statPointsAvailable === 1 ? '' : 's'} left) - auto-saves in a sec`}
              </button>
            )}

            {!hasUnspentPoints && !pendingStats && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
                <p className="text-zinc-600 text-xs">Earn 1 stat point every time you level up.</p>
                <p className="text-zinc-700 text-xs mt-1">
                  Max stat value: {statCap}
                  {statCap < ABS_STAT_CEILING
                    ? ` · raises every ${STAT_CAP_LEVELS_PER_POINT} levels past ${STAT_CAP_LEVEL_THRESHOLD}`
                    : ''}
                  {' · '}Choose your build wisely.
                </p>
              </div>
            )}

            {profile && (profile.level || 1) > 1 && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                {!respecConfirm ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-zinc-400 text-xs font-bold">Reset Stats</p>
                      <p className="text-zinc-600 text-[10px]">
                        {3 - (profile.respecs_used || 0)} of 3 resets remaining
                      </p>
                    </div>
                    <button
                      onClick={() => setRespecConfirm(true)}
                      disabled={(profile.respecs_used || 0) >= 3}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg border transition-all
                        disabled:opacity-30 disabled:cursor-not-allowed
                        border-amber-700/50 bg-amber-950/30 text-amber-400 hover:bg-amber-900/40 active:scale-95"
                    >
                      Reset
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-amber-400 text-xs font-bold text-center">
                      Reset all stats to creation defaults?
                    </p>
                    <p className="text-zinc-500 text-[10px] text-center">
                      You'll get {(profile.level || 1) - 1} point{(profile.level || 1) - 1 !== 1 ? 's' : ''} back to redistribute.
                      {3 - (profile.respecs_used || 0) - 1} reset{3 - (profile.respecs_used || 0) - 1 !== 1 ? 's' : ''} will remain after this.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setRespecConfirm(false)}
                        className="flex-1 py-2 text-xs font-bold rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700 active:scale-[0.98] transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleRespec}
                        disabled={respecLoading}
                        className="flex-1 py-2 text-xs font-bold rounded-lg border border-amber-600 bg-amber-600 text-black hover:bg-amber-500 active:scale-[0.98] disabled:opacity-50 transition-all"
                      >
                        {respecLoading ? 'Resetting...' : 'Confirm Reset'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'goals' && (
          <>
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-zinc-400 text-xs font-black uppercase tracking-wider">Daily Goals</div>
                {dailyGoals[0] && (
                  <div className="text-zinc-600 text-xs">Resets in {timeUntil(dailyGoals[0].expiresAt)}</div>
                )}
              </div>
              <div className="space-y-2">
                {(dailyGoals.length > 0 ? dailyGoals : getDailyGoals()).map(g => (
                  <GoalCard key={g.id} goal={g} />
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2 mt-1">
                <div className="text-zinc-400 text-xs font-black uppercase tracking-wider">Weekly Challenge</div>
                {weeklyGoals[0] && (
                  <div className="text-zinc-600 text-xs">Resets in {timeUntil(weeklyGoals[0].expiresAt)}</div>
                )}
              </div>
              <div className="space-y-2">
                {(weeklyGoals.length > 0 ? weeklyGoals : getWeeklyGoals()).map(g => (
                  <GoalCard key={g.id} goal={g} weekly />
                ))}
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
              <div className="text-zinc-600 text-xs">Goals track automatically after each match.</div>
              <div className="text-zinc-700 text-xs mt-1">Daily goals refresh at midnight · Weekly goals reset Monday.</div>
            </div>
          </>
        )}

        {activeTab === 'achievements' && (
          <TrophyCase earnedIds={earnedIds} profile={profile} />
        )}

        {activeTab === 'history' && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            {history.length === 0 ? (
              <div className="text-zinc-700 text-xs text-center py-8 italic">No matches yet - get out there!</div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {history.map(m => (
                  <div key={m.id} className={`px-4 py-3 flex items-center justify-between border-l-2 ${
                    m.result === 'win'  ? 'border-emerald-600' :
                    m.result === 'loss' ? 'border-red-800'     : 'border-zinc-700'
                  }`}>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`font-black text-xs uppercase ${RESULT_COLOR[m.result]}`}>{m.result}</span>
                        <span className={`text-xs ${METHOD_COLOR[m.win_method]}`}>{METHOD_LABEL[m.win_method]}</span>
                      </div>
                      <div className="text-zinc-500 text-xs mt-0.5">vs {m.opponent_name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-white text-sm font-bold">{m.player_score} - {m.opponent_score}</div>
                      <div className="text-yellow-500 text-xs">+{m.xp_earned} XP</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Privacy - visibility toggle. Stat-line + leaderboard standing
            are public regardless (otherwise the leaderboard would show
            phantom entries). Friends-only hides details on PublicProfile
            when a non-friend views your page. */}
        <div className="mt-4">
          <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-900/40">
            <h3 className="text-zinc-300 text-xs font-bold uppercase tracking-wider mb-3">Privacy</h3>
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => saveVisibility('public')}
                className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                  (profile?.profile_visibility || 'public') === 'public'
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                    : 'bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800 hover:text-zinc-300'
                }`}
              >
                🌐 Public
              </button>
              <button
                onClick={() => saveVisibility('friends_only')}
                className={`flex-1 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${
                  profile?.profile_visibility === 'friends_only'
                    ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                    : 'bg-zinc-900 text-zinc-500 ring-1 ring-zinc-800 hover:text-zinc-300'
                }`}
              >
                👥 Friends Only
              </button>
            </div>
            <p className="text-zinc-500 text-xs leading-relaxed">
              {(profile?.profile_visibility || 'public') === 'public'
                ? 'Anyone can view your profile, stats, badges, and trophies.'
                : 'Only friends see your profile details. Your leaderboard standing is still visible to everyone.'}
            </p>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="mt-4">
          <div className="border border-red-900/50 rounded-xl p-4">
            <h3 className="text-red-400 text-xs font-bold uppercase tracking-wider mb-2">Account</h3>
            <p className="text-zinc-500 text-xs mb-3">Delete your account and all associated match data. This cannot be undone.</p>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="bg-red-900/30 border border-red-800 text-red-400 text-xs font-bold px-4 py-2 rounded-lg hover:bg-red-900/50 active:scale-[0.98] transition-all"
            >
              Delete Account & Data
            </button>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-white font-bold text-lg mb-2">Delete Account?</h3>
            <p className="text-zinc-400 text-sm mb-4">This will permanently delete your profile, match history, and all game data. This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 bg-zinc-800 text-zinc-300 py-2 rounded-lg text-sm font-bold active:scale-95 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-bold active:scale-95 disabled:bg-red-900 disabled:text-red-300">
                {deleting ? 'Deleting…' : 'Delete Forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Training Bests + Leaderboard shortcut (moved off the retired Progress tab)
//
// Both pieces used to live on ProgressScreen. Training bests are read from
// the same localStorage keys TrainingHub drills write to, so dropping the
// Progress tab does NOT lose any historic data; values just surface here
// instead.
function readBest(id) {
  try {
    const v = localStorage.getItem(BEST_KEYS[id]);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

const BEST_TINTS = {
  emerald: { bg: 'bg-emerald-950/40', border: 'border-emerald-800/50', icon: 'text-emerald-400' },
  red:     { bg: 'bg-red-950/40',     border: 'border-red-800/50',     icon: 'text-red-400'     },
};

function BestCard({ icon: Icon, label, value, hint, tint }) {
  const t = BEST_TINTS[tint] || BEST_TINTS.emerald;
  return (
    <div className={`${t.bg} border ${t.border} rounded-2xl p-3`}>
      <div className={`${t.icon} mb-1`}><Icon size={16} /></div>
      <div className="text-white text-xl font-black leading-none">{value}</div>
      <div className="text-zinc-400 text-[11px] font-semibold mt-1">{label}</div>
      <div className="text-zinc-600 text-[10px]">{hint}</div>
    </div>
  );
}

function ProfileTrainingBestsAndLeaderboard({ onViewLeaderboard }) {
  const reactionBest = readBest('reaction');
  const takedownBest = readBest('takedown');
  return (
    <>
      <section>
        <h3 className="text-zinc-500 text-xs font-black uppercase tracking-wider mb-2 px-1">
          Training bests
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <BestCard
            icon={Timer}
            label="Reaction"
            value={reactionBest != null ? `${reactionBest}ms` : '-'}
            hint="avg of 5"
            tint="emerald"
          />
          <BestCard
            icon={Target}
            label="Takedown"
            value={takedownBest != null ? `${takedownBest}/5` : '-'}
            hint="reads"
            tint="red"
          />
        </div>
      </section>

      {onViewLeaderboard && (
        <button
          onClick={onViewLeaderboard}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.98] hover:bg-zinc-800/60 transition-all"
        >
          <div className="w-10 h-10 rounded-xl bg-zinc-950 flex items-center justify-center text-yellow-400">
            <BarChart3 size={20} />
          </div>
          <div className="flex-1 text-left">
            <div className="text-white font-black text-base">Leaderboard</div>
            <div className="text-zinc-400 text-xs">Compare against players worldwide</div>
          </div>
          <ChevronRight className="text-zinc-600" size={18} />
        </button>
      )}
    </>
  );
}
