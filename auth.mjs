// Firebase Admin SDK — token verification
import admin from 'firebase-admin';

let initialized = false;

export function initFirebase() {
  if (initialized) return;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (serviceAccount) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
      });
    } catch (err) {
      console.warn('[Auth] Firebase init failed:', err.message);
      console.warn('[Auth] Running without token verification (dev mode)');
    }
  } else {
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
