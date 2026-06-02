// ─── Wrestler Color Presets ──────────────────────────────────────────────────
// 12 singlet colors for visual customization. Each preset has a primary fill
// and a darker accent used for shading/depth on SVG body parts.

export const COLOR_PRESETS = [
  { id: 'emerald',  label: 'Emerald',  primary: '#34d399', dark: '#059669' },
  { id: 'crimson',  label: 'Crimson',  primary: '#f87171', dark: '#dc2626' },
  { id: 'blue',     label: 'Blue',     primary: '#60a5fa', dark: '#2563eb' },
  { id: 'gold',     label: 'Gold',     primary: '#fbbf24', dark: '#d97706' },
  { id: 'purple',   label: 'Purple',   primary: '#a78bfa', dark: '#7c3aed' },
  { id: 'orange',   label: 'Orange',   primary: '#fb923c', dark: '#ea580c' },
  { id: 'white',    label: 'White',    primary: '#e4e4e7', dark: '#a1a1aa' },
  { id: 'black',    label: 'Black',    primary: '#52525b', dark: '#27272a' },
  { id: 'teal',     label: 'Teal',     primary: '#2dd4bf', dark: '#0d9488' },
  { id: 'navy',     label: 'Navy',     primary: '#818cf8', dark: '#4338ca' },
  { id: 'silver',   label: 'Silver',   primary: '#d4d4d8', dark: '#71717a' },
  { id: 'pink',     label: 'Pink',     primary: '#f472b6', dark: '#db2777' },
];

/** Default colors per corner when no appearance is set */
const DEFAULT_P1 = { primary: '#34d399', dark: '#059669' }; // emerald
const DEFAULT_P2 = { primary: '#f87171', dark: '#dc2626' }; // crimson/red
const CB_P1 = { primary: '#38bdf8', dark: '#0284c7' }; // sky (colorblind)
const CB_P2 = { primary: '#fbbf24', dark: '#d97706' }; // amber (colorblind)

/**
 * Resolve wrestler colors from an appearance object.
 * @param {Object|null} appearance - { primaryColor: presetId }
 * @param {'p1'|'p2'} fallbackCorner - which corner default to use
 * @param {boolean} colorblind - use colorblind-safe defaults
 * @returns {{ primary: string, dark: string }}
 */
export function getWrestlerColors(appearance, fallbackCorner = 'p1', colorblind = false) {
  if (appearance?.primaryColor) {
    const preset = COLOR_PRESETS.find(c => c.id === appearance.primaryColor);
    if (preset) return { primary: preset.primary, dark: preset.dark };
  }
  if (colorblind) return fallbackCorner === 'p1' ? { ...CB_P1 } : { ...CB_P2 };
  return fallbackCorner === 'p1' ? { ...DEFAULT_P1 } : { ...DEFAULT_P2 };
}

/**
 * Pick a random color preset that avoids a given set of IDs.
 * Used for CPU opponents in tournament mode.
 */
export function getRandomColor(excludeIds = []) {
  const available = COLOR_PRESETS.filter(c => !excludeIds.includes(c.id));
  if (available.length === 0) return COLOR_PRESETS[Math.floor(Math.random() * COLOR_PRESETS.length)];
  return available[Math.floor(Math.random() * available.length)];
}

// ─── New singlet system helpers ──────────────────────────────────────────────
// The new system stores a richer `appearance.singlet` sub-object alongside
// the legacy `primaryColor`/`accentColor` fields. These helpers keep the
// two in sync so legacy renderers (MatchResultModal, TournamentBracket,
// careerBrackets, dualMeetTeams) keep working unchanged.

/**
 * Reverse-lookup: given a chest hex, find the preset id whose `primary`
 * matches exactly. Returns 'custom' if no preset matches. Used when the
 * new editor saves to keep `appearance.primaryColor` populated for legacy
 * callers that read it.
 */
export function chestColorToPresetId(hex) {
  if (typeof hex !== 'string') return 'custom';
  const lower = hex.toLowerCase();
  const match = COLOR_PRESETS.find(c => c.primary.toLowerCase() === lower);
  return match ? match.id : 'custom';
}

/**
 * Forward-lookup: preset id (or 'custom') -> { primary, dark } for the
 * new editor's initial chestColor when migrating a legacy profile.
 */
export function presetIdToColors(id) {
  const preset = COLOR_PRESETS.find(c => c.id === id);
  if (preset) return { primary: preset.primary, dark: preset.dark };
  return { primary: '#0a1f44', dark: '#072042' }; // navy fallback
}

/**
 * Build a default singlet object from a profile + wrestler context.
 * Auto-populates text fields from existing profile.team / profile.username /
 * profile.weight_class so a first-time editor isn't blank. Color zones
 * default to navy/white (Classic look).
 *
 * The returned object is ALWAYS a fresh shallow copy; safe to spread into
 * Firestore writes without aliasing.
 */
export function getDefaultSinglet(profile = {}) {
  const presetId = profile?.appearance?.primaryColor;
  const colors = presetIdToColors(presetId);
  return {
    chestColor:      presetId ? colors.primary : '#0a1f44',
    sidesColor:      '#ffffff',
    textColor:       '#ffffff',
    teamText:        typeof profile?.team === 'string' ? profile.team : '',
    lastNameText:    typeof profile?.username === 'string' ? profile.username : '',
    weightClassText: typeof profile?.weight_class === 'string' ? profile.weight_class : '',
  };
}
