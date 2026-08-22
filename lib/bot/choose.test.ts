import assert from "node:assert/strict";
import { test } from "node:test";
import { applyShot, newMatch } from "../match/rules.ts";
import { ARENA_WIDTH, MIN_LAUNCH_SPEED } from "../sim/constants.ts";
import { maxSpeedAt, setup } from "../sim/pen.ts";
import type { World } from "../sim/types.ts";
import { length } from "../sim/vec.ts";
import { chooseShot } from "./choose.ts";
import { LEVEL_NAMES } from "./levels.ts";

/** A handful of positions, including two the bot will meet in a real match. */
function positions(): World[] {
  const opening = setup();

  const scattered = setup();
  scattered.a.x = -3;
  scattered.a.y = 5;
  scattered.a.ux = 0.6;
  scattered.a.uy = 0.8;
  scattered.b.x = 12;
  scattered.b.y = -6;

  const cornered = setup();
  cornered.a.x = -18;
  cornered.a.y = 11;
  cornered.b.x = -14;
  cornered.b.y = 10;

  const crowded = setup();
  crowded.a.x = 0;
  crowded.b.x = 1.4;

  return [opening, scattered, cornered, crowded];
}

test("the same position always draws the same flick", () => {
  for (const world of positions()) {
    for (const level of LEVEL_NAMES) {
      const first = chooseShot(world, "b", level, 3);
      const second = chooseShot(world, "b", level, 3);
      assert.deepEqual(first, second);
    }
  }
});

test("the turn number changes the flick, so a repeated position is not a repeated shot", () => {
  const world = setup();
  const early = chooseShot(world, "b", "medium", 0);
  const later = chooseShot(world, "b", "medium", 1);
  assert.notDeepEqual(early, later);
});

test("every level plays a flick the rules accept, from every position", () => {
  for (const world of positions()) {
    for (const level of LEVEL_NAMES) {
      for (const side of ["a", "b"] as const) {
        const match = { ...newMatch(side), world };
        const shot = chooseShot(world, side, level, 5);
        const applied = applyShot(match, shot);
        assert.ok(
          applied.ok,
          `${level} played a ${!applied.ok ? applied.reason : ""} flick for ${side}`,
        );
      }
    }
  }
});

test("a flick never asks for more speed than its own offset allows", () => {
  for (const world of positions()) {
    for (const level of LEVEL_NAMES) {
      const shot = chooseShot(world, "b", level, 2);
      const speed = length(shot.vx, shot.vy);
      assert.ok(speed >= MIN_LAUNCH_SPEED, `${level} played a ${speed.toFixed(2)} flick`);
      assert.ok(speed <= maxSpeedAt(shot.offset) + 1e-9, `${level} exceeded its own cap`);
    }
  }
});

test("the hardest level takes a win that is there to be taken", () => {
  /*
   * a sits half a centimetre from its own edge with b right behind it. Nudging a over is the
   * whole of the position, and something searching two hundred shots has no excuse for missing
   * it. The easier levels are not held to this: failing to execute is what they are for.
   */
  const world = setup();
  world.a.x = -(ARENA_WIDTH / 2) + 0.5;
  world.b.x = -(ARENA_WIDTH / 2) + 2.5;

  const match = { ...newMatch("b"), world };
  const applied = applyShot(match, chooseShot(world, "b", "hard", 0));
  assert.ok(applied.ok);
  assert.deepEqual(applied.match.result, { winner: "b", ending: "knocked" });
});

test("the bot flicks at the other pen, whichever side of it that is", () => {
  /*
   * The pens change ends constantly, and this is the position the bot could not play at all: the
   * other pen behind it, so reaching it means flicking the way the old fixed fan called backwards.
   * Every candidate was forced into one half of the compass, the aimed ones had their x flipped
   * after being pointed correctly, and what came out was the best of a set of shots that all
   * missed. It was reported as the bot barely moving.
   */
  const world = setup();
  world.a.x = 16;
  world.b.x = -8;

  for (const level of LEVEL_NAMES) {
    for (let nonce = 0; nonce < 8; nonce++) {
      const shot = chooseShot(world, "b", level, nonce);
      assert.ok(shot.vx > 0, `${level} flicked away from the other pen on turn ${nonce}`);
    }
  }
});

test("no position is answered with a flick of nothing", () => {
  /*
   * The bug this holds off is a scoring tie, not a bad aim. Out of reach of the other pen, and
   * anywhere in the middle band of the desk where their distance to the nearest edge cannot change,
   * every candidate used to score the same and the winner was whichever moved least. Three times
   * the legal floor is about a centimetre and a half of slide, which is the least that reads as a
   * flick rather than as the bot passing.
   */
  const reach = MIN_LAUNCH_SPEED * 3;
  const places: readonly (readonly [number, number, number, number])[] = [
    /* Across the desk, further apart than any flick can travel. */
    [-18, -12, 9, 0],
    /* Both inside the middle band, where pushing along the desk changes no edge distance. */
    [-1, 0, 1, 0],
    [2, 0, 4, 0],
    [0, 0, 12, 0],
  ];

  for (const [ax, ay, bx, by] of places) {
    const world = setup();
    world.a.x = ax;
    world.a.y = ay;
    world.b.x = bx;
    world.b.y = by;

    for (const level of LEVEL_NAMES) {
      for (let nonce = 0; nonce < 4; nonce++) {
        const shot = chooseShot(world, "b", level, nonce);
        const speed = length(shot.vx, shot.vy);
        assert.ok(
          speed >= reach,
          `${level} answered ${ax},${ay} against ${bx},${by} with a flick of ${speed.toFixed(1)}`,
        );
      }
    }
  }
});

test("a bot match plays itself out to a result", () => {
  /* Both sides played by the bot. If either level can stall, this never ends. */
  let match = newMatch("a");
  let flicks = 0;
  while (!match.result && flicks < 200) {
    const level = match.turn === "a" ? "easy" : "hard";
    const applied = applyShot(match, chooseShot(match.world, match.turn, level, flicks));
    assert.ok(applied.ok, `flick ${flicks} was refused`);
    match = applied.match;
    flicks++;
  }
  assert.ok(match.result, `no result after ${flicks} flicks`);
});
