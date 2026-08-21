import { other } from "../match/rules.ts";
import { ARENA_HEIGHT, ARENA_WIDTH, MIN_LAUNCH_SPEED, PEN_LENGTH } from "../sim/constants.ts";
import { FORWARD_X, maxSpeedAt } from "../sim/pen.ts";
import { resolve } from "../sim/run.ts";
import type { Pen, Shot, Side, World } from "../sim/types.ts";
import { clamp, length } from "../sim/vec.ts";
import { LEVELS, type Level, type LevelName } from "./levels.ts";

const HALF = PEN_LENGTH / 2;
/** Fraction of candidates pointed at the other pen rather than drawn from the whole fan. */
const AIMED_SHARE = 0.6;
/** How far a pointed candidate is allowed to stray from the line between the pens. */
const AIMED_SPREAD = 0.45;

/**
 * The bot is deterministic, and that is a design constraint rather than a convenience.
 *
 * A match is meant to be replayable from nothing but the side that started and the list of
 * flicks. If the bot rolled dice, a bot match could not be replayed at all without recording
 * every one of its shots, and the shortest thing a shared link could carry would stop being the
 * shots themselves. So the dice are seeded from the position: the same board, the same turn
 * number and the same level always produce the same flick.
 *
 * It still feels varied, because the position is different every time it is asked.
 */
function seedOf(world: World, nonce: number, level: LevelName): number {
  const values = [
    world.a.x,
    world.a.y,
    world.a.ux,
    world.a.uy,
    world.b.x,
    world.b.y,
    world.b.ux,
    world.b.uy,
    nonce,
    level.length,
  ];
  let hash = 0x811c9dc5;
  for (const value of values) {
    /* Quantised, so a hash cannot turn on float noise far below anything the game can see. */
    hash = (hash ^ (Math.round(value * 8192) | 0)) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 1;
}

/** xorshift32. Enough for scattering candidate flicks, and reproducible everywhere. */
function makeRolls(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** How much room a pen has before the nearest edge. Zero once it is over one. */
function edgeGap(p: Pen): number {
  if (p.out) return 0;
  return Math.min(ARENA_WIDTH / 2 - Math.abs(p.x), ARENA_HEIGHT / 2 - Math.abs(p.y));
}

/**
 * What a position is worth to `me`, after my flick has come to rest.
 *
 * Losing outranks winning, because the rules make taking both pens off a loss for whoever took
 * the shot. A bot that scored the two separately would happily trade its own pen for the win.
 *
 * Short of a result it is two terms: how close the other pen has been pushed to an edge, and how
 * much room mine has left. Their danger is worth twice my safety, but not more than that, because
 * the next flick is theirs and a pen parked on the edge is a pen about to be lost.
 */
function scoreOf(rest: World, me: Side): number {
  const mine = rest[me];
  const theirs = rest[other(me)];
  if (mine.out) return -1000;
  if (theirs.out) return 1000;
  const reach = Math.min(ARENA_WIDTH, ARENA_HEIGHT) / 2;
  return (reach - edgeGap(theirs)) * 2 + edgeGap(mine);
}

/**
 * Point a launch across the centre line.
 *
 * A preference, not a rule. Nothing stops a pen being flicked at its own edge, and the score
 * would reject such a shot anyway, but spending samples on shots that lose outright makes a
 * weaker opponent than spending them on shots that might win.
 */
function forward(vx: number, side: Side): number {
  return Math.abs(vx) * FORWARD_X[side];
}

function candidate(roll: () => number, world: World, side: Side): Shot {
  const mine = world[side];
  const theirs = world[other(side)];

  const offset = (roll() * 2 - 1) * HALF;
  const speed = MIN_LAUNCH_SPEED + roll() * (maxSpeedAt(offset) - MIN_LAUNCH_SPEED);

  let dx: number;
  let dy: number;
  if (roll() < AIMED_SHARE) {
    /* Along the line between the pens, nudged sideways. Most shots worth playing start here. */
    const toThemX = theirs.x - mine.x;
    const toThemY = theirs.y - mine.y;
    const span = length(toThemX, toThemY) || 1;
    const swing = (roll() * 2 - 1) * AIMED_SPREAD;
    dx = toThemX / span - (toThemY / span) * swing;
    dy = toThemY / span + (toThemX / span) * swing;
  } else {
    /* Anywhere in the forward fan, by rejection, so nothing here needs an angle. */
    do {
      dx = roll();
      dy = roll() * 2 - 1;
    } while (length(dx, dy) > 1 || length(dx, dy) < 0.15);
  }

  const span = length(dx, dy) || 1;
  return { side, vx: forward((dx / span) * speed, side), vy: (dy / span) * speed, offset };
}

/** Apply the level's unsteady hand, then pull the result back inside what the rules allow. */
function slip(roll: () => number, shot: Shot, level: Level, side: Side): Shot {
  const speed = length(shot.vx, shot.vy) || 1;
  const dx = shot.vx / speed;
  const dy = shot.vy / speed;

  const swing = (roll() * 2 - 1) * level.aim;
  let nx = dx - dy * swing;
  let ny = dy + dx * swing;
  if (nx * FORWARD_X[side] < 0) nx = 0;
  const span = length(nx, ny) || 1;
  nx /= span;
  ny /= span;

  const offset = clamp(shot.offset + (roll() * 2 - 1) * level.offset, -HALF, HALF);
  const wanted = speed * (1 + (roll() * 2 - 1) * level.power);
  const settled = clamp(wanted, MIN_LAUNCH_SPEED, maxSpeedAt(offset));

  return { side, vx: nx * settled, vy: ny * settled, offset };
}

/**
 * Pick a flick.
 *
 * Draw candidates, roll each one out to rest, keep the best, then let the level's hand slip. The
 * slip is applied to the chosen shot rather than to the candidates, so a weak opponent still
 * understands the position and simply fails to execute, which is what a weak player looks like.
 * Scattering the candidates instead would produce something that cannot see, and that reads as
 * broken rather than beatable.
 *
 * `nonce` separates two identical-looking positions in one match. The shot count is what the
 * caller passes.
 */
export function chooseShot(world: World, side: Side, level: LevelName, nonce: number): Shot {
  const config = LEVELS[level];
  const roll = makeRolls(seedOf(world, nonce, level));

  let best: Shot | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < config.samples; i++) {
    const shot = candidate(roll, world, side);
    const score = scoreOf(resolve(world, shot), side);
    if (score > bestScore) {
      bestScore = score;
      best = shot;
    }
  }

  /* Straight at the other pen, in case every candidate was somehow refused. */
  const fallback: Shot = {
    side,
    vx: FORWARD_X[side] * (MIN_LAUNCH_SPEED * 4),
    vy: 0,
    offset: 0,
  };
  return slip(roll, best ?? fallback, config, side);
}
