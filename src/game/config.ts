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

/**
 * The runner's collision box — and, exactly, the size of the sprite drawn in
 * it. `src/game/sprite.ts` is the Claude Code character at one world unit per
 * source pixel, so these two numbers are the character's own dimensions rather
 * than round ones, and `spec/game.test.ts` asserts the art still fills the box.
 *
 * It used to be a 34x52 bar. Adopting the character's proportions made the
 * runner 53% wider and slightly shorter, which is a balance change and not just
 * an art one: the runner now spends (OBSTACLE_W + RUNNER_W) / speed alongside
 * each obstacle instead of a third less, so the window of press times that
 * clears one narrows from ~380ms to ~320ms at the starting speed. Still a wide
 * window, and the game is meant to get harder — but that is the number to watch
 * if it ever stops feeling fair.
 */
export const RUNNER_W = 52;
export const RUNNER_H = 45;

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
// Two quantities, not one. `tokens` is the pool the bar draws and the run dies
// on; `budget` is the ceiling on that pool, and the sole input to speed. What
// separates them is which pickups touch which:
//
//   ground token   free — you run through it          pool only
//   high token     costs a jump, the only way to die   ceiling only
//   power-up       rare                                fills the pool, raises
//                                                      the ceiling, + shield
//
// The first two are *exclusive*, and that is the point: one pickup keeps you
// alive, a different one makes the game harder, and the second is the one you
// have to leave the ground for. Ground tokens used to raise the ceiling too,
// which meant the run accelerated on its own just by being played cleanly and
// the jump was only ever an avoid verb with a bonus attached.
//
// Making them exclusive costs something, and the cost has to be paid here.
// Capacity you cannot fill is worth nothing — so if ground tokens alone do not
// out-earn `DRAIN`, the pool can never reach the ceiling, and a high token is a
// bigger container for water that never arrives. The whole split rests on
// ground income clearing drain on a clean run.
//
// Speed cancels out of the income and drain rates alike (both scale with it),
// so the only dial that matters is income per world unit against `DRAIN`,
// weighted by how much a player actually collects. Target: collecting nearly
// all of it is net positive, collecting ~70% is net negative, so the bar always
// matters and skill is what keeps you alive.
//
// Pool income per world unit at full collection, measured off the spawner over
// 3.6M units of track rather than estimated:
//
//   ground  4.06 per 1000 units  x  120  =  0.487   vs DRAIN 0.40
//
// A clean run gains ~0.09 per unit; a 70% run earns 0.341 and loses ~0.06.
// `TOKEN_VALUE` doubled from 60 to 120 to get there, and it had to: under the
// exclusive rule the ground token is the *only* thing paying into the pool,
// where before it carried a third of the load.
//
// The ceiling grows on a separate, slower clock, and it is the difficulty dial:
//
//   high    0.85 per 1000 units  x  140  =  0.119
//   power   0.06 per 1000 units  x 1000  =  0.064
//                                           -----
//                                           0.183
//
// So a run that jumps for everything accelerates at a bit over 40% of the pace
// the old economy set, and only in response to jumps.
//
// The asymmetry that falls out of the cap is now the core loop rather than a
// footnote: a ground token taken while the pool is full is wasted outright, and
// the only way to stop wasting them is to jump for a high token and make the
// pool bigger — which also makes the game faster, which drains it again. Full
// is the cue to start reaching upward.
//
// The ground-token count is measured, not derived from the spacing above:
// tokens that would land against an obstacle are dropped, which costs about a
// fifth of them, and the value carries that.
// ---------------------------------------------------------------------------

/** The starting ceiling. Only the pickups you have to jump for raise it. */
export const START_BUDGET = 3000;

/**
 * Tokens in hand at the start — deliberately *below* the ceiling, which is the
 * one thing the pool model costs and has to buy back.
 *
 * The opening run of ground tokens exists to teach "gold is worth taking"
 * before anything punishes you, and it teaches it by moving the bar. Under the
 * old rules a token raised the ceiling, so it moved the bar from anywhere,
 * including from full. Under these it tops up a pool that is capped at the
 * ceiling — so a run that starts full would swallow the entire opening lesson
 * and show nothing at all.
 *
 * 70% of the ceiling leaves room for the whole first run — 6 x `TOKEN_VALUE`
 * against the ~190 drained by the time the last of them is reached, so the pool
 * peaks around 2630 of 3000 — without clipping a single token. Every one of
 * them is therefore a visible step up the bar. It also opens on a bar that is
 * obviously not full, which is its own quiet instruction, while staying clear
 * of `BAR_WARN` so the opening frame is not painted as a warning.
 */
export const START_TOKENS = START_BUDGET * 0.7;

/** Tokens burned per world unit travelled. `used` is also the score. */
export const DRAIN = 0.4;

/** `speedFor` coefficients: speed is a monotonic function of budget alone. */
export const SPEED_BASE = 260;
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
/** The only pickup that pays into the pool. See the economy note above. */
export const TOKEN_VALUE = 120;

