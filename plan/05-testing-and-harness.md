# Testing and harness

**Files:** `spec/game.test.ts` (new) · `CLAUDE.md` · read-only: `spec/invariants.test.ts`,
`.github/workflows/checks.yml`, `tsconfig.json`

Build-order steps: **2** (write the suite red), **14** (`CLAUDE.md` additions).

## Tests

New file `spec/game.test.ts`, importing `../src/game/rules.ts` directly. These start
**red** — that is the point, and the commits turning them green are the process evidence.

### The focused rule test the spec requires

The jump/collision rule, done properly:

- an obstacle the runner jumps over does **not** end the run
- the identical obstacle, un-jumped, **does**
- a jump begun too late still collides
- landing before the obstacle still collides

One rule, four cases, no mocking — exactly what "one rule of the game has a focused
automated test" asks for.

### Contract tests for the rest

- collision sets `status: "over"` (a wrong move is possible, play ends)
- `remaining <= 0` sets `status: "over"` (the budget ending)
- a token pickup raises `budget`, and therefore `speedFor(budget)` — the interaction,
  asserted as a property
- the power-up makes exactly one collision survivable, and stops after `INVULN_MS`

### Sensor

- same seed + same input sequence ⇒ identical final state.

Harness rather than contract (per `spec/README.md`'s distinction), so it is worth
carrying to next week's repo.

### The rule for writing them

**Assert relationships, never tuning numbers.** A test that hardcodes a jump height or
obstacle spacing turns red on every balance tweak, and a suite you learn to ignore is
worse than no suite. "Jumping clears an obstacle that otherwise kills" survives the whole
weekend; `expect(jumpHeight).toBe(120)` does not.

## Harness constraints to honour

From `spec/invariants.test.ts` (runs against `dist/`, jsdom, static parse — it never
executes your game):

- keep a real `<nav>` element; `role="navigation"` fails
- exactly one `<h1>` — zero fails. The game name serves; visually hidden is fine, nothing
  checks visibility
- keep `lang`, non-empty `<title>`, `meta[name=description]`,
  `meta[property="og:image"]`, `meta[name=viewport]`
- any `<img>` needs `alt`; `<canvas>` isn't checked by the harness but **is** checked by a
  human at the crit

### Build and CI

- **No new dependencies.** CI runs `--frozen-lockfile`; canvas 2D and WebAudio cover
  everything with zero deps.
- **Strict TS**, over every file — `getContext("2d")` and `querySelector` both return nullable
  and must be narrowed or the build reddens. Tests are in the same program, so a type
  error in a spec file fails `pnpm check`.
- `verbatimModuleSyntax: true` → `import type` for type-only imports.
- Explicit `.ts` extensions in imports, matching repo convention.
- `./`-relative links only — linkinator crawls the built site under the base path. No
  leading-slash asset paths.
- Nothing new in `public/` beyond the card, so no runtime URL construction can trip over
  the base path.
- `index.astro`'s existing `<script src="../scripts/main.ts">` is an Astro bundled script
  and will follow imports. Verify a real script tag appears in `dist/index.html` at the
  first commit with actual code — see
  [01-core-loop.md](01-core-loop.md#done-when).

### CI is dead while the repo is private

The `check` job is gated on `!repository.private` and deploy on public, so **nothing runs
in CI until the cutoff flip**. Local `pnpm check` and `pnpm check:evidence` are the only
backpressure until then, and the first public push is the first real CI run — don't let
that be the first time the link checker or the evidence gate sees this repo.

## Harness additions for `CLAUDE.md` (step 14)

These travel to next week's repo, and the gap between the starter's boilerplate and your
version is assessed. Three facts this build turned up that the repo records nowhere:

- the marking viewports are **1920×1080 and 390×844**, and no check enforces either
- **CI runs nothing while the repo is private** — local checks are the only signal before
  the cutoff flip
- **vitest is node-env**, so anything testable must be DOM-free; that constraint should
  shape where logic lives

## Verification

- `pnpm dev` and play it in a browser at both marking viewports — the rendered page is
  the truth, and the harness cannot see anything the canvas does.
- `pnpm check` — typecheck, build, vitest — green.
- `pnpm check:evidence` — green (needs the reflection, and cited SHAs that actually
  resolve).
- Hand it to someone cold, say nothing, and watch whether they reach an ending inside
  five minutes. The only real test of the no-tutorial rule.
- Repo stays private until the cutoff; ship flips it and deploys.

## Done when

- `spec/game.test.ts` covers the four jump/collision cases, the four contract tests and
  the determinism sensor, and every assertion is a relationship rather than a tuning
  number.
- `pnpm check` green; `pnpm check:evidence` green.
- `CLAUDE.md` carries the three facts above.
