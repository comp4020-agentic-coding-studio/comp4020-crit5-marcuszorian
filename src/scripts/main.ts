// Everything that touches the browser: the canvas, the render, the input, and
// the requestAnimationFrame loop. No game rule lives here — `src/game/rules.ts`
// owns those, and it stays DOM-free so vitest (node environment) can import it.
//
// The one direction of dependency worth stating: this file reads state and
// draws it. It never decides anything the simulation could have decided. The
// two exceptions are deliberate and both are presentation: the death-screen
// input lockout (a press must not be eaten by a screen the player has not seen
// yet) and the HUD's scale (see `HUD_REFERENCE_H` in config).

import {
  CARET_BLINK_MS,
  GROUND_DASH,
  GROUND_FRACTION,
  HUD_REFERENCE_H,
  HUD_SCALE_MAX,
  IDLE_SCROLL,
  OBSTACLE_W,
  PLAY_BAND,
  RUNNER_H,
  RUNNER_W,
  RUNNER_X,
  WORLD_W,
} from "../game/config.ts";
import type { BarLevel, GameState, Pickup, PickupKind } from "../game/rules.ts";
import {
  barFraction,
  barLevel,
  createGame,
  grounded,
  invulnerable,
  step,
} from "../game/rules.ts";
import { createSound } from "./audio.ts";
import type { Sound, Voice } from "./audio.ts";
import { createEffects } from "./effects.ts";
import type { Effects } from "./effects.ts";

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
/** Base HUD type size, world units. Multiplied by the layout's `hud` scale. */
const HUD_FONT = 22;
/** Base HUD margin and bar height, world units. Also scaled. */
const HUD_MARGIN = 40;
const HUD_BAR_H = 22;

// --- juice ------------------------------------------------------------------
//
// Numbers reached by watching, not by deriving: the death shake is the biggest
// thing on screen and everything else is quieter than you would guess from the
// code. All of it is decoration — see src/scripts/effects.ts.

/** Screen shake: world units of displacement, and seconds to decay over. */
const SHAKE_DEATH = 30;
const SHAKE_DEATH_MS = 420;
const SHAKE_POWER = 7;
const SHAKE_POWER_MS = 180;

/** How long the death screen takes to fade up, seconds. */
const ENDING_FADE = 0.5;
/**
 * Presses swallowed after a death, seconds. The same button jumps and restarts,
 * so without this a player mashing through a hard section restarts before the
 * death screen has finished appearing and never sees their score.
 */
const ENDING_LOCKOUT = 0.45;

/** Per-kind pickup bursts. Value and noise both go up with height. */
const PICKUP_BURST: Record<PickupKind, { count: number; speed: number; life: number; size: number; colour: string }> = {
  token: { count: 7, speed: 210, life: 0.4, size: 6, colour: WARN },
  high: { count: 12, speed: 320, life: 0.55, size: 7, colour: WARN },
  power: { count: 26, speed: 430, life: 0.8, size: 8, colour: SHIELD },
};

// --- the scrollback sky -------------------------------------------------------
//
// Laid out once at module load and then only read: the shape of the output
// never changes, so a frame is a couple of hundred `fillRect`s over a static
// table rather than a fresh dice roll.

interface SkyWord {
  readonly x: number;
  readonly w: number;
}

/** Enough rows for the tallest world any phone hands us. */
const SKY_ROWS = 56;
const SKY_LINE_H = 36;
const SKY_WORD_H = 7;
/** Length of the strip the output repeats over. Longer than the world is wide,
 *  so a row is blank about as often as it is not — output is ragged. */
const SKY_SPAN = 1800;
const SKY_PARALLAX = 0.18;
const SKY_ALPHA = 0.075;
/**
 * Clear air immediately above the ground, world units. Just enough that the
 * dashed ground line never has a row sitting on it; the jump arc itself is
 * fair game, because at 7.5% alpha these are background and the runner is a
 * solid bar drawn over them. Clearing the whole arc (~208 units) instead left
 * a desktop world — only ~543 units tall — with nothing between bar and ground.
 */
const SKY_CLEAR = 90;

const SKY: readonly (readonly SkyWord[])[] = buildSky();

function buildSky(): readonly (readonly SkyWord[])[] {
  const rows: SkyWord[][] = [];
  for (let row = 0; row < SKY_ROWS; row += 1) {
    const words: SkyWord[] = [];
    let x = noise(row, 1) * SKY_SPAN;
    const count = 2 + Math.floor(noise(row, 2) * 7);
    for (let i = 0; i < count; i += 1) {
      const w = 24 + noise(row, 3 + i) * 96;
      words.push({ x, w });
      x += w + 16;
    }
    rows.push(words);
  }
  return rows;
}

