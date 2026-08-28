import { describe, expect, it } from "vitest";
import {
  BOOST,
  GRAVITY,
  HIGH_TOKEN_LEAD,
  INVULN_MS,
  JUMP_V,
  OBSTACLE_H,
  OBSTACLE_W,
  RUNNER_W,
  RUNNER_X,
  START_BUDGET,
  TOKEN_CLEARANCE,
} from "../src/game/config.ts";
import type {
  GameState,
  Obstacle,
  Pickup,
  PickupKind,
} from "../src/game/rules.ts";
import {
  createGame,
  invulnerable,
  nextRandom,
  pickupAt,
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
 * A run already underway with every spawner switched off, so nothing but what
 * the test puts on the track can change the outcome.
 */
function quiet(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createGame(1),
    status: "running",
    nextObstacleAt: Number.POSITIVE_INFINITY,
    nextTokenAt: Number.POSITIVE_INFINITY,
    nextPowerAt: Number.POSITIVE_INFINITY,
    ...overrides,
  };
}

/** Clear track between the runner's leading edge and world x. */
function at(gapAhead: number): number {
  return RUNNER_X + RUNNER_W + gapAhead;
}

/**
 * One obstacle on an empty track. `gapAhead` is clear track between the
 * runner's leading edge and the obstacle, which makes contact happen at exactly
 * `gapAhead / speed` seconds.
 */
