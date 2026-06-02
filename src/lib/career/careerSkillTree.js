// ─── Career Mode - Skill Tree ────────────────────────────────────────────────
// 64 nodes across four branches. Each node unlocks 1-3 cards for the
// wrestler's permanent pool. Prereqs chain within a branch (no cross-
// branch prereqs) so each branch can be leveled to its tip in isolation.
//
// Cost accounting (design targets):
//   Total tree cost:   ~125 skill points to unlock every node
//   Career grants:     ~60 skill points over a full 12-yr arc
//   Expected outcome:  player unlocks ~half the tree per career
//
// Starter deck (26 cards) covers the absolute fundamentals. Everything
// else - advanced shots, turns, FHL chains, leg rides, throws, greco
// lifts, switch-chain escapes - must be bought here.
//
// Branch identities:
//   Scrambler - offensive flow, re-attack, angles
//   Rider     - top-position domination, turns, leg rides
//   Technician - throws, amplitude, FHL offense, greco
//   Gasser    - defensive neutrals, bottom escapes, conditioning

// ─── Node definitions ───────────────────────────────────────────────────────

export const SKILL_TREE_NODES = [
  // ═══ SCRAMBLER ══════════════════════════════════════════════════════════
  // Tier 1 - cost 1, no prereqs
  { id: 'scr_go_behind',      branch: 'scrambler', tier: 1, cost: 1, prereqs: [],
    label: 'Go-Behind',        description: 'When the shot gets cleared, circle behind instead of reshooting.',
    unlocks: ['go_behind'] },
  { id: 'scr_slide',          branch: 'scrambler', tier: 1, cost: 1, prereqs: [],
    label: 'Slide-By',         description: 'Angle through contact for a quick reversal of field.',
    unlocks: ['slide_by'] },
  { id: 'scr_drag',           branch: 'scrambler', tier: 1, cost: 1, prereqs: [],
    label: 'Drag-By',          description: 'Pull the elbow across, spin through the opening.',
    unlocks: ['drag_by'] },
  { id: 'scr_crossface',      branch: 'scrambler', tier: 1, cost: 1, prereqs: [],
    label: 'Crossface & Circle', description: 'Defensive footwork that resets at an angle.',
    unlocks: ['crossface_and_circle'] },
  { id: 'scr_hand_snap',      branch: 'scrambler', tier: 1, cost: 1, prereqs: [],
    label: 'Hand-Fight Snap',  description: 'Win the ties and snap down into the re-attack.',
    unlocks: ['hand_fight_snap'] },
  { id: 'scr_limp',           branch: 'scrambler', tier: 1, cost: 1, prereqs: [],
    label: 'Limp Leg',         description: 'Make the leg feel dead, reset the shot.',
    unlocks: ['limp_leg'] },

  // Tier 2 - cost 2, 1 Tier-1 prereq
  { id: 'scr_reattack_bottom', branch: 'scrambler', tier: 2, cost: 2, prereqs: ['scr_hand_snap'],
    label: 'Bottom Re-Attack', description: 'From bottom, shoot back at the legs the moment they give you space.',
    unlocks: ['re_shot_from_bottom', 'roll_through_attack'] },
  { id: 'scr_fhl_escape',      branch: 'scrambler', tier: 2, cost: 2, prereqs: ['scr_go_behind'],
    label: 'FHL Angles',       description: 'Use the front headlock as a platform to attack the back.',
    unlocks: ['fhl_go_behind', 'fhl_inside_step'] },
  { id: 'scr_drag_adv',        branch: 'scrambler', tier: 2, cost: 2, prereqs: ['scr_drag'],
    label: 'Shuck-By',         description: 'Throw the head and spin through.',
    unlocks: ['shuck_by'] },
  { id: 'scr_hand_reattack',   branch: 'scrambler', tier: 2, cost: 2, prereqs: ['scr_hand_snap'],
    label: 'Reattack Chain',   description: 'Turn every hand-fight into a shot setup.',
    unlocks: ['hand_fight_reattack'] },
  { id: 'scr_whizzer_hop',     branch: 'scrambler', tier: 2, cost: 2, prereqs: ['scr_crossface'],
    label: 'Whizzer & Hop',    description: 'Ride the whizzer into a counter-attack.',
    unlocks: ['whizzer_hop'] },
  { id: 'scr_fhl_snap_back',   branch: 'scrambler', tier: 2, cost: 2, prereqs: ['scr_slide'],
    label: 'FHL Snap-Back',    description: 'When they post, snap them into a re-attack.',
    unlocks: ['fhl_snap_back'] },

  // Tier 3 - cost 3, 2 Tier-2 prereqs
  { id: 'scr_scramble_1',  branch: 'scrambler', tier: 3, cost: 3, prereqs: ['scr_reattack_bottom', 'scr_hand_reattack'],
    label: 'Scramble Re-Attack', description: 'Win the chaos. When both wrestlers are out of position, get the next shot.',
    unlocks: ['scramble_reattack'] },
  { id: 'scr_scramble_2',  branch: 'scrambler', tier: 3, cost: 3, prereqs: ['scr_fhl_escape', 'scr_fhl_snap_back'],
    label: 'Come Out Top', description: 'In a scramble, end up on top of the pile.',
    unlocks: ['scramble_come_out_top'] },
  { id: 'scr_scramble_3',  branch: 'scrambler', tier: 3, cost: 3, prereqs: ['scr_drag_adv', 'scr_whizzer_hop'],
    label: 'Clear the Hips', description: 'Break the tie-up with a hip clear and reset clean.',
    unlocks: ['scramble_clear_hips'] },

  // ═══ RIDER ══════════════════════════════════════════════════════════════
  // Tier 1 - cost 1
  { id: 'rid_ankle',       branch: 'rider', tier: 1, cost: 1, prereqs: [],
    label: 'Ankle Ride',    description: 'Control the ankle, control the bottom wrestler.',
    unlocks: ['ankle_ride'] },
  { id: 'rid_pop',         branch: 'rider', tier: 1, cost: 1, prereqs: [],
    label: 'Pop Chop',      description: 'Snap the elbow down to flatten the base.',
    unlocks: ['pop_chop'] },
  { id: 'rid_mat',         branch: 'rider', tier: 1, cost: 1, prereqs: [],
    label: 'Mat Return',    description: 'When they stand, drag them back down to the mat.',
    unlocks: ['mat_return'] },
  { id: 'rid_claw',        branch: 'rider', tier: 1, cost: 1, prereqs: [],
    label: 'Claw Ride',     description: 'Grip the wrist hard, control the upper body.',
    unlocks: ['claw_ride'] },
  { id: 'rid_cross_wrist', branch: 'rider', tier: 1, cost: 1, prereqs: [],
    label: 'Cross Wrist',   description: 'Trap the wrist across the body to kill movement.',
    unlocks: ['cross_wrist_ride'] },
  { id: 'rid_pressure',    branch: 'rider', tier: 1, cost: 1, prereqs: [],
    label: 'Crossface Pressure', description: 'Wear them out with consistent crossface pressure.',
    unlocks: ['cross_face_pressure'] },

  // Tier 2 - cost 2
  { id: 'rid_chop_drive',  branch: 'rider', tier: 2, cost: 2, prereqs: ['rid_pop'],
    label: 'Chop & Drive',  description: 'Break the base and drive them belly-down.',
    unlocks: ['chop_and_drive'] },
  { id: 'rid_gut',         branch: 'rider', tier: 2, cost: 2, prereqs: ['rid_pressure'],
    label: 'Gut Wrench',    description: 'Classic par-terre turn - lock the waist and roll.',
    unlocks: ['gut_wrench'] },
  { id: 'rid_step_over',   branch: 'rider', tier: 2, cost: 2, prereqs: ['rid_ankle'],
    label: 'Step-Over',     description: 'Step over the leg to expose the back.',
    unlocks: ['step_over'] },
  { id: 'rid_power_half',  branch: 'rider', tier: 2, cost: 2, prereqs: ['rid_mat'],
    label: 'Power Half',    description: 'The king of scholastic turns.',
    unlocks: ['power_half'] },
  { id: 'rid_arm_turk',    branch: 'rider', tier: 2, cost: 2, prereqs: ['rid_claw'],
    label: 'Arm Turk',      description: 'Trap the arm and turn for back points.',
    unlocks: ['arm_turk'] },
  { id: 'rid_leg_turk',    branch: 'rider', tier: 2, cost: 2, prereqs: ['rid_cross_wrist'],
    label: 'Leg Turk',      description: 'Hook the leg and turn.',
    unlocks: ['leg_turk'] },

  // Tier 3 - cost 3
  { id: 'rid_leg_lace',    branch: 'rider', tier: 3, cost: 3, prereqs: ['rid_gut'],
    label: 'Leg Lace',      description: 'Par-terre lace - control the legs, rack up exposures.',
    unlocks: ['leg_lace'] },
  { id: 'rid_cf_cradle',   branch: 'rider', tier: 3, cost: 3, prereqs: ['rid_power_half'],
    label: 'Crossface Cradle', description: 'Tight cradle finish off the power half.',
    unlocks: ['crossface_cradle'] },
  { id: 'rid_leg_cradle',  branch: 'rider', tier: 3, cost: 3, prereqs: ['rid_arm_turk'],
    label: 'Leg Cradle',    description: 'Scoop the leg and trap the head.',
    unlocks: ['leg_cradle'] },
  { id: 'rid_tight_chop',  branch: 'rider', tier: 3, cost: 3, prereqs: ['rid_chop_drive'],
    label: 'Tight Waist Series', description: 'Dominant waist control with wrist variation.',
    unlocks: ['tight_waist_chop', 'wrist_ride'] },
  { id: 'rid_chicken_wing', branch: 'rider', tier: 3, cost: 3, prereqs: ['rid_leg_turk'],
    label: 'Chicken Wing',  description: 'Trap the arm behind the back, drive for the turn.',
    unlocks: ['chicken_wing', 'double_arm_bar'] },
  { id: 'rid_peterson',    branch: 'rider', tier: 3, cost: 3, prereqs: ['rid_step_over'],
    label: 'Peterson Roll', description: 'Classic rolling counter.',
    unlocks: ['peterson_roll', 'wing_roll'] },

  // Tier 4 - cost 3, 2 Tier-3 prereqs
  { id: 'rid_leg_rides',   branch: 'rider', tier: 4, cost: 3, prereqs: ['rid_leg_lace', 'rid_leg_cradle'],
    label: 'Leg Rides',     description: 'The most oppressive ride in wrestling. Once you get in, they fade.',
    unlocks: ['get_legs_in', 'grapevine_power_half', 'leg_ride_power_half'] },
  { id: 'rid_cross_body',  branch: 'rider', tier: 4, cost: 3, prereqs: ['rid_peterson', 'rid_tight_chop'],
    label: 'Cross-Body Ride', description: 'The Saturday Night ride - lock and break.',
    unlocks: ['cross_body_ride', 'saturday_night_ride'] },
  { id: 'rid_banana',      branch: 'rider', tier: 4, cost: 3, prereqs: ['rid_cf_cradle', 'rid_chicken_wing'],
    label: 'Banana Split',  description: 'Brutal leg-split pin. Not for the squeamish.',
    unlocks: ['banana_split', 'spladle'] },
  { id: 'rid_navy',        branch: 'rider', tier: 4, cost: 3, prereqs: ['rid_leg_rides'],
    label: 'Navy Ride',     description: 'Locked-in top ride - no offense, just control.',
    unlocks: ['navy_ride'] },

  // ═══ TECHNICIAN ═════════════════════════════════════════════════════════
  // Tier 1 - cost 1
  { id: 'tec_high_crotch', branch: 'technician', tier: 1, cost: 1, prereqs: [],
    label: 'High Crotch',   description: 'Classic shot that sets up the sweep.',
    unlocks: ['high_crotch'] },
  { id: 'tec_sweep',       branch: 'technician', tier: 1, cost: 1, prereqs: [],
    label: 'Sweep Single',  description: 'Catch the leg, sweep the corner, finish clean.',
    unlocks: ['sweep_single'] },
  { id: 'tec_fireman',     branch: 'technician', tier: 1, cost: 1, prereqs: [],
    label: "Fireman's Carry", description: 'Explosive shoulder-carry takedown.',
    unlocks: ['fireman_carry'] },
  { id: 'tec_run_pipe',    branch: 'technician', tier: 1, cost: 1, prereqs: [],
    label: 'Run the Pipe',  description: 'Drive the single leg straight through to the mat.',
    unlocks: ['run_the_pipe'] },
  { id: 'tec_fhl_knee',    branch: 'technician', tier: 1, cost: 1, prereqs: [],
    label: 'FHL Knee Tap',  description: 'From front headlock, tap the knee and drive.',
    unlocks: ['fhl_knee_tap'] },

  // Tier 2 - cost 2
  { id: 'tec_elevate',     branch: 'technician', tier: 2, cost: 2, prereqs: ['tec_sweep'],
    label: 'Elevate & Trip', description: 'Lift and trip - a finish that works even when they sprawl.',
    unlocks: ['elevate_and_trip', 'mat_return_from_leg'] },
  { id: 'tec_pummel',      branch: 'technician', tier: 2, cost: 2, prereqs: ['tec_fireman'],
    label: 'Pummel Inside', description: 'Win the underhook battle, set up throws.',
    unlocks: ['pummel_inside', 'arm_throw'] },
  { id: 'tec_rear_series', branch: 'technician', tier: 2, cost: 2, prereqs: ['tec_run_pipe'],
    label: 'Rear Takedowns', description: 'Get behind, choose your finish: lift, trip, or return to mat.',
    unlocks: ['rear_lift', 'rear_mat_return', 'rear_trip'] },
  { id: 'tec_fhl_throw',   branch: 'technician', tier: 2, cost: 2, prereqs: ['tec_fhl_knee'],
    label: 'FHL Throws',    description: 'Whipover and snap-spin off the front headlock.',
    unlocks: ['fhl_whipover', 'fhl_snap_spin'] },
  { id: 'tec_fhl_cement',  branch: 'technician', tier: 2, cost: 2, prereqs: ['tec_fhl_knee'],
    label: 'FHL Finishers', description: 'Cement mixer + body dump - the high-amplitude FHL kit.',
    unlocks: ['fhl_cement_mixer', 'fhl_body_dump'] },
  { id: 'tec_bridge',      branch: 'technician', tier: 2, cost: 2, prereqs: ['tec_high_crotch'],
    label: 'Bridge Defense', description: 'When they throw, bridge out - or bridge and reverse.',
    unlocks: ['bridge_defense'] },

  // Tier 3 - cost 3
  { id: 'tec_suplex',      branch: 'technician', tier: 3, cost: 3, prereqs: ['tec_pummel'],
    label: 'Suplex & Lateral Drop', description: 'Two classic 5-point throws.',
    unlocks: ['suplex', 'lateral_drop'] },
  { id: 'tec_headlock',    branch: 'technician', tier: 3, cost: 3, prereqs: ['tec_elevate'],
    label: 'Headlock Throws', description: 'When they commit to the tie-up, throw them.',
    unlocks: ['headlock_throw', 'arm_drag_to_gut_wrench'] },
  { id: 'tec_fhl_gator',   branch: 'technician', tier: 3, cost: 3, prereqs: ['tec_fhl_throw'],
    label: 'Gator Roll',    description: 'Finishing roll from the front headlock - nearly unescapable.',
    unlocks: ['fhl_gator_roll'] },

  // Tier 4 - cost 3, 2 Tier-3 prereqs
  { id: 'tec_greco_lift',  branch: 'technician', tier: 4, cost: 3, prereqs: ['tec_suplex', 'tec_headlock'],
    label: 'Greco Lifts',   description: 'Bear hug lift, reverse lift - the biggest points in the sport.',
    unlocks: ['bear_hug_lift', 'reverse_lift'] },

  // ═══ GASSER ═════════════════════════════════════════════════════════════
  // Tier 1 - cost 1
  { id: 'gas_down_block',  branch: 'gasser', tier: 1, cost: 1, prereqs: [],
    label: 'Down Block',    description: 'Shut down the shot before it gets to your legs.',
    unlocks: ['down_block'] },
  { id: 'gas_stuff',       branch: 'gasser', tier: 1, cost: 1, prereqs: [],
    label: 'Stuff the Head', description: 'Cram their head to the mat, deny penetration.',
    unlocks: ['stuff_head'] },
  { id: 'gas_collar',      branch: 'gasser', tier: 1, cost: 1, prereqs: [],
    label: 'Collar Tie',    description: 'Own the inside collar tie, control the pace.',
    unlocks: ['collar_tie'] },
  { id: 'gas_underhook',   branch: 'gasser', tier: 1, cost: 1, prereqs: [],
    label: 'Underhook Control', description: 'Get the underhook, make them react.',
    unlocks: ['underhook_control'] },
  { id: 'gas_tripod',      branch: 'gasser', tier: 1, cost: 1, prereqs: [],
    label: 'Tripod Stand',  description: 'Base up hard when they break you down.',
    unlocks: ['tripod_stand'] },

  // Tier 2 - cost 2
  { id: 'gas_hand_escape', branch: 'gasser', tier: 2, cost: 2, prereqs: ['gas_tripod'],
    label: 'Hand Control Escape', description: 'Peel their hands off before you move.',
    unlocks: ['hand_control_escape'] },
  { id: 'gas_belly',       branch: 'gasser', tier: 2, cost: 2, prereqs: ['gas_tripod'],
    label: 'Belly Down',    description: 'Deny back exposure when the turn is coming.',
    unlocks: ['belly_down'] },
  { id: 'gas_cross_body_def', branch: 'gasser', tier: 2, cost: 2, prereqs: ['gas_down_block'],
    label: 'Cross-Body Defense', description: 'When they lock cross-body, unlock it.',
    unlocks: ['cross_body_defense'] },
  { id: 'gas_inside_trip', branch: 'gasser', tier: 2, cost: 2, prereqs: ['gas_collar'],
    label: 'Inside Trip',   description: 'Hook the near leg and dump them.',
    unlocks: ['inside_trip'] },
  { id: 'gas_outside_roll', branch: 'gasser', tier: 2, cost: 2, prereqs: ['gas_underhook'],
    label: 'Outside Roll',  description: 'Roll through the underhook, come up on top.',
    unlocks: ['outside_roll'] },

  // Tier 3 - cost 3
  { id: 'gas_switch_fam',  branch: 'gasser', tier: 3, cost: 3, prereqs: ['gas_hand_escape'],
    label: 'Switch Family', description: 'The classic folkstyle switch in all its variations.',
    unlocks: ['fake_switch_to_granby', 'granby_to_peterson', 'sit_out_turn_in'] },
  { id: 'gas_escape_fam',  branch: 'gasser', tier: 3, cost: 3, prereqs: ['gas_belly'],
    label: 'Escape Chain',  description: 'Short offense switches - when the clock is running and you need to get out.',
    unlocks: ['short_offense_switch', 'reverse_switch'] },
];

