import { PARALLEL_EPSILON } from "./constants.ts";
import type { Pen } from "./types.ts";
import { clamp, closestOnAxis, cross, dot, length } from "./vec.ts";

export interface Contact {
  /** Contact point in world space, midway between the two surfaces. */
  px: number;
  py: number;
  /** Unit normal, pointing from A towards B. */
  nx: number;
  ny: number;
  /** Negative when the capsules overlap. Zero when they just touch. */
  separation: number;
}

/**
 * One contact point, in a slot that is written in place.
 *
 * There is one point and not two even for a flat broadside, and that is a correctness
 * matter rather than a saving. Two points each carry their own effective mass, and each one
 * computed alone believes it can spin the pens it touches. On a square hit the two torques
 * cancel and no spin results, but both points have already priced the spin in, and the
 * impulse comes out about four times too small. The collision then resolves as if nothing
 * bounced at all, whatever the restitution is set to. A single point at the middle of the
 * contact carries the right effective mass, produces no torque when the hit is square and
 * plenty when it is not, and needs no solver iteration at all, because one contact is a
 * one-line system with an exact answer.
 *
 * The step loop reuses one manifold for the whole shot. Returning a fresh contact from each
 * call would allocate a few thousand times per shot for no benefit.
 */
export interface Manifold {
  hit: boolean;
  c: Contact;
}

function emptyContact(): Contact {
  return { px: 0, py: 0, nx: 0, ny: 0, separation: 0 };
}

export function createManifold(): Manifold {
  return { hit: false, c: emptyContact() };
}

/**
 * Everything in this file has to give the same answer when the two pens are exchanged.
 *
 * That is not a tidiness point. The two players sit on opposite sides of a symmetric
 * arena, so the transformation that turns one player's position into the other's is a
 * mirror plus a swap of the pens. If a routine here prefers whichever pen it was handed
 * first, the two players are playing slightly different games, and the one whose pen
 * happens to be the reference gets a different result from the same shot. `run.test.ts`
 * holds a test for exactly that, and it caught this file preferring A.
 */

interface Pair {
  sa: number;
  sb: number;
  dist: number;
}

/**
 * Closest approach of two spines, as signed distances from each centre, solving from A.
 *
 * The standard two-pass clamp: solve the unconstrained minimum along A, clamp to A's
 * length, solve B against that, clamp, then solve A again against the clamped B. It is
 * exact when the closest pair is interior to both segments and approximate when a clamp
 * bites, which is the reason the caller runs it both ways round.
 */
function solveFrom(a: Pen, b: Pen): Pair {
  const rx = a.x - b.x;
  const ry = a.y - b.y;
  const axisDot = dot(a.ux, a.uy, b.ux, b.uy);
  const ra = dot(rx, ry, a.ux, a.uy);
  const rb = dot(rx, ry, b.ux, b.uy);

  const denom = 1 - axisDot * axisDot;
  let sa = denom > 1e-9 ? (rb * axisDot - ra) / denom : 0;
  sa = clamp(sa, -a.half, a.half);
  const sb = clamp(sa * axisDot + rb, -b.half, b.half);
  sa = clamp(sb * axisDot - ra, -a.half, a.half);

  const dx = b.x + b.ux * sb - (a.x + a.ux * sa);
  const dy = b.y + b.uy * sb - (a.y + a.uy * sa);
  return { sa, sb, dist: length(dx, dy) };
}

/**
 * The closest pair, solved from both ends and resolved by distance.
 *
 * Which segment the clamping starts from changes the answer once a tip is involved, so
 * taking whichever of the two came out closer is what makes the result independent of the
 * order the pens were passed in.
 */
function closestSpinePair(a: Pen, b: Pen): Pair {
  const fromA = solveFrom(a, b);
  const fromB = solveFrom(b, a);
  return fromB.dist < fromA.dist ? { sa: fromB.sb, sb: fromB.sa, dist: fromB.dist } : fromA;
}

