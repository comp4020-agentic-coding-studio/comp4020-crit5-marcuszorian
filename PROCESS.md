# Process overview

A reading-guide to how the work came together --- a map to your process, not an
essay about it. Markers read this file and follow its citations; they don't
trawl the repo for evidence you didn't point at, so if a moment mattered, cite
it.

This file is the shape; the course site's
[assessment page](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#what-you-submit)
is the requirement, and its
[word counts](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/#word-counts)
cover every deliverable.

## What I built

Context Window is a one-button endless runner where the thing you're spending
is a budget, not a lives counter: every second burns tokens, every jump you
land collects them, and the same number that keeps you alive also drives the
game's speed --- so a good run makes itself harder, and there is a real
decision behind every pickup instead of a fixed difficulty curve.

## The moments that mattered

1. **No on-screen instructions, so the first press had to teach itself.** The
   obvious fix for "how does a cold player know to press space" is a
   `PRESS SPACE` label, but the spec forbids on-screen instructions. Instead
   the idle screen shows a blinking terminal caret beside the runner --- already
   the universal "waiting for input" signal in a CRT-styled game --- and the
   first press both starts the run and makes the runner hop, so the verb
   teaches itself on frame one instead of being told. Checked by handing the
   build to a cold viewer and watching whether they pressed something and
   understood why, not by reading the code back.
   [`619b40b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-marcuszorian/commit/619b40b)

2. **A harness correction, not a retry.** Three things this build kept
   re-discovering the hard way went into `CLAUDE.md` instead of staying
   lessons I'd have to relearn next week: no check enforces either marking
   viewport (`pnpm shots` only fails on a console error, never on a bad
   layout), CI is silent for the whole life of a private repo so local checks
   are the only backpressure until the cutoff flip, and vitest's default node
   environment means untestable code is a design smell, not a testing gap.
   Adding a rule to the harness rather than just fixing the instance is the
   change meant to survive past this repo.
   [`23fdf84`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-marcuszorian/commit/23fdf84)

3. **The play-derived change.** The economy note in the plan flagged, on
   paper, that speed cancels out of the income/drain ratio --- but only
   actually playing a clean run showed what that meant in practice: once
   speed capped, a run that collected well had no real pressure left and just
   kept going, with nothing left to end it but a missed jump. The fix wasn't
   to shrink the speed cap the plan had just leaned on for readability, but to
   make drain itself ramp with elapsed time, independent of speed or skill --
   so even a perfectly played run eventually loses ground and every run
   resolves from time pressure, not only from a mistake. Confirmed by playing
   long clean runs before and after, not by re-reading the balance math, which
   said nothing was wrong.
   [`81ed454...f56f1ea`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-marcuszorian/compare/81ed454...f56f1ea)

4. **A collision noticed only by looking, not by reading the spawner.** The
   power-up icon sits at the same height and can land on top of a ground
   token, hiding a coin behind an icon a player has no reason to look under.
   Nothing in the spawn logic looks wrong in isolation --- both pickups are
   individually placed clear of obstacles --- the overlap only exists between
   the two pickup kinds, which is the kind of gap a played run surfaces and a
   code read of either spawner alone does not.
   [`108a001`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit5-marcuszorian/commit/108a001)

## Before you ship

`pnpm check:evidence` verifies your citations resolve to real commits, that a
reflection entry the marker reads is in `reflections/`, and that your
`CLAUDE.md` is there --- before a marker ever opens the file. It checks that
your map is traceable, not that it is good: the marker judges whether your
small, deliberately chosen set of moments shows real judgement and reflection. A
green check is not a substitute for that curation.

Images aren't checked: unlike a citation whose SHA doesn't resolve, a broken
image is visible the moment this file is rendered on GitHub.

## Before you ship

`pnpm check:evidence` verifies your citations resolve to real commits, that a
reflection entry the marker reads is in `reflections/`, and that your
`CLAUDE.md` is there --- before a marker ever opens the file. It checks that
your map is traceable, not that it is good: the marker judges whether your
small, deliberately chosen set of moments shows real judgement and reflection. A
green check is not a substitute for that curation.

Images aren't checked: unlike a citation whose SHA doesn't resolve, a broken
image is visible the moment this file is rendered on GitHub.
