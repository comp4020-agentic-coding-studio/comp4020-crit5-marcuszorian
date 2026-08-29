// The whole simulation, as a pure reducer: `step(state, input, dt)` returns the
// next state and touches nothing else. No `Date`, no `Math.random`, no DOM.
//
// That is not a style preference. vitest runs in the node environment, so a
// module that reaches for `document` or `requestAnimationFrame` at import time
// throws during collection — a DOM-touching rules file is not merely untested,
// it is untestable. Keeping the rules pure also makes runs reproducible: the
// same seed and the same input sequence replay exactly, so a bad moment you
// felt while playing can be reproduced instead of described.

import {
  BAR_CAP,
  BAR_CRIT,
  BAR_WARN,
  BOOST,
  DRAIN,
  FIRST_OBSTACLE_X,
  FIRST_POWER_X,
  FIRST_TOKEN_X,
  GRAVITY,
  GROUND_EPS,
  HIGH_TOKEN_CHANCE,
  HIGH_TOKEN_H,
  HIGH_TOKEN_LEAD,
  HIGH_TOKEN_VALUE,
  HIGH_TOKEN_W,
  HIGH_TOKEN_Y,
  INVULN_MS,
  JUMP_V,
  OBSTACLE_H,
  OBSTACLE_W,
  POWER_GAP_MAX,
  POWER_GAP_MIN,
  POWER_H,
  POWER_W,
  POWER_Y,
  RUNNER_H,
  RUNNER_W,
  RUNNER_X,
  SPAWN_GAP_MAX,
  SPAWN_GAP_MIN,
  SPEED_BASE,
  SPEED_PER_BUDGET,
  START_BUDGET,
  TOKEN_CLEARANCE,
  TOKEN_GAP_MAX,
  TOKEN_GAP_MIN,
  TOKEN_H,
  TOKEN_RUN_MAX,
  TOKEN_RUN_MIN,
  TOKEN_SPACING,
  TOKEN_VALUE,
  TOKEN_W,
  TOKEN_Y,
  WORLD_W,
} from "./config.ts";

export type Status = "idle" | "running" | "over";

/** Why the run ended. `null` while it hasn't. */
export type DeathCause = "collision" | "drained";

/** An axis-aligned box in world units, `y` measured up from the ground line. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Obstacle `x` is absolute world position, not a screen offset. */
export interface Obstacle {
  readonly x: number;
  readonly w: number;
  readonly h: number;
}

/**
 * `token` runs along the ground and is free; `high` needs a jump and is worth
 * more; `power` is rare and grants invincibility plus a large budget boost.
 */
export type PickupKind = "token" | "high" | "power";

/** A pickup is its own collision box — position and size in world units. */
export interface Pickup extends Box {
  readonly kind: PickupKind;
}

export interface GameState {
  readonly status: Status;
  /** RNG state. Advanced by every draw; carried into the next run on restart. */
  readonly seed: number;
  /** Seconds of running time elapsed. */
  readonly elapsed: number;
  /** World units travelled. The runner's absolute x is `distance + RUNNER_X`. */
  readonly distance: number;
  /** Height above the ground line, world units. Never negative. */
  readonly y: number;
  /** Vertical velocity, world units per second. */
  readonly vy: number;
  readonly obstacles: readonly Obstacle[];
  readonly pickups: readonly Pickup[];
  /** Tokens consumed. Rises with distance, and is the score. */
  readonly used: number;
  /** The ceiling. Starts at `START_BUDGET`; only pickups raise it. */
  readonly budget: number;
  /** Absolute world x of the next obstacle to spawn. */
  readonly nextObstacleAt: number;
  /** Absolute world x where the next run of ground tokens begins. */
  readonly nextTokenAt: number;
  /** Absolute world x of the next power-up. */
  readonly nextPowerAt: number;
  /** `elapsed` at which invincibility ends. Zero when it was never granted. */
  readonly invulnUntil: number;
  readonly cause: DeathCause | null;
}

/** One button. `jump` is an edge, not a held key — see `main.ts`. */
export interface Input {
  readonly jump: boolean;
}

// --- seeded RNG ------------------------------------------------------------
// mulberry32, threaded through the state rather than held in a closure, so the
// generator is as pure as everything else and a state snapshot replays exactly.

export function nextRandom(seed: number): { value: number; seed: number } {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next };
}

// --- derived quantities ----------------------------------------------------

