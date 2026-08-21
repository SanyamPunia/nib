/*
 * Every tunable number in the simulation, in one file.
 *
 * Units are centimetres, seconds, grams and radians. Centimetres because a pen is the
 * unit of the game and 14 reads better than 0.14, and because it keeps every distance in
 * this file within one order of magnitude of every other one.
 *
 * None of these are measured from a real desk. They are tuned so that a full-power flick
 * travels slightly further than the arena is wide, which is the one relationship the game
 * is built on: maximum power has to be able to lose.
 */

/** Fixed integration step. See `step.ts` for why it cannot be a frame delta. */
export const DT = 1 / 480;

/**
 * Hard cap on a single shot. A shot cannot reach it: friction is subtractive, so every
 * body stops or leaves. The cap exists so a bug cannot hang the tab, and `run.test.ts`
 * asserts real shots stay far under it.
 */
export const MAX_STEPS = 480 * 8;

/** Render frames are emitted every Nth step. 480 / 8 = 60 per second. */
export const FRAME_EVERY = 8;

export const ARENA_WIDTH = 40;
export const ARENA_HEIGHT = 28;

export const PEN_LENGTH = 14;
export const PEN_DIAMETER = 1;
export const PEN_MASS = 8;

/**
 * A thin rod about its centre, not a capsule. The end caps would add roughly
 * (radius / half length) squared to the result, which is half a percent for a pen, and
 * carrying the exact capsule expression would only make the number harder to read.
 */
export const PEN_INERTIA = (PEN_MASS * PEN_LENGTH * PEN_LENGTH) / 12;

/**
 * Distance from the centre line to each pen at setup.
 *
 * Nine leaves eighteen centimetres between the pens and eleven behind each one. The gap has
 * to be longer than a pen so the opening shot is a real journey, and the room behind has to
 * be short enough that overhitting is a way to lose.
 */
export const START_OFFSET = 9;

/**
 * Coulomb friction against the desk: a constant deceleration opposing motion, not a drag
 * proportional to speed. That is both what sliding plastic actually does and what makes a
 * pen stop rather than asymptotically approach stopping. Because it subtracts a fixed
 * amount per step, speed reaches exactly zero and rest is an exact state instead of a
 * threshold.
 */
export const LINEAR_DECEL = 420;
export const SPIN_DECEL = 26;

/**
 * Linear and angular friction are independent here. A real sliding, spinning body couples
 * them through the contact patch and stops sliding and spinning at the same instant. That
 * coupling is not modelled, so a pen can still be turning after it has stopped moving.
 */

/** Pen against pen. Hard plastic, so it clicks and gives most of the speed back. */
export const RESTITUTION = 0.35;
export const CONTACT_FRICTION = 0.25;

/** Overlap left uncorrected, and the fraction of the rest removed per step. */
export const PENETRATION_SLOP = 0.002;
export const PENETRATION_CORRECTION = 0.8;

/**
 * Below this the axes count as parallel and the contact goes to the middle of the overlap
 * rather than to the closest point. 0.08 is about 4.6 degrees. See `contact.ts` for why a
 * broadside needs its own case at all.
 */
export const PARALLEL_EPSILON = 0.08;

/**
 * Fastest launch. Slides about 27cm.
 *
 * Set by one property: a full-power flick from the opening position, aimed at the other pen, has to
 * stay on the desk. From there a pen has 29cm of desk in front of it, so 27 leaves a little over
 * two to spare and full power stops being a way to lose by accident on the first move.
 *
 * It does not make full power safe in every direction, and no value can. From the opening a pen is
 * 17cm from the other pen but only 11cm from its own edge and 14cm from the sides, so any flick
 * strong enough to reach the opponent is more than strong enough to reach the player's own edge.
 * That is arithmetic, not a choice: a full-power shot backwards or sideways still leaves the desk,
 * and it should.
 *
 * It also sets how hard a hit lands, and that falls out of the same number rather than being tuned
 * separately. What the struck pen receives is about 0.46 of whatever slide is left over after the
 * travel to contact, so at 27cm a full opening shot pushes the other pen roughly 4.5cm of the 11 it
 * needs. One-shotting from the opening is therefore just out of reach, which is what makes the
 * first few flicks about position rather than power.
 */
export const MAX_LAUNCH_SPEED = 150;

/**
 * Slowest launch that counts as a flick.
 *
 * This lives with the rules rather than with the input because it is one: without a floor a
 * player can flick nothing and hand the turn back, which is passing, and there is no passing
 * in this game. The browser needs the same number to know when a twitch is not a shot.
 */
export const MIN_LAUNCH_SPEED = 12;
