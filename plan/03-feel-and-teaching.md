# Feel and teaching — no tutorial, anywhere

**Files:** `src/game/config.ts` · `src/scripts/main.ts` (the bar is drawn, not simulated)

**Constants owned:** `BAR_CAP`, bar colour thresholds, first-obstacle grace distance,
caret blink period, idle scroll rate

Cross-cutting: nothing here is its own build step. It is verified at step 4 (first
playable) and again at step 13 (playtest).

## Teaching it without words

The spec line most at risk. Every mechanism below is wordless.

1. **A blinking caret invites the press.** The runner idles on a slowly scrolling
   ground with a terminal cursor blinking beside it. In a CRT-styled game that is already
   the universal "waiting for input" signal — diegetic to the look rather than UI sitting
   on top of it, and not a word anywhere.
2. **The first press is confirmed by a hop.** It starts the world *and* makes the
   runner jump, so the verb teaches itself on frame one: you pressed, the thing jumped,
   that is the game.
3. **First obstacle is far and slow**, at `START_BUDGET`'s low speed. Mario 1-1: the
   threat walks at you until you work out the answer.
4. **First pickup is a ground token in the runner's path**, collected by accident,
   with a visible bar jump. Teaches "these are good" before anything punishes you.
5. **The bar is large, drains visibly, and shifts colour as it empties.** It must be
   impossible to die dry and not know why.
6. **The death screen explains nothing** — score, best, and the same input restarts.

Numbers on screen are feedback, not instructions, and are fine. A `PRESS SPACE` label is
not. The game's name is explicitly allowed by the brief.

## Bar scale — decided

The bar is full at a fixed `BAR_CAP` of remaining headroom and pins there when you're
ahead; headroom above the cap still counts toward `budget` and speed, it just isn't
drawn.

**Rejected** the alternative of drawing `remaining / budget` as a percentage: as `budget`
grows, each pickup becomes a smaller slice, so late-game tokens stop visibly doing
anything — exactly when the feedback matters most. A constant-size bump per pickup is
what keeps the pickup→bar causal link teaching all run.

The bar itself is drawn in `main.ts`; the numbers it reads are owned by
[02-economy-and-pickups.md](02-economy-and-pickups.md#the-resource-model).

## Notes / trade-offs

- **This is the constraint that improved the design.** The obvious move was a
  `PRESS SPACE` label; the spec forbids on-screen instructions, so it became the caret
  plus the confirming hop. Worth citing in `PROCESS.md` — see
  [06-process-evidence.md](06-process-evidence.md).
- **Only a cold player settles it.** No test can assert "teaches itself". The check is
  handing it to someone, saying nothing, and watching.

## Done when

- No word on screen instructs the player. The title and numeric readouts are the only
  text.
- A cold player presses something within a few seconds of the caret appearing.
- The first press produces a jump, not just a start.
- The first obstacle is reachable only after the player has already collected a ground
  token by accident.
- Dying dry is legible: the bar was visibly emptying and had changed colour.
