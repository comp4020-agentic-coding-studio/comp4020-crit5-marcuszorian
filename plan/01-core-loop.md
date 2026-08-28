# Core loop — architecture, jump, collision, endings

**Files:** `src/game/config.ts` · `src/game/rules.ts` · `src/scripts/main.ts` ·
`src/pages/index.astro`

**Constants owned:** `WORLD_W`, `GRAVITY`, `JUMP_V`, runner width/height, obstacle
width/height, ground-collision epsilon

Build-order steps: **3, 4, 6**.

## Architecture

Driven by a hard constraint: vitest runs in the `node` environment, with no `document`,
`window`, `HTMLCanvasElement` or `requestAnimationFrame`. Anything touching the DOM at
import time throws during collection. So — usefully — the logic has to be pure to be
testable at all.

Three files, deliberately not more:

| File | Contains | Purity | |
|---|---|---|---|
| `src/game/config.ts` | tuning constants only | pure | ← you'll live here |
| `src/game/rules.ts` | types + `step()` + collision + seeded RNG | pure | ← every test hits this |
| `src/scripts/main.ts` | canvas, render, input, audio, localStorage, RAF loop | DOM | untested |

`rules.ts` is a pure reducer — `step(state, input, dt) -> GameState`, no time, no
globals, RNG seeded and passed in. Every gameplay rule becomes testable as plain data,
and runs become reproducible, so a bad run you saw while playing can be replayed.

`config.ts` is separate precisely because you'll edit it constantly; every tuning knob in
one place is what makes iteration fast. Split rendering out of `main.ts` later only if it
gets unwieldy — an extra file switch on every visual tweak is a real cost during a
two-day build.

This mirrors a pattern the template already demonstrates in
`scripts/check-evidence.ts` (exported pure functions, side effects behind a main guard,
tests importing source directly).

`rules.ts` never learns the viewport exists — the world is `WORLD_W = 1000` units wide,
always, and the mapping to pixels lives entirely in `main.ts`. See
[04-presentation.md](04-presentation.md#viewport-strategy--constant-world-width-variable-height).

## One input — jump

Space / ArrowUp / W, plus click and touch. Keyboard lands at step 4; click and touch at
step 6 (the same handler, three event sources).

Jump is both the avoid verb and the collect verb — see
[02-economy-and-pickups.md](02-economy-and-pickups.md#two-heights-one-button). Nothing
else is bound.

## Endings

Loss only, which satisfies the spec's "a win, a loss or a finish". Two distinct deaths:

1. **Collision** while not invincible.
2. **`remaining <= 0`** — you ran dry.

The second is the one the bar must teach; see
[03-feel-and-teaching.md](03-feel-and-teaching.md).

The death screen explains nothing — score, best, and the same input restarts.

## Notes / trade-offs

- **Purity is not a style preference here.** The node-env vitest constraint means a
  DOM-touching `rules.ts` is not merely untested, it is untestable — the suite fails at
  collection, not at assertion.
- **Three files, not five.** Rendering stays in `main.ts` until it hurts. The cost of a
  premature split is paid on every visual tweak, and there will be many.

## Done when

- `pnpm check` is green with `spec/game.test.ts` importing `../src/game/rules.ts` and no
  DOM shim anywhere.
- The runner jumps on Space, ArrowUp, W, click and touch, and on nothing else.
- Hitting an obstacle sets `status: "over"`; so does draining the budget.
- The death screen shows score and best, and the same input restarts.
- **Verify a real `<script>` tag appears in `dist/index.html`** at the first commit with
  actual code. `index.astro`'s existing `<script src="../scripts/main.ts">` is an Astro
  bundled script and follows imports; it emits nothing today only because `main.ts` is
  empty and gets tree-shaken. Catch this at commit time, not later as a config mystery.
