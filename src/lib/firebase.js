import { initializeApp } from 'firebase/app';
import { initializeAuth, getAuth, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics, logEvent as fbLogEvent, isSupported } from 'firebase/analytics';
import { Capacitor } from '@capacitor/core';

const firebaseConfig = {
  apiKey: "AIzaSyAb0NOoZR1K8UMMBm9M2Zz7aggGfTe0YLM",
  authDomain: "auth.matgrind.com",
  projectId: "matgrind-b7954",
  storageBucket: "matgrind-b7954.firebasestorage.app",
  messagingSenderId: "883332910803",
  appId: "1:883332910803:web:aab129f07861994d3c0e26",
  measurementId: "G-272TMRPTWV",
};

const app = initializeApp(firebaseConfig);

// Reliable native-platform check - Capacitor.isNativePlatform() is synchronous
// and available immediately at module load time from @capacitor/core.
let isNative = false;
try {
  isNative = Capacitor.isNativePlatform();
} catch {
  // Capacitor not available (shouldn't happen, but safe fallback)
}

// ─── Firebase Auth ──────────────────────────────────────────────────────────
// On native iOS, getAuth() uses IndexedDB-based persistence by default.
// iOS WKWebView has well-documented IndexedDB bugs that cause the auth
// initialization promise to hang FOREVER, so onAuthStateChanged never fires.
// (firebase-js-sdk #6504, #5019, #6791)
//
// Fix: use initializeAuth() with browserLocalPersistence ONLY on native.
// This uses localStorage instead of IndexedDB, which works reliably in WKWebView.
let auth;
try {
  if (isNative) {
    auth = initializeAuth(app, {
      persistence: [browserLocalPersistence],
    });
  } else {
    auth = getAuth(app);
  }
} catch (e) {
  // initializeAuth throws if already called (e.g. HMR in dev).
  // Fall back to getAuth which returns the existing instance.
  // IMPORTANT: On native, this is safe because initializeAuth already set
  // the persistence on the first call. getAuth reuses that same instance.
  console.warn('Firebase auth init fallback:', e.message);
  try {
    auth = getAuth(app);
  } catch (_) {
    // Nuclear fallback: if everything fails, create fresh auth with safe persistence.
    // This should never happen but guarantees the app doesn't crash at import time.
    auth = initializeAuth(app, { persistence: [browserLocalPersistence] });
  }
}
export { auth };
export { isNative };

export const db = getFirestore(app);

// Analytics - lazy init, no-op if unsupported (e.g. SSR, some WebViews).
// Wrapped with a 5-second timeout so a hanging isSupported() probe
// doesn't leave a forever-pending promise.
let analyticsInstance = null;
const analyticsTimeout = new Promise((_, reject) =>
  setTimeout(() => reject(new Error('analytics timeout')), 5000)
);
Promise.race([isSupported(), analyticsTimeout])
  .then(yes => { if (yes) analyticsInstance = getAnalytics(app); })
  .catch(() => { /* Analytics unavailable - no-op */ });

export function logEvent(eventName, params) {
  if (analyticsInstance) fbLogEvent(analyticsInstance, eventName, params);
}

export default app;
