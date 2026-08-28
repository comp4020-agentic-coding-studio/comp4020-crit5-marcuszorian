 Context Window — C5 "A game"

 Context

 Deliverable: COMP4020 C5 "A game", cutoff Mon 31 Aug 2026, 12:00. Repo
 comp4020-crit5-marcuszorian, deploying to
 https://comp4020-agentic-coding-studio.github.io/comp4020-crit5-marcuszorian/.

 The brief asks for a tiny browser game — one mechanic is usually enough, obvious
 in ten seconds, still interesting at five minutes, and no tutorial anywhere.
 The pod plays it cold while you stay silent.

 The repo is currently the bare Astro template: placeholder <h1>, placeholder
 description, an empty src/scripts/main.ts, no game. Two harness gates are
 already red independent of any prototype work — PROCESS.md still contains the
 TEMPLATE: comment and its two fake SHAs, and reflections/crit-5.md does not
 exist.

 Outcome: a terminal-styled endless runner called Context Window where
 the player's token budget is the clock, shipped green at both marking viewports
 with the process evidence the deliverable requires.

 ---

 The game

 One input — jump. Space / ArrowUp / W, plus click and touch.

 The resource model

 Four numbers, and the whole design lives in the relationship between them:

 ┌───────────┬────────────────────────┬───────────────────────────────────────────────┐
 │   Name    │        Meaning         │                   Behaviour                   │
 ├───────────┼────────────────────────┼───────────────────────────────────────────────┤
 │ used      │ tokens consumed so far │ rises with distance; this is the score        │
 ├───────────┼────────────────────────┼───────────────────────────────────────────────┤
 │ budget    │ the ceiling            │ starts at START_BUDGET; only pickups raise it │
 ├───────────┼────────────────────────┼───────────────────────────────────────────────┤
 │ remaining │ budget - used          │ what the bar shows                            │
 ├───────────┼────────────────────────┼───────────────────────────────────────────────┤
 │ speed     │ scroll rate            │ speedFor(budget) — monotonic in budget        │
 └───────────┴────────────────────────┴───────────────────────────────────────────────┘

 - Running costs tokens: used += speed * dt * DRAIN. Going faster burns more
   and scores more.
 - The run ends when remaining <= 0, or on collision while not invincible.
 - Token pickup: budget += TOKEN_VALUE. Buys headroom — and, through
   speedFor, makes the rest of the run faster.

 That last line is the design. Every reward is also a difficulty increase, so the
 player sets their own ramp and there is a real decision in every token.

 Two heights, one button

 - Ground tokens collect by running through them. Free.
 - High tokens need a jump. Worth more.
 - Obstacles sit on the ground.

 Jump is therefore both the avoid verb and the collect verb. A high token
 hovering just past an obstacle is the interesting shape: one jump takes both, a
 greedy jump kills you. Two mechanics interacting, nothing extra to teach.

 The power-up

 Rare spawn. On pickup: invincible for INVULN_MS, and budget += BOOST
 (large). Because speed is a function of budget, the boost is the speed
 increase — it feeds the existing rule rather than adding a new one. A few
 seconds of immunity bought with a permanently faster game.

 Endings

 Loss only, which satisfies the spec's "a win, a loss or a finish". Two distinct
 deaths — hit something, or run dry — and the second is the one the bar must
 teach.

 ---

 Teaching it without words

 The spec line most at risk. Every mechanism below is wordless.

 1. A blinking caret invites the press. The runner idles on a slowly
    scrolling ground with a terminal cursor blinking beside it. In a CRT-styled
    game that is already the universal "waiting for input" signal — diegetic to
    the look rather than UI sitting on top of it, and not a word anywhere.
 2. The first press is confirmed by a hop. It starts the world and makes
    the runner jump, so the verb teaches itself on frame one: you pressed, the
    thing jumped, that is the game.
 3. First obstacle is far and slow, at START_BUDGET's low speed. Mario 1-1:
    the threat walks at you until you work out the answer.
 4. First pickup is a ground token in the runner's path, collected by
    accident, with a visible bar jump. Teaches "these are good" before anything
    punishes you.
 5. The bar is large, drains visibly, and shifts colour as it empties. It
    must be impossible to die dry and not know why.
 6. The death screen explains nothing — score, best, and the same input
    restarts.

 Numbers on screen are feedback, not instructions, and are fine. A PRESS SPACE
 label is not. The game's name is explicitly allowed by the brief.

 Bar scale — decided

 The bar is full at a fixed BAR_CAP of remaining headroom and pins there
 when you're ahead; headroom above the cap still counts toward budget and
 speed, it just isn't drawn. Rejected the alternative of drawing
 remaining / budget as a percentage: as budget grows, each pickup becomes a
 smaller slice, so late-game tokens stop visibly doing anything — exactly when
 the feedback matters most. A constant-size bump per pickup is what keeps the
 pickup→bar causal link teaching all run.

 ---

 Architecture

 Driven by a hard constraint: vitest runs in the node environment, with no
 document, window, HTMLCanvasElement or requestAnimationFrame. Anything
 touching the DOM at import time throws during collection. So — usefully — the
 logic has to be pure to be testable at all.

 Three files, deliberately not more:

 src/game/config.ts    tuning constants only          pure   ← you'll live here
 src/game/rules.ts     types + step() + collision     pure   ← every test hits this
                       + seeded RNG
 src/scripts/main.ts   canvas, render, input, audio,  DOM    untested
                       localStorage, RAF loop

 rules.ts is a pure reducer — step(state, input, dt) -> GameState, no time,
 no globals, RNG seeded and passed in. Every gameplay rule becomes testable as
 plain data, and runs become reproducible, so a bad run you saw while playing can
 be replayed.

 config.ts is separate precisely because you'll edit it constantly; every
 tuning knob in one place is what makes iteration fast. Split rendering out of
 main.ts later only if it gets unwieldy — an extra file switch on every visual
 tweak is a real cost during a two-day build.

 This mirrors a pattern the template already demonstrates in
 scripts/check-evidence.ts (exported pure functions, side effects behind a main
 guard, tests importing source directly).

 Viewport strategy — constant world width, variable height

 Marking is Chrome at 1920×1080 and 390×844 portrait. Nothing in CI
 catches a failure at either.

 - One virtual coordinate system, WORLD_W = 1000 units wide, always.
 - Canvas CSS size = viewport; backing store = CSS size × devicePixelRatio; one
   transform maps 1000 world units to the full width.
 - World height in units varies (1000 * h/w); sky and ground stretch, ground
   line anchored relative to the bottom.

 The same length of track is visible at both viewports, so reaction time is
 identical and rules.ts never learns the viewport exists.

 ---

 The balance trap to watch

 Worth knowing before tuning, because it isn't obvious. Work the rates:

 - tokens encountered per second = density × speed
 - tokens drained per second = DRAIN × speed

 Both scale linearly with speed, so speed cancels. Net budget change is
 speed × (density × TOKEN_VALUE − DRAIN) — the sign never changes with speed,
 giving one of two runaways: income slightly above drain means budget → speed →
 budget, accelerating to "too fast to react"; drain above income means you always
 die dry and collecting only delays it.

 Neither is broken, but the dial is not TOKEN_VALUE or DRAIN alone — it is
 their ratio against how many tokens a player actually collects. Target:
 collecting nearly all of them is net positive, collecting ~70% is net negative.
 Then the bar always matters and skill is what keeps you alive. Only playing
 settles it, which makes this a strong candidate for the required play-derived
 change.

 ---

 Harness constraints to honour

 From spec/invariants.test.ts (runs against dist/, jsdom, static parse — it
 never executes your game):

 - keep a real <nav> element; role="navigation" fails
 - exactly one <h1> — zero fails. The game name serves; visually hidden is
   fine, nothing checks visibility
 - keep lang, non-empty <title>, meta[name=description],
   meta[property="og:image"], meta[name=viewport]
 - any <img> needs alt; <canvas> isn't checked by the harness but is
   checked by a human at the crit

 Build and CI:

 - No new dependencies. CI runs --frozen-lockfile; canvas 2D and WebAudio
   cover everything with zero deps.
 - Strict TS over **/* — getContext("2d") and querySelector both return
   nullable and must be narrowed or the build reddens. Tests are in the same
   program, so a type error in a spec file fails pnpm check.
 - verbatimModuleSyntax: true → import type for type-only imports.
 - Explicit .ts extensions in imports, matching repo convention.
 - ./-relative links only — linkinator crawls the built site under the base
   path. No leading-slash asset paths.
 - Nothing new in public/ beyond the card, so no runtime URL construction can
   trip over the base path.
 - index.astro's existing <script src="../scripts/main.ts"> is an Astro
   bundled script and will follow imports. It emits nothing today only because
   main.ts is empty and gets tree-shaken — verify a real script tag appears
   in dist/index.html at the first commit with actual code, rather than
   debugging it later as a config problem.

 CI is dead while the repo is private

 The check job is gated on !repository.private and deploy on public, so
 nothing runs in CI until the cutoff flip. Local pnpm check and
 pnpm check:evidence are the only backpressure until then, and the first public
 push is the first real CI run — don't let that be the first time the link
 checker or the evidence gate sees this repo.

 ---

 Tests

 New file spec/game.test.ts, importing ../src/game/rules.ts directly. These
 start red — that is the point, and the commits turning them green are the
 process evidence.

 The focused rule test the spec requires — the jump/collision rule, done
 properly:

 - an obstacle the runner jumps over does not end the run
 - the identical obstacle, un-jumped, does
 - a jump begun too late still collides
 - landing before the obstacle still collides

 One rule, four cases, no mocking — exactly what "one rule of the game has a
 focused automated test" asks for.

 Alongside it, contract tests for the rest:

 - collision sets status: "over" (a wrong move is possible, play ends)
 - remaining <= 0 sets status: "over" (the budget ending)
 - a token pickup raises budget, and therefore speedFor(budget) — the
   interaction, asserted as a property
 - the power-up makes exactly one collision survivable, and stops after
   INVULN_MS
 - sensor: same seed + same input sequence ⇒ identical final state. Harness
   rather than contract (per spec/README.md's distinction), worth carrying to
   next week.

 Assert relationships, never tuning numbers. A test that hardcodes a jump
 height or obstacle spacing turns red on every balance tweak, and a suite you
 learn to ignore is worse than no suite. "Jumping clears an obstacle that
 otherwise kills" survives the whole weekend; expect(jumpHeight).toBe(120) does
 not.

 ---

 Build order

 Each step is a commit; the red-to-green sequence is the evidence.

 0. Write this plan to plan.md at the repo root and commit it. The course
    treats your plan as a record of your decisions, so it is citable from
    PROCESS.md — and having it in the repo means the agent can be pointed back
    at it mid-build. Say if you'd rather it lived at docs/plan.md or stayed
    out of version control.
 1. Strip the TEMPLATE: comment from PROCESS.md — clears one of two standing
    check:evidence failures immediately.
 2. spec/game.test.ts — full suite, red.
 3. config.ts + rules.ts — until the suite is green.
 4. main.ts: canvas, RAF, keyboard, render. First playable. Confirm the script
    tag now ships in dist/index.html.
 5. Responsive sizing; open and play at 1920×1080 and 390×844.
 6. Click and touch input.
 7. Tokens at two heights.
 8. Power-up: invincibility + budget boost.
 9. Particles and screen shake.
 10. WebAudio: jump blip, pickup chime, death thud. First user gesture unlocks
     the context, so the opening press covers the autoplay policy.
 11. Best score in localStorage.
 12. Head block: <title>, description, public/card.png, the <h1>, and
     styling <nav> as part of the terminal chrome rather than hiding it.
 13. Playtest the finished game and change one thing because of it. Required
     by the spec, and it must be play-derived, not code-derived.
 14. CLAUDE.md harness additions — see below.
 15. PROCESS.md and reflections/crit-5.md — you write these; I supply
     suggested content and the commit SHAs to cite.

 Harness additions for CLAUDE.md (step 14)

 These travel to next week's repo, and the gap between the starter's boilerplate
 and your version is assessed. Three facts this build turned up that the repo
 records nowhere:

 - the marking viewports are 1920×1080 and 390×844, and no check enforces
   either
 - CI runs nothing while the repo is private — local checks are the only
   signal before the cutoff flip
 - vitest is node-env, so anything testable must be DOM-free; that constraint
   should shape where logic lives

 ---

 Content suggestions for step 15

 You're writing these. Candidate moments, strongest first — PROCESS.md wants
 150–300 words, three or four moments, each doing four jobs (what happened; what
 you did instead of the obvious thing; how you knew it was right; the
 citation).

 1. The no-tutorial correction. The obvious move was a PRESS SPACE label;
    the spec forbids on-screen instructions, so it became a blinking terminal
    caret plus a confirming hop on first input. A constraint that improved the
    design rather than compromising it — and a decision made against a spec line,
    not a preference.
 2. A harness correction, not a retry. The CLAUDE.md additions above,
    especially the marking viewports. The template's guidance says the strongest
    moments are the ones that landed in the harness — cite the CLAUDE.md diff
    directly.
 3. The play-derived change (step 13) — required by the spec, so it must
    appear. Name what you felt while playing that reading the code would not have
    told you.
 4. The economy discovery, if it bites — speed cancelling out of the
    income/drain ratio is the kind of thing that looks fine in code and only
    shows up in a bar that never moves.

 For reflections/crit-5.md (150–300 words), the two standing prompts: the
 breakthrough that moved the work forward, and what this changed about who you
 want to be as a developer. The honest thread available here is the gap between
 what a test can hold and what only playing can — the suite proves a collision
 ends the round and says nothing about whether it felt fair.

 ---

 Verification

 - pnpm dev and play it in a browser at both marking viewports — the
   rendered page is the truth, and the harness cannot see anything the canvas
   does.
 - pnpm check — typecheck, build, vitest — green.
 - pnpm check:evidence — green (needs the reflection, and cited SHAs that
   actually resolve).
 - Hand it to someone cold, say nothing, and watch whether they reach an ending
   inside five minutes. The only real test of the no-tutorial rule.
 - Repo stays private until the cutoff; ship flips it and deploys.

 Judged by a person, not by any test

 Named so they don't get lost: whether it teaches itself, whether a stranger
 finishes in five minutes, whether the collision feels fair, and whether it
 stays interesting for five minutes.
