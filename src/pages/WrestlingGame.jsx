import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  createInitialMatchState,
  resolveRound,
  resolvePinStage1,
  resolvePinStage2,
  resolvePinStage3,
  applyPeriodChoice,
  applyPushPace,
  applyCutOpponent,
  getAICard,
  getAIPeriodChoice,
  getAIPinOffenseCard,
  getAIPinOffenseCardStage1,
  getAIPinOffenseCardStage2,
  getAIPinDefenseCard,
  getAIPinDefenseCardStage2,
  getAIPinDefenseCardStage3,
  getAISkillResult,
  buildHand,
  rerollHand,
  describeMatchPosition,
} from '../lib/wrestlingEngine.js';
import CardSkillChallenge from '../components/wrestling/CardSkillChallenge.jsx';
import { getMissResult, getMechanicForCard, MECHANIC_TYPES } from '../lib/cardArchetypeMechanics.js';
import { formatPathTraceLabel } from '../lib/pathTraceLabel.js';
import { shouldRenderTraceChip } from '../lib/traceFeedback.js';
import {
  computeXP, computeXPBreakdown, getLevelFromXP,
  loadGoals, updateGoalProgress,
  loadFeaturedDailyGoal, updateFeaturedDailyGoalProgress,
  checkAchievements, ACHIEVEMENTS,
  computeBadgeBonusXP,
  consumeFirstWinOfDayIfEligible,
  checkPersonalBests,
} from '../lib/profileUtils.js';
import { getProfile, saveProfile, createMatch, saveDecks, getActiveCareer, saveCareer, loadLocalCareer, archiveCareer, clearLocalCareer, saveCareerTournament, loadCareerTournament, clearCareerTournament, getCareerSlots, getCareerForSlot, setActiveSlot, clearSlot, restoreCareerToSlot, deleteCareer, getOnlineProgress } from '../lib/firestoreService.js';
import { shouldApplySettlement, trustedOnlineWins, resolveAchievementObjects } from '../lib/onlineProgress.js';
import { withTimeout } from '../lib/withTimeout.js';
import { applyCareerMatchModifiers } from '../lib/career/careerMatchModifiers.js';
import { stashModifiers, readModifiers, clearModifiers } from '../lib/career/careerModifiersStash.js';
import { getCoachLine } from '../lib/career/careerCoach.js';
import BracketRevealScreen from '../components/career/BracketRevealScreen.jsx';
import {
  hydrateCareer,
  recordEventResult as recordCareerEventResult,
  applyInterimTournamentMatch,
  advanceToNextSeason as advanceCareerSeason,
  retireCareer,
  getNextEvent as getNextCareerEvent,
  buildHallOfFameThumbnail,
  acceptCollegeOffer,
  takeWalkOnPath,
  confirmTierTransition,
  chooseSeniorStyle,
  KNOWN_PHASES,
} from '../lib/career/careerState.js';
import { pickDifficultyForOverall, computeOverallFromStats } from '../lib/career/careerOpponents.js';
import { buildSeededBracket } from '../lib/career/careerBrackets.js';
import { feudLevel, FEUD_BLOOD } from '../lib/career/careerRivals.js';
import { isTournamentSnapshotResumable } from '../lib/career/tournamentResume.js';
import { simulateDualEvent, simulateTournamentEvent, summarizeForfeitedTournament } from '../lib/career/simulateEvent.js';
import { loadGuestProfile, saveGuestProfile, appendGuestMatch } from '../lib/guestProfile.js';
import { logEvent, auth } from '../lib/firebase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { saveMatchToStorage, loadMatchFromStorage, clearMatchFromStorage } from '../lib/matchPersistence.js';
import { runOneTimeBootCleanup, runServerTriggeredReset } from '../lib/clientResetCleanup.js';
import { currentWeekId } from '../lib/weekId.js';
import { haptic } from '../lib/haptics';
import { initNotifications, cancelStreakReminder, updateBadge } from '../lib/notificationService.js';
import { useSoundContext } from '../lib/SoundContext.jsx';
import { getWrestlerColors } from '../lib/wrestlerColors.js';
import { useColorblind, p1TextClass, p2TextClass } from '../lib/ColorblindContext';
import { createReplay, recordRound, recordPeriodChoice, recordPinPick, finalizeReplay, saveReplay } from '../lib/replaySystem.js';
import { saveTournamentResult } from '../lib/tournamentHistory.js';
import { computePlacement, computeTournamentPoints } from '../lib/tournamentScoring.js';
import { recordRivalry, buildOpponentId, formatOpponentLabel } from '../lib/rivalries.js';
import { randomTip } from '../lib/matchTips.js';
import { motion } from 'framer-motion';
import { useShake } from '../lib/motionFeedback.js';
import ScreenTransition from '../lib/ScreenTransition.jsx';
import { useSwipeBack } from '../lib/useSwipeBack.js';
import LoadingState from '../components/ui/LoadingState.jsx';
import { useTabState } from '../lib/tabState.jsx';
import { useFriendRequests } from '../lib/FriendRequestContext.jsx';
import {
  createTournament, advanceMatch,
  clearTournament, isPlayerFirstBracketMatch,
} from '../lib/tournamentState.js';
import {
  createDualMeet,
  advanceDualBout,
  startNextBout as startNextDualBout,
  getDualMeetXPBonus,
  getDualWinner,
  saveDual,
  loadDual,
  clearDual,
  saveCareerDual,
  loadCareerDual,
  clearCareerDual,
  scoreFolkstyleBout,
} from '../lib/dualMeetState.js';
import {
  createCareerDualMeet,
  simulateNonHeroBouts,
  simulateOneBout,
  recordCareerDualMeetResult,
  recordCareerDualAbort,
} from '../lib/career/careerDualMeet.js';
import { isCareerDualMeetSnapshotResumable } from '../lib/career/dualMeetResume.js';
import { simulateDualMeetEvent } from '../lib/career/simulateEvent.js';
import { checkAllDailyChallenges } from '../lib/dailyChallenges.js';
import DailyChallenges from '../components/wrestling/DailyChallenges.jsx';
import DailyGoalCard from '../components/wrestling/DailyGoalCard.jsx';

import MainMenu from '../components/wrestling/MainMenu.jsx';
import NetworkLobby from '../components/wrestling/NetworkLobby.jsx';
import {
  startQueue,
  consumeMatch,
  setInterruptHostile,
  handleAppPause as queueHandleAppPause,
  handleAppResume as queueHandleAppResume,
} from '../lib/queueManager.js';
import ScoreBoard from '../components/wrestling/ScoreBoard.jsx';
import RadialCardPicker from '../components/wrestling/RadialCardPicker.jsx';
// v2.0 radial control is now the only picker for match UI. The legacy
// CardHand grid was kept behind VITE_USE_LEGACY_HAND during the radial
// rollout (phase 3); it's no longer needed since the radial ships as the
// default across all QA devices. Keeping the alias name `HandPicker` so
// downstream JSX sites don't need to change if we ever add a third picker.
const HandPicker = RadialCardPicker;
import PeriodChoiceModal from '../components/wrestling/PeriodChoiceModal.jsx';
import PinAttemptModal from '../components/wrestling/PinAttemptModal.jsx';
import MatchResultModal from '../components/wrestling/MatchResultModal.jsx';
import MoveTimer from '../components/wrestling/MoveTimer.jsx';
import CreateWrestler from '../components/wrestling/CreateWrestler.jsx';
import WhatsNew from '../components/wrestling/WhatsNew.jsx';
import { recordDailyPlay, calculateStreakBonus } from '../lib/streakRewards.js';
const Profile = React.lazy(() => import('./Profile.jsx'));
const Privacy = React.lazy(() => import('./Privacy.jsx'));
const Terms = React.lazy(() => import('./Terms.jsx'));
const About = React.lazy(() => import('./About.jsx'));
const Tutorial = React.lazy(() => import('../components/wrestling/Tutorial.jsx'));
const TrainingHub = React.lazy(() => import('../components/training/TrainingHub.jsx'));
const ModesScreen = React.lazy(() => import('../components/modes/ModesScreen.jsx'));
const TournamentSetupScreen = React.lazy(() => import('../components/modes/TournamentSetupScreen.jsx'));
const Leaderboard = React.lazy(() => import('./Leaderboard.jsx'));
const PublicProfile = React.lazy(() => import('./PublicProfile.jsx'));
const Friends = React.lazy(() => import('./Friends.jsx'));
const TournamentBracket = React.lazy(() => import('../components/wrestling/TournamentBracket.jsx'));
const Settings = React.lazy(() => import('./Settings.jsx'));
const ReplayViewer = React.lazy(() => import('../components/wrestling/ReplayViewer.jsx'));
const ReplayList = React.lazy(() => import('../components/wrestling/ReplayList.jsx'));
const TournamentHistory = React.lazy(() => import('../components/wrestling/TournamentHistory.jsx'));
const DualSetupScreen = React.lazy(() => import('../components/wrestling/DualSetupScreen.jsx'));
const DualScoreboard = React.lazy(() => import('../components/wrestling/DualScoreboard.jsx'));
const DualResultScreen = React.lazy(() => import('../components/wrestling/DualResultScreen.jsx'));
const CareerDualMeetSetup = React.lazy(() => import('../components/wrestling/CareerDualMeetSetup.jsx'));
const CareerDualMeetResult = React.lazy(() => import('../components/wrestling/CareerDualMeetResult.jsx'));
const DecksScreen = React.lazy(() => import('../components/wrestling/DecksScreen.jsx'));
const CareerCreation = React.lazy(() => import('../components/career/CareerCreation.jsx'));
const CareerDashboard = React.lazy(() => import('../components/career/CareerDashboard.jsx'));
const CareerTrophyCase = React.lazy(() => import('../components/career/CareerTrophyCase.jsx'));
const CareerSlotPicker = React.lazy(() => import('../components/career/CareerSlotPicker.jsx'));
const CareerDecisionScreen = React.lazy(() => import('../components/career/CareerDecisionScreen.jsx'));
const CareerEventPreview = React.lazy(() => import('../components/career/CareerEventPreview.jsx'));
const CareerOffseasonScreen = React.lazy(() => import('../components/career/CareerOffseasonScreen.jsx'));
const CareerRecruitingScreen = React.lazy(() => import('../components/career/CareerRecruitingScreen.jsx'));
const CareerTierTransitionScreen = React.lazy(() => import('../components/career/CareerTierTransitionScreen.jsx'));
const CareerSeniorStyleChoice = React.lazy(() => import('../components/career/CareerSeniorStyleChoice.jsx'));
const ElijahChallenge = React.lazy(() => import('../components/wrestling/ElijahChallenge.jsx'));

const HAND_SIZE = 6;

// Canonical Suspense fallback - delegates to the shared LoadingState
// primitive so every route spinner looks identical. The `tip` prop shows a
// rotating wrestling tip so the reviewer never stares at a bare spinner.
const LazyFallback = () => <LoadingState tip />;

// Module-level hand builder. The `allowedCardIds` argument is optional -
// when provided (Phase 3 Deck Builder, see src/lib/deckService.js) the
// candidate pool is filtered to that deck with a softlock-safe fallback.
// Call sites inside the component use a `handFor(player, ...)` wrapper
// that resolves the right deck per side (local user's deck vs opponent's).
function getHand(position, conditions, style = 'folkstyle', allowedCardIds = null) {
  return buildHand(position, conditions, HAND_SIZE, style, allowedCardIds);
}

// Reroll variant - delegates to the engine's `rerollHand` which enforces
// the carry-over constraint (≤2 cards repeat, no lone-of-category stays).
function getRerollHand(prevHand, position, conditions, style = 'folkstyle', allowedCardIds = null) {
  return rerollHand(prevHand, position, conditions, HAND_SIZE, style, allowedCardIds);
}

const MOVE_TIMER_DEFAULT = 30;
// Dual Meets: 'dual_cpu' is AI-driven like vs_ai/tournament; 'dual_hotseat'
// passes control to a second human between bouts (handled via localTurn like
// gameMode === 'local') so isAIMode is *not* true there.
const isAIMode = (mode) => mode === 'vs_ai' || mode === 'tournament' || mode === 'dual_cpu' || mode === 'career' || mode === 'career_tournament' || mode === 'career_dual_my_match' || mode === 'career_dual_full';
const isDualMode = (mode) => mode === 'dual_cpu' || mode === 'dual_hotseat';
// Career-mode dual bouts. Distinct from standalone dual modes so:
//   1. The auto-record-career path in saveMatchResult (mode === 'career')
//      does NOT fire on bout completion; the bridge records once at dual end.
//   2. The standalone dual result modal does NOT route through career.
//   3. The AI predicate above still treats them as AI matches.
const isCareerDualMode = (mode) => mode === 'career_dual_my_match' || mode === 'career_dual_full';
// Any dual context - used by UI predicates that must reflect "a dual is in
// flight" regardless of standalone vs career provenance.
const isAnyDualMode = (mode) => isDualMode(mode) || isCareerDualMode(mode);

// Hash-based routing for linkable screens. `signin` and `create-wrestler`
// both deep-link into the CreateWrestler auth flow so the back button
// on both desktop and mobile returns to the previous screen (Network
// lobby, menu, etc.) instead of dumping users to root.
// Hoisted to module scope so setScreen's useCallback can have empty deps.
const HASH_SCREENS = { profile: 'profile', leaderboard: 'leaderboard', friends: 'friends', tutorial: 'tutorial', settings: 'settings', privacy: 'privacy', terms: 'terms', about: 'about', replays: 'replays', replay: 'replay', decks: 'decks', signin: 'create_wrestler', 'create-wrestler': 'create_wrestler', elijah: 'elijah_challenge' };

// Hoisted to module scope so the hashchange-listener useEffect can safely
// depend on a stable identity (helpers defined inside the component would
// re-allocate every render and trigger react-hooks/exhaustive-deps).
function getScreenFromHash() {
  const h = window.location.hash.replace('#', '');
  return HASH_SCREENS[h] || 'menu';
}
function getAuthIntentFromHash() {
  const h = window.location.hash.replace('#', '');
  return h === 'signin' ? 'login' : 'signup';
}

