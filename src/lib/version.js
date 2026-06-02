// Single source of truth for the app version.
//
// Pulled directly from package.json so the value we ship to the App Store /
// Play Store (which mirrors package.json into capacitor.config.ts → iOS plist
// / Android manifest at build time) is the same value rendered in Settings,
// About, and What's New. Bump package.json on release; everything else
// updates for free.

import { version } from '../../package.json';

export const APP_VERSION = version;
