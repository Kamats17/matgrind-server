import React, { useMemo, useState } from 'react';
import { NCAA_WEIGHT_CLASSES, weightLabel } from '../../lib/ncaaWeights.js';
import { canStartDualMeet } from '../../lib/dualMeetState.js';
import { generateTeamName } from '../../lib/dualMeetTeams.js';
import { WRESTLING_STYLES, resolveStyle } from '../../lib/namePools.js';

/**
 * Setup screen for a new Dual Meet. Collects wrestling style, mode (vs CPU
 * / hotseat), difficulty, team names, hero weight class, and lineup mode.
 * Calls `onStart(config)` with a config object consumable by
 * createDualMeet() - including `style`, which selects the AI name pool.
 *
 * UI is laid out as a vertical stack with a single prominent hero icon
 * at the top. Form sections are tight - labels inline with compact
 * controls - so the whole screen fits on a phone viewport without
 * scrolling past the Start button. The Start action is always visible
 * in a sticky footer so the user can fire it the moment their choices
 * are set.
 */
export default function DualSetupScreen({ profile, onStart, onBack }) {
  const gate = canStartDualMeet(profile);
  // Wrestling style selector. Drives which name pool the AI teams draw from
  // (Women's Freestyle -> women's names) and is stored on the dual. Dual
  // scoring stays folkstyle under the hood at MVP. Initialized from the Main
  // Menu's stored default style.
  const [style, setStyle] = useState(
    () => resolveStyle({
      storedDefault: typeof localStorage !== 'undefined' && localStorage.getItem('matgrind_default_style'),
    }),
  );
  const isWomensFreestyle = style === 'womens_freestyle';
  const isIntl = style === 'freestyle' || style === 'greco' || isWomensFreestyle;
  const [mode, setMode] = useState('cpu');             // 'cpu' | 'hotseat'
  const [difficulty, setDifficulty] = useState('medium'); // easy | medium | hard
  const [heroWeightClass, setHeroWeightClass] = useState(157);
  const [playerTeamName, setPlayerTeamName] = useState(() => (profile?.username ? `${profile.username}'s Team` : 'Home'));
  const [opponentSeedName, setOpponentSeedName] = useState('');

  const opponentTeamName = useMemo(
    () => (opponentSeedName.trim() || generateTeamName(playerTeamName.trim() || 'Home')),
    [opponentSeedName, playerTeamName],
  );

  const disabled = !gate.eligible;

  const handleStart = () => {
    if (disabled) return;
    onStart({
      mode,
      difficulty,
      heroWeightClass,
      playerTeamName: playerTeamName.trim() || 'Home',
      opponentTeamName,
      lineupMode: 'random',
      style,
    });
  };

  return (
    <div className="min-h-full bg-zinc-950 text-white flex flex-col">
      {/* Header - inner max-w keeps the Menu ← / title / spacer in line
          with the form columns below on wide viewports. */}
      <div className="border-b border-zinc-800 bg-zinc-950 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <button
            onClick={onBack}
            className="text-zinc-500 hover:text-zinc-300 text-sm font-semibold px-2 py-1 -ml-2"
          >
            ← Menu
          </button>
          <div className="text-amber-400 text-[11px] font-black uppercase tracking-[0.25em]">Dual Meet</div>
          <div className="w-12" />
        </div>
      </div>

      {/* Scrolling body
          Layout: on mobile, a single column. On md+ (≥768px) the setup
          splits into two columns so the whole form fits above the fold on
          a laptop / wide browser - previous design wasted half the screen
          in a narrow max-w-lg middle strip with dead space under the
          weight-class grid. Hero icon sits in a compact banner row so it
          introduces the screen without consuming half of it. */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-5">

          {/* Hero banner - horizontal on md+, stacked on mobile. Keeps the
              art visible without the old center-stacked vertical eat-up. */}
          <div className="flex items-center gap-4 mb-5 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
            <img
              src={isIntl ? '/icon-dual-freestyle.png' : '/icon-dual-folkstyle.png'}
              alt={isWomensFreestyle ? "Women's Freestyle Dual" : isIntl ? 'Freestyle / Greco Dual' : 'Folkstyle Dual'}
              draggable={false}
              className="w-20 h-20 md:w-24 md:h-24 object-contain flex-shrink-0"
            />
            <div className="min-w-0">
              <div className="text-white text-lg md:text-xl font-black uppercase tracking-wider leading-tight">
                10-Bout Team Dual
              </div>
              <div className="text-zinc-400 text-xs mt-1">
                NCAA scoring · {isIntl ? 'Freestyle/Greco lineup' : 'Folkstyle rules'} · win the meet for your squad
              </div>
            </div>
          </div>

          {disabled && (
            <div className="bg-amber-900/30 border border-amber-700/50 rounded-xl p-3 text-amber-200 text-sm mb-5">
              {gate.reason}
            </div>
          )}

          {/* Two-column grid on desktop. Left column: Mode + Difficulty
              (quick choices). Right column: Teams (names). Weight class
              spans the full width below because its 5-col grid already
              fills the row nicely. */}
          <div className="grid md:grid-cols-2 gap-5 md:gap-6">

            {/* LEFT */}
            <div className="space-y-5">
              <Section label="Style">
                <div className="grid grid-cols-2 gap-2">
                  {WRESTLING_STYLES.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setStyle(s.id)}
                      aria-pressed={style === s.id}
                      className={`py-2.5 rounded-lg text-xs font-black uppercase tracking-wide transition-all ${
                        style === s.id ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Section>

              <Section label="Mode">
                <div className="grid grid-cols-2 gap-2">
                  <Toggle
                    active={mode === 'cpu'}
                    onClick={() => setMode('cpu')}
                    title="vs CPU"
                    subtitle="AI team"
                  />
                  <Toggle
                    active={mode === 'hotseat'}
                    onClick={() => setMode('hotseat')}
                    title="Hotseat"
                    subtitle="Pass the phone"
                  />
                </div>
              </Section>

              <Section label="Difficulty">
                <div className="grid grid-cols-3 gap-2">
                  {['easy', 'medium', 'hard'].map(d => (
                    <button
                      key={d}
                      onClick={() => setDifficulty(d)}
                      className={`py-2.5 rounded-lg text-sm font-black capitalize transition-all ${
                        difficulty === d ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </Section>
            </div>

            {/* RIGHT */}
            <div className="space-y-5">
              <Section label="Teams">
                <div className="space-y-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Your team</div>
                    <input
                      type="text"
                      value={playerTeamName}
                      onChange={(e) => setPlayerTeamName(e.target.value.slice(0, 28))}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                      placeholder="Your team name"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Opponent</div>
                    <input
                      type="text"
                      value={opponentSeedName}
                      onChange={(e) => setOpponentSeedName(e.target.value.slice(0, 28))}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                      placeholder={`Random: ${opponentTeamName}`}
                    />
                  </div>
                </div>
              </Section>
            </div>
          </div>

          {/* Weight class - full-width beneath. 5-col grid fits two rows of
              NCAA classes cleanly and the active pill is the single most
              important glanceable control, so it earns the full row. */}
          <div className="mt-5">
            <Section label="Your Weight Class">
              <p className="text-zinc-500 text-xs mb-2">You wrestle this bout; teammates fill the other 9.</p>
              <div className="grid grid-cols-5 gap-2">
                {NCAA_WEIGHT_CLASSES.map(w => (
                  <button
                    key={w}
                    onClick={() => setHeroWeightClass(w)}
                    className={`py-3 rounded-lg text-sm font-black transition-all ${
                      heroWeightClass === w
                        ? 'bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    {weightLabel(w)}
                  </button>
                ))}
              </div>
            </Section>
          </div>

          <div className="h-4" />
        </div>
      </div>

      {/* Sticky footer - inner max-w matches the body so Cancel/Start
          sit directly under their form columns instead of stretching edge
          to edge on a laptop browser. */}
      <div
        className="border-t border-zinc-800 bg-zinc-950"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
      >
        <div className="max-w-4xl mx-auto px-4 py-3 flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={disabled}
            className="flex-[2] bg-amber-500 hover:bg-amber-400 active:scale-[0.98] disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 font-black py-3 rounded-xl transition-all"
          >
            Start Dual →
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <section>
      <label className="text-zinc-400 text-[11px] font-bold uppercase tracking-widest block mb-2">{label}</label>
      {children}
    </section>
  );
}

function Toggle({ active, disabled = false, onClick, title, subtitle }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-3 rounded-xl border text-left transition-all ${
        disabled
          ? 'bg-zinc-900/60 border-zinc-800 text-zinc-600 cursor-not-allowed'
          : active
            ? 'bg-amber-500 border-amber-400 text-zinc-950'
            : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:border-zinc-500'
      }`}
    >
      <div className="font-black text-sm">{title}</div>
      <div className={`text-[11px] mt-0.5 ${active && !disabled ? 'text-zinc-800/80' : 'text-zinc-500'}`}>{subtitle}</div>
    </button>
  );
}

