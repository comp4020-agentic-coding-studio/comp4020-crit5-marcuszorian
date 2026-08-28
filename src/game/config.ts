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
// Placeholder values. Steps 7 and 8 add the pickups these numbers are supposed
// to be balanced against, so nothing here has been tuned against real play yet;
// the ratio that matters is income against drain, and there is no income yet.
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

// ---------------------------------------------------------------------------
// Feel and teaching — owned by plan/03-feel-and-teaching.md
// ---------------------------------------------------------------------------

/**
 * How far the world scrolls before the first obstacle exists. Mario 1-1: the
 * threat has to walk at you from far enough away that you can work out the
 * answer before it arrives.
 */
export const FIRST_OBSTACLE_X = 1500;

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
