// --- Career Weight Classes -------------------------------------------------
// Per-tier weight tables. HS follows NFHS (lbs), college follows NCAA (lbs),
// senior follows UWW (kg). Career Phase A only uses HS; college/senior tables
// live here so Phase C can extend without a second source of truth.
//
// Each entry is a weight in lbs (HS/college) or kg (senior) - pure numbers so
// tournament engines can use them without unit parsing. `label` helpers format
// for display.
//
// Women's wrestling has its own weight class tables at every tier:
//  - HS:     NFHS Girls Wrestling (separate girls weight classes since 2023-24)
//            14-class option used here.
//  - College: NCAA Women's Wrestling (effective 2024-25; NCAA's 91st
//             championship sport since Jan 2025; first championship Mar 2026).
//  - Senior:  UWW Senior Women's (10 classes) and Olympic Women's (6 classes,
//             same range as senior, used as the canonical Olympic roster).

export const HS_WEIGHTS = [106, 113, 120, 126, 132, 138, 145, 152, 160, 170, 182, 195, 220, 285];
export const COLLEGE_WEIGHTS = [125, 133, 141, 149, 157, 165, 174, 184, 197, 285];
export const SENIOR_FREESTYLE_KG = [57, 61, 65, 70, 74, 79, 86, 92, 97, 125];
export const SENIOR_GRECO_KG = [55, 60, 63, 67, 72, 77, 82, 87, 97, 130];

// Women's wrestling weight classes
export const WOMENS_HS_WEIGHTS = [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 155, 170, 190, 235];
export const WOMENS_COLLEGE_WEIGHTS = [103, 110, 117, 124, 131, 138, 145, 160, 180, 207];
export const WOMENS_SENIOR_KG = [50, 53, 55, 57, 59, 62, 65, 68, 72, 76];

export function isWomensStyleId(style) {
  return style === 'womens_freestyle';
}

// Returns the weight table for a given tier.
//
// HS/college: gender selects the table (girls' or boys'). Style is irrelevant
// at these tiers because both genders wrestle their respective scholastic
// rules (NFHS folkstyle for boys; NFHS Girls for girls).
//
// Senior: style selects the table (freestyle, greco, womens_freestyle). For
// male senior wrestlers wrestling BOTH freestyle and greco events in the
// same career, callers must pass the event's style explicitly per lookup -
// this function returns one table at a time.
//
// Note: gender wins over style at HS/college (R6 mitigation). A male wrestler
// asking for the 'womens_freestyle' senior table by style still gets it,
// because style at senior IS the table. But a 'female' gender at HS never
// gets boys' weights even if some upstream caller passed `style: 'folkstyle'`.
export function getWeightsForTier(tier, style = 'folkstyle', gender = 'male') {
  const isFemale = gender === 'female';
  if (tier === 'hs') return isFemale ? WOMENS_HS_WEIGHTS : HS_WEIGHTS;
  if (tier === 'college') return isFemale ? WOMENS_COLLEGE_WEIGHTS : COLLEGE_WEIGHTS;
  if (tier === 'senior') {
    if (isWomensStyleId(style)) return WOMENS_SENIOR_KG;
    return style === 'greco' ? SENIOR_GRECO_KG : SENIOR_FREESTYLE_KG;
  }
  return isFemale ? WOMENS_HS_WEIGHTS : HS_WEIGHTS;
}

export function formatWeight(weight, tier) {
  if (tier === 'senior') return `${weight} kg`;
  return `${weight} lbs`;
}

// Human-readable label for an internal style id. Use anywhere the raw
// id (e.g. 'womens_freestyle') was leaking into UI copy.
export function formatStyle(style) {
  switch (style) {
    case 'folkstyle':         return 'Folkstyle';
    case 'freestyle':         return 'Freestyle';
    case 'greco':             return 'Greco-Roman';
    case 'womens_freestyle':  return "Women's Freestyle";
    default:                  return style || 'Folkstyle';
  }
}

// Human-readable label for a wrestling win method. Match-engine ids are
// snake_case and were leaking directly into result screens / tooltips
// ("Won by tech_fall"). Use everywhere a winMethod string is rendered to
// the player.
export function formatWinMethod(method) {
  switch (method) {
    case 'pin':             return 'Pin';
    case 'tech_fall':
    case 'tech':            return 'Tech Fall';
    case 'major':
    case 'major_decision':  return 'Major Decision';
    case 'decision':        return 'Decision';
    case 'overtime':        return 'Overtime';
    case 'draw':            return 'Draw';
    case 'forfeit':         return 'Forfeit';
    case 'dq':              return 'DQ';
    case 'champion':        return 'Champion';
    default:                return method ? String(method).replace(/_/g, ' ') : 'Decision';
  }
}

// Human-readable label for an event stakes id. Used on the career
// dashboard, event preview, and trophy case. Snake_case ids
// ('us_open', 'conference_d1', 'world_trials') were rendering verbatim
// in copy like "us_open stakes".
export function formatStakes(stakes) {
  switch (stakes) {
    case 'regular':            return 'Regular';
    case 'invitational':       return 'Invitational';
    case 'conference':         return 'Conference';
    case 'conference_d1':      return 'Conference (D1)';
    case 'district':           return 'District Qualifier'; // v9: HS postseason intermediate
    case 'regional':           return 'Regional';
    case 'state':              return 'State';
    case 'ncaa':               return 'NCAA';
    case 'open':               return 'Open';
    case 'us_open':            return 'US Open';
    case 'world_trials':       return 'World Team Trials';
    case 'olympic_trials':     return 'Olympic Trials';
    case 'world_championship': return 'World Championship';
    case 'olympics':           return 'Olympics';
    default:                   return stakes ? String(stakes).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
  }
}

// Find the nearest valid weight class when transitioning tiers (e.g., HS 145
// -> nearest college 141 or 149). Snaps down when ties (wrestlers typically
// cut rather than move up immediately on transition).
//
// Cross-unit transitions (lbs -> senior kg) convert input lbs to kg before
// snapping so 149 lbs lands at UWW 65/70 kg, not 125 kg.
const LBS_PER_KG = 2.2046226218;
export function snapToValidWeight(weight, tier, style = 'folkstyle', gender = 'male') {
  const weights = getWeightsForTier(tier, style, gender);
  // Heuristic for unit detection: senior tier is in kg, hs/college is in lbs.
  // If `weight` looks like it's in lbs (>= 100, since UWW maxes at 130 kg
  // but real lbs always start >= 106), and target tier is senior, convert.
  let target = weight;
  if (tier === 'senior' && weight >= 100) {
    target = weight / LBS_PER_KG;
  } else if (tier !== 'senior' && weight < 100) {
    // Reverse: a senior-kg weight transitioning down to college-lbs.
    target = weight * LBS_PER_KG;
  }
  if (weights.includes(target)) return target;
  let best = weights[0];
  let bestDiff = Math.abs(target - best);
  for (const w of weights) {
    const d = Math.abs(target - w);
    if (d < bestDiff || (d === bestDiff && w < best)) {
      best = w;
      bestDiff = d;
    }
  }
  return best;
}
