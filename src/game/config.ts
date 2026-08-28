// Every tuning knob in the game, in one file, because tuning is the work that
// happens most often. Nothing here imports anything: config is a leaf, so
// `rules.ts` can stay pure and `main.ts` can read the same numbers the
// simulation does without a second source of truth.
//
// Sections are labelled with the plan file that owns them. The split is a
// documentation convention only — the file stays physical-one so a balance pass
// is a single file open.

// ---------------------------------------------------------------------------
// World and physics — owned by plan/01-core-loop.md
// ---------------------------------------------------------------------------

/**
 * The world is always this many units wide, at every viewport. `rules.ts` never
 * learns the viewport exists; `main.ts` owns the units-to-pixels transform.
 */
export const WORLD_W = 1000;

/** Downward acceleration, world units per second squared. Negative is down. */
export const GRAVITY = -2600;

/** Upward velocity applied on a jump, world units per second. */
export const JUMP_V = 900;

/** The runner's fixed horizontal position. The world scrolls past it. */
export const RUNNER_X = 150;

export const RUNNER_W = 34;
export const RUNNER_H = 52;

export const OBSTACLE_W = 26;
export const OBSTACLE_H = 54;

/**
 * How close to the ground counts as standing on it. Floating-point integration
 * will not land exactly on zero, and a runner that is 1e-13 above the ground
 * must still be allowed to jump.
 */
export const GROUND_EPS = 1e-6;

// ---------------------------------------------------------------------------
// Economy — owned by plan/02-economy-and-pickups.md
//
// Set from the rate model, not yet from play. Speed cancels out of the income
// and drain rates alike (both scale with it), so the only dial that matters is
// income per world unit against `DRAIN`, weighted by how much a player actually
// collects. Target: collecting nearly all of it is net positive, collecting
// ~70% is net negative, so the bar always matters and skill is what keeps you
// alive.
//
// Income per world unit at full collection, measured off the spawner over
// 3.6M units of track rather than estimated:
//
//   ground  4.06 per 1000 units  x   60  =  0.244
//   high    0.85 per 1000 units  x  140  =  0.119
//   power   0.06 per 1000 units  x 1000  =  0.064
//                                           -----
//                                           0.427   vs DRAIN 0.35
//
// A clean run therefore gains ~0.08 per unit and a 70% run loses ~0.05, which
// is the window the design wants. Only playing settles whether it *feels* like
// that window — step 13 is where these move.
//
// The ground-token count is measured, not derived from the spacing above:
// tokens that would land against an obstacle are dropped, which costs about a
// fifth of them. `TOKEN_VALUE` was raised from 50 to 60 to pay that back.
// ---------------------------------------------------------------------------

/** The starting ceiling. Only pickups raise it. */
export const START_BUDGET = 3000;

/** Tokens burned per world unit travelled. `used` is also the score. */
export const DRAIN = 0.35;

/** `speedFor` coefficients: speed is a monotonic function of budget alone. */
export const SPEED_BASE = 230;
export const SPEED_PER_BUDGET = 0.023;

/** Distance between consecutive obstacles, sampled uniformly from this range. */
export const SPAWN_GAP_MIN = 400;
export const SPAWN_GAP_MAX = 780;

// --- pickups ---------------------------------------------------------------
//
// Two heights, one button. Ground tokens are collected by running through them;
// high tokens need a jump and are worth more, which makes the jump both the
// avoid verb and the collect verb. Heights are stated as the pickup's lower
// edge, in world units above the ground line.

/** Ground tokens sit at chest height: free while running, missed while airborne. */
export const TOKEN_Y = 22;
export const TOKEN_W = 22;
export const TOKEN_H = 22;
export const TOKEN_VALUE = 60;

/**
 * High tokens sit near the top of a jump. Standing, the runner's head reaches
 * `RUNNER_H` (52), so anything above that is unreachable; the jump apex is
 * `JUMP_V^2 / 2|GRAVITY|` ≈ 156, putting the runner's head at ~208. 150 is
 * therefore comfortably in the air and impossible on the ground.
 */
export const HIGH_TOKEN_Y = 150;
export const HIGH_TOKEN_W = 26;
export const HIGH_TOKEN_H = 26;
export const HIGH_TOKEN_VALUE = 140;

/** How far past an obstacle's far edge its high token hangs. */
export const HIGH_TOKEN_LEAD = 46;

/** Chance an obstacle (after the first) carries a high token just past it. */
export const HIGH_TOKEN_CHANCE = 0.5;

/** Ground tokens arrive in runs of this many, evenly spaced. */
export const TOKEN_RUN_MIN = 3;
export const TOKEN_RUN_MAX = 6;
export const TOKEN_SPACING = 46;

/** Clear track between the end of one run of ground tokens and the next. */
export const TOKEN_GAP_MIN = 520;
export const TOKEN_GAP_MAX = 900;

/** A token's own width of clearance around an obstacle, so none is unreachable. */
export const TOKEN_CLEARANCE = 40;

// --- the power-up ----------------------------------------------------------

/**
 * Deliberately generous, and taller than the icon `main.ts` draws inside it:
 * the power-up is rare, so running into one and missing it because you happened
 * to be mid-hop is the worst thing it could do. The box catches a runner on the
 * ground or in a small jump; only a committed jump goes over the top of it.
 */
export const POWER_Y = 6;
export const POWER_W = 30;
export const POWER_H = 54;

/** Milliseconds of invincibility. The only genuinely new state in the game. */
export const INVULN_MS = 4000;

/**
 * Budget granted on pickup. Because speed is a function of budget, this *is*
 * the speed increase — the boost feeds the existing rule rather than adding a
 * new one. A few seconds of immunity bought with a permanently faster game.
 */
export const BOOST = 1000;

/** Rare: one power-up every ~40–65 seconds at early-run speeds. */
export const POWER_GAP_MIN = 12000;
export const POWER_GAP_MAX = 20000;

// ---------------------------------------------------------------------------
// Feel and teaching — owned by plan/03-feel-and-teaching.md
// ---------------------------------------------------------------------------

/**
 * How far the world scrolls before the first obstacle exists. Mario 1-1: the
 * threat has to walk at you from far enough away that you can work out the
 * answer before it arrives.
 */
export const FIRST_OBSTACLE_X = 1500;

/**
 * The first run of ground tokens, well before the first obstacle, directly in
 * the runner's path. It is collected by accident, and the bar jumps — "these
 * are good" is taught before anything punishes you.
 */
export const FIRST_TOKEN_X = 420;

/** Far enough in that the power-up is never the first thing you meet. */
export const FIRST_POWER_X = 6500;

/** Remaining headroom at which the budget bar reads full, and pins. */
export const BAR_CAP = 3000;

/** Fractions of `BAR_CAP` at which the bar changes colour. */
export const BAR_WARN = 0.45;
export const BAR_CRIT = 0.18;

/** Milliseconds per caret blink phase, while idle. */
export const CARET_BLINK_MS = 450;

/** How fast the ground drifts before the run starts, world units per second. */
export const IDLE_SCROLL = 55;

// ---------------------------------------------------------------------------
// Presentation — owned by plan/04-presentation.md
//
// Placeholders. Step 5 makes the canvas responsive across both marking
// viewports and steps 9–12 do the rest; these are only what step 4 needs to
// draw anything at all.
// ---------------------------------------------------------------------------

/** Where the ground line sits, as a fraction of the visible world height. */
export const GROUND_FRACTION = 0.8;

/** Spacing of the ground's dashes, world units. */
export const GROUND_DASH = 26;
