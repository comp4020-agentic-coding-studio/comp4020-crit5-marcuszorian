import { describe, expect, it } from "vitest";
import { SHOTS } from "../scripts/shot-plan.ts";
import type { Shot } from "../scripts/shot-plan.ts";
import type { Status } from "../src/game/rules.ts";
import { createGame, step } from "../src/game/rules.ts";

// A sensor, not a contract test. It answers a failure this repo actually had:
// a balance pass moved SPEED_BASE, the first obstacle started arriving 300ms
// earlier, and the hand-tuned second press in `pnpm shots` became too late to
// clear it. Every check stayed green — they parse `dist/` as text — and
// `pnpm shots` stayed green too, because it asserts nothing about the picture
// and only fails on a console complaint. The two files named `*-run.png` were
// death screens, and the only thing between that and the crit was a person
// opening them.
//
// So: replay each shot's presses through the same pure rules the browser runs,
// and check the game is in the state the shot's *name* claims at the moment the
// shutter opens. It cannot tell you the frame is well composed — look at the
// images for that, always — but it can tell you the runner is still alive in it.
//
// The replay is not frame-exact against Chrome (real dt jitters, and a press
// lands on the next frame either way). That is fine for what this is for: it
// catches a schedule that has drifted out of the ~380ms window the jump has,
// not a press that is 16ms off.

const DT = 1 / 60;

/** What each shot's name promises the game will be doing. */
function expected(name: string): Status {
  if (name.endsWith("-idle")) return "idle";
  if (name.endsWith("-over")) return "over";
  // `-run` and the card frame, which is a run frame at card dimensions.
  return "running";
}

/**
 * Replay a shot's presses at 60fps and report the state at `shot.at` — and,
 * separately, whether the runner ever died on the way there.
 *
 * `died` is the load-bearing half. The same button jumps and restarts, so a
 * schedule whose jump is too late dies, restarts on a later press, and reports
 * `running` at the shutter while the browser — which swallows presses for
 * ENDING_LOCKOUT after a death — photographs the death screen. Asking only for
 * the final status passed the exact broken schedule this test exists to catch.
 */
function replay(shot: Shot): { status: Status; died: boolean } {
  const pending = [...shot.press].sort((a, b) => a - b);
  let state = createGame(1);
  let died = false;
  for (let ms = 0; ms < shot.at; ms += DT * 1000) {
    // A press fires on the first frame at or after its mark, which is what
    // `Input.dispatchKeyEvent` amounts to against a running rAF loop.
    const jump = pending.length > 0 && pending[0]! <= ms;
    if (jump) pending.shift();
    state = step(state, { jump }, DT);
    if (state.status === "over") died = true;
  }
  return { status: state.status, died };
}

describe("the screenshot schedule still photographs what it says it does", () => {
  it("has every shot in the state its name promises", () => {
    for (const shot of SHOTS) {
      const want = expected(shot.name);
      const { status, died } = replay(shot);
      // Reported as an object so a failure names the shot and what it was
      // doing, rather than saying `"over" !== "running"`.
      expect({ shot: shot.name, status, diedFirst: died && want !== "over" })
        .toEqual({ shot: shot.name, status: want, diedFirst: false });
    }
  });

  it("photographs both marking viewports, mid-run", () => {
    // The rule from CLAUDE.md, made mechanical: a layout that is fine at
    // 1920x1080 and unplayable at 390x844 passes every other check in the repo.
    const running = SHOTS.filter((shot) => expected(shot.name) === "running");
    expect(running.map((shot) => `${shot.width}x${shot.height}`)).toEqual(
      expect.arrayContaining(["1920x1080", "390x844"]),
    );
  });
});
