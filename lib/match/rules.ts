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
 * indistinguishable from a bug. `draw` needs saying for the same reason.
 */
export type Ending = "knocked" | "self" | "draw";

/**
 * How a match ended.
 *
 * A union rather than a nullable winner, so nothing can read `result.winner` on a draw without
 * being asked to handle it. There is exactly one ending with no winner and it is this one.
 */
export type Result =
  | { winner: Side; ending: "knocked" | "self" }
  | { winner: null; ending: "draw" };

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
 * Both pens leaving is a draw. It was a loss for whoever took the shot, on the argument that they
 * chose the power and could have chosen less, and that argument is sound and still loses to the
 * board. Nothing is on the desk at the end of it, so there is nobody to point at and call the
 * winner, and handing the win to the player who was knocked off reads as a technicality to the two
 * people looking at an empty desk.
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
  if (shooterOut && opponentOut) {
    result = { winner: null, ending: "draw" };
  } else if (shooterOut) {
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
