import type { Frame, Pen, Pose, World } from "./types.ts";

export function poseOf(p: Pen): Pose {
  return { x: p.x, y: p.y, ux: p.ux, uy: p.uy, out: p.out };
}

/**
 * The drawable part of a world.
 *
 * A `Frame` is what the renderer is allowed to see: where each pen is and which way it
 * points. Velocity, spin and mass are the simulation's business, and keeping them out of
 * the frame is what stops a drawing routine ever being tempted to integrate anything.
 */
export function frameOf(w: World): Frame {
  return { a: poseOf(w.a), b: poseOf(w.b) };
}
