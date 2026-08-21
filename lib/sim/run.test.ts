import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  DT,
  LINEAR_DECEL,
  MAX_LAUNCH_SPEED,
  MAX_STEPS,
  PEN_DIAMETER,
  PEN_LENGTH,
  START_OFFSET,
} from "./constants.ts";
import { createManifold } from "./contact.ts";
import { atRest, cloneWorld, maxSpeedAt, setup } from "./pen.ts";
import { runShot } from "./run.ts";
import { step } from "./step.ts";
import type { Frame, Pen, Shot, ShotResult, Side, World } from "./types.ts";
import { cross, length } from "./vec.ts";

function shot(over: Partial<Shot> = {}): Shot {
  return { side: "a", vx: 0, vy: 0, offset: 0, ...over };
}

function kinetic(w: World): number {
  const of = (p: Pen) =>
    0.5 * p.mass * (p.vx * p.vx + p.vy * p.vy) + 0.5 * p.inertia * p.spin * p.spin;
  return of(w.a) + of(w.b);
}

/** Gap between the two capsule surfaces. Negative means they overlap. */
function gap(w: World): number {
  return length(w.b.x - w.a.x, w.b.y - w.a.y) - PEN_DIAMETER;
}

/**
 * Radians of turn accumulated across a shot.
 *
 * Spin cannot be read off the rest position, because rest means the spin reached exactly
 * zero. How far a pen turned on the way there is the observable, and it has to be summed
 * frame by frame: the heading alone cannot tell a pen that stayed put from one that went
 * all the way round.
 */
function totalTurn(frames: readonly Frame[], side: Side, ux0: number, uy0: number): number {
  let px = ux0;
  let py = uy0;
  let turn = 0;
  for (const f of frames) {
    const pose = f[side];
    turn += Math.abs(cross(px, py, pose.ux, pose.uy));
    px = pose.ux;
    py = pose.uy;
  }
  return turn;
}

function firstTurn(r: ShotResult, side: Side, ux0: number, uy0: number): number {
  const first = r.frames[0];
  assert.ok(first, "a shot produced no frames");
  return cross(ux0, uy0, first[side].ux, first[side].uy);
}

test("setup places both pens in bounds and still", () => {
  const w = setup();
  for (const p of [w.a, w.b]) {
    assert.equal(p.out, false);
    assert.ok(Math.abs(p.x) < ARENA_WIDTH / 2);
    assert.ok(Math.abs(p.y) < ARENA_HEIGHT / 2);
    assert.equal(length(p.vx, p.vy), 0);
    assert.equal(p.spin, 0);
  }
  assert.equal(w.a.x, -w.b.x);
});

test("a shot ends at exact rest, far short of the step cap", () => {
  const r = runShot(setup(), shot({ vx: 140 }));
  assert.ok(r.steps < MAX_STEPS / 2, `took ${r.steps} steps`);
  assert.ok(atRest(r.rest.a) && atRest(r.rest.b));
  for (const p of [r.rest.a, r.rest.b]) {
    assert.equal(p.vx, 0);
    assert.equal(p.vy, 0);
    assert.equal(p.spin, 0);
  }
});

test("runShot does not touch the world it was given", () => {
  const w = setup();
  const before = JSON.stringify(w);
  runShot(w, shot({ vx: 180, offset: 3 }));
  assert.equal(JSON.stringify(w), before);
});

test("the same shot resolves identically every time", () => {
  const s = shot({ vx: 150, vy: 22, offset: -2.5 });
  const first = runShot(setup(), s);
  const second = runShot(setup(), s);
  assert.equal(JSON.stringify(first.rest), JSON.stringify(second.rest));
  assert.equal(first.steps, second.steps);
  assert.equal(first.frames.length, second.frames.length);
});

