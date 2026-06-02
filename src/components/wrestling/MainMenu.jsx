import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { useSoundContext } from '../../lib/SoundContext.jsx';
import { haptic } from '../../lib/haptics';
import { Volume2, VolumeX, Gamepad2, ChevronDown } from 'lucide-react';
import ElijahBanner from './ElijahBanner.jsx';
// Quick Match tile used to live on the Main Menu and subscribed to
// queueManager for its live pulse. It's been moved into the Online
// Multiplayer lobby as the primary "Quick Match" action - the floating
// QueuePill (GlobalQueueOverlay) still surfaces queue status globally,
// so no subscription is needed here anymore.

export default function MainMenu({ onStart, onProfile, onPrivacy, onTerms, onAbout, onCreateWrestler, onTutorial, onLeaderboard, onTournamentHistory, onReplays, onDecks, onSettings, onModes, onChallengeElijah, wrestlerProfile, isAuthenticated, dailyChallengesSlot, featuredDailyGoalSlot }) {
  // Home is dedicated to "wrestle a CPU match." Online MP, Head-to-Head,
  // Career, Tournament, Dual Meet and Training Hub all live in the bottom
  // Modes tab now, so Home stops fighting them for attention. Mode state
  // (vs_ai / local / online toggle) was removed in 1.2.5 along with the
  // Red-corner name input and the consolidated "Game Modes" modal.
  // Collapsed by default to save vertical real estate on shorter viewports.
  // Persist the user's preference so it doesn't fight them every launch.
  const [dailyOpen, setDailyOpen] = useState(() => localStorage.getItem('matgrind_daily_open') === '1');
  const [wrestlingStyle, setWrestlingStyle] = useState(() => {
    // Legacy persisted-value migration: an earlier build offered a
    // womens_freestyle button on this menu. The button has been removed,
    // but a returning user could still have that value in localStorage,
    // which would leave the selector with no active button. Remap it to
    // the closest still-supported ruleset (freestyle - same on-mat rules).
    const persisted = localStorage.getItem('matgrind_default_style');
    if (persisted === 'womens_freestyle') return 'freestyle';
    return persisted || 'folkstyle';
  });
  const { toggleMute, isMuted } = useSoundContext();
  const [playerName, setPlayerName] = useState(wrestlerProfile?.username || 'Green Wrestler');
  const [playerSide, setPlayerSide] = useState(() => {
    // Restore last-chosen corner; first-time players see neither pre-selected
    // (forces an explicit pick and keeps the smoke walker happy - clicking
    // an already-active radio toggle is a no-op, which smoke flags as silent).
    const persisted = localStorage.getItem('matgrind_default_corner');
    return (persisted === 'green' || persisted === 'red') ? persisted : null;
  });
  const [aiDifficulty, setAiDifficulty] = useState(() => localStorage.getItem('matgrind_default_difficulty') || 'medium');
  const [showRules, setShowRules] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('matgrind_has_played'));

  // Sync wrestler name from profile
  useEffect(() => {
    if (wrestlerProfile?.username) {
      setPlayerName(wrestlerProfile.username);
    }
  }, [wrestlerProfile?.username]);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // Persist the user's corner choice so returning to the menu restores it.
  useEffect(() => {
    if (playerSide) {
      try { localStorage.setItem('matgrind_default_corner', playerSide); } catch { /* storage unavailable */ }
    }
  }, [playerSide]);

  const isFreestyle = wrestlingStyle === 'freestyle';
  const isGreco = wrestlingStyle === 'greco';
  // International ruleset = freestyle + greco. (Women's Freestyle was
  // removed from this menu; legacy persisted value is migrated above.)
  const isIntl = isFreestyle || isGreco;

  const handleStart = () => {
    if (!playerSide) return; // Start is disabled when no corner picked; this guards stray calls.
    haptic.heavy();
    localStorage.setItem('matgrind_has_played', '1');
    setShowOnboarding(false);
    const defaultGreenName = isIntl ? 'Blue Wrestler' : 'Green Wrestler';
    const userName = playerName.trim() || (playerSide === 'green' ? defaultGreenName : 'Red Wrestler');
    const p1Name = playerSide === 'green' ? userName : 'CPU Opponent';
    const p2Name = playerSide === 'red'   ? userName : 'CPU Opponent';
    onStart('vs_ai', { p1: p1Name, p2: p2Name }, wrestlingStyle, playerSide, aiDifficulty);
  };

  return (
    <div
      // v2.0 shell: MainMenu now renders as the Home tab content inside
      // AppShell's <main>. The shell handles pt-safe (via inline style on
      // <main>) and pb-safe (via TabBar). We only need to fill the available
      // flex space - `flex-1` respects the parent's height budget so the
      // TabBar stays visible instead of being pushed off-screen by a
      // min-h-screen lockup.
      className="flex-1 bg-zinc-950 text-white flex flex-col"
      role="main"
      aria-label="MatGrind main menu"
    >
      {/* Top utility row - iOS status-bar-adjacent controls. Sits under
          pt-safe so the buttons clear the notch. Grouped on the right so
          the layout reads as an app home, not a centered web form. */}
      <div className="flex items-center justify-end gap-1 px-4 pt-3 pb-1">
        {Capacitor.isNativePlatform() && (
          <button
            onClick={async () => {
              haptic.light();
              // Presenting GKGameCenterViewController while the local
              // player isn't authenticated produces an empty sheet - the
              // reason this button felt like a no-op. Run the auth
              // handler first; if the user is (or becomes) authed we
              // open the leaderboards sheet, otherwise we show a gentle
              // nudge explaining how to sign into Game Center.
              try {
                const gc = await import('../../lib/gameCenter.js');
                let authed = gc.gcIsAuthenticated();
                if (!authed) {
                  authed = await gc.gcAuthenticate();
                }
                if (authed) {
                  await gc.gcShowLeaderboards();
                } else {
                  // Show the actual iOS error so the user (and we) can
                  // tell "user dismissed sign-in" apart from Apple-side
                  // configuration issues like Game Center not enabled
                  // for this app or wrong bundle ID. The previous
                  // hardcoded message blamed the user even when the
                  // real error came from App Store Connect.
                  const err = gc.gcLastAuthError?.();
                  alert(
                    'Game Center isn\'t available yet.\n\n' +
                    (err ? `iOS reported: ${err}\n\n` : '') +
                    'Make sure you\'re signed in to Game Center in iOS Settings, ' +
                    'then tap this button again.'
                  );
                }
              } catch (e) {
                console.warn('[MainMenu] Game Center open failed:', e);
                alert('Game Center error: ' + (e?.message || e));
              }
            }}
            className="text-blue-400/80 hover:text-blue-300 active:opacity-60 transition-all p-2 rounded-lg"
            aria-label="Open Game Center"
          >
            <Gamepad2 size={20} />
          </button>
        )}
        <button
          onClick={toggleMute}
          className="text-zinc-500 hover:text-zinc-300 active:opacity-60 transition-all p-2 rounded-lg"
          aria-label={isMuted ? 'Unmute sound' : 'Mute sound'}
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      </div>

      {/* Full-width content column - no max-w lockup on mobile, bounded
          on tablet+ for readability. This is the biggest visual shift from
          "centered website card" to "iOS app home screen." */}
      <div className="flex-1 w-full max-w-lg md:max-w-2xl mx-auto px-4 pt-4 pb-6">

        {/* First-time onboarding nudge */}
        {showOnboarding && onTutorial && (
          <div className="bg-emerald-950/40 border border-emerald-700/50 rounded-xl p-4 mb-4 text-center">
            <div className="text-emerald-400 font-black text-sm mb-1">New to MatGrind?</div>
            <p className="text-zinc-400 text-xs mb-3">Learn the basics with a quick interactive tutorial.</p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={onTutorial}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-all active:scale-95"
              >
                Start Tutorial
              </button>
              <button
                onClick={() => { setShowOnboarding(false); localStorage.setItem('matgrind_has_played', '1'); }}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-bold text-xs rounded-lg transition-all"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {/* Featured-wrestler partnership banner. Always visible (no dismiss)
            while PARTNERSHIP_ACTIVE; banner returns null when toggled off. */}
        {onChallengeElijah && <ElijahBanner onChallenge={onChallengeElijah} />}

        {/* Today's Training - collapsible combined wrapper for the featured
            daily goal + the 3-goal Daily Challenges card. Collapsed by
            default to keep the main menu short; preference persists via
            localStorage so returning players don't have to re-open it. */}
        {(featuredDailyGoalSlot || dailyChallengesSlot) && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => {
                setDailyOpen(v => {
                  const next = !v;
                  try { localStorage.setItem('matgrind_daily_open', next ? '1' : '0'); } catch { /* quota */ }
                  return next;
                });
              }}
              aria-expanded={dailyOpen}
              aria-controls="matgrind-daily-panel"
              className="w-full flex items-center justify-between bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl px-4 py-3 text-left transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-base">🎯</span>
                <span className="text-white text-sm font-black uppercase tracking-wider">Today's Training</span>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-zinc-400 transition-transform ${dailyOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {dailyOpen && (
              <div id="matgrind-daily-panel" className="mt-3 space-y-3">
                {featuredDailyGoalSlot}
                {dailyChallengesSlot}
              </div>
            )}
          </div>
        )}

        {/* Wrestling Style Toggle - 3 styles in a single row (folkstyle,
            freestyle, greco). Women's Freestyle was removed from this
            selector; the legacy persisted value is migrated to freestyle
            in the wrestlingStyle initializer above. */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { id: 'folkstyle', img: '/icon-style-folkstyle.png', color: '#eab308', label: 'Folkstyle' },
            { id: 'freestyle', img: '/icon-style-freestyle.png', color: '#f97316', label: 'Freestyle' },
            { id: 'greco',     img: '/icon-style-greco.png',     color: '#ef4444', label: 'Greco-Roman' },
          ].map(s => {
            const active = wrestlingStyle === s.id;
            return (
              <button
                key={s.id}
                onClick={() => {
                  setWrestlingStyle(s.id);
                  // Persist so downstream screens (DualSetupScreen reads
                  // `matgrind_default_style` on mount to pick the right
                  // dual-meet icon) see the current selection instead of
                  // a stale value from last session.
                  try { localStorage.setItem('matgrind_default_style', s.id); } catch { /* quota */ }
                }}
                className={`p-1.5 rounded-xl border-2 transition-all ${
                  active ? 'shadow-md' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                }`}
                style={active ? {
                  borderColor: s.color,
                  backgroundColor: `${s.color}15`,
                  boxShadow: `0 4px 6px -1px ${s.color}20`,
                } : undefined}
                aria-label={s.label}
              >
                <img
                  src={s.img}
                  alt={s.label}
                  className="w-full h-auto object-contain"
                  draggable={false}
                />
              </button>
            );
          })}
        </div>

        {/* Offline banner */}
        {isOffline && (
          <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl px-4 py-2 mb-4 text-center">
            <span className="text-amber-400 text-xs font-bold">Playing offline - multiplayer unavailable</span>
          </div>
        )}

        {/* AI Difficulty. Always visible: Home is vs-CPU only now, and
            persisting on click keeps the Play-tab quick-start and the
            Modes-tab CPU launcher in sync via `matgrind_default_difficulty`. */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { id: 'easy',   label: 'Easy',   sub: 'Casual',   color: '#22c55e', img: '/icon-difficulty-easy.png'   },
            { id: 'medium', label: 'Medium', sub: 'Standard', color: '#eab308', img: '/icon-difficulty-medium.png' },
            { id: 'hard',   label: 'Hard',   sub: 'Expert',   color: '#ef4444', img: '/icon-difficulty-hard.png'   },
          ].map(d => {
            const active = aiDifficulty === d.id;
            return (
              <button
                key={d.id}
                onClick={() => {
                  setAiDifficulty(d.id);
                  try { localStorage.setItem('matgrind_default_difficulty', d.id); } catch { /* quota */ }
                }}
                className={`p-1.5 rounded-xl border-2 transition-all ${
                  active
                    ? 'shadow-md'
                    : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                }`}
                style={active ? {
                  borderColor: d.color,
                  backgroundColor: `${d.color}15`,
                  boxShadow: `0 4px 6px -1px ${d.color}20`,
                } : undefined}
                aria-label={d.label}
              >
                <img
                  src={d.img}
                  alt={d.label}
                  className="w-full h-auto object-contain"
                  draggable={false}
                />
              </button>
            );
          })}
        </div>

        {/* Player setup. Home only launches vs-CPU matches, so we just need
            the player's chosen corner + their display name. Local 1v1 lives
            in the Modes tab and has its own setup flow there. */}
        <div className="bg-zinc-900 rounded-xl p-4 mb-5 border border-zinc-800 space-y-3">
          <div>
            <label className="text-zinc-500 text-xs font-bold uppercase tracking-wider block mb-2">
              Your Corner
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setPlayerSide('green');
                  const def = isIntl ? 'Blue Wrestler' : 'Green Wrestler';
                  setPlayerName(prev => prev === 'Red Wrestler' ? (wrestlerProfile?.username || def) : prev);
                }}
                className={`p-1.5 rounded-lg border-2 transition-all ${
                  playerSide === 'green'
                    ? isIntl ? 'border-blue-500 bg-blue-500/10' : 'border-emerald-500 bg-emerald-500/10'
                    : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                }`}
                aria-label={isIntl ? 'Blue Corner' : 'Green Corner'}
              >
                <img
                  src={isIntl ? '/icon-blue-wrestler.png' : '/icon-green-wrestler.png'}
                  alt={isIntl ? 'Blue Corner' : 'Green Corner'}
                  className="w-full h-auto object-contain"
                  draggable={false}
                />
              </button>
              <button
                onClick={() => {
                  setPlayerSide('red');
                  const prev = isIntl ? 'Blue Wrestler' : 'Green Wrestler';
                  setPlayerName(cur => (cur === prev || cur === (wrestlerProfile?.username || '')) ? 'Red Wrestler' : cur);
                }}
                className={`p-1.5 rounded-lg border-2 transition-all ${
                  playerSide === 'red'
                    ? 'border-red-500 bg-red-500/10'
                    : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                }`}
                aria-label="Red Corner"
              >
                <img
                  src="/icon-red-wrestler.png"
                  alt="Red Corner"
                  className="w-full h-auto object-contain"
                  draggable={false}
                />
              </button>
            </div>
          </div>
          <div>
            <label className={`text-xs font-bold uppercase tracking-wider block mb-1 ${
              playerSide === 'green' ? (isIntl ? 'text-blue-500' : 'text-emerald-500')
                : playerSide === 'red' ? 'text-red-500'
                : 'text-zinc-400'
            }`}>
              Your Name
            </label>
            <input
              type="text"
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              placeholder={
                playerSide === 'green' ? (isIntl ? 'Blue Wrestler' : 'Green Wrestler')
                  : playerSide === 'red' ? 'Red Wrestler'
                  : 'Pick a corner first'
              }
              maxLength={20}
              className={`w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none transition-colors ${
                playerSide === 'red' ? 'focus:border-red-600' : isIntl ? 'focus:border-blue-600' : 'focus:border-emerald-600'
              }`}
            />
          </div>
        </div>

        {/* PRIMARY CTA - tall pill, full-width, style-tinted. This is the
            single most important visual element on the home screen and
            drives the gameplay-first read Apple wants for 4.2. */}
        <button
          onClick={handleStart}
          disabled={!playerSide}
          aria-disabled={!playerSide}
          className={`w-full transition-all mb-5 ${playerSide ? 'active:scale-[0.98]' : 'opacity-50 cursor-not-allowed'}`}
        >
          <img src="/icon-wrestle-match.png" alt="Start Match" className="w-full h-auto object-contain" draggable={false} />
        </button>

        {/* Secondary grid - 2-column icon-labeled cards. This is the iOS
            home-screen pattern (think Apple Health, Shortcuts) and reads
            much more app-like than a vertical stack of full-width buttons.
            Each card's callback is gated on the same prop that used to
            gate the old full-width button, so no feature is removed when
            any given callback is absent from the parent. */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {/* Game Modes tile - jumps to the bottom Modes tab, which is the
              canonical surface for Career / Tournament / Dual Meet / Online
              MP / Head-to-Head / Training Hub. Tile preserved on Home for
              muscle-memory; both entry points hit the same ModesScreen. */}
          {onModes && (
            <button
              onClick={onModes}
              className="aspect-square bg-zinc-900 border border-purple-800/50 hover:border-purple-600 hover:bg-purple-950/30 active:scale-95 transition-all rounded-xl overflow-hidden"
              aria-label="Game Modes"
            >
              <img src="/icon-game-modes.png" alt="Game Modes" className="w-full h-full object-cover" draggable={false} />
            </button>
          )}

          {/* Decks - 24-card folkstyle deck builder (Phase 3). Now uses
              the dedicated /icon-decks.png art to match the other tiles
              (Tournament / Dual Meet / Replays). Active-deck name is no
              longer rendered inline - the image is self-descriptive, and
              packing a subtitle under the square art squeezed both into
              illegible sizes on short viewports. */}
          {onDecks && isAuthenticated && (
            <button
              onClick={onDecks}
              className="aspect-square bg-zinc-900 border border-sky-800/50 hover:border-sky-600 hover:bg-sky-950/30 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img
                src="/icon-decks.png"
                alt="Decks"
                className="w-full h-full object-cover"
                draggable={false}
              />
            </button>
          )}

          {onReplays && (
            <button
              onClick={onReplays}
              className="aspect-square bg-zinc-900 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img src="/icon-replays.png" className="w-full h-full object-cover" alt="replays" draggable={false} />
            </button>
          )}

          {isAuthenticated && onProfile && (
            <button
              onClick={onProfile}
              className="aspect-square bg-zinc-900 border border-emerald-800/50 hover:border-emerald-600 hover:bg-emerald-950/30 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img src="/icon-profile.png" className="w-full h-full object-cover" alt="profile" draggable={false} />
            </button>
          )}

          {!isAuthenticated && onCreateWrestler && (
            <button
              onClick={onCreateWrestler}
              className="aspect-square bg-zinc-900 border border-emerald-800/50 hover:border-emerald-600 hover:bg-emerald-950/30 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img src="/icon-create-wrestler.png" className="w-full h-full object-cover" alt="create wrestler" draggable={false} />
            </button>
          )}

          {onLeaderboard && (
            <button
              onClick={onLeaderboard}
              className="aspect-square bg-zinc-900 border border-amber-800/50 hover:border-amber-600 hover:bg-amber-950/30 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img src="/icon-leaderboard.png" className="w-full h-full object-cover" alt="leaderboard" draggable={false} />
            </button>
          )}

          {onTournamentHistory && (
            <button
              onClick={onTournamentHistory}
              className="aspect-square bg-zinc-900 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img src="/icon-tournament-history-source.png" className="w-full h-full object-cover" alt="tournament history" draggable={false} />
            </button>
          )}

          {onTutorial && (
            <button
              onClick={onTutorial}
              className="aspect-square bg-zinc-900 border border-yellow-800/50 hover:border-yellow-600 hover:bg-yellow-950/30 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img src="/icon-how-to-play.png" className="w-full h-full object-cover" alt="how to play" draggable={false} />
            </button>
          )}

          {onSettings && (
            <button
              onClick={onSettings}
              className="aspect-square bg-zinc-900 border border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800 active:scale-95 transition-all rounded-xl overflow-hidden"
            >
              <img src="/icon-settings.png" className="w-full h-full object-cover" alt="settings" draggable={false} />
            </button>
          )}
        </div>

        {/* Rules toggle */}
        <button
          onClick={() => setShowRules(r => !r)}
          className="w-full text-zinc-600 hover:text-zinc-400 text-sm py-2 transition-colors font-semibold"
        >
          {showRules ? '▲ Hide Rules' : '▼ Rules & Scoring'}
        </button>

        {showRules && (
          <div className="mt-3 bg-zinc-900 rounded-xl p-4 border border-zinc-800 space-y-4 text-xs">
            <div>
              <div className={`${isGreco ? 'text-red-400' : isFreestyle ? 'text-orange-400' : 'text-yellow-400'} font-bold text-xs mb-2 uppercase tracking-wider`}>Scoring</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(isIntl ? [
                  { label: 'Takedown', pts: '+2', color: 'text-emerald-400' },
                  { label: 'Escape', pts: '+1', color: 'text-amber-400' },
                  { label: 'Reversal', pts: '+1', color: 'text-yellow-300' },
                  { label: 'Exposure', pts: '+2', color: 'text-amber-300' },
                  { label: 'Grand Amp.', pts: '+5', color: 'text-red-300' },
                  { label: 'Passivity', pts: '+1', color: 'text-amber-500' },
                  { label: 'Tech Fall', pts: isGreco ? '8 lead' : '10 lead', color: 'text-purple-400' },
                  { label: 'Pin', pts: 'Match!', color: 'text-red-400' },
                ] : [
                  { label: 'Takedown', pts: '+3', color: 'text-emerald-400' },
                  { label: 'Escape', pts: '+1', color: 'text-amber-400' },
                  { label: 'Reversal', pts: '+2', color: 'text-yellow-300' },
                  { label: 'Near Fall', pts: '+2-4', color: 'text-emerald-300' },
                  { label: 'Tech Fall', pts: '15 lead', color: 'text-purple-400' },
                  { label: 'Pin', pts: 'Match!', color: 'text-red-400' },
                ]).map(s => (
                  <div key={s.label} className="flex justify-between bg-zinc-800 rounded px-2 py-1.5">
                    <span className="text-zinc-400">{s.label}</span>
                    <span className={`font-bold ${s.color}`}>{s.pts}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className={`${isGreco ? 'text-red-400' : isFreestyle ? 'text-orange-400' : 'text-yellow-400'} font-bold mb-2 uppercase tracking-wider`}>Match Structure</div>
              <ul className="space-y-1 text-zinc-500">
                {isGreco ? (
                  <>
                    <li>· 2 periods, 3 minutes each</li>
                    <li>· <span className="text-red-400 font-semibold">No leg attacks allowed</span></li>
                    <li>· 30-sec activity clock enforces passivity</li>
                    <li>· Overtime: sudden victory if tied</li>
                    <li>· Bottom is defensive only - survive par terre</li>
                  </>
                ) : isFreestyle ? (
                  <>
                    <li>· 2 periods, 3 minutes each</li>
                    <li>· Both periods start neutral</li>
                    <li>· 30-sec activity clock enforces passivity</li>
                    <li>· Overtime: sudden victory if tied</li>
                    <li>· Bottom wrestler can attack (re-shot)</li>
                  </>
                ) : (
                  <>
                    <li>· 3 periods, 2 minutes each</li>
                    <li>· Period 1 starts neutral</li>
                    <li>· Period 2: Green wrestler chooses position</li>
                    <li>· Period 3: Red wrestler chooses position</li>
                  </>
                )}
              </ul>
            </div>
            <div>
              <div className={`${isGreco ? 'text-red-400' : isFreestyle ? 'text-orange-400' : 'text-yellow-400'} font-bold mb-2 uppercase tracking-wider`}>Card System</div>
              <ul className="space-y-1 text-zinc-500">
                <li>· Cards depend on current position</li>
                <li>· Front Headlock opens a full move tree</li>
                <li>· Counter cards beat specific attacks</li>
                <li>· Stamina limits repeated moves</li>
                {isGreco && (
                  <>
                    <li>· Pummel for inside position, then throw</li>
                    <li>· Grand amplitude throws score 5 pts</li>
                    <li>· Gut wrench dominates par terre</li>
                  </>
                )}
                {isFreestyle && (
                  <>
                    <li>· Grand amplitude throws score 5 pts</li>
                    <li>· Gut wrench / leg lace for repeated exposures</li>
                  </>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Legal links */}
        <div className="mt-6 flex justify-center gap-4 text-zinc-600 text-xs">
          <button onClick={onPrivacy} className="hover:text-zinc-400 transition-colors underline">
            Privacy Policy
          </button>
          <span>·</span>
          <button onClick={onTerms} className="hover:text-zinc-400 transition-colors underline">
            Terms of Service
          </button>
          <span>·</span>
          <button onClick={onAbout} className="hover:text-zinc-400 transition-colors underline">
            About
          </button>
        </div>
      </div>
    </div>
  );
}
