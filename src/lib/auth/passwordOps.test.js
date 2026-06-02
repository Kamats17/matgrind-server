import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changePassword,
  reauthIfNeeded,
  pickReauthMethod,
  hasProviderId,
  validatePassword,
  MIN_PASSWORD_LEN,
} from './passwordOps.js';

// ─── Test fixtures ────────────────────────────────────────────────────────

function userPasswordOnly() {
  return {
    uid: 'u_password',
    email: 'foo@example.com',
    providerData: [{ providerId: 'password' }],
  };
}
function userGoogleOnly() {
  return {
    uid: 'u_google',
    email: 'foo@example.com',
    providerData: [{ providerId: 'google.com' }],
  };
}
function userAppleOnly() {
  return {
    uid: 'u_apple',
    email: 'foo@example.com',
    providerData: [{ providerId: 'apple.com' }],
  };
}
function userPasswordAndGoogle() {
  return {
    uid: 'u_pwd_google',
    email: 'foo@example.com',
    providerData: [{ providerId: 'password' }, { providerId: 'google.com' }],
  };
}
function userAll() {
  return {
    uid: 'u_all',
    email: 'foo@example.com',
    providerData: [
      { providerId: 'password' },
      { providerId: 'google.com' },
      { providerId: 'apple.com' },
    ],
  };
}

// Build a deps object with mock implementations + call counters. Each
// function records its calls into deps._calls.
function makeDeps(overrides = {}) {
  const calls = [];
  const credToken = (label) => ({ __cred: label });
  const deps = {
    _calls: calls,
    reauthenticateWithCredential: async (user, cred) => calls.push(['reauthCred', user.uid, cred]),
    reauthenticateWithPopup: async (user, provider) => calls.push(['reauthPopup', user.uid, provider]),
    updatePassword: async (user, pw) => calls.push(['updatePassword', user.uid, pw]),
    linkWithCredential: async (user, cred) => calls.push(['linkCred', user.uid, cred]),
    EmailAuthProviderCredential: (email, pw) => credToken(`email:${email}:${pw}`),
    googleProvider: { __provider: 'google' },
    appleProvider: { __provider: 'apple' },
    nativeCredential: async (provider) => credToken(`native:${provider}`),
    isNative: false,
    ...overrides,
  };
  return deps;
}

// ─── validatePassword + provider classification ──────────────────────────

test('validatePassword throws on too-short password', () => {
  assert.throws(() => validatePassword('short1'), /at least 8 characters/);
  assert.throws(() => validatePassword(''), /at least 8 characters/);
  assert.throws(() => validatePassword(null), /at least 8 characters/);
});

test('validatePassword passes on long-enough password', () => {
  assert.doesNotThrow(() => validatePassword('abcdefgh'));
  assert.doesNotThrow(() => validatePassword('a'.repeat(100)));
});

test('hasProviderId returns true when provider present', () => {
  assert.equal(hasProviderId(userPasswordOnly(), 'password'), true);
  assert.equal(hasProviderId(userGoogleOnly(), 'google.com'), true);
  assert.equal(hasProviderId(userAll(), 'apple.com'), true);
});

test('hasProviderId returns false when provider absent', () => {
  assert.equal(hasProviderId(userPasswordOnly(), 'google.com'), false);
  assert.equal(hasProviderId(userGoogleOnly(), 'password'), false);
  assert.equal(hasProviderId(null, 'password'), false);
  assert.equal(hasProviderId(undefined, 'password'), false);
  assert.equal(hasProviderId({}, 'password'), false);
});

// ─── pickReauthMethod (capability-based, NOT array-order based) ──────────

test('pickReauthMethod: password user with currentPassword -> password', () => {
  const m = pickReauthMethod({ user: userPasswordOnly(), currentPassword: 'pw' });
  assert.equal(m, 'password');
});

test('pickReauthMethod: password user WITHOUT currentPassword -> null', () => {
  // No OAuth backup, no current password => no path.
  const m = pickReauthMethod({ user: userPasswordOnly() });
  assert.equal(m, null);
});

