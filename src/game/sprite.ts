// The Claude Code character, as data rather than as drawing code.
//
// It lives here, beside the rules, for the reason CLAUDE.md gives: a module
// that touches the canvas is a module the node test suite cannot import. The
// art is a list of rectangles and one predicate about how they sit in the
// collision box — both are facts, and facts belong somewhere a test can reach.
// `main.ts` turns them into `fillRect` calls and knows nothing else about the
// character's shape.
//
// The source is a 68x58 PNG of the character, transcribed at **one world unit
// per source pixel**. That 1:1 mapping is why `RUNNER_W` and `RUNNER_H` are 52
// and 45: the collision box is the sprite's own torso, and there is no scale
// factor anywhere to get wrong. `spec/game.test.ts` holds the two together.
//
// Coordinates are local to the torso's top-left corner, y down. Everything is
// a multiple of the source's 4-unit design grid, which is what keeps the
// character legible at 390px wide, where one world unit is 0.39 CSS px and the
// whole runner is 20px across.

import { RUNNER_H, RUNNER_W } from "./config.ts";

/**
 * `body` is the character's colour, whatever the renderer has decided that is
 * this frame — it strobes cyan under a shield and greys out on death, and the
 * sprite has no opinion about which. `hole` is punched through to the page
 * behind, so the eyes read as eyes at every tint rather than only at one.
 */
export type Ink = "body" | "hole";

export interface SpriteRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly ink: Ink;
}

/** How far each arm nub overhangs the torso, and therefore the collision box. */
export const ARM_OVERHANG = 8;

/** Legs, eyes and arm band are all one source cell tall or wide. */
const CELL = 4;
const LIMB_H = 9;

/** The torso: everything above the legs it stands on. */
const TORSO_H = RUNNER_H - LIMB_H;

const EYE_TOP = 9;
const ARM_TOP = 18;
/** Wide-set, near the torso's edges — the character's whole expression. */
const EYE_X: readonly number[] = [8, 40];
/** Two pairs with a gap up the middle, which is what reads as four legs. */
const LEG_X: readonly number[] = [8, 16, 32, 40];

/**
 * Drawn back to front: torso, then the arms that widen it, then the legs, then
 * the eyes punched through last. Order matters only for the eyes, and only
 * because they are subtractive.
 */
export const RUNNER_SPRITE: readonly SpriteRect[] = [
  { x: 0, y: 0, w: RUNNER_W, h: TORSO_H, ink: "body" },

  // The one part of the character that leaves its collision box, by
  // ARM_OVERHANG either side. That is deliberate and it errs the way this
  // codebase already errs (see `drawPower` in main.ts): an obstacle that
  // clips a nub is a graze the player survives, not a death they did not see
  // coming. The reverse — art narrower than the box — is the infuriating one.
  {
    x: -ARM_OVERHANG,
    y: ARM_TOP,
    w: RUNNER_W + ARM_OVERHANG * 2,
    h: LIMB_H,
    ink: "body",
  },

  ...LEG_X.map((x) => ({ x, y: TORSO_H, w: CELL, h: LIMB_H, ink: "body" as const })),
  ...EYE_X.map((x) => ({ x, y: EYE_TOP, w: CELL, h: LIMB_H, ink: "hole" as const })),
];

/**
 * The sprite's extent about the collision box's centre, which is the point the
 * renderer spins it on. Exactly as tall as the box and `ARM_OVERHANG` wider on
 * each side — and, because the overhang is symmetric, centred on the pivot in
 * both axes. That symmetry is what makes `groundedReach` a closed form instead
 * of a search over sixteen rotated corners.
 */
export const SPRITE_W = RUNNER_W + ARM_OVERHANG * 2;
export const SPRITE_H = RUNNER_H;

/**
 * Half the height of the sprite's bounding box once it is turned by `angle`.
 * The renderer puts the pivot this far above the runner's feet, so the
 * character's lowest point rides the ground line at every angle.
 *
 * The obvious version of this uses RUNNER_H / 2 and is wrong in a way that only
 * shows up every second landing: at rest the arm nubs stick out sideways and
 * cost nothing, but a quarter turn stands them on end, and the lower one sinks
 * ARM_OVERHANG straight through the floor. Using the *sprite's* box rather than
 * the collision box costs one constant and fixes it at every angle at once.
 */
export function groundedReach(angle: number): number {
  return (
    (Math.abs(SPRITE_W * Math.sin(angle)) +
      Math.abs(SPRITE_H * Math.cos(angle))) /
    2
  );
}

/** The sprite's own bounds, arms included. Wider than the collision box. */
export function spriteBounds(): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  const body = RUNNER_SPRITE.filter((rect) => rect.ink === "body");
  return {
    left: Math.min(...body.map((rect) => rect.x)),
    right: Math.max(...body.map((rect) => rect.x + rect.w)),
    top: Math.min(...body.map((rect) => rect.y)),
    bottom: Math.max(...body.map((rect) => rect.y + rect.h)),
  };
}
