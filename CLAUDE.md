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
- Declare a favicon. Undeclared, every browser asks the *domain root* for
  `/favicon.ico`, which under a project base path is a guaranteed 404.
- `og:image` is absolute, built from `site` + `base`, because a scraper
  resolves nothing against where it found the page.

## This file is yours

A starting point, not a rulebook: what you add to it is the harness, and the
harness is assessed. This file and the sensors you wire into `check` carry
across the course --- both come with you into next week's repo. The prototype
doesn't: source, and the tests answering this week's published spec, stay
behind. `spec/README.md` draws the line.