test("a gentle shot slides the distance friction says it should", () => {
  const r = runShot(setup(), shot({ side: "b", vx: 40, vy: 90 }));
  const travelled = length(r.rest.b.x - START_OFFSET, r.rest.b.y);
  const expected = (90 * 90 + 40 * 40) / (2 * LINEAR_DECEL);
  /*
   * Friction is applied before the position moves, which loses half a step of travel at
   * the start. That is v0 * dt / 2, well under a millimetre, so a one percent window is
   * loose enough for the discretisation and tight enough to catch a wrong constant.
   */
  assert.ok(
    Math.abs(travelled - expected) < expected * 0.01,
    `slid ${travelled.toFixed(3)}, expected about ${expected.toFixed(3)}`,
  );
});

test("a full-power opening flick at the other pen stays on the desk", () => {
  /*
   * The property `MAX_LAUNCH_SPEED` is set by. A first move at full power, aimed the way the game
   * wants it aimed, must not be a way to lose by accident. Anything that raises the top speed or
   * lowers desk friction has to be checked against this.
   */
  const r = runShot(setup(), shot({ side: "a", vx: MAX_LAUNCH_SPEED }));
  assert.equal(r.rest.a.out, false, `a ended at ${r.rest.a.x.toFixed(2)}`);
  assert.ok(Math.abs(r.rest.a.x) < ARENA_WIDTH / 2);
});

test("a full-power opening flick does not knock the other pen off on its own", () => {
  /*
   * The other half of the same setting. Reaching the opponent is easy and finishing them is not, so
   * the opening is about position. If this ever passes, the game has become one flick long.
   */
  const r = runShot(setup(), shot({ side: "a", vx: MAX_LAUNCH_SPEED }));
  assert.equal(r.rest.b.out, false, `b was knocked to ${r.rest.b.x.toFixed(2)}`);
  assert.ok(r.rest.b.x > START_OFFSET, "b was not moved at all");
});

test("full power sideways leaves the desk, because the sides are nearer than the opponent", () => {
  const r = runShot(setup(), shot({ side: "a", vy: MAX_LAUNCH_SPEED }));
  assert.equal(r.rest.a.out, true);
});

test("full power crosses the arena and leaves it", () => {
  const r = runShot(setup(), shot({ side: "a", vy: 200 }));
  assert.equal(r.rest.a.out, true);
});

test("a pen resting inside the edge is not out", () => {
  const w = setup();
  w.a.y = ARENA_HEIGHT / 2 - 0.2;
  const r = runShot(w, shot({ side: "a" }));
  assert.equal(r.rest.a.out, false);
});

test("a square broadside transfers speed and almost no turn", () => {
  const r = runShot(setup(), shot({ vx: 170 }));
  assert.ok(r.rest.b.x > START_OFFSET || r.rest.b.out, "b was pushed away");
  const turn = totalTurn(r.frames, "b", 0, 1);
  assert.ok(turn < 0.05, `a flat hit turned b by ${turn.toFixed(4)} rad`);
});

test("an off-centre broadside turns the pen it hits", () => {
  const w = setup();
  w.a.y = 6.5;
  const r = runShot(w, shot({ vx: 170 }));
  const turn = totalTurn(r.frames, "b", 0, 1);
  assert.ok(turn > 0.3, `an off-centre hit only turned b by ${turn.toFixed(4)} rad`);
});

test("flicking off the centre of mass turns the pen, and the side decides which way", () => {
  const left = runShot(setup(), shot({ vx: 120, offset: 1.5 }));
  const right = runShot(setup(), shot({ vx: 120, offset: -1.5 }));
  const centred = runShot(setup(), shot({ vx: 120, offset: 0 }));

  assert.ok(totalTurn(left.frames, "a", 0, 1) > 0.3, "an offset flick did not turn the pen");
  assert.ok(
    firstTurn(left, "a", 0, 1) * firstTurn(right, "a", 0, 1) < 0,
    "opposite offsets turned the pen the same way",
  );
  assert.ok(
    Math.abs(firstTurn(centred, "a", 0, 1)) < 1e-12,
    "a flick through the centre of mass turned the pen",
  );
});

