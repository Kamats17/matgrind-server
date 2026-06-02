// src/lib/cardCategoryTheme.js
//
// Single source of truth for move-category colors, short labels, and icon
// glyphs. Every surface that renders a card (RadialCardPicker, CardHand,
// CardDetailSheet, TakedownPickerDrill, MatchResult breakdown) should
// import from here so palette edits roll out app-wide.
//
// Why a shared file: before this, category colors were duplicated in
// RadialCardPicker.jsx and CardHand.jsx with subtly different hex values
// (e.g. the radial used `#a855f7` for "special" while CardHand used
// `#c084fc`). Those drifts accumulate until the scoreboard, picker, and
// result modal don't match. Centralizing fixes that and makes the
// "what does this color mean?" legend trivially accurate.
//
// The palette is chosen so each category is visually distinct on an OLED
// dark background and also readable when desaturated (colorblind mode):
//
//   neutral_attack   - 🔥 Attack    - orange   : aggression / offense
//   neutral_counter  - 🛡 Counter   - sky      : reactive / defensive
//   par_terre_top    - ⚙ Ride      - amber    : dominance / grinding
//   top_turns        - ⚡ Turn      - emerald  : scoring turns / tilts
//   bottom           - ↗ Escape    - violet   : scrappy bottom wrestling
//   throw            - 💥 Throw     - red      : big-amplitude risk/reward
//   transition       - ↻ Transition - lime     : position-shift glue
//   special          - ✦ Special    - fuchsia  : reserved for future cards
//
// Every entry carries:
//   color     - primary hex for borders, fills, glows
//   soft      - a 10%-alpha version for chip backgrounds
//   label     - short 1-word tag for card footers and legends
//   icon      - compact glyph for card-footer badge (fits in 10px font)
//   textClass - Tailwind class for on-dark surfaces (used in result modal)
//
// Colors pass WCAG AA against zinc-950 background at the given shades.

export const CATEGORY_THEME = {
  neutral_attack: {
    color:     '#f97316', // orange-500
    soft:      'rgba(249,115,22,0.14)',
    label:     'Attack',
    icon:      '🔥',
    textClass: 'text-orange-400',
  },
  neutral_counter: {
    color:     '#0ea5e9', // sky-500
    soft:      'rgba(14,165,233,0.14)',
    label:     'Counter',
    icon:      '🛡',
    textClass: 'text-sky-400',
  },
  par_terre_top: {
    color:     '#f59e0b', // amber-500
    soft:      'rgba(245,158,11,0.14)',
    label:     'Ride',
    icon:      '⚙',
    textClass: 'text-amber-400',
  },
  top_turns: {
    color:     '#10b981', // emerald-500
    soft:      'rgba(16,185,129,0.14)',
    label:     'Turn',
    icon:      '⚡',
    textClass: 'text-emerald-400',
  },
  bottom: {
    color:     '#a855f7', // purple-500
    soft:      'rgba(168,85,247,0.14)',
    label:     'Escape',
    icon:      '↗',
    textClass: 'text-purple-400',
  },
  throw: {
    color:     '#ef4444', // red-500
    soft:      'rgba(239,68,68,0.14)',
    label:     'Throw',
    icon:      '💥',
    textClass: 'text-red-400',
  },
  transition: {
    // Color history:
    //   yellow-500  (#eab308) - collided with amber-500 (Ride)
    //   cyan-500    (#06b6d4) - collided with sky-500   (Counter)
    //   indigo-500  (#6366f1) - still read as blue, too close to sky
    //   lime-500    (#84cc16) - current. Yellow-green, completely outside
    //     the blue band. Hue ~85 vs emerald (Turn) at ~160 - 75 degrees of
    //     separation, which is more than enough to distinguish at a glance.
    color:     '#84cc16', // lime-500
    soft:      'rgba(132,204,22,0.14)',
    label:     'Transition',
    icon:      '↻',
    textClass: 'text-lime-400',
  },
  // Reserved for any future card that doesn't fit above. Won't hit today,
  // but keeps the fallback visually distinct rather than the old gray.
  special: {
    color:     '#d946ef', // fuchsia-500
    soft:      'rgba(217,70,239,0.14)',
    label:     'Special',
    icon:      '✦',
    textClass: 'text-fuchsia-400',
  },
};

const FALLBACK = {
  color:     '#71717a', // zinc-500
  soft:      'rgba(113,113,122,0.14)',
  label:     'Move',
  icon:      '·',
  textClass: 'text-zinc-400',
};

export function getCategoryTheme(category) {
  return CATEGORY_THEME[category] || FALLBACK;
}

// Convenience - the legend list in the order that reads "offense first,
// defense next, ground/exotic last" for anywhere that wants a UI legend.
export const CATEGORY_ORDER = [
  'neutral_attack',
  'neutral_counter',
  'throw',
  'par_terre_top',
  'top_turns',
  'bottom',
  'transition',
];
