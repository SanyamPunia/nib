import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  PEN_DIAMETER,
  PEN_LENGTH,
  START_OFFSET,
} from "../sim/constants.ts";
import { arenaRotated, arenaScale, surfaceReach, toCanvas, toWorld } from "./arena.ts";

const HALF = PEN_LENGTH / 2;
const RADIUS = PEN_DIAMETER / 2;

/** A pen lying along y, which is how both pens start. */
function reach(dx: number, dy: number): number {
  return surfaceReach(0, 1, dx, dy, HALF, RADIUS);
}

test("across the pen, the surface is one radius away", () => {
  assert.equal(reach(1, 0), RADIUS);
  assert.equal(reach(-1, 0), RADIUS);
});

test("along the pen, the surface is the far tip", () => {
  assert.equal(reach(0, 1), HALF + RADIUS);
  assert.equal(reach(0, -1), HALF + RADIUS);
});

test("the surface never sits inside the pen and never past its tip", () => {
  for (let i = 0; i <= 90; i++) {
    const t = (i / 90) * (Math.PI / 2);
    const r = reach(Math.cos(t), Math.sin(t));
    assert.ok(r >= RADIUS, `${i} degrees gave ${r}, inside the pen`);
    assert.ok(r <= HALF + RADIUS, `${i} degrees gave ${r}, past the tip`);
  }
});

test("the surface recedes as the aim swings towards the pen's own length", () => {
  let previous = 0;
  for (let i = 0; i <= 90; i++) {
    const t = (i / 90) * (Math.PI / 2);
    /*
     * Sweeping from across the pen to along it. The arrow starts further out every step,
     * because it is leaving a longer object end on rather than side on. A regression here
     * would put the arrow's tail back inside the pen at some angles, which is the fault this
     * function exists to prevent and the one an eye only catches at the extremes.
     */
    const r = reach(Math.cos(t), Math.sin(t));
    assert.ok(r >= previous - 1e-12, `${i} degrees went backwards: ${previous} to ${r}`);
    previous = r;
  }
  assert.ok(previous > HALF, "the sweep never reached the tip");
});

test("it does not care which end of the pen points which way", () => {
  const upright = surfaceReach(0, 1, 0.6, 0.8, HALF, RADIUS);
  const flipped = surfaceReach(0, -1, 0.6, 0.8, HALF, RADIUS);
  assert.equal(upright, flipped);
});

const PHONE = { width: 366, height: 644, dpr: 3 };
const DESKTOP = { width: 1248, height: 700, dpr: 2 };

test("the desk turns when turning it makes it bigger, and not otherwise", () => {
  assert.equal(arenaRotated(DESKTOP), false);
  assert.equal(arenaRotated(PHONE), true);
  /* Turning has to be worth it: a square box gains nothing, so it stays flat. */
  assert.equal(arenaRotated({ width: 600, height: 600, dpr: 1 }), false);
});

test("turning the desk is what makes it usable on a tall screen", () => {
  /*
   * The point of the rotation, stated as the thing it buys. A landscape arena on a portrait screen
   * is limited by width and wastes the height, and this is the margin by which that is true.
   */
  const turned = arenaScale(PHONE);
  const flat = Math.min(PHONE.width / (ARENA_WIDTH + 5), PHONE.height / (ARENA_HEIGHT + 5));
  assert.ok(turned > flat * 1.25, `turning gained only ${(turned / flat).toFixed(2)} times`);
});

test("the desk always fits, turned or flat", () => {
  for (const view of [PHONE, DESKTOP, { width: 320, height: 900, dpr: 2 }]) {
    const scale = arenaScale(view);
    const long = ARENA_WIDTH * scale;
    const short = ARENA_HEIGHT * scale;
    const [wide, tall] = arenaRotated(view) ? [short, long] : [long, short];
    assert.ok(wide <= view.width, `desk is ${wide} wide in a ${view.width} box`);
    assert.ok(tall <= view.height, `desk is ${tall} tall in a ${view.height} box`);
  }
});

test("toCanvas and toWorld are inverses, turned or flat", () => {
  for (const view of [PHONE, DESKTOP]) {
    for (const [x, y] of [
      [0, 0],
      [-9, 0],
      [9, 0],
      [-19.5, 13.5],
      [4.25, -7.75],
    ] as const) {
      const at = toCanvas(view, x, y);
      const back = toWorld(view, at.x, at.y);
      assert.ok(Math.abs(back.x - x) < 1e-9, `x ${x} came back as ${back.x}`);
      assert.ok(Math.abs(back.y - y) < 1e-9, `y ${y} came back as ${back.y}`);
    }
  }
});

test("turned, the player's own end of the desk is at the bottom of the screen", () => {
  /*
   * Which way round the quarter turn goes is not arbitrary. The pen the player reaches for has to
   * be the one nearest their hand, and on a phone held in one hand that is the bottom of the
   * screen.
   */
  const mine = toCanvas(PHONE, -START_OFFSET, 0);
  const theirs = toCanvas(PHONE, START_OFFSET, 0);
  assert.ok(mine.y > theirs.y, "the player's pen is not the lower one");
  assert.ok(Math.abs(mine.x - theirs.x) < 1e-9, "the pens are not on one vertical line");
});

test("the desk is limited by whichever axis is tighter", () => {
  const tall = { width: 500, height: 4000, dpr: 1 };
  assert.equal(arenaScale(tall), arenaScale({ ...tall, height: 9000 }));
  const wide = { width: 4000, height: 380, dpr: 1 };
  assert.equal(arenaScale(wide), arenaScale({ ...wide, width: 9000 }));
});
