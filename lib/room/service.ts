import { applyShot, other, replay } from "../match/rules.ts";
import { distinctFrom, type PenId } from "../pens.ts";
import { canonicalShot, isPlayable } from "../sim/shot.ts";
import type { Shot, Side } from "../sim/types.ts";
import { isRoomKey, newRoomKey, newSeatToken, normaliseRoomKey } from "./key.ts";
import { AWAY_MS, HERE_MS } from "./limits.ts";
import type { Joined, Presence, RoomError, RoomResult, RoomView, Seat } from "./protocol.ts";
import { PROTOCOL } from "./protocol.ts";
import type { Room, RoomStore } from "./store.ts";

/**
 * Every rule a room has, and it knows about nothing.
 *
 * No HTTP, no Redis, no React. It takes a store and returns decisions, which is the whole reason
 * the races can be tested against memory in milliseconds and then re-tested unchanged against the
 * real store.
 *
 * The clock is passed in rather than read, for the same reason: a rule that calls `Date.now` cannot
 * be asked what it does at the moment a lease runs out.
 */
export interface RoomDeps {
  store: RoomStore;
  now: () => number;
}

/** How many times to try again when two callers pick the same code in the same instant. */
const KEY_ATTEMPTS = 5;

function fail<T>(error: RoomError): RoomResult<T> {
  return { ok: false, error };
}

function ok<T>(value: T): RoomResult<T> {
  return { ok: true, value };
}

function seatOf(room: Room, token: string | undefined): Seat | null {
  if (!token) return null;
  if (room.seats.a === token) return "a";
  if (room.seats.b === token) return "b";
  return null;
}

function presenceOf(room: Room, seat: Side, seen: number | null, now: number): Presence {
  if (room.seats[seat] === null) return "empty";
  if (seen === null) return "gone";
  const quiet = now - seen;
  if (quiet <= HERE_MS) return "here";
  if (quiet <= AWAY_MS) return "away";
  return "gone";
}

function viewOf(
  room: Room,
  seat: Seat | null,
  seen: Record<Side, number | null>,
  now: number,
): RoomView {
  return {
    protocol: PROTOCOL,
    key: room.key,
    seat,
    first: room.first,
    shots: room.shots,
    pens: room.pens,
    resigned: room.resigned,
    version: room.version,
    present: {
      a: presenceOf(room, "a", seen.a, now),
      b: presenceOf(room, "b", seen.b, now),
    },
  };
}

async function look(deps: RoomDeps, room: Room, seat: Seat | null): Promise<RoomView> {
  const now = deps.now();
  if (seat) await deps.store.touchSeat(room.key, seat, now);
  const seen = await deps.store.seenAt(room.key);
  return viewOf(room, seat, seen, now);
}

/** Whether the match in this room has finished, by a pen going off or by somebody giving up. */
function isOver(room: Room): boolean {
  if (room.resigned) return true;
  const match = replay(room.first, room.shots);
  return match?.result !== null && match !== null;
}

export async function createRoom(
  deps: RoomDeps,
  pen: PenId,
  caller: string,
): Promise<RoomResult<Joined>> {
  const token = newSeatToken();
  for (let attempt = 0; attempt < KEY_ATTEMPTS; attempt++) {
    const now = deps.now();
    const room: Room = {
      key: newRoomKey(),
      first: "a",
      shots: [],
      seats: { a: token, b: null },
      pens: { a: pen, b: distinctFrom(pen, "brick") },
      resigned: null,
      version: 1,
      touchedAt: now,
    };
    const outcome = await deps.store.create(room, caller, now);
    if (outcome.ok) return ok({ room: await look(deps, room, "a"), token });
    if (outcome.reason === "key-taken") continue;
    return fail(outcome.reason);
  }
  return fail("unavailable");
}

export async function joinRoom(
  deps: RoomDeps,
  rawKey: string,
  pen: PenId,
): Promise<RoomResult<Joined>> {
  const key = normaliseRoomKey(rawKey);
  if (!isRoomKey(key)) return fail("no-such-room");

  const room = await deps.store.read(key);
  if (!room) return fail("no-such-room");
  if (room.seats.b !== null) return fail("room-full");

  const token = newSeatToken();
  const next: Room = {
    ...room,
    seats: { ...room.seats, b: token },
    /* The joiner is the one who shifts. Moving the other player's pen under them is not on. */
    pens: { ...room.pens, b: distinctFrom(room.pens.a, pen) },
    version: room.version + 1,
    touchedAt: deps.now(),
  };
  const written = await deps.store.write(next, room.version);
  if (!written) return fail("stale");
  return ok({ room: await look(deps, written, "b"), token });
}

