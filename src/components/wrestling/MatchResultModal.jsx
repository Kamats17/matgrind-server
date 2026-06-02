import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { logEvent } from '../../lib/firebase.js';
import { useColorblind, p1TextClass, p2TextClass, p1BorderClass, p2BorderClass } from '../../lib/ColorblindContext';
import { haptic } from '../../lib/haptics';
import { fireConfetti } from '../../lib/motionFeedback';
import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';
import BottomSheet from '../ui/BottomSheet';
import XPCounter from './XPCounter.jsx';
import WinStreakBanner from './WinStreakBanner.jsx';
import ComebackBanner from './ComebackBanner.jsx';
import RivalryCard from './RivalryCard.jsx';
import CoachBlurb from '../career/CoachBlurb.jsx';
import ChampionshipMintCard from '../career/ChampionshipMintCard.jsx';
import PersonalBestCard from './PersonalBestCard.jsx';
import NextActionCard from './NextActionCard.jsx';
import { getDailyChallenges, getDailyProgress } from '../../lib/dailyChallenges.js';
import { renderShareCard, canShareFiles } from '../../lib/shareCard';
import { getWrestlerColors } from '../../lib/wrestlerColors.js';
import { getOpponentLine } from '../../lib/opponentDialogue.js';

const METHOD_LABELS = {
  pin: 'PINNED',
  tech_fall: 'TECHNICAL FALL',
  decision: 'DECISION',
  draw: 'DRAW',
  overtime: 'SUDDEN VICTORY',
};

const METHOD_ICONS = {
  pin: '📌',
  tech_fall: '⚡',
  decision: '🏅',
  draw: '-',
  overtime: '🏆',
};

const LOG_COLORS = {
  takedown:    'text-emerald-400',
  takedown_near_fall: 'text-emerald-400',
  escape:      'text-amber-400',
  reversal:    'text-yellow-300',
  near_fall:   'text-emerald-300',
  pin:         'text-red-400',
  pin_stage1:  'text-orange-400',
  pin_stage2:  'text-orange-400',
  tech_fall:   'text-purple-400',
  counter:     'text-sky-400',
  control:     'text-blue-300',
  scramble:    'text-yellow-300',
  boundary_reset: 'text-amber-400',
  period:      'text-zinc-500',
  setup:       'text-zinc-400',
  stalemate:   'text-zinc-500',
  ride_time:   'text-yellow-400',
  pin_attempt_trigger: 'text-red-300',
  exposure:    'text-amber-300',
  grand_amplitude: 'text-red-300',
  passivity:   'text-amber-500',
  overtime:    'text-purple-300',
  stall_warning: 'text-amber-400',
  stall_penalty: 'text-amber-500',
  defer:       'text-zinc-400',
  default:     'text-zinc-400',
};

// Replaces the static REMATCH / Main Menu pair when an online rematch
// handshake is in progress. Mirrors the four rematchStatus values
// produced by WrestlingGame: requested_by_me, requested_by_opponent,
// declined. ('idle' is handled by the caller.)
function NetworkRematchButtons({ rematchStatus, onRematch, onDeclineRematch, onMenu }) {
  if (rematchStatus === 'requested_by_opponent') {
    return (
      <>
        <button
          onClick={onRematch}
          className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-black font-black py-3 rounded-xl transition-all tracking-wide text-sm"
        >
          ACCEPT REMATCH
        </button>
        <button
          onClick={onDeclineRematch}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm"
        >
          Decline
        </button>
      </>
    );
  }
  if (rematchStatus === 'requested_by_me') {
    return (
      <>
        <button
          disabled
          className="flex-1 bg-yellow-500/40 text-black/70 font-black py-3 rounded-xl text-sm cursor-default flex items-center justify-center gap-2"
        >
          <span className="w-2 h-2 rounded-full bg-black/60 animate-pulse" />
          Waiting for opponent...
        </button>
        <button
          onClick={onDeclineRematch}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm"
        >
          Cancel
        </button>
      </>
    );
  }
  // 'declined': inform the player, offer Menu only.
  return (
    <>
      <div className="flex-1 text-center text-amber-300 text-xs font-bold py-3 px-2">
        Opponent declined the rematch.
      </div>
      <button
        onClick={onMenu}
        className="flex-1 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm"
      >
        Main Menu
      </button>
    </>
  );
}

