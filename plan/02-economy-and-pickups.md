# Economy and pickups — the four numbers, two heights, the power-up

**Files:** `src/game/config.ts` · `src/game/rules.ts`

**Constants owned:** `START_BUDGET`, `DRAIN`, `TOKEN_VALUE`, `HIGH_TOKEN_VALUE`, `BOOST`,
`INVULN_MS`, `speedFor` coefficients, spawn densities and spacing

Build-order steps: **7, 8**.

## The resource model

Four numbers, and the whole design lives in the relationship between them:

| Name | Meaning | Behaviour |
|---|---|---|
| `used` | tokens consumed so far | rises with distance; this is the score |
| `budget` | the ceiling | starts at `START_BUDGET`; only pickups raise it |
| `remaining` | `budget - used` | what the bar shows |
| `speed` | scroll rate | `speedFor(budget)` — monotonic in `budget` |

- Running costs tokens: `used += speed * dt * DRAIN`. Going faster burns more and scores
  more.
- The run ends when `remaining <= 0`, or on collision while not invincible.
- Token pickup: `budget += TOKEN_VALUE`. Buys headroom — and, through `speedFor`, makes
  the rest of the run faster.

That last line is the design. Every reward is also a difficulty increase, so the player
sets their own ramp and there is a real decision in every token.

## Two heights, one button

- **Ground tokens** collect by running through them. Free.
- **High tokens** need a jump. Worth more.
- **Obstacles** sit on the ground.

Jump is therefore both the avoid verb and the collect verb. A high token hovering just
past an obstacle is the interesting shape: one jump takes both, a greedy jump kills you.
Two mechanics interacting, nothing extra to teach.

## The power-up

Rare spawn. On pickup: invincible for `INVULN_MS`, and `budget += BOOST` (large). Because
speed is a function of budget, the boost **is** the speed increase — it feeds the
existing rule rather than adding a new one. A few seconds of immunity bought with a
permanently faster game.

## The balance trap to watch

Worth knowing before tuning, because it isn't obvious. Work the rates:

- tokens encountered per second = `density × speed`
- tokens drained per second = `DRAIN × speed`

Both scale linearly with speed, so **speed cancels**. Net budget change is
`speed × (density × TOKEN_VALUE − DRAIN)` — the sign never changes with speed, giving one
of two runaways: income slightly above drain means budget → speed → budget, accelerating
to "too fast to react"; drain above income means you always die dry and collecting only
delays it.

Neither is broken, but the dial is not `TOKEN_VALUE` or `DRAIN` alone — it is their ratio
against **how many tokens a player actually collects**. Target: collecting nearly all of
them is net positive, collecting ~70% is net negative. Then the bar always matters and
skill is what keeps you alive.

Only playing settles it, which makes this a strong candidate for the required
play-derived change — see
[06-process-evidence.md](06-process-evidence.md#the-play-derived-change-step-13).

## Notes / trade-offs

- **The power-up adds no new rule.** Invincibility is the only genuinely new state; the
  speed gain rides on `speedFor`. Rejected a separate speed multiplier for exactly this
  reason.
- **Tune the ratio, not the terms.** Changing `TOKEN_VALUE` alone moves both the income
  and the perceived reward; the collection rate is the thing to hold fixed while tuning.

## Done when

- A token pickup raises `budget`, and therefore `speedFor(budget)` — asserted as a
  property, not against a number.
- High tokens are unreachable without a jump and worth more than ground tokens.
- The power-up makes exactly one collision survivable, and stops after `INVULN_MS`.
- A clean run collecting nearly everything trends net-positive on budget; a sloppy run
  around 70% collection trends net-negative. Confirmed by playing, not by reading.
