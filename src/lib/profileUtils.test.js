import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDailyGoals,
  updateGoalProgress,
  loadGoals,
  ALWAYS_ONLINE_DAILY_GOAL,
  checkAchievements,
} from './profileUtils.js';

describe('getDailyGoals', () => {
  test('returns 4 goals (3 random + always-on online)', () => {
    const goals = getDailyGoals();
    assert.equal(goals.length, 4);
  });

  test('always includes the online goal as the last entry', () => {
    const goals = getDailyGoals();
    const last = goals[goals.length - 1];
    assert.equal(last.id, ALWAYS_ONLINE_DAILY_GOAL.id);
    assert.equal(last.label, 'Play 3 online matches');
    assert.equal(last.target, 3);
    assert.equal(last.xpReward, 500);
    assert.equal(last.category, 'online_played');
    assert.equal(last.current, 0);
    assert.equal(last.completed, false);
    assert.equal(last.type, 'daily');
  });
});

describe('updateGoalProgress online_played', () => {
  const onlineGoal = () => ({
    ...ALWAYS_ONLINE_DAILY_GOAL, current: 0, completed: false, type: 'daily',
  });

  test('increments only when the match was online', () => {
    const before = [onlineGoal()];
    const after = updateGoalProgress(before, { result: 'win', isOnline: true });
    assert.equal(after[0].current, 1);
    assert.equal(after[0].completed, false);
  });

  test('does not increment for offline matches', () => {
    const before = [onlineGoal()];
    const after = updateGoalProgress(before, { result: 'win', isOnline: false });
    assert.equal(after[0].current, 0);
  });

  test('marks completed at 3 online matches', () => {
    let goals = [onlineGoal()];
    goals = updateGoalProgress(goals, { result: 'loss', isOnline: true });
    goals = updateGoalProgress(goals, { result: 'win',  isOnline: true });
    goals = updateGoalProgress(goals, { result: 'win',  isOnline: true });
    assert.equal(goals[0].current, 3);
    assert.equal(goals[0].completed, true);
  });
});

describe('loadGoals length check', () => {
  test('regenerates fresh goals when the stored set has 3 daily entries (legacy)', () => {
    const legacyThree = JSON.stringify([
      { id: 'win_1', type: 'daily', current: 0, completed: false, expiresAt: new Date(Date.now() + 1e8).toISOString() },
      { id: 'win_3', type: 'daily', current: 0, completed: false, expiresAt: new Date(Date.now() + 1e8).toISOString() },
      { id: 'pin',   type: 'daily', current: 0, completed: false, expiresAt: new Date(Date.now() + 1e8).toISOString() },
    ]);
    const all = loadGoals(legacyThree);
    const daily = all.filter(g => g.type === 'daily');
    assert.equal(daily.length, 4);
    assert.equal(daily[3].id, ALWAYS_ONLINE_DAILY_GOAL.id);
  });

  test('keeps a valid 4-entry daily set as-is', () => {
    const four = getDailyGoals();
    const stored = JSON.stringify(four);
    const all = loadGoals(stored);
    const daily = all.filter(g => g.type === 'daily');
    assert.equal(daily.length, 4);
    assert.equal(daily[3].id, ALWAYS_ONLINE_DAILY_GOAL.id);
  });
});

// ── Tournament achievement gating (Bracket Regular + Tournament Champion) ──

const baseMatchResult = (overrides = {}) => ({
  result: 'win',
  winMethod: 'decision',
  playerScore: 7,
  opponentScore: 4,
  wasTrailing: false,
  takedowns: 1,
  rideTimeBonuses: 0,
  isOnline: false,
  tournamentEntered: false,
  tournamentWon: false,
  practiceOpponentUid: null,
  maxPeriodPoints: 4,
  ...overrides,
});

describe('checkAchievements - Bracket Regular (tournament_3)', () => {
  test('does not award before tournaments_entered reaches 3', () => {
    const earned = checkAchievements(
      [],
      baseMatchResult({ tournamentEntered: true }),
      { tournaments_entered: 1 }, // would land at 2 after this match
    );
    assert.equal(earned.includes('tournament_3'), false);
  });

  test('awards exactly when tournaments_entered hits 3 with this entry', () => {
    const earned = checkAchievements(
      [],
      baseMatchResult({ tournamentEntered: true }),
      { tournaments_entered: 2 }, // 2 + 1 = 3
    );
    assert.ok(earned.includes('tournament_3'), 'tournament_3 awarded at threshold');
  });

  test('does not double-award once already earned', () => {
    const earned = checkAchievements(
      ['tournament_3'],
      baseMatchResult({ tournamentEntered: true }),
      { tournaments_entered: 5 },
    );
    assert.equal(earned.includes('tournament_3'), false, 'already-earned is skipped');
  });

  test('does not award when tournamentEntered flag is false (regression for the multi-fire bug)', () => {
    // Pre-fix the WrestlingGame caller passed tournamentEntered=true on EVERY
    // round whose key was r1/r16/r32/play-in/qf, inflating the counter 2-4x
    // per tournament. The fix moves the gating to isPlayerFirstBracketMatch;
    // here we just verify checkAchievements respects the flag the caller
    // ultimately decides to set.
    const earned = checkAchievements(
      [],
      baseMatchResult({ tournamentEntered: false }),
      { tournaments_entered: 2 },
    );
    assert.equal(earned.includes('tournament_3'), false);
  });
});

describe('checkAchievements - Tournament Champion (tournament_champion)', () => {
  test('awards when tournamentWon is true', () => {
    const earned = checkAchievements(
      [],
      baseMatchResult({ tournamentWon: true }),
      {},
    );
    assert.ok(earned.includes('tournament_champion'));
  });

  test('does not award when tournamentWon is false', () => {
    const earned = checkAchievements(
      [],
      baseMatchResult({ tournamentWon: false }),
      {},
    );
    assert.equal(earned.includes('tournament_champion'), false);
  });

  test('does not double-award once already earned', () => {
    const earned = checkAchievements(
      ['tournament_champion'],
      baseMatchResult({ tournamentWon: true }),
      {},
    );
    assert.equal(earned.includes('tournament_champion'), false);
  });
});
