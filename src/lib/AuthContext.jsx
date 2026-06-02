import React, { createContext, useState, useContext, useEffect } from 'react';
import { auth, isNative } from './firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
  signOut,
  updateProfile,
  deleteUser,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
  linkWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { deleteProfile, getProfile, saveProfile, createMatch } from './firestoreService';
import { migrateGuestToAccount } from './guestProfile.js';
import { changePassword as changePasswordOp } from './auth/passwordOps.js';

// Native Firebase Auth plugin - only imported on native platforms at
// runtime so the web bundle doesn't pull in the full plugin JS
// (it's a ~30 KB addition and none of it executes in a browser).
// Loaded lazily inside loginWithGoogle/loginWithApple below.

const AuthContext = createContext(/** @type {any} */ (null));

const googleProvider = new GoogleAuthProvider();

const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');

// Project a Firebase User into the plain object we keep in React state.
// providerIds is included so consumers can react to provider link/unlink
// without reaching into the live auth.currentUser (which Firebase mutates
// in place without triggering onAuthStateChanged).
function snapshotUser(firebaseUser) {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL,
    providerIds: (firebaseUser.providerData || []).map(p => p.providerId),
  };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  // Start as NOT loading - render the app immediately.
  // Auth resolves in the background; the UI updates reactively.
  // This prevents ANY possibility of infinite loading on iOS.
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    // On native, skip getRedirectResult entirely - redirect auth
    // does not work in WKWebView and can hang indefinitely.
    if (!isNative) {
      getRedirectResult(auth).catch(() => {});
    }

    // Kick off Game Center authentication on native (iOS). Non-blocking:
    // GameKit shows a banner (or nothing if the user previously dismissed),
    // and the JS wrapper silently handles the "not authenticated" case so
    // match-end score submissions simply no-op for users who stay signed out.
    if (isNative) {
      import('./gameCenter.js')
        .then(({ gcAuthenticate }) => gcAuthenticate())
        .catch(() => {});
    }

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser(snapshotUser(firebaseUser));
        setIsAuthenticated(true);
        // Fold any guest-mode progression (XP, stats, badges, match
        // history) into the now-authenticated account. No-op if guest
        // storage is empty. Fire-and-forget - we don't want auth to
        // stall waiting on this, and migrateGuestToAccount leaves the
        // data in place if it fails so the next sign-in can retry.
        migrateGuestToAccount(firebaseUser.uid, { getProfile, saveProfile, createMatch })
          .catch((e) => console.warn('[AuthContext] guest migrate failed:', e?.message));
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setIsLoadingAuth(false);
    });
    return () => { unsubscribe(); };
  }, []);

  const loginWithEmail = async (email, password) => {
    try {
      setAuthError(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setAuthError({ type: 'login_failed', message: error.message });
      throw error;
    }
  };

  const signUpWithEmail = async (email, password, displayName) => {
    try {
      setAuthError(null);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName) {
        await updateProfile(cred.user, { displayName });
      }
    } catch (error) {
      setAuthError({ type: 'signup_failed', message: error.message });
      throw error;
    }
  };

  // Native path: call the Capacitor Firebase Auth plugin, which invokes
  // the platform-native Google / Apple sign-in UI. The plugin returns a
  // Firebase ID token + (for Google) an access token. We expose two
  // helpers so callers can pick between "fully sign in" (replaces the
  // current auth state) and "just produce a credential" (used by
  // reauthenticateWithCredential / linkWithCredential, which must NOT
  // mutate auth state).
  //
  // This is the only way to do Google/Apple sign-in from a Capacitor
  // WKWebView on iOS - signInWithPopup/Redirect can't round-trip.

  // Acquire an OAuth credential via the native plugin without touching
  // auth state. Returns an AuthCredential the caller can pass to
  // signInWithCredential, reauthenticateWithCredential, or linkWithCredential.
  const nativeCredential = async (provider) => {
    const { FirebaseAuthentication } =
      await import('@capacitor-firebase/authentication');
    if (provider === 'google') {
      const res = await FirebaseAuthentication.signInWithGoogle();
      const idToken = res.credential?.idToken;
      const accessToken = res.credential?.accessToken;
      if (!idToken) throw new Error('Google sign-in returned no ID token');
      return GoogleAuthProvider.credential(idToken, accessToken);
    }
    if (provider === 'apple') {
      const res = await FirebaseAuthentication.signInWithApple();
      const idToken = res.credential?.idToken;
      const rawNonce = res.credential?.nonce;
      if (!idToken) throw new Error('Apple sign-in returned no ID token');
      const op = new OAuthProvider('apple.com');
      return op.credential({ idToken, rawNonce });
    }
    throw new Error(`Unknown native provider: ${provider}`);
  };

  const nativeSignIn = async (provider) => {
    const cred = await nativeCredential(provider);
    await signInWithCredential(auth, cred);
  };

  const loginWithGoogle = async () => {
    try {
      setAuthError(null);
      if (isNative) {
        await nativeSignIn('google');
        return;
      }
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      // Web: if popup blocked, fall back to redirect. Native path never
      // hits this branch because the plugin doesn't throw popup errors.
      if (error.code === 'auth/popup-blocked' ||
          error.code === 'auth/popup-closed-by-user' ||
          error.code === 'auth/cancelled-popup-request') {
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (redirectError) {
          setAuthError({ type: 'google_failed', message: redirectError.message });
          throw redirectError;
        }
      }
      let msg = error.message;
      if (error.code === 'auth/unauthorized-domain') {
        msg = 'This domain is not authorized for Google sign-in. Add it in Firebase Console → Authentication → Settings → Authorized domains.';
      } else if (error.code === 'auth/operation-not-allowed') {
        msg = 'Google sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method.';
      } else if (error.code === 'auth/internal-error') {
        msg = 'Google sign-in failed. Make sure Google is enabled as a sign-in provider in Firebase Console.';
      }
      setAuthError({ type: 'google_failed', message: msg });
      throw error;
    }
  };

  const loginWithApple = async () => {
    try {
      setAuthError(null);
      if (isNative) {
        await nativeSignIn('apple');
        return;
      }
      await signInWithPopup(auth, appleProvider);
    } catch (error) {
      if (error.code === 'auth/popup-blocked' ||
          error.code === 'auth/popup-closed-by-user' ||
          error.code === 'auth/cancelled-popup-request') {
        try {
          await signInWithRedirect(auth, appleProvider);
          return;
        } catch (redirectError) {
          setAuthError({ type: 'apple_failed', message: redirectError.message });
          throw redirectError;
        }
      }
      let msg = error.message;
      if (error.code === 'auth/operation-not-allowed') {
        msg = 'Apple sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method.';
      }
      setAuthError({ type: 'apple_failed', message: msg });
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  /**
   * Complete account deletion - Firestore data + Auth user.
   *
   * Apple Guideline 5.1.1(v) requires real deletion. `deleteUser` can
   * fail with `auth/requires-recent-login` if the user's token is stale.
   * In that case we still report the Firestore deletion succeeded so the
   * user can re-sign-in and complete the auth-side deletion from a fresh
   * session. The alternative - silently leaving a ghost auth record - is
   * what App Review specifically flags.
   */
  const deleteAccount = async () => {
    const current = auth.currentUser;
    if (!current) throw new Error('No authenticated user to delete');
    setAuthError(null);
    // Wipe Firestore data first. If this throws we haven't touched Auth.
    try {
      await deleteProfile(current.uid);
    } catch (e) {
      // Best-effort: even if some docs fail to delete (rules edge case),
      // continue and delete the Auth user so the account is no longer
      // accessible. Orphaned docs can be cleaned up via a Firestore scan.
      console.warn('[deleteAccount] Firestore cleanup failed:', e?.message);
    }
    // Now delete the Auth user. May require recent login.
    try {
      await deleteUser(current);
    } catch (e) {
      if (e?.code === 'auth/requires-recent-login') {
        setAuthError({
          type: 'requires_reauth',
          message: 'Please sign in again, then retry deleting your account.',
        });
      }
      throw e;
    }
  };

  // ─── Password management ──────────────────────────────────────────────
  // Orchestration logic lives in src/lib/auth/passwordOps.js (pure module,
  // unit-tested). This wrapper just wires Firebase deps, refreshes React
  // state after provider changes, and surfaces errors as authError.
  //
  // hasPasswordProvider reads from the snapshotted user in React state,
  // not from auth.currentUser. Firebase mutates auth.currentUser in place
  // when linkWithCredential / unlink runs, but does NOT fire
  // onAuthStateChanged for those events. Reading from React state forces
  // a re-render only after we explicitly setUser below.
  const hasPasswordProvider = (user?.providerIds || []).includes('password');

  const passwordDeps = {
    reauthenticateWithCredential,
    reauthenticateWithPopup,
    updatePassword,
    linkWithCredential,
    EmailAuthProviderCredential: EmailAuthProvider.credential.bind(EmailAuthProvider),
    googleProvider,
    appleProvider,
    nativeCredential,
    isNative,
  };

  // Pull the latest providerData from Firebase and update React state.
  // Called after operations that mutate the current user (linkWithCredential,
  // updatePassword) so derived UI like hasPasswordProvider reflects truth.
  const refreshUserSnapshot = async () => {
    const current = auth.currentUser;
    if (!current) return;
    try { await current.reload(); } catch { /* network blip; the snapshot below uses cached data */ }
    setUser(snapshotUser(auth.currentUser || current));
  };

  const changePassword = async ({ currentPassword, newPassword }) => {
    setAuthError(null);
    try {
      await changePasswordOp(passwordDeps, {
        user: auth.currentUser,
        currentPassword,
        newPassword,
      });
      await refreshUserSnapshot();
    } catch (e) {
      setAuthError({
        type: 'change_password_failed',
        message: e?.message || 'Password update failed.',
        code: e?.code,
      });
      throw e;
    }
  };

  /**
   * Send a password reset email via Firebase. Works regardless of whether
   * the user has a password provider attached; first reset adds it.
   */
  const sendPasswordReset = async (email) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (e) {
      setAuthError({ type: 'reset_failed', message: e?.message, code: e?.code });
      throw e;
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      appPublicSettings: null,
      hasPasswordProvider,
      logout,
      deleteAccount,
      loginWithEmail,
      signUpWithEmail,
      loginWithGoogle,
      loginWithApple,
      changePassword,
      sendPasswordReset,
      navigateToLogin: () => {},
      checkAppState: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
