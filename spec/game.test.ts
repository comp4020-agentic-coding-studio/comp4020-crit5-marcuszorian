import { describe, expect, it } from "vitest";
import {
  BOOST,
  GRAVITY,
  HIGH_TOKEN_H,
  HIGH_TOKEN_LEAD,
  HIGH_TOKEN_VALUE,
  HIGH_TOKEN_Y,
  INVULN_MS,
  JUMP_V,
  OBSTACLE_H,
  OBSTACLE_W,
  RUNNER_H,
  RUNNER_W,
  RUNNER_X,
  SPEED_MAX,
  SPEED_START,
  START_BUDGET,
  START_TOKENS,
  TOKEN_CLEARANCE,
  TOKEN_RUN_MAX,
} from "../src/game/config.ts";
import {
  ARM_OVERHANG,
  RUNNER_SPRITE,
  groundedReach,
  spriteBounds,
} from "../src/game/sprite.ts";
import type {
  BarLevel,
  GameState,
  Obstacle,
  Pickup,
  PickupKind,
} from "../src/game/rules.ts";
import {
  airProgress,
  barFraction,
  barLevel,
  createGame,
  invulnFraction,
  invulnerable,
  nextRandom,
  overlaps,
  pickupAt,
  pickupValue,
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
    // `createGame` hands back the first screen of the level already spawned, so
    // that the start screen is the run's own first frame rather than a title
    // card. An isolated track has to clear it as well as switching the spawners
    // off, or every test below runs through the opening token run first.
    obstacles: [],
    pickups: [],
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
    // A thin pool, not a low ceiling: the ceiling sets the speed, and dropping
    // it would make this a test of a slower runner as much as a poorer one.
    const thin = quiet({ seed: 7, tokens: START_BUDGET / 10 });
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
    // The pool resets too, and to the same opening value — a restart that kept
    // a dead run's empty pool would end again immediately.
    expect(restarted.tokens).toBeCloseTo(START_TOKENS, 0);
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

  // The three below pin the *shape* of that increase — a curve that starts
  // where the rest of the game's timings assume, ramps hardest while the player
  // is still learning the jump, and eases toward a top end instead of running
  // away past it. None of them names a speed: they read the constants and
  // assert the relationships between them, so a balance pass on SPEED_MAX or
  // SPEED_CURVE moves the game and leaves the suite meaning what it said.

  /**
   * Load-bearing well beyond this file. `scripts/shot-plan.ts` times the
   * screenshots off `speedFor(START_BUDGET)`, the first obstacle's arrival is
   * measured against it, and the RUNNER_W note in `config.ts` quotes a press
   * window derived from it. Reshaping the curve had to leave its own origin
   * alone, and this is what says so.
   */
  it("opens at the speed the rest of the game is timed against", () => {
    expect(speedFor(START_BUDGET)).toBe(SPEED_START);
  });

  /**
   * The curve leans into `SPEED_MAX` rather than through it. 100k is ~33x the
   * opening ceiling and some two orders of magnitude past anything a run
   * reaches — the point being that there is no budget a player can earn that
   * takes the game faster than the number in `config.ts`.
   *
   * The second assertion is the other half, and the one that stops SPEED_MAX
   * from quietly becoming a decoration: the top end has to be somewhere the
   * curve actually goes, not an asymptote it creeps at.
   */
  it("leans into a top end no reachable ceiling passes", () => {
    for (const budget of [START_BUDGET, 10_000, 30_000, 100_000]) {
      expect({ budget, below: speedFor(budget) < SPEED_MAX }).toEqual({
        budget,
        below: true,
      });
    }
    expect(SPEED_MAX - speedFor(100_000)).toBeLessThan(1);
  });

  /**
   * Concavity, which is the whole difference between this curve and the line it
   * replaced: the same pickup is worth more speed early than late. Swept a high
   * token at a time, because a high token is the increment the game actually
   * deals in, and reported with its budget so a failure names where the curve
   * stopped easing rather than saying `false !== true`.
   *
   * Note what this does *not* say — that a late pickup is worth less. It is
   * worth exactly as much: `HIGH_TOKEN_VALUE` of ceiling, and ceiling is what
   * keeps you alive. Only the difficulty it drags along behind it tails off.
   */
  it("buys less speed the higher the ceiling already is", () => {
    let previous = Infinity;
    for (
      let budget = START_BUDGET;
      budget < 30_000;
      budget += HIGH_TOKEN_VALUE
    ) {
      const gained = speedFor(budget + HIGH_TOKEN_VALUE) - speedFor(budget);
      expect({ budget, easing: gained < previous }).toEqual({
        budget,
        easing: true,
      });
      previous = gained;
    }
  });
});

