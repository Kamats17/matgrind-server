// ForgotPasswordSheet
//
// Bottom-sheet UI for the unauthenticated "Forgot password?" flow. Calls
// sendPasswordReset(email), then shows a confirmation message and
// auto-closes. Works for any account state (Google-only, Apple-only,
// password) - Firebase's hosted reset page sets the password and links
// the password provider on first set.

import React, { useEffect, useState } from 'react';
import BottomSheet from '../ui/BottomSheet.jsx';
import { useAuth } from '../../lib/AuthContext.jsx';

export default function ForgotPasswordSheet({ open, onClose, defaultEmail = '' }) {
  const { sendPasswordReset, authError } = useAuth();
  const [email, setEmail] = useState(defaultEmail);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) {
      setEmail(defaultEmail);
      setSubmitting(false);
      setSent(false);
      setLocalError('');
    } else {
      setEmail(defaultEmail);
    }
  }, [open, defaultEmail]);

  useEffect(() => {
    if (!sent) return;
    const t = setTimeout(() => onClose?.(), 2200);
    return () => clearTimeout(t);
  }, [sent, onClose]);

  const onSubmit = async (e) => {
    e?.preventDefault?.();
    setLocalError('');
    if (!email || !email.includes('@')) {
      setLocalError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      if (!authError?.message) setLocalError(err?.message || 'Could not send reset email.');
    } finally {
      setSubmitting(false);
    }
  };

  const errorMsg = localError || authError?.message;

  return (
    <BottomSheet open={open} onClose={onClose} title="Reset password">
      {sent ? (
        <div className="py-6 text-center">
          <div className="text-emerald-400 text-base font-bold mb-1">Check your inbox</div>
          <div className="text-zinc-500 text-xs">We sent a reset link to {email}.</div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-zinc-400 text-xs font-bold uppercase tracking-wider block mb-1">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
            />
          </label>
          <p className="text-zinc-500 text-[11px] leading-relaxed pt-1">
            We will send a link to set a new password. Works for accounts created with Google, Apple, or email.
          </p>
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
              {submitting ? 'SENDING...' : 'SEND RESET LINK'}
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
