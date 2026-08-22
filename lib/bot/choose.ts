import { other } from "../match/rules.ts";
import { ARENA_HEIGHT, ARENA_WIDTH, MIN_LAUNCH_SPEED, PEN_LENGTH } from "../sim/constants.ts";
import { maxSpeedAt } from "../sim/pen.ts";
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
 * Worth of a centimetre closed on the other pen, against a centimetre of their edge, which is
 * worth two, and a centimetre of the bot's own room, which is worth one.
 *
 * Deliberately the smallest of the three, so it decides nothing that the other two can decide. It
 * exists for the positions where they decide nothing at all. `edgeGap` is the distance to the
 * nearest edge, and the desk is 40 by 28, so for any pen inside `|x| <= 6` the nearest edge is
 * above or below it and shoving that pen along the desk does not change the number one bit. Add
 * the shots that cannot reach the other pen and there are whole positions where every candidate
 * scores the same, and the bot then picks the one that keeps it nearest the middle: a flick of
 * almost nothing. Closing the distance is the tie-break, and it is what a player does when they
 * are out of range.
 */
const CLOSING = 0.25;
/**
 * What a draw is worth, which is both pens off on one shot.
 *
 * It sits between the two results because that is where the rules put it. Zero is also below any
 * position with both pens comfortably on the desk, so the bot never takes a draw it did not need,
 * and above a position where its own pen is on an edge and the other is safe in the middle, so a
 * bot that is losing will take one. Both of those are what a player would do.
 */
const DRAW = 0;

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
 * Losing outranks winning, and the order of the three tests below is the whole of that. Taking both
 * pens off used to be a loss for whoever took the shot, which is why losing is checked first. It is
 * a draw now, and a bot that had not been told would still be reading it as the worst thing on the
 * board and refusing shots that are merely level.
 *
 * Short of a result it is three terms: how close the other pen has been pushed to an edge, how
 * much room mine has left, and how far apart the two ended up. Their danger is worth twice my
 * safety, but not more than that, because the next flick is theirs and a pen parked on the edge is
 * a pen about to be lost. Closing the distance is worth least of all, and see `CLOSING` for why it
 * is there at all.
 */
function scoreOf(rest: World, me: Side): number {
  const mine = rest[me];
  const theirs = rest[other(me)];
  if (mine.out && theirs.out) return DRAW;
  if (mine.out) return -1000;
  if (theirs.out) return 1000;
  const reach = Math.min(ARENA_WIDTH, ARENA_HEIGHT) / 2;
  const apart = length(theirs.x - mine.x, theirs.y - mine.y);
  return (reach - edgeGap(theirs)) * 2 + edgeGap(mine) - apart * CLOSING;
}

interface Facing {
  x: number;
  y: number;
}

/**
 * The way from one pen to the other, as a unit vector.
 *
 * Every candidate is built around this, and that is the fix for the bot's worst habit. The fan
 * used to be anchored to the desk: `FORWARD_X` gave each side a half of the compass and every
 * candidate was forced into it, on the reasoning that a shot across the centre line is a shot
 * that might win. It is only true of the opening position. The pens change ends constantly, and
 * from the moment the bot is past the pen it is aiming at, that half of the compass is the half
 * pointing away from it. Every candidate then misses by construction, including the pointed ones,
 * whose x was flipped after being aimed correctly. The bot could not flick at an opponent on its
 * other side at all, and what it played instead was the best of a set of shots that all did
 * nothing.
 *
 * Anchoring on the other pen keeps the intent, which is to not spend samples on shots that lose
 * outright, and drops the assumption about where the other pen is.
 */
function toward(mine: Pen, theirs: Pen): Facing {
  const dx = theirs.x - mine.x;
  const dy = theirs.y - mine.y;
  const span = length(dx, dy);
  if (span === 0) return { x: 1, y: 0 };
  return { x: dx / span, y: dy / span };
}

function candidate(roll: () => number, side: Side, aim: Facing): Shot {
  const offset = (roll() * 2 - 1) * HALF;
  const speed = MIN_LAUNCH_SPEED + roll() * (maxSpeedAt(offset) - MIN_LAUNCH_SPEED);

  let dx: number;
  let dy: number;
  if (roll() < AIMED_SHARE) {
    /* Along the line between the pens, nudged sideways. Most shots worth playing start here. */
    const swing = (roll() * 2 - 1) * AIMED_SPREAD;
    dx = aim.x - aim.y * swing;
    dy = aim.y + aim.x * swing;
  } else {
    /*
     * Anywhere in the half of the compass that faces the other pen, by rejection and then a
     * reflection, so nothing here needs an angle.
     */
    do {
      dx = roll() * 2 - 1;
      dy = roll() * 2 - 1;
    } while (length(dx, dy) > 1 || length(dx, dy) < 0.15);
    if (dx * aim.x + dy * aim.y < 0) {
      dx = -dx;
      dy = -dy;
    }
  }

  const span = length(dx, dy) || 1;
  return { side, vx: (dx / span) * speed, vy: (dy / span) * speed, offset };
}

/** Apply the level's unsteady hand, then pull the result back inside what the rules allow. */
function slip(roll: () => number, shot: Shot, level: Level, side: Side): Shot {
  const speed = length(shot.vx, shot.vy) || 1;
  const dx = shot.vx / speed;
  const dy = shot.vy / speed;

  /*
   * No half-plane clamp on the result. There was one, and it flattened the x of a slipped shot to
   * zero whenever the shot pointed the way the old fan called backwards, which turned a flick at
   * the other pen into a flick straight across the desk. The widest slip in the game swings a shot
   * about eighteen degrees and cannot reverse one, so there is nothing left for a clamp to catch.
   */
  const swing = (roll() * 2 - 1) * level.aim;
  const nx = dx - dy * swing;
  const ny = dy + dx * swing;
  const span = length(nx, ny) || 1;

  const offset = clamp(shot.offset + (roll() * 2 - 1) * level.offset, -HALF, HALF);
  const wanted = speed * (1 + (roll() * 2 - 1) * level.power);
  const settled = clamp(wanted, MIN_LAUNCH_SPEED, maxSpeedAt(offset));

  return { side, vx: (nx / span) * settled, vy: (ny / span) * settled, offset };
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
  const aim = toward(world[side], world[other(side)]);

  /*
   * The search starts from a full flick straight down the middle of the other pen, and the
   * candidates have to beat it.
   *
   * It is the shot a player sees first, so a bot that plays something quieter should have a reason
   * on the board for it. It also costs one rollout to have a real shot in hand from the start,
   * which is what the unreachable fallback that used to sit at the bottom of this function was
   * for. Being scored like everything else, it is dropped the moment it turns out to lose.
   */
  let best: Shot = { side, vx: aim.x * maxSpeedAt(0), vy: aim.y * maxSpeedAt(0), offset: 0 };
  let bestScore = scoreOf(resolve(world, best), side);
  for (let i = 0; i < config.samples; i++) {
    const shot = candidate(roll, side, aim);
    const score = scoreOf(resolve(world, shot), side);
    if (score > bestScore) {
      bestScore = score;
      best = shot;
    }
  }

  return slip(roll, best, config, side);
}
