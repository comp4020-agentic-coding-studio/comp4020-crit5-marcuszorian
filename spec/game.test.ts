import { describe, expect, it } from "vitest";
import {
  GRAVITY,
  JUMP_V,
  OBSTACLE_H,
  OBSTACLE_W,
  RUNNER_W,
  RUNNER_X,
  START_BUDGET,
} from "../src/game/config.ts";
import type { GameState } from "../src/game/rules.ts";
import {
  createGame,
  nextRandom,
  remainingOf,
  speedFor,
  step,
} from "../src/game/rules.ts";

// Contract tests for this week's game, plus one sensor. They import the rules
// directly and never touch the DOM — vitest runs in the node environment, so
// anything that did would fail at collection.
//
// The rule these follow: assert relationships, never tuning numbers. Every
// timing below is *derived* from the physics constants rather than written out,
// so a balance pass moves the numbers and the tests still mean what they said.
// `expect(jumpHeight).toBe(120)` survives one afternoon; "jumping clears an
// obstacle that otherwise kills" survives the weekend.

const DT = 1 / 60;

/** Seconds of rise before the runner's feet clear a height of `h`. */
function riseTimeTo(h: number): number {
  const g = -GRAVITY;
  return (JUMP_V - Math.sqrt(JUMP_V * JUMP_V - 2 * g * h)) / g;
}

/** Seconds from launch to landing. */
const airTime = (2 * JUMP_V) / -GRAVITY;

/** The last moment a jump can start and still clear an obstacle. */
const latestClearingJump = riseTimeTo(OBSTACLE_H);

/**
 * A run already underway, with exactly one obstacle and spawning switched off,
 * so nothing but the obstacle under test can end it.
 *
 * `gapAhead` is clear track between the runner's leading edge and the
 * obstacle, which makes contact happen at exactly `gapAhead / speed` seconds.
 */
function oneObstacleAhead(gapAhead: number): GameState {
  return {
    ...createGame(1),
    status: "running",
    nextSpawnAt: Number.POSITIVE_INFINITY,
    obstacles: [
      { x: RUNNER_X + RUNNER_W + gapAhead, w: OBSTACLE_W, h: OBSTACLE_H },
    ],
  };
}

/** Advance for `seconds`, pressing jump on the first frame at or after each of `jumpAt`. */
function play(
  state: GameState,
  seconds: number,
  jumpAt: readonly number[] = [],
): GameState {
  const pending = [...jumpAt].sort((a, b) => a - b);
  let current = state;
  for (let t = 0; t < seconds; t += DT) {
    const jump = pending.length > 0 && pending[0]! <= t;
    if (jump) pending.shift();
    current = step(current, { jump }, DT);
    if (current.status === "over") break;
  }
  return current;
}

// The focused rule test the spec asks for: one rule, four cases, no mocking.
describe("jumping an obstacle", () => {
  // Far enough that a jump taken at t=0 lands well before contact.
  const gap = speedFor(START_BUDGET) * airTime * 2;
  const contact = gap / speedFor(START_BUDGET);
  const window = contact + airTime * 2;

  it("clears it when the jump is timed to be airborne over it", () => {
    const end = play(oneObstacleAhead(gap), window, [contact - airTime / 2]);
    expect(end.cause).toBeNull();
    expect(end.status).toBe("running");
  });

  it("ends the run when the same obstacle is not jumped", () => {
    const end = play(oneObstacleAhead(gap), window);
    expect(end.status).toBe("over");
    expect(end.cause).toBe("collision");
  });

  it("ends the run when the jump is begun too late", () => {
    const tooLate = contact - latestClearingJump / 2;
    const end = play(oneObstacleAhead(gap), window, [tooLate]);
    expect(end.status).toBe("over");
    expect(end.cause).toBe("collision");
  });

  it("ends the run when the jump is begun early enough to land first", () => {
    const end = play(oneObstacleAhead(gap), window, [0]);
    expect(end.status).toBe("over");
    expect(end.cause).toBe("collision");
  });
});

describe("endings", () => {
  it("a collision ends the run, so a wrong move is possible", () => {
    const gap = speedFor(START_BUDGET) * airTime;
    const end = play(oneObstacleAhead(gap), (gap / speedFor(START_BUDGET)) * 3);
    expect(end.status).toBe("over");
    expect(end.cause).toBe("collision");
  });

  it("running the budget dry ends the run, with nothing to collide with", () => {
    const thin: GameState = {
      ...createGame(7),
      status: "running",
      nextSpawnAt: Number.POSITIVE_INFINITY,
      budget: START_BUDGET / 10,
    };
    const end = play(thin, 60);
    expect(end.obstacles).toHaveLength(0);
    expect(end.status).toBe("over");
    expect(end.cause).toBe("drained");
    expect(remainingOf(end)).toBe(0);
  });

  it("the budget drains as the runner travels", () => {
    const start = oneObstacleAhead(Number.MAX_SAFE_INTEGER);
    const later = play(start, 1);
    expect(later.used).toBeGreaterThan(start.used);
    expect(remainingOf(later)).toBeLessThan(remainingOf(start));
  });
});

describe("the one input", () => {
  it("does nothing at all until the first press", () => {
    const idle = createGame(3);
    expect(play(idle, 5)).toEqual(idle);
  });

  it("starts the world and jumps on the same press", () => {
    const started = step(createGame(3), { jump: true }, DT);
    expect(started.status).toBe("running");
    expect(started.vy).toBeGreaterThan(0);
  });

  it("does not allow a second jump in mid-air", () => {
    const once = play(oneObstacleAhead(Number.MAX_SAFE_INTEGER), airTime / 2, [0]);
    const again = step(once, { jump: true }, DT);
    const drifting = step(once, { jump: false }, DT);
    expect(again.vy).toBe(drifting.vy);
  });

  it("restarts on the same input after the run is over", () => {
    const dead = play(oneObstacleAhead(speedFor(START_BUDGET) * airTime), 10);
    expect(dead.status).toBe("over");

    const restarted = step(dead, { jump: true }, DT);
    expect(restarted.status).toBe("running");
    expect(restarted.cause).toBeNull();
    expect(restarted.used).toBe(0);
    expect(restarted.budget).toBe(START_BUDGET);
  });
});

describe("speed", () => {
  // A property, not a number: pickups raise `budget` (step 7), and raising the
  // budget has to be what makes the rest of the run faster.
  it("increases monotonically with budget", () => {
    for (let budget = 0; budget < 20000; budget += 250) {
      expect(speedFor(budget + 250)).toBeGreaterThan(speedFor(budget));
    }
  });
});

// Sensor, not a contract: this one holds whatever the brief asks, so it comes
// with us into next week's repo. A reproducible run is what lets a bad moment
// you felt while playing be replayed instead of described.
describe("sensor: the simulation is deterministic", () => {
  const inputs = Array.from({ length: 1200 }, (_, i) => i % 37 === 0);

  function replay(seed: number): GameState {
    let state = createGame(seed);
    for (const jump of inputs) state = step(state, { jump }, DT);
    return state;
  }

  it("same seed and same inputs give an identical final state", () => {
    expect(replay(20260831)).toEqual(replay(20260831));
  });

  it("draws from the seed rather than from the ambient world", () => {
    expect(nextRandom(1).value).not.toBe(nextRandom(2).value);
    expect(nextRandom(1)).toEqual(nextRandom(1));
  });
});
