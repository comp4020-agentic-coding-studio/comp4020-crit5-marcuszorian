# Context Window — the plan

## Context

Deliverable: COMP4020 C5 "A game", cutoff **Mon 31 Aug 2026, 12:00**. Repo
`comp4020-crit5-marcuszorian`, deploying to
<https://comp4020-agentic-coding-studio.github.io/comp4020-crit5-marcuszorian/>.

The brief asks for a tiny browser game — one mechanic is usually enough, obvious in ten
seconds, still interesting at five minutes, and **no tutorial anywhere**. The pod plays
it cold while you stay silent.

The repo is currently the bare Astro template: placeholder `<h1>`, placeholder
description, an empty `src/scripts/main.ts`, no game. Two harness gates are already red
independent of any prototype work — `PROCESS.md` still contains the `TEMPLATE:` comment
and its two fake SHAs, and `reflections/crit-5.md` does not exist.

**Outcome:** a terminal-styled endless runner called **Context Window** where the
player's token budget is the clock, shipped green at both marking viewports with the
process evidence the deliverable requires.

## The files

| # | File | Covers |
|---|---|---|
| 01 | [core-loop](01-core-loop.md) | architecture (`config`/`rules`/`main`, pure reducer), the one input, collision, the two endings |
| 02 | [economy-and-pickups](02-economy-and-pickups.md) | `used`/`budget`/`remaining`/`speed`, tokens at two heights, the power-up, the balance trap |
| 03 | [feel-and-teaching](03-feel-and-teaching.md) | wordless onboarding, the caret, the confirming hop, the budget bar's scale |
| 04 | [presentation](04-presentation.md) | marking viewports, terminal styling, juice, audio, best score, page shell |
| 05 | [testing-and-harness](05-testing-and-harness.md) | `spec/game.test.ts`, the invariants, CI, `CLAUDE.md` additions, verification |
| 06 | [process-evidence](06-process-evidence.md) | the play-derived change, `PROCESS.md`, `reflections/crit-5.md` |

Each file names the source files it touches, owns a slice of `config.ts`'s constants, and
ends with **done when** criteria. `config.ts` stays one physical file — the ownership
split is a documentation convention, so every knob is still in one place.

## Build order

Each step is a commit; the red-to-green sequence is the evidence.

| # | Step | File |
|---|---|---|
| 0 | Split this plan into `plan/` and commit it | this file |
| 1 | Strip the `TEMPLATE:` comment from `PROCESS.md` — clears one of two standing `check:evidence` failures immediately | [06](06-process-evidence.md) |
| 2 | `spec/game.test.ts` — full suite, red | [05](05-testing-and-harness.md) |
| 3 | `config.ts` + `rules.ts` — until the suite is green | [01](01-core-loop.md) |
| 4 | `main.ts`: canvas, RAF, keyboard, render. First playable. Confirm the script tag now ships in `dist/index.html` | [01](01-core-loop.md) |
| 5 | Responsive sizing; open and play at 1920×1080 and 390×844 | [04](04-presentation.md) |
| 6 | Click and touch input | [01](01-core-loop.md) |
| 7 | Tokens at two heights | [02](02-economy-and-pickups.md) |
| 8 | Power-up: invincibility + budget boost | [02](02-economy-and-pickups.md) |
| 9 | Particles and screen shake | [04](04-presentation.md) |
| 10 | WebAudio: jump blip, pickup chime, death thud | [04](04-presentation.md) |
| 11 | Best score in `localStorage` | [04](04-presentation.md) |
| 12 | Head block: `<title>`, description, `public/card.png`, the `<h1>`, `<nav>` as terminal chrome | [04](04-presentation.md) |
| 13 | Playtest the finished game and change one thing because of it | [06](06-process-evidence.md) |
| 14 | `CLAUDE.md` harness additions | [05](05-testing-and-harness.md) |
| 15 | `PROCESS.md` and `reflections/crit-5.md` | [06](06-process-evidence.md) |

[03 — feel and teaching](03-feel-and-teaching.md) is cross-cutting rather than a step: it
is built into step 4 and re-checked at step 13.

## Judged by a person, not by any test

Named so they don't get lost: whether it **teaches itself**, whether a **stranger
finishes in five minutes**, whether the **collision feels fair**, and whether it **stays
interesting for five minutes**.

Verification for everything that *is* mechanical lives in
[05 — testing and harness](05-testing-and-harness.md#verification).
