/**
 * Race a promise against a timeout. Always settles cleanly with a
 * tagged result so callers don't need try/catch.
 *
 * Usage:
 *   const r = await withTimeout(saveProfile(uid, payload), 10_000, 'saveProfile');
 *   if (!r.ok) {
 *     if (r.error === 'timeout') showError('Save timed out. Try again.');
 *     else showError(`Save failed: ${r.error.message ?? r.error}`);
 *     return;
 *   }
 *   // r.value is the resolved value
 *
 * Returns:
 *   { ok: true,  value: <resolved> }
 *   { ok: false, error: 'timeout', label?: <string> }
 *   { ok: false, error: <thrownError> }
 */
const TIMEOUT_SENTINEL = Symbol.for('matgrind:withTimeout:expired');

export async function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(TIMEOUT_SENTINEL), ms);
  });
  try {
    const value = await Promise.race([promise, timeoutPromise]);
    return { ok: true, value };
  } catch (err) {
    if (err === TIMEOUT_SENTINEL) {
      const out = { ok: false, error: 'timeout' };
      if (label) out.label = label;
      return out;
    }
    return { ok: false, error: err };
  } finally {
    clearTimeout(timer);
  }
}