/** What the budget bar shows. The run ends when this reaches zero. */
export function remainingOf(state: GameState): number {
  return state.budget - state.used;
}

/** The three states of the budget bar. Colour is `main.ts`'s business. */
export type BarLevel = "ok" | "warn" | "crit";

/**
 * How much of the bar is filled. A fixed cap, not `remaining / budget`: at a
 * constant cap every pickup is the same visible bump for the whole run, so the
 * pickup-to-bar link keeps teaching. Drawn as a percentage of a growing budget,
 * a late-game token would move the bar by nothing — exactly when the feedback
 * matters most. Headroom above the cap still counts toward speed; it just pins
 * the bar at full.
 */
export function barFraction(state: GameState): number {
  return Math.max(0, Math.min(1, remainingOf(state) / BAR_CAP));
}

/**
 * Which of the three colours the bar is showing. Derived here rather than in
 * the renderer so that "the bar had changed colour before you died" is a
 * property a test can hold, instead of a claim about a canvas nobody can read.
 */
export function barLevel(state: GameState): BarLevel {
  const fraction = barFraction(state);
  if (fraction <= BAR_CRIT) return "crit";
  if (fraction <= BAR_WARN) return "warn";
  return "ok";
}

/**
 * Scroll rate, world units per second. Monotonically increasing in `budget`,
 * which is the whole design: pickups raise the ceiling, and raising the ceiling
 * is what makes the rest of the run faster. Every reward is also a difficulty
 * increase.
 */
export function speedFor(budget: number): number {
  return SPEED_BASE + SPEED_PER_BUDGET * Math.max(0, budget);
}

/** The runner's collision box, in absolute world coordinates. */
export function runnerBox(state: GameState): Box {
  return {
    x: state.distance + RUNNER_X,
    y: state.y,
    w: RUNNER_W,
    h: RUNNER_H,
  };
}

export function obstacleBox(obstacle: Obstacle): Box {
  return { x: obstacle.x, y: 0, w: obstacle.w, h: obstacle.h };
}

export function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.w &&
    b.x < a.x + a.w &&
    a.y < b.y + b.h &&
    b.y < a.y + a.h
  );
}

/** True when the runner is on the ground and may jump. */
export function grounded(state: GameState): boolean {
  return state.y <= GROUND_EPS;
}

/** True while a power-up is still shielding the runner. */
export function invulnerable(state: GameState): boolean {
  return state.elapsed < state.invulnUntil;
}

/**
 * How much of the shield is left, 0..1, for the small bar under the budget one.
 * Zero whenever nothing is shielding, so the renderer's test for "draw it at
 * all" and its test for "how wide" are the same number.
 *
 * Derived here rather than in the renderer for the same reason `barLevel` is:
 * "the shield bar was still running when the runner survived the hit" is then a
 * property a test can hold, instead of a claim about a canvas nobody can read.
 * It falls at a fixed rate — INVULN_MS is a few seconds against a run of
 * minutes — so the bar visibly empties, which is the point of drawing it.
 */
export function invulnFraction(state: GameState): number {
  const left = state.invulnUntil - state.elapsed;
  if (left <= 0) return 0;
  return Math.min(1, left / (INVULN_MS / 1000));
}

/**
 * A pickup of `kind` with its left edge at world `x`. The one place a pickup's
 * geometry is decided, so the spawner, the renderer and the tests all agree
 * about what "a high token" is without any of them naming a number.
 */
export function pickupAt(kind: PickupKind, x: number): Pickup {
  switch (kind) {
    case "token":
      return { kind, x, y: TOKEN_Y, w: TOKEN_W, h: TOKEN_H };
    case "high":
      return { kind, x, y: HIGH_TOKEN_Y, w: HIGH_TOKEN_W, h: HIGH_TOKEN_H };
    case "power":
      return { kind, x, y: POWER_Y, w: POWER_W, h: POWER_H };
  }
}

/** Budget granted by collecting one. Every pickup pays in the same currency. */
export function pickupValue(kind: PickupKind): number {
  switch (kind) {
    case "token":
      return TOKEN_VALUE;
    case "high":
      return HIGH_TOKEN_VALUE;
    case "power":
      return BOOST;
  }
}

// --- the reducer -----------------------------------------------------------

