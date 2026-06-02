import { LocalNotifications } from '@capacitor/local-notifications';
import { Badge } from '@capawesome/capacitor-badge';
import { Capacitor } from '@capacitor/core';

const DAILY_RESET_ID = 1001;
const STREAK_REMINDER_ID = 1002;
const MATCH_FOUND_ID = 1003;
const FRIEND_REQUEST_ID = 1004;

/**
 * Request notification permissions and schedule daily notifications.
 * No-op on web - only runs on native iOS/Android.
 */
export async function initNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { display } = await LocalNotifications.requestPermissions();
    if (display !== 'granted') return;
    await scheduleDailyReset();
    await scheduleStreakReminder();
  } catch (e) {
    console.warn('[Notifications] Init failed:', e?.message);
  }
}

/**
 * Schedule a daily notification at 12:01 AM for new challenges.
 */
export async function scheduleDailyReset() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: DAILY_RESET_ID }] });
    await LocalNotifications.schedule({
      notifications: [{
        id: DAILY_RESET_ID,
        title: 'New Daily Challenges!',
        body: '4 fresh challenges are waiting. Earn bonus XP today!',
        schedule: { on: { hour: 0, minute: 1 }, every: 'day' },
        sound: 'default',
      }],
    });
  } catch (e) {
    console.warn('[Notifications] Daily reset schedule failed:', e?.message);
  }
}

/**
 * Schedule a daily streak reminder at 8 PM.
 */
export async function scheduleStreakReminder() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: STREAK_REMINDER_ID }] });
    await LocalNotifications.schedule({
      notifications: [{
        id: STREAK_REMINDER_ID,
        title: 'Keep your streak alive!',
        body: 'Play a match today or your streak resets at midnight.',
        schedule: { on: { hour: 20, minute: 0 }, every: 'day' },
        sound: 'default',
      }],
    });
  } catch (e) {
    console.warn('[Notifications] Streak reminder schedule failed:', e?.message);
  }
}

/**
 * Cancel the streak reminder (called after completing a match today).
 */
export async function cancelStreakReminder() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: STREAK_REMINDER_ID }] });
  } catch (e) {
    console.warn('[Notifications] Cancel streak reminder failed:', e?.message);
  }
}

/**
 * Fire a "Match found" notification immediately. Called from the matchmaking
 * queue manager when game_start arrives while the app is backgrounded so the
 * user knows to come back. No-op on web (web push is a separate beast).
 */
export async function notifyMatchFound() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // Cancel any prior pending match-found notification so duplicate matches
    // don't pile up notifications in the user's tray.
    await LocalNotifications.cancel({ notifications: [{ id: MATCH_FOUND_ID }] });
    await LocalNotifications.schedule({
      notifications: [{
        id: MATCH_FOUND_ID,
        title: 'Match found!',
        body: 'Your opponent is waiting. Tap to start the bout.',
        sound: 'default',
      }],
    });
  } catch (e) {
    console.warn('[Notifications] Match found schedule failed:', e?.message);
  }
}

/**
 * Fire a "Friend request" notification immediately. Called from the live
 * pending-request listener when a new request arrives while the app is
 * backgrounded. Cancels the previous one so multiple incoming requests
 * collapse into a single tray entry instead of stacking.
 *
 * @param {number} pendingCount - total pending requests after this one
 */
export async function notifyFriendRequest(pendingCount = 1) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: FRIEND_REQUEST_ID }] });
    const body = pendingCount > 1
      ? `You have ${pendingCount} pending friend requests. Tap to review.`
      : 'A wrestler wants to be your training partner. Tap to review.';
    await LocalNotifications.schedule({
      notifications: [{
        id: FRIEND_REQUEST_ID,
        title: 'New friend request',
        body,
        sound: 'default',
      }],
    });
  } catch (e) {
    console.warn('[Notifications] Friend request schedule failed:', e?.message);
  }
}

/**
 * Clear the friend-request notification - called when the user opens the
 * Friends tab so the tray entry doesn't linger after they've already seen
 * the requests.
 */
export async function clearFriendRequestNotification() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: FRIEND_REQUEST_ID }] });
  } catch (e) {
    console.warn('[Notifications] Friend request clear failed:', e?.message);
  }
}

/**
 * Update the app icon badge count.
 * Pass 0 to clear the badge.
 */
export async function updateBadge(count) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    if (count > 0) {
      await Badge.set({ count });
    } else {
      await Badge.clear();
    }
  } catch (e) {
    console.warn('[Badge] Update failed:', e?.message);
  }
}
