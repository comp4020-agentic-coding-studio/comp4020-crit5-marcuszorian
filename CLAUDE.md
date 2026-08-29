# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it and the `description` meta, and copy the head
block into any new page. A *relative* card URL resolves against the page that
names it --- `./card.png` is wrong one directory down, and nothing in CI checks
it, so the deployed head is the only place a broken one shows up. This repo
sidesteps that entirely: `index.astro` builds the `og:image` as an absolute URL
from `site` + `base`, which is also what a scraper actually wants, and takes the
card itself from the game with `pnpm shots --card`.

## The checks

`pnpm check` runs them, and `pnpm check:evidence` is the extra gate before you
ship. CI runs the same plus links, secrets and the deploy.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## Looking at the page: `pnpm shots`

Every check above parses `dist/` as text, so a page that renders a black
rectangle passes all of them. `pnpm shots` (`scripts/shot.ts`) drives real
Chrome over the DevTools protocol --- no dependency, no Playwright --- serves
the built `dist/` under its base path, presses Space with real key events, and
writes `.shots/*.png` at **1920x1080 and 390x844**, the two viewports the work
is marked at. `pnpm shots --card` also promotes the card frame to
`public/card.png`, so the link preview cannot drift from the game.

Then **look at the images**. That is the point of them; a run that only goes
green has told you nothing about what the page looks like.

The run also reads Chrome's console and exits non-zero on any exception,
error or warning --- including the autoplay one, which is how you find out that
something touched WebAudio before the first gesture. Do not pass
`--autoplay-policy=no-user-gesture-required`: it silences the sensor.

Rules this bought, and worth keeping:

- Anything the canvas draws has to be checked at both viewports, in a picture.
  Aspect ratio is not a detail you can reason your way through.
- **No check enforces either viewport.** `pnpm shots` renders both and then
  fails only on a console complaint --- it asserts nothing about what came out,
  because nothing in a PNG is worth asserting that a person can't see faster.
  A layout that is fine at 1920x1080 and unplayable at 390x844 is green in
  `check`, green in CI, and broken at the crit. Opening the two images is the
  only thing standing in the way of that.
- Declare a favicon. Undeclared, every browser asks the *domain root* for
  `/favicon.ico`, which under a project base path is a guaranteed 404.
- `og:image` is absolute, built from `site` + `base`, because a scraper
  resolves nothing against where it found the page.

## CI runs nothing while the repo is private

Both jobs in `.github/workflows/checks.yml` are gated on
`!github.event.repository.private`, so between the first commit and the
visibility flip at ship time, **every push is unobserved**. Nothing is broken;
it is deliberate, and it means local `pnpm check` and `pnpm check:evidence` are
the only backpressure that exists for the whole build.

The consequence to plan around: the first public push is the first time the
link checker, the secret scan and the evidence gate have ever run against this
repo --- and that push happens at the cutoff, when there is no time left to fix
what they find. Run both locally, early, and don't let the flip be the first
time they're exercised.

## Tests run in node, so the logic has to be DOM-free

There is no vitest config here, so vitest uses its default **node**
environment: `document` and `window` are undefined. A module that reaches for
either at import time throws while the suite is being collected, which makes it
not merely untested but untestable.

That is a constraint on architecture, not on testing, and it is worth obeying
deliberately rather than discovering. It splits every feature in two: the rules
--- state, transitions, and whatever a spec line actually asserts --- go in a
pure module that imports nothing from the browser, and the DOM, canvas, audio
and `localStorage` live in a separate one the suite never imports. Keeping the
rules pure buys reproducibility as well: the same seed and the same inputs
replay exactly, so a bad moment you felt while playing can be re-run instead of
described.

`spec/invariants.test.ts` is the exception that proves it --- it needs a DOM, so
it builds one with jsdom explicitly and parses the built HTML as a string,
rather than assuming an ambient one.

## Test the relationship, never the tuning number

A test that hardcodes a jump height or an obstacle spacing turns red on every
balance pass, and a suite you have learned to ignore is worse than no suite.
Derive timings from the constants instead of writing them out, and assert what
must stay true: "jumping clears an obstacle that otherwise kills" survives the
weekend, `expect(jumpHeight).toBe(120)` survives one afternoon. When a sweep is
cheaper than a hand-picked case, sweep --- and report the parameter in the
assertion (`expect({seed, taught})`) so a failure names the seed instead of
saying `false !== true`.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.