test("pushing off centre costs speed, and the middle of the pen costs none", () => {
  assert.equal(maxSpeedAt(0), MAX_LAUNCH_SPEED);
  assert.equal(maxSpeedAt(3), maxSpeedAt(-3));

  let previous = MAX_LAUNCH_SPEED + 1;
  for (let offset = 0; offset <= PEN_LENGTH / 2; offset += 0.25) {
    const limit = maxSpeedAt(offset);
    assert.ok(limit < previous, `offset ${offset} was not slower than the one before`);
    assert.ok(limit > 0);
    previous = limit;
  }

  /*
   * A flick right at the tip is worth about half the distance of one through the centre. That
   * ratio is what makes the offset a choice rather than a bonus, so it is worth pinning: it
   * follows from the pen's mass and inertia, and changing either would move it silently.
   */
  const atTip = maxSpeedAt(PEN_LENGTH / 2);
  assert.ok(atTip > MAX_LAUNCH_SPEED * 0.45, `tip flick capped at ${atTip.toFixed(1)}`);
  assert.ok(atTip < MAX_LAUNCH_SPEED * 0.55, `tip flick capped at ${atTip.toFixed(1)}`);
});

test("a flick clamps to what its own offset allows, however fast it was asked for", () => {
  const greedy = runShot(setup(), shot({ vx: 10_000, offset: PEN_LENGTH / 2 }));
  const first = greedy.frames[0];
  assert.ok(first);
  /* Six frames in, a shot capped near a hundred has not yet crossed the halfway gap. */
  assert.ok(first.a.x < 0, `the clamp let it reach ${first.a.x.toFixed(2)} in one frame`);
});

test("energy never rises through a collision", () => {
  const w = cloneWorld(setup());
  w.a.vx = 190;
  w.a.spin = 6;
  const m = createManifold();
  let previous = kinetic(w);
  for (let i = 0; i < 1200; i++) {
    step(w, m);
    const now = kinetic(w);
    assert.ok(
      now <= previous + 1e-6,
      `step ${i} gained energy: ${previous.toFixed(6)} to ${now.toFixed(6)}`,
    );
    previous = now;
  }
});

test("pens are never left overlapping", () => {
  for (const vx of [60, 110, 160, 200]) {
    const r = runShot(setup(), shot({ vx }));
    if (r.rest.a.out || r.rest.b.out) continue;
    assert.ok(gap(r.rest) > -0.01, `gap ${gap(r.rest).toFixed(4)} after a ${vx} shot`);
  }
});

test("swapping sides and mirroring the arena mirrors the result", () => {
  /*
   * The transformation that turns one player's position into the other's. If this ever
   * fails, the two players are not playing the same game, whatever the arena looks like.
   */
  const straight = runShot(setup(), shot({ side: "a", vx: 150, vy: 30 }));
  const mirrored = runShot(setup(), shot({ side: "b", vx: -150, vy: 30 }));
  assert.ok(
    Math.abs(straight.rest.a.x + mirrored.rest.b.x) < 1e-9,
    `${straight.rest.a.x} against ${mirrored.rest.b.x}`,
  );
  assert.ok(Math.abs(straight.rest.a.y - mirrored.rest.b.y) < 1e-9);
  assert.ok(Math.abs(straight.rest.b.x + mirrored.rest.a.x) < 1e-9);
  assert.ok(Math.abs(straight.rest.b.y - mirrored.rest.a.y) < 1e-9);
  assert.equal(straight.steps, mirrored.steps);
});

test("frames run at sixty a second and end where the world came to rest", () => {
  const r = runShot(setup(), shot({ vx: 130 }));
  const last = r.frames.at(-1);
  assert.ok(last);
  assert.equal(last.a.x, r.rest.a.x);
  assert.equal(last.b.y, r.rest.b.y);
  assert.ok(r.frames.length >= Math.floor(r.steps * DT * 60));
});
