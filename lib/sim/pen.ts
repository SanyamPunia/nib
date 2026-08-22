import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAX_LAUNCH_SPEED,
  PEN_DIAMETER,
  PEN_INERTIA,
  PEN_LENGTH,
  PEN_MASS,
  START_OFFSET,
} from "./constants.ts";
import type { Pen, Shot, Side, World } from "./types.ts";
import { clamp, cross, length } from "./vec.ts";

function createPen(x: number, y: number, ux: number, uy: number): Pen {
  const half = PEN_LENGTH / 2;
  return {
    x,
    y,
    ux,
    uy,
    vx: 0,
    vy: 0,
    spin: 0,
    half,
    radius: PEN_DIAMETER / 2,
    mass: PEN_MASS,
    inertia: PEN_INERTIA,
    out: false,
  };
}

/**
 * The opening position: both pens lying across the arena, facing along the same axis, one
 * either side of the centre line. It is the setup the desk game starts from, and it makes
 * the first shot of every match a broadside.
 */
export function setup(): World {
  return {
    a: createPen(-START_OFFSET, 0, 0, 1),
    b: createPen(START_OFFSET, 0, 0, 1),
  };
}

export function clonePen(p: Pen): Pen {
  return { ...p };
}

export function cloneWorld(w: World): World {
  return { a: clonePen(w.a), b: clonePen(w.b) };
}

export function pen(w: World, side: Side): Pen {
  return side === "a" ? w.a : w.b;
}

/**
 * The fastest a flick pushed this far off the centre of mass can be.
 *
 * A flick is one push, and pushing off-centre spends part of it on turning the pen instead of
 * moving it. Holding the energy of the push constant rather than its momentum is what makes
 * that a trade: the centre of the pen is where the distance is, and the ends are where the spin
 * is, and a player has to pick.
 *
 * It also keeps the spin drawable. Momentum held constant instead gives a tip flick at full
 * power about fourteen turns a second, which at sixty frames is over eighty degrees between
 * frames. That does not read as a fast spin, it reads as a pen flickering, and past ninety it
 * would appear to rotate backwards. Under this rule a tip flick travels half as far and turns
 * about seven times a second, which is fast and still legible.
 *
 * The clamp lives here rather than in the input, so it holds for a shot arriving from anywhere,
 * and the input calls this same function so the arrow it draws cannot promise a speed the pen
 * will not be given.
 */
export function maxSpeedAt(offset: number): number {
  const spent = (offset * offset * PEN_MASS) / PEN_INERTIA;
  return MAX_LAUNCH_SPEED / Math.sqrt(1 + spent);
}

/**
 * Apply a flick.
 *
 * The pen is given the requested velocity outright rather than accumulating an impulse,
 * because a pen at rest is the only thing that is ever flicked and the two are identical
 * in that case. The spin that comes with it is the moment of the same impulse about the
 * centre of mass, so pushing off-centre turns the pen exactly as much as it should.
 */
export function launch(p: Pen, shot: Shot): void {
  const offsetNow = clamp(shot.offset, -p.half, p.half);
  const limit = maxSpeedAt(offsetNow);
  const speed = length(shot.vx, shot.vy);
  const scale = speed > limit ? limit / speed : 1;
  const vx = shot.vx * scale;
  const vy = shot.vy * scale;
  const offset = offsetNow;

  p.vx = vx;
  p.vy = vy;
  p.spin += (offset * p.mass * cross(p.ux, p.uy, vx, vy)) / p.inertia;
}

/**
 * A pen is at rest when it is exactly still, not nearly still. Coulomb friction
 * subtracts a fixed amount per step and clamps at zero, so this is reachable rather than
 * a tolerance, and a shot therefore has an exact end.
 */
export function atRest(p: Pen): boolean {
  return p.out || (p.vx === 0 && p.vy === 0 && p.spin === 0);
}

/**
 * Out when the centre of mass leaves the arena, not when the pen first overhangs the
 * edge. That is the real condition: a pen half off a desk stays there, and it tips when
 * its weight passes the edge. It also means the arena needs no walls at all, which is why
 * there is no code anywhere that bounces a pen off one.
 */
export function checkOut(p: Pen): void {
  if (p.out) return;
  if (Math.abs(p.x) > ARENA_WIDTH / 2 || Math.abs(p.y) > ARENA_HEIGHT / 2) {
    p.out = true;
    p.vx = 0;
    p.vy = 0;
    p.spin = 0;
  }
}
