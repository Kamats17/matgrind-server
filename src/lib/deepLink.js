// Deep-link router for invites. Two entry points:
//   1. Web - on page load, we read window.location.pathname for /i/<code>.
//   2. Native (iOS) - @capacitor/app emits `appUrlOpen` when the OS
//      hands us a URL (custom scheme `matgrind://` or universal link
//      play.matgrind.com/i/<code>).
//
// Both funnel into a single queue drained by the main App once the auth
// state is known. Resolving the friend request needs a signed-in uid;
// if none is present when the link arrives, we stash the code in
// sessionStorage and consume on first sign-in.

import { Capacitor } from '@capacitor/core';
import { parseInviteCode } from './invites';

const STORAGE_KEY = 'matgrind_pending_invite';

/** Pull a pending code off the current URL (web), if any. */
export function getPendingCodeFromUrl() {
  try {
    const path = window.location?.pathname || '';
    const code = parseInviteCode(path);
    if (code) return code;
  } catch { /* SSR/Node environment - ignore */ }
  return null;
}

/** Read the stashed invite code (across reloads or post-login). */
export function popPendingInvite() {
  try {
    const code = sessionStorage.getItem(STORAGE_KEY);
    if (code) sessionStorage.removeItem(STORAGE_KEY);
    return code || null;
  } catch {
    return null;
  }
}

export function setPendingInvite(code) {
  try { sessionStorage.setItem(STORAGE_KEY, code); } catch { /* ignore quota */ }
}

/**
 * Register the native URL listener. Caller supplies a handler that
 * receives the parsed invite code. The listener is a no-op on web.
 * Returns an unsubscribe function.
 */
export async function registerNativeInviteListener(onCode) {
  if (!Capacitor.isNativePlatform()) return () => {};
  try {
    const { App } = await import('@capacitor/app');
    const sub = await App.addListener('appUrlOpen', (event) => {
      const code = parseInviteCode(event?.url || '');
      if (code) onCode(code);
    });
    return () => { sub?.remove?.(); };
  } catch (e) {
    console.warn('[deepLink] failed to register listener', e);
    return () => {};
  }
}

/**
 * Strip the `/i/<code>` path out of the URL after we've captured it, so
 * a page reload doesn't re-trigger the invite flow.
 */
export function clearInvitePath() {
  try {
    if (window.location?.pathname?.startsWith('/i/')) {
      window.history.replaceState({}, '', '/');
    }
  } catch { /* ignore */ }
}
