import type { PenId } from "../pens.ts";
import type { Shot, Side } from "../sim/types.ts";

/**
 * The contract between two things that deploy separately.
 *
 * The browser and the route handlers both import this file, and they can be running different
 * builds: someone with a tab open when a deploy lands is holding the old one. Every response
 * carries `PROTOCOL`, and a mismatch is reported rather than guessed at.
 *
 * Bump it whenever the meaning of anything below changes, including the meaning of a shot. The
 * whole point of sending four numbers instead of an outcome is that both sides run the same
 * simulation, so a change to the physics is a change to this protocol even though no type here
 * moves.
 */
export const PROTOCOL = 1;

/** Which of the two pens a player is holding. */
export type Seat = Side;

/** How lately a seat was heard from. */
export type Presence = "here" | "away" | "gone" | "empty";

/**
 * Everything a client is told about a room.
 *
 * There is no board in here. The match is `first` plus `shots`, and both sides rebuild it by
 * replaying, which they can do because the simulation is deterministic. That is why a whole match
 * costs a handful of numbers on the wire and why a spectator, a rejoining player and a shared
 * link all get the same thing.
 */
export interface RoomView {
  protocol: number;
  key: string;
  /** The seat the caller holds, or null when they hold none. */
  seat: Seat | null;
  first: Side;
  shots: readonly Shot[];
  pens: Record<Side, PenId>;
  /** Set when somebody gave up. The simulation cannot work this out from the pens. */
  resigned: Side | null;
  version: number;
  present: Record<Side, Presence>;
}

export interface Joined {
  room: RoomView;
  /**
   * Proof of the seat, held by the browser and sent with every write.
   *
   * A room is a throwaway with a four-character name, so this is a bearer secret and nothing more.
   * It is what stops a passer-by with the code from flicking somebody else's pen.
   */
  token: string;
}

export type RoomError =
  | "protocol-mismatch"
  | "no-such-room"
  | "room-full"
  | "rooms-busy"
  | "too-many-rooms"
  | "not-your-seat"
  | "stale"
  | "not-your-turn"
  | "match-over"
  | "too-soft"
  | "unavailable";

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: RoomError };

/** The body of a write. Every one of them carries the seat and the version it was made against. */
export interface WriteBody {
  token: string;
  version: number;
}

export interface ShotBody extends WriteBody {
  shot: Shot;
}

export interface EnterBody {
  pen: PenId;
}