export async function readRoom(
  deps: RoomDeps,
  rawKey: string,
  token?: string,
): Promise<RoomResult<RoomView>> {
  const key = normaliseRoomKey(rawKey);
  if (!isRoomKey(key)) return fail("no-such-room");
  const room = await deps.store.read(key);
  if (!room) return fail("no-such-room");
  return ok(await look(deps, room, seatOf(room, token)));
}

export async function playShot(
  deps: RoomDeps,
  rawKey: string,
  token: string,
  version: number,
  raw: Shot,
): Promise<RoomResult<RoomView>> {
  const key = normaliseRoomKey(rawKey);
  const room = await deps.store.read(key);
  if (!room) return fail("no-such-room");

  const seat = seatOf(room, token);
  if (!seat) return fail("not-your-seat");
  /*
   * The version is the whole concurrency story. A flick decided against a board that has since
   * moved is refused rather than applied, and the client re-reads instead of retrying.
   */
  if (version !== room.version) return fail("stale");
  if (room.resigned) return fail("match-over");

  const match = replay(room.first, room.shots);
  if (!match) return fail("unavailable");

  /*
   * The shot is put into canonical form before anything looks at it, and the canonical form is what
   * gets stored. Whatever arrived is a suggestion: it can be `NaN`, it can ask for a hundred times
   * the top speed. What gets replayed everywhere is this.
   */
  const shot = canonicalShot(seat, raw);
  if (!isPlayable(shot)) return fail("too-soft");

  const applied = applyShot(match, shot);
  if (!applied.ok) {
    return fail(applied.reason === "not-your-turn" ? "not-your-turn" : "match-over");
  }

  const next: Room = {
    ...room,
    shots: [...room.shots, shot],
    version: room.version + 1,
    touchedAt: deps.now(),
  };
  const written = await deps.store.write(next, room.version);
  if (!written) return fail("stale");
  return ok(await look(deps, written, seat));
}

export async function resign(
  deps: RoomDeps,
  rawKey: string,
  token: string,
  version: number,
): Promise<RoomResult<RoomView>> {
  const key = normaliseRoomKey(rawKey);
  const room = await deps.store.read(key);
  if (!room) return fail("no-such-room");
  const seat = seatOf(room, token);
  if (!seat) return fail("not-your-seat");
  if (version !== room.version) return fail("stale");
  if (isOver(room)) return fail("match-over");

  const next: Room = {
    ...room,
    resigned: seat,
    version: room.version + 1,
    touchedAt: deps.now(),
  };
  const written = await deps.store.write(next, room.version);
  if (!written) return fail("stale");
  return ok(await look(deps, written, seat));
}

export async function rematch(
  deps: RoomDeps,
  rawKey: string,
  token: string,
  version: number,
): Promise<RoomResult<RoomView>> {
  const key = normaliseRoomKey(rawKey);
  const room = await deps.store.read(key);
  if (!room) return fail("no-such-room");
  const seat = seatOf(room, token);
  if (!seat) return fail("not-your-seat");
  if (version !== room.version) return fail("stale");
  if (!isOver(room)) return fail("match-over");

  /* The player who lost flicks first, which is also what the single-screen game does. */
  const loser = room.resigned ?? other(replay(room.first, room.shots)?.result?.winner ?? "b");
  const next: Room = {
    ...room,
    first: loser,
    shots: [],
    resigned: null,
    version: room.version + 1,
    touchedAt: deps.now(),
  };
  const written = await deps.store.write(next, room.version);
  if (!written) return fail("stale");
  return ok(await look(deps, written, seat));
}

export async function leaveRoom(
  deps: RoomDeps,
  rawKey: string,
  token: string,
): Promise<RoomResult<null>> {
  const key = normaliseRoomKey(rawKey);
  const room = await deps.store.read(key);
  if (!room) return ok(null);
  const seat = seatOf(room, token);
  if (!seat) return ok(null);

  const seats = { ...room.seats, [seat]: null } as Record<Side, string | null>;
  if (seats.a === null && seats.b === null) {
    /* Nobody left in it, so the slot goes back rather than waiting out the lease. */
    await deps.store.drop(key);
    return ok(null);
  }
  await deps.store.write(
    { ...room, seats, version: room.version + 1, touchedAt: deps.now() },
    room.version,
  );
  return ok(null);
}