test('pickReauthMethod: google-only user -> google (regardless of currentPassword)', () => {
  assert.equal(pickReauthMethod({ user: userGoogleOnly() }), 'google');
  assert.equal(pickReauthMethod({ user: userGoogleOnly(), currentPassword: 'pw' }), 'google');
});

test('pickReauthMethod: apple-only user -> apple', () => {
  assert.equal(pickReauthMethod({ user: userAppleOnly() }), 'apple');
});

test('pickReauthMethod: password+google with currentPassword -> password (cheaper, no OAuth UI)', () => {
  const m = pickReauthMethod({ user: userPasswordAndGoogle(), currentPassword: 'pw' });
  assert.equal(m, 'password');
});

test('pickReauthMethod: password+google WITHOUT currentPassword -> google fallback', () => {
  const m = pickReauthMethod({ user: userPasswordAndGoogle() });
  assert.equal(m, 'google');
});

test('pickReauthMethod: array order does not drive selection', () => {
  // Apple listed FIRST in providerData. With currentPassword + password
  // provider attached, password reauth wins regardless of array order.
  const allReordered = {
    email: 'foo@example.com',
    providerData: [{ providerId: 'apple.com' }, { providerId: 'google.com' }, { providerId: 'password' }],
  };
  assert.equal(pickReauthMethod({ user: allReordered, currentPassword: 'pw' }), 'password');
  // Strip password, no currentPassword: google preferred over apple.
  const oauthOnlyReordered = {
    email: 'foo@example.com',
    providerData: [{ providerId: 'apple.com' }, { providerId: 'google.com' }],
  };
  assert.equal(pickReauthMethod({ user: oauthOnlyReordered }), 'google');
});

test('pickReauthMethod: no providers -> null', () => {
  assert.equal(pickReauthMethod({ user: { providerData: [] } }), null);
});

// ─── changePassword orchestration ────────────────────────────────────────

test('changePassword: password user calls reauth then updatePassword (NOT linkWithCredential)', async () => {
  const deps = makeDeps();
  const user = userPasswordOnly();
  await changePassword(deps, { user, currentPassword: 'oldpw1234', newPassword: 'newpw1234' });
  const ops = deps._calls.map(c => c[0]);
  assert.deepEqual(ops, ['reauthCred', 'updatePassword']);
  assert.equal(deps._calls.find(c => c[0] === 'linkCred'), undefined);
});

test('changePassword: OAuth-only (Google) calls linkWithCredential (NOT updatePassword)', async () => {
  const deps = makeDeps();
  const user = userGoogleOnly();
  await changePassword(deps, { user, newPassword: 'newpw1234' });
  const ops = deps._calls.map(c => c[0]);
  assert.deepEqual(ops, ['linkCred']);
  assert.equal(deps._calls.find(c => c[0] === 'updatePassword'), undefined);
});

test('changePassword: OAuth-only (Apple) calls linkWithCredential', async () => {
  const deps = makeDeps();
  const user = userAppleOnly();
  await changePassword(deps, { user, newPassword: 'newpw1234' });
  const ops = deps._calls.map(c => c[0]);
  assert.deepEqual(ops, ['linkCred']);
});

test('changePassword: link throws auth/requires-recent-login -> reauth then retry link exactly once', async () => {
  let linkAttempts = 0;
  const deps = makeDeps({
    linkWithCredential: async (user, cred) => {
      linkAttempts++;
      if (linkAttempts === 1) {
        const e = new Error('requires recent login');
        e.code = 'auth/requires-recent-login';
        throw e;
      }
      // Second call succeeds.
    },
  });
  const user = userGoogleOnly();
  await changePassword(deps, { user, newPassword: 'newpw1234' });
  assert.equal(linkAttempts, 2, 'link must be retried exactly once');
  // Must have called reauth between the two link attempts (popup since !isNative + Google).
  const reauthCalls = deps._calls.filter(c => c[0] === 'reauthPopup');
  assert.equal(reauthCalls.length, 1, 'reauth must be called exactly once between link attempts');
});