// ─── Read helpers ───────────────────────────────────────────────────────────

const NODES_BY_ID = Object.fromEntries(SKILL_TREE_NODES.map(n => [n.id, n]));
const NODES_BY_BRANCH = SKILL_TREE_NODES.reduce((acc, n) => {
  (acc[n.branch] = acc[n.branch] || []).push(n);
  return acc;
}, {});

export const BRANCHES = ['scrambler', 'rider', 'technician', 'gasser'];

export function getNode(id) {
  return NODES_BY_ID[id] || null;
}

export function getNodesByBranch(branch) {
  return NODES_BY_BRANCH[branch] || [];
}

export function isNodeUnlocked(wrestler, nodeId) {
  return !!wrestler?.skillTree?.unlockedNodes?.includes(nodeId);
}

/**
 * Can this wrestler purchase this node right now? Checks: node exists,
 * not already unlocked, can afford cost, prereqs satisfied.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canUnlockNode(wrestler, nodeId) {
  const node = getNode(nodeId);
  if (!node) return { ok: false, reason: 'unknown_node' };
  if (isNodeUnlocked(wrestler, nodeId)) return { ok: false, reason: 'already_unlocked' };
  const available = wrestler?.skillTree?.pointsAvailable || 0;
  if (available < node.cost) return { ok: false, reason: 'not_enough_points' };
  const unlocked = wrestler?.skillTree?.unlockedNodes || [];
  for (const req of node.prereqs) {
    if (!unlocked.includes(req)) return { ok: false, reason: 'prereq_missing' };
  }
  return { ok: true };
}

/**
 * Attempt to unlock a node. Returns { ok, wrestler, reason? }.
 * On success, returns a NEW wrestler object with:
 *   - skillTree.pointsAvailable decremented by node.cost
 *   - skillTree.unlockedNodes appended with nodeId
 *   - unlockedCardIds extended with node.unlocks (dedup'd)
 * On failure, returns the original wrestler unchanged.
 */
export function tryUnlockNode(wrestler, nodeId) {
  const check = canUnlockNode(wrestler, nodeId);
  if (!check.ok) return { ok: false, wrestler, reason: check.reason };

  const node = getNode(nodeId);
  const skillTree = wrestler.skillTree;
  const existingCards = wrestler.unlockedCardIds || [];
  const cardSet = new Set(existingCards);
  for (const cid of node.unlocks || []) cardSet.add(cid);

  return {
    ok: true,
    wrestler: {
      ...wrestler,
      skillTree: {
        ...skillTree,
        pointsAvailable: skillTree.pointsAvailable - node.cost,
        unlockedNodes: [...skillTree.unlockedNodes, nodeId],
      },
      unlockedCardIds: [...cardSet],
    },
  };
}

// ─── Stats / diagnostics ────────────────────────────────────────────────────

export function totalTreeCost() {
  return SKILL_TREE_NODES.reduce((sum, n) => sum + n.cost, 0);
}

export function totalUnlockableCards() {
  const s = new Set();
  for (const n of SKILL_TREE_NODES) for (const c of n.unlocks || []) s.add(c);
  return s.size;
}