export default function WrestlingGame() {
  const { play: playSound } = useSoundContext();
  const { user, isAuthenticated } = useAuth();
  const { colorblind } = useColorblind();
  const { setActiveTab, setHideTabBar, registerTabHandler } = useTabState();
  const { pendingCount: pendingFriendRequestCount } = useFriendRequests();
  const [wrestlerProfile, setWrestlerProfile] = useState(null);

  // 2026-05-01 - One-time boot cleanup of transient match-state
  // localStorage. Wipes pinned_match_state, dual-meet caches, and
  // per-career tournament caches across all users on this device. Runs
  // synchronously BEFORE the persistence-restore useEffect so the
  // restore reads from the cleaned storage. Idempotent via a fixed
  // flag - re-runs of this effect (StrictMode mount+remount, etc.) are
  // no-ops after the first run. Career-data and auth keys are
  // preserved. Catches any user (Mason and others) who had stale
  // match-state across the deploy boundary that produced the
  // "Loading match..." stuck state.
  useEffect(() => {
    const result = runOneTimeBootCleanup();
    if (result.ranNow && result.keysCleared.length > 0) {
      console.log('[cleanup] one-time stale-state wipe', result.keysCleared);
    }
  }, []);

  // Which auth mode CreateWrestler opens on when reached via the sign-in
  // gate (signup = default, login when the user taps "Sign In"). Hash
  // alone disambiguates intent: #signin → login tab, #create-wrestler → signup.
  const [authIntent, setAuthIntent] = useState(getAuthIntentFromHash);
  const [screen, setScreenRaw] = useState(getScreenFromHash);
  // UID of the wrestler currently being viewed via PublicProfile. Kept
  // out of the hash for now - opaque route for a read-only view.
  const [publicProfileUid, setPublicProfileUid] = useState(null);
  // Which screen opened PublicProfile, so Back returns there instead of
  // always dumping the user back on the leaderboard.
  const [publicProfileSource, setPublicProfileSource] = useState('leaderboard');
  // setScreen(screen, opts?) - opts.authIntent picks the hash alias for
  // create_wrestler ('signin' vs 'create-wrestler') so back/forward and
  // reload land on the right tab. Passed explicitly because React state
  // updates are async - reading `authIntent` from closure here would be stale.
  // Refs let setScreen stay stable (useCallback with empty deps) while still
  // seeing the freshest authIntent / playSound on every invocation.
  const authIntentRef = useRef(authIntent);
  authIntentRef.current = authIntent;
  const setScreenPlaySoundRef = useRef(playSound);
  setScreenPlaySoundRef.current = playSound;
  const setScreen = useCallback((s, opts) => {
    setScreenRaw(prev => {
      if (s !== prev) {
        try { haptic.light(); } catch { /* silent */ }
        try { setScreenPlaySoundRef.current('setup'); } catch { /* silent */ }
      }
      return s;
    });
    let hashKey;
    if (s === 'create_wrestler') {
      const intent = opts?.authIntent || authIntentRef.current;
      hashKey = intent === 'login' ? 'signin' : 'create-wrestler';
    } else {
      hashKey = Object.entries(HASH_SCREENS).find(([, v]) => v === s)?.[0];
    }
    suppressNextHashChange.current = true;
    window.location.hash = hashKey || '';
  }, []);
  const [gameMode, setGameMode] = useState('vs_ai');
  const [matchState, setMatchState] = useState(null);
  // Impact counter - increments on heavy-feedback moments (takedown, pin,
  // reversal, grand amplitude) to drive the screen-shake hook. This is the
  // motion half of the 3-layer feedback system; the haptic + sound halves
  // are handled in the two resolveRound branches below.
  const [impactCounter, setImpactCounter] = useState(0);
  const [impactIntensity, setImpactIntensity] = useState('medium');
  // Screen-shake controls (hook at top of component so it runs on every
  // render regardless of which screen we're on). `impactCounter` ticks on
  // takedown / pin / reversal in both resolveRound branches; useShake
  // then runs the amplitude curve from motionFeedback.js. Reduced-motion
  // is honored inside the hook.
  const shakeControls = useShake(impactCounter, impactIntensity);
  const [p1Hand, setP1Hand] = useState([]);
  const [p2Hand, setP2Hand] = useState([]);
  const [p1Selected, setP1Selected] = useState(null);
  const [p2Selected, setP2Selected] = useState(null);
  const [resolving, setResolving] = useState(false);
  // Per-archetype micro-mechanic skill challenge state. After a player picks a
  // card, a challenge overlay fires; result modifies that player's bonus and
  // RNG variance in resolveRound. See cardArchetypeMechanics.js + Task 7-12.
  const [pendingChallenge, setPendingChallenge] = useState(null); // { card, side: 'p1'|'p2' }
  const [p1SkillResult, setP1SkillResult] = useState(null);
  const [p2SkillResult, setP2SkillResult] = useState(null);
  // Pin phase selections
  const [pinOffenseChoice, setPinOffenseChoice] = useState(null);
  const [pinDefenseChoice, setPinDefenseChoice] = useState(null);
  // Post-match XP/achievement data for result modal
  const [postMatchData, setPostMatchData] = useState(null);
  // Confirm-forfeit dialog: when the user clicks "Quit Tournament" during a
  // career tournament we ask first before recording the forfeit (so the
  // mis-click case doesn't permanently advance the schedule).
  const [showQuitTournamentConfirm, setShowQuitTournamentConfirm] = useState(false);
  // Which side the human controls in vs_ai mode ('p1' = green, 'p2' = red)
  const [humanPlayer, setHumanPlayer] = useState('p1');
  // Mirror into a ref so saveMatchResult (useCallback []) always reads the
  // current side even after startNetworkGame flips humanPlayer to 'p2'.
  // Without this, the p2/red client saves every match as a p1 loss.
  const humanPlayerRef = useRef('p1');
  useEffect(() => { humanPlayerRef.current = humanPlayer; }, [humanPlayer]);

  // Phase 3 - Deck Builder. Resolved from wrestlerProfile.activeDeckId +
  // wrestlerProfile.decks whenever the profile changes (see the effect
  // below). Held in a ref because the many `getHand(...)` call sites are
  // inside non-React callbacks that close over stale state otherwise.
  const userDeckCardIdsRef = useRef(null); // Set<string> | null
  // `handFor(player, ...)` applies the deck filter only to the side the
  // local user controls. In vs_ai / tournament / dual_cpu the user is
  // `humanPlayer`; in network the user is `networkPlayer`; in local 2P
  // both sides are the same device but we only filter the user's deck.
  const networkPlayerRef = useRef(null);
  // Tournament state
  const [tournamentState, setTournamentState] = useState(null);
  // Mirrored ref so the once-registered Play tab handler can resume into
  // tournament mode without re-registering on every state mutation.
  const tournamentStateRef = useRef(null);
  useEffect(() => { tournamentStateRef.current = tournamentState; }, [tournamentState]);
  const [tournamentMatchInfo, setTournamentMatchInfo] = useState(null); // { matchIndex, opponent, round, roundKey }
  // Ref-mirrored so saveMatchResult (useCallback []) reads the current
  // round (e.g. 'qf' vs 'finals') without re-creating the callback identity.
  // Without this, a round that finishes while the new round info is being
  // written could attribute the win to the prior round.
  const tournamentMatchInfoRef = useRef(null);
  useEffect(() => { tournamentMatchInfoRef.current = tournamentMatchInfo; }, [tournamentMatchInfo]);
  // Career Depth Pass v1: tagged stash of modifiers (stats / staminaMultiplier
  // / banners / consumedBuffSourceIds) computed at career match start so the
  // result handler can forward consumedBuffSourceIds to recordEventResult.
  // Tag is {careerId, eventId} so a stale stash from a prior career or event
  // cannot contaminate the active one - readCareerMatchModifiers returns null
  // whenever the tag does not match the active context.
  const careerMatchModifiersRef = useRef(null);
  const stashCareerMatchModifiers = useCallback((careerId, eventId, mods) => {
    careerMatchModifiersRef.current = stashModifiers(careerMatchModifiersRef.current, careerId, eventId, mods);
  }, []);
  const readCareerMatchModifiers = useCallback((careerId, eventId) => {
    return readModifiers(careerMatchModifiersRef.current, careerId, eventId);
  }, []);
  const clearCareerMatchModifiers = useCallback(() => {
    careerMatchModifiersRef.current = clearModifiers();
  }, []);
  // Career Depth Pass v1 (Step 4): pending bracket reveal payload. Local UI
  // screen flag only (no new career phase). When set, screen === 'career_bracket_reveal'
  // renders BracketRevealScreen which calls onContinue once the reveal completes
  // (or is skipped); the continue handler transitions to screen === 'tournament'.
  const [pendingBracketReveal, setPendingBracketReveal] = useState(null);
  // Dual-Meet state (Phase 1). Persisted to matgrind_dual; loaded on mount.
  // Ref-mirrored so saveMatchResult can look up the current bout + team at
  // match-end without closing over stale state.
  const [dualMeetState, setDualMeetStateRaw] = useState(null);
  const dualMeetRef = useRef(null);
  const setDualMeetState = (next) => {
    const value = typeof next === 'function' ? next(dualMeetRef.current) : next;
    dualMeetRef.current = value;
    setDualMeetStateRaw(value);
  };
  // Career Mode (Phase A). Active career is loaded on mount for authed users
  // and mirrored into a ref so the match-end path (in saveMatchResult's
  // closure) can advance the schedule without stale-state issues.
  const [activeCareer, setActiveCareerRaw] = useState(null);
  // Multi-career slot state. Loaded from profile on auth, refreshed when a
  // slot is chosen / cleared. Each entry: { slotId, careerId, lastPlayedAt }.
  // `careerSlotsLoaded` flips true after the first network fetch returns so
  // the slot picker can show a real loading state instead of flashing 3
  // empty placeholders while the user's existing career is still in flight.
  const [careerSlots, setCareerSlots] = useState([
    { slotId: 'slot1', careerId: null, lastPlayedAt: null },
    { slotId: 'slot2', careerId: null, lastPlayedAt: null },
    { slotId: 'slot3', careerId: null, lastPlayedAt: null },
  ]);
  const [careerSlotsLoaded, setCareerSlotsLoaded] = useState(false);
  // Phase-1 Task 9: surfaced when hydrateCareer throws CAREER_CORRUPT
  // (validation + auto-repair both failed). Shape: { kind: 'corrupt', errors }.
  // Renders a recoverable banner instead of letting the app crash / blank.
  const [careerLoadError, setCareerLoadError] = useState(null);
  // The slot the user is creating into when routed to the creation wizard.
  const pendingSlotIdRef = useRef(null);
  const activeCareerRef = useRef(null);
  const setActiveCareer = (next) => {
    const value = typeof next === 'function' ? next(activeCareerRef.current) : next;
    activeCareerRef.current = value;
    setActiveCareerRaw(value);
  };
  // Event the player is about to wrestle (or just wrestled) in career mode.
  // Survives the match so match-end can look up which event to mark complete.
  const [selectedCareerEvent, setSelectedCareerEvent] = useState(null);
  const selectedCareerEventRef = useRef(null);
  useEffect(() => { selectedCareerEventRef.current = selectedCareerEvent; }, [selectedCareerEvent]);
  // Where to return from the Decks screen. Career dashboard deep-links into
  // decks, so the back button needs to go back to the dashboard instead of
  // the main menu default.
  const decksReturnRef = useRef('menu');
  // Local 2P pass-device
  const [localTurn, setLocalTurn] = useState('p1'); // 'p1' | 'p2'
  const [showPassDevice, setShowPassDevice] = useState(false);
  // Network multiplayer
  const [networkPlayer, setNetworkPlayer] = useState(null);  // 'p1' | 'p2'
  useEffect(() => { networkPlayerRef.current = networkPlayer; }, [networkPlayer]);
  const [networkPickSent, setNetworkPickSent] = useState(false);
  // Server has acknowledged the most recent pick. Separate from `networkPickSent`
  // so the retry timer can tell "we tried to send" from "server got it".
  const [pickAcknowledged, setPickAcknowledged] = useState(false);
  // User-visible network error banner shown when a send fails unrecoverably.
  const [networkError, setNetworkError] = useState(null);
  // Transient informational notice for recoverable mid-match events (e.g.
  // a disconnect cancelled the active skill challenge to MISS but the
  // match continues). Distinct from networkError, which is reserved for
  // terminal connection failures and renders a Return-to-Menu prompt.
  // Auto-clears on next state_update advance OR after 5s, whichever comes
  // first, so it never lingers into a future round.
  const [networkNotice, setNetworkNotice] = useState(null);
  // Reaction phase driven by server challenge_prompt arrivals (online).
  // null = no active server-driven Reaction challenge.
  const [serverReactionPhase, setServerReactionPhase] = useState(null);
  // True between sending card_pick and receiving challenge_start (online,
  // skill-mechanic cards). Used to distinguish "preparing skill challenge"
  // from "waiting for opponent" in UI status.
  const [awaitingChallengeStart, setAwaitingChallengeStart] = useState(false);
  // True after the first state_update lands for an online match. Gates
  // the card picker so a click cannot fire `card_pick` with roundSeq=0
  // (which becomes null on the wire and produces a wrong_round error).
  // Reset to false at startNetworkGame online branch; flipped to true in
  // the state_update handler when roundSeq goes 0 -> >= 1.
  const [serverRoundReady, setServerRoundReady] = useState(false);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  // Rematch handshake state for online matches. Drives the buttons on
  // MatchResultModal: 'idle' shows REMATCH; 'requested_by_me' shows
  // "Waiting for opponent…"; 'requested_by_opponent' shows Accept / Decline;
  // 'declined' shows the "Opponent declined" caption then resets to idle.
  // Reset to 'idle' on every fresh game_start (new match or rematch start).
  const [rematchStatus, setRematchStatus] = useState('idle');
  // Pending "are you sure you want to leave?" confirmation for online matches.
  // Holds a callback to run when the user confirms. null = no prompt showing.
  const [leaveConfirmPending, setLeaveConfirmPending] = useState(null);
  // Resume-from-background modal. Shown when the player returns from a
  // backgrounded app (phone locked, home-swiped out, switched apps) with
  // a match still in progress. Prevents the "match frozen on return" bug
  // and gives the player a clean choice: resume or forfeit.
  const [showResumeModal, setShowResumeModal] = useState(false);
  const pausedMidMatchRef = useRef(false);
  // Mirror of attemptLeaveMatch (declared much later in the file). Effects
  // earlier in the component can call .current?.(...) without putting the
  // function in their deps (TDZ-safe). Kept in sync via the useEffect below
  // the attemptLeaveMatch declaration.
  const attemptLeaveMatchRef = useRef(null);
  const networkClientRef = useRef(null);
  const networkModeRef = useRef('lan'); // 'lan' | 'online'
  const matchStateRef = useRef(null);
  const playSoundRef = useRef(playSound);

  // Move timer - 30 second countdown per turn
  const [moveTimer, setMoveTimer] = useState(MOVE_TIMER_DEFAULT);
  const moveTimerRef = useRef(null);

  // Network safety-net timers: if a pick message gets lost (socket mid-
  // reconnect, server packet drop, etc.) the match can hang at "Waiting for
  // opponent" forever. These two timers retry our pick and, as a last resort,
  // force an auto-pick so the round always advances.
  //
  //   lastNetworkPickRef - records the most recent {cardId, skillResult}
  //     we've sent this round so we can silently resend if needed.
  //   networkPickRetryRef - 18s post-pick retry timer.
  //   networkRoundMaxRef - 30s absolute round cap (auto-pick if no pick yet).
  const lastNetworkPickRef = useRef(null);
  const networkPickRetryRef = useRef(null);
  const networkPickForceReconnectRef = useRef(null);
  const networkPickHardFailRef = useRef(null);
  // Audit repair #18: post-ack stall watchdog. The 4/8/18s ladder above
  // cancels on pickAcknowledged=true, so a lost round_picks frame
  // produces a silent hang. This timer fires when ack arrived but
  // resolution didn't, converting the hang into a visible error.
  const networkAckStallRef = useRef(null);
  // Authoritative-online protocol: server sends roundSeq with every
  // state_update; clients echo it back on every game intent so the server
  // can reject stale picks (`error { code: 'wrong_round' }`).
  const currentRoundSeqRef = useRef(0);
  // Server-supplied per-card challenge params (received with state_update).
  // Client renders the mini-game from these; reaction's params are stripped
  // server-side (kept secret).
  const preGeneratedChallengesRef = useRef({});
  // Active server-issued challenge (set on challenge_start, cleared on
  // challenge_resolved). Used to route input events back to the server.
  const activeChallengeRef = useRef(null);
  // Card the local user just picked (online mode). Stashed on send so the
  // challenge_start handler can render the mini-game without re-finding
  // the card from the (now potentially-stale) hand.
  const lastPickedCardRef = useRef(null);
  // Synchronous mirrors of p1Hand / p2Hand for the network message
  // handler. React state setters are async, so a state_update -> set
  // hand -> challenge_start flow that arrives in close succession can
  // run challenge_start with the prior render's hand still in the
  // closure. Refs are updated synchronously inside the state_update
  // handler so the fallback hand-lookup always sees the current hand.
  const p1HandRef = useRef([]);
  const p2HandRef = useRef([]);
  // (pendingRoundPicksRef removed: round_picks no longer exists in the
  // authoritative protocol; state_update is the only state-change message.)
  /** @type {{current: ((msg: any) => void) | null}} Stable handle to handleNetworkMessage for replay. */
  const handleNetworkMessageRef = useRef(null);
  const networkRoundMaxRef = useRef(null);

  const resolveTimer = useRef(null);
  const aiTimer = useRef(null);
  const periodTimer = useRef(null);
  const pinTimer = useRef(null);
  const matchSavedRef = useRef(false);
  // Stage 4: matchIds whose authoritative match_settled receipt has already been
  // applied, so a duplicate/late push (or a fallback read racing the push) can't
  // double-apply trusted online progression to the UI.
  const onlineSettledRef = useRef(new Set());
  // Bug 7: track whether p1 was ever trailing during the match (for accurate comeback bonus)
  const wasTrailingRef = useRef(false);
  // Track the maximum deficit (opp - human score) during the match. Drives
  // the "Never Say Die" achievement which awards on a comeback from 6+ down.
  // Without tracking this we can't tell, from final scores alone, whether
  // the player was ever significantly behind. Reset alongside wasTrailingRef.
  const maxDeficitRef = useRef(0);
  // Per-period score tracking for the human side. The match log doesn't
  // carry numeric deltas, so we watch matchState in a useEffect below and
  // accumulate per-period totals via score-delta detection. Reset whenever
  // a new match starts (matchSavedRef path resets this too via clear in start handlers).
  const humanMaxPeriodPointsRef = useRef(0);
  const humanCurrentPeriodPointsRef = useRef(0);
  const lastHumanScoreRef = useRef(0);
  const lastPeriodRef = useRef(1);
  // Replay recording
  const replayRef = useRef(null);
  const [activeReplay, setActiveReplay] = useState(null); // for viewing a saved replay
  // Screen to return to when the replay viewer closes. Set when opening the
  // viewer mid-match (e.g. from a dual bout-result modal) so the close button
  // takes the user back to where they were instead of the replay library.
  const [replayReturnScreen, setReplayReturnScreen] = useState(null);

  // Invite deep-link handler. Register once; pending codes are drained
  // by the effect below once auth resolves.
  useEffect(() => {
    let cleanup = () => {};
    (async () => {
      const { registerNativeInviteListener, setPendingInvite, getPendingCodeFromUrl, clearInvitePath } = await import('../lib/deepLink.js');
      const urlCode = getPendingCodeFromUrl();
      if (urlCode) { setPendingInvite(urlCode); clearInvitePath(); }
      cleanup = await registerNativeInviteListener((code) => { setPendingInvite(code); });
    })();
    return () => { try { cleanup(); } catch { /* ignore */ } };
  }, []);

  // Drain pending invite once the user is signed in.
  useEffect(() => {
    if (!user?.uid) return;
    (async () => {
      const { popPendingInvite } = await import('../lib/deepLink.js');
      const code = popPendingInvite();
      if (!code) return;
      try {
        const { consumeInvite } = await import('../lib/invites.js');
        const outcome = await consumeInvite(code, user.uid);
        const { toast } = await import('@/components/ui/use-toast');
        const copy = {
          sent: { title: 'Friend request sent!', description: 'They\'ll see it in their Friends tab.' },
          already_friends: { title: 'Already friends', description: 'You\'re already on this wrestler\'s list.' },
          already_pending_out: { title: 'Already invited', description: 'Your request is still pending.' },
          already_pending_in: { title: 'They invited you first', description: 'Open Friends → Requests to accept.' },
          self: { title: 'That\'s your own invite', description: 'Share it with a friend instead!' },
          not_found: { title: 'Invite not found', description: 'The code may have expired or been revoked.' },
          expired: { title: 'Invite expired', description: 'Ask your friend for a fresh link.' },
          revoked: { title: 'Invite revoked', description: 'Ask your friend for a fresh link.' },
        }[outcome] || { title: 'Couldn\'t apply invite', description: outcome };
        toast({ ...copy });
      } catch (e) {
        console.warn('[invite] consume failed', e);
      }
    })();
  }, [user?.uid]);

  // Load active career (Phase A) on auth change. Uses the local mirror as
  // an optimistic first paint, then overwrites with Firestore. Guest mode
  // falls back to local-only so a sign-out doesn't wipe a mid-season save.
  useEffect(() => {
    if (user?.uid) {
      // Multi-slot: load slot list once on auth so the slot picker has data.
      // setCareerSlotsLoaded flips true after the fetch resolves so the
      // picker shows a Loading state until then (instead of flashing all
      // empty cards while the network call is in flight).
      //
      // Also sweep stale retired careers out of slots. Old retire flow
      // (pre-fix) left retired careers pinned to their slots, blocking the
      // user from starting a fresh career or restoring a different one.
      // The sweep runs once at load: any slot pointing to a phase=retired
      // career gets cleared so it shows as empty + the career moves into
      // the orphan list (where Restore Previous Career picks it up).
      getCareerSlots(user.uid)
        .then(async s => {
          let working = s;
          try {
            const updates = [];
            for (const slot of s) {
              if (!slot.careerId) continue;
              const c = await getCareerForSlot(user.uid, slot);
              if (c?.phase === 'retired') updates.push(slot.slotId);
            }
            if (updates.length > 0) {
              for (const slotId of updates) {
                await clearSlot(user.uid, slotId).catch(() => {});
              }
              working = await getCareerSlots(user.uid);
            }
          } catch (_e) { /* best-effort sweep */ }
          setCareerSlots(working);
          setCareerSlotsLoaded(true);
        })
        .catch(() => { setCareerSlotsLoaded(true); });
      const local = loadLocalCareer(user.uid);
      // hydrateCareer is a no-op on fresh / already-Phase-B careers and
      // backfills the Phase-B shape (unlockedCardIds, skillTree, xp, rankings)
      // on legacy careers. It also flags legacy careers so the dashboard
      // can show a one-time "Phase B unlocked" toast.
      // Task 9: catch CAREER_CORRUPT (validation+repair both failed) and
      // surface a recoverable banner via careerLoadError instead of crashing.
      if (local) {
        try {
          const localHydrated = hydrateCareer(local);
          setActiveCareer(localHydrated);
          // Persist if hydrate self-healed something (women's pool repair,
          // weight-class snap, etc.) - flag is stripped server-side so the
          // payload stays clean.
          if (localHydrated?._needsResave) {
            saveCareer(user.uid, localHydrated).catch(err =>
              console.warn('[loadCareer:local] post-heal save failed:', err?.message)
            );
          }
        } catch (e) {
          if (e?.code === 'CAREER_CORRUPT') {
            console.error('[loadCareer:local] career corrupt, errors:', e.errors);
            setCareerLoadError({ kind: 'corrupt', errors: e.errors });
          } else {
            throw e;
          }
        }
      }
      getActiveCareer(user.uid).then(c => {
        if (c) {
          let hydrated;
          try {
            hydrated = hydrateCareer(c);
          } catch (e) {
            if (e?.code === 'CAREER_CORRUPT') {
              console.error('[loadCareer:remote] career corrupt, errors:', e.errors);
              setCareerLoadError({ kind: 'corrupt', errors: e.errors });
              return;
            }
            throw e;
          }
          setActiveCareer(hydrated);
          // Same post-heal save for the remote-load path.
          if (hydrated?._needsResave) {
            saveCareer(user.uid, hydrated).catch(err =>
              console.warn('[loadCareer:remote] post-heal save failed:', err?.message)
            );
          }
          // Feature 9: if the player force-closed mid-tournament, restore
          // the bracket state and route them to the next match. Snapshot
          // includes the full seeded field + per-match RNG seeds, so the
          // resumed match plays out identically to the abandoned one.
          // No toast banner - the bracket screen itself is enough context.
          //
          // 2026-05-01: cross-check the snapshot's careerEventId against
          // the hydrated career's current schedule. A snapshot whose event
          // is no longer in the schedule (e.g., season was advanced and
          // the event was pruned, or schedule rebuilt mid-version) would
          // route the user to a tournament screen pointing at nothing
          // and leave them stuck on a loading screen. Drop those.
          if (hydrated?.id) {
            loadCareerTournament(user.uid, hydrated.id).then(snap => {
              if (!isTournamentSnapshotResumable(hydrated, snap)) {
                if (snap) {
                  console.warn('[career] tournament snapshot not resumable, clearing', {
                    careerPhase: hydrated.phase,
                    snapPhase: snap.phase,
                    playerEliminated: snap.playerEliminated,
                    careerEventId: snap.careerEventId,
                  });
                  clearCareerTournament(user.uid, hydrated.id);
                }
                return;
              }
              setTournamentState(snap);
              setScreen('tournament');
            }).catch(() => {});
          }
          // Career dual-meet resume. Mirrors the tournament resume guard above:
          // if a career-dual snapshot is in localStorage and the five
          // resumability checks pass, restore the dual snapshot and route to
          // the right phase. Otherwise drop the snapshot so the user lands on
          // the dashboard cleanly. The match itself (if there was one mid-bout)
          // will be picked up by the saveMatchToStorage restore effect.
          try {
            const careerDual = loadCareerDual();
            if (careerDual) {
              if (isCareerDualMeetSnapshotResumable(hydrated, careerDual)) {
                setDualMeetState(careerDual);
                if (careerDual.phase === 'between') {
                  setScreen('career_dual_meet');
                } else if (careerDual.phase === 'bout') {
                  // The mount-time match restore effect will route to 'game'
                  // if a saved match exists; otherwise we sit on the dual
                  // scoreboard so the player can advance manually.
                  setScreen('career_dual_meet');
                }
              } else {
                clearCareerDual();
              }
            }
          } catch (_e) { /* localStorage disabled */ }
        }
      }).catch(err => {
        console.warn('[career] load failed:', err?.message);
      });
    } else {
      setActiveCareer(null);
    }
  }, [user?.uid, setScreen]);

  // 2026-05-01 - Proactive stale tournament-cache sweep.
  // Every time the active career changes (user picks a slot, tier
  // transitions, etc.) we re-evaluate any localStorage tournament
  // snapshot for that career and clear it if the careerEventId no
  // longer maps to an upcoming event on the live schedule. Without
  // this, a snapshot lingering in localStorage keeps re-resuming on
  // each load and traps the user on the bracket -> match -> stuck-loading
  // path. The cloud snapshot has the same TTL guard already; this is
  // the local-cache equivalent that fires whenever the active career
  // identity changes, not just on first auth.
  useEffect(() => {
    const uid = user?.uid;
    const career = activeCareer;
    if (!uid || !career?.id) return;
    loadCareerTournament(uid, career.id).then(snap => {
      if (!snap) return;
      // Reuse the same predicate as the resume hook.
      if (!isTournamentSnapshotResumable(career, snap)) {
        console.warn('[stale-cache] clearing non-resumable tournament snapshot', {
          careerPhase: career.phase,
          snapPhase: snap.phase,
          playerEliminated: snap.playerEliminated,
          careerEventId: snap.careerEventId,
        });
        clearCareerTournament(uid, career.id);
      }
    }).catch(() => { /* offline / no snapshot */ });
  }, [user?.uid, activeCareer]);

  // 2026-05-01 - Server-triggered local-cache reset.
  // If profile.forceClientResetAt is greater than the device's
  // last-applied reset timestamp for this user, wipe transient
  // match-state keys (same set as the one-time boot cleanup). Lets us
  // unstick any future Mason-style user via a one-line admin-script run
  // (scripts/force-client-reset.mjs). Reads getProfile already called
  // by the wrestlerProfile loader below, but does the read itself here
  // so the cleanup applies BEFORE any career load that depends on
  // localStorage. Per-uid local-flag prevents repeated cleanups for the
  // same server reset.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    getProfile(uid).then(p => {
      const serverTs = Number(p?.forceClientResetAt) || 0;
      if (!serverTs) return;
      const result = runServerTriggeredReset({ uid, serverTs });
      if (result.ranNow) {
        console.log('[cleanup] server-triggered reset applied', {
          serverTs,
          cleared: result.keysCleared,
        });
      }
    }).catch(() => { /* silent - reset is best-effort */ });
  }, [user?.uid]);

  // Load wrestler profile on auth change + init native notifications
  useEffect(() => {
    if (user?.uid) {
      getProfile(user.uid).then(p => setWrestlerProfile(p)).catch(() => {});
    } else {
      // Guest mode: restore profile from localStorage so stats persist across matches
      try {
        const saved = localStorage.getItem('matgrind_guest_profile');
        setWrestlerProfile(saved ? JSON.parse(saved) : null);
      } catch (_e) {
        setWrestlerProfile(null);
      }
    }
    // Notification permission prompt is intentionally deferred - asking on
    // cold launch (before the user has even seen the menu) is the most
    // common reason iOS users tap "Don't Allow." We now request it after
    // their first finished match (see `cancelStreakReminder()` site below),
    // which is a meaningful engagement signal.
    // Badge clear is permission-free on iOS and a silent no-op if not
    // granted, so it stays here.
    updateBadge(0);
  }, [user?.uid]);

  useEffect(() => () => {
    clearTimeout(resolveTimer.current);
    clearTimeout(aiTimer.current);
    clearTimeout(periodTimer.current);
    clearTimeout(pinTimer.current);
    clearInterval(moveTimerRef.current);
    networkClientRef.current?.disconnect();
  }, []);

  // Keep refs in sync for network message handler closures
  useEffect(() => {
    matchStateRef.current = matchState;
  }, [matchState]);
  playSoundRef.current = playSound;
  // Stable handles for the tab-bar handler (registered once, but needs to
  // see the latest wrestler name and the freshest startGame closure when
  // the Play tab fires a Quick Match).
  const wrestlerProfileRef = useRef(wrestlerProfile);
  useEffect(() => { wrestlerProfileRef.current = wrestlerProfile; }, [wrestlerProfile]);

  // Phase 3 - resolve the local user's active deck → Set<cardId>. The
  // Set is stable across re-renders until decks/activeDeckId actually
  // change. If no active deck (or deck is missing/invalid), we hold null
  // and `handFor` falls through to the legacy full-pool hand draw.
  useEffect(() => {
    const activeId = wrestlerProfile?.activeDeckId;
    const decks = wrestlerProfile?.decks;
    if (!activeId || !Array.isArray(decks)) {
      userDeckCardIdsRef.current = null;
      return;
    }
    const deck = decks.find(d => d && d.id === activeId);
    if (!deck || !Array.isArray(deck.cards) || deck.cards.length === 0) {
      userDeckCardIdsRef.current = null;
      return;
    }
    userDeckCardIdsRef.current = new Set(deck.cards);
  }, [wrestlerProfile?.activeDeckId, wrestlerProfile?.decks]);

  // Per-player hand builder. Applies the deck filter only to the side the
  // local user controls; the opponent's hand is always drawn from the
  // full pool. In network mode the server actually issues the opponent's
  // hand so this path is local-only anyway.
  //
  // Career mode adds a second filter: intersect the deck with the
  // wrestler's unlockedCardIds so a stale deck can't leak locked cards
  // into the hand. If no deck is active, fall back to the career
  // unlocked card set directly (starter deck + skill-tree unlocks).
  const handFor = useCallback((player, position, conditions, style = 'folkstyle') => {
    const isLocalUser = (
      (isAIMode(gameMode) && humanPlayerRef.current === player) ||
      (gameMode === 'network' && networkPlayerRef.current === player) ||
      // Local 2P - both players share the device but only the signed-in
      // user has a deck. Apply the deck to whichever side the user is
      // playing right now (humanPlayerRef tracks this; defaults 'p1').
      (gameMode === 'local' && humanPlayerRef.current === player)
    );
    let allowed = isLocalUser ? userDeckCardIdsRef.current : null;
    if (gameMode === 'career' && isLocalUser) {
      const career = activeCareerRef.current;
      const careerUnlocks = career?.wrestler?.unlockedCardIds;
      if (Array.isArray(careerUnlocks) && careerUnlocks.length > 0) {
        const careerSet = new Set(careerUnlocks);
        allowed = allowed
          ? new Set([...allowed].filter(id => careerSet.has(id)))
          : careerSet;
      }
    }
    return getHand(position, conditions, style, allowed);
  }, [gameMode]);

  // Refs mirroring handFor + gameMode so the AI period-choice / pin-attempt
  // effects can read current values without listing them in deps. Adding
  // them directly would re-arm the AI setTimeout chain on every dep change,
  // leaving the AI deadlocked mid-decision.
  const handForRef = useRef(handFor);
  useEffect(() => { handForRef.current = handFor; }, [handFor]);
  const gameModeRef = useRef(null);
  useEffect(() => { gameModeRef.current = gameMode; }, [gameMode]);

  // Reroll wrapper - same deck-filter resolution as handFor, but redraws
  // through the engine's rerollHand (carry-over constraint).
  const rerollFor = useCallback((player, prevHand, position, conditions, style = 'folkstyle') => {
    const isLocalUser = (
      (isAIMode(gameMode) && humanPlayerRef.current === player) ||
      (gameMode === 'network' && networkPlayerRef.current === player) ||
      (gameMode === 'local' && humanPlayerRef.current === player)
    );
    let allowed = isLocalUser ? userDeckCardIdsRef.current : null;
    if (gameMode === 'career' && isLocalUser) {
      const career = activeCareerRef.current;
      const careerUnlocks = career?.wrestler?.unlockedCardIds;
      if (Array.isArray(careerUnlocks) && careerUnlocks.length > 0) {
        const careerSet = new Set(careerUnlocks);
        allowed = allowed
          ? new Set([...allowed].filter(id => careerSet.has(id)))
          : careerSet;
      }
    }
    return getRerollHand(prevHand, position, conditions, style, allowed);
  }, [gameMode]);

  // Reroll handler - invoked by the picker's reroll chip. Validates the
  // budget, decrements `rerollsLeft`, redraws the hand. In online mode
  // the server is authoritative: send `request_reroll` and wait for
  // `reroll_granted` before mutating local state. The optimistic local
  // path is used for vs-AI / career / dual / LAN.
  const handleReroll = useCallback((side) => {
    const match = matchStateRef.current;
    if (!match) return;
    if (match.phase !== 'playing' && match.phase !== 'overtime') return;
    if (side === 'p1' && p1Selected) return;
    if (side === 'p2' && p2Selected) return;
    if (resolving) return;
    const left = match.rerollsLeft?.[side] ?? 0;
    if (left <= 0) return;

    if (gameMode === 'network' && networkModeRef.current === 'online') {
      // Server-authoritative - wait for reroll_granted before redrawing.
      try { networkClientRef.current?.sendRerollRequest?.(currentRoundSeqRef.current || null); } catch { /* noop */ }
      return;
    }

    // Local path - vs AI, career, dual, LAN. Decrement + redraw immediately.
    const prevHand = side === 'p1' ? p1Hand : p2Hand;
    const wrestler = match[side];
    const conditions = match[`${side}Conditions`] || [];
    const newHand = rerollFor(side, prevHand, wrestler.position, conditions, match.wrestlingStyle);
    const next = {
      ...match,
      rerollsLeft: {
        ...match.rerollsLeft,
        [side]: left - 1,
      },
    };
    setMatchState(next);
    matchStateRef.current = next;
    if (side === 'p1') setP1Hand(newHand);
    else setP2Hand(newHand);
  }, [gameMode, p1Hand, p2Hand, p1Selected, p2Selected, resolving, rerollFor]);

  // ── Background matchmaking queue handoff ───────────────────────────
  // GlobalQueueOverlay (rendered from App.jsx) owns the pill + modal UI
  // and emits a 'matgrind:queue-accept' custom event when the user joins.
  // We consume the buffered match payload and forward it into the
  // existing startNetworkGame machinery.
  // Mark the queue as "interrupt-hostile" when the user is in a state
  // where swapping out to an online match would blow up in-flight work:
  // a live vs-AI bout, a tournament run, or a dual-meet bout. The modal
  // uses this to show the 15s countdown / explicit-choice flavour.
  useEffect(() => {
    const isLiveMatch = screen === 'game' && !!matchState;
    const isTournamentContext = screen === 'tournament' || gameMode === 'tournament';
    const isDualContext = screen === 'dual_scoreboard' || screen === 'dual_result'
      || screen === 'career_dual_meet' || screen === 'career_dual_meet_setup'
      || screen === 'career_dual_meet_result'
      || isAnyDualMode(gameMode);
    setInterruptHostile(isLiveMatch || isTournamentContext || isDualContext);
  }, [screen, matchState, gameMode]);

  useEffect(() => {
    const onAccept = (e) => {
      // Always call consumeMatch so we receive the post-game_start
      // bufferedMessages (state_update / challenge_start that arrived
      // while the user was deciding to accept). The event detail carries
      // the original payload but NOT the buffered messages - consumeMatch
      // is the only path that surfaces them. If consumeMatch has already
      // run (rare race), fall back to the event detail.
      const consumed = consumeMatch();
      const payload = consumed || e?.detail?.payload;
      if (!payload) return;
      // If we used the event detail (consumeMatch returned null), there
      // are no buffered messages by definition - keep the contract clean.
      if (!consumed && payload && !payload.bufferedMessages) {
        payload.bufferedMessages = [];
      }
      try {
        logEvent('queue_matched', {
          wrestling_style: payload.style,
        });
      } catch { /* noop */ }
      // Nuke anything in-flight (vs-AI match, timers) before loading the
      // online match so their state machines don't overlap.
      matchSavedRef.current = true; // skip save-on-unmount for abandoned AI match
      [resolveTimer, aiTimer, periodTimer, pinTimer].forEach((r) => clearTimeout(r.current));
      clearMatchFromStorage();
      startNetworkGameRef.current?.(payload);
    };
    window.addEventListener('matgrind:queue-accept', onAccept);
    return () => window.removeEventListener('matgrind:queue-accept', onAccept);
  }, []);

  const startGameRef = useRef(null);
  // Prevents the hashchange listener from firing when setScreen itself clears
  // or changes the hash. Without this, navigating from a hash-linked screen
  // (profile → hash="#profile") to a non-hash screen (progress → hash="")
  // fires hashchange which maps "" → "menu", clobbering the intended screen.
  const suppressNextHashChange = useRef(false);

  // Hash-based routing: sync screen with browser back/forward
  useEffect(() => {
    const onHash = () => {
      if (suppressNextHashChange.current) {
        suppressNextHashChange.current = false;
        return;
      }
      const s = getScreenFromHash();
      setScreenRaw(s);
      setAuthIntent(getAuthIntentFromHash());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // ── v2.0 Tab-bar sync ──────────────────────────────────────────────────────
  // WrestlingGame still owns the legacy `screen` state (15 branches below).
  // The TabStateProvider (in App.jsx) owns the tab-bar state. We bridge the
  // two here so the persistent <AppShell><TabBar/></AppShell> always shows the
  // correct active tab and gets routed back to a legacy setScreen(...) call
  // whenever the user taps a different tab.

  // 1. Keep `activeTab` in sync with the current screen so the bar highlights
  //    the right icon as the app navigates. Derivation rules:
  //      - 'game' + live match → Play
  //      - 'profile'            → Profile
  //      - 'leaderboard'        → Profile (the shortcut lives on Profile now;
  //                               the Progress tab was retired in 1.2.5)
  //      - 'modes'              → Modes
  //      - everything else      → Home (menu, tutorial, tournament, replays,
  //                               settings, legal pages, create_wrestler,
  //                               network_lobby - they all live under Home)
  // Only matchState.phase is read; full matchState would re-fire on every match update.
  useEffect(() => {
    let t = 'home';
    const matchActive = screen === 'game' && matchState && matchState.phase !== 'finished';
    if (matchActive) t = 'play';
    else if (screen === 'profile' || screen === 'leaderboard') t = 'profile';
    else if (screen === 'modes' || screen === 'tournament_setup') t = 'modes';
    else if (screen === 'friends') t = 'friends';
    setActiveTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, matchState?.phase, setActiveTab]);

  // Most recent gameplay-mode screen the user was on. The Play tab uses
  // this to resume the user back into the right hub (career dashboard,
  // tournament bracket, dual scoreboard, network lobby) instead of always
  // booting them into a Quick Match.
  //
  // Lives in a ref (in-memory only) so a full reload resets it - that
  // matches the user's mental model: "if I close and reopen the app I
  // expect a fresh start." Visiting Home/Training/Profile does NOT clear
  // the context - only being in a different game mode does.
  const lastPlayScreenRef = useRef(null);

  useEffect(() => {
    const playScreens = new Set([
      'career_dashboard', 'career_event_preview', 'career_creation',
      'tournament', 'tournament_history',
      'dual_setup', 'dual_scoreboard', 'dual_result',
      'network_lobby',
    ]);
    if (playScreens.has(screen)) {
      lastPlayScreenRef.current = screen;
    }
  }, [screen]);

  // 2. Hide the TabBar during focus-mode flows. The bar would be visually
  //    distracting (and eat thumb-zone pixels) during an active match, while
  //    onboarding a wrestler, during network handshake, and inside replay
  //    playback. Phase 3 will add `pin_attempt`; Phase 4 will add active
  //    drill rounds.
  // Only matchState.phase is read; full matchState would re-fire on every match update.
  useEffect(() => {
    const matchActive = screen === 'game' && matchState && matchState.phase !== 'finished';
    const focus = matchActive
      || screen === 'create_wrestler'
      || screen === 'network_lobby'
      || screen === 'replay';
    setHideTabBar(!!focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, matchState?.phase, setHideTabBar]);

  // 3. Route tab-bar taps back to legacy setScreen calls. Using a ref to read
  //    the latest matchState inside the handler avoids re-registering every
  //    time matchState updates mid-match.
  useEffect(() => {
    const unregister = registerTabHandler((tabId) => {
      const currentMatch = matchStateRef.current;
      const matchActive = currentMatch && currentMatch.phase !== 'finished';
      if (tabId === 'home') attemptLeaveMatch(() => setScreen('menu'));
      else if (tabId === 'play') {
        // Active match → resume it. Highest priority - never strand the
        // user on a hub screen when they have a match in progress.
        if (matchActive) {
          setScreen('game');
          return;
        }
        // Otherwise return to the most recent gameplay context (career
        // dashboard, tournament bracket, dual meet, network lobby) so an
        // accidental tap-out doesn't force the long way back in. Each
        // branch verifies the underlying state still exists; if it
        // doesn't (career retired, dual cleared, etc.) we fall through
        // to the Quick Match default.
        const lastPlay = lastPlayScreenRef.current;
        if (lastPlay === 'career_dashboard' || lastPlay === 'career_event_preview' || lastPlay === 'career_creation') {
          if (activeCareerRef.current) {
            setScreen('career_dashboard');
            return;
          }
        }
        if (lastPlay === 'tournament' || lastPlay === 'tournament_history') {
          if (tournamentStateRef.current) {
            setScreen('tournament');
            return;
          }
        }
        if (lastPlay === 'dual_setup' || lastPlay === 'dual_scoreboard' || lastPlay === 'dual_result') {
          if (dualMeetRef.current) {
            // Setup screen if no bouts have started yet, otherwise the
            // scoreboard - restoring the screen the user was actually on.
            const hasStarted = !!dualMeetRef.current.bouts?.length;
            setScreen(hasStarted ? 'dual_scoreboard' : 'dual_setup');
            return;
          }
        }
        if (lastPlay === 'network_lobby') {
          setScreen('network_lobby');
          return;
        }
        // Default: Quick Match against AI using the user's saved defaults.
        const style = localStorage.getItem('matgrind_default_style') || 'folkstyle';
        const difficulty = localStorage.getItem('matgrind_default_difficulty') || 'medium';
        const p1Name = wrestlerProfileRef.current?.name || 'You';
        // Use ref to grab the freshest startGame closure (the once-registered
        // tab handler would otherwise capture the very first render's copy).
        startGameRef.current?.('vs_ai', { p1: p1Name, p2: 'CPU Opponent' }, style, 'green', difficulty);
      }
      else if (tabId === 'friends') attemptLeaveMatchRef.current?.(() => setScreen('friends'));
      else if (tabId === 'modes') attemptLeaveMatchRef.current?.(() => setScreen('modes'));
      else if (tabId === 'profile') attemptLeaveMatchRef.current?.(() => setScreen('profile'));
    });
    return unregister;
    // attemptLeaveMatch read via ref to avoid TDZ - the function is declared
    // later in the file and can't be added to deps directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerTabHandler, setScreen]);

  // Keyboard escape to return to menu (web)
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape' && screen !== 'menu') attemptLeaveMatchRef.current?.(() => setScreen('menu'));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // attemptLeaveMatch read via ref to avoid TDZ - the function is declared
    // later in the file and can't be added to deps directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, setScreen]);

  // Android hardware back button handler (Capacitor)
  useEffect(() => {
    let listener;
    const cap = /** @type {any} */ (window)?.Capacitor;
    if (!cap?.isNativePlatform?.()) return;

    const setup = async () => {
      try {
        const plugins = cap.Plugins;
        if (plugins?.App) {
          listener = await plugins.App.addListener('backButton', () => {
            if (screen !== 'menu') {
              attemptLeaveMatchRef.current?.(() => setScreen('menu'));
            }
          });
        }
      } catch (e) {
        // Capacitor not available - ignore
      }
    };
    setup().catch(() => {});
    return () => { listener?.remove(); };
    // attemptLeaveMatch read via ref to avoid TDZ - the function is declared
    // later in the file and can't be added to deps directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, setScreen]);

  // App pause/resume lifecycle.
  //
  // Two transports for the same underlying signal:
  //   1. Capacitor App pause/resume - fires on iOS when the app is
  //      backgrounded (home swipe, lock screen, switcher). Preferred
  //      on device because it's delivered even when the WKWebView has
  //      thrown away its JS timers.
  //   2. Web `visibilitychange` - fallback for browser / TestFlight web
  //      view during dev. Capacitor fires pause/resume, but the web
  //      listener also fires on tab switch, which is the same UX
  //      problem (stuck match on return).
  //
  // On pause with an active match we flip `pausedMidMatchRef` so the
  // resume path can distinguish "user left mid-match and came back"
  // (show the resume/forfeit modal) from "app just launched and
  // backgrounded for half a second" (do nothing).
  useEffect(() => {
    const markPausedIfInMatch = () => {
      const match = matchStateRef.current;
      const inMatch = screen === 'game' && match && match.phase !== 'finished';
      if (inMatch) pausedMidMatchRef.current = true;
      clearInterval(moveTimerRef.current);
      // Same lifecycle event also affects the matchmaking queue (independent
      // of whether we're mid-match). queueManager records the timestamp so
      // resume can decide whether to keep or drop the queue based on the 60s
      // background tolerance.
      queueHandleAppPause();
    };
    const handleResume = () => {
      updateBadge(0);
      const match = matchStateRef.current;
      const inMatch = screen === 'game' && match && match.phase !== 'finished';
      if (pausedMidMatchRef.current && inMatch) {
        setShowResumeModal(true);
      }
      pausedMidMatchRef.current = false;
      queueHandleAppResume();
    };

    // ── Web fallback: document.visibilitychange ─────────────────────
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') markPausedIfInMatch();
      else if (document.visibilityState === 'visible') handleResume();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // ── Native: Capacitor App.pause / App.resume ────────────────────
    const cap = /** @type {any} */ (window)?.Capacitor;
    let pauseListener, resumeListener;
    if (cap?.isNativePlatform?.()) {
      const setup = async () => {
        try {
          const plugins = cap.Plugins;
          if (plugins?.App) {
            pauseListener  = await plugins.App.addListener('pause',  markPausedIfInMatch);
            resumeListener = await plugins.App.addListener('resume', handleResume);
          }
        } catch (e) {}
      };
      setup().catch(() => {});
    }
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      pauseListener?.remove();
      resumeListener?.remove();
    };
  }, [screen]);

  // Orientation lock & status bar styling (Capacitor)
  useEffect(() => {
    const cap = /** @type {any} */ (window)?.Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const setup = async () => {
      try {
        const plugins = cap.Plugins;
        if (plugins?.ScreenOrientation) {
          plugins.ScreenOrientation.lock({ orientation: 'portrait' });
        }
        if (plugins?.StatusBar) {
          plugins.StatusBar.setStyle({ style: 'DARK' });
          plugins.StatusBar.setBackgroundColor({ color: '#09090b' });
        }
      } catch (e) {}
    };
    setup().catch(() => {});
  }, []);

  // ── Move timer: 30-second countdown per turn ────────────────────────────
  // Reset timer whenever a new hand is dealt
  // Timer resets when the human's hand changes
  const humanHand = humanPlayer === 'p1' ? p1Hand : p2Hand;
  const humanPick = humanPlayer === 'p1' ? p1Selected : p2Selected;
  const setHumanPick = humanPlayer === 'p1' ? setP1Selected : setP2Selected;

  useEffect(() => {
    if (humanHand.length > 0) setMoveTimer(MOVE_TIMER_DEFAULT);
  }, [humanHand]);

  const timerPaused = resolving || !matchState || matchState.phase !== 'playing' || !!humanPick || matchState.pinAttempt;
  useEffect(() => {
    clearInterval(moveTimerRef.current);
    if (timerPaused || screen !== 'game') return;
    moveTimerRef.current = setInterval(() => {
      setMoveTimer(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(moveTimerRef.current);
  }, [timerPaused, screen]);

  // Network-only helper: record the pick and send it. Having the pick in a
  // ref lets the retry timer resend the exact same payload without fishing
  // it back out of component state.
  const sendNetworkPick = useCallback((cardId, skillResult = null) => {
    if (!networkClientRef.current) return false;
    // Online: tag with server-issued roundSeq so the server can reject
    // stale picks. LAN: roundSeq is ignored (LAN keeps the relay model).
    // Defense-in-depth: refuse to send when the first state_update hasn't
    // landed yet. The historical bug here was `0 || null` -> null on the
    // wire -> server rejects with wrong_round on EVERY first move and the
    // user is stuck. Better to fail loudly here than silently mis-send.
    if (networkModeRef.current === 'online' && (currentRoundSeqRef.current || 0) < 1) {
      console.warn('[NET SEND] refusing card_pick before first state_update', {
        cardId, currentRoundSeq: currentRoundSeqRef.current,
      });
      return false;
    }
    const roundSeq = currentRoundSeqRef.current || null;
    lastNetworkPickRef.current = { cardId, skillResult, roundSeq };
    const ok = networkClientRef.current.sendCardPick(cardId, skillResult, roundSeq);
    try {
      const wsState = networkClientRef.current?.ws?.readyState;
      console.log('[NET SEND] card_pick', {
        cardId,
        skillTier: skillResult?.tier || null,
        roundSeq,
        wsState,
        mode: networkModeRef.current,
        ok,
      });
    } catch { /* best-effort logging */ }
    if (!ok) {
      setNetworkError('Connection lost. Return to menu and try again.');
    }
    return ok;
  }, []);

  const handleTimerExpiry = useCallback(() => {
    // Auto-select a random low-cost card when time runs out
    if (humanPick || resolving || !humanHand.length) return;
    haptic.warning();
    const sorted = [...humanHand].sort((a, b) => a.staminaCost - b.staminaCost);
    // Pick from the 3 cheapest cards randomly to avoid always picking the same card
    const cheapPool = sorted.slice(0, Math.min(3, sorted.length));
    const pick = cheapPool[Math.floor(Math.random() * cheapPool.length)];
    setHumanPick(pick);
    playSound('card_play');

    // Stamp a MISS skill result for ALL modes (vs_ai, career, dual_cpu,
    // local, network). A user who didn't pick a card clearly can't play
    // the skill mini-game either, so MISS is fair. Without this, the
    // resolution path waits forever for the human's skill result and the
    // match hard-stalls (no timer, no way to continue, persists across
    // matches via localStorage). Previously this was network-only, which
    // is why offline modes locked up on timer expiry.
    const miss = getMissResult();
    if (humanPlayer === 'p1') setP1SkillResult(miss);
    else setP2SkillResult(miss);
    setPendingChallenge(null); // in case a stale challenge is still open

    // ── Network mode: ALSO send to the server ─────────────────────────────
    // Without this, the timer sets a local pick but the server is never told,
    // so round_picks never broadcasts and the match hangs at move 1.
    if (gameMode === 'network' && networkClientRef.current) {
      setNetworkPickSent(true);
      if (networkModeRef.current === 'online') {
        sendNetworkPick(pick.id, miss);
      } else {
        // LAN server is skill-agnostic
        sendNetworkPick(pick.id);
      }
    }
  }, [humanHand, humanPick, resolving, playSound, setHumanPick, gameMode, humanPlayer, sendNetworkPick]);

  // ── Network retry/timeout safety net ─────────────────────────────────────
  // Escalating ladder - each step covers a different failure mode.
  // (1) 4s: soft retry (re-enqueue the pick). If our send raced the socket
  //     closing, the networkClient queue will hold this one until the next
  //     auth_success, then flush it.
  // (2) 8s: force a reconnect. The socket *looks* OPEN but the server is
  //     not responding - usually the iOS WKWebView socket silently went
  //     half-dead during backgrounding. forceReconnect() closes the ws,
  //     which triggers _tryReconnect → re-auth → queue flush (which still
  //     holds our pick).
  // (3) 18s: hard fail and show a user-visible error. By this point both
  //     retry paths have had a chance; the match is genuinely stuck.
  useEffect(() => {
    clearTimeout(networkPickRetryRef.current);
    clearTimeout(networkPickForceReconnectRef.current);
    clearTimeout(networkPickHardFailRef.current);
    if (gameMode !== 'network' || !networkPickSent || pickAcknowledged) return;
    networkPickRetryRef.current = setTimeout(() => {
      if (!lastNetworkPickRef.current || !networkClientRef.current) return;
      try {
        const { cardId, skillResult } = lastNetworkPickRef.current;
        console.log('[NET RETRY soft]', cardId);
        // Route through sendNetworkPick so the same guards that protect
        // the original send (refuse if currentRoundSeqRef.current < 1)
        // also apply to retries. Reading roundSeq fresh from the ref
        // avoids re-sending stale roundSeq across rematch / void / advance.
        sendNetworkPick(cardId, skillResult);
      } catch { /* swallow - best-effort retry */ }
    }, 4000);
    networkPickForceReconnectRef.current = setTimeout(() => {
      const client = networkClientRef.current;
      if (!client || !lastNetworkPickRef.current) return;
      // Re-enqueue the pick so the reconnect flush replays it. sendNetworkPick
      // will find the socket closing and push it into _sendQueue.
      try {
        const { cardId, skillResult } = lastNetworkPickRef.current;
        sendNetworkPick(cardId, skillResult);
      } catch { /* ignore */ }
      console.warn('[NET RETRY force-reconnect]');
      try { client.forceReconnect?.('pick_ack_timeout'); } catch { /* ignore */ }
    }, 8000);
    networkPickHardFailRef.current = setTimeout(() => {
      setNetworkError('No response from server. Check your connection.');
    }, 18000);
    return () => {
      clearTimeout(networkPickRetryRef.current);
      clearTimeout(networkPickForceReconnectRef.current);
      clearTimeout(networkPickHardFailRef.current);
    };
  }, [gameMode, networkPickSent, pickAcknowledged, sendNetworkPick]);

  // 4th-pass review fix: auto-clear the transient mid-match notice
  // after 5s as a belt-and-suspenders alongside the state_update path.
  // If the round somehow doesn't advance (server stalled, opponent gone),
  // we still don't want the notice stuck on screen forever.
  useEffect(() => {
    if (!networkNotice) return;
    const t = setTimeout(() => setNetworkNotice(null), 5000);
    return () => clearTimeout(t);
  }, [networkNotice]);

  // 2nd-pass review fix: watchdog for the new RTT gap between sending
  // card_pick and receiving challenge_start. If neither challenge_start
  // nor challenge_resolved arrives within 8s, surface a connection error
  // so the user isn't stuck staring at "Preparing skill challenge..."
  // forever (e.g., if the server crashed after acking the pick).
  const challengeStartWatchdogRef = useRef(null);
  useEffect(() => {
    clearTimeout(challengeStartWatchdogRef.current);
    if (!awaitingChallengeStart) return;
    challengeStartWatchdogRef.current = setTimeout(() => {
      setNetworkError('Skill challenge did not start. Connection may have dropped.');
      setAwaitingChallengeStart(false);
    }, 8000);
    return () => clearTimeout(challengeStartWatchdogRef.current);
  }, [awaitingChallengeStart]);

  // Audit repair #18: stuck-after-ack watchdog. The pre-ack ladder above
  // covers "ack never came" by canceling on pickAcknowledged=true. The
  // FAILURE that ladder doesn't cover is "ack arrived, but round_picks
  // never did" - a lost broadcast leaves the client hanging because
  // networkPickSent is still true so the 30s round cap (handleTimerExpiry)
  // no-ops. This watchdog converts that silent hang into a visible
  // connection error after 25s. Resolution clears both flags
  // (round_picks handler at line 2773-2774) and cancels the timer.
  useEffect(() => {
    clearTimeout(networkAckStallRef.current);
    if (gameMode !== 'network') return;
    if (!networkPickSent || !pickAcknowledged) return;
    networkAckStallRef.current = setTimeout(() => {
      setNetworkError('Round resolution timed out. Connection may have dropped.');
    }, 25000);
    return () => clearTimeout(networkAckStallRef.current);
  }, [gameMode, networkPickSent, pickAcknowledged]);

  // Keep handleTimerExpiry reachable from the 30s setTimeout without making
  // it a dep (which would reset the timer on every humanPick change).
  const handleTimerExpiryRef = useRef(handleTimerExpiry);
  useEffect(() => { handleTimerExpiryRef.current = handleTimerExpiry; }, [handleTimerExpiry]);

  // Only matchState.phase and matchState.pinAttempt are read (the bare !matchState
  // check is a null guard); full matchState would re-fire on every match update.
  useEffect(() => {
    clearTimeout(networkRoundMaxRef.current);
    if (gameMode !== 'network') return;
    if (!humanHand.length || resolving) return;
    if (!matchState) return;
    // Cover both 'playing' and 'overtime' - the local-resolve effect accepts
    // both, so our safety net must too, or the cap won't schedule during OT.
    if (matchState.phase !== 'playing' && matchState.phase !== 'overtime') return;
    if (matchState.pinAttempt) return;
    networkRoundMaxRef.current = setTimeout(() => {
      // 30s absolute cap from round start. Always calls the LATEST expiry
      // handler via ref (so it sees current humanPick state). If already
      // picked, the expiry handler no-ops and the 18s retry effect handles
      // server-side stalls.
      handleTimerExpiryRef.current?.();
    }, 30000);
    return () => clearTimeout(networkRoundMaxRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameMode, humanHand, resolving, matchState?.phase, matchState?.pinAttempt]);

  // Clear the stored last pick when the round resolves (networkPickSent
  // flips back to false via round_picks handling).
  useEffect(() => {
    if (!networkPickSent) lastNetworkPickRef.current = null;
  }, [networkPickSent]);

  // Belt-and-suspenders: if a skill challenge is open for more than 6.5s without
  // resolving (any reason - mechanic render glitch, component unmount race,
  // etc.), force-resolve with MISS so a pick always reaches the server. The
  // individual mechanics already have their own 2-4s auto-miss timers; this
  // is a parent-level backstop that guarantees the round can never stall
  // inside the challenge overlay.
  useEffect(() => {
    if (!pendingChallenge) return;
    const t = setTimeout(() => {
      const { card, side } = pendingChallenge;
      const miss = getMissResult();
      if (side === 'p1') setP1SkillResult(miss);
      else setP2SkillResult(miss);
      setPendingChallenge(null);
      if (gameMode === 'network' && networkModeRef.current === 'online' && networkClientRef.current) {
        sendNetworkPick(card.id, miss);
      }
    }, 6500);
    return () => clearTimeout(t);
  }, [pendingChallenge, gameMode, sendNetworkPick]);

  // ── Mid-match persistence: restore on mount ──────────────────────────────
  useEffect(() => {
    // Career-Dual restore comes first. If the player force-closed mid-bout
    // of a career dual, the saved match is tagged with gameMode
    // 'career_dual_my_match' or 'career_dual_full'. We restore the dual
    // snapshot from the namespaced career key and the in-flight bout from
    // matchPersistence in lockstep so handleContinueCareerDualMeet finds
    // both refs populated. The five-guard `isCareerDualMeetSnapshotResumable`
    // re-runs after `activeCareer` hydrates (in the auth effect above)
    // and clears the snapshot if it turns out to be stale.
    const persistedCareerDual = loadCareerDual();
    const savedMaybe = loadMatchFromStorage();
    if (persistedCareerDual && savedMaybe && isCareerDualMode(savedMaybe.gameMode)) {
      setDualMeetState(persistedCareerDual);
      setMatchState(savedMaybe.matchState);
      setP1Hand(savedMaybe.p1Hand);
      setP2Hand(savedMaybe.p2Hand);
      setGameMode(savedMaybe.gameMode);
      if (savedMaybe.humanPlayer) setHumanPlayer(savedMaybe.humanPlayer);
      setPinOffenseChoice(null);
      setPinDefenseChoice(null);
      setScreen('game');
      clearMatchFromStorage();
      return;
    }
    if (persistedCareerDual && persistedCareerDual.phase === 'between') {
      setDualMeetState(persistedCareerDual);
      setScreen('career_dual_meet');
      return;
    }
    if (persistedCareerDual && persistedCareerDual.phase === 'complete') {
      // Stale - we record at completion, so a 'complete' snapshot is leftover.
      // Drop it so the user lands cleanly. The auth-effect resume will not
      // re-resurrect it.
      clearCareerDual();
    }

    // Standalone Dual-Meet next: if a dual is in flight, route to the right
    // phase. An active bout (saved match state) takes precedence over the
    // dual shell - we resume the bout and keep the dual around to advance
    // on finish.
    const persistedDual = loadDual();
    const saved = savedMaybe;
    if (persistedDual) {
      // In-flight bout? Resume the match - dual context follows.
      if (saved && isDualMode(saved.gameMode)) {
        setDualMeetState(persistedDual);
        setMatchState(saved.matchState);
        setP1Hand(saved.p1Hand);
        setP2Hand(saved.p2Hand);
        setGameMode(saved.gameMode);
        if (saved.humanPlayer) setHumanPlayer(saved.humanPlayer);
        setPinOffenseChoice(null);
        setPinDefenseChoice(null);
        setScreen('game');
        clearMatchFromStorage();
        return;
      }
      // Resumable shells: completed result + between-bouts scoreboard.
      if (persistedDual.phase === 'complete') {
        setDualMeetState(persistedDual);
        setScreen('dual_result');
        return;
      }
      if (persistedDual.phase === 'between') {
        setDualMeetState(persistedDual);
        setScreen('dual_scoreboard');
        return;
      }
      // Otherwise (phase 'bout' with no in-flight match, or 'lineup' with
      // no follow-up) the dual is unresumable. Clear it and fall through
      // to the normal menu - landing on dual_setup would strand the user
      // on a config screen they didn't ask for.
      clearDual();
    }
    if (saved) {
      setMatchState(saved.matchState);
      setP1Hand(saved.p1Hand);
      setP2Hand(saved.p2Hand);
      setGameMode(saved.gameMode);
      // humanPlayer is REQUIRED for correct attacker/defender mapping in
      // pin_attempt and the AI pick effect. Older saves didn't include it;
      // fall back to 'p1' to preserve historical behaviour.
      if (saved.humanPlayer) setHumanPlayer(saved.humanPlayer);
      // Clear any stale pin-sub-picks so a post-restore resolve effect can't
      // fire with half-remembered choices from the previous session.
      setPinOffenseChoice(null);
      setPinDefenseChoice(null);
      setScreen('game');
      clearMatchFromStorage();
    }
  }, [setScreen]);

  // 2026-05-01 - "Loading match..." stuck-state self-heal.
  // If the screen ends up at a value that has no explicit render branch
  // (notably 'game') AND matchState is null AND no recoverable saved
  // match exists, we'd render the loading-spinner fallback forever. This
  // effect detects that condition AFTER any pending persistence-restore
  // has had time to run, then routes to menu automatically. Re-fires on
  // every transition into screen='game' (deps include matchState +
  // screen), so even if the user gets re-stuck after a manual recovery,
  // this catches them again.
  //
  // Timer is 1500ms - long enough to ride out: the synchronous mount
  // restore effect (immediate), the auth-resolved getActiveCareer chain
  // (Firestore round-trip, ~200-800ms typical), and any handleStartMatch
  // call that's mid-React-batch when this effect schedules.
  useEffect(() => {
    if (matchState) return;
    if (screen !== 'game') return;
    const t = setTimeout(() => {
      try {
        const saved = loadMatchFromStorage();
        if (saved && saved.matchState) return; // restore will fire on next render
      } catch { /* fall through to recovery */ }
      console.warn('[stuck-state] screen=game with no matchState and no saved match; recovering to menu');
      try { clearMatchFromStorage(); } catch { /* best-effort */ }
      // Also clear any career-tournament local cache for the active
      // career - if a stale tournament snapshot was the root cause, we
      // want a clean slate, not just a screen change.
      const uid = auth.currentUser?.uid;
      const cid = activeCareerRef.current?.id;
      if (uid && cid) {
        try { clearCareerTournament(uid, cid); } catch { /* best-effort */ }
      }
      setTournamentState(null);
      setTournamentMatchInfo(null);
      setScreen('menu');
    }, 1500);
    return () => clearTimeout(t);
  }, [matchState, screen, setScreen]);

  // ── Mid-match persistence: save on visibility change / tab close ─────────
  useEffect(() => {
    const handleSave = () => {
      if (matchState && matchState.phase !== 'finished' && screen === 'game' && gameMode !== 'network') {
        saveMatchToStorage(matchState, p1Hand, p2Hand, gameMode, humanPlayer);
      }
    };
    document.addEventListener('visibilitychange', handleSave);
    window.addEventListener('beforeunload', handleSave);
    return () => {
      document.removeEventListener('visibilitychange', handleSave);
      window.removeEventListener('beforeunload', handleSave);
    };
  }, [matchState, p1Hand, p2Hand, gameMode, screen, humanPlayer]);

  const startGame = (mode, names, style = 'folkstyle', side = 'green', difficulty = 'medium') => {
    [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
    matchSavedRef.current = false;
    wasTrailingRef.current = false;
    maxDeficitRef.current = 0;
    humanMaxPeriodPointsRef.current = 0;
    humanCurrentPeriodPointsRef.current = 0;
    lastHumanScoreRef.current = 0;
    lastPeriodRef.current = 1;

    const p1Name = names?.p1 || 'Green Wrestler';
    const p2Name = names?.p2 || (mode === 'vs_ai' ? 'CPU Opponent' : 'Red Wrestler');
    const humanSide = (mode === 'vs_ai' && side === 'red') ? 'p2' : 'p1';
    const p1Stats = (humanSide === 'p1' && wrestlerProfile?.stats) ? wrestlerProfile.stats : null;
    const p2Stats = (humanSide === 'p2' && wrestlerProfile?.stats) ? wrestlerProfile.stats : null;
    const aiDiff = mode === 'vs_ai' ? difficulty : 'medium';
    const initial = createInitialMatchState(p1Name, p2Name, style, p1Stats, p2Stats, aiDiff);

    const hp = (mode === 'vs_ai' && side === 'red') ? 'p2' : 'p1';
    setHumanPlayer(hp);
    setGameMode(mode);
    setMatchState(initial);
    setP1Selected(null);
    setP2Selected(null);
    setP1SkillResult(null);
    setP2SkillResult(null);
    setPendingChallenge(null);
    setPinOffenseChoice(null);
    setPinDefenseChoice(null);
    setPostMatchData(null);
    setNetworkPlayer(null);
    setNetworkPickSent(false);
    setPickAcknowledged(false);
    setNetworkError(null);
    setOpponentDisconnected(false);
    setResolving(false);
    setLocalTurn('p1');
    setShowPassDevice(mode === 'local');
    setP1Hand(handFor('p1',initial.p1.position, initial.p1Conditions, style));
    setP2Hand(handFor('p2',initial.p2.position, initial.p2Conditions, style));
    replayRef.current = createReplay({
      p1Name, p2Name, style, difficulty: aiDiff, gameMode: mode,
      p1Stats, p2Stats, initiative: initial.initiative,
    });
    setScreen('game');
    logEvent('match_start', { game_mode: mode, wrestling_style: style, difficulty, side });
  };
  // Mirror startGame into a ref every render so the once-registered tab-bar
  // handler can call the freshest closure when the Play tab fires Quick Match.
  startGameRef.current = startGame;

  // ── Elijah Joles Boss Challenge entry point ──────────────────────────────
  // Builds a vs_ai match against Elijah with adaptive overall scaled to the
  // player's level + persistent boss-win escalation (matgrind_elijah_boss_wins
  // localStorage). The match opponent carries `npcId: 'special_elijah_joles'`
  // through state so checkAchievements + opponentDialogue + the AI personality
  // block in wrestlingEngine all see the stable identity, surviving the
  // p1/p2 side-id overwrite in createWrestler.
  const elijahBossActiveRef = useRef(false);
  const startElijahBossMatch = useCallback(async () => {
    // Lazy import to keep the elijahJoles module out of the initial bundle.
    const { buildElijahBossOpponent } = await import('../lib/career/elijahJoles.js');
    const playerLevel = wrestlerProfile?.level
      || getLevelFromXP(wrestlerProfile?.xp || 0)
      || 1;
    let bossWins = 0;
    try { bossWins = Number(localStorage.getItem('matgrind_elijah_boss_wins') || 0) || 0; } catch { /* quota / disabled */ }
    const opp = buildElijahBossOpponent({ playerLevel, bossWins });
    const oppOverall = opp.overall;
    const difficulty = oppOverall >= 85 ? 'expert' : oppOverall >= 75 ? 'hard' : 'medium';
    const style = 'freestyle'; // Elijah's preferred style

    [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
    matchSavedRef.current = false;
    wasTrailingRef.current = false;
    maxDeficitRef.current = 0;
    humanMaxPeriodPointsRef.current = 0;
    humanCurrentPeriodPointsRef.current = 0;
    lastHumanScoreRef.current = 0;
    lastPeriodRef.current = 1;

    const p1Name = wrestlerProfile?.username || 'You';
    const p2Name = opp.name;
    const p1Stats = wrestlerProfile?.stats || null;
    const p2Stats = opp.stats;
    const initial = createInitialMatchState(
      p1Name, p2Name, style, p1Stats, p2Stats, difficulty, null,
      { p2NpcId: opp.id },
    );

    elijahBossActiveRef.current = true;
    setHumanPlayer('p1');
    setGameMode('vs_ai');
    setMatchState(initial);
    setP1Selected(null);
    setP2Selected(null);
    setP1SkillResult(null);
    setP2SkillResult(null);
    setPendingChallenge(null);
    setPinOffenseChoice(null);
    setPinDefenseChoice(null);
    setPostMatchData(null);
    setNetworkPlayer(null);
    setNetworkPickSent(false);
    setPickAcknowledged(false);
    setNetworkError(null);
    setOpponentDisconnected(false);
    setResolving(false);
    setLocalTurn('p1');
    setShowPassDevice(false);
    setP1Hand(handFor('p1', initial.p1.position, initial.p1Conditions, style));
    setP2Hand(handFor('p2', initial.p2.position, initial.p2Conditions, style));
    replayRef.current = createReplay({
      p1Name, p2Name, style, difficulty, gameMode: 'vs_ai',
      p1Stats, p2Stats, initiative: initial.initiative,
    });
    setScreen('game');
    logEvent('match_start', { game_mode: 'elijah_boss', wrestling_style: style, difficulty, boss_wins: bossWins });
  }, [wrestlerProfile, resolveTimer, aiTimer, periodTimer, pinTimer]);

  // ── Career Mode entry points (Phase A) ────────────────────────────────
  // Kick off a career event as a vs_ai match. Opponent stats flow into
  // p2Stats so the AI wrestler matches the rival/filler's generated block.
  // selectedCareerEvent is held in state so the match-end path can look up
  // which event to mark complete.
  const startCareerEvent = useCallback((event) => {
    if (!event) return;
    const career = activeCareerRef.current;
    if (!career) return;
    setSelectedCareerEvent(event);

    // Team-format dual_meet: route to the pre-dual choice screen so the
    // player can pick "Wrestle My Match" or "Wrestle Full Dual" before the
    // dual is built. The legacy 'dual' single-match path stays intact so
    // in-progress careers whose schedule still contains 'dual' events
    // continue to work without migration.
    if (event.type === 'dual_meet') {
      setScreen('career_dual_meet_setup');
      return;
    }

    // Tournaments + championships run as a real bracket, not a single match.
    // Reuse the standalone tournament runner; tag the run with careerEventId
    // so handleContinueTournament knows to feed the placement back to career
    // mode instead of writing to the standalone tournament history.
    if (event.type === 'tournament' || event.type === 'championship') {
      // Resume in-memory bracket if the user backed out and is now re-entering
      // the same event in the same session. Without this check, building a
      // fresh bracket here wipes their R1 win + overwrites the Firestore
      // snapshot, which is what causes the "tournament restarted" bug when
      // the player backs out to spend skill points and tries to come back.
      // (Cross-session resume runs once at app load via the auth-state
      // useEffect, so this check only needs to handle the within-session
      // back-and-forth case.)
      const inMemory = tournamentState;
      if (inMemory
          && inMemory.careerEventId === event.id
          && inMemory.phase !== 'complete'
          && !inMemory.playerEliminated) {
        setScreen('tournament');
        return;
      }
      const profile = {
        username: career.wrestler.name,
        stats: career.wrestler.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        appearance: career.wrestler.appearance ?? null,
      };
      // Tournament-level difficulty serves as the FLOOR for opponent skill
      // (used for unranked / mid-pool fillers). Per-match difficulty is
      // overridden in handleTournamentStartMatch using each opponent's actual
      // overall (Feature 8). Championships start one tier higher because the
      // bracket field is seeded from the top of the ranking pool.
      const difficulty = event.type === 'championship' ? 'hard' : 'medium';
      const style = event.style || 'folkstyle';
      const bracketSize = event.bracketSize || 8;
      // Career tournaments use a pre-seeded bracket field drawn from the
      // ranking pool (Feature 7). Player's seed = their rank within the
      // event's scope (conference / section / state), so a Conference
      // Championship pulls only conference-scoped NPCs and seeds by
      // conference rank.
      // v7: pass the event's style so dual-style senior careers (men) draw
      // from the per-style ranking pool. Pre-senior tiers and legacy careers
      // ignore the arg and fall back to career.rankingPool.
      // Forced bracket seeds come from two sources:
      // - v8 partnership seeding: event.seededRivalIds (Elijah Joles in his
      //   designated tournaments, plus the top 2 rivals seeded by the
      //   schedule generator) lands featured wrestlers regardless of pure
      //   overall sort. Undefined falls back to [].
      // - Career Depth Pass v1 Rivalry Heat: pick the single hottest rival
      //   (feudLevel >= FEUD_BLOOD) and force them into the bracket so the
      //   feud climbs across events. Cap at 1 per bracket so it never feels
      //   rigged. Skip when no rival meets the threshold.
      const scheduleSeededIds = Array.isArray(event.seededRivalIds) ? event.seededRivalIds : [];
      const eligibleFeudRivals = (career.rivals || [])
        .filter(r => r && r.id && feudLevel(r.h2h) >= FEUD_BLOOD)
        .sort((a, b) => feudLevel(b.h2h) - feudLevel(a.h2h));
      const hotFeudId = eligibleFeudRivals.length > 0 ? eligibleFeudRivals[0].id : null;
      const forcedSeedIds = hotFeudId && !scheduleSeededIds.includes(hotFeudId)
        ? [...scheduleSeededIds, hotFeudId]
        : scheduleSeededIds;
      const seeded = buildSeededBracket(career, bracketSize, event.stakes, event.style, forcedSeedIds);
      const tournament = createTournament(profile, difficulty, style, bracketSize, 'single', {
        preSeededBracket: seeded.bracket,
        preSeededPlayerSeed: seeded.playerSeed,
      });
      tournament.careerEventId = event.id;
      [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
      matchSavedRef.current = false;
      wasTrailingRef.current = false;
      maxDeficitRef.current = 0;
      setTournamentState(tournament);
      setTournamentMatchInfo(null);
      // Career Depth Pass v1 (Step 4 - Tournament Drama): route through the
      // bracket reveal screen before the tournament UI for state / regional /
      // championship events. Lower-stakes tournaments skip the reveal so the
      // weekly cadence stays brisk.
      const showReveal = event.type === 'championship'
        || event.stakes === 'state'
        || event.stakes === 'regional'
        || event.stakes === 'ncaa';
      if (showReveal) {
        setPendingBracketReveal({
          bracket: seeded.bracket,
          playerSeed: seeded.playerSeed,
          eventName: event.name || 'Tournament',
        });
        setScreen('career_bracket_reveal');
      } else {
        setScreen('tournament');
      }
      // Feature 9: persist a snapshot at bracket creation so the player can
      // resume after a force-close. The full bracket field is frozen, so
      // resuming returns them to the exact same matchups.
      const uid = auth.currentUser?.uid;
      if (uid && career?.id) {
        saveCareerTournament(uid, career.id, tournament).catch(() => {});
      }
      logEvent('match_start', { game_mode: 'career_tournament', wrestling_style: style, difficulty, bracket_size: bracketSize });
      return;
    }

    const p1Name = career.wrestler.name;
    const p2Name = event.opponent?.name || 'Bracket Opponent';
    // Career Depth Pass v1: convert pending tempBuffs (decision-event
    // outcomes, interstitial picks) into engine modifiers. Stash the
    // sourceIds tagged by {careerId, eventId} so the result handler can
    // forward them to recordEventResult for consumption + debuff counting,
    // and so a stale stash from a different career or event cannot leak in.
    const careerMods = applyCareerMatchModifiers(career.wrestler);
    stashCareerMatchModifiers(career.id, event.id, careerMods);
    const p1Stats = careerMods.stats;
    // Dual events have a real assigned opponent. Use their stats - never the
    // flat 60/60 fallback (which used to make every dual feel identical).
    const p2Stats = event.opponent?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
    const style = event.style || 'folkstyle';
    // Difficulty scales with opponent overall (Feature 8). Even within
    // 'medium' territory the engine renders the AI's skill checks based on
    // this preset, so a 50-overall walkover and an 80-overall rival no
    // longer play identically.
    const opponentOverall = event.opponent?.overall || computeOverallFromStats(p2Stats);
    const difficulty = pickDifficultyForOverall(opponentOverall);

    [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
    matchSavedRef.current = false;
    wasTrailingRef.current = false;
    maxDeficitRef.current = 0;
    humanMaxPeriodPointsRef.current = 0;
    humanCurrentPeriodPointsRef.current = 0;
    lastHumanScoreRef.current = 0;
    lastPeriodRef.current = 1;

    const initial = createInitialMatchState(p1Name, p2Name, style, p1Stats, p2Stats, difficulty, null, {
      p1StaminaMultiplier: careerMods.staminaMultiplier,
    });
    setHumanPlayer('p1');
    setGameMode('career');
    setMatchState(initial);
    setP1Selected(null);
    setP2Selected(null);
    setP1SkillResult(null);
    setP2SkillResult(null);
    setPendingChallenge(null);
    setPinOffenseChoice(null);
    setPinDefenseChoice(null);
    setPostMatchData(null);
    setNetworkPlayer(null);
    setNetworkPickSent(false);
    setPickAcknowledged(false);
    setNetworkError(null);
    setOpponentDisconnected(false);
    setResolving(false);
    setLocalTurn('p1');
    setShowPassDevice(false);
    setP1Hand(handFor('p1', initial.p1.position, initial.p1Conditions, style));
    setP2Hand(handFor('p2', initial.p2.position, initial.p2Conditions, style));
    replayRef.current = createReplay({
      p1Name, p2Name, style, difficulty, gameMode: 'career',
      p1Stats, p2Stats, initiative: initial.initiative,
    });
    setScreen('game');
    logEvent('match_start', { game_mode: 'career', wrestling_style: style, difficulty, side: 'green' });
  }, [handFor, tournamentState, setScreen]);

  // Create a new career via the wizard. Persists to Firestore + local mirror.
  // Honors the pending slot id (which empty slot the user tapped to start
  // this career) so a creation triggered from slot3 lands in slot3 even when
  // slot1 is also empty. Without this, creates always fall back to slot1.
  const handleCareerCreated = useCallback(async (career) => {
    const hydrated = hydrateCareer(career);
    const preferSlotId = pendingSlotIdRef.current || null;
    setActiveCareer(hydrated);
    setScreen('career_dashboard');
    if (user?.uid) {
      try { await saveCareer(user.uid, hydrated, { preferSlotId }); }
      catch (err) { console.warn('[career] initial save failed:', err?.message); }
      // Refresh slot list so the new career shows up in the slot picker.
      try { setCareerSlots(await getCareerSlots(user.uid)); } catch { /* offline */ }
    }
    pendingSlotIdRef.current = null;
  }, [user?.uid, setScreen]);

  // Advance from offseason → next preseason. Called from the dashboard's
  // "Advance Season" button. On HS graduation (Phase C adds recruiting)
  // the state machine flips to retired and the UI will reflect that.
  const handleCareerAdvanceSeason = useCallback(async () => {
    const career = activeCareerRef.current;
    if (!career) return;
    let next;
    try {
      next = advanceCareerSeason(career);
    } catch (err) {
      console.warn('[career] advance failed:', err?.message);
      try {
        const { toast } = await import('@/components/ui/use-toast');
        toast({
          title: "Couldn't advance season",
          description: err?.message || 'Unknown error - please reload and try again.',
          variant: 'destructive',
        });
      } catch (_e) { /* ignore toast failure */ }
      return;
    }
    setActiveCareer(next);
    if (user?.uid) {
      try { await saveCareer(user.uid, next); } catch (_e) { /* noop */ }
    }
  }, [user?.uid]);

  // "Play Next" from the match-result modal: pop the next upcoming event off
  // the schedule and drop the player into its preview. If the season is
  // complete, fall back to the dashboard (which will surface Advance/Retire).
  const handleContinueCareer = useCallback(() => {
    const career = activeCareerRef.current;
    if (!career) { setScreen('menu'); return; }
    // If recordEventResult rolled a between-event decision (40% chance after
    // each non-championship match), surface it on the dashboard BEFORE the
    // next opponent preview. Otherwise the decision only shows up when the
    // user happens to navigate back to dashboard, which feels like a ghost
    // event ambushing them after a back-arrow press.
    if (career.pendingDecision) {
      setSelectedCareerEvent(null);
      setScreen('career_dashboard');
      return;
    }
    const next = getNextCareerEvent(career);
    setSelectedCareerEvent(null);
    if (next) {
      setSelectedCareerEvent(next);
      setScreen('career_event_preview');
    } else {
      setScreen('career_dashboard');
    }
  }, [setScreen]);

  const handleCareerRetire = useCallback(async () => {
    // Flip phase to 'retired' and persist. Splash handles navigation; do NOT
    // auto-redirect, null out activeCareer, clearLocalCareer, or clearSlot.
    // Local-mirror cleanup lives in the splash's explicit exit buttons.
    const career = activeCareerRef.current;
    if (!career) return;

    const next = retireCareer(career, { reason: 'user_choice' });
    setActiveCareer(next);

    const uid = user?.uid;
    if (uid) {
      try {
        const thumb = buildHallOfFameThumbnail(next);
        await archiveCareer(uid, next, thumb).catch(() => {});
        await saveCareer(uid, next).catch(() => {});
      } catch (_e) { /* noop */ }
    }
  }, [user?.uid]);

  // --- Tier transition handlers ----------------------------------------
  // The career.phase state machine routes through 'recruiting' -> 'tier_transition'
  // -> 'preseason' on every promotion. These handlers bridge the user's pick
  // to the corresponding pure reducer and persist the result.
  const handleAcceptCollegeOffer = useCallback(async (offerId) => {
    const career = activeCareerRef.current;
    if (!career) return;
    let next;
    try { next = acceptCollegeOffer(career, offerId); }
    catch (err) { console.warn('[career] acceptCollegeOffer failed:', err?.message); return; }
    setActiveCareer(next);
    if (user?.uid) { try { await saveCareer(user.uid, next); } catch (_e) { /* noop */ } }
  }, [user?.uid]);

  const handleTakeWalkOnPath = useCallback(async () => {
    const career = activeCareerRef.current;
    if (!career) return;
    let next;
    try { next = takeWalkOnPath(career); }
    catch (err) { console.warn('[career] takeWalkOnPath failed:', err?.message); return; }
    setActiveCareer(next);
    if (user?.uid) { try { await saveCareer(user.uid, next); } catch (_e) { /* noop */ } }
  }, [user?.uid]);

  const handleConfirmTierTransition = useCallback(async () => {
    const career = activeCareerRef.current;
    if (!career) return;
    let next;
    try { next = confirmTierTransition(career); }
    catch (err) { console.warn('[career] confirmTierTransition failed:', err?.message); return; }
    setActiveCareer(next);
    if (user?.uid) { try { await saveCareer(user.uid, next); } catch (_e) { /* noop */ } }
  }, [user?.uid]);

  const handleChooseSeniorStyle = useCallback(async (style) => {
    const career = activeCareerRef.current;
    if (!career) return;
    let next;
    try { next = chooseSeniorStyle(career, style); }
    catch (err) { console.warn('[career] chooseSeniorStyle failed:', err?.message); return; }
    setActiveCareer(next);
    if (user?.uid) { try { await saveCareer(user.uid, next); } catch (_e) { /* noop */ } }
  }, [user?.uid]);

  // Start New Career: archive the current one and route to the creation
  // wizard. Until multiple career slots land we only track one active
  // career per user, so this is inherently destructive. The dashboard
  // surfaces a confirmation modal before calling this.
  // Multi-slot mode: "Start New Career" no longer archives - it routes to
  // the slot picker so the user can keep their current career in its slot
  // and start another in an empty slot. Archiving still happens via the
  // long-press "retire" action inside the slot picker.
  const handleCareerStartNew = useCallback(async () => {
    if (user?.uid) {
      try { setCareerSlots(await getCareerSlots(user.uid)); } catch { /* offline */ }
    }
    setScreen('career_slot_picker');
  }, [user?.uid, setScreen]);

  // 2026-05-01 - Guard 4 (stuck-state hammer).
  // When the user navigates INTO the career slot picker, unconditionally
  // clear any in-flight match state (both React + localStorage) so a
  // stale leftover from a previous session can't auto-resume into the
  // 'Loading match...' fallback. The slot picker is the canonical entry
  // point to career mode; if a user is here, they're explicitly choosing
  // a career, not resuming a match. Existing flow guards (attemptLeaveMatch)
  // already prevent navigation away from a live in-progress match, so a
  // user who reaches this screen does NOT have a real match to lose.
  //
  // This is the categorical fix for re-stuck-on-retry: every Career-button
  // tap from the menu wipes whatever stale state was causing the loop.
  useEffect(() => {
    if (screen !== 'career_slot_picker') return;
    if (matchState) {
      console.warn('[slot-picker-entry] clearing stale matchState');
      setMatchState(null);
    }
    try { clearMatchFromStorage(); } catch { /* best-effort */ }
    // Tournament cache is per-career, so we don't blanket-clear here -
    // Guard 3 (proactive sweep) handles per-career orphan cleanup
    // when activeCareer is selected.
    setTournamentState(null);
    setTournamentMatchInfo(null);
    // Career Depth Pass v1: scrub any stale career-match modifier stash
    // before the user picks a slot. The {careerId, eventId} tag would catch
    // a mismatched ref anyway, but clearing here keeps the in-memory state
    // tidy when switching between careers in the picker.
    clearCareerMatchModifiers();
  }, [screen, matchState, clearCareerMatchModifiers]);

  // Applied when the skill tree modal spends a point. Replaces the
  // wrestler sub-object only; everything else on the career doc (schedule,
  // rivals, rankings) is preserved.
  const handleCareerWrestlerChange = useCallback(async (wrestler) => {
    const career = activeCareerRef.current;
    if (!career || !wrestler) return;
    const next = { ...career, wrestler, updatedAt: Date.now() };
    setActiveCareer(next);
    if (user?.uid) {
      try { await saveCareer(user.uid, next); } catch (_e) { /* noop */ }
    }
  }, [user?.uid]);

  // Leave-match helper. In online multiplayer we force a confirm so a stray
  // tap on ← Menu / ESC / Android back doesn't abandon the opponent mid-match.
  // `action` is what to run if the user confirms (or always, for non-online).
  const attemptLeaveMatch = useCallback((action) => {
    const match = matchStateRef.current;
    const isOnlineActive =
      gameMode === 'network' &&
      networkModeRef.current === 'online' &&
      networkPlayer !== 'spectator' &&
      match && match.phase !== 'finished';
    if (isOnlineActive) {
      setLeaveConfirmPending(() => action);
    } else {
      action();
    }
  }, [gameMode, networkPlayer]);

  // Mirror attemptLeaveMatch into the ref declared earlier so effects
  // above this point (tab-bar, ESC key, Android back) can invoke it
  // without TDZ-blocking the deps array.
  useEffect(() => { attemptLeaveMatchRef.current = attemptLeaveMatch; }, [attemptLeaveMatch]);

  // ── Quick Match (background queue) entry point ─────────────────────
  // Called from MainMenu's Quick Match tile. Starts the search without
  // navigating - the floating QueuePill (rendered by GlobalQueueOverlay)
  // takes over from here.
  const handleStartQuickMatch = useCallback(() => {
    const name =
      wrestlerProfileRef.current?.username ||
      auth.currentUser?.displayName ||
      'Player';
    const style = 'folkstyle';
    try { logEvent('queue_started', { wrestling_style: style, source: 'main_menu' }); } catch { /* noop */ }
    startQueue({ name, style }).catch((err) => {
      console.warn('[QUEUE] startQueue failed:', err?.message);
    });
  }, []);

  // Forward-ref for startNetworkGame so the accept-event handler above
  // can reach it without triggering the "used before declaration" warning.
  const startNetworkGameRef = useRef(null);

  // Start a network game (called from NetworkLobby or queue-accept handler)
  // LAN mode:    { client, initialState, initialHand, networkPlayer }
  // Online mode: { client, networkPlayer, p1Name, p2Name, style, mode: 'online',
  //                bufferedMessages?: [...] }
  //
  // bufferedMessages contains any server messages received between
  // game_start and consumeMatch (typically the first state_update). They
  // must be drained AFTER the online-mode reset (matchState -> null,
  // hands -> []), or the reset would wipe the just-hydrated state.
  const startNetworkGame = ({ client, initialState, initialHand, networkPlayer: player, p1Name, p2Name, style, mode, initialInitiative, bufferedMessages = [] }) => {
    [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
    matchSavedRef.current = false;
    wasTrailingRef.current = false;
    maxDeficitRef.current = 0;
    humanMaxPeriodPointsRef.current = 0;
    humanCurrentPeriodPointsRef.current = 0;
    lastHumanScoreRef.current = 0;
    lastPeriodRef.current = 1;

    networkClientRef.current = client;
    networkModeRef.current = mode || 'lan';

    // Patch the client's message handler - delegates through ref for fresh closures.
    // This MUST happen before we drain bufferedMessages below, since the
    // drain calls handleNetworkMessage directly (the patch matters for
    // any LIVE messages that arrive after this point).
    client.onMessage = (msg) => handleNetworkMessage(msg);
    handleNetworkMessageRef.current = handleNetworkMessage;

    setGameMode('network');
    setNetworkPlayer(player);
    setHumanPlayer(player);
    setNetworkPickSent(false);
    setPickAcknowledged(false);
    setServerRoundReady(false);  // First state_update will flip this to true.
    setNetworkError(null);
    setOpponentDisconnected(false);
    setP1Selected(null);
    setP2Selected(null);
    setP1SkillResult(null);
    setP2SkillResult(null);
    setPendingChallenge(null);
    setPinOffenseChoice(null);
    setPinDefenseChoice(null);
    setPostMatchData(null);
    setResolving(false);
    setLocalTurn('p1');
    setShowPassDevice(false);
    // Fresh match (or rematch start): no pending handshake.
    setRematchStatus('idle');
    // Reset the round-seq ref. The first state_update (live or replayed
    // from bufferedMessages below) will set this to 1.
    currentRoundSeqRef.current = 0;

    if (mode === 'online') {
      // Server-authoritative online: state and hands hydrate from the first
      // state_update only. Local generation of state would diverge from
      // the server's RNG-seeded hands and produce illegal_card on first
      // pick. The first state_update is in bufferedMessages (or arrives
      // imminently); we drain the buffer after this reset.
      console.log('[NET START] online game_start', {
        player,
        bufferedCount: bufferedMessages.length,
      });
      setMatchState(null);
      matchStateRef.current = null;
      setP1Hand([]);
      setP2Hand([]);
      p1HandRef.current = [];
      p2HandRef.current = [];
    } else {
      // LAN authoritative mode: use server-provided state
      setMatchState(initialState);
      matchStateRef.current = initialState;
      if (player === 'p1') {
        setP1Hand(initialHand);
        setP2Hand([]);
      } else {
        setP2Hand(initialHand);
        setP1Hand([]);
      }
    }
    setScreen('game');

    // Drain any messages that arrived between game_start and now. Online
    // mode always has at least one state_update here. Order is critical:
    // this MUST run after the online-mode reset above, otherwise the
    // reset would wipe the hydration the buffered state_update provides.
    // See queueManager.js _postGameStartBuffer for why this exists.
    for (const msg of bufferedMessages) {
      try {
        handleNetworkMessage(msg);
      } catch (err) {
        console.warn('[NET REPLAY] failed to drain buffered message', msg?.type, err?.message);
      }
    }
  };

  // Keep the forward-ref in sync so the queue-accept handler above can
  // invoke the latest closure of startNetworkGame.
  startNetworkGameRef.current = startNetworkGame;

  // ── Tournament Mode ─────────────────────────────────────────────────────────

  const startTournament = (difficulty, style, guestName, bracketSize = 8, format = 'single') => {
    const DEFAULT_STATS = { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
    const profile = wrestlerProfile || {
      username: guestName || 'Guest',
      stats: DEFAULT_STATS,
      appearance: null,
    };
    const tournament = createTournament(
      profile,
      difficulty,
      style,
      /** @type {8|16|24|32|64|128} */ (bracketSize),
      /** @type {'single'|'consolation'|'double_elim'} */ (format),
    );
    setTournamentState(tournament);
    setTournamentMatchInfo(null);
    setScreen('tournament');
    logEvent('tournament_start', { difficulty, wrestling_style: style, bracket_size: bracketSize, format });
  };

  const handleTournamentStartMatch = (matchInfo) => {
    setTournamentMatchInfo(matchInfo);
    const DEFAULT_STATS = { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
    // Resolve the player entry from their seed position in the bracket. For
    // standalone tournaments playerSeed is always 0, but career tournaments
    // pre-seed the player at their state rank - so reading bracket[0] would
    // show the top-overall NPC's name and stats instead of the player's.
    const playerSeed = tournamentState.playerSeed ?? 0;
    const playerEntry = tournamentState.bracket[playerSeed] || tournamentState.bracket[0];
    // Start a vs_ai game with the tournament opponent's stats
    const p1Name = playerEntry?.name || wrestlerProfile?.username || 'You';
    const p2Name = matchInfo.opponent.name;
    const style = tournamentState.wrestlingStyle;
    const difficulty = tournamentState.difficulty;
    // Stats: career mode uses the live career wrestler (most up-to-date,
    // accounts for stat-point spends mid-tournament), non-career mode uses
    // the global wrestler profile. Falls back to the bracket entry's snapshot.
    const careerNow = activeCareerRef.current;
    const isCareerTournament = !!tournamentState.careerEventId;
    // Career Depth Pass v1: career tournaments consume tempBuffs ONCE for
    // the whole event. Compute modifiers on the first bracket round and
    // stash them; reuse the stashed copy on every subsequent round so a
    // 5-round bracket only counts the debuff once.
    let careerTournamentMods = null;
    if (isCareerTournament && careerNow?.wrestler) {
      careerTournamentMods = readCareerMatchModifiers(careerNow.id, tournamentState.careerEventId);
      if (!careerTournamentMods) {
        careerTournamentMods = applyCareerMatchModifiers(careerNow.wrestler);
        stashCareerMatchModifiers(careerNow.id, tournamentState.careerEventId, careerTournamentMods);
      }
    }
    const p1Stats = isCareerTournament
      ? (careerTournamentMods?.stats || careerNow?.wrestler?.stats || playerEntry?.stats || DEFAULT_STATS)
      : (wrestlerProfile?.stats || playerEntry?.stats || DEFAULT_STATS);
    const p2Stats = matchInfo.opponent.stats;
    // Per-match AI difficulty: scale by the SPECIFIC opponent's overall, so a
    // round-1 walkover and the state final feel different even within one
    // bracket (Feature 8). Falls back to the tournament-level difficulty
    // when the opponent has no overall (e.g. legacy data, generic fillers).
    const opponentOverall = matchInfo.opponent.overall || computeOverallFromStats(p2Stats);
    const aiDiff = typeof opponentOverall === 'number'
      ? pickDifficultyForOverall(opponentOverall)
      : difficulty;

    [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
    matchSavedRef.current = false;
    wasTrailingRef.current = false;
    maxDeficitRef.current = 0;
    humanMaxPeriodPointsRef.current = 0;
    humanCurrentPeriodPointsRef.current = 0;
    lastHumanScoreRef.current = 0;
    lastPeriodRef.current = 1;

    const initial = createInitialMatchState(p1Name, p2Name, style, p1Stats, p2Stats, aiDiff, null, {
      p1StaminaMultiplier: careerTournamentMods?.staminaMultiplier ?? 1.0,
    });

    setHumanPlayer('p1');
    setGameMode('tournament');
    setMatchState(initial);
    setP1Selected(null);
    setP2Selected(null);
    setP1SkillResult(null);
    setP2SkillResult(null);
    setPendingChallenge(null);
    setPinOffenseChoice(null);
    setPinDefenseChoice(null);
    setPostMatchData(null);
    setNetworkPlayer(null);
    setNetworkPickSent(false);
    setPickAcknowledged(false);
    setNetworkError(null);
    setOpponentDisconnected(false);
    setResolving(false);
    setP1Hand(handFor('p1',initial.p1.position, initial.p1Conditions, style));
    setP2Hand(handFor('p2',initial.p2.position, initial.p2Conditions, style));
    setScreen('game');
  };

  // ── Career-tournament forfeit + simulation lifecycle ─────────────────────
  // Both "Quit Tournament" (during a half-played bracket) and "Simulate Week"
  // (a clean shortcut from the dashboard) need to record a tournament result
  // into the career, push to the leaderboard, clear the resume snapshot, and
  // advance the schedule. This shared helper does that work in one place so
  // those two entry points don't drift.
  const finalizeCareerTournamentResult = useCallback(({
    careerEventId,
    bracketSize,
    difficulty,
    style,
    result, // { placement, matchesWon, matchesLost, pinsInTournament, techsInTournament, majorsInTournament, winMethod }
    skipLeaderboard = false, // simulated runs don't push to global leaderboard
  }) => {
    const career = activeCareerRef.current;
    if (!career || !careerEventId) return null;
    // Career Depth Pass v1: forward consumedBuffSourceIds from the tag-validated
    // stash. Populated stash means the player physically entered the bracket
    // (a real round was played and the buff was applied), so the buff must be
    // consumed even on forfeit/quit. Null stash means pure-sim (player never
    // entered the bracket) - we omit the field so recordEventResult leaves
    // tempBuffs untouched (strict-consumption contract preserves the buff).
    const stashedMods = readCareerMatchModifiers(career.id, careerEventId);
    const playerEnteredBracket = !!stashedMods;
    let nextCareer;
    try {
      const payload = {
        playerWon: result.placement === 1,
        p1Score: 0,
        p2Score: 0,
        winMethod: result.winMethod || (result.placement === 1 ? 'champion' : 'decision'),
        placement: result.placement,
        matchesWon: result.matchesWon || 0,
        matchesLost: result.matchesLost || 0,
        pinsInTournament: result.pinsInTournament || 0,
        techsInTournament: result.techsInTournament || 0,
        majorsInTournament: result.majorsInTournament || 0,
      };
      if (playerEnteredBracket) {
        payload.consumedBuffSourceIds = stashedMods.consumedBuffSourceIds || [];
      }
      nextCareer = recordCareerEventResult(career, careerEventId, payload);
    } catch (err) {
      // Do NOT clear the stash on failure. If the buff was applied to a played
      // round and record threw, the user's retry must still be able to consume.
      // Tag matching scopes the stash to this {careerId, eventId} so it cannot
      // contaminate a different event.
      console.warn('[career] finalizeCareerTournamentResult failed:', err?.message);
      return null;
    }
    // Unconditional clear AFTER successful record. The event is finalized;
    // no in-memory modifier stash should survive, even on the sim path where
    // we did not forward sourceIds. Removes future "did we leave a stale
    // stash?" ambiguity during debugging.
    clearCareerMatchModifiers();
    setActiveCareer(nextCareer);
    const uid = auth.currentUser?.uid;
    if (uid) {
      saveCareer(uid, nextCareer).catch(err =>
        console.warn('[career] save after tournament forfeit/sim failed:', err?.message)
      );
    }
    // Clear the in-flight Firestore snapshot so reload doesn't drag the
    // user back into the abandoned bracket.
    if (uid && career.id) {
      clearCareerTournament(uid, career.id);
    }
    // Career-tournament leaderboard push (mirrors handleContinueTournament's
    // career block at lines 1792-1823). Skip if the player won zero matches
    // - no points to credit, and a 0-match push would re-zero their streak.
    // Also skip when caller asked us to (simulated runs - they're a player
    // shortcut, not real performance, so they shouldn't bump global ranks).
    const matchesWon = result.matchesWon || 0;
    const matchesLost = result.matchesLost || 0;
    if (uid && wrestlerProfile && matchesWon > 0 && !skipLeaderboard) {
      (async () => {
        try {
          const prevCur = wrestlerProfile.tournament_streak_cur || 0;
          const prevBest = wrestlerProfile.tournament_streak_best || 0;
          const peakThisTournament = prevCur + matchesWon;
          const newCur = matchesLost > 0 ? 0 : peakThisTournament;
          const newBest = Math.max(prevBest, peakThisTournament);
          const pointsEarned = computeTournamentPoints({
            placement: result.placement,
            bracketSize: bracketSize || 8,
            difficulty: difficulty || 'medium',
          });
          const patch = {
            tournament_points: (wrestlerProfile.tournament_points || 0) + pointsEarned,
            tournament_wins:   (wrestlerProfile.tournament_wins   || 0) + matchesWon,
            tournament_streak_cur: newCur,
            tournament_streak_best: newBest,
          };
          const savedProfile = await saveProfile(uid, patch);
          setWrestlerProfile(savedProfile);
          const { updateTournamentLeaderboards } = await import('../lib/leaderboardService.js');
          updateTournamentLeaderboards(uid, savedProfile).catch(() => {});
        } catch (lbErr) {
          console.warn('[Career-Tournament] leaderboard update (forfeit/sim) failed:', lbErr);
        }
      })();
    }
    // Style is unused at the moment but kept on the signature so the helper
    // can grow into per-style scoring (Greco/Folkstyle bonus points) later.
    void style;
    return nextCareer;
  }, [wrestlerProfile, readCareerMatchModifiers, clearCareerMatchModifiers]);

  // Forfeit-and-quit when the player clicks "Quit Tournament" mid-bracket
  // during a career tournament. Records whatever bracket progress they had
  // as the final result (e.g. won R1, lost R2 -> placement 5 in 8-bracket),
  // wipes the resume snapshot, advances the schedule, returns to dashboard.
  const handleCareerTournamentForfeit = useCallback(() => {
    const ts = tournamentState;
    if (!ts || !ts.careerEventId) return;
    const summary = summarizeForfeitedTournament(ts);
    finalizeCareerTournamentResult({
      careerEventId: ts.careerEventId,
      bracketSize: ts.bracket?.length || 8,
      difficulty: ts.difficulty,
      style: ts.wrestlingStyle,
      result: summary,
    });
    setTournamentState(null);
    setTournamentMatchInfo(null);
    setMatchState(null);
    setSelectedCareerEvent(null);
    clearMatchFromStorage();
    clearTournament();
    setScreen('career_dashboard');
  }, [tournamentState, finalizeCareerTournamentResult, setScreen]);

  // Simulate the current career event without playing it. Branches on
  // event.type. Used by the "Simulate Week" button on the career dashboard.
  const handleSimulateWeek = useCallback((event) => {
    const career = activeCareerRef.current;
    if (!career || !event) return;
    const isTournament = event.type === 'tournament' || event.type === 'championship';

    if (isTournament) {
      // If a bracket is already in progress for THIS event, fold the partial
      // bracket into the result instead of re-rolling - we don't want to
      // throw away wins the player already earned.
      const inProgress = tournamentState && tournamentState.careerEventId === event.id;
      const result = inProgress
        ? summarizeForfeitedTournament(tournamentState)
        : simulateTournamentEvent(career, event);
      finalizeCareerTournamentResult({
        careerEventId: event.id,
        bracketSize: event.bracketSize || 8,
        difficulty: event.difficulty || (event.type === 'championship' ? 'hard' : 'medium'),
        style: event.style || career?.wrestler?.style || 'folkstyle',
        result,
        skipLeaderboard: true, // simulated runs never push to global ranks
      });
      // Wipe any in-flight bracket state for this event so the user can't
      // accidentally re-enter it from the resume hook.
      setTournamentState(null);
      setTournamentMatchInfo(null);
      setMatchState(null);
      clearTournament();
    } else if (event.type === 'dual_meet') {
      // Team-format career dual. Build a fully-resolved synthetic dual snapshot,
      // then route through the career-dual bridge so team metadata is recorded
      // alongside the hero-bout result.
      const simDual = simulateDualMeetEvent(career, event);
      try {
        const payload = recordCareerDualMeetResult(career, event.id, simDual);
        setActiveCareer(payload.nextCareer);
        const uid = auth.currentUser?.uid;
        if (uid) {
          saveCareer(uid, payload.nextCareer).catch(saveErr =>
            console.warn('[career] save after dual_meet sim failed:', saveErr?.message)
          );
        }
      } catch (err) {
        console.warn('[career] simulateDualMeetEvent record failed:', err?.message);
        return;
      }
    } else {
      // Legacy 'dual' / 'invitational' / exhibition - single-match event.
      const sim = simulateDualEvent(career, event);
      let nextCareer;
      try {
        nextCareer = recordCareerEventResult(career, event.id, {
          playerWon: sim.playerWon,
          p1Score: sim.p1Score,
          p2Score: sim.p2Score,
          winMethod: sim.winMethod,
        });
      } catch (err) {
        console.warn('[career] simulateDualEvent record failed:', err?.message);
        return;
      }
      setActiveCareer(nextCareer);
      const uid = auth.currentUser?.uid;
      if (uid) {
        saveCareer(uid, nextCareer).catch(err =>
          console.warn('[career] save after sim failed:', err?.message)
        );
      }
    }
    setSelectedCareerEvent(null);
    setScreen('career_dashboard');
  }, [tournamentState, finalizeCareerTournamentResult, setScreen]);

  const handleContinueTournament = () => {
    if (!tournamentState || !matchState) return;
    const playerWon = matchState.winner === 'p1';
    const result = {
      playerWon,
      p1Score: matchState.p1.score,
      p2Score: matchState.p2.score,
      winMethod: matchState.winMethod || 'decision',
    };
    const updated = advanceMatch(tournamentState, result);
    setTournamentState({ ...updated });
    setTournamentMatchInfo(null);
    setMatchState(null);
    setScreen('tournament');
    // Feature 9: re-snapshot after every advance. Clearing happens at the
    // tournament-complete branch below.
    if (updated.careerEventId && !updated.playerEliminated && updated.phase !== 'complete') {
      const uid = auth.currentUser?.uid;
      const cid = activeCareerRef.current?.id;
      if (uid && cid) saveCareerTournament(uid, cid, updated).catch(() => {});
    }

    // Per-match interim career record update for career-mode tournaments.
    // Without this, the player's overall W/L counter only ticks up at
    // tournament END (via recordCareerEventResult below), so winning the
    // first 3 matches of a 4-match bracket doesn't reflect on the career
    // dashboard until the bracket finishes. Each call increments career
    // wins/losses + per-method counters and stamps the schedule event with
    // `interimMatchesAccounted: true`, which the end-of-tournament
    // recordEventResult call respects so the aggregate add is suppressed
    // (no double-counting).
    if (updated.careerEventId) {
      const career = activeCareerRef.current;
      if (career) {
        const interimResult = { playerWon, winMethod: result.winMethod };
        // Career Depth Pass v1: thread the bracket opponent's stable npcId
        // so per-round H2H against a tracked rival lands on the rival's
        // counter (was broken: tournament rounds never updated H2H).
        const opponentNpcId = tournamentMatchInfoRef.current?.opponent?.rankPoolId
          || tournamentMatchInfoRef.current?.opponent?.npcId
          || null;
        const nextCareer = applyInterimTournamentMatch(career, updated.careerEventId, interimResult, {
          opponentNpcId,
        });
        if (nextCareer !== career) {
          setActiveCareer(nextCareer);
          const uid = auth.currentUser?.uid;
          if (uid) {
            saveCareer(uid, nextCareer).catch(err =>
              console.warn('[career] interim per-match save failed:', err?.message)
            );
          }
        }
      }
    }

    // Save tournament history when tournament ends
    if (updated.phase === 'complete' || updated.playerEliminated) {
      // Correct bracket-aware placement (1, 2, 3, 5, 9, 17).
      // Legacy code emitted only 1/3/5 and never surfaced 2nd-place, and
      // collapsed every R16/R32 finish into "5". Using playerRoundsToWin
      // (not totalRounds) keeps the 24-bracket byes from shifting the math.
      const bracketSize = updated.bracket?.length || 8;
      const placement = computePlacement({
        playerEliminated: updated.playerEliminated,
        roundsWon: updated.roundsWon || 0,
        playerRoundsToWin: updated.playerRoundsToWin,
        bracketSize,
      });

      // Career-tagged tournament: feed the placement back into career mode
      // via recordEventResult. Skip the standalone tournament history /
      // leaderboard pushes - those are for the standalone tournament feature.
      if (updated.careerEventId) {
        const career = activeCareerRef.current;
        if (career) {
          try {
            const playerWon = placement === 1;
            const winMethod = placement === 1 ? 'champion' : 'decision';
            // Count individual bracket matches: scan WB + LB + true_finals +
            // consolation matches. Each match the player participated in counts
            // exactly once, even if it crossed brackets. Pin / tech / major
            // counts come from match.winMethod on player's wins.
            const playerSeed = updated.playerSeed;
            const allMatches = [
              ...(updated.matches || []),
              ...(updated.losersMatches || []),
              ...(updated.trueFinals ? [updated.trueFinals] : []),
              ...(updated.consolationMatch ? [updated.consolationMatch] : []),
            ];
            let matchesWon = 0;
            let matchesLost = 0;
            let pinsInTournament = 0;
            let techsInTournament = 0;
            let majorsInTournament = 0;
            for (const m of allMatches) {
              if (!m || m.winner === null || m.winner === undefined) continue;
              const inMatch = (m.bracketSlots?.[0] === playerSeed) || (m.bracketSlots?.[1] === playerSeed);
              if (!inMatch) continue;
              if (m.winner === playerSeed) {
                matchesWon += 1;
                if (m.winMethod === 'pin') pinsInTournament += 1;
                else if (m.winMethod === 'tech_fall' || m.winMethod === 'tech') techsInTournament += 1;
                else if (m.winMethod === 'major_decision' || m.winMethod === 'major') majorsInTournament += 1;
              } else {
                matchesLost += 1;
              }
            }
            const stashedMods = readCareerMatchModifiers(career.id, updated.careerEventId);
            const consumedBuffSourceIds = stashedMods?.consumedBuffSourceIds || [];
            const nextCareer = recordCareerEventResult(career, updated.careerEventId, {
              playerWon,
              p1Score: 0,
              p2Score: 0,
              winMethod,
              placement,
              matchesWon,
              matchesLost,
              pinsInTournament,
              techsInTournament,
              majorsInTournament,
              // Career Depth Pass v1: forward the modifiers stashed at
              // tournament-start so the buff is consumed exactly once for
              // the whole tournament event. Tag-validated read returns null
              // if the stash is from a different career or event, so a stale
              // ref cannot contaminate this result.
              consumedBuffSourceIds,
            });
            // Clear only AFTER successful record. If recordCareerEventResult
            // had thrown, the stash must survive so a retry can still consume.
            clearCareerMatchModifiers();
            setActiveCareer(nextCareer);
            const uid = auth.currentUser?.uid;
            if (uid) {
              saveCareer(uid, nextCareer).catch(err =>
                console.warn('[career] save after tournament failed:', err?.message)
              );
            }

            // Career-tournament leaderboard push. Mirrors the regular-tournament
            // path below: increments profile.tournament_points/wins/streak and
            // writes the 3 leaderboard entries. Without this, career tournament
            // wins are invisible to the global leaderboard.
            if (uid && wrestlerProfile && matchesWon > 0) {
              (async () => {
                try {
                  const prevCur  = wrestlerProfile.tournament_streak_cur  || 0;
                  const prevBest = wrestlerProfile.tournament_streak_best || 0;
                  const peakThisTournament = prevCur + matchesWon;
                  const newCur  = (matchesLost > 0) ? 0 : peakThisTournament;
                  const newBest = Math.max(prevBest, peakThisTournament);
                  const pointsEarned = computeTournamentPoints({
                    placement,
                    bracketSize,
                    difficulty: updated.difficulty || 'medium',
                  });
                  const patch = {
                    tournament_points:      (wrestlerProfile.tournament_points || 0) + pointsEarned,
                    tournament_wins:        (wrestlerProfile.tournament_wins   || 0) + matchesWon,
                    tournament_streak_cur:  newCur,
                    tournament_streak_best: newBest,
                  };
                  console.log('[Career-Leaderboard]', {
                    matchesWon, matchesLost, placement, bracketSize,
                    pointsEarned, newTournamentWins: patch.tournament_wins,
                  });
                  const savedProfile = await saveProfile(uid, patch);
                  setWrestlerProfile(savedProfile);
                  const { updateTournamentLeaderboards } = await import('../lib/leaderboardService.js');
                  updateTournamentLeaderboards(uid, savedProfile).catch(() => {});
                } catch (lbErr) {
                  console.warn('[Career-Tournament] leaderboard update failed:', lbErr);
                }
              })();
            }
          } catch (err) {
            console.warn('[career] recordEventResult (tournament) failed:', err?.message);
            try {
              import('@/components/ui/use-toast').then(({ toast }) => {
                toast({
                  title: 'Career save failed',
                  description: err?.message || "Couldn't record tournament result.",
                  variant: 'destructive',
                });
              }).catch(() => {});
            } catch (_e) { /* ignore */ }
          }
        }
        // Tournament complete or player eliminated - clear the resume snapshot.
        const uid = auth.currentUser?.uid;
        const cid = activeCareerRef.current?.id;
        if (uid && cid) clearCareerTournament(uid, cid);

        setSelectedCareerEvent(null);
        setTournamentState(null);
        setScreen('career_dashboard');
        return;
      }

      const pointsEarned = computeTournamentPoints({
        placement,
        bracketSize,
        difficulty: updated.difficulty,
      });
      const matchWins = updated.roundsWon || 0;

      saveTournamentResult({
        playerName: updated.bracket?.[updated.playerSeed]?.name || 'Player',
        placement,
        rounds: matchWins,
        wins: matchWins,
        losses: updated.playerEliminated ? 1 : 0,
        style: updated.wrestlingStyle,
        difficulty: updated.difficulty,
        bracketSize,
        format: updated.format || 'single',
        pointsEarned,
      });

      // Cloud-backed counters + leaderboard push - signed-in users only.
      // Guest mode keeps the localStorage-only history (same as before).
      console.log('[Tournament-Leaderboard]', {
        uid: user?.uid || null,
        hasProfile: !!wrestlerProfile,
        matchWins,
        playerEliminated: updated.playerEliminated,
      });
      if (user?.uid && wrestlerProfile) {
        (async () => {
          try {
            const prevCur = wrestlerProfile.tournament_streak_cur || 0;
            const prevBest = wrestlerProfile.tournament_streak_best || 0;
            // The run-through-this-tournament contributes `matchWins` to the
            // current streak before the final loss (if any) resets it.
            const peakThisTournament = prevCur + matchWins;
            const newCur = updated.playerEliminated ? 0 : peakThisTournament;
            const newBest = Math.max(prevBest, peakThisTournament);

            const patch = {
              tournament_points: (wrestlerProfile.tournament_points || 0) + pointsEarned,
              tournament_wins:   (wrestlerProfile.tournament_wins   || 0) + matchWins,
              tournament_streak_cur: newCur,
              tournament_streak_best: newBest,
            };
            const savedProfile = await saveProfile(user.uid, patch);
            setWrestlerProfile(savedProfile);
            // Fire-and-forget leaderboard push (3 docs).
            import('../lib/leaderboardService.js').then(({ updateTournamentLeaderboards }) => {
              updateTournamentLeaderboards(user.uid, savedProfile).catch(() => {});
            }).catch(() => {});
          } catch (err) {
            console.warn('[Tournament] leaderboard update failed:', err);
          }
        })();
      }
    }
  };

  // ── Dual Meet Mode ──────────────────────────────────────────────────────────

  // Kick off a fresh dual. `config` is the object returned by DualSetupScreen:
  //   { mode, difficulty, heroWeightClass, playerTeamName, opponentTeamName, lineupMode }
  const startDual = (config) => {
    const DEFAULT_STATS = { str: 60, spd: 60, tec: 60, end: 60, grt: 60 };
    const profile = wrestlerProfile || {
      username: 'Guest',
      stats: DEFAULT_STATS,
      appearance: null,
    };
    const dual = createDualMeet(profile, config);
    setDualMeetState(dual);
    saveDual(dual);
    // Route straight into the first bout so 'Start Dual' feels decisive.
    handleDualStartBoutFor(dual);
    try { logEvent('dual_start', { mode: config.mode, difficulty: config.difficulty, hero_weight: config.heroWeightClass, wrestling_style: config.style }); } catch { /* noop */ }
  };

  // Hydrate a match engine for the dual's current bout and push to the game
  // screen. Split from handleDualStartBout so startDual can call it with a
  // freshly-created state object (setState hasn't flushed yet).
  const handleDualStartBoutFor = (dual) => {
    if (!dual || dual.phase === 'complete') return;
    const bout = dual.bouts[dual.currentBoutIndex];
    if (!bout) return;
    const mode = dual.mode === 'hotseat' ? 'dual_hotseat' : 'dual_cpu';
    const p1Name = bout.playerWrestler.name;
    const p2Name = bout.opponentWrestler.name;
    const style = dual.wrestlingStyle || 'folkstyle';
    const p1Stats = bout.playerWrestler.stats;
    const p2Stats = bout.opponentWrestler.stats;
    const aiDiff = dual.difficulty || 'medium';

    [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
    matchSavedRef.current = false;
    wasTrailingRef.current = false;
    maxDeficitRef.current = 0;
    humanMaxPeriodPointsRef.current = 0;
    humanCurrentPeriodPointsRef.current = 0;
    lastHumanScoreRef.current = 0;
    lastPeriodRef.current = 1;

    const initial = createInitialMatchState(p1Name, p2Name, style, p1Stats, p2Stats, aiDiff);

    setHumanPlayer('p1');
    setGameMode(mode);
    setMatchState(initial);
    setP1Selected(null);
    setP2Selected(null);
    setP1SkillResult(null);
    setP2SkillResult(null);
    setPendingChallenge(null);
    setPinOffenseChoice(null);
    setPinDefenseChoice(null);
    setPostMatchData(null);
    setNetworkPlayer(null);
    setNetworkPickSent(false);
    setPickAcknowledged(false);
    setNetworkError(null);
    setOpponentDisconnected(false);
    setResolving(false);
    setLocalTurn('p1');
    setShowPassDevice(mode === 'dual_hotseat');
    setP1Hand(handFor('p1',initial.p1.position, initial.p1Conditions, style));
    setP2Hand(handFor('p2',initial.p2.position, initial.p2Conditions, style));
    replayRef.current = createReplay({
      p1Name, p2Name, style, difficulty: aiDiff, gameMode: mode,
      p1Stats, p2Stats, initiative: initial.initiative,
    });
    setScreen('game');
    try { logEvent('dual_bout_start', { weight: bout.weight, bout_index: dual.currentBoutIndex }); } catch { /* noop */ }
  };

  const handleDualStartBout = () => handleDualStartBoutFor(dualMeetRef.current);

  // Called from the match-end modal's "Continue" path when a dual is active.
  // Records the bout result into dualMeetState, then routes to the scoreboard
  // (or the final result screen when bout 10 wraps up).
  const handleContinueDual = () => {
    const dual = dualMeetRef.current;
    if (!dual || !matchState) return;
    const playerWon = matchState.winner === 'p1';
    const result = {
      playerWon,
      p1Score: matchState.p1?.score ?? 0,
      p2Score: matchState.p2?.score ?? 0,
      winMethod: matchState.winner === 'draw' ? 'draw' : (matchState.winMethod || 'decision'),
    };
    const updated = advanceDualBout(dual, result);
    setDualMeetState({ ...updated });
    saveDual(updated);
    setMatchState(null);
    clearMatchFromStorage();

    // Daily challenges: fire the dual-complete branch so meet-wide challenges
    // (win the dual, win 2+ bouts, finish a full card) can resolve. Per-bout
    // challenges already ran inside saveMatchResult.
    if (updated.phase === 'complete') {
      try {
        const playerBoutWins = updated.bouts.reduce(
          (n, b) => n + (b.result?.playerWon ? 1 : 0), 0
        );
        const winner = getDualWinner(updated);
        checkAllDailyChallenges(matchState || { winner: null, p1: {}, p2: {} }, {
          gameMode: updated.mode === 'hotseat' ? 'dual_hotseat' : 'dual_cpu',
          dualEvent: 'complete',
          dualResult: { winner, playerBoutWins, totalBouts: updated.bouts.length },
        });
      } catch (_e) { /* ignore - challenges are best-effort */ }
    }

    if (updated.phase === 'complete') {
      // Credit dual-meet completion bonus (CPU only; hotseat returns 0).
      const bonusXP = getDualMeetXPBonus(updated);
      if (bonusXP > 0) {
        (async () => {
          try {
            const uid = auth.currentUser?.uid;
            const base = uid ? (await getProfile(uid)) : loadGuestProfile();
            if (!base) return;
            const newXP = (base.xp || 0) + bonusXP;
            const newLevel = getLevelFromXP(newXP);
            const oldLevel = base.level || 1;
            const statPointsGained = Math.max(0, newLevel - oldLevel);
            const patched = {
              ...base,
              xp: newXP,
              level: newLevel,
              stat_points_available: (base.stat_points_available || 0) + statPointsGained,
            };
            if (uid) {
              const saved = await saveProfile(uid, patched);
              setWrestlerProfile(saved);
            } else {
              setWrestlerProfile(patched);
              saveGuestProfile(patched);
            }
            try { logEvent('dual_meet_complete', { bonus_xp: bonusXP, winner: getDualWinner(updated), mode: updated.mode }); } catch { /* noop */ }
          } catch (err) {
            console.warn('[WrestlingGame] Dual bonus XP credit failed:', err?.message);
          }
        })();
      }
      setScreen('dual_result');
    } else {
      setScreen('dual_scoreboard');
    }
  };

  // Exit a dual cleanly (Quit button on scoreboard, result screen, or match).
  const exitDualMeet = () => {
    clearDual();
    setDualMeetState(null);
    setMatchState(null);
    clearMatchFromStorage();
    setScreen('menu');
  };

  // ── Career Dual Meet flow (Phase A) ──────────────────────────────────────
  // Pre-dual choice screen calls onChoose('my_match' | 'full_dual'). We build
  // the dual snapshot, persist via saveCareerDual (separate localStorage key
  // from the standalone matgrind_dual), and dispatch into the bout loop.

  // Hold the captured XP so the result screen reads it directly instead of
  // recomputing. recordCareerDualMeetResult returns { nextCareer, xpGained }
  // so the gain is exactly the XP that recordEventResult credited.
  const [careerDualResultPayload, setCareerDualResultPayload] = useState(null);

  const handleCareerDualMeetChoice = useCallback((choice) => {
    const career = activeCareerRef.current;
    const event = selectedCareerEventRef.current;
    if (!career || !event || event.type !== 'dual_meet') return;
    let dual;
    try {
      dual = createCareerDualMeet(career, event, choice);
    } catch (err) {
      console.warn('[career-dual] create failed:', err?.message);
      try {
        import('@/components/ui/use-toast').then(({ toast }) => {
          toast({
            title: 'Could not start dual',
            description: err?.message || 'Career weight class missing from dual table.',
            variant: 'destructive',
          });
        }).catch(() => {});
      } catch (_e) { /* ignore */ }
      setScreen('career_dashboard');
      return;
    }
    setDualMeetState(dual);
    saveCareerDual(dual);
    // For 'my_match', sim every bout up to the hero bout, then route to the
    // scoreboard so the player sees the prelude before stepping in.
    if (choice === 'my_match') {
      simulateNonHeroBouts(dual);
      setDualMeetState({ ...dual });
      saveCareerDual(dual);
      setScreen('career_dual_meet');
      return;
    }
    // 'full_dual': straight into the first bout.
    setScreen('career_dual_meet');
  }, [setScreen]);

  // Hydrate a match engine for a career-dual bout. Mirrors handleDualStartBoutFor
  // but stamps a career-dual game mode so saveMatchResult does NOT auto-record
  // the career event (the bridge records once at dual end).
  const handleStartCareerDualBoutFor = (dual) => {
    if (!dual || dual.phase === 'complete') return;
    const bout = dual.bouts[dual.currentBoutIndex];
    if (!bout) return;
    const mode = dual.lineupChoice === 'my_match' ? 'career_dual_my_match' : 'career_dual_full';
    const p1Name = bout.playerWrestler.name;
    const p2Name = bout.opponentWrestler.name;
    const style = dual.wrestlingStyle || 'folkstyle';
    let p1Stats = bout.playerWrestler.stats;
    const p2Stats = bout.opponentWrestler.stats;
    const aiDiff = dual.difficulty || 'medium';

    // Career Depth Pass v1: dual-meet whole-event modifier semantics.
    // Modifier compute, stats application, and stamina multiplier are ALL
    // gated on the hero bout. In `career_dual_full` mode the player launches
    // every bout, but only the hero bout is them - teammate bouts must run
    // with neutral inputs so a career stat debuff (or stamina hit) does not
    // bleed into NPC vs NPC bouts. Consumption happens on dual finalize.
    const careerNow = activeCareerRef.current;
    const isHeroBout = bout.playerWrestler?.isHero === true || mode === 'career_dual_my_match';
    let dualModifiers = readCareerMatchModifiers(careerNow?.id, dual.careerEventId);
    if (careerNow?.wrestler && isHeroBout && !dualModifiers) {
      dualModifiers = applyCareerMatchModifiers(careerNow.wrestler);
      stashCareerMatchModifiers(careerNow.id, dual.careerEventId, dualModifiers);
    }
    if (isHeroBout && dualModifiers) {
      p1Stats = dualModifiers.stats;
    }
    const p1StaminaMul = (isHeroBout && dualModifiers) ? dualModifiers.staminaMultiplier : 1.0;

    [resolveTimer, aiTimer, periodTimer, pinTimer].forEach(r => clearTimeout(r.current));
    matchSavedRef.current = false;
    wasTrailingRef.current = false;
    maxDeficitRef.current = 0;
    humanMaxPeriodPointsRef.current = 0;
    humanCurrentPeriodPointsRef.current = 0;
    lastHumanScoreRef.current = 0;
    lastPeriodRef.current = 1;

    const initial = createInitialMatchState(p1Name, p2Name, style, p1Stats, p2Stats, aiDiff, null, {
      p1StaminaMultiplier: p1StaminaMul,
    });
    setHumanPlayer('p1');
    setGameMode(mode);
    setMatchState(initial);
    setP1Selected(null);
    setP2Selected(null);
    setP1SkillResult(null);
    setP2SkillResult(null);
    setPendingChallenge(null);
    setPinOffenseChoice(null);
    setPinDefenseChoice(null);
    setPostMatchData(null);
    setNetworkPlayer(null);
    setNetworkPickSent(false);
    setPickAcknowledged(false);
    setNetworkError(null);
    setOpponentDisconnected(false);
    setResolving(false);
    setLocalTurn('p1');
    setShowPassDevice(false);
    setP1Hand(handFor('p1', initial.p1.position, initial.p1Conditions, style));
    setP2Hand(handFor('p2', initial.p2.position, initial.p2Conditions, style));
    replayRef.current = createReplay({
      p1Name, p2Name, style, difficulty: aiDiff, gameMode: mode,
      p1Stats, p2Stats, initiative: initial.initiative,
    });
    setScreen('game');
    try { logEvent('career_dual_bout_start', { weight: bout.weight, bout_index: dual.currentBoutIndex, lineup_choice: dual.lineupChoice }); } catch { /* noop */ }
  };

  const handleStartCareerDualBout = () => handleStartCareerDualBoutFor(dualMeetRef.current);

  // Shared finalizer for any code path that advances a career dual to
  // phase: 'complete' (engine match end, post-hero sim postlude in my_match,
  // mid-dual "Simulate Bout" button on the last remaining bout). Records
  // into the career via the bridge, persists, routes to the result screen.
  // Caller is responsible for any UI cleanup that happens AFTER finalization
  // (clearing matchState, clearMatchFromStorage, etc.).
  const finalizeCompletedCareerDual = (updatedDual) => {
    const career = activeCareerRef.current;
    if (!career) {
      console.warn('[career-dual] complete with no active career');
      setScreen('career_dashboard');
      return;
    }
    let payload;
    try {
      // Career Depth Pass v1: forward stashed sourceIds so dual-meet hero
      // bout buffs are consumed exactly once for the whole event. Tag-validated
      // read returns null if the stash is for a different career/event - in
      // that case the helper omits consumedBuffSourceIds and recordEventResult
      // leaves tempBuffs untouched (pure-sim semantics).
      const stashedMods = readCareerMatchModifiers(career.id, updatedDual.careerEventId);
      const consumedBuffSourceIds = stashedMods?.consumedBuffSourceIds;
      payload = recordCareerDualMeetResult(career, updatedDual.careerEventId, updatedDual, {
        consumedBuffSourceIds: Array.isArray(consumedBuffSourceIds) ? consumedBuffSourceIds : undefined,
      });
      // Clear only AFTER successful record. On failure the stash must survive
      // so a retry can still consume the buff that was applied to a played bout.
      clearCareerMatchModifiers();
    } catch (err) {
      console.warn('[career-dual] recordCareerDualMeetResult failed:', err?.message);
      try {
        import('@/components/ui/use-toast').then(({ toast }) => {
          toast({
            title: 'Career save failed',
            description: err?.message || 'Could not record dual result.',
            variant: 'destructive',
          });
        }).catch(() => {});
      } catch (_e) { /* ignore */ }
      clearCareerDual();
      setScreen('career_dashboard');
      return;
    }
    setActiveCareer(payload.nextCareer);
    const uid = auth.currentUser?.uid;
    if (uid) {
      saveCareer(uid, payload.nextCareer).catch(saveErr =>
        console.warn('[career-dual] save after dual failed:', saveErr?.message)
      );
    }
    setCareerDualResultPayload({
      dual: updatedDual,
      xpGained: payload.xpGained,
      teamWinner: payload.teamWinner,
      event: selectedCareerEventRef.current,
    });
    clearCareerDual();
    setScreen('career_dual_meet_result');
  };

  // Continue path from the match-end modal for career duals. Records the
  // bout, persists the snapshot, then either advances to the next bout
  // (full_dual) / sims the postlude (my_match) / finalizes the dual.
  const handleContinueCareerDualMeet = () => {
    const dual = dualMeetRef.current;
    if (!dual || !matchState) return;
    const playerWon = matchState.winner === 'p1';
    const result = {
      playerWon,
      p1Score: matchState.p1?.score ?? 0,
      p2Score: matchState.p2?.score ?? 0,
      winMethod: matchState.winner === 'draw' ? 'draw' : (matchState.winMethod || 'decision'),
    };
    let updated = advanceDualBout(dual, result);
    // For 'my_match': sim all bouts after the hero bout so the dual closes
    // out without requiring the player to play another match.
    if (updated.lineupChoice === 'my_match') {
      simulateNonHeroBouts(updated);
    }
    setDualMeetState({ ...updated });
    saveCareerDual(updated);
    setMatchState(null);
    clearMatchFromStorage();

    if (updated.phase !== 'complete') {
      // Between bouts (full_dual mode mid-flow). Land on the dual scoreboard
      // so the player can review and click Next Bout.
      setScreen('career_dual_meet');
      return;
    }
    finalizeCompletedCareerDual(updated);
  };

  // "Simulate Bout" button on the career dual scoreboard. Lets a `full_dual`
  // player skip an upcoming bout via dice instead of playing the engine for
  // every weight class - the user reported wanting to play 3-4 then sim the
  // rest to finish faster. Available only between bouts (phase === 'between').
  const handleSimulateCareerDualBout = () => {
    const dual = dualMeetRef.current;
    if (!dual || dual.phase === 'complete') return;
    if (dual.phase !== 'between') return;
    const updated = simulateOneBout(dual);
    setDualMeetState({ ...updated });
    saveCareerDual(updated);
    if (updated.phase === 'complete') {
      finalizeCompletedCareerDual(updated);
      return;
    }
    // Stay on the scoreboard so the player can review the result and pick
    // either Start Next Bout or Simulate Bout again.
    setScreen('career_dual_meet');
  };

  // Quit a career dual cleanly without recording the result (drops the
  // snapshot). Used by the in-game "Quit" button on the result modal.
  //
  // Privately increments career.record.aborts so we can identify systematic
  // retry-on-loss patterns without changing gameplay or surfacing the count
  // in the UI. Only fires when there is an in-flight dual snapshot AND the
  // event is still 'upcoming' (i.e. the player is bailing on a started but
  // unrecorded match), otherwise it is a no-op.
  const exitCareerDualMeet = () => {
    try {
      const dual = dualMeetState;
      const eventId = dual?.careerEventId || selectedCareerEvent?.id || null;
      const sched = activeCareer?.schedule?.events;
      const evt = Array.isArray(sched) && eventId
        ? sched.find(e => e?.id === eventId)
        : null;
      const isInFlight = !!dual && dual.phase !== 'complete' && evt?.status === 'upcoming';
      if (isInFlight && activeCareer && eventId) {
        const next = recordCareerDualAbort(activeCareer, eventId, evt?.name || null, 'dual_meet');
        setActiveCareer(next);
        if (user?.uid) saveCareer(user.uid, next).catch(() => { /* noop */ });
      }
    } catch (_e) { /* never block the quit on telemetry */ }
    // Career Depth Pass v1: dual abort skips finalize entirely, so the only
    // way to scrub the stash here is an explicit clear. If the player resumes
    // the dual later, applyCareerMatchModifiers rebuilds the stash from
    // career.wrestler.tempBuffs (buffs are still pending since no record).
    clearCareerMatchModifiers();
    clearCareerDual();
    setDualMeetState(null);
    setMatchState(null);
    clearMatchFromStorage();
    setSelectedCareerEvent(null);
    setCareerDualResultPayload(null);
    setScreen('career_dashboard');
  };

  // Handle incoming WebSocket messages from game server
  // Uses refs (matchStateRef, playSoundRef) to access current values from stale closure
  const handleNetworkMessage = (msg) => {
    // ── Authoritative-server protocol ──────────────────────────
    // The server (LAN or online) is the only resolver. Clients render
    // state_update + drive challenge UI; they never run resolveRound.
    if (msg.type === 'state_update') {
      // Capture roundSeq for outgoing intent tagging. Drop stale frames.
      if (Number.isInteger(msg.roundSeq)) {
        if (msg.roundSeq < currentRoundSeqRef.current) {
          console.warn('[NET] dropping stale state_update', {
            received: msg.roundSeq, current: currentRoundSeqRef.current,
          });
          return;
        }
        // 2nd-pass review fix: when the round advances, the last-picked
        // card from the prior round is stale. Clear so a future
        // challenge_start (e.g. across a rematch) can't accidentally
        // mount the mini-game with the wrong card.
        if (msg.roundSeq > currentRoundSeqRef.current) {
          lastPickedCardRef.current = null;
          setAwaitingChallengeStart(false);
          // Clear any transient mid-round notice (e.g. cancelled-MISS
          // banner) - the round has advanced, the notice is no longer
          // relevant.
          setNetworkNotice(null);
        }
        currentRoundSeqRef.current = msg.roundSeq;
        // First state_update flips this true so the picker UI unlocks.
        // Without this gate, a click before the first state_update would
        // fire card_pick with roundSeq=null and the server would reject.
        if (msg.roundSeq >= 1) setServerRoundReady(true);
      }
      // Server-supplied per-card challenge params (online authoritative).
      preGeneratedChallengesRef.current = msg.preGeneratedChallenges || {};
      // Capture the prior pin stage BEFORE matchStateRef gets overwritten
      // with newState. Used below to detect stage advances within a
      // pin_attempt so local pin choices clear (otherwise the modal
      // shows "Ready" carried over from the prior stage and the user
      // can't pick stage-2 / stage-3 cards - frozen round).
      const prevPinStage = matchStateRef.current?.pinAttempt?.stage ?? null;
      const newState = msg.state;
      setMatchState(newState);
      matchStateRef.current = newState;
      setNetworkPickSent(false);
      setPickAcknowledged(false);
      setResolving(false);
      // Update both the React state (for render) AND the synchronous ref
      // (so the immediately-following challenge_start handler can resolve
      // the card from the freshest hand without waiting for a re-render).
      const role = networkPlayerRef.current;
      const incomingHand = msg.hand || [];
      setNetworkPlayer(prev => {
        if (prev === 'p1') {
          setP1Hand(incomingHand);
          p1HandRef.current = incomingHand;
        } else if (prev === 'p2') {
          setP2Hand(incomingHand);
          p2HandRef.current = incomingHand;
        }
        return prev;
      });
      // Defensive: in case role flipped or spectator, sync via current role too.
      if (role === 'p1') p1HandRef.current = incomingHand;
      else if (role === 'p2') p2HandRef.current = incomingHand;
      // Pin choices clear in two cases:
      //   (a) leaving the pin_attempt phase entirely (escape, pin success, period break)
      //   (b) staying in pin_attempt but the stage advanced (1->2, 2->3) - the
      //       prior stage's cardId is no longer the local pick; the modal
      //       must re-show the picker so the user can choose a stage-N card.
      const newPinStage = newState.pinAttempt?.stage ?? null;
      if (newState.phase !== 'pin_attempt') {
        setPinOffenseChoice(null);
        setPinDefenseChoice(null);
      } else if (
        prevPinStage !== null && newPinStage !== null && newPinStage !== prevPinStage
      ) {
        setPinOffenseChoice(null);
        setPinDefenseChoice(null);
      }
      // Sound + haptic + impact-shake feedback for the just-resolved round.
      // Mirrors the offline local-resolve mapping so online and offline
      // matches feel the same when a takedown lands. Driven by the engine's
      // `lastResult.type` which the server-authoritative state_update carries.
      const rt = newState.lastResult?.type;
      if (rt) {
        const soundMap = {
          takedown: 'takedown', escape: 'escape', reversal: 'reversal',
          near_fall: 'near_fall', exposure: 'near_fall', pin: 'pin',
          counter: 'counter', scramble: 'scramble', stalemate: 'stalemate',
          setup: 'setup', control: 'setup', leg_attack_secured: 'takedown',
          grand_amplitude: 'takedown', pin_attempt_trigger: 'near_fall',
          takedown_near_fall: 'takedown',
        };
        playSoundRef.current(soundMap[rt] || 'card_play');
        const hapticMap = {
          takedown: 'heavy', grand_amplitude: 'heavy', reversal: 'heavy',
          takedown_near_fall: 'heavy', leg_attack_secured: 'heavy',
          escape: 'medium', counter: 'medium', scramble: 'medium',
          near_fall: 'warning', exposure: 'warning', pin_attempt_trigger: 'warning',
          pin: 'error',
          stalemate: 'light', setup: 'light', control: 'light',
        };
        const hType = hapticMap[rt];
        if (hType && haptic[hType]) haptic[hType]();
        const shakeMap = {
          takedown: 'heavy', grand_amplitude: 'heavy', reversal: 'heavy',
          takedown_near_fall: 'heavy', leg_attack_secured: 'heavy',
          pin: 'heavy',
          near_fall: 'medium', exposure: 'medium', pin_attempt_trigger: 'medium',
          escape: 'light', counter: 'light', scramble: 'light',
        };
        const shakeIntensity = shakeMap[rt];
        if (shakeIntensity) {
          setImpactIntensity(shakeIntensity);
          setImpactCounter(c => c + 1);
        }
      }
      if (newState.phase === 'period_break') { playSoundRef.current('period_buzzer'); haptic.warning(); }
      if (newState.phase === 'finished') playSoundRef.current('match_end');
    }

    // ── Authoritative-server challenge protocol ──────────────────────────
    // Server starts a challenge for the picking client; client mounts the
    // mini-game NOW using the server-supplied params. For Reaction the
    // params are server-secret; visuals are driven by challenge_prompt
    // arrivals (mapped directly to phase = fake | waiting | go).
    if (msg.type === 'challenge_start') {
      if (Number.isInteger(msg.roundSeq) && msg.roundSeq !== currentRoundSeqRef.current) {
        console.warn('[NET] dropping stale challenge_start', {
          challengeRoundSeq: msg.roundSeq,
          current: currentRoundSeqRef.current,
          cardId: msg.cardId,
        });
        if (msg.roundSeq < currentRoundSeqRef.current) {
          setAwaitingChallengeStart(false);
        }
        return;
      }
      // (cardId is consumed inline below for the fallback hand-lookup;
      // not stashed on activeChallengeRef so no consumer can drift to
      // a stale value if the server later changes the protocol.)
      activeChallengeRef.current = {
        id: msg.challengeId,
        kind: msg.kind,
        params: msg.params,                       // null for reaction
        deadline: msg.deadline,
      };
      // Reaction starts in 'waiting' until the server fires reaction_go
      // (or reaction_fake_show first if there's a fake-out).
      if (msg.kind === 'reaction') {
        setServerReactionPhase('waiting');
      }
      // Mount the mini-game NOW. Card identity is resolved in priority:
      //   1. lastPickedCardRef.current (same-session selection)
      //   2. lookup by msg.cardId in the local hand REF (not state) so a
      //      back-to-back state_update -> challenge_start can resolve
      //      against the freshest hand without waiting for a render.
      // Without #2, a reconnect mid-challenge would never re-render the
      // mini-game and the user would see no UI for the active challenge.
      const role = networkPlayerRef.current;
      const side = role === 'p1' ? 'p1' : 'p2';
      const handRef = role === 'p1' ? p1HandRef.current : p2HandRef.current;
      const card = lastPickedCardRef.current
        || (msg.cardId ? handRef.find(c => c.id === msg.cardId) : null);
      if (card) {
        setPendingChallenge({ card, side });
      } else {
        // 3rd-pass review: this is data loss for the user (they'll sit
        // looking at a static board until the server's deadline fires
        // MISS), so escalate to error and surface a recoverable UI hint.
        console.error('[NET] challenge_start could not resolve card', {
          cardIdFromMsg: msg.cardId,
          hasLastPicked: !!lastPickedCardRef.current,
          handSize: handRef.length,
        });
        setNetworkError('Skill challenge UI failed to render. Match continues; this round will be MISS.');
      }
      // We've started the mini-game; we're no longer in the
      // pre-challenge RTT gap.
      setAwaitingChallengeStart(false);
      return;
    }
    if (msg.type === 'challenge_prompt') {
      if (activeChallengeRef.current?.id !== msg.challengeId) return;
      // Codex-recommended direct mapping (not derived from log scan):
      //   reaction_fake_show -> 'fake'
      //   reaction_fake_hide -> 'waiting'
      //   reaction_go        -> 'go'
      if (msg.kind === 'reaction_fake_show') setServerReactionPhase('fake');
      else if (msg.kind === 'reaction_fake_hide') setServerReactionPhase('waiting');
      else if (msg.kind === 'reaction_go') setServerReactionPhase('go');
      return;
    }
    if (msg.type === 'challenge_resolved') {
      console.log('[NET RECV] challenge_resolved', { tier: msg.tier, cancelled: !!msg.cancelled });
      activeChallengeRef.current = null;
      lastPickedCardRef.current = null;
      setPendingChallenge(null);
      setServerReactionPhase(null);
      setAwaitingChallengeStart(false);
      // 4th-pass review (Codex P1): the server sends synthetic
      // challenge_resolved with cancelled=true on reconnect when the
      // prior disconnect cancelled the active challenge to MISS. If that
      // cancelled pick is still waiting on the opponent, the preceding
      // state_update reset networkPickSent/pickAcknowledged to false,
      // which would unlock the picker and let the user double-submit
      // (server then rejects with already_picked, which looks like a hang).
      // Re-lock only when the server says this cancelled pick is still
      // locking the CURRENT round. If the opponent resolved the round while
      // we were offline, the synthetic message is just context for the
      // already-advanced state_update and must not disable the new hand.
      if (msg.cancelled) {
        const sameRound = !Number.isInteger(msg.roundSeq) || msg.roundSeq === currentRoundSeqRef.current;
        const shouldLockPicker = msg.pickLocked !== false && sameRound;
        if (shouldLockPicker) {
          setNetworkPickSent(true);
          setPickAcknowledged(true);
        }
        // Surface a TRANSIENT notice (not networkError) so the user
        // understands their pick was downgraded to MISS by the
        // disconnect. networkError is reserved for terminal connection
        // failures. Wording differs by round-state:
        //   - sameRound + lock still active: the round is still in flight
        //     and this user's pick is locked in as MISS.
        //   - round already advanced while offline: the notice is just
        //     context for a score change the user is now seeing.
        setNetworkNotice(shouldLockPicker
          ? 'Disconnect during skill challenge - this round will be MISS for you.'
          : 'A prior round was MISS due to a disconnect.');
      }
      return;
    }
    if (msg.type === 'error') {
      // Server-side validation rejection. Transient codes are silent
      // (UI will recover on the next state_update); show user-facing
      // ones only.
      console.warn('[NET RECV] error', { code: msg.code, message: msg.message });
      const userVisible = ['high_rtt_warning', 'auth_timeout', 'not_authenticated'];
      if (userVisible.includes(msg.code)) {
        setNetworkError(msg.message || msg.code);
      }
      // Pin-pick rejection recovery: if a pin_pick was rejected (burned
      // card, illegal_card, etc.), the local pinOffenseChoice / Defense
      // is set to the (now invalid) cardId and the modal renders "Ready"
      // even though the server has no record of the pick. Reset the
      // local choice so the user can re-pick. Be conservative: only
      // reset if we're actually in a pin_attempt phase to avoid
      // clobbering unrelated mid-round state.
      const pinErrorCodes = ['pin_card_burned', 'illegal_card', 'not_your_turn', 'wrong_phase', 'already_picked', 'wrong_round', 'invalid_payload'];
      if (pinErrorCodes.includes(msg.code) && matchStateRef.current?.phase === 'pin_attempt') {
        const me = networkPlayerRef.current;
        const attacker = matchStateRef.current?.pinAttempt?.attacker;
        if (me === attacker) setPinOffenseChoice(null);
        else setPinDefenseChoice(null);
      }
      return;
    }

    // ── Reroll responses (online only) ────────────────────────────────
    // The local side asked for a reroll → server validated + decremented
    // → echo back. We mirror the budget locally and redraw THIS side's
    // hand. Hands are private per side, so the server doesn't sync the
    // contents - each client rebuilds from its own pool.
    if (msg.type === 'reroll_granted') {
      const currentState = matchStateRef.current;
      if (!currentState) return;
      const me = networkPlayerRef.current;
      if (me !== 'p1' && me !== 'p2') return;
      const myHand = me === 'p1' ? p1Hand : p2Hand;
      const wrestler = currentState[me];
      const conditions = currentState[`${me}Conditions`] || [];
      const newHand = rerollFor(me, myHand, wrestler.position, conditions, currentState.wrestlingStyle);
      const next = {
        ...currentState,
        rerollsLeft: {
          ...currentState.rerollsLeft,
          [me]: typeof msg.rerollsLeft === 'number' ? msg.rerollsLeft : (currentState.rerollsLeft?.[me] ?? 0) - 1,
        },
      };
      setMatchState(next);
      matchStateRef.current = next;
      if (me === 'p1') setP1Hand(newHand);
      else setP2Hand(newHand);
    }

    // Opponent rerolled - mirror their budget so our UI stays accurate,
    // but don't touch their hand (we don't see it anyway).
    if (msg.type === 'opponent_rerolled') {
      const currentState = matchStateRef.current;
      if (!currentState) return;
      const otherSide = msg.role === 'p1' ? 'p1' : msg.role === 'p2' ? 'p2' : null;
      if (!otherSide) return;
      const next = {
        ...currentState,
        rerollsLeft: {
          ...currentState.rerollsLeft,
          [otherSide]: typeof msg.rerollsLeft === 'number'
            ? msg.rerollsLeft
            : Math.max(0, (currentState.rerollsLeft?.[otherSide] ?? 0) - 1),
        },
      };
      setMatchState(next);
      matchStateRef.current = next;
    }

    // (Obsolete period_choice_made handler removed - server now applies
    // the choice and broadcasts the resulting state via state_update.)

    // ── Referee / stalling mirror ────────────────────────────────────
    // Server-side emission is out of scope for this phase, but clients
    // handle the message defensively so a future server upgrade just
    // works. Payload: { playerKey: 'p1'|'p2', stallCount, penaltyAwarded,
    // round? }. We apply the delta to the mirrored match state.
    if (msg.type === 'referee_call') {
      const currentState = matchStateRef.current;
      if (!currentState) return;
      const pk = msg.playerKey;
      if (pk !== 'p1' && pk !== 'p2') return;
      const opp = pk === 'p1' ? 'p2' : 'p1';
      const next = {
        ...currentState,
        stallCount: {
          ...(currentState.stallCount || { p1: 0, p2: 0 }),
          [pk]: typeof msg.stallCount === 'number'
            ? msg.stallCount
            : (currentState.stallCount?.[pk] || 0) + 1,
        },
      };
      if (msg.penaltyAwarded) {
        next[opp] = {
          ...currentState[opp],
          score: (currentState[opp].score || 0) + (msg.penaltyAwarded || 1),
        };
        // Reset the offending player's count after a penalty, matching
        // checkStalling's local behavior.
        next.stallCount[pk] = 0;
        next.lastResult = {
          ...(currentState.lastResult || {}),
          type: 'stalling_penalty',
          message: `${pk.toUpperCase()} called for stalling - ${msg.penaltyAwarded || 1} point(s) to ${opp.toUpperCase()}`,
        };
      } else {
        next.lastResult = {
          ...(currentState.lastResult || {}),
          type: 'stalling_warning',
          message: `Stalling warning ${next.stallCount[pk]} on ${pk.toUpperCase()}`,
        };
      }
      setMatchState(next);
      matchStateRef.current = next;
    }

    // ── Shared protocol messages ─────────────────────────────────────
    if (msg.type === 'pick_acknowledged') {
      setPickAcknowledged(true);
    }
    if (msg.type === 'opponent_disconnected') {
      setOpponentDisconnected(true);
    }
    if (msg.type === 'opponent_reconnected') {
      setOpponentDisconnected(false);
    }

    // ── Stage 4: server-authoritative reward settlement ──────────────
    // The server computed and persisted online wins/XP/achievements in one
    // transaction, then pushed this trusted receipt. The client only DISPLAYS
    // and SUBMITS it - it never claims online progression. Deduped by matchId so
    // a duplicate/late push (or a fallback read racing it) cannot double-apply.
    if (msg.type === 'match_settled') {
      if (shouldApplySettlement(onlineSettledRef.current, msg.matchId)) {
        onlineSettledRef.current.add(msg.matchId);
        const earnedIds = Array.isArray(msg.achievementIds) ? msg.achievementIds : [];
        const earnedObjs = resolveAchievementObjects(earnedIds, ACHIEVEMENTS);
        // Merge the server-awarded online achievements into the modal's badge
        // list (dedupe by id) and stash the trusted receipt for display.
        setPostMatchData(prev => {
          const base = prev || {};
          const existing = Array.isArray(base.newAchievements) ? base.newAchievements : [];
          const seen = new Set(existing.map((a) => a?.id));
          return {
            ...base,
            newAchievements: existing.concat(earnedObjs.filter((a) => !seen.has(a.id))),
            onlineSettled: {
              xpEarned: msg.xpEarned,
              achievementIds: earnedIds,
              onlineProgress: msg.onlineProgress || null,
            },
          };
        });
        // Submit trusted online wins + unlock the earned achievements on Game
        // Center (best-effort). Values come from the server receipt, not the client.
        import('../lib/gameCenter.js').then(({ gcSubmitOnlineWins, gcUnlockEarnedAchievements }) => {
          gcSubmitOnlineWins(trustedOnlineWins(msg.onlineProgress)).catch(() => {});
          gcUnlockEarnedAchievements(earnedIds).catch(() => {});
        }).catch(() => {});
      }
    }

    // Stage 4 fallback: a reconnect may mean we missed a match_settled push.
    // online_progress is keyed by uid (no matchId needed) - re-read the trusted
    // totals and re-submit the online wins + cumulative achievements to Game Center.
    if (msg.type === 'reconnected' && networkModeRef.current === 'online') {
      const reconnectUid = auth.currentUser?.uid;
      if (reconnectUid) {
        getOnlineProgress(reconnectUid).then((op) => {
          if (!op) return;
          const cumulativeIds = Array.isArray(op.achievementIds) ? op.achievementIds : [];
          import('../lib/gameCenter.js').then(({ gcSubmitOnlineWins, gcUnlockEarnedAchievements }) => {
            gcSubmitOnlineWins(trustedOnlineWins(op)).catch(() => {});
            // Cumulative trusted achievement ids; Game Center unlocks are idempotent.
            gcUnlockEarnedAchievements(cumulativeIds).catch(() => {});
          }).catch(() => {});
        }).catch(() => {});
      }
    }

    if (msg.type === 'match_voided' || msg.type === 'room_expired') {
      // 2nd-pass review fix: clear stashed picked card so a stale ref
      // can't survive a void into a future room/match.
      lastPickedCardRef.current = null;
      activeChallengeRef.current = null;
      setServerReactionPhase(null);
      setAwaitingChallengeStart(false);
      // 5th-pass review: clear any transient mid-match notice so the
      // amber banner doesn't stack visually with the red void overlay.
      setNetworkNotice(null);
      setOpponentDisconnected(false);
      // Tear down the socket - otherwise the client keeps reconnecting to a
      // room the server has destroyed, producing the infinite AUTH→error
      // loop observed in the Chrome bug report.
      networkClientRef.current?.disconnect();
      setScreen('menu');
    }
    if (msg.type === 'auth_error') {
      // Token got rejected (expired/invalid). Stop the socket before it
      // spins a retry loop and bounce back to the menu.
      networkClientRef.current?.disconnect();
      setScreen('menu');
    }

    // Rematch handshake.
    if (msg.type === 'rematch_pending') {
      setRematchStatus('requested_by_me');
    }
    if (msg.type === 'rematch_requested') {
      setRematchStatus('requested_by_opponent');
      try { haptic.warning?.(); } catch { /* haptics best-effort */ }
    }
    if (msg.type === 'rematch_declined') {
      setRematchStatus('declined');
    }
    // A second game_start while the player is already in a network match
    // means the server has accepted a rematch and is restarting the room
    // with fresh state. Re-init the match in place using the existing
    // NetworkClient. startNetworkGame clears all match-side state for us.
    // Refs (not closure-captured state) so the pinned closure on
    // client.onMessage stays correct across renders.
    if (
      msg.type === 'game_start' &&
      networkModeRef.current === 'online' &&
      matchStateRef.current
    ) {
      const client = networkClientRef.current;
      if (client) {
        startNetworkGame({
          client,
          initialState: undefined,
          initialHand: undefined,
          networkPlayer: msg.player,
          p1Name: msg.p1Name,
          p2Name: msg.p2Name,
          style: msg.style,
          mode: 'online',
          initialInitiative: msg.initialInitiative || null,
        });
        setRematchStatus('idle');
        // 5th-pass review: clear any transient notice from the prior
        // match so it doesn't bleed into the rematch's first round.
        setNetworkNotice(null);
      }
    }
  };

  // Save match result to profile/history
  // Bug 2 fix: wrapped in try/catch with await on all async calls - no more silent fire-and-forget crashes
  // humanPlayer + tournamentMatchInfo read via refs to keep callback identity
  // stable; deps already cover the actual triggers (matchState changes etc.)
   
  const saveMatchResult = useCallback(async (state, mode) => {
    if (matchSavedRef.current) return;
    matchSavedRef.current = true;
    clearMatchFromStorage();

    const hp = humanPlayerRef.current; // which side the human played (ref avoids stale [] closure)
    const humanData = state[hp];
    const opponentData = state[hp === 'p1' ? 'p2' : 'p1'];

    // Resolve winner defensively. In online mode we saw a case where both
    // clients recorded a loss on an 18-3 tech fall - the only way that can
    // happen in this code is if `state.winner` was null/undefined when
    // phase reached 'finished'. Fall back to score comparison (with a small
    // diff threshold to avoid spurious wins on flukey states), so the
    // winner's client doesn't silently log the wrong result.
    let winner = state.winner;
    if (winner !== 'p1' && winner !== 'p2' && winner !== 'draw') {
      const diff = (humanData?.score || 0) - (opponentData?.score || 0);
      if (diff > 0)      winner = hp;
      else if (diff < 0) winner = hp === 'p1' ? 'p2' : 'p1';
      else               winner = 'draw';
      // Surface to analytics so we can tell how often this fallback fires.
      try { logEvent('match_winner_fallback', { phase: state.phase, hp, diff }); } catch { /* noop */ }
    }
    const isHumanWin = winner === hp;
    const isDraw = winner === 'draw';
    const result = isDraw ? 'draw' : isHumanWin ? 'win' : 'loss';

    logEvent('match_complete', {
      game_mode: mode, result, win_method: state.winMethod,
      wrestling_style: state.wrestlingStyle || 'folkstyle',
      player_score: humanData.score, opponent_score: opponentData.score,
    });

    // ── Build 8: surface match context so checkAchievements can see online
    // / tournament / practice signals. tournamentEntered = first round of a
    // new tournament run; tournamentWon = player just won the finals match.
    const isOnline = mode === 'network';
    // Both standalone and career tournaments must credit the Bracket Regular
    // and Tournament Champion achievements. Pre-fix this gated on 'tournament'
    // alone, so winning a career bracket never fired either badge.
    const isTournament = mode === 'tournament' || mode === 'career_tournament';
    const tournamentRoundKey = tournamentMatchInfoRef.current?.roundKey || null;
    // First-bracket-match detection. Replaces the old roundKey-based check,
    // which fired for ANY round whose key matched [r1, r16, r32, play-in, qf].
    // In 16/24/32/64 brackets the player crosses MULTIPLE such rounds in a
    // single tournament, so the per-match flag credited tournaments_entered
    // 2-4 times per run and the Bracket Regular badge unlocked after one
    // tournament instead of three. The helper counts the player's already-
    // resolved matches; saveMatchResult fires when matchState.phase hits
    // 'finished', BEFORE handleContinueTournament propagates this match's
    // winner into tournament.matches via advanceMatch, so a count of zero
    // uniquely identifies the entry round.
    const tournamentEntered = isTournament
      && isPlayerFirstBracketMatch(tournamentStateRef.current);
    const tournamentWon = isTournament && tournamentRoundKey === 'finals' && result === 'win';
    // practiceOpponentUid: populated only when playing a friends-practice online
    // match. Other online modes (random matchmaking) leave this null.
    const practiceOpponentUid = (isOnline && state.practiceOpponentUid) ? state.practiceOpponentUid : null;

    // Capture the final period's accumulated points before saving - the
    // post-resolve effect only flushes on PERIOD CHANGE, so the final
    // period's tally is still in humanCurrentPeriodPointsRef when the
    // match ends.
    const finalMaxPeriodPoints = Math.max(
      humanMaxPeriodPointsRef.current,
      humanCurrentPeriodPointsRef.current,
    );
    // Stable NPC identity for the opposing side. Threaded through to
    // checkAchievements + result dialogue so featured-NPC unlocks (e.g. the
    // Elijah Joles "Wrestled Through" badge) can fire without depending on
    // the side id ('p1' / 'p2') which createWrestler overwrites at match init.
    const opponentNpcId = opponentData?.npcId || null;
    const matchResultData = {
      result,
      winMethod: state.winMethod,
      playerScore: humanData.score,
      opponentScore: opponentData.score,
      wasTrailing: wasTrailingRef.current,
      takedowns: humanData.takedownCount || 0,
      aiDifficulty: isAIMode(mode) ? (state.aiDifficulty || 'medium') : null,
      maxPeriodPoints: finalMaxPeriodPoints,
      // Build 8 context
      isOnline,
      tournamentEntered,
      tournamentWon,
      practiceOpponentUid,
      // Featured-NPC threading - null for non-special opponents.
      opponentNpcId,
    };

    // First-win-of-day bonus: stamp the date atomically (check + set) and
    // flip the flag on matchResultData so both computeXP and computeXPBreakdown
    // see it. Only eligible on vs_ai / tournament (aiDifficulty is set).
    matchResultData.firstWinOfDay = consumeFirstWinOfDayIfEligible(matchResultData);

    const xpEarned = computeXP(matchResultData);
    const xpBreakdown = computeXPBreakdown(matchResultData);

    // Comeback flag - derived from existing wasTrailing ref. The XP bonus
    // already exists; this flag just surfaces the drama in the modal.
    const comebackWin = result === 'win' && wasTrailingRef.current;

    // ── Rivalry tracking ───────────────────────────────────────────────
    // Head-to-head record against stably identifiable opponents. We only
    // record vs_ai matches (keyed by difficulty slot) and practice-friends
    // online matches (keyed by opponent UID). Random matchmaking / local 2p
    // / tournament AI are intentionally skipped - see src/lib/rivalries.js
    // for the rationale. Non-decisive matches (draws) still bump the
    // lastPlayedAt stamp so the opponent stays visible in recent history.
    let rivalry = null;
    const rivalryId = buildOpponentId({
      gameMode: mode,
      aiDifficulty: matchResultData.aiDifficulty,
      practiceOpponentUid,
    });
    if (rivalryId) {
      const didWin = result === 'win' ? true : result === 'loss' ? false : null;
      const opponentDisplayName = formatOpponentLabel(rivalryId, opponentData.name);
      try {
        const updated = recordRivalry(rivalryId, opponentDisplayName, didWin);
        if (updated) {
          rivalry = {
            id: rivalryId,
            label: opponentDisplayName,
            wins: updated.wins,
            losses: updated.losses,
            didWin,
          };
        }
      } catch (_rivalryErr) {
        // localStorage unavailable - rivalry card just won't render
      }
    }

    // ── Career event recording (Phase A) ───────────────────────────────
    // When we just finished a career match, update the career schedule +
    // record before the modal renders so "Return to Career" lands on the
    // dashboard with fresh numbers.
    // Career Depth Pass v1: also collect post-match career data the modal
    // renders distinctly (rivalry flame escalation + career XP breakdown +
    // coach blurb + championship trophy + prestige badge unlocks).
    let careerRivalry = null;
    let careerXpBreakdown = null;
    let coachBlurb = null;
    let careerTrophy = null;
    let careerBadges = null;
    if (mode === 'career') {
      const career = activeCareerRef.current;
      const event = selectedCareerEventRef.current;
      if (career && event) {
        try {
          const stashedMods = readCareerMatchModifiers(career.id, event.id);
          const consumedBuffSourceIds = stashedMods?.consumedBuffSourceIds || [];
          const nextCareer = recordCareerEventResult(career, event.id, {
            playerWon: isHumanWin,
            p1Score: humanData.score,
            p2Score: opponentData.score,
            winMethod: state.winMethod,
            placement: event.type === 'championship'
              ? (isHumanWin ? 1 : null)
              : null,
            // Career Depth Pass v1: forward stashed sourceIds so the buffs
            // applied at match start get consumed + counted now. Tag-validated
            // read returns null if the stash is from a different career/event,
            // so a stale ref cannot contaminate this result.
            consumedBuffSourceIds,
          });
          // Clear only AFTER successful record. On failure the stash survives
          // for retry.
          clearCareerMatchModifiers();
          // Career Depth Pass v1 - Rivalry Heat: surface the feudLevel of the
          // just-finished dual opponent (if a rival) so the modal can render
          // flame escalation. nextCareer.rivals reflects the post-match H2H
          // increment, which is what the player should see (e.g. 3-1 after a
          // dual win that pushed the H2H to 3 wins).
          if (event.opponentIsRival && event.opponent?.id) {
            const rival = (nextCareer.rivals || []).find(r => r.id === event.opponent.id);
            if (rival) {
              careerRivalry = {
                id: rival.id,
                label: rival.name || rival.id,
                wins: rival.h2h?.wins || 0,
                losses: rival.h2h?.losses || 0,
                pins: rival.h2h?.pins || 0,
                feudLevel: feudLevel(rival.h2h),
                didWin: isHumanWin,
              };
            }
          }
          // Career Depth Pass v1 - Career XP breakdown. Mirrors what
          // recordEventResult appended (e.g. 'Rivalry +25%' on dual rival win).
          // Empty/missing breakdown still renders cleanly (modal hides chip).
          careerXpBreakdown = Array.isArray(nextCareer.lastEventXp?.breakdown)
            ? nextCareer.lastEventXp.breakdown
            : [];
          // Career Depth Pass v1 - Championship mint card. Pulled from the
          // ephemeral lastEventTrophy field set by recordEventResult on
          // championship/tournament wins. null for non-grant events.
          careerTrophy = nextCareer.lastEventTrophy || null;
          // Career Depth Pass v1 - Prestige badge unlocks earned this event
          // (season-end detection). Empty array when none unlocked. Modal
          // renders a chip per badge.
          careerBadges = Array.isArray(nextCareer.lastEventBadges)
            ? nextCareer.lastEventBadges
            : [];
          // Career Depth Pass v1 - Coach blurb. Pull the right situation
          // line based on event outcome + championship branch. CoachBlurb
          // no-ops when coach is missing, so legacy careers without a
          // backfilled coach render nothing.
          const coach = nextCareer.coach;
          if (coach) {
            const isChampionship = event.type === 'championship';
            const isPin = state.winMethod === 'pin';
            let situation;
            if (isChampionship) {
              situation = isHumanWin ? 'championship_win' : 'championship_loss';
            } else if (isHumanWin) {
              situation = isPin ? 'pin_win' : 'win';
            } else {
              situation = isPin ? 'pinned' : 'loss';
            }
            const line = getCoachLine(coach.id, situation);
            if (line) {
              coachBlurb = {
                coachName: coach.name,
                line,
                tone: isHumanWin ? 'win' : 'loss',
                label: 'Coach',
              };
            }
          }
          setActiveCareer(nextCareer);
          const uid = auth.currentUser?.uid;
          if (uid) {
            saveCareer(uid, nextCareer).catch(err =>
              console.warn('[career] save after event failed:', err?.message)
            );
          }
        } catch (err) {
          console.warn('[career] recordEventResult failed:', err?.message);
          try {
            import('@/components/ui/use-toast').then(({ toast }) => {
              toast({
                title: 'Career save failed',
                description: err?.message || "Couldn't record match - career may not advance.",
                variant: 'destructive',
              });
            }).catch(() => {});
          } catch (_e) { /* ignore */ }
        }
      }
    }

    // Set post-match data for result modal display immediately
    // Merge with prior state: a match_settled receipt can land before this
    // initial set (fast settlement), and we must not clobber its onlineSettled /
    // merged achievements.
    setPostMatchData(prev => ({ ...(prev || {}), xpEarned, xpBreakdown, comebackWin, rivalry, careerRivalry, careerXpBreakdown, coachBlurb, careerTrophy, careerBadges }));

    const notableEvents = [];
    if (humanData.pinCount > 0) notableEvents.push(`Pinned opponent`);
    if (humanData.takedownCount >= 3) notableEvents.push(`${humanData.takedownCount} takedowns`);
    if (humanData.nearFallCount >= 2) notableEvents.push(`${humanData.nearFallCount} near falls`);

    // ── Research telemetry ─────────────────────────────────────
    const researchData = JSON.stringify({
      match_log: state.log || [],
      card_usage: state.turnHistory || { p1: {}, p2: {} },
      rounds: state.roundNumber,
      periods_played: state.period,
      final_stamina: { p1: state.p1.stamina, p2: state.p2.stamina },
      final_positions: { p1: state.p1.position, p2: state.p2.position },
      pressure: state.pressure || { p1OnP2: 0, p2OnP1: 0 },
      momentum: state.momentum || 'neutral',
      p1_stats: {
        takedowns: state.p1.takedownCount || 0,
        escapes: state.p1.escapeCount || 0,
        reversals: state.p1.reversalCount || 0,
        near_falls: state.p1.nearFallCount || 0,
        exposures: state.p1.exposureCount || 0,
        pins: state.p1.pinCount || 0,
        ride_time_streak: state.p1.rideTimeStreak || 0,
      },
      p2_stats: {
        takedowns: state.p2.takedownCount || 0,
        escapes: state.p2.escapeCount || 0,
        reversals: state.p2.reversalCount || 0,
        near_falls: state.p2.nearFallCount || 0,
        exposures: state.p2.exposureCount || 0,
        pins: state.p2.pinCount || 0,
        ride_time_streak: state.p2.rideTimeStreak || 0,
      },
      timestamp: new Date().toISOString(),
    });

    try {
      // Update or create profile - read fresh from auth (useCallback has [] deps)
      const uid = auth.currentUser?.uid;
      let baseProfile = null;
      if (uid) {
        baseProfile = await getProfile(uid);
      } else {
        baseProfile = loadGuestProfile();
      }

      // ── Goals persistence ──────────────────────────────────────
      const goals = loadGoals(baseProfile?.goals_json);
      const goalMatchData = {
        ...matchResultData,
        winMethod: state.winMethod,
        winStreak: result === 'win' ? (baseProfile?.streak_current || 0) + 1 : 0,
        opponentReversals: state.p2.reversalCount || 0,
        isOnline: gameMode === 'network',
      };
      const updatedGoals = updateGoalProgress(goals, goalMatchData);
      const completedGoals = updatedGoals.filter((g, i) => g.completed && !goals[i]?.completed);
      const goalBonusXP = completedGoals.reduce((sum, g) => sum + (g.xpReward || 0), 0);

      // ── Featured daily goal (single rotating objective) ────────
      // Separate from goals_json so the UI can surface it
      // prominently. Carries escapes/nearFalls which the legacy
      // pool doesn't use.
      const priorFeaturedGoal = loadFeaturedDailyGoal(baseProfile);
      const featuredMatchData = {
        ...goalMatchData,
        escapes: humanData.escapeCount || 0,
        nearFalls: humanData.nearFallCount || 0,
      };
      const updatedFeaturedGoal = updateFeaturedDailyGoalProgress(priorFeaturedGoal, featuredMatchData);
      const featuredJustCompleted =
        updatedFeaturedGoal?.completed && !priorFeaturedGoal?.completed;
      const featuredBonusXP = featuredJustCompleted ? (updatedFeaturedGoal.xpReward || 0) : 0;

      // ── Achievements persistence ───────────────────────────────
      // Backfill the three fields that the achievement evaluator reads but
      // weren't on matchResultData. Without these, three badges never fire:
      //   - winStreak  -> Hot Streak (5 in a row)
      //   - rideTimeBonuses -> Ride Time King (3 ride bonuses in a match)
      //   - maxDeficit -> Never Say Die (comeback from 6+ down)
      const humanName = humanPlayerRef.current === 'p1' ? state.p1.name : state.p2.name;
      matchResultData.winStreak = result === 'win'
        ? (baseProfile?.streak_current || 0) + 1
        : 0;
      matchResultData.rideTimeBonuses = (state.log || []).filter(
        (e) => e?.type === 'ride_time' && typeof e.entry === 'string' && e.entry.startsWith(humanName)
      ).length;
      matchResultData.maxDeficit = maxDeficitRef.current || 0;

      // ── Elijah Boss Challenge: persistent boss-win counter ──────────────
      // Increment once per Boss Challenge win and surface the new total to
      // checkAchievements so the EJ Slayer (4+ wins) badge can fire on the
      // same match it's earned. Reset the Boss-active ref so future non-boss
      // wins against Elijah (e.g. career encounters) don't bump the counter.
      if (elijahBossActiveRef.current
          && result === 'win'
          && matchResultData.opponentNpcId === 'special_elijah_joles'
          && matchResultData.winMethod !== 'forfeit'
          && matchResultData.winMethod !== 'disqualification') {
        let prior = 0;
        try { prior = Number(localStorage.getItem('matgrind_elijah_boss_wins') || 0) || 0; } catch { /* disabled */ }
        const next = prior + 1;
        try { localStorage.setItem('matgrind_elijah_boss_wins', String(next)); } catch { /* quota */ }
        matchResultData.elijahBossWinsAfter = next;
      }
      elijahBossActiveRef.current = false;

      let existingAchIds = [];
      try { existingAchIds = JSON.parse(baseProfile?.achievements_json || '[]'); } catch { existingAchIds = []; }
      const newAchievementIds = checkAchievements(existingAchIds, matchResultData, baseProfile);
      const allAchIds = [...existingAchIds, ...newAchievementIds];
      const newAchievements = newAchievementIds
        .map(id => ACHIEVEMENTS.find(a => a.id === id))
        .filter(Boolean);

      // ── Win streak tracking ────────────────────────────────────
      const priorBestStreak = baseProfile?.streak_best || 0;
      const newStreak = result === 'win' ? (baseProfile?.streak_current || 0) + 1 : 0;
      const bestStreak = Math.max(priorBestStreak, newStreak);
      const brokeBestStreak = newStreak > priorBestStreak;

      // ── Streak rewards ────────────────────────────────────────
      const streakData = recordDailyPlay();
      const { bonusXP: streakBonusXP, bonus: streakBonus } = calculateStreakBonus(xpEarned, streakData.currentStreak);

      // ── Badge-unlock bonus XP (scaled by AI difficulty) ─────
      const badgeBonusXP = computeBadgeBonusXP(newAchievementIds.length, matchResultData.aiDifficulty);

      // ── Daily challenges ─────────────────────────────────────────
      // Resolve BEFORE the totalXP sum so the bonus is included in the
      // persisted profile.xp, level-up math, weekly_stats, and the
      // match history record. Previously this ran after saveProfile,
      // which meant the modal showed the bonus but the stored XP
      // silently dropped it. checkAllDailyChallenges also marks the
      // challenges complete in localStorage as a side effect.
      let dailyCompleted = [];
      let dailyBonusXP = 0;
      try {
        // Contextualize so "Career" challenges only fire in Career, "Dual" in
        // Dual Meets, and "Online" in network matches. Without this split, a
        // career win would also satisfy an online challenge, etc.
        const dc = dualMeetRef.current;
        const currentBout = dc && Array.isArray(dc.bouts) ? dc.bouts[dc.currentBoutIndex] : null;
        const dailyCtx = {
          gameMode: mode,
          spectator: networkPlayerRef.current === 'spectator',
          dualEvent: isDualMode(mode) ? 'bout' : null,
          isHeroBout: !!currentBout?.playerWrestler?.isHero,
          // Team points for the just-finished bout are computed from the
          // engine result (not yet written to dual.bouts here, so build it
          // inline).
          dualBoutTeamPoints: isDualMode(mode)
            ? (() => {
                try {
                  return scoreFolkstyleBout({
                    winMethod: state.winner === 'draw' ? 'draw' : (state.winMethod || 'decision'),
                    p1Score: state.p1?.score ?? 0,
                    p2Score: state.p2?.score ?? 0,
                    playerWon: state.winner === 'p1',
                  });
                } catch { return null; }
              })()
            : null,
        };
        dailyCompleted = checkAllDailyChallenges(state, dailyCtx) || [];
        dailyBonusXP = dailyCompleted.reduce((sum, c) => sum + (c.xpReward || 0), 0);
      } catch (_dcErr) {
        console.warn('[WrestlingGame] Daily challenge check failed:', _dcErr?.message);
      }

      // ── XP with goal bonuses + streak bonus + badge bonus + daily ──
      const totalXP = xpEarned + goalBonusXP + featuredBonusXP + streakBonusXP + badgeBonusXP + dailyBonusXP;

      // ── Personal bests ────────────────────────────────────────
      // Skip in local 2p (no single "owner" of the PBs - both seats are
      // human) and in spectator/network-non-player flows. Everywhere
      // else, diff the match against stored records and surface any
      // newly broken ones. First-ever values establish a silent
      // baseline (no chip) so we don't celebrate the inaugural match.
      let newPersonalBests = [];
      let personalBestsToSave = baseProfile?.personal_bests || {};
      if (mode !== 'vs_local_2p' && mode !== 'local') {
        const pbResult = checkPersonalBests(matchResultData, baseProfile, { totalXP });
        newPersonalBests = pbResult.newBests;
        personalBestsToSave = pbResult.personalBests;
      }

      // ── Weekly stats (Friends leaderboard) ──────────────────
      // Single counter object keyed to the current ISO week. When the
      // stored week_id doesn't match, reset to zero - we only ever surface
      // this week's totals, so previous weeks don't need to be kept.
      const weekId = currentWeekId();
      const priorWeekly = baseProfile?.weekly_stats;
      const weeklyBase = (priorWeekly && priorWeekly.week_id === weekId)
        ? priorWeekly
        : { week_id: weekId, wins: 0, pins: 0, xp_earned: 0 };
      const weeklyStats = {
        week_id: weekId,
        wins: weeklyBase.wins + (result === 'win' ? 1 : 0),
        pins: weeklyBase.pins + (humanData.pinCount || 0),
        xp_earned: weeklyBase.xp_earned + totalXP,
      };
      const newXP = (baseProfile?.xp || 0) + totalXP;
      const newLevel = getLevelFromXP(newXP);
      const oldLevel = baseProfile?.level || 1;

      // Match history record - shared shape between Firestore + guest store
      // so the Profile UI reads one format regardless of auth state.
      const matchRecord = {
        player_name: humanData.name,
        opponent_name: opponentData.name,
        result,
        win_method: state.winMethod,
        player_score: humanData.score,
        opponent_score: opponentData.score,
        periods: state.period,
        notable_events: notableEvents,
        xp_earned: totalXP,
        game_mode: mode,
        wrestling_style: state.wrestlingStyle || 'folkstyle',
        player_takedowns: humanData.takedownCount || 0,
        player_escapes: humanData.escapeCount || 0,
        player_near_falls: humanData.nearFallCount || 0,
        achievements_earned: newAchievementIds.length > 0 ? JSON.stringify(newAchievementIds) : null,
        research_data: researchData,
      };
      if (uid) {
        try { await createMatch(uid, matchRecord); }
        catch (matchErr) { console.warn('[WrestlingGame] Match history save failed:', matchErr?.message); }
      } else {
        // Guest: persist to localStorage ring buffer so the Profile "Match
        // History" tab has something to display. Will be migrated to
        // Firestore on first sign-in via migrateGuestToAccount.
        appendGuestMatch(matchRecord);
      }

      const levelsGained = Math.max(0, newLevel - oldLevel);
      const statPointsGained = levelsGained * 1; // 1 stat point per level - forces tradeoffs at cap 85
      const profileData = {
        username: baseProfile?.username || state.p1.name,
        wins: (baseProfile?.wins || 0) + (result === 'win' ? 1 : 0),
        losses: (baseProfile?.losses || 0) + (result === 'loss' ? 1 : 0),
        draws: (baseProfile?.draws || 0) + (result === 'draw' ? 1 : 0),
        pins: (baseProfile?.pins || 0) + (humanData.pinCount || 0),
        tech_falls: (baseProfile?.tech_falls || 0) + (state.winMethod === 'tech_fall' && result === 'win' ? 1 : 0),
        total_points: (baseProfile?.total_points || 0) + humanData.score,
        xp: newXP,
        level: newLevel,
        goals_json: JSON.stringify(updatedGoals),
        daily_goal: updatedFeaturedGoal || null,
        achievements_json: JSON.stringify(allAchIds),
        streak_current: newStreak,
        streak_best: bestStreak,
        total_matches: (baseProfile?.total_matches || 0) + 1,
        last_played_date: new Date().toISOString().split('T')[0],
        // Preserve stats and grant new stat points on level-up
        stats: baseProfile?.stats || { str: 60, spd: 60, tec: 60, end: 60, grt: 60 },
        stat_points_available: (baseProfile?.stat_points_available || 0) + statPointsGained,
        // ── Build 8 counters (drive new Game Center achievements) ───────
        // Stage 4: online_wins is server-authoritative (online_progress). The
        // client no longer self-increments it; preserve the existing value so
        // the mixed-mode profile field is not dropped. The trusted online win
        // count arrives via the match_settled receipt (and the fallback read).
        online_wins: baseProfile?.online_wins || 0,
        tournaments_entered: (baseProfile?.tournaments_entered || 0) + (tournamentEntered ? 1 : 0),
        tournaments_won: (baseProfile?.tournaments_won || 0) + (tournamentWon ? 1 : 0),
        practice_friends: (() => {
          const prev = Array.isArray(baseProfile?.practice_friends) ? baseProfile.practice_friends : [];
          if (!practiceOpponentUid || prev.includes(practiceOpponentUid)) return prev;
          return [...prev, practiceOpponentUid];
        })(),
        weekly_stats: weeklyStats,
        personal_bests: personalBestsToSave,
      };

      if (uid) {
        const savedProfile = await saveProfile(uid, profileData);
        setWrestlerProfile(savedProfile);
        // Update Firestore leaderboard (fire-and-forget)
        import('../lib/leaderboardService.js').then(({ updateAllLeaderboards }) => {
          updateAllLeaderboards(uid, savedProfile).catch(() => {});
        }).catch(() => {});
        // Submit to Apple Game Center (fire-and-forget, iOS-only, guest-safe)
        import('../lib/gameCenter.js').then(({ gcSubmitMatchScores, gcUnlockEarnedAchievements }) => {
          gcSubmitMatchScores(savedProfile).catch(() => {});
          gcUnlockEarnedAchievements(newAchievementIds).catch(() => {});
        }).catch(() => {});
      } else {
        // Guest mode: persist profile locally so stats survive between matches
        setWrestlerProfile(profileData);
        saveGuestProfile(profileData);
        // Game Center is tied to Apple ID, not Firebase UID - submit even for guests.
        import('../lib/gameCenter.js').then(({ gcSubmitMatchScores, gcUnlockEarnedAchievements }) => {
          gcSubmitMatchScores(profileData).catch(() => {});
          gcUnlockEarnedAchievements(newAchievementIds).catch(() => {});
        }).catch(() => {});
      }

      // Update post-match data with full results for modal display
      setPostMatchData(prev => ({
        ...prev,
        xpEarned: totalXP,
        leveledUp: newLevel > oldLevel,
        newLevel,
        statPointsGained,
        newAchievements,
        completedGoals,
        winStreak: newStreak,
        bestStreak,
        brokeBestStreak,
        newPersonalBests,
      }));

      // Add goal bonus to breakdown if any
      if (goalBonusXP > 0) {
        setPostMatchData(prev => ({
          ...prev,
          xpBreakdown: [...(prev?.xpBreakdown || []), ...completedGoals.map(g => ({ label: `Goal: ${g.label}`, xp: g.xpReward }))],
        }));
      }

      // Featured daily goal - separate line so users see which bonus
      // came from the big "Today's Goal" card.
      if (featuredBonusXP > 0) {
        setPostMatchData(prev => ({
          ...prev,
          xpBreakdown: [
            ...(prev?.xpBreakdown || []),
            { label: `Today's Goal: ${updatedFeaturedGoal.label}`, xp: featuredBonusXP },
          ],
        }));
      }

      // Add badge-unlock bonus to breakdown if any
      if (badgeBonusXP > 0) {
        setPostMatchData(prev => ({
          ...prev,
          xpBreakdown: [
            ...(prev?.xpBreakdown || []),
            { label: `Badge unlock${newAchievementIds.length > 1 ? 's' : ''} (×${newAchievementIds.length})`, xp: badgeBonusXP },
          ],
        }));
      }

      // Daily-challenge breakdown rows. The XP bonus itself is already
      // folded into totalXP / profile.xp above; this just surfaces the
      // per-challenge lines in the modal's XP Earned list.
      if (dailyCompleted.length > 0) {
        setPostMatchData(prev => ({
          ...prev,
          xpBreakdown: [
            ...(prev?.xpBreakdown || []),
            ...dailyCompleted.map(c => ({ label: `Daily: ${c.label}`, xp: c.xpReward || 0 })),
          ],
          dailyChallengesCompleted: dailyCompleted,
        }));
      }

      // Add streak bonus to breakdown if active
      if (streakBonusXP > 0 && streakBonus) {
        setPostMatchData(prev => ({
          ...prev,
          xpBreakdown: [...(prev?.xpBreakdown || []), { label: `${streakBonus.label} Bonus`, xp: streakBonusXP }],
        }));
      }
    } catch (err) {
      // Non-blocking: match result failed to save (e.g. offline, no API key)
      // The game continues normally - this is not a critical error
      console.warn('[WrestlingGame] Match result could not be saved:', err?.message || err);
      // Surface error to user so they know what happened
      try {
        const { toast } = await import('@/components/ui/use-toast');
        toast({ title: 'Profile save failed', description: err?.message || 'Could not save match results', variant: 'destructive' });
      } catch (_e) { /* ignore toast failure */ }
    }
  }, []);

  // ── Card-pick launch helper (Per-Archetype Micro-Mechanics) ────────────
  // Called after a player commits a card. For everything except LAN-server
  // mode (where the authoritative LAN server doesn't yet understand skill
  // bonuses), we mount the skill challenge overlay; the player's challenge
  // result fills in p1/p2SkillResult, which the resolve effect waits on.
  // LAN mode: bypass the challenge and stamp MISS so the resolve still works.
  const launchSkillChallenge = (card, side) => {
    const mechanic = getMechanicForCard(card);
    const isOnline = gameMode === 'network' && networkModeRef.current === 'online';

    // Setup-only cards (and any unmapped category) have no skill layer.
    // Transitions used to land here too; they now use MECHANIC_TYPES.PATH.
    if (mechanic === MECHANIC_TYPES.NONE) {
      const miss = getMissResult();
      if (side === 'p1') setP1SkillResult(miss);
      else setP2SkillResult(miss);
      // Online: send card_pick now (server resolves NONE -> MISS itself,
      // strips any client-supplied skillResult). No mini-game UI.
      if (isOnline && networkClientRef.current) {
        sendNetworkPick(card.id, miss);
      }
      return;
    }

    if (isOnline && networkClientRef.current) {
      // AUTHORITATIVE ONLINE FLOW (Codex review fix #1):
      // 1. Send card_pick immediately so server creates the authoritative
      //    challenge instance (without it, challenge_input events stream
      //    to a server with no challenge and get silently dropped).
      // 2. Stash the picked card so the challenge_start handler can mount
      //    the mini-game with the right card without re-finding it.
      // 3. Set the awaiting flag so the UI shows "Preparing skill challenge"
      //    instead of "Waiting for opponent" during the RTT gap.
      // 4. Do NOT setPendingChallenge here - challenge_start will mount it
      //    using server-supplied params (so client renders what server grades).
      lastPickedCardRef.current = card;
      setAwaitingChallengeStart(true);
      sendNetworkPick(card.id);
      return;
    }

    // OFFLINE / vs-AI / LAN: mount mini-game locally; handleSkillResolved
    // sends the pick (LAN) or just stamps the local skillResult (offline).
    setPendingChallenge({ card, side });
  };

  // Resolve the active skill challenge, store the tier on the right side.
  const handleSkillResolved = (result) => {
    if (!pendingChallenge) return;
    const { side } = pendingChallenge;
    if (side === 'p1') setP1SkillResult(result);
    else setP2SkillResult(result);
    setPendingChallenge(null);
    // Local 2P pass-device: defer the "pass to next player" prompt until the
    // current player finishes their skill challenge (otherwise the modal
    // would steal the device mid-mechanic).
    if (gameMode === 'local' && side === 'p1') {
      setShowPassDevice(true);
    }
    // Online (authoritative): the server determines tier from streamed
    // input events and broadcasts state_update / challenge_resolved. The
    // local mechanic's onResolve still fires for animation completion, but
    // its tier is ignored. card_pick was already sent in launchSkillChallenge
    // before the mini-game mounted - no second send here.
  };

  // AI picks card after human selects
  const aiPlayer = humanPlayer === 'p1' ? 'p2' : 'p1';
  const aiHand = humanPlayer === 'p1' ? p2Hand : p1Hand;
  const humanSelected = humanPlayer === 'p1' ? p1Selected : p2Selected;
  const aiSelected = humanPlayer === 'p1' ? p2Selected : p1Selected;
  const setAISelected = humanPlayer === 'p1' ? setP2Selected : setP1Selected;

  useEffect(() => {
    if (gameMode === 'network') return;
    if (!isAIMode(gameMode)) return;
    if (!matchState || (matchState.phase !== 'playing' && matchState.phase !== 'overtime')) return;
    if (!humanSelected || aiSelected || resolving) return;

    clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => {
      const aiCard = getAICard(matchState, aiPlayer, aiHand);
      if (aiCard) {
        setAISelected(aiCard);
        // AI also generates a skill-tier roll based on difficulty so the
        // CPU isn't permanently MISS while the human earns +4 PERFECT bonuses.
        const aiDifficulty = matchState.aiDifficulty || 'medium';
        const aiSkill = getAISkillResult(aiDifficulty);
        if (aiPlayer === 'p1') setP1SkillResult(aiSkill);
        else setP2SkillResult(aiSkill);
      }
    }, 400);
  }, [humanSelected, aiSelected, gameMode, matchState, aiHand, aiPlayer, resolving, setAISelected]);

  // Resolve when both cards ready (local only - network resolves on server).
  // Per-archetype micro-mechanics: also wait until both skill results are in
  // (mechanic = NONE auto-resolves to MISS in CardSkillChallenge so this gate
  // never deadlocks for transition cards).
  // matchState/turn is the trigger; reads via refs to avoid re-arming
  // the AI timer mid-decision (would cancel setTimeout then re-arm,
  // causing AI to never decide).
   
  useEffect(() => {
    if (gameMode === 'network') return;
    if (!matchState || (matchState.phase !== 'playing' && matchState.phase !== 'overtime')) return;
    if (!p1Selected || !p2Selected || resolving) return;
    if (!p1SkillResult || !p2SkillResult) return;

    setResolving(true);
    clearTimeout(resolveTimer.current);
    resolveTimer.current = setTimeout(() => {
      try {
        const newState = resolveRound(
          matchState,
          p1Selected.id,
          p2Selected.id,
          p1SkillResult,
          p2SkillResult,
        );
        recordRound(replayRef.current, p1Selected.id, p2Selected.id);
        setMatchState(newState);
        // Sound + haptic feedback based on result type
        const rt = newState.lastResult?.type;
        if (rt) {
          const soundMap = {
            takedown: 'takedown', escape: 'escape', reversal: 'reversal',
            near_fall: 'near_fall', exposure: 'near_fall', pin: 'pin',
            counter: 'counter', scramble: 'scramble', stalemate: 'stalemate',
            setup: 'setup', control: 'setup', leg_attack_secured: 'takedown',
            grand_amplitude: 'takedown', pin_attempt_trigger: 'near_fall',
            takedown_near_fall: 'takedown',
          };
          playSoundRef.current(soundMap[rt] || 'card_play');
          // Haptic feedback - intensity matches move impact
          const hapticMap = {
            takedown: 'heavy', grand_amplitude: 'heavy', reversal: 'heavy',
            takedown_near_fall: 'heavy', leg_attack_secured: 'heavy',
            escape: 'medium', counter: 'medium', scramble: 'medium',
            near_fall: 'warning', exposure: 'warning', pin_attempt_trigger: 'warning',
            pin: 'error',
            stalemate: 'light', setup: 'light', control: 'light',
          };
          const hType = hapticMap[rt];
          if (hType && haptic[hType]) haptic[hType]();
          // Screen-shake intensity matches the same impact grouping. This
          // is the 3rd layer of feedback (motion) - haptic + sound already
          // fired above; shake makes the impact read even when the device
          // is silenced and in a pocket holder (reviewer scenario).
          const shakeMap = {
            takedown: 'heavy', grand_amplitude: 'heavy', reversal: 'heavy',
            takedown_near_fall: 'heavy', leg_attack_secured: 'heavy',
            pin: 'heavy',
            near_fall: 'medium', exposure: 'medium', pin_attempt_trigger: 'medium',
            escape: 'light', counter: 'light', scramble: 'light',
          };
          const shakeIntensity = shakeMap[rt];
          if (shakeIntensity) {
            setImpactIntensity(shakeIntensity);
            setImpactCounter(c => c + 1);
          }
        }
        if (newState.phase === 'period_break') { playSoundRef.current('period_buzzer'); haptic.warning(); }
        if (newState.phase === 'finished') { playSoundRef.current('match_end'); }
        // Track if human ever fell behind (for real comeback bonus detection)
        const hpKey = humanPlayerRef.current;
        const opKey = humanPlayerRef.current === 'p1' ? 'p2' : 'p1';
        if (newState[opKey].score > newState[hpKey].score) {
          wasTrailingRef.current = true;
          // Also track the deepest deficit for the "Never Say Die" badge
          // (win after being down 6+). Without this, the badge can't fire.
          const deficit = newState[opKey].score - newState[hpKey].score;
          if (deficit > maxDeficitRef.current) {
            maxDeficitRef.current = deficit;
          }
        }
        // Per-period scoring tracker for the Flawless Period achievement
        // (8+ points in one period). The engine doesn't expose per-period
        // deltas so we reconstruct from score / period changes.
        const humanScoreNow = newState[hpKey].score || 0;
        const periodNow = newState.period || 1;
        if (periodNow !== lastPeriodRef.current) {
          // Period changed - flush current to max and reset.
          humanMaxPeriodPointsRef.current = Math.max(
            humanMaxPeriodPointsRef.current,
            humanCurrentPeriodPointsRef.current,
          );
          humanCurrentPeriodPointsRef.current = 0;
          lastPeriodRef.current = periodNow;
        }
        const scoreDelta = humanScoreNow - lastHumanScoreRef.current;
        if (scoreDelta > 0) {
          humanCurrentPeriodPointsRef.current += scoreDelta;
          if (humanCurrentPeriodPointsRef.current > humanMaxPeriodPointsRef.current) {
            humanMaxPeriodPointsRef.current = humanCurrentPeriodPointsRef.current;
          }
        }
        lastHumanScoreRef.current = humanScoreNow;
        if (newState.phase === 'playing' || newState.phase === 'overtime') {
          setP1Hand(handForRef.current('p1',newState.p1.position, newState.p1Conditions, newState.wrestlingStyle));
          setP2Hand(handForRef.current('p2',newState.p2.position, newState.p2Conditions, newState.wrestlingStyle));
        }
      } catch (err) {
        console.error('[RESOLVE ERROR]', err);
      } finally {
        setP1Selected(null);
        setP2Selected(null);
        setP1SkillResult(null);
        setP2SkillResult(null);
        setPendingChallenge(null);
        setResolving(false);
        if (gameMode === 'local') {
          setLocalTurn('p1');
          setShowPassDevice(true);
        }
      }
    }, 700);
  }, [p1Selected, p2Selected, p1SkillResult, p2SkillResult, matchState, resolving, gameMode]);

  // AI period choice
  // matchState/turn is the trigger; reads via refs to avoid re-arming
  // the AI timer mid-decision (would cancel setTimeout then re-arm,
  // causing AI to never decide).
   
  useEffect(() => {
    if (gameMode === 'network') return;
    if (!matchState || matchState.phase !== 'period_break') return;
    if (!matchState.periodChoicePending) return;
    const ap = humanPlayerRef.current === 'p1' ? 'p2' : 'p1';
    if (isAIMode(gameMode) && matchState.pendingChoiceFor === ap) {
      clearTimeout(periodTimer.current);
      periodTimer.current = setTimeout(() => {
        const choice = getAIPeriodChoice(matchState, ap);
        recordPeriodChoice(replayRef.current, ap, choice);
        const newState = applyPeriodChoice(matchState, ap, choice);
        setMatchState(newState);
        setP1Hand(handForRef.current('p1',newState.p1.position, newState.p1Conditions, newState.wrestlingStyle));
        setP2Hand(handForRef.current('p2',newState.p2.position, newState.p2Conditions, newState.wrestlingStyle));
      }, 1000);
    }
  }, [matchState, gameMode]);

  // Auto-resolve AI side of pin attempt
  // matchState/turn is the trigger; reads via refs to avoid re-arming
  // the AI timer mid-decision (would cancel setTimeout then re-arm,
  // causing AI to never decide).
   
  useEffect(() => {
    if (gameMode === 'network') return;
    if (!matchState || matchState.phase !== 'pin_attempt') return;
    if (!matchState.pinAttempt) return;

    const { attacker, stage, burnedDefCards = [] } = matchState.pinAttempt;

    if (isAIMode(gameMode)) {
      const ap = humanPlayerRef.current === 'p1' ? 'p2' : 'p1'; // AI player key
      clearTimeout(pinTimer.current);
      pinTimer.current = setTimeout(() => {
        if (stage === 1) {
          if (attacker === ap) {
            const aiOff = getAIPinOffenseCardStage1(matchState, ap);
            setPinOffenseChoice(aiOff);
          } else {
            const aiDef = getAIPinDefenseCard(matchState, ap);
            setPinDefenseChoice(aiDef);
          }
        } else if (stage === 2) {
          if (attacker === ap) {
            const aiOff = getAIPinOffenseCardStage2(matchState, ap);
            setPinOffenseChoice(aiOff);
          } else {
            const aiDef = getAIPinDefenseCardStage2(matchState, ap, burnedDefCards);
            setPinDefenseChoice(aiDef);
          }
        } else {
          if (attacker === ap) {
            const aiOff = getAIPinOffenseCard(matchState, ap);
            setPinOffenseChoice(aiOff);
          } else {
            const aiDef = getAIPinDefenseCardStage3(matchState, ap, burnedDefCards);
            setPinDefenseChoice(aiDef);
          }
        }
      }, 600);
    }
  }, [matchState, gameMode]);

  // Resolve pin attempt when both sides chosen (local only)
  // matchState/turn is the trigger; reads via refs to avoid re-arming
  // the AI timer mid-decision (would cancel setTimeout then re-arm,
  // causing AI to never decide).
   
  useEffect(() => {
    if (gameModeRef.current === 'network') return;
    if (!matchState || matchState.phase !== 'pin_attempt') return;
    if (!pinOffenseChoice || !pinDefenseChoice) return;

    const { stage } = matchState.pinAttempt;

    clearTimeout(pinTimer.current);
    pinTimer.current = setTimeout(() => {
      // Dispatch to Stage 1, 2, or 3 resolver
      recordPinPick(replayRef.current, stage, pinOffenseChoice, pinDefenseChoice);
      const newState = stage === 1
        ? resolvePinStage1(matchState, pinOffenseChoice, pinDefenseChoice)
        : stage === 2
        ? resolvePinStage2(matchState, pinOffenseChoice, pinDefenseChoice)
        : resolvePinStage3(matchState, pinOffenseChoice, pinDefenseChoice);

      setPinOffenseChoice(null);
      setPinDefenseChoice(null);
      setMatchState(newState);

      if (newState.phase === 'playing' || newState.phase === 'overtime') {
        setP1Hand(handForRef.current('p1',newState.p1.position, newState.p1Conditions, newState.wrestlingStyle));
        setP2Hand(handForRef.current('p2',newState.p2.position, newState.p2Conditions, newState.wrestlingStyle));
      }
      // If still 'pin_attempt' (stage 1 → stage 2 transition): no hand rebuild, AI effect re-fires
    }, 500);
  }, [pinOffenseChoice, pinDefenseChoice, matchState]);

  // Save result + replay when match finishes
  useEffect(() => {
    if (!matchState || matchState.phase !== 'finished') return;
    // Log finish context - used to diagnose the "both users recorded a loss"
    // online bug. Remove once root cause is confirmed.
    console.log('[FINISH]', {
      gameMode,
      humanPlayer,
      winner: matchState.winner,
      winMethod: matchState.winMethod,
      p1Score: matchState.p1?.score,
      p2Score: matchState.p2?.score,
    });
    // Haptic feedback - success for win, error for loss
    const hp = humanPlayer;
    if (matchState.winner === hp) haptic.success();
    else if (matchState.winner === 'draw') haptic.medium();
    else haptic.error();
    // Cancel streak reminder since they played today.
    cancelStreakReminder();
    // First meaningful engagement event - now is the right moment to
    // ask for notification permission (and schedule the daily reset +
    // streak reminder). Native-only; no-op on web. Idempotent: iOS
    // returns the cached decision after the first ask, so subsequent
    // match-finishes don't re-prompt.
    initNotifications();
    saveMatchResult(matchState, gameMode);
    if (replayRef.current) {
      finalizeReplay(replayRef.current, matchState);
      saveReplay(replayRef.current);
    }
  }, [matchState, matchState?.phase, gameMode, humanPlayer, saveMatchResult]);

  const handlePeriodChoice = (chooser, choice) => {
    haptic.medium();
    if (gameMode === 'network') {
      networkClientRef.current?.sendPeriodChoice(choice, currentRoundSeqRef.current || null);
      return;
    }
    recordPeriodChoice(replayRef.current, chooser, choice);
    const newState = applyPeriodChoice(matchState, chooser, choice);
    setMatchState(newState);
    setP1Hand(handFor('p1',newState.p1.position, newState.p1Conditions, newState.wrestlingStyle));
    setP2Hand(handFor('p2',newState.p2.position, newState.p2Conditions, newState.wrestlingStyle));
  };

  const handleRematch = () => {
    if (!matchState) return;
    if (gameMode === 'network') {
      networkClientRef.current?.sendRematch();
      // Optimistic local UI update. Whether we are the first to vote or
      // the one accepting after the opponent already requested, the
      // post-send state is "we voted yes, waiting for the server to
      // either confirm both votes (game_start) or tell us they declined".
      setRematchStatus('requested_by_me');
      return;
    }
    startGame(gameMode, { p1: matchState.p1.name, p2: matchState.p2.name }, matchState.wrestlingStyle, humanPlayer === 'p2' ? 'red' : 'green', matchState.aiDifficulty || 'medium');
  };

  // Online: cancel an outgoing rematch request, decline an incoming one,
  // or dismiss the "Opponent declined" caption. Always safe to call from
  // any rematchStatus value; idempotent.
  const handleDeclineRematch = () => {
    if (gameMode === 'network') {
      networkClientRef.current?.sendRematchDecline?.();
    }
    setRematchStatus('idle');
  };

  const handlePushPace = () => {
    if (!matchState || (matchState.phase !== 'playing' && matchState.phase !== 'overtime') || humanPick || resolving) return;
    haptic.medium();
    const newState = applyPushPace(matchState, humanPlayer);
    setMatchState(newState);
    if (newState.phase === 'playing' || newState.phase === 'overtime') {
      setP1Hand(handFor('p1',newState.p1.position, newState.p1Conditions, newState.wrestlingStyle));
      setP2Hand(handFor('p2',newState.p2.position, newState.p2Conditions, newState.wrestlingStyle));
    }
  };

  const handleCutOpponent = () => {
    if (!matchState || (matchState.phase !== 'playing' && matchState.phase !== 'overtime') || humanPick || resolving) return;
    haptic.medium();
    const newState = applyCutOpponent(matchState, humanPlayer);
    setMatchState(newState);
    if (newState.phase === 'playing' || newState.phase === 'overtime') {
      setP1Hand(handFor('p1',newState.p1.position, newState.p1Conditions, newState.wrestlingStyle));
      setP2Hand(handFor('p2',newState.p2.position, newState.p2Conditions, newState.wrestlingStyle));
    }
  };

  // Pin phase handlers.
  // In network mode only one side of the pin attempt is the human's - the
  // other side belongs to the remote opponent. Guard each handler so an
  // accidental (or modified-client) cross-role submit never makes it to
  // the wire. PinAttemptModal already hides the wrong-side pad in network
  // mode, so this is belt-and-suspenders.
  const handlePinOffenseChoice = (cardId) => {
    if (gameMode === 'network') {
      const attacker = matchState?.pinAttempt?.attacker;
      if (!attacker || humanPlayer !== attacker) {
        console.warn('[PIN] dropping offense submit - not the attacker', { humanPlayer, attacker });
        return;
      }
      // Server tracks pin stage authoritatively; we just send the pick
      // tagged with the current roundSeq. Stage validation happens on
      // the server based on its own matchState.
      networkClientRef.current?.sendPinPick(cardId, 'offense', currentRoundSeqRef.current || null);
      setPinOffenseChoice(cardId); // local visual feedback
      return;
    }
    setPinOffenseChoice(cardId);
  };

  const handlePinDefenseChoice = (cardId) => {
    if (gameMode === 'network') {
      const attacker = matchState?.pinAttempt?.attacker;
      const defender = attacker === 'p1' ? 'p2' : 'p1';
      if (!attacker || humanPlayer !== defender) {
        console.warn('[PIN] dropping defense submit - not the defender', { humanPlayer, attacker });
        return;
      }
      networkClientRef.current?.sendPinPick(cardId, 'defense', currentRoundSeqRef.current || null);
      setPinDefenseChoice(cardId); // local visual feedback
      return;
    }
    setPinDefenseChoice(cardId);
  };

  // ── Edge-swipe back navigation ──────────────────────────────────────────────
  // Native iOS-style: drag from the left edge to pop back to the previous
  // screen. Disabled on the menu (nowhere to go back to) and inside an active
  // match (the in-game gestures own the screen). Also suppressed while a
  // skill challenge is mid-flight so a stray swipe can't yank the player out
  // of the mechanic before it resolves.
  let swipeBackHandler = null;
  if (screen === 'replay') {
    swipeBackHandler = () => {
      const back = replayReturnScreen || 'replays';
      setActiveReplay(null);
      setReplayReturnScreen(null);
      setScreen(back);
    };
  } else if (screen === 'tournament') {
    swipeBackHandler = () => {
      clearTournament();
      setTournamentState(null);
      setTournamentMatchInfo(null);
      setScreen('menu');
    };
  } else if (screen === 'create_wrestler') {
    // Allow back-swipe from create-wrestler too; mirrors the existing onBack.
    swipeBackHandler = () => setScreen('menu');
  } else if (
    screen !== 'menu' &&
    screen !== 'game'
  ) {
    swipeBackHandler = () => setScreen('menu');
  }
  useSwipeBack({
    onBack: swipeBackHandler,
    disabled: !swipeBackHandler || !!pendingChallenge,
  });

  // ── Phase-1 Task 9: corrupt-save fallback ───────────────────────────────────
  // hydrateCareer threw CAREER_CORRUPT (validation + auto-repair both failed).
  // Show a recoverable banner instead of letting the user land on a blank
  // screen / partial career UI. Renders BEFORE any normal screen branch so
  // every entry point surfaces it. Dismiss returns the user to the menu so
  // they can retry, switch slots, or start a new career. This is the rare
  // unrecoverable case (e.g., wrestler field missing); repairCareer handles
  // most corruption silently before we ever throw.
  if (careerLoadError?.kind === 'corrupt') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
        <div className="max-w-md w-full bg-zinc-900 border border-amber-500/40 rounded-xl p-5 text-zinc-200 shadow-xl">
          <p className="font-bold text-amber-400 text-lg">This career save is corrupted</p>
          <p className="text-sm mt-2 text-zinc-400">
            We couldn't load it cleanly. You can try reloading the app, or
            dismiss this and pick a different career slot.
          </p>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-sm"
            >Try Again</button>
            <button
              onClick={() => {
                setCareerLoadError(null);
                setActiveCareer(null);
                setScreen('menu');
              }}
              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-black rounded text-sm font-bold"
            >Dismiss</button>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────

  if (screen === 'profile') {
    return (
      <ScreenTransition screenKey="profile">
        <React.Suspense fallback={<LazyFallback />}>
          <Profile
            onBack={() => setScreen('menu')}
            fallbackProfile={wrestlerProfile}
            onViewLeaderboard={() => setScreen('leaderboard')}
            onSignIn={(mode) => {
              const intent = mode === 'login' ? 'login' : 'signup';
              setAuthIntent(intent);
              setScreen('create_wrestler', { authIntent: intent });
            }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'privacy') {
    return <React.Suspense fallback={<LazyFallback />}><Privacy onBack={() => setScreen('menu')} /></React.Suspense>;
  }

  if (screen === 'terms') {
    return <React.Suspense fallback={<LazyFallback />}><Terms onBack={() => setScreen('menu')} /></React.Suspense>;
  }

  if (screen === 'about') {
    return <React.Suspense fallback={<LazyFallback />}><About onBack={() => setScreen('menu')} /></React.Suspense>;
  }

  if (screen === 'settings') {
    return (
      <ScreenTransition screenKey="settings">
        <React.Suspense fallback={<LazyFallback />}>
          <Settings
            onBack={() => setScreen('menu')}
            onPrivacy={() => setScreen('privacy')}
            onTerms={() => setScreen('terms')}
            onAbout={() => setScreen('about')}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'create_wrestler') {
    return (
      <CreateWrestler
        onBack={() => setScreen('menu')}
        onCreated={(profile) => { setWrestlerProfile(profile); setScreen('menu'); }}
        initialAuthMode={authIntent}
      />
    );
  }

  if (screen === 'decks') {
    return (
      <ScreenTransition screenKey="decks">
        <React.Suspense fallback={<LazyFallback />}>
          <DecksScreen
            profile={wrestlerProfile}
            // Career mode: restrict the editor to cards the wrestler has
            // unlocked (starter deck + skill-tree purchases). Coming from
            // Quick Match this is null and the editor shows the full pool.
            allowedCardIds={
              decksReturnRef.current === 'career_dashboard' && activeCareer?.wrestler?.unlockedCardIds
                ? new Set(activeCareer.wrestler.unlockedCardIds)
                : null
            }
            onBack={() => setScreen(decksReturnRef.current || 'menu')}
            onSave={async (decks, activeDeckId) => {
              // Optimistically update the local profile so the match-
              // init path sees the new deck immediately - Firestore
              // write happens in parallel.
              setWrestlerProfile(p => p ? { ...p, decks, activeDeckId } : p);
              if (!user?.uid) return { ok: true };
              const res = await withTimeout(
                saveDecks(user.uid, decks, activeDeckId),
                10_000,
                'decks.saveDecks'
              );
              if (!res.ok) {
                if (res.error === 'timeout') {
                  console.warn('[DECKS] save timed out');
                } else {
                  console.error('[DECKS] save failed', res.error);
                }
              }
              return res;
            }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'tutorial') {
    return (
      <ScreenTransition screenKey="tutorial">
        <React.Suspense fallback={<LazyFallback />}><Tutorial onBack={() => setScreen('menu')} /></React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'training') {
    return (
      <ScreenTransition screenKey="training">
        <React.Suspense fallback={<LazyFallback />}><TrainingHub onBack={() => setScreen('menu')} wrestlerProfile={wrestlerProfile} /></React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'modes') {
    return (
      <ScreenTransition screenKey="modes">
        <React.Suspense fallback={<LazyFallback />}>
          <ModesScreen
            onBack={() => setScreen('menu')}
            onVersusCpu={() => {
              const style = localStorage.getItem('matgrind_default_style') || 'folkstyle';
              const difficulty = localStorage.getItem('matgrind_default_difficulty') || 'medium';
              const p1Name = wrestlerProfile?.username || 'You';
              startGame('vs_ai', { p1: p1Name, p2: 'CPU Opponent' }, style, 'green', difficulty);
            }}
            onHeadToHead={() => {
              const style = localStorage.getItem('matgrind_default_style') || 'folkstyle';
              const p1Name = wrestlerProfile?.username || 'Green Wrestler';
              startGame('local', { p1: p1Name, p2: 'Red Wrestler' }, style, 'green');
            }}
            onNetwork={() => setScreen('network_lobby')}
            onCareer={() => setScreen('career_slot_picker')}
            onTournament={() => setScreen('tournament_setup')}
            onDualMeet={() => setScreen('dual_setup')}
            onTraining={() => setScreen('training')}
            isOffline={!navigator.onLine}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'tournament_setup') {
    return (
      <ScreenTransition screenKey="tournament_setup">
        <React.Suspense fallback={<LazyFallback />}>
          <TournamentSetupScreen
            onBack={() => setScreen('modes')}
            wrestlerProfile={wrestlerProfile}
            isAuthenticated={isAuthenticated}
            onConfirm={(bracketSize, format, guestName, style) => {
              const difficulty = localStorage.getItem('matgrind_default_difficulty') || 'medium';
              startTournament(difficulty, style || 'folkstyle', guestName || null, bracketSize, format);
            }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'leaderboard') {
    return (
      <ScreenTransition screenKey="leaderboard">
        <React.Suspense fallback={<LazyFallback />}>
          <Leaderboard
            onBack={() => setScreen('menu')}
            onViewProfile={(uid) => { setPublicProfileSource('leaderboard'); setPublicProfileUid(uid); setScreen('public_profile'); }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'public_profile' && publicProfileUid) {
    return (
      <ScreenTransition screenKey="public_profile">
        <React.Suspense fallback={<LazyFallback />}>
          <PublicProfile
            uid={publicProfileUid}
            onBack={() => { setPublicProfileUid(null); setScreen(publicProfileSource || 'leaderboard'); }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'friends') {
    return (
      <ScreenTransition screenKey="friends">
        <React.Suspense fallback={<LazyFallback />}>
          <Friends
            onBack={() => setScreen('menu')}
            onViewProfile={(uid) => { setPublicProfileSource('friends'); setPublicProfileUid(uid); setScreen('public_profile'); }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  // Career Depth Pass v1 (Step 4) - Bracket reveal screen. Pure presentation
  // over the already-seeded bracket; once onContinue fires we transition to
  // the regular tournament UI. Skips itself when pendingBracketReveal is null
  // (defensive: shouldn't happen, but render-safe if it does).
  if (screen === 'career_bracket_reveal') {
    if (!pendingBracketReveal) {
      setScreen('tournament');
      return null;
    }
    return (
      <BracketRevealScreen
        bracket={pendingBracketReveal.bracket}
        playerSeed={pendingBracketReveal.playerSeed}
        eventName={pendingBracketReveal.eventName}
        onContinue={() => {
          setPendingBracketReveal(null);
          setScreen('tournament');
        }}
      />
    );
  }

  if (screen === 'tournament') {
    return (
      <React.Suspense fallback={<LazyFallback />}>
        <TournamentBracket
          tournament={tournamentState}
          onStartMatch={handleTournamentStartMatch}
          onBack={() => {
            // Career tournaments: keep the in-memory bracket + Firestore
            // snapshot intact so the user can resume from where they were
            // (e.g., backing out to tweak skill points). Just navigate to
            // the career dashboard. The next time the user taps the same
            // event, the resume check in startCareerEvent picks it up.
            const isCareer = !!tournamentState?.careerEventId;
            if (isCareer) {
              setScreen('career_dashboard');
              return;
            }
            // Standalone tournaments: original quit-and-clear behaviour.
            clearTournament();
            setTournamentState(null);
            setTournamentMatchInfo(null);
            setScreen('menu');
          }}
          onTournamentUpdate={(updated) => setTournamentState({ ...updated })}
        />
      </React.Suspense>
    );
  }

  if (screen === 'dual_setup') {
    return (
      <React.Suspense fallback={<LazyFallback />}>
        <DualSetupScreen
          profile={wrestlerProfile}
          onBack={() => setScreen('menu')}
          onStart={startDual}
        />
      </React.Suspense>
    );
  }

  if (screen === 'dual_scoreboard') {
    return (
      <React.Suspense fallback={<LazyFallback />}>
        <DualScoreboard
          dual={dualMeetState}
          onStartNextBout={() => {
            const updated = startNextDualBout(dualMeetRef.current);
            if (updated) { setDualMeetState({ ...updated }); saveDual(updated); }
            handleDualStartBout();
          }}
          onSimulateBout={undefined}
          onQuit={exitDualMeet}
        />
      </React.Suspense>
    );
  }

  if (screen === 'dual_result') {
    return (
      <React.Suspense fallback={<LazyFallback />}>
        <DualResultScreen
          dual={dualMeetState}
          onMenu={exitDualMeet}
          onRematch={() => { clearDual(); setDualMeetState(null); setScreen('dual_setup'); }}
        />
      </React.Suspense>
    );
  }

  if (screen === 'career_dual_meet_setup') {
    return (
      <ScreenTransition screenKey="career_dual_meet_setup">
        <React.Suspense fallback={<LazyFallback />}>
          <CareerDualMeetSetup
            career={activeCareer}
            event={selectedCareerEvent}
            onBack={() => {
              setSelectedCareerEvent(null);
              setScreen('career_dashboard');
            }}
            onChoose={handleCareerDualMeetChoice}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'career_dual_meet') {
    // Defensive: if state is missing (e.g. mid-render before resume effect
    // populated dualMeetState), render the loading stub. A separate
    // effect-based watchdog elsewhere recovers stuck screens.
    if (!dualMeetState) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-zinc-700 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      );
    }
    // Reuse the standalone DualScoreboard component for the between-bouts
    // view. The "Start Next Bout" button is wired to the career-dual launcher
    // so saveMatchResult does NOT auto-record at bout end (career_dual modes
    // are deliberately distinct from 'career').
    return (
      <ScreenTransition screenKey="career_dual_meet">
        <React.Suspense fallback={<LazyFallback />}>
          <DualScoreboard
            dual={dualMeetState}
            onStartNextBout={() => {
              const updated = startNextDualBout(dualMeetRef.current);
              if (updated) { setDualMeetState({ ...updated }); saveCareerDual(updated); }
              handleStartCareerDualBout();
            }}
            onSimulateBout={handleSimulateCareerDualBout}
            onQuit={exitCareerDualMeet}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'career_dual_meet_result') {
    const payload = careerDualResultPayload || {
      dual: dualMeetState,
      xpGained: 0,
      teamWinner: null,
      event: selectedCareerEvent,
    };
    return (
      <ScreenTransition screenKey="career_dual_meet_result">
        <React.Suspense fallback={<LazyFallback />}>
          <CareerDualMeetResult
            career={activeCareer}
            event={payload.event}
            dual={payload.dual}
            xpGained={payload.xpGained}
            teamWinner={payload.teamWinner}
            onReturn={() => {
              setSelectedCareerEvent(null);
              setCareerDualResultPayload(null);
              setDualMeetState(null);
              setScreen('career_dashboard');
            }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'tournament_history') {
    return (
      <React.Suspense fallback={<LazyFallback />}>
        <TournamentHistory
          onBack={() => setScreen('menu')}
          profile={wrestlerProfile}
          onLeaderboard={() => setScreen('leaderboard')}
        />
      </React.Suspense>
    );
  }

  if (screen === 'replays') {
    return (
      <ScreenTransition screenKey="replays">
        <React.Suspense fallback={<LazyFallback />}>
          <ReplayList
            onWatch={(r) => { setActiveReplay(r); setScreen('replay'); }}
            onBack={() => setScreen('menu')}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'replay' && activeReplay) {
    return (
      <ScreenTransition screenKey="replay">
        <React.Suspense fallback={<LazyFallback />}>
          <ReplayViewer replay={activeReplay} onClose={() => {
            const back = replayReturnScreen || 'replays';
            setActiveReplay(null);
            setReplayReturnScreen(null);
            setScreen(back);
          }} />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'elijah_challenge') {
    return (
      <ScreenTransition screenKey="elijah_challenge">
        <React.Suspense fallback={<LazyFallback />}>
          <ElijahChallenge
            wrestlerProfile={wrestlerProfile}
            onBack={() => setScreen('menu')}
            onStartMatch={startElijahBossMatch}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'menu') {
    return (
      <ScreenTransition screenKey="menu">
        <WhatsNew />
        <MainMenu
          onStart={startGame}
          onProfile={() => setScreen('profile')}
          onPrivacy={() => setScreen('privacy')}
          onTerms={() => setScreen('terms')}
          onAbout={() => setScreen('about')}
          onCreateWrestler={() => setScreen('create_wrestler')}
          onTutorial={() => setScreen('tutorial')}
          onLeaderboard={() => setScreen('leaderboard')}
          onTournamentHistory={() => setScreen('tournament_history')}
          onReplays={() => setScreen('replays')}
          onModes={() => setScreen('modes')}
          // Guard: don't enter Decks until the wrestler profile has
          // loaded - otherwise DecksScreen renders against an empty
          // initialDecks and the user can lose context.
          onDecks={wrestlerProfile ? () => setScreen('decks') : undefined}
          onSettings={() => setScreen('settings')}
          onChallengeElijah={() => setScreen('elijah_challenge')}
          wrestlerProfile={wrestlerProfile}
          isAuthenticated={isAuthenticated}
          dailyChallengesSlot={<DailyChallenges />}
          featuredDailyGoalSlot={
            <DailyGoalCard goal={loadFeaturedDailyGoal(wrestlerProfile)} />
          }
        />
      </ScreenTransition>
    );
  }

  if (screen === 'career_creation') {
    return (
      <ScreenTransition screenKey="career_creation">
        <React.Suspense fallback={<LazyFallback />}>
          <CareerCreation
            defaultName={wrestlerProfile?.username || ''}
            onBack={() => setScreen('menu')}
            onCreated={handleCareerCreated}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'career_dashboard') {
    // Safety: if we landed here without a career (e.g. after sign-out),
    // bounce back to creation so the user has a way forward.
    if (!activeCareer) {
      return (
        <ScreenTransition screenKey="career_dashboard_empty">
          <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 p-6">
            <div className="text-zinc-400">No active career.</div>
            <button
              onClick={() => setScreen('career_creation')}
              className="px-4 py-2 rounded bg-emerald-700 text-white font-semibold"
            >
              Start a career
            </button>
            <button
              onClick={() => setScreen('menu')}
              className="text-zinc-500 text-sm"
            >
              Back to menu
            </button>
          </div>
        </ScreenTransition>
      );
    }
    // Forward-compat: if a future client wrote a phase this build doesn't
    // know about (e.g., user played on a newer web build, then opens this
    // older mobile build), render a graceful "update required" banner
    // instead of letting downstream code crash.
    if (activeCareer.phase && !KNOWN_PHASES.has(activeCareer.phase)) {
      return (
        <ScreenTransition screenKey="career_update_required">
          <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 p-6">
            <div className="text-amber-300 text-xs uppercase tracking-[0.3em]">Update Required</div>
            <div className="text-xl font-bold text-center max-w-md">
              This career was saved on a newer version of MatGrind.
            </div>
            <div className="text-sm text-zinc-400 text-center max-w-md">
              Update the app to continue playing. Your record, rivals, and trophies are safe.
            </div>
            <button
              onClick={() => setScreen('menu')}
              className="mt-4 px-4 py-2 rounded bg-zinc-800 text-zinc-200 font-semibold"
            >
              Back to Menu
            </button>
          </div>
        </ScreenTransition>
      );
    }
    // Career Retired splash. Rendered when `activeCareer.phase === 'retired'`.
    // After `handleCareerRetire` runs, the user lands here and explicitly
    // picks Free This Slot / Hall of Fame / Pick a Career. The splash is also
    // the destination for re-hydrating a retired career from Firestore on app
    // boot.
    if (activeCareer.phase === 'retired') {
      const wName = activeCareer.wrestler?.name || 'Wrestler';
      return (
        <ScreenTransition screenKey="career_retired_splash">
          <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4 p-6">
            <div className="text-amber-300 text-xs uppercase tracking-[0.3em]">Career Retired</div>
            <div className="text-xl font-bold text-center max-w-md">
              {wName} has hung up the singlet.
            </div>
            <div className="text-sm text-zinc-400 text-center max-w-md">
              View this career in the Hall of Fame, or pick a different slot to keep wrestling.
            </div>
            <div className="mt-4 flex flex-col gap-2 w-full max-w-xs">
              <button
                onClick={async () => {
                  // Free the slot so this career moves to "Restore a previous
                  // career" / Hall of Fame instead of being pinned. Handles
                  // stale data from retirements that ran before the slot-
                  // clearing fix landed.
                  const uid = user?.uid;
                  if (uid && activeCareer?.id) {
                    try {
                      const slots = await getCareerSlots(uid);
                      const target = slots.find(s => s.careerId === activeCareer.id);
                      if (target) await clearSlot(uid, target.slotId).catch(() => {});
                      const fresh = await getCareerSlots(uid);
                      setCareerSlots(fresh);
                    } catch (_e) { /* noop */ }
                  }
                  setActiveCareer(null);
                  clearLocalCareer(uid || 'guest');
                  setScreen('career_slot_picker');
                }}
                className="px-4 py-3 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-bold"
              >
                Free This Slot
              </button>
              <button
                onClick={() => setScreen('career_trophy_case')}
                className="px-4 py-3 rounded bg-amber-700 hover:bg-amber-600 text-white font-semibold"
              >
                Hall of Fame
              </button>
              <button
                onClick={() => {
                  // Clear the local mirror so a reload re-hydrates from
                  // Firestore (the source of truth for retirement). Without
                  // this, the splash could re-render from stale localStorage.
                  clearLocalCareer(user?.uid || 'guest');
                  setActiveCareer(null);
                  setScreen('career_slot_picker');
                }}
                className="px-4 py-3 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold"
              >
                Pick a Career
              </button>
            </div>
          </div>
        </ScreenTransition>
      );
    }
    // Tier transitions: recruiting (HS senior -> college pick), tier_transition
    // (one-shot celebration after a college acceptance or senior style pick),
    // senior_style_choice (college senior -> freestyle/greco). Each takes
    // priority over the dashboard until the user resolves it.
    if (activeCareer.phase === 'recruiting') {
      return (
        <ScreenTransition screenKey="career_recruiting">
          <React.Suspense fallback={<LazyFallback />}>
            <CareerRecruitingScreen
              career={activeCareer}
              onBack={() => setScreen('menu')}
              onAcceptOffer={handleAcceptCollegeOffer}
              onWalkOn={handleTakeWalkOnPath}
              onRetire={handleCareerRetire}
            />
          </React.Suspense>
        </ScreenTransition>
      );
    }
    if (activeCareer.phase === 'tier_transition') {
      return (
        <ScreenTransition screenKey="career_tier_transition">
          <React.Suspense fallback={<LazyFallback />}>
            <CareerTierTransitionScreen
              career={activeCareer}
              onContinue={handleConfirmTierTransition}
            />
          </React.Suspense>
        </ScreenTransition>
      );
    }
    if (activeCareer.phase === 'senior_style_choice') {
      return (
        <ScreenTransition screenKey="career_senior_style">
          <React.Suspense fallback={<LazyFallback />}>
            <CareerSeniorStyleChoice
              career={activeCareer}
              onBack={() => setScreen('menu')}
              onChooseStyle={handleChooseSeniorStyle}
              onRetire={handleCareerRetire}
            />
          </React.Suspense>
        </ScreenTransition>
      );
    }
    // Phase B: when the season flips to offseason, show the dedicated
    // offseason hub instead of the inline "Season Complete" card. The hub
    // surfaces XP/level gained, skill-point spending, and the advance/
    // retire decision in one place.
    if (activeCareer.phase === 'offseason') {
      return (
        <ScreenTransition screenKey="career_offseason">
          <React.Suspense fallback={<LazyFallback />}>
            <CareerOffseasonScreen
              career={activeCareer}
              onBack={() => setScreen('menu')}
              onWrestlerChange={handleCareerWrestlerChange}
              onAdvanceSeason={handleCareerAdvanceSeason}
              onRetire={handleCareerRetire}
            />
          </React.Suspense>
        </ScreenTransition>
      );
    }
    // Decision-event modal takes precedence over the dashboard once a
    // decision is queued - surfaces it as soon as the user lands.
    if (activeCareer.pendingDecision) {
      return (
        <ScreenTransition screenKey="career_decision">
          <React.Suspense fallback={<LazyFallback />}>
            <CareerDecisionScreen
              career={activeCareer}
              decision={activeCareer.pendingDecision}
              onResolve={(updatedCareer) => {
                setActiveCareer(updatedCareer);
                if (user?.uid) saveCareer(user.uid, updatedCareer).catch(() => {});
              }}
              onDefer={() => {
                // Allow user to skip - clear the pending decision without applying.
                const next = { ...activeCareer, pendingDecision: null };
                setActiveCareer(next);
                if (user?.uid) saveCareer(user.uid, next).catch(() => {});
              }}
            />
          </React.Suspense>
        </ScreenTransition>
      );
    }
    return (
      <ScreenTransition screenKey="career_dashboard">
        <React.Suspense fallback={<LazyFallback />}>
          <CareerDashboard
            career={activeCareer}
            onBack={() => setScreen('menu')}
            onStartEvent={(event) => {
              setSelectedCareerEvent(event);
              setScreen('career_event_preview');
            }}
            onSimulateWeek={handleSimulateWeek}
            onAdvanceSeason={handleCareerAdvanceSeason}
            onRetire={handleCareerRetire}
            onDecks={() => { decksReturnRef.current = 'career_dashboard'; setScreen('decks'); }}
            onWrestlerChange={handleCareerWrestlerChange}
            onStartNewCareer={handleCareerStartNew}
            onDeleteCareer={async () => {
              if (!user?.uid || !activeCareer?.id) return;
              try {
                await deleteCareer(user.uid, activeCareer.id);
              } catch (err) {
                console.warn('[Career-Delete] failed:', err?.message);
                import('@/components/ui/use-toast').then(({ toast }) => {
                  toast({ title: 'Delete failed', description: 'Could not delete career. Try again.', variant: 'destructive' });
                }).catch(() => {});
                return;
              }
              setActiveCareer(null);
              try {
                const fresh = await getCareerSlots(user.uid);
                setCareerSlots(fresh);
              } catch { /* offline */ }
              setScreen('career_slot_picker');
            }}
            onOpenTrophyCase={() => setScreen('career_trophy_case')}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'career_slot_picker') {
    return (
      <ScreenTransition screenKey="career_slot_picker">
        <React.Suspense fallback={<LazyFallback />}>
          <CareerSlotPicker
            uid={user?.uid}
            slots={careerSlots}
            slotsLoaded={careerSlotsLoaded}
            activeCareerId={activeCareer?.id}
            onBack={() => setScreen('menu')}
            onSelectCareer={async (career) => {
              let hydrated;
              try {
                hydrated = hydrateCareer(career);
              } catch (e) {
                if (e?.code === 'CAREER_CORRUPT') {
                  console.error('[loadCareer:slot] career corrupt, errors:', e.errors);
                  setCareerLoadError({ kind: 'corrupt', errors: e.errors });
                  return;
                }
                throw e;
              }
              // Career Depth Pass v1: scrub any modifier stash before loading
              // a different career. Tag mismatch would already prevent leakage
              // on read, but an explicit clear keeps in-memory state tidy.
              clearCareerMatchModifiers();
              setActiveCareer(hydrated);
              if (user?.uid) {
                // Mark this slot as the active one.
                const updated = careerSlots.map(s =>
                  s.careerId === hydrated.id
                    ? { ...s, lastPlayedAt: Date.now() }
                    : s
                );
                setCareerSlots(updated);
                setActiveSlot(user.uid, updated, hydrated.id).catch(() => {});
              }
              // Always route to career_dashboard; the nested phase fork at
              // the screen-render layer renders CareerOffseasonScreen when
              // activeCareer.phase === 'offseason'. Matches the pattern
              // already used for recruiting / tier_transition /
              // senior_style_choice phases (which never use a top-level
              // screen name either).
              setScreen('career_dashboard');
            }}
            onCreateInSlot={(slotId) => {
              pendingSlotIdRef.current = slotId;
              setScreen('career_creation');
            }}
            onClearSlot={async (slotId) => {
              if (!user?.uid) return;
              const target = careerSlots.find(s => s.slotId === slotId);
              if (!target?.careerId) return;
              // Archive the career in this slot (preserves it in Hall of Fame).
              try {
                const c = await getCareerForSlot(user.uid, target);
                if (c) {
                  // If the career is too corrupt to hydrate, skip the
                  // archive step entirely - we still want clearSlot to
                  // succeed below so the user can move on.
                  let hydrated;
                  try { hydrated = hydrateCareer(c); }
                  catch (e) {
                    if (e?.code === 'CAREER_CORRUPT') {
                      console.warn('[clearSlot] career too corrupt to archive, skipping HoF entry');
                      hydrated = null;
                    } else { throw e; }
                  }
                  if (hydrated) {
                    const retired = retireCareer(hydrated, { reason: 'user_restart' });
                    const thumb = buildHallOfFameThumbnail(retired);
                    await archiveCareer(user.uid, retired, thumb).catch(() => {});
                  }
                }
              } catch { /* best-effort */ }
              await clearSlot(user.uid, slotId);
              const fresh = await getCareerSlots(user.uid);
              setCareerSlots(fresh);
              // If the cleared slot was the active one, drop active state.
              if (activeCareer && target.careerId === activeCareer.id) {
                setActiveCareer(null);
                clearLocalCareer(user.uid);
              }
            }}
            onRestoreCareer={async (careerId) => {
              console.log('[Career-Restore] tap', { uid: user?.uid, careerId });
              if (!user?.uid) {
                import('@/components/ui/use-toast').then(({ toast }) => {
                  toast({ title: 'Sign in required', description: 'Sign in to restore a career.', variant: 'destructive' });
                }).catch(() => {});
                return;
              }
              if (!careerId) {
                import('@/components/ui/use-toast').then(({ toast }) => {
                  toast({ title: "Couldn't restore", description: 'Career ID was missing.', variant: 'destructive' });
                }).catch(() => {});
                return;
              }
              const empty = careerSlots.find(s => !s.careerId);
              if (!empty) {
                import('@/components/ui/use-toast').then(({ toast }) => {
                  toast({ title: 'No empty slot', description: 'Free up a slot first by long-pressing one of your careers.', variant: 'destructive' });
                }).catch(() => {});
                return;
              }
              try {
                console.log('[Career-Restore] writing slot pointer', { slotId: empty.slotId });
                const updated = await restoreCareerToSlot(user.uid, careerId, empty.slotId);
                console.log('[Career-Restore] slot write done', { ok: !!updated });
                if (updated) setCareerSlots(updated);
                const restored = await getCareerForSlot(user.uid, { careerId });
                console.log('[Career-Restore] doc fetch done', { found: !!restored, phase: restored?.phase });
                if (!restored) {
                  import('@/components/ui/use-toast').then(({ toast }) => {
                    toast({ title: "Couldn't load career", description: 'The career data may have been deleted.', variant: 'destructive' });
                  }).catch(() => {});
                  return;
                }
                // Un-retire if needed. The user explicitly chose to restore
                // this career, which means they want to keep playing it -
                // don't dead-end them on a retired splash. Strip the retired
                // phase + flags and let hydrateCareer infer the right phase
                // from the schedule (offseason if season is complete,
                // in_season if mid-season, preseason if fresh).
                const wasRetired = restored.phase === 'retired';
                const sourceCareer = wasRetired
                  ? (() => {
                      const next = { ...restored };
                      delete next.phase;
                      delete next.retiredAt;
                      delete next.retireReason;
                      return next;
                    })()
                  : restored;
                let hydrated;
                try {
                  hydrated = hydrateCareer(sourceCareer);
                } catch (e) {
                  if (e?.code === 'CAREER_CORRUPT') {
                    console.error('[Career-Restore] career corrupt, errors:', e.errors);
                    setCareerLoadError({ kind: 'corrupt', errors: e.errors });
                    return;
                  }
                  throw e;
                }
                console.log('[Career-Restore] hydrated', { phase: hydrated.phase, wasRetired, tier: hydrated.wrestler?.tier, year: hydrated.wrestler?.year });
                setActiveCareer(hydrated);
                // Persist the un-retired state immediately so a reload
                // doesn't race with the on-load auto-sweep, which clears
                // any slot pointing at a retired career. We await the save
                // before navigating - if it fails, the user lands on the
                // dashboard but a refresh would re-strand them, so log
                // loudly when this fails.
                if (wasRetired) {
                  try {
                    await saveCareer(user.uid, hydrated);
                  } catch (err) {
                    console.warn('[Career-Restore] save after un-retire failed:', err?.message);
                  }
                }
                import('@/components/ui/use-toast').then(({ toast }) => {
                  toast({
                    title: wasRetired ? 'Career un-retired' : 'Career restored',
                    description: `${hydrated.wrestler?.name || 'Your wrestler'} is ready to wrestle.`,
                  });
                }).catch(() => {});
                // Always route to career_dashboard; the nested phase fork at
                // the screen-render layer renders CareerOffseasonScreen when
                // activeCareer.phase === 'offseason'. Matches the pattern
                // already used for recruiting / tier_transition /
                // senior_style_choice phases.
                setScreen('career_dashboard');
              } catch (err) {
                console.error('[Career-Restore] failed:', err);
                import('@/components/ui/use-toast').then(({ toast }) => {
                  toast({
                    title: "Couldn't restore career",
                    description: err?.message || 'Unknown error - check console for details.',
                    variant: 'destructive',
                  });
                }).catch(() => {});
              }
            }}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'career_trophy_case') {
    return (
      <ScreenTransition screenKey="career_trophy_case">
        <React.Suspense fallback={<LazyFallback />}>
          <CareerTrophyCase
            trophies={activeCareer?.record?.titles || []}
            careerName={activeCareer?.wrestler?.name}
            prestigeBadges={activeCareer?.prestigeBadges || []}
            onBack={() => setScreen('career_dashboard')}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'career_event_preview') {
    return (
      <ScreenTransition screenKey="career_event_preview">
        <React.Suspense fallback={<LazyFallback />}>
          <CareerEventPreview
            career={activeCareer}
            event={selectedCareerEvent}
            onBack={() => setScreen('career_dashboard')}
            onWrestle={(event) => startCareerEvent(event)}
          />
        </React.Suspense>
      </ScreenTransition>
    );
  }

  if (screen === 'network_lobby') {
    return (
      <NetworkLobby
        onGameStart={startNetworkGame}
        onBack={() => setScreen('menu')}
        onCreateWrestler={(mode) => {
          const intent = mode === 'login' ? 'login' : 'signup';
          setAuthIntent(intent);
          setScreen('create_wrestler', { authIntent: intent });
        }}
      />
    );
  }

  if (!matchState) {
    // Recovery handler: if there's no match in flight, this fallback can
    // permanently strand the user (no other screen branch matched, no
    // matchState to render the actual match UI). Clear any stale persisted
    // match + tournament state and route the user back to home so they
    // can pick a new path. Tapping the button is a manual escape hatch in
    // case the auto-recovery effect didn't fire (e.g., Capacitor lifecycle
    // weirdness).
    const recoverToMenu = () => {
      try { clearMatchFromStorage(); } catch { /* best-effort */ }
      const uid = auth.currentUser?.uid;
      const cid = activeCareerRef.current?.id;
      if (uid && cid) {
        try { clearCareerTournament(uid, cid); } catch { /* best-effort */ }
      }
      setTournamentState(null);
      setTournamentMatchInfo(null);
      setScreen('menu');
    };
    return (
      <div className="min-h-full bg-zinc-950 flex flex-col items-center justify-center px-6 py-10">
        <div className="w-8 h-8 border-4 border-zinc-700 border-t-amber-400 rounded-full animate-spin mb-6" />
        <div className="text-zinc-400 text-sm font-semibold mb-2">Loading match...</div>
        <div className="text-zinc-500 text-xs mb-6">If this stays stuck, tap below.</div>
        <button
          onClick={recoverToMenu}
          className="px-5 py-2 mb-6 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 text-sm font-semibold hover:border-emerald-700 hover:bg-emerald-950/30 active:scale-[0.98] transition"
        >
          Go to home
        </button>
        <div className="max-w-md text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500/70 mb-1.5">TIP</div>
          <div className="text-zinc-400 text-sm leading-snug">{randomTip()}</div>
        </div>
      </div>
    );
  }

  const showPeriodModal = matchState.phase === 'period_break' && matchState.periodChoicePending &&
    (gameMode !== 'network' || matchState.pendingChoiceFor === networkPlayer);
  const showNetworkPeriodWait = gameMode === 'network' && matchState.phase === 'period_break' &&
    matchState.periodChoicePending && matchState.pendingChoiceFor !== networkPlayer;
  const showResultModal = matchState.phase === 'finished';
  const showPinModal = matchState.phase === 'pin_attempt' && matchState.pinAttempt;
  const isPlaying = matchState.phase === 'playing' || matchState.phase === 'overtime';
  const isFreestyle = matchState.wrestlingStyle === 'freestyle';
  const isGreco = matchState.wrestlingStyle === 'greco';
  const isWomensFreestyle = matchState.wrestlingStyle === 'womens_freestyle';
  // International ruleset = freestyle + greco + women's freestyle. Without
  // women's-freestyle in this flag, the in-match header label, period count,
  // and passivity warnings fell through to folkstyle defaults for women's
  // college dual meets.
  const isIntl = isFreestyle || isGreco || isWomensFreestyle;

  // Resolve wrestler colors for visual components
  const playerAppearance = wrestlerProfile?.appearance || null;
  const p1Colors = humanPlayer === 'p1'
    ? getWrestlerColors(playerAppearance, 'p1', colorblind)
    : getWrestlerColors(null, 'p1', colorblind);
  const p2Colors = humanPlayer === 'p2'
    ? getWrestlerColors(playerAppearance, 'p2', colorblind)
    : getWrestlerColors(null, 'p2', colorblind);

  // Determine which side of pin modal is waiting for human input
  const pinAttacker = matchState.pinAttempt?.attacker;
  const pinDefender = pinAttacker === 'p1' ? 'p2' : 'p1';
  const p1IsPinAttacker = pinAttacker === 'p1';

  // Last action message for inline display
  const lastMsg = matchState.lastResult?.message;
  const lastType = matchState.lastResult?.type;
  const msgColorMap = {
    takedown: 'text-emerald-400', escape: 'text-amber-400', reversal: 'text-yellow-300',
    near_fall: 'text-emerald-300', pin: 'text-red-400', tech_fall: 'text-purple-400',
    counter: 'text-sky-400', control: 'text-blue-300', scramble: 'text-yellow-300',
    boundary_reset: 'text-amber-400', period: 'text-zinc-500', setup: 'text-zinc-400',
    stalemate: 'text-zinc-500', ride_time: 'text-yellow-400', pin_stage1: 'text-orange-400',
    pin_stage1_survived: 'text-orange-400', pin_stage2: 'text-orange-400',
    pin_stage2_survived: 'text-orange-400',
    exposure: 'text-amber-300', grand_amplitude: 'text-red-300',
    passivity: 'text-amber-500', passivity_warning: 'text-yellow-500', overtime: 'text-purple-300',
    stalling_warning: 'text-amber-400', stalling_penalty: 'text-amber-500',
    par_terre_reset: 'text-amber-400', decision: 'text-zinc-300', draw: 'text-zinc-500',
  };
  const msgColor = msgColorMap[lastType] || 'text-zinc-400';

  // Transition-spam chip: announces the bonus decay AND the folkstyle stalling
  // call (warning / opponent +1) on one line. The stalling outcome rides on
  // `stall` because the engine's stalling_penalty lastResult is clobbered by
  // the gameplay result - `stall` on the spam meta is what survives.
  const transitionSpamLine = (meta, name) => {
    if (!meta) return null;
    const text = meta.stall === 'penalty' ? 'transition spam - STALLING, opponent +1'
      : meta.stall === 'warning'          ? 'transition stalling warning - opponent +1 if it continues'
      : meta.level === 'penalty'          ? 'transition spam - bonus denied'
      : meta.level === 'half'             ? 'transition spam - bonus halved'
      :                                     'transition stalling risk - vary your moves';
    const color = (meta.stall === 'penalty' || meta.level === 'penalty') ? 'text-red-400'
      : meta.stall === 'warning'          ? 'text-amber-400'
      : meta.level === 'half'             ? 'text-orange-400'
      :                                     'text-amber-300';
    return <p className={`text-[10px] mt-0.5 ${color}`}>⚠ {name}: {text}</p>;
  };

  return (
    <motion.div
      animate={shakeControls}
      className="h-full bg-zinc-950 text-white flex flex-col overflow-hidden"
      role="main"
      aria-label="Wrestling match"
    >
      {showPeriodModal && (
        <PeriodChoiceModal state={matchState} onChoice={handlePeriodChoice} gameMode={gameMode} humanPlayer={humanPlayer} />
      )}
      {leaveConfirmPending && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="Leave match confirmation">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full text-center">
            <div className="text-white font-black text-lg mb-2">Leave the match?</div>
            <div className="text-zinc-400 text-sm mb-5">
              Your opponent is waiting. Leaving now will forfeit this match.
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setLeaveConfirmPending(null)}
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-2 rounded-lg transition-colors"
              >
                Stay
              </button>
              <button
                onClick={() => {
                  const action = leaveConfirmPending;
                  setLeaveConfirmPending(null);
                  networkClientRef.current?.disconnect();
                  clearMatchFromStorage();
                  if (typeof action === 'function') action();
                }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold py-2 rounded-lg transition-colors"
              >
                Forfeit
              </button>
            </div>
          </div>
        </div>
      )}
      {showResumeModal && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center px-4" role="dialog" aria-modal="true" aria-label="Resume match">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full text-center">
            <div className="text-white font-black text-lg mb-2">Match paused</div>
            <div className="text-zinc-400 text-sm mb-5">
              You stepped away. Continue where you left off, or forfeit and return to the main menu?
            </div>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => setShowResumeModal(false)}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black py-2 rounded-lg transition-colors"
              >
                Continue
              </button>
              <button
                onClick={() => {
                  setShowResumeModal(false);
                  networkClientRef.current?.disconnect();
                  clearMatchFromStorage();
                  if (gameMode === 'tournament') { clearTournament(); setTournamentState(null); }
                  if (isDualMode(gameMode)) { clearDual(); setDualMeetState(null); }
                  setScreen('menu');
                }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold py-2 rounded-lg transition-colors"
              >
                Forfeit
              </button>
            </div>
          </div>
        </div>
      )}
      {showResultModal && (
        <MatchResultModal
          state={matchState}
          postMatchData={postMatchData}
          rematchStatus={rematchStatus}
          onRematch={handleRematch}
          onDeclineRematch={handleDeclineRematch}
          onMenu={() => {
            // If we have an outstanding rematch handshake, free the
            // opponent's UI before we tear down our socket.
            if (gameMode === 'network' && rematchStatus !== 'idle') {
              networkClientRef.current?.sendRematchDecline?.();
              setRematchStatus('idle');
            }
            // Career-tournament Quit: ask the user to confirm before
            // forfeiting (the action records bracket progress as the final
            // result and advances the schedule, which is destructive). The
            // gameMode flag is 'tournament' during a career bracket match
            // but the tournamentState carries `careerEventId` to mark it.
            if (gameMode === 'tournament' && tournamentState?.careerEventId) {
              setShowQuitTournamentConfirm(true);
              return;
            }
            clearMatchFromStorage();
            if (gameMode === 'tournament') { clearTournament(); setTournamentState(null); }
            if (isDualMode(gameMode)) { clearDual(); setDualMeetState(null); }
            if (isCareerDualMode(gameMode)) {
              // Telemetry: privately count career-dual aborts so we can
              // detect systematic retry-on-loss without changing gameplay.
              // Same shape as exitCareerDualMeet's audit; failures swallowed.
              try {
                const dual = dualMeetState;
                const eventId = dual?.careerEventId || selectedCareerEvent?.id || null;
                const sched = activeCareer?.schedule?.events;
                const evt = Array.isArray(sched) && eventId
                  ? sched.find(e => e?.id === eventId)
                  : null;
                const isInFlight = !!dual && dual.phase !== 'complete' && evt?.status === 'upcoming';
                if (isInFlight && activeCareer && eventId) {
                  const next = recordCareerDualAbort(activeCareer, eventId, evt?.name || null, 'dual_meet');
                  setActiveCareer(next);
                  if (user?.uid) saveCareer(user.uid, next).catch(() => { /* noop */ });
                }
              } catch (_e) { /* never block the quit on telemetry */ }
              clearCareerDual();
              setDualMeetState(null);
              setSelectedCareerEvent(null);
              setScreen('career_dashboard');
              return;
            }
            if (gameMode === 'career') {
              setSelectedCareerEvent(null);
              setScreen('career_dashboard');
              return;
            }
            setScreen('menu');
          }}
          onReplay={replayRef.current ? () => {
            // Remember where to return when the viewer closes - typically
            // 'wrestling' during a dual / tournament / career match. Without
            // this the close button drops the user at the replay library and
            // they lose access to Continue Dual / Continue Tournament.
            setReplayReturnScreen(screen);
            setActiveReplay(replayRef.current);
            setScreen('replay');
          } : null}
          // Dual Meets + Career reuse the tournament modal CTA slot
          isTournament={gameMode === 'tournament' || isAnyDualMode(gameMode) || gameMode === 'career'}
          tournamentRound={
            gameMode === 'tournament'
              ? tournamentMatchInfo?.round
              : isAnyDualMode(gameMode) && dualMeetState
                ? `Bout ${Math.min((dualMeetState.currentBoutIndex ?? 0) + 1, dualMeetState.bouts.length)}/${dualMeetState.bouts.length}`
                : gameMode === 'career' && activeCareer
                  ? `Year ${activeCareer.schedule.seasonYear}`
                  : undefined
          }
          onContinueTournament={
            isCareerDualMode(gameMode)
              ? handleContinueCareerDualMeet
              : gameMode === 'career'
                ? handleContinueCareer
                : isDualMode(gameMode)
                  ? handleContinueDual
                  : handleContinueTournament
          }
          gameMode={gameMode}
          humanPlayer={humanPlayer}
          playerAppearance={playerAppearance}
          profile={wrestlerProfile}
        />
      )}
      {showQuitTournamentConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-md w-full rounded-2xl border border-zinc-700 bg-zinc-950 p-5">
            <div className="text-amber-300 text-xs font-black uppercase tracking-[0.2em] mb-2">Forfeit Tournament</div>
            <div className="text-white font-bold text-lg mb-2">Quit and record this result?</div>
            <div className="text-zinc-400 text-sm leading-relaxed mb-4">
              Your bracket progress so far will count as the final result. You won&apos;t be able to come back to this tournament.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowQuitTournamentConfirm(false)}
                className="flex-1 py-3 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowQuitTournamentConfirm(false);
                  handleCareerTournamentForfeit();
                }}
                className="flex-1 py-3 rounded-lg bg-amber-700 hover:bg-amber-600 text-white font-bold"
              >
                Forfeit
              </button>
            </div>
          </div>
        </div>
      )}
      {showNetworkPeriodWait && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8 text-center">
            <div className="text-yellow-400 font-black text-lg animate-pulse">Opponent is choosing position...</div>
            <div className="text-zinc-500 text-sm mt-2">Period Break</div>
          </div>
        </div>
      )}
      {showPinModal && (
        <PinAttemptModal
          state={matchState}
          onOffenseChoice={handlePinOffenseChoice}
          onDefenseChoice={handlePinDefenseChoice}
          humanPlayer={humanPlayer}
          pendingOffense={pinOffenseChoice}
          pendingDefense={pinDefenseChoice}
        />
      )}

      <div className="flex flex-col flex-1 overflow-y-auto max-w-lg md:max-w-2xl mx-auto w-full px-3 pt-2 pb-2 gap-2" style={{ WebkitOverflowScrolling: 'touch' }}>

        {/* Nav */}
        <div className="flex items-center justify-between flex-shrink-0">
          <button
            onClick={() => attemptLeaveMatch(() => { clearMatchFromStorage(); setScreen('menu'); })}
            className="text-zinc-600 hover:text-zinc-300 text-sm font-semibold transition-colors px-1 py-1"
          >
            ← Menu
          </button>
          <div className="text-center">
            <div className={`${isWomensFreestyle ? 'text-teal-400' : isGreco ? 'text-red-400' : isFreestyle ? 'text-orange-400' : 'text-yellow-400'} text-xs font-black uppercase tracking-[0.2em]`}>{isWomensFreestyle ? "Women's Freestyle" : isGreco ? 'Greco-Roman' : isFreestyle ? 'Freestyle' : 'Folkstyle'}</div>
            <div className="text-zinc-600 text-xs">{gameMode === 'tournament' ? 'Tournament' : gameMode === 'vs_ai' ? 'vs CPU' : gameMode === 'network' ? (networkPlayer === 'spectator' ? 'Spectating' : networkModeRef.current === 'online' ? 'Online Match' : `LAN (${networkPlayer?.toUpperCase()})`) : 'Local 2P'}</div>
          </div>
          <button
            onClick={() => setScreen('profile')}
            className="text-zinc-600 hover:text-zinc-300 text-sm font-semibold transition-colors px-1 py-1"
          >
            Profile →
          </button>
        </div>

        {/* ScoreBoard (includes position image in center) */}
        <div className="flex-shrink-0">
          <ScoreBoard state={matchState} />
        </div>

        {/* Overtime banner */}
        {matchState.phase === 'overtime' && (
          <div className="flex-shrink-0 bg-purple-900/30 border border-purple-700/50 rounded-lg px-3 py-1.5 text-center">
            <span className="text-purple-300 text-xs font-black uppercase tracking-wider animate-pulse">SUDDEN VICTORY - First to Score Wins!</span>
          </div>
        )}

        {/* Position chip - persistent state-of-the-mat indicator. Always
            visible, always current. Tells the player WHERE the action stands
            (FHL, leg secured, on base, broken down, scramble, par terre
            clock, etc.) so the next card pick is informed. */}
        {(() => {
          const { tag, tone } = describeMatchPosition(matchState);
          if (!tag) return null;
          const toneCls = tone === 'urgent'
            ? 'bg-amber-950/60 border-amber-700 text-amber-200'
            : tone === 'top'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
              : tone === 'bottom'
                ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                : 'bg-zinc-900 border-zinc-800 text-zinc-300';
          return (
            <div className="flex-shrink-0 flex items-center justify-center">
              <span className={`text-[10px] font-black uppercase tracking-[0.18em] px-2 py-0.5 rounded border ${toneCls}`}>
                {tag}
              </span>
            </div>
          );
        })()}

        {/* Par terre countdown - top-perspective "rounds to score" version.
            Kept alongside the position chip above which gives the bottom-
            perspective "rounds until reset" framing. The two complement each
            other; either way the player sees the clock. */}
        {matchState.parTerreCountdown > 0 && (
          <div className="flex-shrink-0 bg-amber-900/30 border border-amber-700/50 rounded-lg px-3 py-1.5 text-center">
            <span className="text-amber-300 text-xs font-black uppercase tracking-wider">Par Terre: {matchState.parTerreCountdown} round{matchState.parTerreCountdown !== 1 ? 's' : ''} to score</span>
          </div>
        )}

        {/* Last action message */}
        <div className="flex-shrink-0 min-h-[28px] px-2 flex flex-col items-center justify-center">
          {lastMsg
            ? <p className={`text-xs font-semibold text-center ${msgColor}`}>{lastMsg}</p>
            : <p className="text-zinc-700 text-xs text-center italic">Waiting for first move...</p>
          }
          {/* Per-archetype skill tier readout. Each chip's gate is evaluated
              independently so a PERFECT/GOOD trace on p1 still renders even
              when p2 has no skill tier stamped (the previous combined OR-gate
              swallowed real traces whenever the opponent's tier was missing
              from the lastResult payload - a real risk in online mode where
              the server-authoritative state_update may omit fields the local
              engine would have stamped). Server schema MUST include
              `${side}Mechanic` + `${side}SkillTier` + `${side}SkillBonusApplied`
              on lastResult or the opponent's trace chip won't render. */}
          {(() => {
            const lr = matchState.lastResult;
            const p1NonPath = lr?.p1Mechanic !== 'path' && (lr?.p1SkillTier === 'PERFECT' || lr?.p1SkillTier === 'GOOD');
            const p2NonPath = lr?.p2Mechanic !== 'path' && (lr?.p2SkillTier === 'PERFECT' || lr?.p2SkillTier === 'GOOD');
            const p1Trace = shouldRenderTraceChip(lr, 'p1');
            const p2Trace = shouldRenderTraceChip(lr, 'p2');
            if (!p1NonPath && !p2NonPath && !p1Trace && !p2Trace) return null;
            return (
              <div className="flex gap-3 mt-0.5 text-[10px] uppercase tracking-wider">
                {p1NonPath && lr.p1SkillTier === 'PERFECT' && (
                  <span className={`${p1TextClass(colorblind)} font-bold`}>⚡ {matchState.p1.name} Perfect +4</span>
                )}
                {p1NonPath && lr.p1SkillTier === 'GOOD' && (
                  <span className="text-amber-400 font-bold">✓ {matchState.p1.name} Good +2</span>
                )}
                {p1Trace && (
                  <span className={lr.p1SkillTier === 'PERFECT' ? `${p1TextClass(colorblind)} font-bold` : 'text-amber-400 font-bold'}>
                    {lr.p1SkillTier === 'PERFECT' ? '⚡' : '✓'} {matchState.p1.name} {formatPathTraceLabel(lr.p1SkillTier, lr.p1SkillBonusApplied)}
                  </span>
                )}
                {p2NonPath && lr.p2SkillTier === 'PERFECT' && (
                  <span className={`${p2TextClass(colorblind)} font-bold`}>⚡ {matchState.p2.name} Perfect +4</span>
                )}
                {p2NonPath && lr.p2SkillTier === 'GOOD' && (
                  <span className="text-amber-400 font-bold">✓ {matchState.p2.name} Good +2</span>
                )}
                {p2Trace && (
                  <span className={lr.p2SkillTier === 'PERFECT' ? `${p2TextClass(colorblind)} font-bold` : 'text-amber-400 font-bold'}>
                    {lr.p2SkillTier === 'PERFECT' ? '⚡' : '✓'} {matchState.p2.name} {formatPathTraceLabel(lr.p2SkillTier, lr.p2SkillBonusApplied)}
                  </span>
                )}
              </div>
            );
          })()}
          {/* Transition-spam chip: bonus decay + folkstyle stalling call (warning / opponent +1). */}
          {transitionSpamLine(matchState.lastResult?.p1TransitionSpam, matchState.p1.name)}
          {transitionSpamLine(matchState.lastResult?.p2TransitionSpam, matchState.p2.name)}
        </div>

        {/* Card play area - fills remaining screen space */}
        {isPlaying && networkPlayer === 'spectator' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2">
            <div className="text-zinc-600 text-xs font-bold uppercase tracking-widest">Spectating</div>
            <div className="text-zinc-500 text-sm">Watching the match live...</div>
          </div>
        )}
        {isPlaying && networkPlayer !== 'spectator' && (
          <div className="flex-1 flex flex-col min-h-0 gap-2 overflow-y-auto">

            {/* Local 2P: Pass device screen */}
            {gameMode === 'local' && showPassDevice && (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-4 p-8">
                  <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest">Pass the device</div>
                  <div className="text-2xl font-black text-white">
                    {localTurn === 'p2' ? matchState.p2.name : matchState.p1.name}&apos;s Turn
                  </div>
                  <p className="text-zinc-500 text-sm">Tap below when ready. Don&apos;t peek!</p>
                  <button
                    onClick={() => setShowPassDevice(false)}
                    className={`px-8 py-3 rounded-xl font-black text-sm transition-all active:scale-95 ${
                      localTurn === 'p2'
                        ? (colorblind ? 'bg-amber-800 hover:bg-amber-700 text-amber-200 border border-amber-600' : 'bg-red-800 hover:bg-red-700 text-red-200 border border-red-600')
                        : (colorblind ? 'bg-sky-800 hover:bg-sky-700 text-sky-200 border border-sky-600' : 'bg-emerald-800 hover:bg-emerald-700 text-emerald-200 border border-emerald-600')
                    }`}
                  >
                    I&apos;m Ready - Show My Cards
                  </button>
                </div>
              </div>
            )}

            {/* Human's card hand - green (P1) or red (P2) depending on side */}
            {(() => {
              // Determine which player's hand to show as interactive
              const showP1Hand = (gameMode === 'local' && localTurn === 'p1' && !showPassDevice) || (gameMode === 'network' && networkPlayer === 'p1') || (isAIMode(gameMode) && humanPlayer === 'p1');
              const showP2Hand = (gameMode === 'local' && localTurn === 'p2' && !showPassDevice) || (gameMode === 'network' && networkPlayer === 'p2') || (isAIMode(gameMode) && humanPlayer === 'p2');

              return (
                <>
                  {/* Green Wrestler (P1). Renders ONLY when the local human is
                      controlling P1. Previously the panel also rendered for the
                      remote opponent in network mode (with an "Opponent's cards
                      hidden" placeholder), which duplicated info already shown
                      in the top ScoreBoard and visually doubled up the picker
                      area on the wrong side. Mirrors the P2 panel rule. */}
                  {showP1Hand && (
                    <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 flex-shrink-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colorblind ? 'bg-sky-500' : 'bg-emerald-500'}`} />
                          <span className={`${p1TextClass(colorblind)} font-bold text-sm`}>{matchState.p1.name}</span>
                          <span className="text-zinc-600 text-xs capitalize bg-zinc-800 px-1.5 py-0.5 rounded">
                            {matchState.p1.position}
                          </span>
                          {/* Conditions intentionally omitted here - the top ScoreBoard
                              already renders them. Duplicating pushed the picker down
                              whenever 3+ buffs accumulated on narrow viewports. */}
                        </div>
                        <span className="text-zinc-600 text-xs shrink-0 ml-2">
                          {p1Selected
                            ? <span className={`${p1TextClass(colorblind)} font-semibold`}>✓ {p1Selected.name}</span>
                            : resolving ? <span className="text-zinc-500">Resolving...</span> : 'Choose move'}
                        </span>
                      </div>
                      {/* Move timer - only for the human's hand */}
                      {showP1Hand && matchState.phase === 'playing' && !resolving && !p1Selected && !matchState.pinAttempt && (
                        <div className="mb-2">
                          <MoveTimer
                            seconds={moveTimer}
                            maxSeconds={MOVE_TIMER_DEFAULT}
                            paused={timerPaused}
                            onExpire={handleTimerExpiry}
                          />
                        </div>
                      )}
                      <div className="relative">
                        <HandPicker
                          cards={p1Hand}
                          selectedCard={p1Selected}
                          onSelectCard={(card) => {
                            if (gameMode === 'network') {
                              if (networkPlayer !== 'p1' || networkPickSent || resolving) return;
                              // Online: refuse to start a pick until the first
                              // state_update has landed (serverRoundReady). The
                              // historical bug was clicking before the protocol
                              // was hydrated, which sent card_pick with no
                              // roundSeq and got wrong_round on every match.
                              if (networkModeRef.current === 'online' && !serverRoundReady) return;
                              // Online relay: hold the network send until the
                              // skill challenge resolves (handleSkillResolved
                              // sends the pick + skill payload together).
                              // LAN mode: send immediately; LAN server is
                              // skill-agnostic.
                              if (networkModeRef.current === 'lan') {
                                sendNetworkPick(card.id);
                              }
                              setP1Selected(card);
                              setNetworkPickSent(true);
                              playSound('card_play');
                              launchSkillChallenge(card, 'p1');
                            } else if (gameMode === 'local') {
                              if (!p1Selected && !resolving) {
                                setP1Selected(card);
                                playSound('card_play');
                                launchSkillChallenge(card, 'p1');
                                // Pass-device prompt happens after the
                                // challenge resolves - defer it so the
                                // current player isn't kicked off the
                                // device mid-mechanic.
                                setLocalTurn('p2');
                              }
                            } else {
                              if (!p1Selected && !resolving) {
                                setP1Selected(card);
                                playSound('card_play');
                                launchSkillChallenge(card, 'p1');
                              }
                            }
                          }}
                          disabled={gameMode === 'network'
                            ? (networkPlayer !== 'p1' || networkPickSent || resolving
                                || (networkModeRef.current === 'online' && !serverRoundReady))
                            : (!!p1Selected || resolving)}
                          position={matchState.p1.position}
                          conditions={matchState.p1Conditions || []}
                          playerColor={colorblind ? 'blue' : 'green'}
                          backgroundImage="/brand/arena-bg.webp"
                          rerollsLeft={matchState.rerollsLeft?.p1 ?? 0}
                          onReroll={() => handleReroll('p1')}
                        />
                      </div>
                    </div>
                  )}

                  {/* Red Wrestler (P2) */}
                  {showP2Hand && (
                    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colorblind ? 'bg-amber-500' : 'bg-red-500'}`} />
                          <span className={`${p2TextClass(colorblind)} font-bold text-sm`}>{matchState.p2.name}</span>
                          <span className="text-zinc-600 text-xs capitalize bg-zinc-800 px-1.5 py-0.5 rounded">
                            {matchState.p2.position}
                          </span>
                          {/* Conditions shown in top ScoreBoard only - see P1 note above. */}
                        </div>
                        <span className="text-zinc-600 text-xs ml-2">
                          {gameMode === 'network'
                            ? (networkPickSent ? <span className={`${p2TextClass(colorblind)} font-semibold animate-pulse`}>✓ Waiting...</span> : 'Your move')
                            : (p2Selected ? <span className={`${p2TextClass(colorblind)} font-semibold`}>✓ {p2Selected.name}</span> : 'Choose move')
                          }
                        </span>
                      </div>
                      {/* Move timer - for human playing as red (AI mode) or network p2 */}
                      {humanPlayer === 'p2' && (isAIMode(gameMode) || gameMode === 'network') && matchState.phase === 'playing' && !resolving && !p2Selected && !matchState.pinAttempt && (
                        <div className="mb-2">
                          <MoveTimer
                            seconds={moveTimer}
                            maxSeconds={MOVE_TIMER_DEFAULT}
                            paused={timerPaused}
                            onExpire={handleTimerExpiry}
                          />
                        </div>
                      )}
                      <div className="relative">
                        <HandPicker
                          cards={p2Hand}
                          selectedCard={p2Selected}
                          onSelectCard={(card) => {
                            if (gameMode === 'network') {
                              if (networkPickSent || resolving) return;
                              // Online: gate on first state_update (see P1 picker comment).
                              if (networkModeRef.current === 'online' && !serverRoundReady) return;
                              if (networkModeRef.current === 'lan') {
                                sendNetworkPick(card.id);
                              }
                              setP2Selected(card);
                              setNetworkPickSent(true);
                              launchSkillChallenge(card, 'p2');
                            } else {
                              if (!p2Selected && !resolving) {
                                setP2Selected(card);
                                playSound('card_play');
                                launchSkillChallenge(card, 'p2');
                              }
                            }
                          }}
                          disabled={gameMode === 'network'
                            ? (networkPickSent || resolving
                                || (networkModeRef.current === 'online' && !serverRoundReady))
                            : (!!p2Selected || resolving || (gameMode === 'local' && localTurn !== 'p2'))}
                          position={matchState.p2.position}
                          conditions={matchState.p2Conditions || []}
                          playerColor={colorblind ? 'amber' : 'red'}
                          backgroundImage="/brand/arena-bg.webp"
                          rerollsLeft={matchState.rerollsLeft?.p2 ?? 0}
                          onReroll={() => handleReroll('p2')}
                        />
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

            {/* Transient mid-match notice (recoverable: e.g. cancelled-MISS).
                Auto-clears on next round advance OR after 5s. NOT a Return-to-
                Menu prompt - the match continues. */}
            {networkNotice && !networkError && (
              <div
                role="status"
                aria-live="polite"
                className="bg-amber-950/40 border border-amber-800 rounded-xl p-3 text-center"
              >
                <div className="text-amber-300 text-xs">{networkNotice}</div>
              </div>
            )}
            {/* Network error overlay - terminal connection failures only.
                Surfaces the "first move never lands" hang instead of leaving
                the user staring at the board forever. */}
            {networkError && (
              <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 text-center">
                <div className="text-red-400 font-black">Connection Issue</div>
                <div className="text-zinc-400 text-xs mt-1">{networkError}</div>
                <button onClick={() => { networkClientRef.current?.disconnect(); setScreen('menu'); }} className="mt-2 text-zinc-400 text-sm underline">Return to Menu</button>
              </div>
            )}

            {/* Opponent disconnected overlay */}
            {opponentDisconnected && (
              <div className="bg-red-950/60 border border-red-800 rounded-xl p-4 text-center">
                <div className="text-red-400 font-black">Opponent Disconnected</div>
                <div className="text-zinc-500 text-xs mt-1">
                  {networkModeRef.current === 'online'
                    ? 'Waiting for them to reconnect (45s)...'
                    : 'Connection lost'}
                </div>
                <button onClick={() => { networkClientRef.current?.disconnect(); setScreen('menu'); }} className="mt-2 text-zinc-400 text-sm underline">Return to Menu</button>
              </div>
            )}

            {/* Bottom row: Push Pace + Cut Loose + Reroll + AI/resolve status */}
            <div className="flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                {gameMode !== 'network' && !humanPick && !resolving && (
                  <button
                    onClick={handlePushPace}
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-yellow-700/50 text-yellow-500 px-3 py-1.5 rounded-lg transition-all font-bold"
                  >
                    Push Pace
                  </button>
                )}
                {gameMode !== 'network' && !humanPick && !resolving && matchState?.[humanPlayer]?.position === 'top' && (
                  <button
                    onClick={handleCutOpponent}
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-orange-700/50 text-orange-400 px-3 py-1.5 rounded-lg transition-all font-bold"
                  >
                    Cut Loose
                  </button>
                )}
                {(() => {
                  const rl = matchState?.rerollsLeft?.[humanPlayer] ?? 0;
                  // 4th-pass review: also gate by networkPickSent so that
                  // after a cancelled-synthetic re-locks the picker, the
                  // user can't reroll either (server would reject with
                  // already_picked, which the client silently swallows).
                  const canReroll = !humanPick && !resolving && rl > 0 && !networkPickSent;
                  return (
                    <button
                      onClick={() => { if (canReroll) handleReroll(humanPlayer); }}
                      disabled={!canReroll}
                      className={
                        canReroll
                          ? "text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-sky-700/50 text-sky-400 px-3 py-1.5 rounded-lg transition-all font-bold"
                          : "text-xs bg-zinc-900/60 border border-zinc-800 text-zinc-600 px-3 py-1.5 rounded-lg font-bold cursor-not-allowed"
                      }
                      title={rl > 0 ? `Reroll hand (${rl} left)` : 'No rerolls remaining'}
                    >
                      ↻ Reroll ×{rl}
                    </button>
                  );
                })()}
              </div>

              {isAIMode(gameMode) && (
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-red-400 font-bold text-xs">{matchState.p2.name}</span>
                  <span className="text-zinc-600 text-xs">
                    {resolving ? '⚔ wrestling...' : p2Selected ? '✓ ready' : p1Selected ? 'thinking...' : 'waiting'}
                  </span>
                </div>
              )}

              {gameMode === 'network' && networkPickSent && awaitingChallengeStart && !pendingChallenge && (
                <div className="text-zinc-500 text-xs animate-pulse">Preparing skill challenge...</div>
              )}
              {gameMode === 'network' && networkPickSent && !awaitingChallengeStart && !pendingChallenge && (
                <div className="text-zinc-500 text-xs animate-pulse">Waiting for opponent...</div>
              )}

              {p1Selected && p2Selected && !resolving && gameMode !== 'network' && (
                <div className="text-yellow-400 text-xs font-black animate-pulse">⚡ Go!</div>
              )}
            </div>

          </div>
        )}

        {/* Fallback: phase is in an unexpected state - give the player a recovery button */}
        {!isPlaying && !showPeriodModal && !showResultModal && !showPinModal && !showNetworkPeriodWait && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-yellow-400 text-sm font-semibold">Match paused - recovering...</p>
            <button
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-lg text-sm transition-colors"
              onClick={() => {
                setMatchState(prev => ({ ...prev, phase: 'playing' }));
                setP1Selected(null);
                setP2Selected(null);
                setP1SkillResult(null);
                setP2SkillResult(null);
                setPendingChallenge(null);
                setResolving(false);
                setP1Hand(handFor('p1',matchState.p1.position, matchState.p1Conditions, matchState.wrestlingStyle));
                setP2Hand(handFor('p2',matchState.p2.position, matchState.p2Conditions, matchState.wrestlingStyle));
              }}
            >
              Resume Match
            </button>
          </div>
        )}

        {/* Per-archetype skill challenge overlay - fires after a player picks
            a card and resolves with a tier (PERFECT / GOOD / MISS) that flows
            into resolveRound's bonus + RNG narrowing path. */}
        {pendingChallenge && (() => {
          const isOnline = gameMode === 'network' && networkModeRef.current === 'online';
          return (
            <CardSkillChallenge
              card={pendingChallenge.card}
              onResolve={handleSkillResolved}
              isOnline={isOnline}
              serverParams={
                isOnline
                  ? activeChallengeRef.current?.params
                    || preGeneratedChallengesRef.current?.[pendingChallenge.card.id]?.params
                    || null
                  : null
              }
              serverReactionPhase={
                isOnline && activeChallengeRef.current?.kind === 'reaction'
                  ? serverReactionPhase
                  : null
              }
              onInput={
                isOnline
                  ? (eventType, payload) => {
                      try {
                        networkClientRef.current?.sendChallengeInput(
                          eventType,
                          payload,
                          activeChallengeRef.current?.id || null,
                        );
                      } catch { /* best-effort */ }
                    }
                  : null
              }
            />
          );
        })()}

      </div>
    </motion.div>
  );
}