/** Fill a contact slot from a point on each spine. False when they are not touching. */
function fillContact(
  a: Pen,
  b: Pen,
  pax: number,
  pay: number,
  pbx: number,
  pby: number,
  out: Contact,
): boolean {
  let dx = pbx - pax;
  let dy = pby - pay;
  let dist = length(dx, dy);

  if (dist < 1e-9) {
    /* Spines crossing exactly. There is no direction to normalise, so take A's normal. */
    dx = -a.uy;
    dy = a.ux;
    if (dot(dx, dy, b.x - a.x, b.y - a.y) < 0) {
      dx = -dx;
      dy = -dy;
    }
    dist = 1;
  }

  const separation = dist - (a.radius + b.radius);
  if (separation >= 0) return false;

  const nx = dx / dist;
  const ny = dy / dist;
  out.nx = nx;
  out.ny = ny;
  out.separation = separation;
  /*
   * Midway between the two surfaces rather than on either one. With the capsules
   * overlapping, the surface points have crossed over each other, and the midpoint is the
   * only choice that stays inside the overlap and does not jump sides as the depth changes.
   */
  out.px = pax + nx * (a.radius + separation / 2);
  out.py = pay + ny * (a.radius + separation / 2);
  return true;
}

/** Fill a slot from a single point on A's spine, taking the nearest point on B's. */
function fillFromA(a: Pen, b: Pen, sa: number, out: Contact): boolean {
  const pax = a.x + a.ux * sa;
  const pay = a.y + a.uy * sa;
  const sb = closestOnAxis(pax, pay, b.x, b.y, b.ux, b.uy, b.half);
  return fillContact(a, b, pax, pay, b.x + b.ux * sb, b.y + b.uy * sb, out);
}

/**
 * The contact point for near-parallel pens: the middle of the stretch they share.
 *
 * A broadside is the commonest collision in the game, and the generic closest-point routine
 * cannot place it. Two parallel spines are equally close everywhere along their overlap, so
 * that routine falls back to an arbitrary end and puts a torque on a pair of pens that met
 * flat. The middle of the overlap is the honest answer: square on, it sits on both centres
 * of mass and turns neither pen, and as the hit moves off square it slides off centre and
 * turns both.
 *
 * The stretch is measured along the bisector of the two headings rather than along either
 * pen's own axis. The bisector is the one direction here that does not change when the pens
 * are exchanged, so both players get the same contact point out of the same collision.
 *
 * Near-parallel is generous, at about four degrees either way. A pen a couple of degrees off
 * square does touch at one end first in reality, but it also has time to rotate flat, and a
 * fixed step has to resolve the whole collision at once. Treating a nearly flat hit as flat
 * is the reading a player expects from what they aimed.
 */
function parallelManifold(a: Pen, b: Pen, out: Manifold): boolean {
  const flip = dot(a.ux, a.uy, b.ux, b.uy) < 0;
  const bux = flip ? -b.ux : b.ux;
  const buy = flip ? -b.uy : b.uy;

  let dx = a.ux + bux;
  let dy = a.uy + buy;
  const dLen = length(dx, dy);
  if (dLen < 1e-9) return false;
  dx /= dLen;
  dy /= dLen;

  const alongA = dot(a.ux, a.uy, dx, dy);
  const alongB = dot(bux, buy, dx, dy);
  if (Math.abs(alongA) < 1e-9 || Math.abs(alongB) < 1e-9) return false;

  const centreA = dot(a.x, a.y, dx, dy);
  const centreB = dot(b.x, b.y, dx, dy);
  const spanA = Math.abs(a.half * alongA);
  const spanB = Math.abs(b.half * alongB);

  const lo = Math.max(centreA - spanA, centreB - spanB);
  const hi = Math.min(centreA + spanA, centreB + spanB);
  /* A shared stretch shorter than a pen is thick is a tip touch, not a flat one. */
  if (hi - lo <= a.radius) return false;

  const middle = (lo + hi) / 2;
  const sa = clamp((middle - centreA) / alongA, -a.half, a.half);
  const sb = clamp((middle - centreB) / alongB, -b.half, b.half);
  return fillContact(
    a,
    b,
    a.x + a.ux * sa,
    a.y + a.uy * sa,
    b.x + bux * sb,
    b.y + buy * sb,
    out.c,
  );
}

/** Build the contact between two pens. */
export function collide(a: Pen, b: Pen, out: Manifold): void {
  out.hit = false;
  if (a.out || b.out) return;

  if (
    Math.abs(cross(a.ux, a.uy, b.ux, b.uy)) < PARALLEL_EPSILON &&
    parallelManifold(a, b, out)
  ) {
    out.hit = true;
    return;
  }

  const { sa } = closestSpinePair(a, b);
  out.hit = fillFromA(a, b, sa, out.c);
}
