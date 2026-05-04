// Firebase Admin SDK — token verification
import admin from 'firebase-admin';

let initialized = false;

export function initFirebase() {
  if (initialized) return;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

  if (serviceAccount) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
      });
      console.log('[Auth] Firebase Admin initialized — token verification enabled');
    } catch (err) {
      console.error('[Auth] Firebase init failed:', err.message);
      if (isProduction) {
        console.error('[Auth] FATAL: Cannot run without token verification in production');
        process.exit(1);
      }
      console.warn('[Auth] Running without token verification (dev mode)');
    }
  } else {
    if (isProduction) {
      console.error('[Auth] FATAL: FIREBASE_SERVICE_ACCOUNT is required in production');
      process.exit(1);
    }
    console.warn('[Auth] No FIREBASE_SERVICE_ACCOUNT — running in dev mode (all tokens accepted)');
  }
  initialized = true;
}

/**
 * Verify a Firebase ID token.
 * Returns the UID if valid, null if invalid.
 * In dev mode (no service account), accepts any token and returns a mock UID.
 */
export async function verifyToken(token) {
  if (!token) return null;

  // Dev mode: no Firebase configured
  if (!admin.apps.length) {
    // Accept token as-is for local development
    return `dev_${token.slice(0, 8)}`;
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid;
  } catch (err) {
    console.warn('[Auth] Token verification failed:', err.message);
    return null;
  }
}
