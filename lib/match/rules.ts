import { MIN_LAUNCH_SPEED } from "../sim/constants.ts";
import { cloneWorld, setup } from "../sim/pen.ts";
import { runShot } from "../sim/run.ts";
import type { Shot, ShotResult, Side, World } from "../sim/types.ts";
import { length } from "../sim/vec.ts";

export function other(side: Side): Side {
  return side === "a" ? "b" : "a";
}

/**
 * Why a match ended.
 *
 * `knocked` and `self` are told apart because they read differently to the two players.
 * A player who put their own pen off the desk needs to be told that is what happened,
 * since a board that simply announces a loss with the other pen untouched is
 * indistinguishable from a bug.
 */
export type Ending = "knocked" | "self";

export interface Result {
  winner: Side;
  ending: Ending;
}

export interface Match {
  world: World;
  /** Whose flick it is. */
  turn: Side;
  /** Null while the match is still running. */
  result: Result | null;
  /** Flicks played, both sides counted. */
  shots: number;
}

export function newMatch(first: Side = "a"): Match {
  return { world: setup(), turn: first, result: null, shots: 0 };
}

/**
 * Rebuild a match from the side that started and the flicks that were played.
 *
 * This is what makes a whole match a handful of numbers. Nothing stores a board, because the
 * simulation is deterministic and a board is always derivable from the shots that made it. A stored
 * board could disagree with its own shot list, and the disagreement would show up as a pen in the
 * wrong place on one screen only.
 *
 * A refused flick stops the replay rather than being skipped. Skipping one would quietly produce a
 * different match from the one that was played, which is worse than refusing to show it at all.
 */
export function replay(first: Side, shots: readonly Shot[]): Match | null {
  let match = newMatch(first);
  for (const shot of shots) {
    const applied = applyShot(match, shot);
    if (!applied.ok) return null;
    match = applied.match;
  }
  return match;
}

export type Rejection = "match-over" | "not-your-turn" | "too-soft";

export type Applied =
  | { ok: true; match: Match; shot: ShotResult }
  | { ok: false; reason: Rejection };

/**
 * Play one flick and work out what it did.
 *
 * A flick is never trusted as an outcome, only as an intention. The two numbers in a
 * `Shot` are all that crosses the wire, and this runs them through the simulation to find
 * out what happened. That is what lets the same function decide the result on a server and
 * predict it in a browser.
 *
 * Both pens leaving is a loss for whoever took the shot. Taking your own pen off the desk
 * alongside your opponent's is not a draw, because the player who chose the shot is the
 * only one who could have chosen a smaller one.
 */
export function applyShot(match: Match, shot: Shot): Applied {
  if (match.result) return { ok: false, reason: "match-over" };
  if (shot.side !== match.turn) return { ok: false, reason: "not-your-turn" };
  if (length(shot.vx, shot.vy) < MIN_LAUNCH_SPEED) return { ok: false, reason: "too-soft" };

  const shooter = shot.side;
  const opponent = other(shooter);
  const outcome = runShot(match.world, shot);

  const shooterOut = outcome.rest[shooter].out;
  const opponentOut = outcome.rest[opponent].out;

  let result: Result | null = null;
  if (shooterOut) {
    result = { winner: opponent, ending: "self" };
  } else if (opponentOut) {
    result = { winner: shooter, ending: "knocked" };
  }

  return {
    ok: true,
    shot: outcome,
    match: {
      world: cloneWorld(outcome.rest),
      turn: result ? match.turn : opponent,
      result,
      shots: match.shots + 1,
    },
  };
}
