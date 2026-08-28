// Everything that touches the browser: the canvas, the render, the input, and
// the requestAnimationFrame loop. No game rule lives here — `src/game/rules.ts`
// owns those, and it stays DOM-free so vitest (node environment) can import it.
//
// The one direction of dependency worth stating: this file reads state and
// draws it. It never decides anything the simulation could have decided.

import {
  CARET_BLINK_MS,
  GROUND_DASH,
  GROUND_FRACTION,
  IDLE_SCROLL,
  OBSTACLE_W,
  RUNNER_H,
  RUNNER_W,
  RUNNER_X,
  WORLD_W,
} from "../game/config.ts";
import type { BarLevel, GameState, Pickup } from "../game/rules.ts";
import {
  barFraction,
  barLevel,
  createGame,
  invulnerable,
  step,
} from "../game/rules.ts";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const INK = "#7dfda6";
const FADED = "#4c8f68";
const DIM = "#1d3527";
const PAPER = "#05100a";
// Four colours, four meanings, and nothing borrows another's: green is you and
// the world, gold is worth taking, red kills you, cyan is the power-up.
const WARN = "#f2d857";
const CRIT = "#ff6b57";
const SHIELD = "#6be3ff";
/** Milliseconds per phase of the shielded runner's flash. */
const SHIELD_FLASH_MS = 90;
/** Drawn size of the power-up, world units. Its collision box is larger. */
const POWER_ICON = 26;
const FONT = `600 22px ${MONO}`;

const canvas = document.querySelector<HTMLCanvasElement>("#game");
// Strict TS makes both of these nullable, and narrowing them once here beats
// narrowing them in every draw call.
const ctx = canvas?.getContext("2d") ?? null;

if (canvas && ctx) {
  start(canvas, ctx);
}

