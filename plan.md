# Context Window — C5 "A game"

A terminal-styled endless runner where the player's token budget is the clock: running
costs tokens, pickups buy headroom, and because speed is a function of budget, every
reward is also a difficulty increase. One input — jump — which is both the avoid verb and
the collect verb. No tutorial anywhere.

Deliverable: COMP4020 C5, cutoff **Mon 31 Aug 2026, 12:00**, deploying to
<https://comp4020-agentic-coding-studio.github.io/comp4020-crit5-marcuszorian/>.

The plan is split by feature under [`plan/`](plan/README.md):

| # | File | Covers |
|---|---|---|
| — | [README](plan/README.md) | context, the file map, the 16-step build order, what a person judges |
| 01 | [core-loop](plan/01-core-loop.md) | architecture (`config`/`rules`/`main`, pure reducer), the one input, collision, the two endings |
| 02 | [economy-and-pickups](plan/02-economy-and-pickups.md) | `used`/`budget`/`remaining`/`speed`, tokens at two heights, the power-up, the balance trap |
| 03 | [feel-and-teaching](plan/03-feel-and-teaching.md) | wordless onboarding, the caret, the confirming hop, the budget bar's scale |
| 04 | [presentation](plan/04-presentation.md) | marking viewports, terminal styling, juice, audio, best score, page shell |
| 05 | [testing-and-harness](plan/05-testing-and-harness.md) | `spec/game.test.ts`, the invariants, CI, `CLAUDE.md` additions, verification |
| 06 | [process-evidence](plan/06-process-evidence.md) | the play-derived change, `PROCESS.md`, `reflections/crit-5.md` |

Start at [`plan/README.md`](plan/README.md).