export function createGame(seed: number): GameState {
  return {
    status: "idle",
    seed,
    elapsed: 0,
    distance: 0,
    y: 0,
    vy: 0,
    obstacles: [],
    pickups: [],
    used: 0,
    budget: START_BUDGET,
    nextObstacleAt: FIRST_OBSTACLE_X,
    nextTokenAt: FIRST_TOKEN_X,
    nextPowerAt: FIRST_POWER_X,
    invulnUntil: 0,
    cause: null,
  };
}

/**
 * Advance the world by `dt` seconds.
 *
 * `dt` is trusted: clamping a stalled frame is the caller's job, because only
 * the caller knows the frame came from `requestAnimationFrame`.
 */
export function step(state: GameState, input: Input, dt: number): GameState {
  switch (state.status) {
    case "idle":
      // The first press starts the world *and* jumps, so the verb teaches
      // itself on frame one. Nothing moves until then.
      return input.jump ? launch(state) : state;

    case "over":
      // The same input restarts. The seed carries over, so the next run is a
      // different one and the sequence as a whole is still deterministic.
      return input.jump ? launch(createGame(state.seed)) : state;

    case "running":
      return advance(state, input, dt);
  }
}

/** Leave the start (or death) screen running, mid-hop. */
function launch(state: GameState): GameState {
  return { ...state, status: "running", vy: JUMP_V };
}

function advance(state: GameState, input: Input, dt: number): GameState {
  const speed = speedFor(state.budget);
  const travelled = speed * dt;

  // Jump only from the ground: one press, one hop, no hovering.
  let vy = input.jump && grounded(state) ? JUMP_V : state.vy;

  vy += GRAVITY * dt;
  let y = state.y + vy * dt;
  if (y <= 0) {
    y = 0;
    vy = 0;
  }

  const distance = state.distance + travelled;
  const used = state.used + travelled * DRAIN;

  const moved: GameState = {
    ...state,
    elapsed: state.elapsed + dt,
    distance,
    y,
    vy,
    used,
    ...spawn(state, distance),
  };

  // Collect before colliding, so a power-up taken on the same frame as the
  // obstacle behind it still shields that obstacle. The generous reading of an
  // ambiguous frame is the one the player will believe they earned.
  const next = { ...moved, ...collect(moved) };

  const runner = runnerBox(next);
  const struck = next.obstacles.filter((obstacle) =>
    overlaps(runner, obstacleBox(obstacle)),
  );

  if (struck.length > 0) {
    // Collision first: hitting something is the more legible of the two
    // endings, and on the frame where both happen it is the one the player saw.
    if (!invulnerable(next)) {
      return { ...next, status: "over", cause: "collision" };
    }
    // Shielded, so the obstacle is destroyed rather than ignored. Ignoring it
    // would let the shield expire while the runner is still inside the box,
    // killing them for a hit they already survived.
    return {
      ...next,
      obstacles: next.obstacles.filter((obstacle) => !struck.includes(obstacle)),
    };
  }

  if (remainingOf(next) <= 0) {
    return { ...next, status: "over", cause: "drained", used: next.budget };
  }

  return next;
}

/**
 * Take everything the runner is touching. Pickups pay into `budget`, never into
 * `used`, so collecting raises the ceiling and — through `speedFor` — the speed
 * of the rest of the run. Every reward is also a difficulty increase.
 */
function collect(
  state: GameState,
): Pick<GameState, "pickups" | "budget" | "invulnUntil"> {
  const runner = runnerBox(state);
  const pickups: Pickup[] = [];
  let budget = state.budget;
  let invulnUntil = state.invulnUntil;

  for (const pickup of state.pickups) {
    if (!overlaps(runner, pickup)) {
      pickups.push(pickup);
      continue;
    }
    budget += pickupValue(pickup.kind);
    if (pickup.kind === "power") {
      invulnUntil = state.elapsed + INVULN_MS / 1000;
    }
  }

  return { pickups, budget, invulnUntil };
}

type Spawned = Pick<
  GameState,
  "obstacles" | "pickups" | "nextObstacleAt" | "nextTokenAt" | "nextPowerAt" | "seed"
>;

/**
 * Top up the track ahead and drop what has gone past. Everything is created at
 * `distance + WORLD_W`, one screen-width away, so nothing is ever seen to
 * appear. Each cursor is an absolute world x, so the track is a function of the
 * seed and the distance travelled and nothing else.
 *
 * A cursor of `Infinity` disables its spawner, which is how a test isolates one
 * obstacle on an otherwise empty track.
 */
