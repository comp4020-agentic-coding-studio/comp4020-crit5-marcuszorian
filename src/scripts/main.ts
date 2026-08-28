// Everything that touches the browser: the canvas, the render, the input, and
// the requestAnimationFrame loop. No game rule lives here — `src/game/rules.ts`
// owns those, and it stays DOM-free so vitest (node environment) can import it.
//
// The one direction of dependency worth stating: this file reads state and
// draws it. It never decides anything the simulation could have decided.

import {
  BAR_CAP,
  BAR_CRIT,
  BAR_WARN,
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
import type { GameState } from "../game/rules.ts";
import { createGame, remainingOf, step } from "../game/rules.ts";

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const INK = "#7dfda6";
const FADED = "#4c8f68";
const DIM = "#1d3527";
const PAPER = "#05100a";
const WARN = "#f2d857";
const CRIT = "#ff6b57";
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
  drawObstacles(paint, state, groundY);
  drawRunner(paint, state, groundY);

  if (state.status === "idle") drawCaret(paint, view, groundY);

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

function drawRunner(
  paint: CanvasRenderingContext2D,
  state: GameState,
  groundY: number,
): void {
  paint.fillStyle = state.status === "over" ? DIM : INK;
  paint.fillRect(RUNNER_X, groundY - state.y - RUNNER_H, RUNNER_W, RUNNER_H);
}

/**
 * The whole tutorial. A terminal cursor blinking beside an idle runner is
 * already the universal "waiting for input" signal, and it is diegetic to the
 * look rather than a label sitting on top of the game.
 */
function drawCaret(
  paint: CanvasRenderingContext2D,
  view: View,
  groundY: number,
): void {
  if (Math.floor(view.now / CARET_BLINK_MS) % 2 === 1) return;
  paint.fillStyle = INK;
  paint.fillRect(RUNNER_X + RUNNER_W + 14, groundY - RUNNER_H, 16, RUNNER_H);
}

/**
 * Fixed-cap bar, not a percentage of budget: at a constant cap every pickup is
 * the same visible bump all run, so the pickup-to-bar link keeps teaching.
 * Headroom above the cap still counts toward budget and speed, it just isn't
 * drawn.
 */
function drawBudget(
  paint: CanvasRenderingContext2D,
  state: GameState,
): void {
  const margin = 40;
  const width = WORLD_W - margin * 2;
  const height = 22;
  const fraction = Math.max(0, Math.min(1, remainingOf(state) / BAR_CAP));

  paint.fillStyle = DIM;
  paint.fillRect(margin, margin, width, height);

  paint.fillStyle = fraction <= BAR_CRIT ? CRIT : fraction <= BAR_WARN ? WARN : INK;
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
}
