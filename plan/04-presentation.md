# Presentation — viewports, juice, audio, persistence, page shell

**Files:** `src/scripts/main.ts` · `src/styles/styles.css` · `src/pages/index.astro` ·
`public/card.png`

**Constants owned:** `WORLD_W` usage in the transform, ground-line fraction, shake
magnitude and duration, particle counts and lifetimes, audio frequencies and envelopes,
localStorage key

Build-order steps: **5, 9, 10, 11, 12**.

## Viewport strategy — constant world width, variable height

Marking is **Chrome at 1920×1080 and 390×844 portrait**. Nothing in CI catches a failure
at either.

- One virtual coordinate system, `WORLD_W = 1000` units wide, always.
- Canvas CSS size = viewport; backing store = CSS size × `devicePixelRatio`; one
  transform maps 1000 world units to the full width.
- World height in units varies (`1000 * h/w`); sky and ground stretch, ground line
  anchored relative to the bottom.

The same length of track is visible at both viewports, so reaction time is identical and
`rules.ts` never learns the viewport exists.

## Juice — particles and screen shake

Step 9. Pickup bursts, a death impact, a shake on collision. Purely `main.ts`; no
gameplay state, so nothing here is tested.

## Audio (step 10)

WebAudio, zero dependencies: jump blip, pickup chime, death thud. The first user gesture
unlocks the context, so **the opening press covers the autoplay policy** — the game
cannot make a sound before the player has pressed something, which is exactly the
gesture the caret is inviting.

## Best score (step 11)

`localStorage`, read on load and written on death, shown on the death screen next to the
run's score. Guard the read — a blocked or absent store must not break the game.

## Page shell (step 12)

- `<title>` and `meta[name=description]` — the real ones, replacing the template's
  placeholders in `src/pages/index.astro`.
- `public/card.png` at 1200×630, and the `og:image` meta pointing at it. The URL resolves
  against the page that names it; `./card.png` is correct from the root page and wrong
  one directory down.
- Exactly one `<h1>` — the game's name serves. Visually hidden is fine; nothing checks
  visibility.
- **Style `<nav>` as part of the terminal chrome** rather than hiding it. The harness
  requires a real `<nav>` element and `role="navigation"` fails — see
  [05-testing-and-harness.md](05-testing-and-harness.md#harness-constraints-to-honour).

## Notes / trade-offs

- **Constant world width, not constant world height.** Fixing the height instead would
  change how much track is visible between the two marking viewports, and with it the
  reaction time — the game would be a different difficulty on a phone.
- **`nav` styled, not hidden.** A hidden landmark passes the check and looks like
  gaming it; terminal chrome earns its place on screen.

## Done when

- Played in Chrome at **1920×1080** and at **390×844 portrait** — both playable, ground
  line sensible, bar readable, nothing clipped. The rendered page is the truth.
- Canvas is crisp on a HiDPI display (backing store scaled by `devicePixelRatio`).
- Jump, pickup and death each make a distinct sound, and none fires before the first
  press.
- Best score survives a reload; clearing site data doesn't throw.
- `dist/index.html`'s head has the real title, description and a resolving `og:image`,
  and the page has exactly one `<h1>` and a real `<nav>`.
