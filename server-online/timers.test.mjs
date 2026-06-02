import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scheduleTimer, scheduleInterval, clearScheduled, destroyRoomTimers } from './timers.mjs';

test('scheduleTimer registers handle in allTimers and auto-removes on fire', async () => {
  const room = {};
  let fired = false;
  scheduleTimer(room, () => { fired = true; }, 10);
  assert.equal(room.allTimers.size, 1);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(fired, true);
  assert.equal(room.allTimers.size, 0, 'handle removed after fire');
});

test('scheduleTimer error in callback is swallowed (logged), still removed', async () => {
  const room = {};
  scheduleTimer(room, () => { throw new Error('boom'); }, 10);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(room.allTimers.size, 0);
});

test('clearScheduled cancels a pending timer', async () => {
  const room = {};
  let fired = false;
  const h = scheduleTimer(room, () => { fired = true; }, 50);
  clearScheduled(room, h);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(fired, false);
  assert.equal(room.allTimers.size, 0);
});

test('destroyRoomTimers drains every registered handle', async () => {
  const room = {};
  let fires = 0;
  scheduleTimer(room, () => { fires++; }, 30);
  scheduleTimer(room, () => { fires++; }, 30);
  scheduleInterval(room, () => { fires++; }, 30);
  assert.equal(room.allTimers.size, 3);
  destroyRoomTimers(room);
  assert.equal(room.allTimers.size, 0);
  await new Promise(r => setTimeout(r, 80));
  assert.equal(fires, 0, 'no callbacks fired after destroy');
});

test('scheduleInterval keeps handle until cancelled', async () => {
  const room = {};
  let fires = 0;
  const h = scheduleInterval(room, () => { fires++; }, 10);
  await new Promise(r => setTimeout(r, 35));
  clearScheduled(room, h);
  const after = fires;
  await new Promise(r => setTimeout(r, 30));
  assert.equal(fires, after, 'no more fires after clear');
  assert.ok(after >= 2, 'interval fired multiple times');
  assert.equal(room.allTimers.size, 0);
});

test('clearScheduled is safe with falsy or stale handles', () => {
  const room = { allTimers: new Set() };
  clearScheduled(room, null);
  clearScheduled(room, undefined);
  clearScheduled(room, 9999);
  assert.equal(room.allTimers.size, 0);
});
