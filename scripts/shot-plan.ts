// What `pnpm shots` photographs, and when. Pure data and arithmetic: no Chrome,
// no server, no side effects at import — `scripts/shot.ts` drives it, and
// `spec/shot-plan.test.ts` replays it through the rules to check the schedule
// still describes a run that is alive at the moment the shutter opens.
//
// It lives apart from the script for exactly that reason. A shot list nothing
// can import is a shot list nothing can check.
import {
  FIRST_OBSTACLE_X,
  FIRST_TOKEN_X,
  FLOAT_LIFE,
  GRAVITY,
  JUMP_V,
  OBSTACLE_H,
  OBSTACLE_W,
  RUNNER_W,
  RUNNER_X,
  START_BUDGET,
  TOKEN_SPACING,
} from "../src/game/config.ts";
import { speedFor } from "../src/game/rules.ts";

export interface Shot {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** Milliseconds after load at which to press. Empty means never. */
  readonly press: readonly number[];
  /** Milliseconds after load at which to photograph. */
  readonly at: number;
}

/**
 * The card is a real frame of the game, at exactly the size a scraper wants.
 * dpr 1 on purpose: the file has to *be* 1200x630, and the frame is flat fills
 * and one number, so there is nothing for the extra pixels to resolve.
 */
const CARD = { width: 1200, height: 630, dpr: 1 };

// The press rhythms are tuned against the opening stretch of track, which is
// fixed by `FIRST_TOKEN_X` and `FIRST_OBSTACLE_X` and therefore the same every
// run. They are also tuned against the *speed*, and that is the trap: the
// second press is a jump over the first obstacle, and a balance pass that moves
// SPEED_BASE moves when that obstacle arrives. Nothing in `check` notices — the
// runner dies, and the file called `desktop-run.png` quietly becomes a picture
// of the death screen. That happened once already, which is why the schedule is
// now derived rather than written down:
//
//   contact  the first obstacle's leading edge, at speedFor(START_BUDGET)
//   window   the jump must be above OBSTACLE_H for the whole overlap, which
//            leaves ~380ms of legal press times; JUMP takes the middle
//   apex     half an airtime later, with the runner over the obstacle
const START = 200;
const SPEED = speedFor(START_BUDGET);
/** Milliseconds from the opening press to the first obstacle's leading edge. */
const CONTACT = ((FIRST_OBSTACLE_X - RUNNER_X - RUNNER_W) / SPEED) * 1000;
/** Milliseconds the runner spends alongside it. */
const OVERLAP = ((OBSTACLE_W + RUNNER_W) / SPEED) * 1000;
/** Seconds of rise before the runner's feet clear a height of `h`. */
const riseTimeTo = (h: number): number =>
  (JUMP_V - Math.sqrt(JUMP_V * JUMP_V + 2 * GRAVITY * h)) / -GRAVITY;
const CLEARS = riseTimeTo(OBSTACLE_H) * 1000;
const AIRBORNE = ((2 * JUMP_V) / -GRAVITY) * 1000;
/** Latest and earliest presses that clear the obstacle; the shot takes the middle. */
const JUMP = START + (CONTACT - CLEARS + (CONTACT + OVERLAP - (AIRBORNE - CLEARS))) / 2;
/** The apex, which is where the runner is directly over the obstacle. */
const APEX = JUMP + AIRBORNE / 2;
/** Long enough after the fatal contact for the ending to have faded up. */
const ENDED = START + CONTACT + 1000;

// The pickup frames. What a pickup did is said in a word that lives for
// FLOAT_LIFE seconds and appears nowhere else — not in the DOM, not in `dist/`,
// not in any state a test can read — so if the schedule does not photograph one,
// nothing in this repo ever looks at it. `spec/shot-plan.test.ts` holds the
// shutter to it.
//
// Derived the same way the jump is, and for the same reason: the opening run of
// ground tokens starts at FIRST_TOKEN_X and is spaced TOKEN_SPACING apart, so a
// balance pass on either would otherwise leave these two files photographing
// empty track.
/** Milliseconds from the opening press to the first ground token. */
const TOKEN_CONTACT = ((FIRST_TOKEN_X - RUNNER_X - RUNNER_W) / SPEED) * 1000;
/** And to the third, which is where the stack of words is at its tallest. */
const THIRD_TOKEN = TOKEN_CONTACT + (2 * TOKEN_SPACING * 1000) / SPEED;
/**
 * A third of a life after that word appeared: past the pop, still at full
 * opacity, with the two below it partway through their fade.
 */
const COLLECTING = START + THIRD_TOKEN + FLOAT_LIFE * 1000 * 0.34;

/** The two marking viewports, idle, collecting and mid-run, plus an ending. */
export const SHOTS: readonly Shot[] = [
  { name: "desktop-idle", width: 1920, height: 1080, dpr: 1, press: [], at: 700 },
  { name: "desktop-pickup", width: 1920, height: 1080, dpr: 1, press: [START], at: COLLECTING },
  { name: "desktop-run", width: 1920, height: 1080, dpr: 1, press: [START, JUMP], at: APEX },
  { name: "desktop-over", width: 1920, height: 1080, dpr: 1, press: [START], at: ENDED },
  { name: "phone-idle", width: 390, height: 844, dpr: 3, press: [], at: 700 },
  { name: "phone-pickup", width: 390, height: 844, dpr: 3, press: [START], at: COLLECTING },
  { name: "phone-run", width: 390, height: 844, dpr: 3, press: [START, JUMP], at: APEX },
  { name: "phone-over", width: 390, height: 844, dpr: 3, press: [START], at: ENDED },
  { name: "card", ...CARD, press: [START, JUMP], at: APEX },
];
