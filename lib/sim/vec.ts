/*
 * Scalar 2D helpers. They take and return numbers rather than objects because the step
 * loop runs a few thousand times per shot and a few hundred thousand times per bot turn,
 * and a vector type that allocates would put a garbage collector inside the physics.
 *
 * Nothing here calls a transcendental. `sin`, `cos`, `pow` and `atan2` are not specified
 * to the last bit by IEEE-754 and their results differ between JavaScript engines, which
 * would make a shot resolve one way in Chrome and another way on the server. Only the
 * exactly specified operations are used: add, subtract, multiply, divide and sqrt.
 */

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/** The z component of the 3D cross product. In 2D it is a scalar. */
export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * How far along a segment the closest point to `(px, py)` lies, as a signed distance from
 * the segment's centre, clamped to its ends.
 */
export function closestOnAxis(
  px: number,
  py: number,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  half: number,
): number {
  return clamp(dot(px - cx, py - cy, ux, uy), -half, half);
}
