import type { PenModel } from "../pens.ts";
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  MAX_LAUNCH_SPEED,
  MIN_LAUNCH_SPEED,
  PEN_DIAMETER,
  PEN_LENGTH,
} from "../sim/constants.ts";
import type { Frame, Pose, Side } from "../sim/types.ts";
import { dot, length } from "../sim/vec.ts";
import { alpha, type Colors, type PenPalette } from "./colors.ts";
import { drawBurst, type Fleck } from "./confetti.ts";
import { grainPattern } from "./grain.ts";

/**
 * Room drawn around the desk, in desk centimetres.
 *
 * The desk is exactly the arena, so its edge is the line a pen is lost across. That is worth more
 * than a boundary drawn inside a larger surface: the rule is that a pen falls off the desk, and a
 * picture where the desk goes on past the losing line has to explain itself.
 *
 * It is kept tight, because every centimetre here is desk the player does not get. A pen whose
 * centre has just crossed the edge trails seven centimetres behind it and is drawn faintly, so
 * clipping the far end of a pen that is already out costs nothing.
 */
const MARGIN = 2.5;
const DESK_RADIUS = 1.4;
/** How much of the desk's near edge shows below it. The only depth cue in the scene. */
const DESK_LIP = 0.75;
const SHADOW_DROP = 0.34;

/* Barrel markings. Their sizes are shared; which of them appear is the model's business. */
const CAP_BAND = 0.18;
const CAP_AT = 0.5;
const COLLAR = 0.14;
const STREAK_OFFSET = -0.2;
const STREAK_HALF = 0.075;
const STREAK_INSET = 1.1;

/**
 * The bloom under whichever pen is to be flicked, as spread from the barrel and opacity.
 *
 * Three stops rather than two, and all of them faint. At this strength a pair of stops bands into
 * a visible ring, which reads as the pen being selected in an interface. What is wanted is the pen
 * looking very slightly lit, so the eye finds it without being told about it.
 */
const HALO: readonly (readonly [number, number])[] = [
  [1.7, 0.026],
  [1, 0.034],
  [0.42, 0.046],
];

/*
 * The aim indicator, drawn in dots rather than a solid line.
 *
 * A continuous stroke says how far, and says it all at once. A row of dots says the same thing by
 * arriving: pull further and more of them appear, which is the pull itself made visible. The head
 * stays solid, because a dotted arrowhead is not an arrowhead.
 */
const AIM_REACH_MIN = 2.5;
const AIM_REACH_SPAN = 13;
const WAKE_MIN = 2;
const WAKE_SPAN = 4;
const DOT_GAP = 0.62;
const DOT_LENGTH = 0.09;
const HEAD_ARM = 1.15;
/** The arm direction, as parts along the shot and across it. Together they set the angle. */
const ARM_ALONG = 0.85;
const ARM_ACROSS = 0.53;

export interface Aim {
  side: Side;
  /** The launch velocity currently being aimed, in the simulation's units. */
  vx: number;
  vy: number;
  /** Where along the pen the flick lands, as a signed distance from its centre. */
  offset: number;
}

/** A win, mid-celebration. `progress` runs zero to one across the burst. */
export interface Celebration {
  side: Side;
  flecks: readonly Fleck[];
  progress: number;
}

export interface Scene {
  frame: Frame;
  aim: Aim | null;
  won: Celebration | null;
  /** Which model each pen is. Cosmetic only, see `lib/pens.ts`. */
  models: Record<Side, PenModel>;
  /** Whose flick it is, or null when nobody is waiting on a player. */
  active: Side | null;
}

export interface Viewport {
  /** CSS pixels. */
  width: number;
  height: number;
  dpr: number;
}

function capsulePath(ctx: CanvasRenderingContext2D, half: number, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(-half, -radius, half * 2, radius * 2, radius);
}