function start(surface: HTMLCanvasElement, paint: CanvasRenderingContext2D) {
  let state = createGame(Math.floor(Date.now() % 2147483647));
  let pressed = false;
  let idleDrift = 0;
  // Session-only for now; step 11 moves this into localStorage.
  let best = 0;

  // --- input: one verb, three event sources ------------------------------
  //
  // The press is an edge, consumed by the next frame, so holding the key does
  // not hover and a press between frames is never dropped.
  const jump = () => {
    pressed = true;
  };

  const KEYS = new Set(["Space", "ArrowUp", "KeyW"]);
  addEventListener("keydown", (event) => {
    if (!KEYS.has(event.code) || event.repeat) return;
    // Space and ArrowUp scroll the page otherwise.
    event.preventDefault();
    jump();
  });

  // pointerdown covers mouse, pen and touch; the touchstart handler only stops
  // the browser's own gestures (double-tap zoom, pull-to-refresh) from eating
  // the tap. Cancelling it does not cancel the pointerdown already dispatched.
  surface.addEventListener("pointerdown", jump);
  surface.addEventListener("touchstart", (event) => event.preventDefault(), {
    passive: false,
  });

  // --- sizing -------------------------------------------------------------
  //
  // One virtual coordinate system: the world is WORLD_W units wide at every
  // viewport, so the same length of track is visible everywhere and reaction
  // time does not change with the screen. Height in units follows the aspect
  // ratio. Step 5 makes the canvas fill the viewport; the transform below is
  // already independent of how big that turns out to be.
  let worldH = WORLD_W / 2;

  const resize = () => {
    const dpr = devicePixelRatio || 1;
    const { width, height } = surface.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    surface.width = Math.round(width * dpr);
    surface.height = Math.round(height * dpr);
    const scale = (width / WORLD_W) * dpr;
    paint.setTransform(scale, 0, 0, scale, 0, 0);
    worldH = height / (width / WORLD_W);
  };

  addEventListener("resize", resize);
  resize();

  // --- loop ---------------------------------------------------------------

  let last = performance.now();

  const frame = (now: number) => {
    // A backgrounded tab hands back a delta of seconds. Clamping here rather
    // than in `step` keeps the rules ignorant of where frames come from.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    if (state.status === "idle") idleDrift += IDLE_SCROLL * dt;

    const wasOver = state.status === "over";
    state = step(state, { jump: pressed }, dt);
    pressed = false;
    if (!wasOver && state.status === "over") best = Math.max(best, state.used);

    render(paint, state, { worldH, idleDrift, best, now });
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

interface View {
  readonly worldH: number;
  readonly idleDrift: number;
  readonly best: number;
  readonly now: number;
}

function render(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
): void {
  const groundY = view.worldH * GROUND_FRACTION;

  paint.fillStyle = PAPER;
  paint.fillRect(0, 0, WORLD_W, view.worldH);

  drawGround(paint, state, view, groundY);
  drawPickups(paint, state, groundY);
  drawObstacles(paint, state, groundY);
  drawRunner(paint, state, view, groundY);

  if (state.status === "idle") {
    drawCaret(paint, view, RUNNER_X + RUNNER_W + 14, groundY, RUNNER_H);
  }

  drawBudget(paint, state);

  if (state.status === "over") drawEnding(paint, state, view);
}

/**
 * Dashes rather than a solid line: the drift is what makes the world read as
 * moving before the player has done anything, and a solid line cannot show it.
 */
function drawGround(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
  groundY: number,
): void {
  const offset = (state.distance + view.idleDrift) % GROUND_DASH;

  paint.fillStyle = DIM;
  paint.fillRect(0, groundY, WORLD_W, view.worldH - groundY);

  paint.fillStyle = INK;
  for (let x = -offset; x < WORLD_W; x += GROUND_DASH) {
    paint.fillRect(x, groundY, GROUND_DASH * 0.55, 2);
  }
}

function drawObstacles(
  paint: CanvasRenderingContext2D,
  state: GameState,
  groundY: number,
): void {
  paint.fillStyle = CRIT;
  for (const obstacle of state.obstacles) {
    const x = obstacle.x - state.distance;
    if (x < -OBSTACLE_W || x > WORLD_W) continue;
    paint.fillRect(x, groundY - obstacle.h, obstacle.w, obstacle.h);
  }
}

/**
 * Both token heights are gold, so "gold is worth taking" is one rule learned on
 * the first cluster and never re-taught; the shape carries the rest. Squares at
 * chest height are free, diamonds overhead cost a jump and pay more, and the
 * power-up is the only thing on screen in a colour nothing else uses.
 *
 * Drawing the tokens in the runner's green was the first attempt, and on screen
 * the avatar and the collectibles read as the same kind of thing.
 */
function drawPickups(
  paint: CanvasRenderingContext2D,
  state: GameState,
  groundY: number,
): void {
  for (const pickup of state.pickups) {
    const x = pickup.x - state.distance;
    if (x < -pickup.w || x > WORLD_W) continue;
    const y = groundY - pickup.y - pickup.h;

    if (pickup.kind === "power") {
      drawPower(paint, pickup, x, y);
    } else if (pickup.kind === "high") {
      drawDiamond(paint, pickup, x, y);
    } else {
      paint.fillStyle = WARN;
      paint.fillRect(x, y, pickup.w, pickup.h);
    }
  }
}

function drawDiamond(
  paint: CanvasRenderingContext2D,
  pickup: Pickup,
  x: number,
  y: number,
): void {
  paint.fillStyle = WARN;
  paint.beginPath();
  paint.moveTo(x + pickup.w / 2, y);
  paint.lineTo(x + pickup.w, y + pickup.h / 2);
  paint.lineTo(x + pickup.w / 2, y + pickup.h);
  paint.lineTo(x, y + pickup.h / 2);
  paint.closePath();
  paint.fill();
}

/**
 * Concentric squares — a reticle, not another token. The icon is drawn small
 * and centred inside a deliberately larger collision box (see `POWER_Y` and
 * friends), so the rare pickup is easier to take than it looks. Generous in the
 * player's favour is invisible; the reverse would be infuriating.
 */
function drawPower(
  paint: CanvasRenderingContext2D,
  pickup: Pickup,
  x: number,
  y: number,
): void {
  const size = POWER_ICON;
  const left = x + (pickup.w - size) / 2;
  const top = y + (pickup.h - size) / 2;
  const ring = 5;

  paint.fillStyle = SHIELD;
  paint.fillRect(left, top, size, size);
  paint.fillStyle = PAPER;
  paint.fillRect(left + ring, top + ring, size - ring * 2, size - ring * 2);
  paint.fillStyle = SHIELD;
  paint.fillRect(
    left + ring * 2,
    top + ring * 2,
    size - ring * 4,
    size - ring * 4,
  );
}

function drawRunner(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
  groundY: number,
): void {
  // The shield has no icon and no timer: the runner itself strobes in the
  // power-up's colour, so the thing that changed is the thing you are watching.
  const shielded =
    invulnerable(state) &&
    Math.floor(view.now / SHIELD_FLASH_MS) % 2 === 0;

  paint.fillStyle = state.status === "over" ? DIM : shielded ? SHIELD : INK;
  paint.fillRect(RUNNER_X, groundY - state.y - RUNNER_H, RUNNER_W, RUNNER_H);
}

/**
 * The whole tutorial. A terminal cursor blinking beside an idle runner is
 * already the universal "waiting for input" signal, and it is diegetic to the
 * look rather than a label sitting on top of the game.
 *
 * `x` is the caret's left edge and `bottom` the line it sits on, so the start
 * screen can stand one beside the runner and the death screen can stand the
 * same one under the score.
 */
function drawCaret(
  paint: CanvasRenderingContext2D,
  view: View,
  x: number,
  bottom: number,
  height: number,
): void {
  if (Math.floor(view.now / CARET_BLINK_MS) % 2 === 1) return;
  paint.fillStyle = INK;
  paint.fillRect(x, bottom - height, 16, height);
}

/** One colour per bar level. The level itself is decided in `rules.ts`. */
const BAR_INK: Record<BarLevel, string> = { ok: INK, warn: WARN, crit: CRIT };

/**
 * Wide, high-contrast and the only thing at the top of the screen: dying dry
 * has to be something the player watched happen. How full it is and what colour
 * it is are both `rules.ts`'s answers — this only paints them.
 */
function drawBudget(
  paint: CanvasRenderingContext2D,
  state: GameState,
): void {
  const margin = 40;
  const width = WORLD_W - margin * 2;
  const height = 22;
  const fraction = barFraction(state);

  paint.fillStyle = DIM;
  paint.fillRect(margin, margin, width, height);

  paint.fillStyle = BAR_INK[barLevel(state)];
  paint.fillRect(margin, margin, width * fraction, height);

  paint.fillStyle = INK;
  paint.font = FONT;
  paint.textAlign = "right";
  paint.textBaseline = "top";
  paint.fillText(String(Math.floor(state.used)), WORLD_W - margin, margin + height + 12);
}

function drawEnding(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
): void {
  const midY = view.worldH * 0.42;

  paint.fillStyle = "rgba(5, 16, 10, 0.82)";
  paint.fillRect(0, 0, WORLD_W, view.worldH);

  paint.textAlign = "center";
  paint.textBaseline = "middle";

  paint.fillStyle = INK;
  paint.font = `700 76px ${MONO}`;
  paint.fillText(String(Math.floor(state.used)), WORLD_W / 2, midY);

  paint.fillStyle = FADED;
  paint.font = FONT;
  paint.fillText(`BEST ${Math.floor(view.best)}`, WORLD_W / 2, midY + 64);

  // The same caret that invited the first press invites the next one. Without
  // it the death screen is two numbers and no offer, and a cold player has
  // nothing telling them the run is repeatable — the one thing the ending has
  // to communicate, and the only one it cannot say in words.
  drawCaret(paint, view, WORLD_W / 2 - 8, midY + 136, 30);
}