/** Hash, not a generator: the same row always lays out the same way. */
function noise(a: number, b: number): number {
  const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Where the best score lives. Namespaced: a Pages origin is shared. */
const BEST_KEY = "context-window:best";
const MUTE_KEY = "context-window:muted";

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
  let best = readNumber(BEST_KEY);
  /** Seconds since the run ended; drives the fade and the lockout. */
  let sinceOver = 0;

  const sound = createSound();
  // Screen shake is the one thing here that moves the whole frame, so it is the
  // one thing reduced-motion has to take away. Particles stay: they are small,
  // local, and short, and a game with no feedback at all is a worse answer.
  const shakeable = createEffects();
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const effects: Effects = calm
    ? { ...shakeable, shake: () => {} }
    : shakeable;
  let muted = readNumber(MUTE_KEY) === 1;
  sound.setMuted(muted);

  // --- input: one verb, three event sources ------------------------------
  //
  // The press is an edge, consumed by the next frame, so holding the key does
  // not hover and a press between frames is never dropped.
  const jump = () => {
    // Every path to a press is a user gesture, which is exactly what the
    // autoplay policy wants before the first sound. Cheap after the first call.
    sound.unlock();
    pressed = true;
  };

  const KEYS = new Set(["Space", "ArrowUp", "KeyW"]);
  addEventListener("keydown", (event) => {
    if (!KEYS.has(event.code) || event.repeat) return;
    // Space and ArrowUp scroll the page otherwise — and Space would also
    // activate the audio button whenever it happens to hold focus.
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

  // --- the audio toggle ---------------------------------------------------
  //
  // The one control the chrome carries. A game that starts making noise in a
  // room full of people needs a way to stop, and burying it in a keystroke
  // would be an instruction the game is not allowed to write down.
  const toggle = document.querySelector<HTMLButtonElement>("#audio");
  const paintToggle = () => {
    if (!toggle) return;
    toggle.textContent = muted ? "audio off" : "audio on";
    toggle.setAttribute("aria-pressed", String(!muted));
  };
  paintToggle();
  toggle?.addEventListener("click", () => {
    muted = !muted;
    sound.unlock();
    sound.setMuted(muted);
    if (!muted) sound.play("token");
    writeNumber(MUTE_KEY, muted ? 1 : 0);
    paintToggle();
    // Leaving focus on the button would hand it every subsequent Enter.
    toggle.blur();
  });

  // --- sizing -------------------------------------------------------------
  //
  // One virtual coordinate system: the world is WORLD_W units wide at every
  // viewport, so the same length of track is visible everywhere and reaction
  // time does not change with the screen. Height in units follows the aspect
  // ratio, which is why every other measurement anchors to the bottom.
  let worldH = WORLD_W / 2;

  const resize = () => {
    const dpr = devicePixelRatio || 1;
    const { width, height } = surface.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    // Backing store in device pixels, CSS box in CSS pixels: without the dpr
    // factor the canvas is upscaled by the compositor and every edge is soft.
    surface.width = Math.round(width * dpr);
    surface.height = Math.round(height * dpr);
    const scale = (width / WORLD_W) * dpr;
    paint.setTransform(scale, 0, 0, scale, 0, 0);
    worldH = height / (width / WORLD_W);
  };

  addEventListener("resize", resize);
  // A phone rotating fires `resize` before the new box is laid out in some
  // browsers; the visual viewport reports the settled size.
  visualViewport?.addEventListener("resize", resize);
  resize();

  // --- loop ---------------------------------------------------------------

  let last = performance.now();

  const frame = (now: number) => {
    // A backgrounded tab hands back a delta of seconds. Clamping here rather
    // than in `step` keeps the rules ignorant of where frames come from.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    if (state.status === "idle") idleDrift += IDLE_SCROLL * dt;

    const view: View = {
      ...layout(worldH),
      worldH,
      idleDrift,
      best,
      now,
      sinceOver,
    };

    // The lockout is the only thing that ever refuses a press, and it refuses
    // it silently: the press is dropped, not queued, so a mash does not stack
    // up a restart to fire the instant the screen unlocks.
    const locked = state.status === "over" && sinceOver < ENDING_LOCKOUT;
    const input = { jump: pressed && !locked };
    pressed = false;

    const before = state;
    state = step(state, input, dt);
    sinceOver = state.status === "over" ? sinceOver + dt : 0;

    react(before, state, input, view, sound, effects);
    if (before.status !== "over" && state.status === "over") {
      best = Math.max(best, Math.floor(state.used));
      writeNumber(BEST_KEY, best);
      view.best = best;
    }

    effects.update(dt);
    render(paint, state, view, effects);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

// --- what just happened ------------------------------------------------------

/**
 * Sound and particles are driven by *differences* between two states rather
 * than by events the simulation emits. That keeps `rules.ts` a plain reducer
 * with nothing to say about presentation, and it means a state pair replayed
 * from a seed makes exactly the same noises as the run that produced it.
 */
function react(
  before: GameState,
  after: GameState,
  input: { jump: boolean },
  view: View,
  sound: Sound,
  effects: Effects,
): void {
  // A press leaves the ground whenever the runner is on it — and starting or
  // restarting the game is also a hop, which is the whole first lesson.
  const hopped =
    input.jump && (before.status !== "running" || grounded(before));
  if (hopped) {
    sound.play("jump");
    dust(effects, view, 5, 130);
  }

  // Landing: the runner was airborne and is not any more.
  if (after.status === "running" && before.y > 0 && after.y === 0) {
    dust(effects, view, 4, 90);
  }

  for (const pickup of taken(before, after)) {
    const burst = PICKUP_BURST[pickup.kind];
    effects.burst({
      x: pickup.x - after.distance + pickup.w / 2,
      y: view.groundY - pickup.y - pickup.h / 2,
      ...burst,
    });
    sound.play(voiceFor(pickup.kind));
    if (pickup.kind === "power") effects.shake(SHAKE_POWER, SHAKE_POWER_MS / 1000);
  }

  if (before.status === "over" || after.status !== "over") return;

  const x = RUNNER_X + RUNNER_W / 2;
  const y = view.groundY - after.y - RUNNER_H / 2;
  sound.play("death");

  if (after.cause === "collision") {
    // Thrown up and back, away from the thing that was coming at you.
    effects.burst({
      x,
      y,
      colour: CRIT,
      count: 28,
      speed: 520,
      life: 0.85,
      size: 9,
      angle: -Math.PI * 0.72,
      spread: 2.4,
    });
    effects.shake(SHAKE_DEATH, SHAKE_DEATH_MS / 1000);
  } else {
    // Running dry is a different ending and looks like one: the runner comes
    // apart downward in its own colour instead of being hit by something.
    effects.burst({
      x,
      y,
      colour: FADED,
      count: 22,
      speed: 170,
      life: 1,
      size: 8,
    });
    effects.shake(SHAKE_DEATH / 3, SHAKE_DEATH_MS / 1000);
  }
}

/** A scuff of ground-coloured grit under the runner's feet. */
function dust(effects: Effects, view: View, count: number, speed: number): void {
  effects.burst({
    x: RUNNER_X + RUNNER_W / 2,
    y: view.groundY - 2,
    colour: FADED,
    count,
    speed,
    life: 0.28,
    size: 5,
    angle: Math.PI,
    spread: 1.5,
  });
}

/**
 * The pickups that vanished between two states because the runner touched
 * them. A pickup also leaves the array once it is behind the runner, so the
 * ones that scrolled off are excluded by position — collected pickups are by
 * definition still overlapping the runner, a full RUNNER_X ahead of `distance`.
 *
 * Only a running frame can collect anything. Restarting also empties the array,
 * and without the status guard the whole visible track would read as collected
 * and fire a burst per pickup on the frame the next run begins.
 */
function taken(before: GameState, after: GameState): readonly Pickup[] {
  if (before.status !== "running" || before.pickups === after.pickups) return [];
  const survivors = new Set(after.pickups);
  return before.pickups.filter(
    (pickup) =>
      !survivors.has(pickup) && pickup.x + pickup.w >= after.distance,
  );
}

function voiceFor(kind: PickupKind): Voice {
  return kind === "power" ? "power" : kind === "high" ? "high" : "token";
}

// --- layout ------------------------------------------------------------------

interface Layout {
  /** Canvas y of the ground line, world units from the top. */
  readonly groundY: number;
  /** Canvas y of the top of the budget bar. */
  readonly hudTop: number;
  /** Multiplier applied to every HUD dimension. See config's HUD_REFERENCE_H. */
  readonly hud: number;
}

/**
 * Anchored to the bottom, never scaled. A 390x844 phone has a world nearly four
 * times taller than a 1920x1080 desktop, and the answer to that is more sky —
 * not a bigger runner, not a longer view of the track, and not a squashed one.
 */
function layout(worldH: number): Layout {
  // The ground strip is a constant thickness, except on a world too short to
  // afford it, where it takes its share instead.
  const strip = Math.min(worldH, PLAY_BAND) * (1 - GROUND_FRACTION);
  const groundY = worldH - strip;
  const hud = Math.min(Math.max(worldH / HUD_REFERENCE_H, 1), HUD_SCALE_MAX);
  // The bar rides a fixed distance above the ground line so that the glance
  // from runner to bar is the same on both marking viewports; on a short world
  // it stops at the top margin instead of walking off the screen.
  const hudTop = Math.max(
    HUD_MARGIN * hud,
    groundY - PLAY_BAND * GROUND_FRACTION,
  );
  return { groundY, hudTop, hud };
}

interface View extends Layout {
  readonly worldH: number;
  readonly idleDrift: number;
  best: number;
  readonly now: number;
  /** Seconds since the run ended. Zero while it hasn't. */
  readonly sinceOver: number;
}

// --- render ------------------------------------------------------------------

function render(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
  effects: Effects,
): void {
  paint.fillStyle = PAPER;
  paint.fillRect(0, 0, WORLD_W, view.worldH);
  drawSky(paint, view, state.distance + view.idleDrift);

  // The world shakes; the HUD does not. The bar is the clock, and a clock that
  // jumps when you are hit is harder to read at exactly the moment it matters.
  paint.save();
  paint.translate(effects.shakeX(), effects.shakeY());

  drawGround(paint, state, view);
  drawPickups(paint, state, view);
  drawObstacles(paint, state, view);
  drawRunner(paint, state, view);

  if (state.status === "idle") {
    drawCaret(paint, view, RUNNER_X + RUNNER_W + 14, view.groundY, RUNNER_H);
  }

  effects.draw(paint);
  paint.restore();

  drawBudget(paint, state, view);

  if (state.status === "over") drawEnding(paint, state, view);
}

/**
 * The sky, and the answer to the one thing constant world width costs: a
 * 390x844 phone has a world four times taller than a 1920x1080 desktop, and
 * the extra is all above the play band. Left flat it is two thirds of the
 * screen doing nothing.
 *
 * So it holds the terminal's own scrollback — dim, ragged lines of output
 * drifting at a fifth of the world's speed, brightest just above the bar and
 * fading out toward the top the way scrolled-off output does. It is parallax,
 * so it gives the track depth on a desktop too, and it is the game's own
 * metaphor: what is above you is the context you have already spent.
 */
function drawSky(paint: CanvasRenderingContext2D, view: View, scroll: number): void {
  const sky = paint.createLinearGradient(0, 0, 0, view.groundY);
  sky.addColorStop(0, "#020805");
  sky.addColorStop(1, PAPER);
  paint.fillStyle = sky;
  paint.fillRect(0, 0, WORLD_W, view.groundY);

  // Output runs from just above the ground line up to the top of the world,
  // and steps around the HUD: the bar is the one thing that must never have
  // texture behind it.
  const bottom = view.groundY - SKY_CLEAR;
  if (bottom < SKY_LINE_H) return;
  const hudFrom = view.hudTop - 10 * view.hud;
  const hudTo = view.hudTop + (HUD_BAR_H + HUD_FONT + 24) * view.hud;

  const offset = mod(scroll * SKY_PARALLAX, SKY_SPAN);
  paint.fillStyle = INK;
  for (let row = 0; row < SKY.length; row += 1) {
    const y = bottom - row * SKY_LINE_H;
    if (y < SKY_WORD_H) break;
    if (y + SKY_WORD_H > hudFrom && y < hudTo) continue;
    paint.globalAlpha = SKY_ALPHA * (0.15 + 0.85 * (y / bottom));
    const line = SKY[row];
    if (line === undefined) continue;
    for (const word of line) {
      // Two copies, one strip apart: the second is what carries a word off the
      // left edge instead of teleporting it to the right one.
      const x = mod(word.x - offset, SKY_SPAN);
      if (x < WORLD_W) paint.fillRect(x, y, word.w, SKY_WORD_H);
      const wrapped = x - SKY_SPAN;
      if (wrapped + word.w > 0) paint.fillRect(wrapped, y, word.w, SKY_WORD_H);
    }
  }
  paint.globalAlpha = 1;
}

const mod = (value: number, span: number): number =>
  ((value % span) + span) % span;

/**
 * Dashes rather than a solid line: the drift is what makes the world read as
 * moving before the player has done anything, and a solid line cannot show it.
 */
function drawGround(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
): void {
  const offset = (state.distance + view.idleDrift) % GROUND_DASH;

  paint.fillStyle = DIM;
  paint.fillRect(0, view.groundY, WORLD_W, view.worldH - view.groundY);

  paint.fillStyle = INK;
  for (let x = -offset; x < WORLD_W; x += GROUND_DASH) {
    paint.fillRect(x, view.groundY, GROUND_DASH * 0.55, 2);
  }
}

function drawObstacles(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
): void {
  paint.fillStyle = CRIT;
  for (const obstacle of state.obstacles) {
    const x = obstacle.x - state.distance;
    if (x < -OBSTACLE_W || x > WORLD_W) continue;
    paint.fillRect(x, view.groundY - obstacle.h, obstacle.w, obstacle.h);
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
  view: View,
): void {
  for (const pickup of state.pickups) {
    const x = pickup.x - state.distance;
    if (x < -pickup.w || x > WORLD_W) continue;
    const y = view.groundY - pickup.y - pickup.h;

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
): void {
  // The shield has no icon and no timer: the runner itself strobes in the
  // power-up's colour, so the thing that changed is the thing you are watching.
  const shielded =
    invulnerable(state) && Math.floor(view.now / SHIELD_FLASH_MS) % 2 === 0;

  paint.fillStyle = state.status === "over" ? DIM : shielded ? SHIELD : INK;
  paint.fillRect(
    RUNNER_X,
    view.groundY - state.y - RUNNER_H,
    RUNNER_W,
    RUNNER_H,
  );
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
  paint.fillRect(x, bottom - height, height * 0.31, height);
}

/** One colour per bar level. The level itself is decided in `rules.ts`. */
const BAR_INK: Record<BarLevel, string> = { ok: INK, warn: WARN, crit: CRIT };

/**
 * Wide, high-contrast and the only thing above the track: dying dry has to be
 * something the player watched happen. How full it is and what colour it is are
 * both `rules.ts`'s answers — this only paints them.
 */
function drawBudget(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
): void {
  const margin = HUD_MARGIN * view.hud;
  const width = WORLD_W - margin * 2;
  const height = HUD_BAR_H * view.hud;
  const fraction = barFraction(state);

  paint.fillStyle = DIM;
  paint.fillRect(margin, view.hudTop, width, height);

  paint.fillStyle = BAR_INK[barLevel(state)];
  paint.fillRect(margin, view.hudTop, width * fraction, height);

  paint.fillStyle = INK;
  paint.font = `600 ${HUD_FONT * view.hud}px ${MONO}`;
  paint.textAlign = "right";
  paint.textBaseline = "top";
  paint.fillText(
    String(Math.floor(state.used)),
    WORLD_W - margin,
    view.hudTop + height + 12 * view.hud,
  );
}

function drawEnding(
  paint: CanvasRenderingContext2D,
  state: GameState,
  view: View,
): void {
  // Faded up rather than switched on, so the impact the death just produced is
  // still visible underneath it. At 82% the run behind stays legible: you can
  // see the wall you hit.
  const fade = Math.min(1, view.sinceOver / ENDING_FADE);
  const midY = view.hudTop + (view.groundY - view.hudTop) * 0.42;
  const scale = view.hud;

  paint.fillStyle = `rgba(5, 16, 10, ${0.82 * fade})`;
  paint.fillRect(0, 0, WORLD_W, view.worldH);

  paint.globalAlpha = fade;
  paint.textAlign = "center";
  paint.textBaseline = "middle";

  paint.fillStyle = INK;
  paint.font = `700 ${72 * scale}px ${MONO}`;
  paint.fillText(String(Math.floor(state.used)), WORLD_W / 2, midY);

  paint.fillStyle = FADED;
  paint.font = `600 ${HUD_FONT * scale}px ${MONO}`;
  paint.fillText(`BEST ${Math.floor(view.best)}`, WORLD_W / 2, midY + 62 * scale);

  // The same caret that invited the first press invites the next one. Without
  // it the death screen is two numbers and no offer, and a cold player has
  // nothing telling them the run is repeatable — the one thing the ending has
  // to communicate, and the only one it cannot say in words.
  drawCaret(paint, view, WORLD_W / 2 - 5 * scale, midY + 134 * scale, 30 * scale);
  paint.globalAlpha = 1;
}

// --- persistence --------------------------------------------------------------
//
// Guarded both ways. Private browsing, a blocked third-party context and a
// wiped profile all make localStorage throw or lie, and none of them is a
// reason for the game not to run — a lost best score is the whole cost.

function readNumber(key: string): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return 0;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Nothing to do and nothing to say: the run still counts on screen.
  }
}
