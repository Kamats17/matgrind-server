// Pure orchestration helpers for password set / change / reset. Extracted
// from AuthContext.jsx so the branching logic can be unit-tested without
// pulling in React context, the Firebase JS SDK, or @capacitor-firebase
// plugins. The React layer wires Firebase functions in via `deps`.
//
// All functions take `deps` as the first arg and `args` as the second.
// `deps` shape (Firebase + native helpers):
//   {
//     reauthenticateWithCredential, reauthenticateWithPopup,
//     updatePassword, linkWithCredential,
//     EmailAuthProviderCredential,           // (email, password) => AuthCredential
//     googleProvider, appleProvider,
//     nativeCredential,                      // (provider) => Promise<AuthCredential>
//     isNative,
//   }
//
// All consumers must catch and surface the structured Errors thrown here.

/** @typedef {Error & { code?: string }} CodedError */

/**
 * Build an Error with a `code` property attached. Mirrors Firebase Auth's
 * own error shape so callers can branch on `e.code` ('auth/weak-password',
 * etc.).
 *
 * @param {string} message
 * @param {string} code
 * @returns {CodedError}
 */
function codedError(message, code) {
  /** @type {CodedError} */
  const e = new Error(message);
  e.code = code;
  return e;
}

export const MIN_PASSWORD_LEN = 8;

export function validatePassword(pw, minLen = MIN_PASSWORD_LEN) {
  if (typeof pw !== 'string' || pw.length < minLen) {
    throw codedError(`Password must be at least ${minLen} characters.`, 'auth/weak-password');
  }
}

export function providerIdsOf(user) {
  return (user?.providerData || []).map(p => p.providerId);
}

export function hasProviderId(user, id) {
  return providerIdsOf(user).includes(id);
}

/**
 * Decide which reauth method to use for the given user. Capability-based,
 * never reads array order.
 *
 * Returns one of: 'password' | 'google' | 'apple' | null
 */
export function pickReauthMethod({ user, currentPassword }) {
  const ids = providerIdsOf(user);
  if (currentPassword && ids.includes('password')) return 'password';
  if (ids.includes('google.com')) return 'google';
  if (ids.includes('apple.com')) return 'apple';
  return null;
}

/**
 * Re-authenticate the current user. Called before updatePassword and as
 * the recovery step when linkWithCredential throws auth/requires-recent-login.
 *
 * @param {object} deps
 * @param {{ user?: any, currentPassword?: string }} [args]
 */
export async function reauthIfNeeded(deps, args = {}) {
  const { user, currentPassword } = args;
  if (!user) {
    throw codedError('Not signed in', 'auth/no-current-user');
  }
  const method = pickReauthMethod({ user, currentPassword });
  if (method === 'password') {
    if (!user.email) {
      throw codedError('Account has no email; cannot reauth with password.', 'auth/no-email');
    }
    const cred = deps.EmailAuthProviderCredential(user.email, currentPassword);
    await deps.reauthenticateWithCredential(user, cred);
    return;
  }
  if (method === 'google') {
    if (deps.isNative) {
      const cred = await deps.nativeCredential('google');
      await deps.reauthenticateWithCredential(user, cred);
    } else {
      await deps.reauthenticateWithPopup(user, deps.googleProvider);
    }
    return;
  }
  if (method === 'apple') {
    if (deps.isNative) {
      const cred = await deps.nativeCredential('apple');
      await deps.reauthenticateWithCredential(user, cred);
    } else {
      await deps.reauthenticateWithPopup(user, deps.appleProvider);
    }
    return;
  }
  throw codedError('No re-authentication method available for this account.', 'auth/no-reauth-method');
}

/**
 * Change or set the user's password.
 *   - User has password provider: reauth with currentPassword, then updatePassword.
 *   - OAuth-only user: linkWithCredential to add the password provider.
 *     If Firebase requires recent login, reauth via the linked OAuth
 *     provider and retry the link exactly once.
 *
 * Same UID is preserved in both cases - no data fragmentation.
 */
export async function changePassword(deps, { user, currentPassword, newPassword }) {
  if (!user) {
    throw codedError('Not signed in.', 'auth/no-current-user');
  }
  if (!user.email) {
    throw codedError(
      'Your account does not have a usable email. Cannot set a password. Sign in with a different provider that exposes an email.',
      'auth/no-email',
    );
  }
  validatePassword(newPassword);

  if (hasProviderId(user, 'password')) {
    await reauthIfNeeded(deps, { user, currentPassword });
    await deps.updatePassword(user, newPassword);
    return;
  }
  // OAuth-only path: link a password credential to the existing UID.
  const cred = deps.EmailAuthProviderCredential(user.email, newPassword);
  try {
    await deps.linkWithCredential(user, cred);
  } catch (e) {
    if (/** @type {CodedError} */ (e)?.code === 'auth/requires-recent-login') {
      await reauthIfNeeded(deps, { user, currentPassword });
      await deps.linkWithCredential(user, cred);
      return;
    }
    throw e;
  }
}
