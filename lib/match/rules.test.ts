import assert from "node:assert/strict";
import { test } from "node:test";
import { ARENA_WIDTH } from "../sim/constants.ts";
import type { Shot } from "../sim/types.ts";
import { applyShot, newMatch, other } from "./rules.ts";

function shot(over: Partial<Shot> = {}): Shot {
  return { side: "a", vx: 0, vy: 0, offset: 0, ...over };
}

test("a new match has a's flick and no result", () => {
  const m = newMatch();
  assert.equal(m.turn, "a");
  assert.equal(m.result, null);
  assert.equal(m.shots, 0);
});

test("a flick that decides nothing passes the turn", () => {
  const applied = applyShot(newMatch(), shot({ vx: 30 }));
  assert.ok(applied.ok);
  assert.equal(applied.match.turn, "b");
  assert.equal(applied.match.result, null);
  assert.equal(applied.match.shots, 1);
});

test("flicking out of turn is refused", () => {
  const applied = applyShot(newMatch("b"), shot({ side: "a", vx: 30 }));
  assert.equal(applied.ok, false);
  assert.ok(!applied.ok && applied.reason === "not-your-turn");
});

test("knocking the other pen off wins the match", () => {
  const m = newMatch();
  /*
   * Equal masses at this restitution send about two thirds of the impact speed on and keep
   * a third, so the struck pen slides roughly four times as far as the one that hit it.
   * That is the margin a clean knock lives in: b three centimetres from the edge needs a
   * little over three centimetres of slide, and a is left with four centimetres of room and
   * under one centimetre of travel to use it on.
   */
  m.world.a.x = 0;
  m.world.b.x = ARENA_WIDTH / 2 - 3;
  const applied = applyShot(m, shot({ vx: 142 }));
  assert.ok(applied.ok);
  assert.equal(applied.shot.rest.a.out, false, "a stayed on the desk");
  assert.deepEqual(applied.match.result, { winner: "a", ending: "knocked" });
});

test("putting your own pen off loses, and says so", () => {
  const applied = applyShot(newMatch(), shot({ vy: 200 }));
  assert.ok(applied.ok);
  assert.deepEqual(applied.match.result, { winner: "b", ending: "self" });
});

test("taking both pens off is a draw", () => {
  const m = newMatch();
  /* Full power from right behind b, so a follows it over the edge. */
  m.world.a.x = ARENA_WIDTH / 2 - 3;
  m.world.b.x = ARENA_WIDTH / 2 - 1.5;
  const applied = applyShot(m, shot({ vx: 200 }));
  assert.ok(applied.ok);
  assert.equal(applied.shot.rest.a.out, true);
  assert.equal(applied.shot.rest.b.out, true);
  assert.deepEqual(applied.match.result, { winner: null, ending: "draw" });
});

test("a draw ends the match like any other result", () => {
  const m = newMatch();
  m.world.a.x = ARENA_WIDTH / 2 - 3;
  m.world.b.x = ARENA_WIDTH / 2 - 1.5;
  const drawn = applyShot(m, shot({ vx: 200 }));
  assert.ok(drawn.ok);

  /* No further flicks, and the turn stays where it was, as it does for a win. */
  const after = applyShot(drawn.match, shot({ side: drawn.match.turn, vx: 20 }));
  assert.equal(after.ok, false);
  assert.ok(!after.ok && after.reason === "match-over");
  assert.equal(drawn.match.turn, "a");
});

test("a finished match refuses further flicks", () => {
  const first = applyShot(newMatch(), shot({ vy: 200 }));
  assert.ok(first.ok);
  const second = applyShot(first.match, shot({ side: first.match.turn, vx: 20 }));
  assert.equal(second.ok, false);
  assert.ok(!second.ok && second.reason === "match-over");
});

test("a decided match keeps the turn where it was", () => {
  const applied = applyShot(newMatch(), shot({ vy: 200 }));
  assert.ok(applied.ok);
  assert.equal(applied.match.turn, "a");
});

test("a flick towards your own edge is allowed, and loses", () => {
  /*
   * There is no rule against it. A pen fight has none, and one was added here for a while as the
   * wrong answer to a different problem: it left the control dead across half its range, so half
   * of every gesture drew nothing and did nothing. Flicking yourself off the desk is a way to
   * lose, which is not the same thing as a move that cannot be played.
   */
  const applied = applyShot(newMatch("a"), shot({ side: "a", vx: -200 }));
  assert.ok(applied.ok);
  assert.deepEqual(applied.match.result, { winner: "b", ending: "self" });
});

test("exactly sideways is allowed, so a pen can be repositioned", () => {
  for (const side of ["a", "b"] as const) {
    const applied = applyShot(newMatch(side), shot({ side, vx: 0, vy: 90 }));
    assert.ok(applied.ok, `${side} could not flick sideways`);
  }
});

test("a flick too soft to be a shot is refused, because there is no passing", () => {
  const applied = applyShot(newMatch(), shot({ vx: 4 }));
  assert.equal(applied.ok, false);
  assert.ok(!applied.ok && applied.reason === "too-soft");
});

test("other flips the side", () => {
  assert.equal(other("a"), "b");
  assert.equal(other("b"), "a");
});
