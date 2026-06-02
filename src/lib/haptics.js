// src/lib/haptics.js
//
// Thin haptic-feedback wrapper. On native iOS/Android (Capacitor), we route
// through the `@capacitor/haptics` plugin. On web, we now fall back to
// `navigator.vibrate` where available (mainly Android Chrome) so the app
// still provides tactile feedback in a web/PWA context.
//
// API is unchanged from the original 13-line version - every call site
// elsewhere in the app uses `haptic.light/medium/heavy/success/warning/error`
// exactly as before; only the fallback behaviour is new.
//
// On desktop browsers and iOS Safari, `navigator.vibrate` is either missing
// or a silent no-op - calls are wrapped in try/catch to be safe.

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

const isNative = Capacitor.isNativePlatform();

const canWebVibrate =
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

const webBuzz = (pattern) => {
  if (isNative || !canWebVibrate) return;
  try { navigator.vibrate(pattern); } catch { /* silent */ }
};

export const haptic = {
  light:   () => isNative ? Haptics.impact({ style: ImpactStyle.Light })  : webBuzz(10),
  medium:  () => isNative ? Haptics.impact({ style: ImpactStyle.Medium }) : webBuzz(20),
  heavy:   () => isNative ? Haptics.impact({ style: ImpactStyle.Heavy })  : webBuzz(30),
  success: () => isNative ? Haptics.notification({ type: NotificationType.Success }) : webBuzz([10, 30, 10]),
  warning: () => isNative ? Haptics.notification({ type: NotificationType.Warning }) : webBuzz([20, 40, 20]),
  error:   () => isNative ? Haptics.notification({ type: NotificationType.Error })   : webBuzz([40, 60, 40]),
};
