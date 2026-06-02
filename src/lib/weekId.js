// ISO-week key helpers for weekly leaderboards.
//
// Format: 'YYYY-Www' (e.g., '2026-W17'). ISO weeks run Monday→Sunday, so a
// Sunday-night match and a Monday-morning match land in different buckets
// as expected - no timezone ambiguity beyond the device's local clock.
//
// Kept intentionally small: date-fns already ships with the app (used by
// Profile chart), so we just lean on `format(..., 'RRRR-\\'W\\'II')`.

import { format } from 'date-fns';

/**
 * Returns the ISO week key for a given Date (defaults to now).
 * Example: new Date('2026-04-23') → '2026-W17'
 */
export function weekIdFor(date = new Date()) {
  // 'RRRR' = ISO week-numbering year (not calendar year - these diverge at
  // year boundaries for weeks that span Dec/Jan).
  // 'II'   = ISO week number, zero-padded.
  return format(date, "RRRR-'W'II");
}

/** Shorthand: ISO week key for the current moment. */
export function currentWeekId() {
  return weekIdFor(new Date());
}
