import type { PenId } from "../pens.ts";
import type { Shot, Side } from "../sim/types.ts";

/**
 * A room, as stored.
 *
 * There is no board in here and no world. `first` plus `shots` is the match, and anything that
 * wants a position replays them. Two reasons, and the second is the one that matters:
 *
 * - A record stays a few hundred bytes however long the match runs.
 * - There is one source of truth. A stored board could disagree with the shots that produced it,
 *   and the disagreement would surface as a pen in the wrong place on one player's screen only.
 */
export interface Room {
  key: string;
  first: Side;
  shots: Shot[];
  /** The secret each seat holds, or null while the seat is empty. */
  seats: Record<Side, string | null>;
  pens: Record<Side, PenId>;
  /**
   * Who gave up, if anybody did.
   *
   * The one ending the simulation cannot work out. It can look at any arrangement of pens and say
   * whether somebody is off the desk, and no arrangement says that somebody decided they had lost.
   */
  resigned: Side | null;
  /** Advanced by every write. A write against an older number is refused. */
  version: number;
  /** Last time anything happened here. The lease measures from this, not from creation. */
  touchedAt: number;
}

export type CreateOutcome =
  | { ok: true }
  | { ok: false; reason: "rooms-busy" | "too-many-rooms" | "key-taken" };

/**
 * What a room needs from storage, and nothing more.
 *
 * `service.ts` is written against this and knows about neither Redis nor HTTP, which is why the
 * races that matter are tested in milliseconds against the in-memory one and then tested again,
 * unchanged, against the real one.
 */
export interface RoomStore {
  /**
   * Take a slot and write the room, or refuse. One atomic step.
   *
   * Counting and then writing lets two simultaneous creates make a sixth room, and there is no
   * single process to serialise them: route handlers are called, not started.
   */
  create(room: Room, caller: string, now: number): Promise<CreateOutcome>;

  read(key: string): Promise<Room | null>;

  /**
   * Write the room if its stored version is still `expected`, returning what was written.
   *
   * Null means somebody else got there first, and the caller has to re-read rather than retry
   * blindly, because whatever it was about to write was decided against a board that has moved.
   */
  write(room: Room, expected: number): Promise<Room | null>;

  drop(key: string): Promise<void>;

  /** Records that a seat was heard from. Called on every poll, so it never touches the room. */
  touchSeat(key: string, seat: Side, now: number): Promise<void>;

  /** Last time each seat was heard from, in milliseconds, or null if never. */
  seenAt(key: string): Promise<Record<Side, number | null>>;
}