function spawn(state: GameState, distance: number): Spawned {
  const horizon = distance + WORLD_W;
  let seed = state.seed;

  const obstacles = state.obstacles.filter(
    (obstacle) => obstacle.x + obstacle.w >= distance,
  );
  const pickups = state.pickups.filter(
    (pickup) => pickup.x + pickup.w >= distance,
  );

  let nextObstacleAt = state.nextObstacleAt;
  while (nextObstacleAt <= horizon) {
    const x = nextObstacleAt;
    obstacles.push({ x, w: OBSTACLE_W, h: OBSTACLE_H });

    // The shape the whole design is built on: a high token hanging just past an
    // obstacle, so one well-timed jump takes both and a greedy one kills you.
    // Never on the first obstacle — that one is only ever "jump this".
    const carries = nextRandom(seed);
    seed = carries.seed;
    if (x > FIRST_OBSTACLE_X && carries.value < HIGH_TOKEN_CHANCE) {
      pickups.push(pickupAt("high", x + OBSTACLE_W + HIGH_TOKEN_LEAD));
    }

    const gap = nextRandom(seed);
    seed = gap.seed;
    nextObstacleAt = x + SPAWN_GAP_MIN + gap.value * (SPAWN_GAP_MAX - SPAWN_GAP_MIN);
  }

  // Tokens reach a little past the horizon, and the next obstacle has not been
  // created yet at the moment they are placed — so clearance is measured
  // against the obstacle the cursor is already committed to as well as the ones
  // on the track. Without it, tokens turn up jammed against a wall that appears
  // a frame later.
  const committed: readonly Obstacle[] = Number.isFinite(nextObstacleAt)
    ? [...obstacles, { x: nextObstacleAt, w: OBSTACLE_W, h: OBSTACLE_H }]
    : obstacles;

  let nextTokenAt = state.nextTokenAt;
  while (nextTokenAt <= horizon) {
    const count = nextRandom(seed);
    seed = count.seed;
    // The first run is always the longest one, because it is the only place the
    // game gets to teach "gold is worth taking" before anything punishes you.
    // A short run spans less track than one jump covers (6 tokens span 252
    // units against a ~228-unit airtime), so a player still mashing the button
    // sails over the whole thing and meets the first obstacle having collected
    // nothing — measured at 8% of seeds for a ~0.75s press cadence. The draw
    // above happens either way, so the seed sequence does not fork here.
    const run =
      nextTokenAt === FIRST_TOKEN_X
        ? TOKEN_RUN_MAX
        : TOKEN_RUN_MIN + Math.floor(count.value * (TOKEN_RUN_MAX - TOKEN_RUN_MIN + 1));

    let x = nextTokenAt;
    for (let i = 0; i < run; i += 1) {
      const token = pickupAt("token", x);
      // A ground token inside an obstacle is uncollectable, and looks like a
      // bug rather than a choice. Skip it; the run just has a hole in it.
      if (clearOfObstacles(token, committed)) pickups.push(token);
      x += TOKEN_SPACING;
    }

    const gap = nextRandom(seed);
    seed = gap.seed;
    nextTokenAt =
      x - TOKEN_SPACING + TOKEN_GAP_MIN + gap.value * (TOKEN_GAP_MAX - TOKEN_GAP_MIN);
  }

  let nextPowerAt = state.nextPowerAt;
  while (nextPowerAt <= horizon) {
    const power = pickupAt("power", nextPowerAt);
    // Nudged clear of an obstacle rather than skipped: one every few tens of
    // seconds is too rare to drop because the dice put it inside a wall.
    if (!clearOfObstacles(power, committed)) {
      nextPowerAt += TOKEN_CLEARANCE;
      continue;
    }
    pickups.push(power);
    const gap = nextRandom(seed);
    seed = gap.seed;
    nextPowerAt += POWER_GAP_MIN + gap.value * (POWER_GAP_MAX - POWER_GAP_MIN);
  }

  return { obstacles, pickups, nextObstacleAt, nextTokenAt, nextPowerAt, seed };
}

function clearOfObstacles(
  pickup: Pickup,
  obstacles: readonly Obstacle[],
): boolean {
  const room: Box = {
    x: pickup.x - TOKEN_CLEARANCE,
    y: pickup.y,
    w: pickup.w + TOKEN_CLEARANCE * 2,
    h: pickup.h,
  };
  return !obstacles.some((obstacle) => overlaps(room, obstacleBox(obstacle)));
}
