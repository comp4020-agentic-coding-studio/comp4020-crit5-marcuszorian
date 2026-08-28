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
  DRAIN,
  FIRST_OBSTACLE_X,
  GRAVITY,
  GROUND_EPS,
  JUMP_V,
  OBSTACLE_H,
  OBSTACLE_W,
  RUNNER_H,
  RUNNER_W,
  RUNNER_X,
  SPAWN_GAP_MAX,
  SPAWN_GAP_MIN,
  SPEED_BASE,
  SPEED_PER_BUDGET,
  START_BUDGET,
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
  /** Tokens consumed. Rises with distance, and is the score. */
  readonly used: number;
  /** The ceiling. Starts at `START_BUDGET`; only pickups raise it. */
  readonly budget: number;
  /** Absolute world x of the next obstacle to spawn. */
  readonly nextSpawnAt: number;
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
    used: 0,
    budget: START_BUDGET,
    nextSpawnAt: FIRST_OBSTACLE_X,
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

  const next: GameState = {
    ...state,
    elapsed: state.elapsed + dt,
    distance,
    y,
    vy,
    used,
    ...spawn(state, distance),
  };

  // Collision first: hitting something is the more legible of the two endings,
  // and on the frame where both happen it is the one the player saw.
  if (hitsAnything(next)) {
    return { ...next, status: "over", cause: "collision" };
  }

  if (remainingOf(next) <= 0) {
    return { ...next, status: "over", cause: "drained", used: next.budget };
  }

  return next;
}

function hitsAnything(state: GameState): boolean {
  const runner = runnerBox(state);
  return state.obstacles.some((obstacle) =>
    overlaps(runner, obstacleBox(obstacle)),
  );
}

/**
 * Top up the track ahead and drop what has gone past. Obstacles are created at
 * `distance + WORLD_W`, one screen-width away, so they are never seen to
 * appear.
 */
function spawn(
  state: GameState,
  distance: number,
): Pick<GameState, "obstacles" | "nextSpawnAt" | "seed"> {
  const horizon = distance + WORLD_W;
  let seed = state.seed;
  let nextSpawnAt = state.nextSpawnAt;
  const obstacles = state.obstacles.filter(
    (obstacle) => obstacle.x + obstacle.w >= distance,
  );

  while (nextSpawnAt <= horizon) {
    obstacles.push({ x: nextSpawnAt, w: OBSTACLE_W, h: OBSTACLE_H });
    const roll = nextRandom(seed);
    seed = roll.seed;
    nextSpawnAt += SPAWN_GAP_MIN + roll.value * (SPAWN_GAP_MAX - SPAWN_GAP_MIN);
  }

  return { obstacles, nextSpawnAt, seed };
}
