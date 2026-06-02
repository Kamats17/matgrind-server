// Source-level invariants for TournamentSetupScreen. The repo has no
// JSDOM/Vitest setup, so we read the JSX text and assert on its shape -
// same approach as MainMenu.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, 'TournamentSetupScreen.jsx'), 'utf8');

test('exposes all six bracket sizes the engine accepts', () => {
  // BRACKET_SIZES must include 8 / 16 / 24 / 32 / 64 / 128 - these are the
  // values createTournament's bracketSize union type accepts. Dropping one
  // silently regresses to a smaller set of tournaments.
  assert.match(SRC, /BRACKET_SIZES\s*=\s*\/\*\*\s*@type\s*\{const\}\s*\*\/\s*\(\s*\[\s*8\s*,\s*16\s*,\s*24\s*,\s*32\s*,\s*64\s*,\s*128\s*\]/,
    'BRACKET_SIZES must be exactly [8, 16, 24, 32, 64, 128]');
});

test('tournament format is fixed to double elimination - no format selector', () => {
  // The Format selector was removed: every standalone tournament is
  // double-elimination. No FORMATS list, no format state. Real wrestling
  // tournaments never let a loser reach the final, so a single fixed
  // double-elim format is correct - best case after a loss is true second.
  assert.equal(/FORMATS/.test(SRC), false, 'the FORMATS list must be gone');
  assert.equal(/setFormat/.test(SRC), false, 'the format state must be gone');
  // handleContinue passes the fixed engine id - 'consolation' is the
  // engine's double-elimination path - as the format argument to onConfirm.
  assert.match(
    SRC,
    /onConfirm\(bracketSize,\s*'consolation',\s*guestArg,\s*style\)/,
    "onConfirm must pass the fixed 'consolation' (double-elim) format",
  );
});

test('signed-in users pass null for guestName, never an empty string', () => {
  // The whole point of the guest-input gating: a signed-in user must not
  // accidentally trip the `guestName || 'Guest'` branch in startTournament.
  // The implementation chooses null vs trimmedGuest based on needsGuestName.
  assert.match(
    SRC,
    /needsGuestName\s*\?\s*trimmedGuest\s*:\s*null/,
    'Continue handler must send null (not empty string) when no guest input is required',
  );
});

test('Continue stays disabled until a non-empty guest name exists', () => {
  // canContinue = !needsGuestName || trimmedGuest.length > 0
  assert.match(
    SRC,
    /canContinue\s*=\s*!needsGuestName\s*\|\|\s*trimmedGuest\.length\s*>\s*0/,
    'canContinue must require a non-empty trimmed guest name when guest input is required',
  );
  // And the handler must early-return when not allowed, so a synthetic
  // click event can't sneak past the disabled prop.
  assert.match(
    SRC,
    /if\s*\(\s*!canContinue\s*\)\s*return;/,
    'handleContinue must guard against being called while disabled',
  );
});

test('guest input only renders when needsGuestName is true', () => {
  // Belt-and-suspenders: the input is gated by `needsGuestName &&` so a
  // signed-in user can never type a "guest" name that later leaks into
  // onConfirm via a stale state value.
  assert.match(
    SRC,
    /\{needsGuestName\s*&&\s*\(/,
    'guest input must be conditionally rendered via {needsGuestName && ...}',
  );
});

test('treats missing isAuthenticated OR missing wrestlerProfile as guest', () => {
  // The needsGuestName flag must check BOTH so a half-loaded state (auth
  // says signed in but profile not yet fetched) prompts for a name
  // instead of silently entering as 'Guest'.
  assert.match(
    SRC,
    /needsGuestName\s*=\s*!isAuthenticated\s*\|\|\s*!wrestlerProfile/,
    'needsGuestName must be (!isAuthenticated || !wrestlerProfile)',
  );
});

test('exposes a wrestling style selector wired to the centralized name module', () => {
  // The player must be able to pick a style so the tournament's opponent
  // names match the format (Women's Freestyle -> women's names). The style
  // list comes from the single centralized source, namePools.js.
  assert.match(
    SRC,
    /import\s*\{[^}]*WRESTLING_STYLES[^}]*\}\s*from\s*['"]\.\.\/\.\.\/lib\/namePools\.js['"]/,
    'must import WRESTLING_STYLES from the centralized namePools module',
  );
  assert.match(SRC, /WRESTLING_STYLES\.map/, 'must render the style options');
  // onConfirm must forward the chosen style as the 4th argument so
  // WrestlingGame can pass it into createTournament.
  assert.match(
    SRC,
    /onConfirm\(bracketSize,\s*'consolation',\s*guestArg,\s*style\)/,
    'onConfirm must pass the selected style through as the 4th arg',
  );
});
