import { MAX_LAUNCH_SPEED, MIN_LAUNCH_SPEED, PEN_LENGTH } from "./constants.ts";
import type { Shot, Side } from "./types.ts";
import { clamp, length } from "./vec.ts";

/**
 * The grid a shot is rounded to before it counts, in centimetres and centimetres per second.
 *
 * A sixty-fourth, because it is exactly representable in binary. Rounding to a decimal like a
 * hundredth would leave a value that cannot be held exactly, and the whole reason for rounding is
 * that the stored form of a shot has to be the shot: the browser that played it, the browser
 * watching it and the server deciding it all have to run the simulation on identical numbers, and
 * two sides rounding differently is the one way a deterministic simulation still disagrees.
 */
export const SHOT_STEP = 1 / 64;

function snap(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / SHOT_STEP) * SHOT_STEP;
}

/**
 * Put a shot into its canonical form: finite, inside the limits, on the grid.
 *
 * This is a boundary, so it assumes nothing. A shot arriving over a wire can be `NaN`, can ask for
 * a thousand times the top speed, or can claim to have been pushed a metre off the end of a pen.
 * Every one of those becomes something the simulation can run, and the result is what gets stored
 * and replayed.
 */
export function canonicalShot(side: Side, shot: Shot): Shot {
  const half = PEN_LENGTH / 2;
  const offset = snap(clamp(Number.isFinite(shot.offset) ? shot.offset : 0, -half, half));

  let vx = snap(shot.vx);
  let vy = snap(shot.vy);
  const speed = length(vx, vy);
  if (speed > MAX_LAUNCH_SPEED) {
    vx = snap((vx / speed) * MAX_LAUNCH_SPEED);
    vy = snap((vy / speed) * MAX_LAUNCH_SPEED);
  }

  return { side, vx, vy, offset };
}

/** Whether a shot is worth playing at all. The rules refuse anything softer. */
export function isPlayable(shot: Shot): boolean {
  return length(shot.vx, shot.vy) >= MIN_LAUNCH_SPEED;
}
