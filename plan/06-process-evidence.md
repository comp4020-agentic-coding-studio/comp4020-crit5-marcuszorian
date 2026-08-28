# Process evidence — the playtest change, PROCESS.md, the reflection

**Files:** `PROCESS.md` · `reflections/crit-5.md` (new) · whatever the playtest change
touches

Build-order steps: **0, 1** (the standing red gates), **13** (playtest change),
**15** (the writing).

## Two gates are already red, independent of any prototype work

1. `PROCESS.md` still contains the `TEMPLATE:` comment and its two fake SHAs. Stripping
   the comment is **step 1** and clears one of the two immediately — do it early, so
   `pnpm check:evidence` is reporting real state for the rest of the build.
2. `reflections/crit-5.md` does not exist. Cleared at step 15.

## The play-derived change (step 13)

Playtest the finished game and change one thing because of it. Required by the spec, and
it **must be play-derived, not code-derived** — name what you felt while playing that
reading the code would not have told you.

The economy is the likeliest source; see
[02-economy-and-pickups.md](02-economy-and-pickups.md#the-balance-trap-to-watch).

## Content suggestions for `PROCESS.md` (step 15)

You're writing these. `PROCESS.md` wants 150–300 words, three or four moments, each doing
four jobs (what happened; what you did instead of the obvious thing; how you knew it was
right; the citation). Candidate moments, strongest first:

1. **The no-tutorial correction.** The obvious move was a `PRESS SPACE` label; the
   spec forbids on-screen instructions, so it became a blinking terminal caret plus a
   confirming hop on first input. A constraint that improved the design rather than
   compromising it — and a decision made against a spec line, not a preference. See
   [03-feel-and-teaching.md](03-feel-and-teaching.md).
2. **A harness correction, not a retry.** The `CLAUDE.md` additions, especially the
   marking viewports. The template's guidance says the strongest moments are the ones
   that landed in the harness — cite the `CLAUDE.md` diff directly. See
   [05-testing-and-harness.md](05-testing-and-harness.md#harness-additions-for-claudemd-step-14).
3. **The play-derived change** (step 13) — required by the spec, so it must appear.
4. **The economy discovery, if it bites** — speed cancelling out of the income/drain
   ratio is the kind of thing that looks fine in code and only shows up in a bar that
   never moves.

## `reflections/crit-5.md` (step 15)

150–300 words, the two standing prompts: the breakthrough that moved the work forward,
and what this changed about who you want to be as a developer.

The honest thread available here is **the gap between what a test can hold and what only
playing can** — the suite proves a collision ends the round and says nothing about
whether it felt fair.

## Done when

- The `TEMPLATE:` comment and both fake SHAs are gone from `PROCESS.md`.
- `PROCESS.md` names three or four moments, each with a citation that resolves to a real
  commit in this repo.
- One change in the history is attributable to playing rather than reading, and
  `PROCESS.md` says which.
- `reflections/crit-5.md` exists and answers both prompts.
- `pnpm check:evidence` is green.