test('changePassword: link fails with non-recent-login error -> does NOT retry, throws', async () => {
  let linkAttempts = 0;
  const deps = makeDeps({
    linkWithCredential: async () => {
      linkAttempts++;
      const e = new Error('email already in use');
      e.code = 'auth/email-already-in-use';
      throw e;
    },
  });
  await assert.rejects(
    changePassword(deps, { user: userGoogleOnly(), newPassword: 'newpw1234' }),
    /email already in use/,
  );
  assert.equal(linkAttempts, 1, 'must NOT retry on unrelated errors');
});

test('changePassword: missing email -> throws auth/no-email, no Firebase calls', async () => {
  const deps = makeDeps();
  const user = { ...userGoogleOnly(), email: '' };
  await assert.rejects(
    changePassword(deps, { user, newPassword: 'newpw1234' }),
    e => e.code === 'auth/no-email',
  );
  assert.equal(deps._calls.length, 0, 'no Firebase calls must occur');
});

test('changePassword: weak new password -> throws auth/weak-password before any Firebase call', async () => {
  const deps = makeDeps();
  await assert.rejects(
    changePassword(deps, { user: userGoogleOnly(), newPassword: 'short' }),
    e => e.code === 'auth/weak-password',
  );
  assert.equal(deps._calls.length, 0);
});

test('changePassword: no current user -> throws auth/no-current-user', async () => {
  const deps = makeDeps();
  await assert.rejects(
    changePassword(deps, { user: null, newPassword: 'newpw1234' }),
    e => e.code === 'auth/no-current-user',
  );
});

test('changePassword: password user, native platform -> reauth uses email cred (not native)', async () => {
  const deps = makeDeps({ isNative: true });
  await changePassword(deps, { user: userPasswordOnly(), currentPassword: 'oldpw1234', newPassword: 'newpw1234' });
  // Should NOT have called nativeCredential at all - password reauth is preferred.
  assert.equal(deps._calls.find(c => c[0] === 'reauthPopup'), undefined);
  // Should have used reauthCred with the email credential.
  const reauthCall = deps._calls.find(c => c[0] === 'reauthCred');
  assert.ok(reauthCall, 'reauthenticateWithCredential must be called');
  assert.match(reauthCall[2].__cred, /^email:foo@example\.com:oldpw1234$/);
});

test('reauthIfNeeded: native + Google -> uses nativeCredential', async () => {
  const deps = makeDeps({ isNative: true });
  await reauthIfNeeded(deps, { user: userGoogleOnly() });
  const reauthCall = deps._calls.find(c => c[0] === 'reauthCred');
  assert.ok(reauthCall);
  assert.equal(reauthCall[2].__cred, 'native:google');
});

test('reauthIfNeeded: web + Google -> uses reauthenticateWithPopup', async () => {
  const deps = makeDeps({ isNative: false });
  await reauthIfNeeded(deps, { user: userGoogleOnly() });
  const popupCall = deps._calls.find(c => c[0] === 'reauthPopup');
  assert.ok(popupCall);
  assert.deepEqual(popupCall[2], { __provider: 'google' });
});

test('reauthIfNeeded: native + Apple -> uses nativeCredential apple', async () => {
  const deps = makeDeps({ isNative: true });
  await reauthIfNeeded(deps, { user: userAppleOnly() });
  const reauthCall = deps._calls.find(c => c[0] === 'reauthCred');
  assert.ok(reauthCall);
  assert.equal(reauthCall[2].__cred, 'native:apple');
});

test('reauthIfNeeded: no user -> throws', async () => {
  const deps = makeDeps();
  await assert.rejects(reauthIfNeeded(deps, { user: null }), e => e.code === 'auth/no-current-user');
});

test('reauthIfNeeded: orphan account (no providers) -> throws auth/no-reauth-method', async () => {
  const deps = makeDeps();
  await assert.rejects(
    reauthIfNeeded(deps, { user: { email: 'x@y.com', providerData: [] } }),
    e => e.code === 'auth/no-reauth-method',
  );
});

test('MIN_PASSWORD_LEN exported and >= 8', () => {
  assert.ok(MIN_PASSWORD_LEN >= 8);
});
