import { FRAME_EVERY, MAX_STEPS } from "./constants.ts";
import { createManifold } from "./contact.ts";
import { frameOf } from "./frame.ts";
import { atRest, cloneWorld, launch, pen } from "./pen.ts";
import { step } from "./step.ts";
import type { Frame, Shot, ShotResult, World } from "./types.ts";

/**
 * Play one flick out to rest.
 *
 * The input world is not touched. A shot is a question asked of a position, and the bot asks it
 * a couple of hundred times a turn against positions it has no business changing.
 *
 * `frames` is optional because collecting them is the expensive part. A shot lasts a second or
 * two, which is a hundred-odd poses, and a bot turn that wanted them would allocate tens of
 * thousands of objects to look at none of them.
 */
function play(
  world: World,
  shot: Shot,
  frames: Frame[] | null,
): { rest: World; steps: number } {
  const w = cloneWorld(world);
  launch(pen(w, shot.side), shot);

  const manifold = createManifold();
  let steps = 0;
  while (steps < MAX_STEPS && !(atRest(w.a) && atRest(w.b))) {
    step(w, manifold);
    steps++;
    if (frames && steps % FRAME_EVERY === 0) frames.push(frameOf(w));
  }

  /*
   * The last frame is always the rest position, even when the shot ended part way through a
   * frame interval. Without it the pens are drawn a few milliseconds short of where the result
   * was decided, and a pen that stopped with its centre a hair inside the edge is drawn outside
   * it.
   */
  if (frames) frames.push(frameOf(w));

  return { rest: w, steps };
}

/** Where a flick leaves the world, and nothing else. What the bot asks. */
export function resolve(world: World, shot: Shot): World {
  return play(world, shot, null).rest;
}

/**
 * A flick, with the poses needed to draw it.
 *
 * The frames are for drawing and nothing else. They are not sent anywhere: a shot is four
 * numbers, so the far side of a match replays it rather than receiving the animation, and the
 * two agree because `step` is deterministic. That is the whole reason the simulation is built
 * the way it is.
 */
export function runShot(world: World, shot: Shot): ShotResult {
  const frames: Frame[] = [];
  const { rest, steps } = play(world, shot, frames);
  return { frames, steps, rest };
}