function drawDesk(
  ctx: CanvasRenderingContext2D,
  c: Colors,
  px: number,
  pixelsPerCm: number,
): void {
  const w = ARENA_WIDTH;
  const h = ARENA_HEIGHT;

  /* Two flat passes rather than a blur, which is the one shadow every browser agrees on. */
  for (const [drop, opacity] of [
    [DESK_LIP * 3.2, 0.06],
    [DESK_LIP * 1.6, 0.08],
  ] as const) {
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2 - drop, w, h, DESK_RADIUS);
    ctx.fillStyle = alpha(c.shadow, opacity);
    ctx.fill();
  }

  /* The near face of the slab. The one thing in the picture that says how thick a desk is. */
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2 - DESK_LIP, w, h, DESK_RADIUS);
  ctx.fillStyle = c.deskDrop;
  ctx.fill();

  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, DESK_RADIUS);
  ctx.fillStyle = c.desk;
  ctx.fill();

  /* Grain, on the top face only. The slab's near face stays flat, so the edge keeps its line. */
  const grain = grainPattern(ctx, pixelsPerCm);
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fill();
  }

  ctx.strokeStyle = c.deskEdge;
  ctx.lineWidth = px * 1.25;
  ctx.stroke();
}

/**
 * A pen's markings, drawn in the pen's own coordinates: x along the barrel, centred.
 *
 * Exported because the picker previews draw through this same function. A preview that redrew the
 * pen its own way would drift from the pen on the desk, and the drift would only show up once a
 * player had already chosen on the strength of it.
 *
 * Every model is the same capsule. What differs is which of these bands appear and how the tip is
 * cut. `lib/pens.ts` says why the outline may never vary.
 */
export function drawBarrel(
  ctx: CanvasRenderingContext2D,
  model: PenModel,
  pen: PenPalette,
  c: Colors,
  half: number,
  radius: number,
  px: number,
): void {
  capsulePath(ctx, half, radius);
  ctx.fillStyle = pen.body;
  ctx.fill();

  /* Everything from here to the gloss is inside the barrel, so it takes the capsule's ends. */
  ctx.save();
  capsulePath(ctx, half, radius);
  ctx.clip();

  if (model.grip) {
    ctx.fillStyle = pen.grip;
    ctx.fillRect(-half + model.grip.from, -radius, model.grip.to - model.grip.from, radius * 2);
  }

  ctx.fillStyle = alpha(c.penShade, 0.45);
  /* A band around the butt, which is what a pen's cap or end plug looks like end on. */
  if (model.capBand) ctx.fillRect(-half + CAP_AT, -radius, CAP_BAND, radius * 2);
  /* The seam where the grip ends and the barrel begins. */
  if (model.collar && model.grip) {
    ctx.fillRect(-half + model.grip.to - COLLAR, -radius, COLLAR, radius * 2);
  }

  /* The collar the nib sits in, one step lighter than the barrel so it catches the eye. */
  if (model.ferrule > 0) {
    ctx.fillStyle = alpha(c.penSheen, 0.22);
    ctx.fillRect(half - model.tip - model.ferrule, -radius, model.ferrule, radius * 2);
  }

  /* The tip. `blunt` runs from a drawn-out point to a chisel cut straight across. */
  const nib = radius * (0.12 + model.blunt * 0.78);
  ctx.fillStyle = pen.grip;
  ctx.beginPath();
  ctx.moveTo(half - model.tip, -radius);
  ctx.lineTo(half, -nib);
  ctx.lineTo(half, nib);
  ctx.lineTo(half - model.tip, radius);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  /*
   * Shading across the short axis, not down the screen. A cylinder is lit across its own axis
   * whichever way it is turned, and this is the whole reason a flat top-down drawing reads as a
   * round object.
   */
  const sheen = ctx.createLinearGradient(0, -radius, 0, radius);
  sheen.addColorStop(0, alpha(c.penSheen, 0.26));
  sheen.addColorStop(0.42, alpha(c.penSheen, 0));
  sheen.addColorStop(0.58, alpha(c.penShade, 0));
  sheen.addColorStop(1, alpha(c.penShade, 0.34));
  capsulePath(ctx, half, radius);
  ctx.fillStyle = sheen;
  ctx.fill();

  /*
   * The gloss line, drawn after the shading rather than under it, because a specular highlight is
   * the one thing on a plastic barrel that the barrel's own shading does not dim. It stops short
   * of both ends: run it the full length and the pen reads as a tube with a slot cut in it rather
   * than as something round catching the light.
   */
  if (model.gloss > 0) {
    ctx.save();
    capsulePath(ctx, half, radius);
    ctx.clip();
    ctx.beginPath();
    ctx.roundRect(
      -half + STREAK_INSET,
      STREAK_OFFSET - STREAK_HALF,
      PEN_LENGTH - STREAK_INSET - model.tip - 0.3,
      STREAK_HALF * 2,
      STREAK_HALF,
    );
    ctx.fillStyle = alpha(c.penSheen, model.gloss);
    ctx.fill();
    ctx.restore();
  }

  capsulePath(ctx, half, radius);
  ctx.strokeStyle = alpha(c.penShade, 0.16);
  ctx.lineWidth = px;
  ctx.stroke();
}

