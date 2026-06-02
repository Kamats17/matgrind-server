import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../lib/AuthContext.jsx';
import { getProfile, saveProfile } from '../../lib/firestoreService.js';
import { COLOR_PRESETS, chestColorToPresetId } from '../../lib/wrestlerColors.js';
import { SINGLET_DEFAULTS } from '../../lib/singletDesign.js';
import SingletCreator from './SingletCreator.jsx';
import { Eye, EyeOff } from 'lucide-react';
import NavBar from '../ui/NavBar';
import { withTimeout } from '../../lib/withTimeout.js';
import ForgotPasswordSheet from '../auth/ForgotPasswordSheet.jsx';

const STAT_BUDGET = 300;
const STAT_MIN = 20;
const STAT_MAX = 80;

const STAT_INFO = [
  { key: 'str', label: 'Strength',  short: 'STR', desc: 'Powers takedowns, turns, and pins. Resisted by opponent Grit.' },
  { key: 'spd', label: 'Speed',     short: 'SPD', desc: 'Powers counters, escapes, and scrambles.' },
  { key: 'tec', label: 'Technique', short: 'TEC', desc: 'Reduces diminishing-return penalties. Boosts chain follow-ups.' },
  { key: 'end', label: 'Endurance', short: 'END', desc: 'Increases starting stamina and reduces fatigue.' },
  { key: 'grt', label: 'Grit',      short: 'GRT', desc: 'Powers bottom escapes and reversals. Resists pins and STR attacks.' },
];

const PRESETS = [
  { label: 'Balanced',  stats: { str: 60, spd: 60, tec: 60, end: 60, grt: 60 } },
  { label: 'Power',     stats: { str: 80, spd: 40, tec: 55, end: 55, grt: 70 } },
  { label: 'Speed',     stats: { str: 40, spd: 80, tec: 65, end: 60, grt: 55 } },
  { label: 'Technical', stats: { str: 50, spd: 55, tec: 80, end: 60, grt: 55 } },
  { label: 'Grinder',   stats: { str: 50, spd: 50, tec: 55, end: 80, grt: 65 } },
];

const WEIGHT_CLASSES = [
  '106', '113', '120', '126', '132', '138', '144', '150',
  '157', '165', '175', '190', '215', '285',
];

const STYLES = [
  { id: 'folkstyle', label: 'Folkstyle', sub: 'NFHS / NCAA' },
  { id: 'freestyle', label: 'Freestyle', sub: 'UWW / Olympic' },
  { id: 'greco', label: 'Greco-Roman', sub: 'UWW / Olympic' },
];

