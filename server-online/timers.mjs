// Timer helpers for the authoritative online server. These are the ONLY
// way to schedule timers in server-online/ - bare setTimeout/setInterval
// are CI-banned. Auto-registers handle in `room.allTimers` and auto-removes
// on fire/cancel so destroyRoom can drain everything cleanly.

/**
 * Schedule a one-shot callback. Handle is registered in room.allTimers
 * and auto-removed when it fires.
 * @param {object} room - room with .allTimers Set
 * @param {() => void} fn - callback
 * @param {number} ms - delay
 * @returns the timeout handle (so the caller can cancel it)
 */
export function scheduleTimer(room, fn, ms) {
  if (!room.allTimers) room.allTimers = new Set();
  let handle;
  handle = setTimeout(() => {
    room.allTimers.delete(handle);
    try { fn(); } catch (err) {
      console.error('[TIMER ERROR]', err);
    }
  }, ms);
  // unref so a stray test timer doesn't hold the test process alive.
  // Production servers stay alive via the WS listener, not timers.
  if (typeof handle.unref === 'function') handle.unref();
  room.allTimers.add(handle);
  return handle;
}

/**
 * Schedule a recurring callback. Handle stays in room.allTimers until
 * cancelled via clearScheduled or drained via destroyRoomTimers.
 */
export function scheduleInterval(room, fn, ms) {
  if (!room.allTimers) room.allTimers = new Set();
  const handle = setInterval(() => {
    try { fn(); } catch (err) {
      console.error('[INTERVAL ERROR]', err);
    }
  }, ms);
  if (typeof handle.unref === 'function') handle.unref();
  room.allTimers.add(handle);
  return handle;
}

/**
 * Cancel a timer registered via scheduleTimer/scheduleInterval. Safe to
 * call with any falsy value or a stale handle.
 */
export function clearScheduled(room, handle) {
  if (!handle) return;
  clearTimeout(handle);
  clearInterval(handle);
  room.allTimers?.delete(handle);
}

/**
 * Drain ALL timer handles for a room. Call from destroyRoom / voidRoom.
 */
export function destroyRoomTimers(room) {
  if (!room.allTimers) return;
  for (const handle of room.allTimers) {
    clearTimeout(handle);
    clearInterval(handle);
  }
  room.allTimers.clear();
}