function drawPen(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  model: PenModel,
  pen: PenPalette,
  c: Colors,
  px: number,
  active: boolean,
): void {
  const half = PEN_LENGTH / 2;
  const radius = PEN_DIAMETER / 2;

  if (!pose.out) {
    ctx.save();
    ctx.translate(0, -SHADOW_DROP);
    ctx.transform(pose.ux, pose.uy, -pose.uy, pose.ux, pose.x, pose.y);
    for (const [spread, opacity] of [
      [radius * 0.7, 0.07],
      [0, 0.11],
    ] as const) {
      capsulePath(ctx, half + spread, radius + spread);
      ctx.fillStyle = alpha(c.shadow, opacity);
      ctx.fill();
    }
    ctx.restore();
  }

  /*
   * The halo says whose flick it is, and it is the pen's own colour so it needs no key. It sits
   * under the pen rather than on it, so the pen itself is drawn identically whether or not it is
   * the one waiting to be played: a highlight that changed the object would make the two pens
   * look like different pens.
   */
  if (active && !pose.out) {
    ctx.save();
    ctx.transform(pose.ux, pose.uy, -pose.uy, pose.ux, pose.x, pose.y);
    for (const [spread, opacity] of HALO) {
      capsulePath(ctx, half + spread, radius + spread);
      ctx.fillStyle = alpha(pen.body, opacity);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.save();
  /*
   * The heading is a unit vector, so it is the rotation matrix already. Feeding it straight into
   * the transform keeps `cos` and `sin` out of the renderer as well as out of the simulation, and
   * means the drawing cannot disagree with the physics about which way a pen is pointing.
   */
  ctx.transform(pose.ux, pose.uy, -pose.uy, pose.ux, pose.x, pose.y);
  /* A pen off the desk is on the floor. It stays visible so its fate is legible. */
  if (pose.out) ctx.globalAlpha = 0.2;
  drawBarrel(ctx, model, pen, c, half, radius, px);
  ctx.restore();
}

/**
 * How far the pen's own surface is from a point on its spine, in the direction `dx, dy`.
 *
 * The aim has to start here rather than at the centre. Drawing it from the centre and letting the
 * pen cover the overlap works while the shot is across the pen, where the line emerges after half
 * a centimetre. Aim along the pen's own length and it is buried for seven centimetres, which
 * leaves an arrowhead and a wake floating either side of the pen with nothing joining them.
 *
 * `from` is where on the spine the ray starts, so the aim can leave the pen at the point the
 * player took hold of rather than always from the middle.
 *
 * A capsule is a segment grown by its radius, so a ray from inside leaves either through the side
 * or through an end cap. `radius / across` is the side crossing, and it runs away to infinity as
 * the direction lines up with the pen, so the cap distance caps it.
 *
 * Exported for `lib/draw/arena.test.ts`, which pins it at both extremes and across the sweep.
 */
export function surfaceReach(
  ux: number,
  uy: number,
  dx: number,
  dy: number,
  half: number,
  radius: number,
  from = 0,
): number {
  const along = dot(dx, dy, ux, uy);
  const across = Math.sqrt(Math.max(0, 1 - along * along));

  if (across > 1e-6) {
    const side = radius / across;
    /* Only the side crossing if the exit point is still between the two end caps. */
    if (Math.abs(from + side * along) <= half) return side;
  }

  /* Otherwise it leaves through the cap it is heading for, which is a circle of `radius`. */
  const end = along >= 0 ? half : -half;
  const gap = from - end;
  const b = gap * along;
  return -b + Math.sqrt(Math.max(0, b * b - gap * gap + radius * radius));
}

/**
 * The shot being aimed: dots the way the pen will go, and fainter ones the way it came from.
 *
 * Both hang off the point on the pen that was taken hold of, which is also the offset the flick is
 * applied at, so the indicator shows where the push lands as well as which way it goes. That is
 * the only cue that a shot near a tip will spin.
 *
 * Strength is how many dots there are, how heavy they are, and how firmly they are inked. Three
 * readings of one number costs nothing and means the shot can be judged without measuring the line
 * against anything.
 *
 * The dots behind the pen are the wind-up. They carry no information the forward ones do not, and
 * they are there because an arrow pointing away from a hand that is moving the other way reads as
 * an inverted control. They are the half of the picture that accounts for where the hand went, and
 * they carry no head, because a plain trail cannot be mistaken for a second arrow.
 *
 * Nothing here predicts where the pen will stop. Judging that is the game, and drawing it would
 * hand it over.
 */
function drawAim(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  aim: Aim,
  pen: PenPalette,
  px: number,
): void {
  const speed = length(aim.vx, aim.vy);
  /*
   * Nothing is drawn for a pull too weak to fire. Drawing from any speed at all left a band where
   * an indicator was on screen and letting go did nothing, which teaches the player that it is not
   * a promise.
   */
  if (speed < MIN_LAUNCH_SPEED) return;

  /*
   * Power is measured against the fastest flick in the game, not the fastest available at this
   * offset. A full pull at the tip is a genuinely weaker shot, and the trail is shorter and
   * lighter to say so.
   */
  const power = Math.min(speed / MAX_LAUNCH_SPEED, 1);
  const dx = aim.vx / speed;
  const dy = aim.vy / speed;
  /* Across the shot, for the arms of the head. */
  const ax = -dy;
  const ay = dx;

  const half = PEN_LENGTH / 2;
  const radius = PEN_DIAMETER / 2;
  const grip = Math.max(-half, Math.min(half, aim.offset));
  const ox = pose.x + pose.ux * grip;
  const oy = pose.y + pose.uy * grip;

  /* Both trails start at the pen's edge, so neither runs through the pen. */
  const skin = surfaceReach(pose.ux, pose.uy, dx, dy, half, radius, grip);
  const back = surfaceReach(pose.ux, pose.uy, -dx, -dy, half, radius, grip);
  const reach = skin + AIM_REACH_MIN + power * AIM_REACH_SPAN;
  const wake = back + WAKE_MIN + power * WAKE_SPAN;

  const tipX = ox + dx * reach;
  const tipY = oy + dy * reach;
  const armLength = Math.sqrt(ARM_ALONG * ARM_ALONG + ARM_ACROSS * ARM_ACROSS);
  const backAlong = (ARM_ALONG / armLength) * HEAD_ARM;
  const outAcross = (ARM_ACROSS / armLength) * HEAD_ARM;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const weight = px * (1.1 + power * 0.9);
  ctx.setLineDash([DOT_LENGTH, DOT_GAP]);

  ctx.lineWidth = weight * 0.85;
  ctx.strokeStyle = alpha(pen.body, 0.22);
  ctx.beginPath();
  ctx.moveTo(ox - dx * back, oy - dy * back);
  ctx.lineTo(ox - dx * wake, oy - dy * wake);
  ctx.stroke();

  ctx.lineWidth = weight;
  ctx.strokeStyle = alpha(pen.body, 0.4 + power * 0.35);
  ctx.beginPath();
  ctx.moveTo(ox + dx * skin, oy + dy * skin);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  /* Solid, and built from the shot's own direction so the renderer needs no trigonometry. */
  ctx.setLineDash([]);
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.moveTo(tipX - dx * backAlong + ax * outAcross, tipY - dy * backAlong + ay * outAcross);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - dx * backAlong - ax * outAcross, tipY - dy * backAlong - ay * outAcross);
  ctx.stroke();

  ctx.restore();
}

const ACROSS = ARENA_WIDTH + MARGIN * 2;
const ALONG = ARENA_HEIGHT + MARGIN * 2;

/**
 * Whether the desk is drawn a quarter turn round.
 *
 * The arena is landscape and a phone is not, so on a tall screen a flat desk is limited by width
 * and leaves most of the height empty. Turning the picture fills it.
 *
 * **Only the picture turns.** The simulation never hears about this. The arena stays forty by
 * twenty-eight centimetres with the pens at either end of its long axis, so the physics, the bot
 * and the shot list are identical on every device, and a match played on a phone replays the same
 * on a desktop. It is the camera that rotates, not the desk.
 *
 * The decision is made by measuring rather than by asking about orientation: whichever way round
 * makes the desk bigger wins. That needs no breakpoint and cannot disagree with the layout.
 */
export function arenaRotated(view: Viewport): boolean {
  const flat = Math.min(view.width / ACROSS, view.height / ALONG);
  const turned = Math.min(view.width / ALONG, view.height / ACROSS);
  return turned > flat;
}

/** How many CSS pixels one world centimetre takes, given the space available. */
export function arenaScale(view: Viewport): number {
  return arenaRotated(view)
    ? Math.min(view.width / ALONG, view.height / ACROSS)
    : Math.min(view.width / ACROSS, view.height / ALONG);
}

/** Turn a point in CSS pixels relative to the canvas into a point on the desk. */
export function toWorld(view: Viewport, cssX: number, cssY: number): { x: number; y: number } {
  const scale = arenaScale(view);
  const dx = cssX - view.width / 2;
  const dy = cssY - view.height / 2;
  /* Turned, the arena's long axis runs down the screen and the player's own end is at the bottom. */
  return arenaRotated(view)
    ? { x: -dy / scale, y: -dx / scale }
    : { x: dx / scale, y: -dy / scale };
}

/**
 * The inverse of `toWorld`: a point on the desk, in CSS pixels relative to the canvas.
 *
 * Exported for `scripts/verify.mjs`, which has to put a real cursor on a real pen. That script used
 * to work the position out from its own copies of the arena's width, height and starting offset,
 * and every one of them went stale when those numbers were retuned. It kept passing because the
 * grab margin is wider than the error it had accumulated. Sharing the mapping is the only version
 * of this that cannot drift.
 */
export function toCanvas(view: Viewport, x: number, y: number): { x: number; y: number } {
  const scale = arenaScale(view);
  return arenaRotated(view)
    ? { x: view.width / 2 - y * scale, y: view.height / 2 - x * scale }
    : { x: view.width / 2 + x * scale, y: view.height / 2 - y * scale };
}

export function drawArena(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  scene: Scene,
  c: Colors,
): void {
  const scale = arenaScale(view);
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.width, view.height);
  /*
   * One transform for the whole scene: centimetres in, device pixels out, with y pointing up the
   * way the simulation has it. Every draw call below is in the simulation's own units, so nothing
   * has to convert and no drawing code can hold a stale idea of the scale.
   */
  const s = scale * view.dpr;
  const cx = (view.width / 2) * view.dpr;
  const cy = (view.height / 2) * view.dpr;
  /*
   * Both forms have the same determinant, so handedness is preserved and everything drawn through
   * a pen's own heading vector still turns the way the simulation says it does.
   */
  if (arenaRotated(view)) ctx.setTransform(0, -s, -s, 0, cx, cy);
  else ctx.setTransform(s, 0, 0, -s, cx, cy);

  const px = 1 / scale;
  drawDesk(ctx, c, px, scale * view.dpr);

  const palette = (side: Side) => c.pens[scene.models[side].id];

  if (scene.aim) {
    drawAim(ctx, scene.frame[scene.aim.side], scene.aim, palette(scene.aim.side), px);
  }
  for (const side of ["a", "b"] as const) {
    drawPen(
      ctx,
      scene.frame[side],
      scene.models[side],
      palette(side),
      c,
      px,
      scene.active === side,
    );
  }

  /* Last, and from the middle of the desk, which is the one place neither pen has to be. */
  if (scene.won) {
    drawBurst(ctx, scene.won.flecks, scene.won.progress, palette(scene.won.side));
  }
}
