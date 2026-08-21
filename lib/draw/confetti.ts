import { length } from "../sim/vec.ts";
import { alpha, type PenPalette } from "./colors.ts";

/**
 * The one flourish in the product.
 *
 * Slivers rather than discs or squares, because the game is two long thin objects on a desk and a
 * shower of dots would belong to something else. They are the winner's own two colours, so the
 * burst adds no chroma the page did not already have.
 *
 * It is meant to snap. An earlier version spread a third as far over half again the time and read
 * as a smudge appearing near the middle of the desk rather than as anything being thrown. What
 * fixed it was not more pieces: it was getting them out fast, keeping them at full strength while
 * they travel, and taking them away quickly at the end. Almost all of the movement happens in the
 * first quarter of a second.
 */

/** How far the furthest sliver travels from the middle of the desk, in centimetres. */
const REACH = 17;
/**
 * Least of that reach any sliver gets.
 *
 * Well above zero on purpose. Spread evenly across the disc, most of them end up bunched near the
 * centre, which is the smudge. Throwing them all outward and varying by how far is what makes a
 * ring of debris rather than a pile.
 */
const REACH_FLOOR = 0.55;
const SIZE_MIN = 0.7;
const SIZE_SPAN = 1.5;
/** Thickness as a fraction of length. */
const THICKNESS = 0.24;
/** Turns a sliver makes over the whole burst. */
const SPIN = 2.4;
/** Latest a sliver can start, as a fraction of the burst. A flicker of stagger, not a queue. */
const LEAD = 0.1;
/** Centimetres a sliver drifts downwards by the end, so the burst finishes with some weight. */
const SETTLE = 1.8;
const PEAK_ALPHA = 0.72;
/** Held at full strength until here, then taken away over what is left. */
const HOLD = 0.55;

export interface Fleck {
  /** Unit direction out from the centre. */
  dx: number;
  dy: number;
  reach: number;
  size: number;
  spin: number;
  lead: number;
  /** Which of the winner's two colours this one takes. */
  grip: boolean;
}

/**
 * Build a burst. Deterministic, from a seed the caller varies between wins.
 *
 * Directions come from rejection sampling a disc rather than from an angle, which keeps this file
 * free of trigonometry the same way the rest of the renderer is. `drawBurst` does use `rotate`,
 * because a tumbling sliver has to turn and nothing downstream compares its result to anything.
 */
export function makeBurst(seed: number, count: number): Fleck[] {
  let state = (seed || 1) >>> 0;
  const roll = () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };

  const flecks: Fleck[] = [];
  while (flecks.length < count) {
    const dx = roll() * 2 - 1;
    const dy = roll() * 2 - 1;
    const span = length(dx, dy);
    if (span > 1 || span < 0.05) continue;
    flecks.push({
      dx: dx / span,
      dy: dy / span,
      reach: REACH * (REACH_FLOOR + span * (1 - REACH_FLOOR)),
      size: SIZE_MIN + roll() * SIZE_SPAN,
      spin: (roll() * 2 - 1) * SPIN,
      lead: roll() * LEAD,
      grip: roll() < 0.4,
    });
  }
  return flecks;
}

export function drawBurst(
  ctx: CanvasRenderingContext2D,
  flecks: readonly Fleck[],
  progress: number,
  pen: PenPalette,
): void {
  for (const fleck of flecks) {
    const life = (progress - fleck.lead) / (1 - fleck.lead);
    if (life <= 0 || life >= 1) continue;

    /* Quartic, so three quarters of the distance is covered in the first third of the flight. */
    const eased = 1 - (1 - life) ** 4;
    /* Full strength while it travels, then gone. A slow fade is what made this read as a smudge. */
    const fade =
      life < 0.06 ? life / 0.06 : life < HOLD ? 1 : 1 - ((life - HOLD) / (1 - HOLD)) ** 1.5;

    ctx.save();
    ctx.translate(
      fleck.dx * fleck.reach * eased,
      fleck.dy * fleck.reach * eased - SETTLE * life * life,
    );
    ctx.rotate(fleck.spin * eased * Math.PI * 2);
    ctx.beginPath();
    const thick = fleck.size * THICKNESS;
    ctx.roundRect(-fleck.size / 2, -thick / 2, fleck.size, thick, thick / 2);
    ctx.fillStyle = alpha(fleck.grip ? pen.grip : pen.body, PEAK_ALPHA * fade);
    ctx.fill();
    ctx.restore();
  }
}
