import React, { useState } from 'react';
import { useSoundContext } from '../lib/SoundContext';
import { useColorblind } from '../lib/ColorblindContext';
import { useAuth } from '../lib/AuthContext.jsx';
import NavBar from '../components/ui/NavBar';
import { haptic } from '../lib/haptics';
import ChangePasswordSheet from '../components/auth/ChangePasswordSheet.jsx';
import { APP_VERSION } from '../lib/version';

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const STYLES = ['folkstyle', 'freestyle', 'greco'];
const STYLE_LABELS = { folkstyle: 'Folkstyle', freestyle: 'Freestyle', greco: 'Greco-Roman' };

export default function Settings({ onBack, onPrivacy, onTerms, onAbout }) {
  const { volume, setVolume, isMuted, toggleMute } = useSoundContext();
  const { colorblind, toggleColorblind } = useColorblind();
  const { user, isAuthenticated, logout, hasPasswordProvider } = useAuth();
  // Two-step confirm so a stray tap on Log Out doesn't sign the user out by
  // accident - also stops the button from sitting next to "Delete Account"
  // on Profile without a guard rail of its own.
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);

  async function handleConfirmLogout() {
    setLoggingOut(true);
    try { haptic.medium(); } catch { /* silent */ }
    try {
      await logout();
    } finally {
      setLoggingOut(false);
      setShowLogoutConfirm(false);
      // After Firebase flips isAuthenticated, the menu re-renders. Bounce
      // back to the menu so the user lands somewhere sensible (and the
      // tab bar's tab handlers see a fresh state).
      if (typeof onBack === 'function') onBack();
    }
  }
  const [defaultDifficulty, setDefaultDifficulty] = React.useState(
    () => localStorage.getItem('matgrind_default_difficulty') || 'medium'
  );
  const [defaultStyle, setDefaultStyle] = React.useState(
    () => localStorage.getItem('matgrind_default_style') || 'folkstyle'
  );

  function saveDifficulty(val) {
    setDefaultDifficulty(val);
    localStorage.setItem('matgrind_default_difficulty', val);
  }

  function saveStyle(val) {
    setDefaultStyle(val);
    localStorage.setItem('matgrind_default_style', val);
  }

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      {/* iOS-style NavBar */}
      <NavBar title="Settings" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 py-6 max-w-md md:max-w-2xl mx-auto w-full space-y-6">
        {/* Sound */}
        <section>
          <h2 className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">Sound</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">Sound Effects</span>
              <button
                onClick={toggleMute}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  isMuted ? 'bg-zinc-800 text-zinc-500' : 'bg-emerald-800 text-emerald-300'
                }`}
              >
                {isMuted ? 'OFF' : 'ON'}
              </button>
            </div>
            {!isMuted && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-400">Volume</span>
                  <span className="text-xs text-zinc-500 font-mono">{Math.round(volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={e => setVolume(parseFloat(e.target.value))}
                  className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>
            )}
          </div>
        </section>

        {/* Default Preferences */}
        <section>
          <h2 className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">Defaults</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
            <div>
              <span className="text-sm font-bold block mb-2">Difficulty</span>
              <div className="flex gap-2" role="radiogroup" aria-label="Default difficulty">
                {DIFFICULTIES.map(d => {
                  const active = defaultDifficulty === d;
                  return (
                    <button
                      key={d}
                      role="radio"
                      aria-checked={active}
                      aria-label={d}
                      // Active option in a radio-style toggle is a no-op when
                      // re-clicked (React bails on identical state). Tag the
                      // active one for SKIP_BUTTONS so the smoke walker
                      // doesn't flag the silence as a regression.
                      {...(active ? { 'data-testid': 'settings-difficulty-active' } : {})}
                      onClick={() => {
                        if (defaultDifficulty === d) {
                          try { haptic.light(); } catch { /* silent */ }
                        } else {
                          saveDifficulty(d);
                        }
                      }}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase transition-all ${
                        active
                          ? 'bg-emerald-800 text-emerald-300 border border-emerald-600'
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                      }`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="text-sm font-bold block mb-2">Wrestling Style</span>
              <div className="flex gap-2" role="radiogroup" aria-label="Default wrestling style">
                {STYLES.map(s => {
                  const active = defaultStyle === s;
                  return (
                    <button
                      key={s}
                      role="radio"
                      aria-checked={active}
                      aria-label={STYLE_LABELS[s]}
                      {...(active ? { 'data-testid': 'settings-style-active' } : {})}
                      onClick={() => {
                        if (defaultStyle === s) {
                          try { haptic.light(); } catch { /* silent */ }
                        } else {
                          saveStyle(s);
                        }
                      }}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
                        active
                          ? 'bg-emerald-800 text-emerald-300 border border-emerald-600'
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
                      }`}
                    >
                      {STYLE_LABELS[s]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* Accessibility */}
        <section>
          <h2 className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">Accessibility</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold block">Colorblind Mode</span>
                <span className="text-xs text-zinc-500">Swaps green/red to blue/orange</span>
              </div>
              <button
                onClick={toggleColorblind}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  colorblind ? 'bg-sky-800 text-sky-300' : 'bg-zinc-800 text-zinc-500'
                }`}
              >
                {colorblind ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </section>

        {/* About */}
        <section>
          <h2 className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">About</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <img src="/positions/matgrind-text.png" alt="MatGrind" className="h-4 inline-block" draggable={false} />
              <span className="text-xs text-zinc-500 font-mono">v{APP_VERSION}</span>
            </div>
            <p className="text-xs text-zinc-400">
              A turn-based wrestling card game featuring folkstyle, freestyle, and Greco-Roman rules.
            </p>
            <div className="flex gap-3 pt-2 border-t border-zinc-800">
              {onPrivacy && (
                <button onClick={onPrivacy} className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors">
                  Privacy Policy
                </button>
              )}
              {onTerms && (
                <button onClick={onTerms} className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors">
                  Terms of Service
                </button>
              )}
              {onAbout && (
                <button onClick={onAbout} className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors">
                  About
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Account - only shows for signed-in users. Anonymous players
            can't "log out" of nothing, so the section is hidden in that
            case to keep the screen clean. */}
        {isAuthenticated && (
          <section>
            <h2 className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mb-3">Account</h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              {user?.email && (
                <div className="text-xs text-zinc-400">
                  Signed in as <span className="text-zinc-200 font-mono">{user.email}</span>
                </div>
              )}
              <button
                onClick={() => {
                  try { haptic.light(); } catch { /* silent */ }
                  setShowChangePassword(true);
                }}
                className="w-full bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] transition-transform text-zinc-100 font-bold py-3 rounded-xl"
              >
                {hasPasswordProvider ? 'Change Password' : 'Set a Password'}
              </button>
              <button
                onClick={() => {
                  try { haptic.light(); } catch { /* silent */ }
                  setShowLogoutConfirm(true);
                }}
                className="w-full bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] transition-transform text-zinc-100 font-bold py-3 rounded-xl"
              >
                Log Out
              </button>
            </div>
          </section>
        )}

        {/* Support */}
        <section>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <span className="text-sm font-bold block mb-1">Support</span>
            <p className="text-xs text-zinc-500">
              Questions or feedback? Contact us at kamatsservices@gmail.com
            </p>
          </div>
        </section>
      </div>

      {/* Log-out confirmation modal. Renders inline (no portal) - it's a
          full-viewport overlay with a high z-index so it sits above the
          scrolling Settings list and the persistent tab bar. */}
      {showLogoutConfirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-confirm-title"
        >
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 id="logout-confirm-title" className="text-lg font-black text-white">
              Log out{user?.email ? ` of ${user.email}?` : '?'}
            </h3>
            <p className="text-sm text-zinc-400">
              Your local progress stays on this device. You can sign back in
              anytime to sync to the cloud.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                disabled={loggingOut}
                onClick={() => {
                  try { haptic.light(); } catch { /* silent */ }
                  setShowLogoutConfirm(false);
                }}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-100 font-bold py-3 rounded-xl"
              >
                Cancel
              </button>
              <button
                disabled={loggingOut}
                onClick={handleConfirmLogout}
                className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl"
              >
                {loggingOut ? 'Logging out…' : 'Log Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ChangePasswordSheet
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
      />
    </div>
  );
}
