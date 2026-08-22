import {
  CONTACT_FRICTION,
  DT,
  LINEAR_DECEL,
  PENETRATION_CORRECTION,
  PENETRATION_SLOP,
  RESTITUTION,
  SPIN_DECEL,
} from "./constants.ts";
import { type Contact, collide, type Manifold } from "./contact.ts";
import { checkOut } from "./pen.ts";
import type { Pen, World } from "./types.ts";
import { cross, dot, length } from "./vec.ts";

/**
 * Desk friction. Constant deceleration against the direction of travel, clamped so it can
 * never push the pen backwards, which is what makes zero reachable.
 */
function applyFriction(p: Pen): void {
  const speed = length(p.vx, p.vy);
  const drop = LINEAR_DECEL * DT;
  if (speed <= drop) {
    p.vx = 0;
    p.vy = 0;
  } else {
    const scale = (speed - drop) / speed;
    p.vx *= scale;
    p.vy *= scale;
  }

  const spinDrop = SPIN_DECEL * DT;
  if (Math.abs(p.spin) <= spinDrop) {
    p.spin = 0;
  } else {
    p.spin -= p.spin > 0 ? spinDrop : -spinDrop;
  }
}

/**
 * Advance position and heading.
 *
 * The heading turns by adding a perpendicular step and renormalising, rather than by
 * rotating through `cos` and `sin`. That keeps the loop free of the two functions whose
 * results differ between JavaScript engines. The cost is that the pen turns by
 * `atan(spin * dt)` instead of `spin * dt`, which at the fastest spin the game produces is
 * a shortfall under one percent. This update is the definition of how a pen turns here,
 * not an approximation of something else, so that shortfall is a property of the model
 * rather than an error in it.
 */
function integrate(p: Pen): void {
  p.x += p.vx * DT;
  p.y += p.vy * DT;

  const turn = p.spin * DT;
  const nx = p.ux - p.uy * turn;
  const ny = p.uy + p.ux * turn;
  const len = length(nx, ny);
  p.ux = nx / len;
  p.uy = ny / len;
}

/**
 * Resolve the contact: bounce along the normal, then friction across it, clamped by the
 * Coulomb cone.
 *
 * One impulse, once. A single contact is a one-dimensional system and this solves it
 * exactly, so there is nothing for an iteration to improve. It is also why nothing here
 * depends on the order anything is visited in, which is what keeps the two players'
 * physics identical.
 *
 * Returns the normal impulse, which is the momentum the collision moved from one pen to the
 * other. Zero when the pens are touching but separating, which is not a collision.
 */
function solveContact(a: Pen, b: Pen, c: Contact): number {
  const rax = c.px - a.x;
  const ray = c.py - a.y;
  const rbx = c.px - b.x;
  const rby = c.py - b.y;

  /* Velocity of the material point at the contact, which is not the centre's velocity. */
  const vax = a.vx - a.spin * ray;
  const vay = a.vy + a.spin * rax;
  const vbx = b.vx - b.spin * rby;
  const vby = b.vy + b.spin * rbx;
  const rvx = vbx - vax;
  const rvy = vby - vay;

  const vn = dot(rvx, rvy, c.nx, c.ny);
  if (vn > 0) return 0;

  const invMa = 1 / a.mass;
  const invMb = 1 / b.mass;
  const invIa = 1 / a.inertia;
  const invIb = 1 / b.inertia;

  const rnA = cross(rax, ray, c.nx, c.ny);
  const rnB = cross(rbx, rby, c.nx, c.ny);
  const kn = invMa + invMb + rnA * rnA * invIa + rnB * rnB * invIb;
  const jn = (-(1 + RESTITUTION) * vn) / kn;

  const tx = -c.ny;
  const ty = c.nx;
  const vt = dot(rvx, rvy, tx, ty);
  const rtA = cross(rax, ray, tx, ty);
  const rtB = cross(rbx, rby, tx, ty);
  const kt = invMa + invMb + rtA * rtA * invIa + rtB * rtB * invIb;
  const limit = CONTACT_FRICTION * jn;
  let jt = -vt / kt;
  if (jt > limit) jt = limit;
  if (jt < -limit) jt = -limit;

  const ix = jn * c.nx + jt * tx;
  const iy = jn * c.ny + jt * ty;

  a.vx -= ix * invMa;
  a.vy -= iy * invMa;
  a.spin -= cross(rax, ray, ix, iy) * invIa;
  b.vx += ix * invMb;
  b.vy += iy * invMb;
  b.spin += cross(rbx, rby, ix, iy) * invIb;

  return jn;
}

/** Push overlapping pens apart, sharing the correction by inverse mass. */
function correctOverlap(a: Pen, b: Pen, c: Contact): void {
  const depth = -c.separation - PENETRATION_SLOP;
  if (depth <= 0) return;

  const invMa = 1 / a.mass;
  const invMb = 1 / b.mass;
  const push = (depth * PENETRATION_CORRECTION) / (invMa + invMb);
  a.x -= c.nx * push * invMa;
  a.y -= c.ny * push * invMa;
  b.x += c.nx * push * invMb;
  b.y += c.ny * push * invMb;
}

/**
 * One fixed step of the whole world.
 *
 * The step is fixed and is never a frame delta. Two clients running the same shot have to
 * reach the same rest position, and a step that varied with a display refresh rate would
 * make the outcome depend on the machine it was watched on. The renderer plays back the
 * frames this produces, so nothing in the browser steps the world in real time.
 *
 * Order is load-bearing. The contact is solved before positions move, so a pen never
 * integrates into the one it just hit, and the out-of-bounds test runs last, so a pen that
 * left the arena during this step is not simulated in the next one.
 *
 * Returns the normal impulse when the pens started touching on this step, and zero otherwise.
 * That is the one moment a collision happens: a contact that was already there is a pen leaning
 * on another, and it can last thousands of steps. The caller decides what to do with it, and
 * nothing in here knows or cares.
 */
export function step(w: World, m: Manifold): number {
  if (!w.a.out) applyFriction(w.a);
  if (!w.b.out) applyFriction(w.b);

  const wasTouching = m.touching;
  collide(w.a, w.b, m);
  let impulse = 0;
  if (m.hit) {
    const jn = solveContact(w.a, w.b, m.c);
    correctOverlap(w.a, w.b, m.c);
    if (!wasTouching) impulse = jn;
  }
  m.touching = m.hit;

  if (!w.a.out) integrate(w.a);
  if (!w.b.out) integrate(w.b);

  checkOut(w.a);
  checkOut(w.b);

  return impulse;
}
