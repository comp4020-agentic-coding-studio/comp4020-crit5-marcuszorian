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
  SPEED_CURVE,
  SPEED_MAX,
  SPEED_START,
  START_BUDGET,
  START_TOKENS,
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
  /**
   * Tokens consumed over the whole run. Monotonic, and the score. It is not the
   * other half of `tokens`: spending is permanent and the pool refills, so the
   * two diverge the moment anything is collected.
   */
  readonly used: number;
  /**
   * Tokens in hand — the bar. Drains with distance, refilled by pickups, and
   * never above `budget`. The run ends when it reaches zero.
   */
  readonly tokens: number;
  /**
   * The ceiling on `tokens`, and the only input to speed. Starts at
   * `START_BUDGET`, and *only the pickups that cost something* raise it: a
   * ground token you ran through pays into the pool, a high token you had to
   * jump for makes the pool bigger. See `raisesMax`.
   */
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
  return state.tokens;
}

/** The three states of the budget bar. Colour is `main.ts`'s business. */
export type BarLevel = "ok" | "warn" | "crit";

/**
 * How much of the bar is filled: tokens against the ceiling that holds them.
 *
 * It used to be tokens against a fixed `BAR_CAP`, on the argument that a
 * growing denominator makes a late-game token move the bar by nothing. That
 * argument belonged to the old economy, where every pickup raised the ceiling
 * and the ceiling was therefore never a thing the player was managing. Now that
 * only the pickups you jump for raise it, the ceiling *is* the second resource,
 * and a bar that cannot show it is hiding half the game: at a fixed cap, every
 * "+MAX TOKENS" above the cap moves nothing on screen at all.
 *
 * So the bar is a container. Filling it is a ground token, widening it is a
 * high token, and widening it drops the fill — which is honest, is the moment
 * the readout says `+140 MAX TOKENS`, and is the whole reason to want one: room
 * to keep earning once you are pressed against the top.
 */