export default function MatchResultModal({ state, postMatchData, onRematch, onMenu, onReplay, isTournament, tournamentRound, onContinueTournament, gameMode, humanPlayer = 'p1', playerAppearance = null, profile = null, rematchStatus = 'idle', onDeclineRematch = null }) {
  const { winner, winMethod, p1, p2, log = [], wrestlingStyle } = state;
  const isFreestyle = wrestlingStyle === 'freestyle';
  const isGreco = wrestlingStyle === 'greco';
  const isIntl = isFreestyle || isGreco;
  const [showLog, setShowLog] = useState(false);
  const [shareStatus, setShareStatus] = useState(null); // null | 'copied'
  const { colorblind } = useColorblind();
  const isDraw = winner === 'draw';
  const winnerData = isDraw ? null : state[winner];
  const isP1Win = winner === 'p1';

  // Human-perspective result drives the post-match "One More" nudge copy.
  const humanResult = isDraw ? 'draw' : (winner === humanPlayer ? 'win' : 'loss');

  // Featured-NPC dialogue. Renders a single italicized line under the winner
  // header when the opposing wrestler has an opponentDialogue.js entry.
  // `situation` is opponent-perspective: opponent's "win" line shows when the
  // human LOST; opponent's "loss" line shows when the human WON. Wrapped in
  // try/catch so a module-level failure doesn't crash the modal.
  const opponentNpcId = (humanPlayer === 'p1' ? p2?.npcId : p1?.npcId) || null;
  let opponentQuote = null;
  if (!isDraw && opponentNpcId) {
    try {
      const sit = humanResult === 'win' ? 'loss' : 'win';
      opponentQuote = getOpponentLine(opponentNpcId, sit);
    } catch { opponentQuote = null; }
  }

  // Daily-challenge progress feeds NextActionCard's top-priority tip
  // ("2 of 3 done - one more match should seal it"). We read localStorage
  // lazily inside useMemo so the modal mount stays cheap and defensive:
  // a storage exception must never break the match-end screen.
  const dailyCounts = useMemo(() => {
    try {
      const items = getDailyChallenges() || [];
      /** @type {any} */
      const progress = getDailyProgress() || {};
      const completed = Array.isArray(progress.completed) ? progress.completed : [];
      return { done: completed.length, total: items.length };
    } catch {
      return { done: 0, total: 0 };
    }
  }, []);

  // ── Match-end confetti celebration ─────────────────────────────────────
  // Fire once on mount based on the human's result. In vs_local_2p BOTH
  // players are human - we still fire for any decisive result since someone
  // sitting in front of the device just won. Draws get no confetti (anticlimax).
  // Reduced-motion is honored inside fireConfetti().
  const confettiFiredRef = useRef(false);
  useEffect(() => {
    if (confettiFiredRef.current) return;
    confettiFiredRef.current = true;
    if (isDraw) return;
    const humanWon = winner === humanPlayer;
    const bothHuman = gameMode === 'vs_local_2p' || gameMode === 'local';
    if (!humanWon && !bothHuman) return; // loss in vs_ai / network: no confetti
    if (winMethod === 'pin') fireConfetti('pin');
    else if (winMethod === 'tech_fall') fireConfetti('tech_fall');
    else fireConfetti('win');
  }, [isDraw, winner, humanPlayer, gameMode, winMethod]);

  const handleShare = useCallback(async () => {
    const methodLabel = METHOD_LABELS[winMethod] || 'DECISION';
    const winnerName = isDraw ? 'Draw' : winnerData?.name;
    const loserName = isDraw ? '' : state[winner === 'p1' ? 'p2' : 'p1']?.name;
    const text = isDraw
      ? `MatGrind: ${p1.name} vs ${p2.name} - DRAW ${p1.score}-${p2.score}${isTournament && tournamentRound ? ` (${tournamentRound})` : ''}`
      : `MatGrind: ${winnerName} defeats ${loserName} by ${methodLabel} ${p1.score}-${p2.score}${isTournament && tournamentRound ? ` (${tournamentRound})` : ''}`;

    logEvent('share_result', { method: winMethod, is_tournament: !!isTournament });
    haptic.light();

    // ── PNG share card (Web Share API files) ─────────────────────────
    // On platforms that support navigator.canShare({ files }) we hand off
    // a rendered 1200×630 PNG alongside the text. This turns every big
    // win into a shareable artifact. If anything in the pipeline fails
    // we fall through to the existing text-only paths below.
    try {
      if (!Capacitor.isNativePlatform() && canShareFiles()) {
        // Appearance lives on the profile, not on match state, so mirror the
        // resolution WrestlingGame uses: the human player gets their saved
        // singlet color; the opponent falls back to the corner default.
        const p1Colors = getWrestlerColors(humanPlayer === 'p1' ? playerAppearance : null, 'p1', colorblind);
        const p2Colors = getWrestlerColors(humanPlayer === 'p2' ? playerAppearance : null, 'p2', colorblind);
        const blob = await renderShareCard({
          p1Name: p1?.name,
          p1Score: p1?.score,
          p1Color: p1Colors.primary,
          p2Name: p2?.name,
          p2Score: p2?.score,
          p2Color: p2Colors.primary,
          winner,
          winMethodLabel: METHOD_LABELS[winMethod] || 'DECISION',
          wrestlingStyle,
          tournamentRound: isTournament ? tournamentRound : null,
        });
        if (blob) {
          const file = new File([blob], 'matgrind-result.png', { type: 'image/png' });
          if (canShareFiles(file)) {
            try {
              await navigator.share({
                title: 'MatGrind Match Result',
                text,
                files: [file],
              });
              return;
            } catch { /* user cancelled or browser rejected - try text path */ }
          }
        }
      }
    } catch {
      /* render or feature detection threw - fall through */
    }

    // Native share sheet (iOS/Android)
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: 'MatGrind Match Result',
          text,
          url: 'https://matgrind.com',
          dialogTitle: 'Share your match result',
        });
        return;
      } catch { /* user cancelled */ }
    }

    // Web Share API fallback (text-only)
    if (navigator.share) {
      try {
        await navigator.share({ title: 'MatGrind Match Result', text });
        return;
      } catch { /* user cancelled or unsupported */ }
    }
    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus('copied');
      setTimeout(() => setShareStatus(null), 2000);
    } catch { /* clipboard not available */ }
  }, [state, isDraw, winnerData, winner, winMethod, p1, p2, isTournament, tournamentRound, wrestlingStyle, colorblind, humanPlayer, playerAppearance]);

  return (
    <BottomSheet
      open
      dismissible={false}
      onClose={() => { /* terminal sheet - explicit Menu / Rematch / Continue buttons only */ }}
      title={METHOD_LABELS[winMethod] || 'MATCH RESULT'}
      className="!p-0"
    >
      <div className="relative">
        {/* Tournament round chip, top-right */}
        {isTournament && tournamentRound && (
          <div className="absolute -top-1 right-0 bg-purple-900/60 border border-purple-700/40 text-purple-300 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg z-10">
            {tournamentRound}
          </div>
        )}

        {/* Scrollable-ish content (BottomSheet itself scrolls up to 92vh) */}
        <div>

          {/* Winner header */}
          <div className="text-center mb-5">
            <div className="text-4xl mb-2">{METHOD_ICONS[winMethod] || '🏆'}</div>
            <div className="text-zinc-500 text-xs font-bold uppercase tracking-[0.2em] mb-1">{METHOD_LABELS[winMethod]}</div>

            {isDraw ? (
              <div className="text-white text-3xl font-black">DRAW</div>
            ) : (
              <div className="flex flex-col items-center">
                <div className={`text-3xl font-black ${isP1Win ? p1TextClass(colorblind) : p2TextClass(colorblind)}`}>
                  {winnerData?.name}
                </div>
                <div className="text-white text-lg font-bold mt-0.5">
                  {winMethod === 'pin' ? `WINS - Pinned ${state[winner === 'p1' ? 'p2' : 'p1']?.name}!` : 'WINS THE MATCH!'}
                </div>
              </div>
            )}
            {opponentQuote && (
              <div className="italic text-zinc-400 text-sm mt-3 px-4">
                "{opponentQuote}"
              </div>
            )}
          </div>

          {/* Score */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 mb-4">
            <div className="text-zinc-600 text-xs font-bold uppercase tracking-wider text-center mb-3">Final Score</div>
            <div className="grid grid-cols-3 items-center text-center">
              <div>
                <div className={`${p1TextClass(colorblind)} text-xs font-bold mb-1`}>{p1.name}</div>
                <div className={`font-black text-4xl ${p1.score > p2.score ? 'text-white' : 'text-zinc-500'}`}>{p1.score}</div>
              </div>
              <div className="text-zinc-700 font-black text-xl">-</div>
              <div>
                <div className={`${p2TextClass(colorblind)} text-xs font-bold mb-1`}>{p2.name}</div>
                <div className={`font-black text-4xl ${p2.score > p1.score ? 'text-white' : 'text-zinc-500'}`}>{p2.score}</div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[p1, p2].map((w, i) => (
              <div key={w.id} className={`bg-zinc-800 rounded-xl p-3 border ${i === 0 ? p1BorderClass(colorblind) : p2BorderClass(colorblind)}`}>
                <div className={`text-xs font-bold mb-2 ${i === 0 ? p1TextClass(colorblind) : p2TextClass(colorblind)}`}>{w.name}</div>
                <div className="space-y-1 text-xs">
                  {[
                    ['TD', w.takedownCount || 0],
                    ['Esc', w.escapeCount || 0],
                    ['Rev', w.reversalCount || 0],
                    ...(isIntl ? [
                      ['Exp', w.exposureCount || 0],
                      ...(w.grandAmplitudeCount > 0 ? [['GA', w.grandAmplitudeCount]] : []),
                    ] : [
                      ['NF', w.nearFallCount || 0],
                    ]),
                    ...(w.pinCount > 0 ? [['Pin', w.pinCount]] : []),
                  ].map(([label, val]) => (
                    <div key={label} className="flex justify-between text-zinc-400">
                      <span>{label}</span>
                      <span className="font-bold text-white">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Level Up */}
          {postMatchData?.leveledUp && (
            <div className="text-center mb-3" ref={() => haptic.success()}>
              <div className="text-yellow-400 font-black text-sm animate-pulse">
                LEVEL UP! Level {postMatchData.newLevel}
              </div>
              {postMatchData.statPointsGained > 0 && (
                <div className="text-emerald-400 text-xs font-bold mt-0.5">
                  +{postMatchData.statPointsGained} stat point{postMatchData.statPointsGained !== 1 ? 's' : ''} - visit Profile &gt; Attrs to spend!
                </div>
              )}
            </div>
          )}

          {/* Achievement Unlocks */}
          {postMatchData?.newAchievements?.length > 0 && (
            <div className="bg-amber-950/30 border border-amber-800/50 rounded-xl p-3 mb-4" ref={() => haptic.success()}>
              <div className="text-amber-400 text-xs font-black uppercase tracking-[0.15em] mb-2">Achievement Unlocked!</div>
              {postMatchData.newAchievements.map(a => (
                <div key={a.id} className="flex items-center gap-2 py-0.5">
                  <span className="text-base">{a.icon}</span>
                  <div>
                    <span className="text-white font-bold text-xs">{a.name}</span>
                    <span className="text-zinc-500 text-xs ml-1.5">{a.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Goal Completions */}
          {postMatchData?.completedGoals?.length > 0 && (
            <div className="bg-yellow-950/30 border border-yellow-800/50 rounded-xl p-3 mb-4">
              <div className="text-yellow-400 text-xs font-black uppercase tracking-[0.15em] mb-2">Goal Complete!</div>
              {postMatchData.completedGoals.map(g => (
                <div key={g.id} className="flex items-center justify-between py-0.5">
                  <span className="text-white text-xs font-bold">{g.label}</span>
                  <span className="text-yellow-400 text-xs font-bold">+{g.xpReward} XP</span>
                </div>
              ))}
            </div>
          )}

          {/* Comeback celebration - player was trailing then won */}
          {!isDraw && winner === humanPlayer && postMatchData?.comebackWin && (
            <ComebackBanner />
          )}

          {/* Win-streak celebration (player wins on a streak of 3+) */}
          {!isDraw && winner === humanPlayer && postMatchData?.winStreak >= 3 && (
            <WinStreakBanner
              winStreak={postMatchData.winStreak}
              isNewBest={!!postMatchData.brokeBestStreak}
            />
          )}

          {/* Personal-best chip - lists every record the player just broke.
              The component itself returns null for an empty list. */}
          {postMatchData?.newPersonalBests?.length > 0 && (
            <PersonalBestCard newBests={postMatchData.newPersonalBests} />
          )}

          {/* Rivalry head-to-head chip - only rendered when the match was
              recorded (AI-slot or practice-friend UID). See rivalries.js. */}
          {postMatchData?.rivalry && (
            <RivalryCard
              label={postMatchData.rivalry.label}
              wins={postMatchData.rivalry.wins}
              losses={postMatchData.rivalry.losses}
              didWin={postMatchData.rivalry.didWin}
            />
          )}

          {/* Career Depth Pass v1 - Championship mint card. Renders for
              championship + tournament wins; no-op when no trophy was minted.
              Sits ABOVE the coach blurb so the title moment lands first. */}
          {postMatchData?.careerTrophy && (
            <ChampionshipMintCard trophy={postMatchData.careerTrophy} />
          )}

          {/* Career Depth Pass v1 - Prestige badge unlock chips. One per
              newly earned forward-only badge. Highest emotional payoff is
              the season-perfect / pin-king / iron-will moment, so we sit
              the chips right under the trophy card. */}
          {Array.isArray(postMatchData?.careerBadges) && postMatchData.careerBadges.length > 0 && (
            <div className="bg-zinc-950 border border-amber-500/70 rounded-xl p-3 mb-4">
              <div className="text-amber-300 text-xs font-black uppercase tracking-[0.22em] mb-2">
                Badge Unlocked
              </div>
              <ul className="space-y-1">
                {postMatchData.careerBadges.map((badge) => (
                  <li key={badge.id} className="flex items-center gap-2">
                    <span className="text-2xl" aria-hidden="true">{badge.icon}</span>
                    <div className="min-w-0">
                      <div className="text-amber-200 text-sm font-black truncate">{badge.name}</div>
                      <div className="text-zinc-400 text-[10px] leading-snug">{badge.description}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Career Depth Pass v1 - Coach blurb (post-match feedback). Only
              renders for career matches (career or career-tournament).
              CoachBlurb itself no-ops on null. */}
          {postMatchData?.coachBlurb && (
            <CoachBlurb
              coachName={postMatchData.coachBlurb.coachName}
              line={postMatchData.coachBlurb.line}
              tone={postMatchData.coachBlurb.tone}
              label={postMatchData.coachBlurb.label}
            />
          )}

          {/* Career Depth Pass v1 - Career rivalry chip with feud flame
              escalation. Separate from the vs-AI rivalry above because the
              data sources are different (career.rivals vs localStorage
              rivalries.js). Both can render in the same result modal in
              theory; in practice only one will be populated per match. */}
          {postMatchData?.careerRivalry && (
            <RivalryCard
              label={postMatchData.careerRivalry.label}
              wins={postMatchData.careerRivalry.wins}
              losses={postMatchData.careerRivalry.losses}
              didWin={postMatchData.careerRivalry.didWin}
              feudLevel={postMatchData.careerRivalry.feudLevel}
            />
          )}

          {/* Career Depth Pass v1 - Career XP breakdown chip. Distinct from
              the Profile XP breakdown above so players see clearly which
              progression track the bonus credited. Currently renders the
              Rivalry +25% row (duals only); future steps may append more. */}
          {Array.isArray(postMatchData?.careerXpBreakdown) && postMatchData.careerXpBreakdown.length > 0 && (
            <div className="bg-zinc-950 border border-amber-700/50 rounded-xl p-3 mb-4">
              <div className="text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">Career XP Bonus</div>
              <div className="space-y-1">
                {postMatchData.careerXpBreakdown.map((row, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-zinc-300">{row.label}</span>
                    <span className="text-amber-300 font-bold">+{row.amount}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* XP Breakdown */}
          {postMatchData?.xpBreakdown && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 mb-4">
              <div className="text-zinc-600 text-xs font-bold uppercase tracking-wider mb-2">XP Earned</div>
              <div className="space-y-1">
                {postMatchData.xpBreakdown.map((item, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="text-zinc-400">{item.label}</span>
                    <span className="text-yellow-400 font-bold">+{item.xp}</span>
                  </div>
                ))}
                <div className="border-t border-zinc-800 pt-1 mt-1 flex justify-between text-sm">
                  <span className="text-white font-bold">Total</span>
                  <XPCounter
                    to={postMatchData.xpEarned}
                    durationMs={1100}
                    className="text-yellow-400 font-black"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Match Log toggle */}
          <button
            onClick={() => setShowLog(v => !v)}
            className="w-full text-zinc-500 hover:text-zinc-300 text-xs font-bold uppercase tracking-wider py-2 border border-zinc-800 rounded-lg mb-3 transition-colors"
          >
            {showLog ? '▲ Hide Match Log' : '▼ Show Match Log'}
          </button>

          {showLog && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 max-h-48 overflow-y-auto">
              <div className="space-y-1">
                {log.map((entry, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <span className="text-zinc-700 text-xs font-mono shrink-0 w-6 text-right">{entry.round}</span>
                    <span className={`text-xs leading-tight ${LOG_COLORS[entry.type] || LOG_COLORS.default}`}>
                      {entry.entry}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Share & Replay buttons - inside scroll area */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleShare}
              className="flex-1 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
            >
              {shareStatus === 'copied' ? 'Copied!' : 'Share Result'}
            </button>
            {onReplay && (
              <button
                onClick={onReplay}
                className="flex-1 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
              >
                Watch Replay
              </button>
            )}
          </div>

          {/* Post-match "what next" card - XP progress pulse + context-aware
              CTA. Renders nothing for tournaments (that flow owns its own
              "continue" button) or when profile/xp is missing. */}
          <NextActionCard
            profile={profile}
            result={humanResult}
            winStreak={postMatchData?.winStreak}
            gameMode={gameMode}
            dailyDone={dailyCounts.done}
            dailyTotal={dailyCounts.total}
            onRematch={onRematch}
            onMenu={onMenu}
            isTournament={isTournament}
          />
        </div>

        {/* Report-Player link - shown only after an online match. This is
            the minimum Apple 1.2 UGC-moderation surface: the only UGC in
            the app is the opponent's display name, and a reviewer needs a
            visible way to flag it. Opens the native mail composer via
            mailto: with opponent name + match ID prefilled. */}
        {gameMode === 'network' && (
          <div className="mt-3 text-center">
            <a
              href={(() => {
                const opp = winner === 'p1' ? state.p2?.name : state.p1?.name;
                const matchId = state?.matchId || postMatchData?.matchId || 'unknown';
                const subject = encodeURIComponent(`Report Player: ${opp || 'opponent'}`);
                const body = encodeURIComponent(
                  `Opponent display name: ${opp || '(unknown)'}\n` +
                  `Match ID: ${matchId}\n` +
                  `Date: ${new Date().toISOString()}\n\n` +
                  `Reason (please describe):\n\n`
                );
                return `mailto:support@matgrind.com?subject=${subject}&body=${body}`;
              })()}
              className="inline-block text-zinc-500 hover:text-red-400 text-xs underline decoration-dotted underline-offset-2 py-1"
            >
              Report Player
            </a>
          </div>
        )}

        {/* Action buttons - pinned at sheet bottom via sticky so they stay visible
            when the sheet content is long enough to scroll within max-h-[92vh]. */}
        <div className="sticky bottom-0 -mx-5 -mb-6 mt-4 px-5 pt-4 pb-6 bg-zinc-900/95 backdrop-blur border-t border-zinc-800 flex gap-3">
          {isTournament ? (
            <>
              <button
                onClick={onContinueTournament}
                className="flex-1 bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-black py-3 rounded-xl transition-all tracking-wide text-sm"
              >
                {gameMode === 'career'
                  ? 'Play Next'
                  : gameMode === 'dual_cpu' || gameMode === 'dual_hotseat'
                    ? 'Continue Dual'
                    : (winner === 'draw' || (winner === 'p1' && state.p1?.name) ? 'Continue Tournament' : 'View Bracket')}
              </button>
              <button
                onClick={onMenu}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm"
              >
                {gameMode === 'career'
                  ? 'Career Home'
                  : gameMode === 'dual_cpu' || gameMode === 'dual_hotseat'
                    ? 'Quit Dual'
                    : 'Quit Tournament'}
              </button>
            </>
          ) : gameMode === 'network' && rematchStatus !== 'idle' ? (
            <NetworkRematchButtons
              rematchStatus={rematchStatus}
              onRematch={onRematch}
              onDeclineRematch={onDeclineRematch}
              onMenu={onMenu}
            />
          ) : (
            <>
              <button
                onClick={onRematch}
                className="flex-1 bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black font-black py-3 rounded-xl transition-all tracking-wide text-sm"
              >
                REMATCH
              </button>
              <button
                onClick={onMenu}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm"
              >
                Main Menu
              </button>
            </>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