export default function CreateWrestler({ onBack, onCreated, initialAuthMode }) {
  const { user, isAuthenticated, loginWithEmail, signUpWithEmail, loginWithGoogle, loginWithApple, authError } = useAuth();

  // Auth form state - initialAuthMode lets the sign-in gate route the user
  // straight to the login tab instead of the signup tab when they tapped
  // "Sign In" (vs "Create Account").
  const [authMode, setAuthMode] = useState(initialAuthMode === 'login' ? 'login' : 'signup'); // 'signup' | 'login'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  // Wrestler creation state
  const [step, setStep] = useState('auth'); // 'auth' | 'create' | 'stats' | 'done'
  const [wrestlerName, setWrestlerName] = useState('');
  const [weightClass, setWeightClass] = useState('150');
  const [preferredStyle, setPreferredStyle] = useState('folkstyle');
  const [singlet, setSinglet] = useState({ ...SINGLET_DEFAULTS });
  const [saving, setSaving] = useState(false);

  // Stat allocation state
  const [stats, setStats] = useState({ str: 60, spd: 60, tec: 60, end: 60, grt: 60 });
  const spentPoints = Object.values(stats).reduce((a, b) => a + b, 0);
  const remainingPoints = STAT_BUDGET - spentPoints;

  // Capture onCreated in a ref so the profile-check effect doesn't re-fire
  // when the parent re-renders with a fresh inline arrow callback.
  const onCreatedRef = useRef(onCreated);
  useEffect(() => { onCreatedRef.current = onCreated; }, [onCreated]);

  // If already signed in, check for existing profile
  useEffect(() => {
    if (isAuthenticated && user?.uid) {
      let cancelled = false;
      withTimeout(getProfile(user.uid), 10_000, 'createWrestler.getProfile').then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Timeout or error: fail open by showing the create step so the
          // user can still set up a wrestler. Surface a non-blocking note.
          if (res.error === 'timeout') {
            setLocalError('Could not check existing profile (timed out). You can still create a new wrestler.');
          } else {
            console.warn('[CreateWrestler] profile check failed', res.error);
          }
          setStep('create');
          setWrestlerName(user.displayName || '');
          return;
        }
        const profile = res.value;
        if (profile) {
          // Already has a wrestler - go back
          onCreatedRef.current?.(profile);
        } else {
          // Signed in but no profile yet - go to create step
          setStep('create');
          setWrestlerName(user.displayName || '');
        }
      });
      return () => { cancelled = true; };
    }
  }, [isAuthenticated, user?.uid, user?.displayName]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setLocalError('');
    if (!email.trim() || !password.trim()) {
      setLocalError('Please enter email and password.');
      return;
    }
    if (authMode === 'signup' && password.length < 6) {
      setLocalError('Password must be at least 6 characters.');
      return;
    }
    setAuthLoading(true);
    try {
      if (authMode === 'signup') {
        await signUpWithEmail(email.trim(), password);
      } else {
        await loginWithEmail(email.trim(), password);
      }
      // onAuthStateChanged will trigger the useEffect above
    } catch (err) {
      const msg = err.message || 'Authentication failed.';
      if (msg.includes('email-already-in-use')) setLocalError('Email already in use. Try signing in.');
      else if (msg.includes('user-not-found')) setLocalError('No account found. Try signing up.');
      else if (msg.includes('wrong-password') || msg.includes('invalid-credential')) setLocalError('Incorrect password.');
      else if (msg.includes('invalid-email')) setLocalError('Invalid email address.');
      else setLocalError(msg);
    }
    setAuthLoading(false);
  };

  const handleGoogle = async () => {
    setLocalError('');
    setAuthLoading(true);
    try {
      await loginWithGoogle();
    } catch (err) {
      // Don't show error if redirecting (signInWithRedirect)
      if (err.code !== 'auth/popup-blocked' &&
          err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request') {
        setLocalError(err.message || 'Google sign-in failed.');
      }
    }
    setAuthLoading(false);
  };

  const handleApple = async () => {
    setLocalError('');
    setAuthLoading(true);
    try {
      await loginWithApple();
    } catch (err) {
      if (err.code !== 'auth/popup-blocked' &&
          err.code !== 'auth/popup-closed-by-user' &&
          err.code !== 'auth/cancelled-popup-request') {
        setLocalError(err.message || 'Apple sign-in failed.');
      }
    }
    setAuthLoading(false);
  };

  const handleCreateWrestler = async () => {
    if (!wrestlerName.trim()) return;
    setSaving(true);
    setLocalError('');
    try {
      // Client-side profanity check. Server-side Firestore rule is the
      // real gate - this is UX so the user gets an inline error instead
      // of an opaque permission-denied.
      const { filterOrThrow } = await import('../../lib/profanity.js');
      let cleanName;
      try { cleanName = filterOrThrow(wrestlerName); }
      catch (e) {
        if (e.code === 'PROFANITY') {
          setLocalError('Please try a different name. (DM me if you think this is a mistake.)');
          setSaving(false);
          return;
        }
        throw e;
      }
      // Sync legacy fields off the new singlet object so the existing
      // renderers (MatchResultModal, TournamentBracket, careerBrackets,
      // dualMeetTeams) keep producing the right tints.
      const presetId = chestColorToPresetId(singlet.chestColor);
      const selectedPreset = COLOR_PRESETS.find(c => c.id === presetId);
      // Auto-pre-fill text fields from the wrestler info so a brand-new
      // wrestler doesn't ship with a blank singlet on the back.
      const singletForSave = {
        ...singlet,
        teamText:        singlet.teamText        || '',
        lastNameText:    singlet.lastNameText    || cleanName,
        weightClassText: singlet.weightClassText || weightClass,
      };
      const saveRes = await withTimeout(
        saveProfile(user.uid, {
          username: cleanName,
          weight_class: weightClass,
          preferred_style: preferredStyle,
          appearance: {
            primaryColor: presetId !== 'custom' ? presetId : 'emerald',
            accentColor: selectedPreset?.dark || singlet.chestColor,
            singlet: singletForSave,
          },
          wins: 0,
          losses: 0,
          draws: 0,
          pins: 0,
          tech_falls: 0,
          total_points: 0,
          xp: 0,
          level: 1,
          stats,
          base_stats: { ...stats },
          stat_points_available: 0,
          respecs_used: 0,
        }),
        10_000,
        'createWrestler.saveProfile'
      );
      if (!saveRes.ok) {
        if (saveRes.error === 'timeout') {
          setLocalError('Save timed out. Check your connection and try again.');
        } else {
          console.error('[CreateWrestler] Save error:', saveRes.error);
          setLocalError('Failed to save wrestler. Try again.');
        }
        setSaving(false);
        return;
      }
      const profile = saveRes.value;
      setStep('done');
      setTimeout(() => onCreated?.(profile), 1200);
    } catch (err) {
      setLocalError('Failed to save wrestler. Try again.');
      console.error('[CreateWrestler] Save error:', err);
    }
    setSaving(false);
  };

  const adjustStat = (key, delta) => {
    setStats(prev => {
      const newVal = Math.max(STAT_MIN, Math.min(STAT_MAX, prev[key] + delta));
      const newSpent = Object.values({ ...prev, [key]: newVal }).reduce((a, b) => a + b, 0);
      if (newSpent > STAT_BUDGET) return prev; // can't exceed budget
      return { ...prev, [key]: newVal };
    });
  };

  const errorMsg = localError || (authError?.message || '');

  // ── Step 3: Done ───────────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <div className="min-h-full bg-zinc-950 text-white flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-5xl mb-4">&#127942;</div>
          <h1 className="text-2xl font-black mb-2">Wrestler Created!</h1>
          <p className="text-zinc-400 text-sm">Welcome to the mat, <span className="text-emerald-400 font-bold">{wrestlerName}</span>.</p>
          <p className="text-zinc-600 text-xs mt-2">Returning to menu...</p>
        </div>
      </div>
    );
  }

  // ── Step 2: Create Wrestler Profile ────────────────────────────────────────
  if (step === 'create') {
    return (
      <div className="min-h-full bg-zinc-950 text-white flex flex-col">
        <NavBar title="Create Wrestler" onBack={onBack} />
        <div className="flex-1 flex flex-col items-center px-4 py-10">
        <div className="w-full max-w-md">

          <div className="text-center mb-6">
            <div className="text-3xl mb-2">&#129340;</div>
            <h1 className="text-2xl font-black">Create Your Wrestler</h1>
            <p className="text-zinc-500 text-sm mt-1">Set up your profile to track stats and history.</p>
          </div>

          <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800 space-y-5">
            {/* Wrestler Name */}
            <div>
              <label className="text-emerald-500 text-xs font-bold uppercase tracking-wider block mb-1.5">
                Wrestler Name
              </label>
              <input
                type="text"
                value={wrestlerName}
                onChange={e => setWrestlerName(e.target.value)}
                placeholder="Enter your wrestler name"
                maxLength={20}
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>

            {/* Weight Class */}
            <div>
              <label className="text-emerald-500 text-xs font-bold uppercase tracking-wider block mb-1.5">
                Weight Class
              </label>
              <div className="grid grid-cols-7 gap-1.5">
                {WEIGHT_CLASSES.map(wc => (
                  <button
                    key={wc}
                    onClick={() => setWeightClass(wc)}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      weightClass === wc
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300 border border-zinc-700'
                    }`}
                  >
                    {wc}
                  </button>
                ))}
              </div>
            </div>

            {/* Preferred Style */}
            <div>
              <label className="text-emerald-500 text-xs font-bold uppercase tracking-wider block mb-1.5">
                Preferred Style
              </label>
              <div className="grid grid-cols-3 gap-2">
                {STYLES.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setPreferredStyle(s.id)}
                    className={`p-2.5 rounded-xl border-2 text-center transition-all ${
                      preferredStyle === s.id
                        ? 'border-emerald-500 bg-emerald-500/10 text-white'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    <div className="font-bold text-xs">{s.label}</div>
                    <div className="text-zinc-500 text-[10px] mt-0.5">{s.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Singlet Design */}
            <div>
              <label className="text-emerald-500 text-xs font-bold uppercase tracking-wider block mb-1.5">
                Singlet Design
              </label>
              <SingletCreator
                value={singlet}
                onChange={setSinglet}
                defaults={{
                  teamText:        '',
                  lastNameText:    wrestlerName || '',
                  weightClassText: weightClass || '',
                }}
              />
            </div>

            {errorMsg && (
              <p className="text-red-400 text-sm text-center">{errorMsg}</p>
            )}

            <button
              onClick={() => { if (wrestlerName.trim()) setStep('stats'); }}
              disabled={!wrestlerName.trim()}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 active:scale-95 text-black font-black text-sm py-3 rounded-xl transition-all"
            >
              Next: Build Stats
            </button>
          </div>
        </div>
        </div>
      </div>
    );
  }

  // ── Step 2b: Stat Allocation ────────────────────────────────────────────────
  if (step === 'stats') {
    return (
      <div className="min-h-full bg-zinc-950 text-white flex flex-col">
        <NavBar title="Build Stats" onBack={() => setStep('create')} />
        <div className="flex-1 flex flex-col items-center px-4 py-10">
        <div className="w-full max-w-md">

          <div className="text-center mb-4">
            <div className="text-3xl mb-2">&#9878;</div>
            <h1 className="text-2xl font-black">Build Your Stats</h1>
            <p className="text-zinc-500 text-sm mt-1">
              Distribute <span className="text-emerald-400 font-bold">{STAT_BUDGET} points</span> across 5 attributes.
            </p>
          </div>

          {/* Budget bar */}
          <div className="mb-4 bg-zinc-900 rounded-xl p-3 border border-zinc-800 flex items-center justify-between">
            <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider">Points Remaining</span>
            <span className={`text-lg font-black ${remainingPoints === 0 ? 'text-emerald-400' : remainingPoints < 0 ? 'text-red-400' : 'text-white'}`}>
              {remainingPoints}
            </span>
          </div>

          {/* Presets */}
          <div className="mb-4">
            <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider mb-2">Quick Presets</p>
            <div className="grid grid-cols-5 gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  onClick={() => setStats(p.stats)}
                  className="py-1.5 rounded-lg text-xs font-bold bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white border border-zinc-700 transition-all"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stat sliders */}
          <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-3 mb-4">
            {STAT_INFO.map(({ key, label, short, desc }) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="text-white font-bold text-sm">{short}</span>
                    <span className="text-zinc-500 text-xs ml-1.5">{label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => adjustStat(key, -1)}
                      disabled={stats[key] <= STAT_MIN}
                      className="w-6 h-6 rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white font-bold text-sm flex items-center justify-center transition-all"
                    >−</button>
                    <span className="text-white font-black text-sm w-8 text-center">{stats[key]}</span>
                    <button
                      onClick={() => adjustStat(key, 1)}
                      disabled={stats[key] >= STAT_MAX || remainingPoints <= 0}
                      className="w-6 h-6 rounded-md bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-white font-bold text-sm flex items-center justify-center transition-all"
                    >+</button>
                  </div>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${((stats[key] - STAT_MIN) / (STAT_MAX - STAT_MIN)) * 100}%` }}
                  />
                </div>
                <p className="text-zinc-600 text-[10px] mt-0.5">{desc}</p>
              </div>
            ))}
          </div>

          {errorMsg && (
            <p className="text-red-400 text-sm text-center mb-3">{errorMsg}</p>
          )}

          <button
            onClick={handleCreateWrestler}
            disabled={saving}
            className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 active:scale-95 text-black font-black text-sm py-3 rounded-xl transition-all"
          >
            {saving ? 'Creating...' : 'Create Wrestler'}
          </button>
        </div>
        </div>
      </div>
    );
  }

  // ── Step 1: Auth (Sign Up / Sign In) ───────────────────────────────────────
  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      <NavBar title={authMode === 'signup' ? 'Create Account' : 'Sign In'} onBack={onBack} />
      <div className="flex-1 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md">

        <div className="text-center mb-6">
          <div className="inline-block bg-zinc-900 border border-zinc-700 rounded-2xl px-6 py-4 mb-3">
            <img
              src="/positions/matgrind-text.png"
              alt="MatGrind"
              className="h-8 mx-auto"
              draggable={false}
            />
          </div>
          <h1 className="text-xl font-black">
            {authMode === 'signup' ? 'Create Your Account' : 'Welcome Back'}
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            {authMode === 'signup' ? 'Sign up to save your wrestler and match history.' : 'Sign in to access your wrestler profile.'}
          </p>
        </div>

        <div className="bg-zinc-900 rounded-xl p-5 border border-zinc-800">
          {/* Apple / Google sign-in. Works on web via Firebase JS SDK
              popup+redirect; works on native iOS/Android via
              @capacitor-firebase/authentication which invokes the
              platform-native sign-in UI and hands back a credential
              (AuthContext.nativeSignIn). */}
          {/* Apple sign-in */}
          <button
            onClick={handleApple}
            disabled={authLoading}
            className="w-full bg-black hover:bg-zinc-800 active:scale-95 text-white font-bold text-sm py-3 rounded-xl transition-all flex items-center justify-center gap-2 mb-2 border border-zinc-700"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" fill="white">
              <path d="M13.21 4.56c-.73.82-1.93 1.46-2.89 1.4-.14-1.1.4-2.27 1.04-2.99.73-.84 2.01-1.45 2.81-1.48.12 1.15-.33 2.27-0.96 3.07zM14.18 6.15c-1.6-.1-2.96.91-3.72.91-.77 0-1.94-.86-3.21-.84-1.65.03-3.18.96-4.03 2.45-1.73 2.99-.44 7.41 1.23 9.84.83 1.2 1.81 2.54 3.1 2.49 1.25-.05 1.72-.8 3.22-.8 1.5 0 1.93.8 3.24.78 1.34-.03 2.18-1.22 3-2.42.94-1.37 1.33-2.7 1.35-2.77-.03-.01-2.59-1-2.62-3.95-.02-2.47 2.02-3.66 2.11-3.72-1.15-1.7-2.95-1.89-3.58-1.93-.05-.01-.07-.03-.09-.04z"/>
            </svg>
            Continue with Apple
          </button>

          {/* Google sign-in */}
          <button
            onClick={handleGoogle}
            disabled={authLoading}
            className="w-full bg-white hover:bg-zinc-100 active:scale-95 text-zinc-900 font-bold text-sm py-3 rounded-xl transition-all flex items-center justify-center gap-2 mb-4"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" fill="#34A853"/>
              <path d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33z" fill="#FBBC05"/>
              <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-zinc-700"></div>
            <span className="text-zinc-600 text-xs font-bold uppercase">or</span>
            <div className="flex-1 h-px bg-zinc-700"></div>
          </div>

          {/* Email/password form */}
          <form onSubmit={handleAuth} className="space-y-3">
            <div>
              <label className="text-zinc-400 text-xs font-bold uppercase tracking-wider block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => { setLocalError(''); setEmail(e.target.value); }}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </div>
            <div>
              <label className="text-zinc-400 text-xs font-bold uppercase tracking-wider block mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setLocalError(''); setPassword(e.target.value); }}
                  placeholder={authMode === 'signup' ? 'At least 6 characters' : 'Enter password'}
                  autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                  className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-600 transition-colors pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {errorMsg && (
              <p className="text-red-400 text-sm text-center">{errorMsg}</p>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 active:scale-95 text-black font-black text-sm py-3 rounded-xl transition-all"
            >
              {authLoading ? 'Please wait...' : authMode === 'signup' ? 'Sign Up' : 'Sign In'}
            </button>
          </form>

          <div className="text-center mt-4 space-y-2">
            <button
              onClick={() => { setAuthMode(authMode === 'signup' ? 'login' : 'signup'); setLocalError(''); }}
              className="text-zinc-500 hover:text-emerald-400 text-sm transition-colors block w-full"
            >
              {authMode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
            {authMode === 'login' && (
              <button
                type="button"
                onClick={() => setShowForgotPassword(true)}
                className="text-zinc-500 hover:text-emerald-400 text-xs underline transition-colors block w-full"
              >
                Forgot password?
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
      <ForgotPasswordSheet
        open={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
        defaultEmail={email}
      />
    </div>
  );
}