export function barFraction(state: GameState): number {
  if (state.budget <= 0) return 0;
  return Math.max(0, Math.min(1, remainingOf(state) / state.budget));
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
 *
 * The shape of that increase — steep at the start, easing toward `SPEED_MAX`
 * without ever arriving — and why it is a curve rather than the line it used to
 * be, are argued at the constants in `config.ts`.
 *
 * `budget` is anchored at `START_BUDGET` rather than at zero, so the exponent is
 * the ceiling the player has *earned*. At the opening budget it is zero and the
 * curve returns `SPEED_START` exactly, which is what the rest of the game's
 * timings are measured against. Below the opening budget — a place no run
 * reaches, since `budget` only ever rises — the exponent goes positive and the
 * curve keeps rising monotonically through it, which is worth more than a clamp:
 * a flat spot there would be a hole in the one property this function has.
 */
export function speedFor(budget: number): number {
  const earned = Math.max(0, budget) - START_BUDGET;
  return SPEED_MAX - (SPEED_MAX - SPEED_START) * Math.exp(-SPEED_CURVE * earned);
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

/**
 * How far through a jump arc the runner is: 0 at take-off, 0.5 at the apex, 1
 * at the landing. Zero whenever there is no jump to be through.
 *
 * The renderer spins the character a quarter turn over this, Geometry Dash
 * style, so it lands on a new face each hop. Read from `vy` rather than from a
 * clock because every jump starts on the ground at exactly `JUMP_V` — velocity
 * alone locates the runner in the arc, which means no timer to keep, nothing to
 * reset, and a replayed seed spinning the same way as the run that produced it.
 * A death mid-air freezes `vy`, and the character freezes at that angle with it.
 *
 * Lives here rather than in `main.ts` for the usual reason: it is arithmetic on
 * the state, so it is something a node test can hold an opinion about.
 */
export function airProgress(state: GameState): number {
  if (state.y <= 0) return 0;
  return Math.min(1, Math.max(0, (JUMP_V - state.vy) / (2 * JUMP_V)));
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

/**
 * How much collecting one is worth. One number per kind, but not one meaning:
 * `raisesMax` says which side of the ledger it lands on.
 */
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

/**
 * Whether collecting one also raises the ceiling — which, through `speedFor`,
 * is the same thing as making the rest of the run faster.
 *
 * This is the game's one economic distinction, and for the two common pickups
 * the effects are exclusive: it pays tokens or it pays capacity, never both.
 * Which one follows what the pickup costs to take. A ground token is free — you
 * run through it, and it pays you tokens you can spend. A high token costs a
 * jump, and a jump is the only way to die, so the thing it buys is the permanent
 * one: a bigger window, and a faster game to spend it in.
 *
 * The consequence worth knowing: capacity you cannot fill is worth nothing, so a
 * high token is a bet on being able to earn against it later, and it is dead
 * weight to a player who is not collecting. Which is exactly the decision the
 * layout exists to pose — and it only works because ground tokens out-earn
 * `DRAIN`, so a clean run really does press against the ceiling.
 *
 * The power-up is the deliberate exception and reads as one *because* the rule
 * is otherwise strict — it raises the ceiling and then fills the pool to it. See
 * `fillsPool`.
 */
export function raisesMax(kind: PickupKind): boolean {
  return kind !== "token";
}

/**
 * Whether collecting one refills the pool to the ceiling. Only the power-up
 * does, which is what makes it the jackpot: every other pickup moves one of the
 * two numbers, and this moves both to their best value at once.
 *
 * It is a fill rather than a payment on purpose. A flat grant would be a fourth
 * tuning number that goes stale against `START_BUDGET`, and would be worth less
 * the further a run had got — the opposite of what a rare pickup should feel
 * like. "Full" is worth more precisely when the ceiling is high, so the reward
 * grows with the run that earned it.
 */
export function fillsPool(kind: PickupKind): boolean {
  return kind === "power";
}

// --- the reducer -----------------------------------------------------------

/**
 * A new run, already holding the first screen of its own level.
 *
 * The spawn is the point. Without it the start screen is bare track and the
 * opening run of tokens blinks into existence at x=420 on the first running
 * frame — the game cuts from a title card to a different picture, and the first
 * thing the player ever sees the world do is pop. Spawning at rest makes the
 * idle screen *literally the first frame of the run*: the level you are about
 * to play is already laid out in front of you, and the press sets it moving
 * rather than replacing it.
 *
 * It costs nothing to keep pure — `spawn` is a function of the seed and the
 * distance, and at distance zero it fills exactly the screen you can see.
 */
export function createGame(seed: number): GameState {
  const empty: GameState = {
    status: "idle",
    seed,
    elapsed: 0,
    distance: 0,
    y: 0,
    vy: 0,
    obstacles: [],
    pickups: [],
    used: 0,
    tokens: START_TOKENS,
    budget: START_BUDGET,
    nextObstacleAt: FIRST_OBSTACLE_X,
    nextTokenAt: FIRST_TOKEN_X,
    nextPowerAt: FIRST_POWER_X,
    invulnUntil: 0,
    cause: null,
  };
  return { ...empty, ...spawn(empty, 0) };
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
  const spent = travelled * DRAIN;

  const moved: GameState = {
    ...state,
    elapsed: state.elapsed + dt,
    distance,
    y,
    vy,
    // `used` is the score and only ever rises; `tokens` is the pool and does
    // both. The same spend hits each of them, in opposite directions.
    used: state.used + spent,
    tokens: state.tokens - spent,
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

  if (next.tokens <= 0) {
    // Pinned to exactly zero so the bar reads empty rather than slightly
    // negative on the frame the run ends.
    return { ...next, status: "over", cause: "drained", tokens: 0 };
  }

  return next;
}

/**
 * Take everything the runner is touching, and send each pickup's value to
 * whichever of the two numbers it belongs to.
 *
 * A ground token is tokens and nothing else; a high token is capacity and
 * nothing else — it hands you no tokens at all, it hands you somewhere to put
 * them. Which is why the ceiling is only worth raising when the pool is pressing
 * against it, and why the pool can only press against it if ground tokens
 * out-earn `DRAIN`. See the economy note in config.
 *
 * Order matters where the two meet. The ceiling is raised first, so a power-up's
 * fill goes to the *new* ceiling and a ground token taken on the same frame as a
 * high token is not clipped against the old one. Both are rare — the second
 * needs a jump landing exactly on a coin — but a rule that only holds when
 * pickups arrive one at a time is a rule that fails in the moment worth
 * photographing.
 */
function collect(
  state: GameState,
): Pick<GameState, "pickups" | "tokens" | "budget" | "invulnUntil"> {
  const runner = runnerBox(state);
  const pickups: Pickup[] = [];
  const taken: PickupKind[] = [];
  let budget = state.budget;
  let invulnUntil = state.invulnUntil;

  for (const pickup of state.pickups) {
    if (!overlaps(runner, pickup)) {
      pickups.push(pickup);
      continue;
    }
    taken.push(pickup.kind);
    if (raisesMax(pickup.kind)) budget += pickupValue(pickup.kind);
    if (pickup.kind === "power") {
      invulnUntil = state.elapsed + INVULN_MS / 1000;
    }
  }

  let tokens = state.tokens;
  for (const kind of taken) {
    if (fillsPool(kind)) tokens = budget;
    else if (!raisesMax(kind)) tokens += pickupValue(kind);
  }

  return {
    pickups,
    tokens: Math.min(budget, tokens),
    budget,
    invulnUntil,
  };
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

    // A power-up placed on an earlier frame can sit inside the run about to be
    // laid down here: the two cursors both stop just past the horizon, so the
    // one that ran first can leave something a few units short of where the
    // other starts. The power loop below cannot see these tokens yet, so this
    // is the half of the check that has to happen on this side.
    const powers = pickups.filter((pickup) => pickup.kind === "power");

    let x = nextTokenAt;
    for (let i = 0; i < run; i += 1) {
      const token = pickupAt("token", x);
      // A ground token inside an obstacle — or inside a power-up, which stands
      // at the same height and would swallow the coin behind its icon — is
      // uncollectable as a separate thing, and looks like a bug rather than a
      // choice. Skip it; the run just has a hole in it.
      if (clearOfObstacles(token, committed) && clearOfPickups(token, powers)) {
        pickups.push(token);
      }
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
    // Nudged clear rather than skipped: one every few tens of seconds is too
    // rare to drop because the dice put it inside a wall — or on top of a coin,
    // where the two icons occupy the same square of ground and the player is
    // shown one pickup where there are two. High tokens are exempt without
    // being special-cased: the test is box overlap, and they hang out of reach
    // above the power-up's box rather than in it.
    if (!clearOfObstacles(power, committed) || !clearOfPickups(power, pickups)) {
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

/** The pickup's own box, widened by a token's width of breathing room. */
function roomAround(pickup: Pickup): Box {
  return {
    x: pickup.x - TOKEN_CLEARANCE,
    y: pickup.y,
    w: pickup.w + TOKEN_CLEARANCE * 2,
    h: pickup.h,
  };
}

function clearOfObstacles(
  pickup: Pickup,
  obstacles: readonly Obstacle[],
): boolean {
  const room = roomAround(pickup);
  return !obstacles.some((obstacle) => overlaps(room, obstacleBox(obstacle)));
}

/**
 * True when nothing in `others` is inside the pickup's room. Only ever called
 * with lists a pickup of that kind must not land on — never with the run of
 * ground tokens a token is part of, which would reject its own neighbours.
 */
function clearOfPickups(pickup: Pickup, others: readonly Pickup[]): boolean {
  const room = roomAround(pickup);
  return !others.some((other) => overlaps(room, other));
}