/**
 * High tokens sit near the top of a jump. Standing, the runner's head reaches
 * `RUNNER_H` (45), so anything above that is unreachable; the jump apex is
 * `JUMP_V^2 / 2|GRAVITY|` ≈ 156, putting the runner's head at ~201. 150 is
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

/**
 * Ground tokens arrive in runs of this many, evenly spaced. The first run of
 * the game is always `TOKEN_RUN_MAX` long — it is the teaching one, and a run
 * has to span more track than one jump covers or a player still mashing the
 * button flies over it. See `spawn` in `rules.ts`.
 */
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
 * Ceiling granted on pickup. Because speed is a function of the ceiling, this
 * *is* the speed increase — the boost feeds the existing rule rather than
 * adding a new one. A few seconds of immunity bought with a permanently faster
 * game.
 *
 * The power-up also fills the pool to the new ceiling, and it is the only thing
 * in the game that does. That is what makes it the jackpot rather than a third
 * flavour of token: everything else either tops you up or widens the container,
 * and this one does both at once and hands you the shield to spend it with. It
 * is the only pickup whose value depends on when you take it — worth a full
 * `budget` when you are nearly dead, worth only the ceiling when you are full.
 */
export const BOOST = 1000;

/** Rare: one power-up every ~35–60 seconds at early-run speeds. */
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
 *
 * Just past where the opening hop lands (~228 units of track at the starting
 * speed), so the press that starts the game does not carry the runner over its
 * own first lesson. The run is also the longest the game spawns, which is what
 * makes the lesson land at every press rhythm rather than most of them.
 */
export const FIRST_TOKEN_X = 420;

/** Far enough in that the power-up is never the first thing you meet. */
export const FIRST_POWER_X = 6500;

/**
 * Fractions of the *ceiling* at which the bar changes colour.
 *
 * There used to be a fixed `BAR_CAP` here that the bar was measured against
 * instead. It went with the old economy, where every pickup raised the ceiling
 * and the ceiling was never something the player managed. Now that the ceiling
 * is the second resource, the bar has to be a container — see `barFraction`.
 */
export const BAR_WARN = 0.45;
export const BAR_CRIT = 0.18;

/** Milliseconds per caret blink phase, while idle. */
export const CARET_BLINK_MS = 450;

/** How fast the ground drifts before the run starts, world units per second. */
export const IDLE_SCROLL = 55;

// ---------------------------------------------------------------------------
// Presentation — owned by plan/04-presentation.md
//
// The world is WORLD_W units wide at every viewport and its height in units
// follows the aspect ratio, so a phone in portrait has a *taller* world than a
// desktop, not a narrower one. The same length of track is visible at both
// marking viewports (1920x1080 and 390x844), which is the point: reaction time
// is a property of the game, not of the screen.
//
// Everything below therefore anchors to the bottom of the world rather than
// scaling with its height. The play band is the composition — budget bar down
// to the bottom of the ground strip — and it is identical at every viewport;
// only the empty sky above it grows.
// ---------------------------------------------------------------------------

/**
 * Height of the composition, world units. A visible world shorter than this
 * (any wide screen) simply shows less sky above the bar; a taller one shows
 * more. Chosen so the whole band fits inside 1920x1080's ~540-unit world.
 */
export const PLAY_BAND = 620;

/** Where the ground line sits within the play band, measured from its top. */
export const GROUND_FRACTION = 0.8;

/** Spacing of the ground's dashes, world units. */
export const GROUND_DASH = 26;

/**
 * The HUD is the one thing that cannot be a constant number of world units.
 * At 390 CSS px wide, one world unit is 0.39 px, so the 22-unit bar the desktop
 * shows would be 8 px tall and its readout unreadable — and "you must be able to
 * watch yourself run dry" is the design's load-bearing claim (plan/03).
 *
 * So the HUD scales with world *height*: 1x on a landscape desktop, and up to
 * HUD_SCALE_MAX on a phone in portrait, where there is spare sky to spend on it.
 * Gameplay geometry never scales — only the readout does.
 */
export const HUD_REFERENCE_H = 560;
export const HUD_SCALE_MAX = 2.2;

// --- the pickup readout -------------------------------------------------------
//
// The word a pickup throws off saying what it did — "+60 MAX TOKENS" — drawn by
// `main.ts` and animated by `effects.ts`. Pure presentation, and it would sit
// happily in either of those files except for `FLOAT_LIFE`: `spec/shot-plan`
// needs it to check that the pickup screenshots open the shutter while a word is
// still on screen, and a node test cannot import a module that touches the DOM.
// So the group lives here, together, rather than one number in exile.

/** Base type size, world units. Multiplied by the HUD scale, like the HUD. */
export const FLOAT_FONT = 19;

/**
 * Seconds on screen. Deliberately shorter than the time it takes to decide to
 * read something: it is meant to be caught by an eye that stays on the track,
 * and a label that outstays that is a label the player has to look away for.
 */
export const FLOAT_LIFE = 0.62;

/** The power-up's word is rarer, says more, and is allowed to linger. */
export const FLOAT_LIFE_POWER = 1;

/** World units the word drifts upward over its life, before the HUD scale. */
export const FLOAT_RISE = 62;

/** Clear air between the top of the pickup's box and where the word starts. */
export const FLOAT_LEAD = 16;
