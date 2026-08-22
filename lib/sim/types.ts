/**
 * A pen, as the simulation sees it: a capsule on a plane with a position, a heading, a
 * velocity and a spin.
 *
 * Every field is mutable and the step function writes them in place, for the same reason
 * `vec.ts` deals in numbers. Treat a `Pen` as owned by the world that holds it.
 */
export interface Pen {
  /** Centre of mass. */
  x: number;
  y: number;
  /**
   * Heading, as a unit vector rather than an angle.
   *
   * An angle would have to become a direction through `cos` and `sin` on every step, and
   * those are the two functions the simulation cannot use. Holding the direction itself
   * means rotation is a multiply and the loop stays exactly reproducible.
   */
  ux: number;
  uy: number;
  vx: number;
  vy: number;
  /** Radians per second, positive anticlockwise. */
  spin: number;
  /** Half the length of the spine, so the capsule runs from `-half` to `+half` along `u`. */
  half: number;
  radius: number;
  mass: number;
  inertia: number;
  /** Set once the centre of mass leaves the arena. An out pen is no longer simulated. */
  out: boolean;
}

/** Which player a pen belongs to. There are exactly two. */
export type Side = "a" | "b";

export interface World {
  a: Pen;
  b: Pen;
}

/**
 * A single flick.
 *
 * The velocity is a vector and not an angle plus a magnitude, so that turning a drag into
 * a shot happens once, in the browser, with whatever trigonometry it likes. Nothing
 * downstream of the input has to reproduce that arithmetic, which is what lets the server
 * and every client agree on the outcome.
 *
 * `offset` is where along the pen the flick lands, as a signed distance from the centre.
 * Zero pushes through the centre of mass and imparts no spin.
 */
export interface Shot {
  side: Side;
  vx: number;
  vy: number;
  offset: number;
}

/** One pen's pose at one instant. Enough to draw it, and nothing more. */
export interface Pose {
  x: number;
  y: number;
  ux: number;
  uy: number;
  out: boolean;
}

export interface Frame {
  a: Pose;
  b: Pose;
}

/** A pen hitting the other pen, once, at a known point in the animation. */
export interface Impact {
  /** Index into `frames`, so a player hears the knock on the frame it is drawn on. */
  frame: number;
  /**
   * How hard, from 0 to 1.
   *
   * The normal impulse over the largest momentum a pen can carry, which is its mass times the
   * top launch speed. Derived rather than picked, so retuning either constant carries through.
   * A square hit at full speed lands around two thirds, since neither pen absorbs everything.
   */
  strength: number;
}

export interface ShotResult {
  /** Poses at 60 per second, starting after the first step and ending at rest. */
  frames: Frame[];
  /** Integration steps taken. Diagnostic, and the subject of a test. */
  steps: number;
  /** The world at rest. The authoritative outcome of the shot. */
  rest: World;
  /** Every pen-on-pen collision in this shot, in the order they happened. */
  impacts: Impact[];
}