// The pickups, asserted as relationships. Nothing below names a token's value
// or a token's height: what has to stay true is that every pickup pays, that
// only the ones costing a jump raise the ceiling, that raising the ceiling is
// what makes the run faster, and that the high ones cost a jump.
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

  /**
   * What one pickup is worth, measured against the identical frame without it:
   * how much went into the pool, and how much the ceiling moved.
   *
   * One frame, with the runner parked at the pickup's own height, because the
   * alternative — running past it — makes the two arms travel different
   * distances the moment the ceiling moves, and drain is a function of
   * distance. A single step holds everything but the pickup equal.
   */
  function payoutOf(
    kind: PickupKind,
    overrides: Partial<GameState> = {},
  ): { pool: number; ceiling: number } {
    const y =
      kind === "high" ? HIGH_TOKEN_Y + HIGH_TOKEN_H / 2 - RUNNER_H / 2 : 0;
    const bare = quiet({ y, ...overrides });
    const one = { ...bare, pickups: [pickupAt(kind, RUNNER_X + RUNNER_W / 2)] };
    const without = step(bare, { jump: false }, DT);
    const with_ = step(one, { jump: false }, DT);
    expect(with_.pickups).toHaveLength(0);
    return {
      pool: remainingOf(with_) - remainingOf(without),
      ceiling: with_.budget - without.budget,
    };
  }

  it("a ground token is collected by running through it", () => {
    const taken = collectRun("token", false);
    expect(taken.pickups).toHaveLength(0);
    expect(taken.status).toBe("running");
  });

  // The economy's one distinction, and the reason the jump is worth taking a
  // risk for: what you run through keeps you alive, and what you leave the
  // ground for makes the window itself bigger.
  it("a ground token pays into the pool and leaves the ceiling alone", () => {
    const { pool, ceiling } = payoutOf("token");
    expect(pool).toBeGreaterThan(0);
    expect(ceiling).toBe(0);
  });

  it("a high token raises the ceiling and pays nothing into the pool", () => {
    const { pool, ceiling } = payoutOf("high");
    expect(pool).toBe(0);
    expect(ceiling).toBeGreaterThan(0);
  });

  it("only the pickups you jump for make the rest of the run faster", () => {
    const ground = collectRun("token", false);
    const high = collectRun("high", true);
    expect(speedFor(ground.budget)).toBe(speedFor(START_BUDGET));
    expect(speedFor(high.budget)).toBeGreaterThan(speedFor(START_BUDGET));
  });

  // The two runs travel identically — a ground token no longer moves the speed
  // — so this is the same stretch of track with and without one pickup on it.
  it("a ground token still buys survival on the stretch it is taken", () => {
    const taken = collectRun("token", false);
    const missed = play(quiet(), window);
    expect(taken.distance).toBeCloseTo(missed.distance);
    expect(remainingOf(taken)).toBeGreaterThan(remainingOf(missed));
  });

  /**
   * The decision the cap exists to pose. At a full pool a free token spills, so
   * the only way to keep earning is to jump for capacity you cannot spend yet —
   * a high token pays you nothing at the moment you take it and is worth a whole
   * ground token afterwards.
   *
   * Two arms rather than an assertion about one, because "the ceiling rose" is
   * not the claim. The claim is that raising it is what turns the next free
   * token from waste back into tokens, and that only shows up in what the *next*
   * pickup is worth.
   */
  it("a full pool spills a free token, and raising the ceiling is what stops it", () => {
    const full = { tokens: START_BUDGET };
    expect(payoutOf("token", full).pool).toBeLessThan(pickupValue("token"));

    const roomier = { tokens: START_BUDGET, budget: START_BUDGET + pickupValue("high") };
    expect(payoutOf("token", roomier).pool).toBeCloseTo(pickupValue("token"));
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

  /**
   * The two pickups pay in different currencies, so the only honest comparison
   * is what each is worth in the end — and the capacity a high token grants is
   * only ever worth the ground tokens it lets you keep. It has to buy back more
   * than one of them, or the jump is a worse deal than the coin you could have
   * run through instead, and the risk has no reward attached.
   */
  it("the capacity a high token grants buys back more than one free token", () => {
    expect(pickupValue("high")).toBeGreaterThan(pickupValue("token"));
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

  // The power-up stands on the ground at the same height as a run of coins, and
  // its icon is drawn over the top of one, so a coin underneath it is a pickup
  // the player is never shown. Either cursor can be the one that got there
  // first, so this sweeps them past each other in both orders.
  it("never puts a power-up and a ground token in the same place", () => {
    let bothSeen = 0;

    for (let powerAt = 900; powerAt < 1450; powerAt += 43) {
      for (let tokenAt = 900; tokenAt < 1450; tokenAt += 31) {
        // Short enough that nothing placed at 900 or beyond has scrolled past
        // the runner and out of `pickups` by the time it is inspected.
        const track = play(
          quiet({ nextTokenAt: tokenAt, nextPowerAt: powerAt }),
          1.5,
        );

        const powers = track.pickups.filter((p) => p.kind === "power");
        const tokens = track.pickups.filter((p) => p.kind === "token");
        if (powers.length > 0 && tokens.length > 0) bothSeen += 1;

        for (const power of powers) {
          for (const token of tokens) {
            expect({
              powerAt,
              tokenAt,
              collides: overlaps(power, token),
            }).toMatchObject({ collides: false });
          }
        }
      }
    }

    // A clearance sweep over an empty track passes no matter what the spawner
    // does, so the sweep has to say how much track it actually walked.
    expect(bothSeen).toBeGreaterThan(100);
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

  it("raises the ceiling, and so the speed", () => {
    const taken = play(
      quiet({ pickups: [pickupAt("power", at(gap))] }),
      contact + airTime,
    );
    expect(taken.budget).toBeGreaterThan(START_BUDGET);
    expect(speedFor(taken.budget)).toBeGreaterThan(speedFor(START_BUDGET));
  });

  /**
   * The one pickup that does both, and the only thing in the game that fills the
   * pool outright. Taken from nearly empty, which is where it matters and where
   * a grant of `BOOST` tokens would have looked the same — the difference is
   * that a fill is worth the *new* ceiling, so the assertion is against that and
   * not against any amount.
   */
  it("fills the pool to the ceiling it just raised", () => {
    const nearlyDry = quiet({
      tokens: START_BUDGET * 0.3,
      pickups: [pickupAt("power", at(gap))],
    });
    expect(barFraction(nearlyDry)).toBeLessThan(0.5);
    // The collecting frame itself, not a fixed time: `collect` runs after the
    // drain within a step, so the pool is exactly full there and a frame late
    // it is already a hair below. Stepping to the pickup rather than to a clock
    // is what lets this assert equality instead of closeness.
    let taken = nearlyDry;
    while (taken.pickups.length > 0 && taken.status === "running") {
      taken = step(taken, { jump: false }, DT);
    }
    expect(taken.status).toBe("running");

    expect(taken.budget).toBe(START_BUDGET + BOOST);
    expect(remainingOf(taken)).toBe(taken.budget);
    expect(barFraction(taken)).toBe(1);
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

  // The shield bar under the HUD draws `invulnFraction` directly, so this is
  // the readout: it is full the moment the power-up is taken, empty whenever
  // nothing is shielding, and strictly falling in between. Sampled across the
  // window rather than at picked instants, so it stays true if INVULN_MS moves.
  it("reads full at pickup, empties as it expires, and is zero otherwise", () => {
    const cold = quiet();
    expect(invulnerable(cold)).toBe(false);
    expect(invulnFraction(cold)).toBe(0);

    const taken = play(
      quiet({ pickups: [pickupAt("power", at(gap))] }),
      contact + DT,
    );
    expect(invulnFraction(taken)).toBeCloseTo(1, 2);

    let previous = invulnFraction(taken);
    for (let t = invuln / 8; t <= invuln * 1.25; t += invuln / 8) {
      const later = play(taken, t);
      const now = invulnFraction(later);
      expect({ t, falling: now < previous || now === 0 }).toEqual({
        t,
        falling: true,
      });
      expect(now).toBeGreaterThanOrEqual(0);
      previous = now;
    }
    // Past the end of the window the bar is gone, not pinned at a sliver.
    expect(previous).toBe(0);
    expect(invulnerable(play(taken, invuln * 1.25))).toBe(false);
  });
});

// The no-tutorial rule, in the two places it is mechanical. Whether the game
// *teaches itself* is a person's call at the crit and no test replaces that —
// but the two things the teaching is built out of are orderings, and orderings
// hold still long enough to assert. See plan/03-feel-and-teaching.md.
describe("teaching the game without words", () => {
  /**
   * Play from cold, pressing every `period` seconds; `0` presses once and then
   * watches. True if the bar went *up* before the runner reached the far side of
   * the first obstacle — that is, if the game paid out before it punished.
   *
   * A frame-to-frame rise, not a comparison against the opening value. The pool
   * drains every frame, so a token collected late in the approach can leave the
   * bar below where it started and still be the payout this is looking for; the
   * only unambiguous evidence is the one frame where the number went the wrong
   * way for drain. It also no longer watches `budget`: ground tokens stopped
   * touching the ceiling, and the ceiling is not what the opening run teaches.
   */
  function taughtBeforeFirstObstacle(seed: number, period: number): boolean {
    let state = step(createGame(seed), { jump: true }, DT);
    let sincePress = 0;

    for (let t = 0; t < 30 && state.status === "running"; t += DT) {
      sincePress += DT;
      const press = period > 0 && sincePress >= period;
      if (press) sincePress = 0;
      const before = remainingOf(state);
      state = step(state, { jump: press }, DT);

      if (remainingOf(state) > before) return true;
      const lead = state.distance + RUNNER_X + RUNNER_W;
      if (state.obstacles.some((obstacle) => lead > obstacle.x + obstacle.w)) {
        return false;
      }
    }
    return false;
  }

  // Sweeping the cadence is the whole value of this test. A player pressing at
  // roughly the jump's own airtime is airborne over every run of ground tokens,
  // and at 3-6 tokens a run covered less track than one jump — 8% of seeds
  // reached an obstacle having been taught nothing at all. The first run is now
  // always the longest one; this is what stops that regressing.
  const cadences = [0, 0.2, 0.35, 0.5, 0.65, 0.7, 0.75, 0.8, 1, 1.5];

  it("pays out a ground token before the first obstacle, at every press rhythm", () => {
    for (const period of cadences) {
      for (let seed = 1; seed <= 120; seed += 1) {
        // Reported as an object so a failure names the cadence and the seed
        // rather than saying `false !== true`.
        expect({ period, seed, taught: taughtBeforeFirstObstacle(seed, period) })
          .toEqual({ period, seed, taught: true });
      }
    }
  });

  /**
   * The opening bar is deliberately short of full, and it has to be. The first
   * run of ground tokens is the teaching one and it teaches by *moving the bar*
   * — but a ground token now tops up a pool capped at the ceiling, so a run that
   * started full would clip every one of them and show nothing at all. See
   * `START_TOKENS`.
   *
   * The headroom is the assertion, not the fraction: enough for the whole first
   * run to land uncut, and not so much that the opening frame is painted amber.
   */
  it("starts the bar with room for the whole first run to show", () => {
    const opening = createGame(1);
    const headroom = opening.budget - remainingOf(opening);
    expect(headroom).toBeGreaterThanOrEqual(TOKEN_RUN_MAX * pickupValue("token"));
    expect(barLevel(opening)).toBe("ok");
  });

  it("moves the bar when a token is collected", () => {
    // Below the cap, where the bar is not pinned: the pickup-to-bar link is
    // what teaches "gold is worth taking", so it has to be a visible step.
    //
    // The comparison is the same stretch of track with and without the token,
    // not before-and-after: the bar is always draining, and whether one token
    // out-earns half a second of DRAIN is a balance number that moves. What has
    // to stay true is that taking it leaves you better off than not taking it.
    const drained = quiet({ tokens: START_BUDGET / 2 });
    const missed = play(drained, 0.5);
    const taken = play({ ...drained, pickups: [pickupAt("token", at(10))] }, 0.5);
    expect(taken.pickups).toHaveLength(0);
    expect(barFraction(taken)).toBeGreaterThan(barFraction(missed));
  });
});

describe("dying dry is legible", () => {
  it("holds each warning colour long enough to be read", () => {
    let state = quiet({ seed: 11 });
    const seen: BarLevel[] = [barLevel(state)];
    const held = new Map<BarLevel, number>();

    for (let t = 0; t < 300 && state.status === "running"; t += DT) {
      state = step(state, { jump: false }, DT);
      const level = barLevel(state);
      held.set(level, (held.get(level) ?? 0) + DT);
      if (level !== seen[seen.length - 1]) seen.push(level);
    }

    expect(state.cause).toBe("drained");
    // The bar never jumps a colour: you are shown amber, then red, then dead.
    expect(seen).toEqual(["ok", "warn", "crit"]);
    // Two seconds is a floor on a person noticing a colour change, not a
    // tuning number — the balance pass may move the drain, but it may not make
    // running out of budget a surprise.
    expect(held.get("warn")).toBeGreaterThan(2);
    expect(held.get("crit")).toBeGreaterThan(2);
    expect(barFraction(state)).toBe(0);
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

describe("the runner's spin", () => {
  it("runs 0 to 1 across exactly one jump arc, and rests at 0", () => {
    const still = quiet();
    expect(airProgress(still)).toBe(0);

    let state = step(still, { jump: true }, DT);
    const seen: number[] = [];
    for (let t = 0; t < airTime * 2 && state.y > 0; t += DT) {
      seen.push(airProgress(state));
      state = step(state, { jump: false }, DT);
    }

    // A quarter turn that stalled, reversed or overshot would all look wrong on
    // screen in a way no other assertion here would catch.
    expect(seen[0]).toBeLessThan(DT / airTime + 0.01);
    expect(seen.at(-1)).toBeGreaterThan(1 - 2 * (DT / airTime) - 0.01);
    for (let i = 1; i < seen.length; i += 1) {
      // Reported as an object so a failure names the frame it turned around on,
      // rather than saying `false !== true` somewhere in a forty-frame arc.
      expect({
        frame: i,
        prev: seen[i - 1]!,
        next: seen[i]!,
        rising: seen[i]! > seen[i - 1]!,
      }).toMatchObject({ rising: true });
    }

    // Landed: back on its feet, and the renderer stops adding to the angle.
    expect(state.y).toBe(0);
    expect(airProgress(state)).toBe(0);
  });

  it("reads the apex as the halfway point of the turn", () => {
    // Derived from the physics, not from a stopwatch: the apex is where `vy`
    // crosses zero, so half the arc has to be half the spin.
    let state = step(quiet(), { jump: true }, DT);
    while (state.vy > 0) state = step(state, { jump: false }, DT);
    expect(airProgress(state)).toBeCloseTo(0.5, 1);
  });
});

// Sensor, not a contract: the drawn character and the box it is judged against
// are declared in two different files, and nothing else in `check` would notice
// them drifting apart. A sprite narrower than its hitbox is the bug that reads
// as "the game cheated" — you die to a gap you could see through.
describe("sensor: the runner's art fits the box it collides in", () => {
  const bounds = spriteBounds();

  it("fills its collision box exactly, top to bottom and edge to edge", () => {
    expect(bounds.top).toBe(0);
    expect(bounds.bottom).toBe(RUNNER_H);
    // Only the arm nubs leave the box, and only sideways: art wider than the
    // hitbox is a graze the player survives, which is the forgiving direction.
    expect(bounds.left).toBe(-ARM_OVERHANG);
    expect(bounds.right).toBe(RUNNER_W + ARM_OVERHANG);
    expect(
      RUNNER_SPRITE.some(
        (rect) => rect.ink === "body" && rect.x === 0 && rect.w === RUNNER_W,
      ),
    ).toBe(true);
  });

  // Regression, and the reason `groundedReach` exists. The first version of the
  // spin pivoted on RUNNER_H / 2, which is right at rest and wrong the moment
  // the character is on its side: a quarter turn stands the arm nubs on end and
  // the lower one goes through the floor. Nothing in `check` saw it — a canvas
  // is not text — and it took a screenshot to find. So it is a sweep now, and
  // it reports the angle rather than saying `false !== true`.
  it("never sinks below its own feet, at any angle of the spin", () => {
    for (let turn = 0; turn <= 96; turn += 1) {
      const angle = (turn / 96) * Math.PI * 2;
      const reach = groundedReach(angle);
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      // Every corner of every drawn rectangle, through the same transform the
      // renderer applies: pivot on the box centre, turn, then drop by `reach`.
      // Measured downward from the ground line, so positive is buried.
      let deepest = Number.NEGATIVE_INFINITY;
      for (const rect of RUNNER_SPRITE) {
        for (const cx of [rect.x, rect.x + rect.w]) {
          for (const cy of [rect.y, rect.y + rect.h]) {
            const px = cx - RUNNER_W / 2;
            const py = cy - RUNNER_H / 2;
            deepest = Math.max(deepest, px * sin + py * cos - reach);
          }
        }
      }

      // Two different claims, and only one of them is "touching".
      //
      // Buried is never allowed: that is the bug this test is named after, and
      // it is what a player sees as the character wading through the floor.
      //
      // Resting exactly on the line is only required at the quarter turns,
      // because those are the only angles the character is ever still at. In
      // between, `groundedReach` measures the sprite's *bounding box*, whose
      // corners are empty air — the arm nubs and the torso do not meet at one —
      // so the silhouette floats by up to a third of its height at 45°. That
      // happens at the apex of a jump, 150 units up, where nothing can see it.
      const degrees = Math.round((angle * 180) / Math.PI);
      const resting = degrees % 90 === 0;
      expect({
        degrees,
        gap: Number(deepest.toFixed(6)),
        buried: deepest > 1e-9,
        planted: !resting || Math.abs(deepest) < 1e-9,
      }).toMatchObject({ buried: false, planted: true });
    }
  });

  it("keeps the eyes inside the torso, whatever the box becomes", () => {
    for (const eye of RUNNER_SPRITE.filter((rect) => rect.ink === "hole")) {
      expect({
        eye,
        box: { w: RUNNER_W, h: RUNNER_H },
        inside:
          eye.x >= 0 &&
          eye.x + eye.w <= RUNNER_W &&
          eye.y >= 0 &&
          eye.y + eye.h <= RUNNER_H,
      }).toMatchObject({ inside: true });
    }
  });
});
