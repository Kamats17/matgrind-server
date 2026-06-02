// ChangePasswordSheet
//
// Bottom-sheet UI for setting a first password (OAuth-only users) or
// changing an existing password. The sheet is purely presentational:
// orchestration lives in src/lib/auth/passwordOps.js + AuthContext.jsx.
// The sheet validates fields client-side, makes one call to changePassword,
// and surfaces the resulting error.

import React, { useEffect, useState } from 'react';
import BottomSheet from '../ui/BottomSheet.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';
import { MIN_PASSWORD_LEN } from '../../lib/auth/passwordOps.js';

export default function ChangePasswordSheet({ open, onClose }) {
  const { hasPasswordProvider, changePassword, authError } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [localError, setLocalError] = useState('');

  // Reset on open/close.
  useEffect(() => {
    if (!open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSubmitting(false);
      setSuccess(false);
      setLocalError('');
    }
  }, [open]);

  // Auto-close 1.5s after success.
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => onClose?.(), 1500);
    return () => clearTimeout(t);
  }, [success, onClose]);

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    setLocalError('');
    if (hasPasswordProvider && !currentPassword) {
      setLocalError('Enter your current password.');
      return;
    }
    if (!newPassword || newPassword.length < MIN_PASSWORD_LEN) {
      setLocalError(`New password must be at least ${MIN_PASSWORD_LEN} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await changePassword({ currentPassword: currentPassword || undefined, newPassword });
      setSuccess(true);
    } catch (err) {
      // authError is set by changePassword; nothing else to do here.
      // Surface a localError for accessible fallback if authError is empty.
      if (!authError?.message) setLocalError(err?.message || 'Could not change password.');
    } finally {
      setSubmitting(false);
    }
  };

  const errorMsg = localError || authError?.message;
  const title = hasPasswordProvider ? 'Change password' : 'Set a password';

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      {success ? (
        <div className="py-6 text-center">
          <div className="text-emerald-400 text-base font-bold mb-1">Password updated</div>
          <div className="text-zinc-500 text-xs">You can now sign in with your email and password.</div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          {hasPasswordProvider && (
            <label className="block">
              <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider block mb-1">
                Current password
              </span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
              />
            </label>
          )}
          <label className="block">
            <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider block mb-1">
              New password
            </span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LEN}
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
            />
          </label>
          <label className="block">
            <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider block mb-1">
              Confirm new password
            </span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LEN}
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
            />
          </label>
          {!hasPasswordProvider && (
            <p className="text-zinc-500 text-[11px] leading-relaxed pt-1">
              Adding a password lets you sign in with your email anywhere, while keeping your existing Google or Apple sign-in.
            </p>
          )}
          {errorMsg && (
            <div role="alert" className="text-red-400 text-xs font-semibold pt-1">
              {errorMsg}
            </div>
          )}
          <div className="pt-3 space-y-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-yellow-500 hover:bg-yellow-400 active:scale-95 text-black font-black py-3.5 rounded-xl transition-all text-sm tracking-wide disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? 'SAVING...' : (hasPasswordProvider ? 'CHANGE PASSWORD' : 'SET PASSWORD')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="w-full bg-zinc-800 hover:bg-zinc-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </BottomSheet>
  );
}