function oneObstacleAhead(gapAhead: number): GameState {
  return quiet({
    obstacles: [{ x: at(gapAhead), w: OBSTACLE_W, h: OBSTACLE_H }],
  });
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
    const thin = quiet({ seed: 7, budget: START_BUDGET / 10 });
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

// The pickups, asserted as relationships. Nothing below names a token's value
// or a token's height: what has to stay true is that collecting raises the
// ceiling, that raising the ceiling is what makes the run faster, and that the
// high ones cost a jump.
describe("tokens", () => {
  const speed = speedFor(START_BUDGET);
  const gap = speed * airTime * 2;
  const contact = gap / speed;
  const window = contact + airTime * 2;

  /** Run past one pickup, optionally jumping so as to be at the apex on contact. */
  function collectRun(kind: PickupKind, jump: boolean): GameState {
    const start = quiet({ pickups: [pickupAt(kind, at(gap))] });
    return play(start, window, jump ? [contact - airTime / 2] : []);
  }

  it("a ground token is collected by running through it", () => {
    const taken = collectRun("token", false);
    expect(taken.pickups).toHaveLength(0);
    expect(taken.status).toBe("running");
  });

  it("collecting raises the budget, and so the speed of the rest of the run", () => {
    const taken = collectRun("token", false);
    expect(taken.budget).toBeGreaterThan(START_BUDGET);
    expect(speedFor(taken.budget)).toBeGreaterThan(speedFor(START_BUDGET));
  });

  it("a high token cannot be reached from the ground", () => {
    // The budget is the tell, not the array: an uncollected pickup is culled
    // once it has scrolled past, exactly like a collected one.
    expect(collectRun("high", false).budget).toBe(START_BUDGET);
  });

  it("a high token is collected by jumping through it", () => {
    const taken = collectRun("high", true);
    expect(taken.pickups).toHaveLength(0);
    expect(taken.budget).toBeGreaterThan(START_BUDGET);
  });

  // The interesting shape, and the one thing that could silently stop working
  // when the physics or the heights are tuned: a high token hanging just past
  // an obstacle, exactly as the spawner pairs them.
  it("one jump can clear an obstacle and take the high token behind it", () => {
    const obstacleX = at(gap);
    const paired = quiet({
      obstacles: [{ x: obstacleX, w: OBSTACLE_W, h: OBSTACLE_H }],
      pickups: [pickupAt("high", obstacleX + OBSTACLE_W + HIGH_TOKEN_LEAD)],
    });

    // Scan the approach rather than naming a timing: what has to hold is that
    // some single jump takes both, and that not every safe jump does — the
    // token has to stay a decision rather than a bonus for surviving.
    const survived: number[] = [];
    const tookBoth: number[] = [];
    for (let t = contact - airTime; t < contact; t += DT) {
      const end = play(paired, window, [t]);
      if (end.status !== "running") continue;
      survived.push(t);
      if (end.budget > START_BUDGET) tookBoth.push(t);
    }

    expect(tookBoth.length).toBeGreaterThan(0);
    expect(survived.length).toBeGreaterThan(tookBoth.length);
  });

  it("a high token is worth more than a ground token", () => {
    const ground = collectRun("token", false).budget - START_BUDGET;
    const high = collectRun("high", true).budget - START_BUDGET;
    expect(high).toBeGreaterThan(ground);
  });
});

describe("the track", () => {
  /** Clear world units between a pickup and an obstacle, on whichever side. */
  function gapBetween(pickup: Pickup, obstacle: Obstacle): number {
    return pickup.x > obstacle.x
      ? pickup.x - (obstacle.x + obstacle.w)
      : obstacle.x - (pickup.x + pickup.w);
  }

  // A ground token jammed against a wall is uncollectable and reads as a bug
  // rather than a choice — and the obstacle it has to clear may not have been
  // created yet at the moment the token is placed, which is how it first got
  // through. Sweeping the two cursors past each other covers both orders.
  it("keeps reachable pickups clear of obstacles, spawned or pending", () => {
    for (let obstacleAt = 900; obstacleAt < 1700; obstacleAt += 37) {
      for (let tokenAt = 900; tokenAt < 1400; tokenAt += 29) {
        const track = play(
          quiet({
            nextObstacleAt: obstacleAt,
            nextTokenAt: tokenAt,
            nextPowerAt: tokenAt + 200,
          }),
          1.5,
        );

        for (const pickup of track.pickups) {
          // High tokens hang above every obstacle, so they are exempt.
          if (pickup.kind === "high") continue;
          for (const obstacle of track.obstacles) {
            expect(gapBetween(pickup, obstacle)).toBeGreaterThanOrEqual(
              TOKEN_CLEARANCE,
            );
          }
        }
      }
    }
  });
});

describe("the power-up", () => {
  const speed = speedFor(START_BUDGET);
  const boosted = speedFor(START_BUDGET + BOOST);
  const invuln = INVULN_MS / 1000;
  const gap = speed * airTime * 2;
  const contact = gap / speed;

  /**
   * A power-up, then an obstacle `after` seconds of post-pickup travel beyond
   * it — so `after` is measured in shield time, whatever the shield lasts.
   */
  function run(after: number, withPower: boolean): GameState {
    const powerX = at(gap);
    return play(
      quiet({
        pickups: withPower ? [pickupAt("power", powerX)] : [],
        obstacles: [
          { x: powerX + boosted * after, w: OBSTACLE_W, h: OBSTACLE_H },
        ],
      }),
      contact + after * 2 + airTime,
    );
  }

  it("raises the budget, and so the speed, like every other pickup", () => {
    const taken = play(
      quiet({ pickups: [pickupAt("power", at(gap))] }),
      contact + airTime,
    );
    expect(taken.budget).toBeGreaterThan(START_BUDGET);
    expect(speedFor(taken.budget)).toBeGreaterThan(speedFor(START_BUDGET));
  });

  it("makes survivable a collision that otherwise ends the run", () => {
    expect(run(invuln / 2, false).cause).toBe("collision");

    const shielded = run(invuln / 2, true);
    expect(shielded.status).toBe("running");
    expect(shielded.cause).toBeNull();
    // Destroyed rather than ignored: an obstacle the runner is still inside
    // when the shield expires must not kill them for a hit already survived.
    expect(shielded.obstacles).toHaveLength(0);
  });

  it("stops shielding after INVULN_MS", () => {
    const late = run(invuln * 1.5, true);
    expect(invulnerable(late)).toBe(false);
    expect(late.status).toBe("over");
    expect(late.cause).toBe("collision");
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
