// Source-level contract tests for the skill mechanic React components.
// The project doesn't have a React renderer in its test stack
// (node:test, no jsdom/vitest), so we verify the network-mode contract
// by scanning each component file for the expected:
//
//   1. `onInput = null` parameter in the default export signature
//   2. `tuningOverride = null` parameter (used by online to pass server params)
//   3. The expected `onInput(<eventType>)` call sites per mechanic
//
// These tests are regression protection: they catch a developer
// silently dropping the prop or removing an emission. The behavioral
// contract is exercised end-to-end by server-online/match-flow.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readFile(name) {
  return readFileSync(join(__dirname, name), 'utf8');
}

// ── ChargeMechanic ──────────────────────────────────────────────────────

test('ChargeMechanic: signature accepts onInput and tuningOverride props', () => {
  const src = readFile('ChargeMechanic.jsx');
  assert.match(src, /export default function ChargeMechanic\([^)]*onInput\s*=\s*null/);
  assert.match(src, /tuningOverride\s*=\s*null/);
});

test('ChargeMechanic: emits onInput("press") on pointer down', () => {
  const src = readFile('ChargeMechanic.jsx');
  assert.match(src, /onInput\(['"]press['"]\)/, 'press event must be emitted');
});

test('ChargeMechanic: emits onInput("release") on pointer up', () => {
  const src = readFile('ChargeMechanic.jsx');
  assert.match(src, /onInput\(['"]release['"]\)/, 'release event must be emitted');
});

// ── ReactionMechanic ────────────────────────────────────────────────────

test('ReactionMechanic: signature accepts onInput and tuningOverride props', () => {
  const src = readFile('ReactionMechanic.jsx');
  assert.match(src, /export default function ReactionMechanic\([^)]*onInput\s*=\s*null/);
  assert.match(src, /tuningOverride\s*=\s*null/);
});

test('ReactionMechanic: emits onInput("tap", { isFake }) so server can determine fake-vs-real', () => {
  const src = readFile('ReactionMechanic.jsx');
  assert.match(src, /onInput\(['"]tap['"],\s*\{[^}]*isFake/,
    'reaction tap must include isFake hint for client visual state');
});

// ── TraceMechanic ───────────────────────────────────────────────────────

test('TraceMechanic: signature accepts onInput and tuningOverride props', () => {
  const src = readFile('TraceMechanic.jsx');
  assert.match(src, /export default function TraceMechanic\([^)]*onInput\s*=\s*null/);
  assert.match(src, /tuningOverride\s*=\s*null/);
});

test('TraceMechanic: emits onInput("swipe", { direction }) per swipe', () => {
  const src = readFile('TraceMechanic.jsx');
  assert.match(src, /onInput\(['"]swipe['"],\s*\{[^}]*direction/,
    'trace swipe must include direction in payload');
});

// ── BurstMechanic ───────────────────────────────────────────────────────

test('BurstMechanic: signature accepts onInput and tuningOverride props', () => {
  const src = readFile('BurstMechanic.jsx');
  assert.match(src, /export default function BurstMechanic\([^)]*onInput\s*=\s*null/);
  assert.match(src, /tuningOverride\s*=\s*null/);
});

test('BurstMechanic: emits onInput("tap") per tap', () => {
  const src = readFile('BurstMechanic.jsx');
  assert.match(src, /onInput\(['"]tap['"]\)/, 'burst tap must be emitted');
});

// ── PathMechanic ────────────────────────────────────────────────────────

test('PathMechanic: signature accepts onInput and tuningOverride props', () => {
  const src = readFile('PathMechanic.jsx');
  assert.match(src, /export default function PathMechanic\([^)]*onInput\s*=\s*null/);
  assert.match(src, /tuningOverride\s*=\s*null/);
});

test('PathMechanic: emits onInput("sample", ...) so server can grade against the same polyline', () => {
  const src = readFile('PathMechanic.jsx');
  assert.match(src, /onInput\w*\(\s*['"]sample['"]/, 'sample event must be emitted');
});

test('PathMechanic: emits onInput("stroke_end", ...) so server-side computeChallengeTier can finalize', () => {
  const src = readFile('PathMechanic.jsx');
  assert.match(src, /onInput\w*\(\s*['"]stroke_end['"]/, 'stroke_end event must be emitted');
});

test('PathMechanic: converts pointer coords through getBoundingClientRect into SVG-local space', () => {
  // scoreTrace grades against a 0..sizePx reference polyline; passing raw
  // clientX/Y through would always fail the 60px endpoint gate.
  const src = readFile('PathMechanic.jsx');
  assert.match(src, /getBoundingClientRect\(\)/,
    'PathMechanic must call getBoundingClientRect to convert pointer coords');
});

// ── CardSkillChallenge dispatcher ──────────────────────────────────────

test('CardSkillChallenge: forwards onInput and serverParams to all 5 mechanics', () => {
  const src = readFile('../CardSkillChallenge.jsx');
  // Each mechanic invocation must receive both props
  for (const name of ['ChargeMechanic', 'ReactionMechanic', 'TraceMechanic', 'BurstMechanic', 'PathMechanic']) {
    const re = new RegExp(`<${name}[^>]*tuningOverride={serverParams}[^>]*onInput={onInput}|<${name}[^>]*onInput={onInput}[^>]*tuningOverride={serverParams}`);
    assert.match(src, re, `${name} must receive both serverParams and onInput`);
  }
});

test('CardSkillChallenge: documents the network-mode contract', () => {
  const src = readFile('../CardSkillChallenge.jsx');
  assert.match(src, /serverParams/, 'documents server-supplied params');
  assert.match(src, /onInput/, 'documents input streaming');
});

test('CardSkillChallenge: derives reactionServerDriven from isOnline (not phase value)', () => {
  // 2nd-pass review fix: gating serverDriven on phase being non-null
  // produced a brittle dual-source-of-truth. Now serverDriven follows
  // the explicit isOnline prop and serverPhase can be null on first render.
  const src = readFile('../CardSkillChallenge.jsx');
  assert.match(src, /reactionServerDriven\s*=\s*mechanic\s*===\s*MECHANIC_TYPES\.REACTION\s*&&\s*isOnline/,
    'reactionServerDriven must depend on isOnline, not on serverPhase truthiness');
});

// ── Codex review fix #1: online card_pick ordering ──────────────────────
// In online mode, handleSelect must send card_pick to the server BEFORE
// any code that mounts the mini-game (setPendingChallenge). If reversed,
// challenge_input events stream to a server with no challenge instance
// and get silently dropped (-> all-MISS tiers).

test('Codex #1: launchSkillChallenge online path sends card_pick BEFORE setPendingChallenge', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  // Locate the launchSkillChallenge function body.
  const fnStart = src.indexOf('const launchSkillChallenge = (card, side) => {');
  assert.ok(fnStart > 0, 'launchSkillChallenge must exist');
  // Take a generous slice (the function body fits comfortably in 1500 chars).
  const fnBody = src.slice(fnStart, fnStart + 2000);

  // The online branch must send the card_pick first and explicitly RETURN
  // before reaching any setPendingChallenge call. The setPendingChallenge
  // line we care about is the OFFLINE / vs-AI / LAN path at the bottom.
  const onlineBranchIdx = fnBody.indexOf('isOnline && networkClientRef.current');
  assert.ok(onlineBranchIdx > 0, 'online branch must exist');
  const onlineBlock = fnBody.slice(onlineBranchIdx);

  const sendNetworkIdx = onlineBlock.indexOf('sendNetworkPick(card.id)');
  const setPendingIdx  = onlineBlock.indexOf('setPendingChallenge');
  const earlyReturnIdx = onlineBlock.indexOf('return;');
  assert.ok(sendNetworkIdx > 0, 'online branch must call sendNetworkPick(card.id)');
  assert.ok(earlyReturnIdx > 0, 'online branch must early-return');
  // setPendingChallenge for the online path must NOT be inside the online
  // branch (i.e., before the early return). It only fires for offline/LAN.
  if (setPendingIdx > 0) {
    assert.ok(
      setPendingIdx > earlyReturnIdx,
      'setPendingChallenge must NOT be reached in the online branch (challenge_start mounts the mini-game instead)',
    );
  }
});

test('Codex #1: challenge_start handler mounts the mini-game using lastPickedCardRef', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  // Find the challenge_start handler.
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_start')");
  assert.ok(handlerIdx > 0, 'challenge_start handler must exist');
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 3000);
  // Must reference lastPickedCardRef AND setPendingChallenge.
  assert.match(handlerBlock, /lastPickedCardRef/,
    'challenge_start must read the picked card from lastPickedCardRef');
  assert.match(handlerBlock, /setPendingChallenge\(/,
    'challenge_start must mount the mini-game via setPendingChallenge');
});

test('Codex P1: challenge_start handler falls back to hand-lookup by msg.cardId when ref is null', () => {
  // The reconnect/remount path replays challenge_start from the server
  // but lastPickedCardRef is gone (component remounted). Server now
  // ships cardId with the message; client must look it up in the hand.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_start')");
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 3000);
  // Must consult msg.cardId AND look up against the local hand.
  assert.match(handlerBlock, /msg\.cardId/,
    'challenge_start must consult msg.cardId for the reconnect path');
  assert.match(handlerBlock, /\.find\(c\s*=>\s*c\.id\s*===\s*msg\.cardId\)/,
    'challenge_start must fall back to hand.find(c => c.id === msg.cardId) when lastPickedCardRef is null');
});

test('Codex P1 (latest): challenge_start fallback reads from hand REF (not state) to avoid stale-closure', () => {
  // The reviewer caught that reading p1Hand/p2Hand from state can be
  // stale within a single message-handler chain (state setters are
  // async). Refs are updated synchronously inside the state_update
  // handler so the fallback always sees the current hand.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_start')");
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 1800);
  // The lookup target must be a ref (p1HandRef.current / p2HandRef.current),
  // not the React state variables p1Hand / p2Hand.
  assert.match(handlerBlock, /p1HandRef\.current/);
  assert.match(handlerBlock, /p2HandRef\.current/);
});

test('Codex P1 (cancelled-reconnect): challenge_resolved with cancelled flag re-locks the picker', () => {
  // When the prior disconnect cancelled the active challenge to MISS,
  // the server sends synthetic challenge_resolved with cancelled=true.
  // The state_update preceding it cleared networkPickSent/pickAcknowledged
  // to false, which would unlock the picker on the client even though
  // the server still has pendingPicks[role] locked. The handler must
  // re-lock when cancelled is true.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_resolved')");
  assert.ok(handlerIdx > 0);
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 1500);
  // Must check msg.cancelled AND re-set both networkPickSent and
  // pickAcknowledged to lock the picker.
  assert.match(handlerBlock, /msg\.cancelled/,
    'challenge_resolved handler must check the cancelled flag');
  assert.match(handlerBlock, /setNetworkPickSent\(true\)/,
    'cancelled path must re-lock networkPickSent');
  assert.match(handlerBlock, /setPickAcknowledged\(true\)/,
    'cancelled path must re-set pickAcknowledged');
});

test('Item 4: cancelled reconnect only re-locks when synthetic says the pick is still locked', () => {
  // If the opponent resolved the round while this player was offline,
  // the synthetic challenge_resolved is only context. It must not lock
  // the newly dealt hand for the advanced round.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_resolved')");
  assert.ok(handlerIdx > 0);
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 2200);
  const cancelledIdx = handlerBlock.indexOf('if (msg.cancelled)');
  assert.ok(cancelledIdx > 0, 'must have cancelled branch');
  const cancelledBlock = handlerBlock.slice(cancelledIdx, cancelledIdx + 1000);
  assert.match(cancelledBlock, /msg\.roundSeq\s*===\s*currentRoundSeqRef\.current/,
    'cancelled branch must compare synthetic roundSeq to current round');
  assert.match(cancelledBlock, /msg\.pickLocked\s*!==\s*false/,
    'cancelled branch must honor server pickLocked=false');
  assert.match(cancelledBlock, /if\s*\(shouldLockPicker\)[\s\S]*setNetworkPickSent\(true\)[\s\S]*setPickAcknowledged\(true\)/,
    'picker lock setters must be gated behind shouldLockPicker');
});

test('Item 5: challenge_start with stale roundSeq is dropped before resolving card', () => {
  // A late challenge_start from the prior round can arrive after a
  // state_update has advanced roundSeq and cleared lastPickedCardRef.
  // The handler must drop it before attempting hand lookup/mount.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_start')");
  assert.ok(handlerIdx > 0, 'challenge_start handler must exist');
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 2000);
  const staleGuardIdx = handlerBlock.indexOf('msg.roundSeq !== currentRoundSeqRef.current');
  const lastPickedIdx = handlerBlock.indexOf('lastPickedCardRef.current');
  const setPendingIdx = handlerBlock.indexOf('setPendingChallenge(');
  assert.ok(staleGuardIdx > 0, 'challenge_start must guard by roundSeq');
  assert.ok(lastPickedIdx > staleGuardIdx,
    'stale round guard must run before reading lastPickedCardRef');
  assert.ok(setPendingIdx > staleGuardIdx,
    'stale round guard must run before mounting the mini-game');
  assert.match(handlerBlock.slice(staleGuardIdx, staleGuardIdx + 600), /return;/,
    'stale challenge_start branch must return early');
});

test('Codex P2 (transient notice): cancelled-MISS uses setNetworkNotice (not setNetworkError)', () => {
  // networkError renders a persistent red "Connection Issue" panel with
  // a Return-to-Menu button - wrong UX for a recoverable round-cancel.
  // The cancelled path must use the transient setNetworkNotice channel,
  // which renders an amber banner that auto-clears on the next round
  // advance OR after 5s.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_resolved')");
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 2400);
  // Find the `if (msg.cancelled) { ... }` block specifically
  const cancelledIdx = handlerBlock.indexOf('if (msg.cancelled)');
  assert.ok(cancelledIdx > 0, 'must have an if (msg.cancelled) block');
  // Generous slice (1600 chars) so it covers expanded comments before the
  // setNetworkNotice call without slicing into the next handler.
  const cancelledBlock = handlerBlock.slice(cancelledIdx, cancelledIdx + 1600);
  // Inside the cancelled branch: NO setNetworkError, MUST have setNetworkNotice
  assert.ok(!cancelledBlock.includes('setNetworkError('),
    'cancelled branch must NOT call setNetworkError (that renders Return-to-Menu)');
  assert.match(cancelledBlock, /setNetworkNotice\(/,
    'cancelled branch must use setNetworkNotice for the transient banner');
});

test('Codex P2 (transient notice): notice auto-clears on next state_update with advanced roundSeq', () => {
  // Without auto-clear, the notice could linger into a future round
  // and confuse the user. The state_update handler must clear it when
  // roundSeq advances.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'state_update')");
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 3000);
  // The roundSeq advance branch must clear networkNotice
  const advanceIdx = handlerBlock.indexOf('msg.roundSeq > currentRoundSeqRef.current');
  assert.ok(advanceIdx > 0, 'state_update handler must check for roundSeq advance');
  const advanceBlock = handlerBlock.slice(advanceIdx, advanceIdx + 400);
  assert.match(advanceBlock, /setNetworkNotice\(null\)/,
    'roundSeq advance must clear the transient notice');
});

test('5th-pass review: networkNotice is cleared on match_voided / room_expired', () => {
  // Stale notice must not stack visually with the void overlay.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("msg.type === 'match_voided' || msg.type === 'room_expired'");
  assert.ok(handlerIdx > 0);
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 600);
  assert.match(handlerBlock, /setNetworkNotice\(null\)/,
    'match_voided / room_expired handler must clear networkNotice');
});

test('5th-pass review: networkNotice is cleared on rematch game_start (no bleed across matches)', () => {
  // Rematch keeps the same component instance (no unmount), so a stale
  // notice from the prior match would otherwise persist into round 0.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("msg.type === 'game_start'");
  assert.ok(handlerIdx > 0);
  // Take a generous slice covering the online game_start branch
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 1500);
  assert.match(handlerBlock, /setNetworkNotice\(null\)/,
    'game_start handler must clear networkNotice for rematches');
});

test('5th-pass review: networkNotice banner has aria-live for screen readers', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  // Find the amber-banner render block
  const bannerIdx = src.indexOf('networkNotice && !networkError');
  assert.ok(bannerIdx > 0, 'transient notice render block must exist');
  const bannerBlock = src.slice(bannerIdx, bannerIdx + 600);
  assert.match(bannerBlock, /role="status"/,
    'amber notice banner must have role="status"');
  assert.match(bannerBlock, /aria-live="polite"/,
    'amber notice banner must have aria-live="polite"');
});

test('Fix 2: cancelled-MISS notice text differs by round-state', () => {
  // Same-round-still-locked: "this round will be MISS for you"
  // Round-already-advanced: "A prior round was MISS due to a disconnect."
  // The two messages are needed because the same notice carries different
  // semantic meaning depending on whether the round is still in flight.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_resolved')");
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 2400);
  assert.match(handlerBlock, /this round will be MISS for you/,
    'must keep the locked-round message');
  assert.match(handlerBlock, /A prior round was MISS due to a disconnect/,
    'must add the round-already-advanced message');
  // The selection must be driven by shouldLockPicker
  assert.match(handlerBlock, /shouldLockPicker\s*\?/,
    'message selection must be driven by shouldLockPicker');
});

// ── Codex review fix #3: reaction prompt -> phase mapping ───────────────

test('Codex #3: challenge_prompt handler maps reaction prompts directly to setServerReactionPhase', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'challenge_prompt')");
  assert.ok(handlerIdx > 0);
  const block = src.slice(handlerIdx, handlerIdx + 1000);
  assert.match(block, /reaction_fake_show.*setServerReactionPhase\(['"]fake['"]\)/s);
  assert.match(block, /reaction_fake_hide.*setServerReactionPhase\(['"]waiting['"]\)/s);
  assert.match(block, /reaction_go.*setServerReactionPhase\(['"]go['"]\)/s);
});

// ── Codex review fix #3: trace respects tuningOverride.sequence ────────

test('Codex #3: TraceMechanic uses tuningOverride.sequence when provided', () => {
  const src = readFile('TraceMechanic.jsx');
  // The useMemo for sequence must check tuningOverride?.sequence first.
  assert.match(src, /tuningOverride\?\.sequence/,
    'TraceMechanic must consult tuningOverride.sequence');
});

// ── Codex review fix #3: ReactionMechanic accepts serverDriven prop ────

test('Codex #3: ReactionMechanic signature accepts serverDriven and serverPhase', () => {
  const src = readFile('ReactionMechanic.jsx');
  assert.match(src, /serverDriven\s*=\s*false/,
    'ReactionMechanic must accept serverDriven prop');
  assert.match(src, /serverPhase\s*=\s*null/,
    'ReactionMechanic must accept serverPhase prop');
});

test('Codex #3: ReactionMechanic skips local timers in serverDriven mode', () => {
  const src = readFile('ReactionMechanic.jsx');
  // The schedule effect must early-return when serverDriven is true.
  assert.match(src, /if\s*\(serverDriven\)\s*return;.*server controls the schedule/s,
    'ReactionMechanic must not run local timers when serverDriven');
});

// ── First-move bug Fix 2: online startNetworkGame must NOT generate state ──
// The live first-deploy of the authoritative server failed because the
// online branch of startNetworkGame still called createInitialMatchState
// and handFor locally (relay-mode relic). With the server authoritative,
// the local hand can mismatch the server's hand -> illegal_card. State and
// hands must hydrate from the first state_update only.
test('First-move fix: startNetworkGame online branch must not call createInitialMatchState', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  // Locate startNetworkGame
  const fnStart = src.indexOf('const startNetworkGame = ({');
  assert.ok(fnStart > 0, 'startNetworkGame must exist');
  // Find the `if (mode === 'online')` branch and slice through to the
  // matching `} else {` that opens the LAN branch (or the `}` before
  // setScreen). Generous 3000-char slice covers the online block.
  const fnBody = src.slice(fnStart, fnStart + 5000);
  const onlineIdx = fnBody.indexOf("if (mode === 'online')");
  assert.ok(onlineIdx > 0, "online branch must exist in startNetworkGame");
  const elseIdx = fnBody.indexOf('} else {', onlineIdx);
  assert.ok(elseIdx > onlineIdx, 'online branch must close before LAN else');
  const onlineBlock = fnBody.slice(onlineIdx, elseIdx);

  // The online branch must NOT generate state or hands locally - the
  // server is authoritative; state_update is the only source of truth.
  assert.ok(
    !onlineBlock.includes('createInitialMatchState'),
    'online branch must not call createInitialMatchState (server-authoritative; hydrate from state_update)',
  );
  assert.ok(
    !onlineBlock.includes('handFor('),
    'online branch must not call handFor() (server deals hands; hydrate from state_update)',
  );
});

test('Pin-error recovery: error handler resets pinOffenseChoice/Defense on pin_card_burned + related codes', () => {
  // The server can reject a pin_pick (e.g., pin_card_burned for a
  // defense reuse) AFTER the client has already set pinOffenseChoice or
  // pinDefenseChoice locally. Without recovery the modal stays at
  // "Ready" forever - the round freezes.
  // Fix: when the error handler sees a pin-related code AND we're in
  // pin_attempt phase, reset the local pin choice for whichever side
  // the user is.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const errIdx = src.indexOf("if (msg.type === 'error')");
  assert.ok(errIdx > 0, 'error handler must exist');
  const errBlock = src.slice(errIdx, errIdx + 2000);

  // Must mention pin_card_burned (the live failure mode) or include it
  // in a code allowlist.
  assert.match(errBlock, /pin_card_burned/,
    'error handler must explicitly handle pin_card_burned');
  // Must reset pin choices when we are in pin_attempt phase.
  assert.match(errBlock, /setPinOffenseChoice\(null\)/,
    'error handler must clear pinOffenseChoice for the attacker');
  assert.match(errBlock, /setPinDefenseChoice\(null\)/,
    'error handler must clear pinDefenseChoice for the defender');
  assert.match(errBlock, /phase === 'pin_attempt'/,
    'pin choice reset must be guarded on pin_attempt phase');
});

test('Pin-stage-advance fix: state_update clears pin choices when stage advances within pin_attempt', () => {
  // The live first-pin-attempt freeze: after stage 1 resolved on the
  // server, broadcast state_update with stage=2. The client only cleared
  // pinOffenseChoice / pinDefenseChoice when transitioning OUT of
  // pin_attempt entirely. Staying in pin_attempt with stage advance left
  // the local pinOffenseChoice/Defense at the stage-1 cardId, so the
  // PinAttemptModal saw `pendingOffense=truthy` and rendered "Ready"
  // without re-showing the picker - user couldn't pick stage-2 cards
  // and the round froze.
  //
  // Fix: when in pin_attempt but the stage changed since the prior
  // state_update, also clear the pin choices.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const handlerIdx = src.indexOf("if (msg.type === 'state_update')");
  assert.ok(handlerIdx > 0, 'state_update handler must exist');
  const handlerBlock = src.slice(handlerIdx, handlerIdx + 5000);

  // Must capture the prior pinAttempt.stage BEFORE matchStateRef is
  // overwritten with newState.
  assert.match(
    handlerBlock,
    /pinAttempt\?\.stage|pinAttempt && .*stage/,
    'state_update handler must read pinAttempt.stage to detect stage advance',
  );

  // Must clear pinOffenseChoice and pinDefenseChoice when stage changes
  // within pin_attempt. Count individual setPinOffenseChoice(null) calls -
  // one for the phase-leave path, another for the stage-advance path.
  const clearOffense = (handlerBlock.match(/setPinOffenseChoice\(null\)/g) || []).length;
  const clearDefense = (handlerBlock.match(/setPinDefenseChoice\(null\)/g) || []).length;
  assert.ok(clearOffense >= 2,
    `setPinOffenseChoice(null) must appear in TWO branches (phase change AND stage advance); found ${clearOffense}`);
  assert.ok(clearDefense >= 2,
    `setPinDefenseChoice(null) must appear in TWO branches (phase change AND stage advance); found ${clearDefense}`);

  // Verify the stage-advance condition uses the "different stage" comparison.
  assert.match(
    handlerBlock,
    /newPinStage\s*!==\s*prevPinStage|prevPinStage\s*!==\s*newPinStage/,
    'state_update handler must compare new stage to prior stage',
  );
});

test('First-move fix: startNetworkGame drains bufferedMessages AFTER online reset', () => {
  // Codex [P1] ordering correction: if the buffer is drained immediately
  // after patching onMessage, the first state_update would hydrate state
  // and then the online-mode reset (setMatchState(null), setP1Hand([]), ...)
  // would wipe it back to empty. Order must be:
  //   (1) patch client.onMessage = handleNetworkMessage
  //   (2) run online reset (clear matchState/hands to null/[])
  //   (3) drain bufferedMessages through handleNetworkMessage
  // This test locks the ordering at the source level so a future
  // refactor cannot silently re-introduce the bug.
  const src = readFileSync(
    fileURLToPath(new URL('../../../pages/WrestlingGame.jsx', import.meta.url)),
    'utf8',
  );
  const fnStart = src.indexOf('const startNetworkGame = ({');
  assert.ok(fnStart > 0, 'startNetworkGame must exist');
  const fnBody = src.slice(fnStart, fnStart + 5000);

  const onlineResetIdx = fnBody.search(/setMatchState\(null\)|matchStateRef\.current\s*=\s*null/);
  assert.ok(onlineResetIdx > 0,
    'online branch must reset matchState to null (server-authoritative hydration)');

  // The drain must appear in the body AND be POSITIONED AFTER the reset.
  // Accept either a for-of or forEach over bufferedMessages, with a call
  // back into handleNetworkMessage so the messages flow through the same
  // path live messages take.
  const drainPattern =
    /for\s*\(\s*const\s+\w+\s+of\s+bufferedMessages\s*\)|bufferedMessages\.forEach/;
  const drainIdx = fnBody.search(drainPattern);
  assert.ok(drainIdx > 0,
    'startNetworkGame must drain bufferedMessages (for-of or forEach)');
  assert.ok(drainIdx > onlineResetIdx,
    'bufferedMessages drain must come AFTER setMatchState(null) reset (Codex P1 ordering)');

  // And the drain must call handleNetworkMessage so messages flow through
  // the production handler (currentRoundSeqRef gets updated, hands hydrate, etc).
  const drainSlice = fnBody.slice(drainIdx, drainIdx + 400);
  assert.match(drainSlice, /handleNetworkMessage\(/,
    'drain loop must invoke handleNetworkMessage so state hydrates correctly');
});
