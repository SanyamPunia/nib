import { PEN_IDS, type PenId } from "../pens.ts";
import type { Shot } from "../sim/types.ts";
import type { RoomError } from "./protocol.ts";
import { PROTOCOL } from "./protocol.ts";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  playShot,
  type RoomDeps,
  readRoom,
  rematch,
  resign,
} from "./service.ts";

/**
 * The API.
 *
 * Everything that could be wrong lives here, so the whole surface is covered by `node --test` with
 * no server booted. A file under `app/api/` reads the body, calls one of these and returns the
 * result, and that is all it does.
 */

export interface Reply {
  status: number;
  body: unknown;
}

/**
 * What each refusal means over HTTP.
 *
 * `stale` is a 409 and not a 500 on purpose: two people flicking at once is ordinary, and the client
 * answers it by re-reading rather than by retrying. Anything that says the caller should slow down
 * or wait is separated from anything that says they got it wrong, because the browser treats those
 * differently.
 */
const STATUS: Record<RoomError, number> = {
  "protocol-mismatch": 409,
  "no-such-room": 404,
  "room-full": 409,
  "rooms-busy": 503,
  "too-many-rooms": 429,
  "not-your-seat": 403,
  stale: 409,
  "not-your-turn": 409,
  "match-over": 409,
  "too-soft": 422,
  unavailable: 503,
};

function refuse(error: RoomError): Reply {
  return { status: STATUS[error], body: { ok: false, error, protocol: PROTOCOL } };
}

function accept(body: Record<string, unknown>): Reply {
  return { status: 200, body: { ok: true, protocol: PROTOCOL, ...body } };
}

/*
 * Everything below assumes nothing about what arrived. A body is whatever was posted, which is to
 * say it can be anything at all, and every field is checked before it reaches a rule.
 */

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

function asPen(value: unknown): PenId | null {
  return typeof value === "string" && (PEN_IDS as readonly string[]).includes(value)
    ? (value as PenId)
    : null;
}

function asToken(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : null;
}

function asVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** A shot is four numbers. Whether they are sensible numbers is the service's business. */
function asShot(value: unknown): Shot | null {
  const shot = asRecord(value);
  const { vx, vy, offset } = shot;
  if (typeof vx !== "number" || typeof vy !== "number" || typeof offset !== "number")
    return null;
  return { side: "a", vx, vy, offset };
}

export async function handleCreate(
  deps: RoomDeps,
  body: unknown,
  caller: string,
): Promise<Reply> {
  const pen = asPen(asRecord(body).pen);
  if (!pen) return refuse("no-such-room");
  const made = await createRoom(deps, pen, caller);
  if (!made.ok) return refuse(made.error);
  return accept({ room: made.value.room, token: made.value.token });
}

export async function handleJoin(deps: RoomDeps, key: string, body: unknown): Promise<Reply> {
  const pen = asPen(asRecord(body).pen);
  if (!pen) return refuse("no-such-room");
  const joined = await joinRoom(deps, key, pen);
  if (!joined.ok) return refuse(joined.error);
  return accept({ room: joined.value.room, token: joined.value.token });
}

export async function handleRead(
  deps: RoomDeps,
  key: string,
  token: string | null,
): Promise<Reply> {
  const seen = await readRoom(deps, key, token ?? undefined);
  if (!seen.ok) return refuse(seen.error);
  return accept({ room: seen.value });
}

export async function handleShot(deps: RoomDeps, key: string, body: unknown): Promise<Reply> {
  const fields = asRecord(body);
  const token = asToken(fields.token);
  const version = asVersion(fields.version);
  const shot = asShot(fields.shot);
  if (!token) return refuse("not-your-seat");
  if (version === null || !shot) return refuse("stale");
  const played = await playShot(deps, key, token, version, shot);
  if (!played.ok) return refuse(played.error);
  return accept({ room: played.value });
}

export async function handleResign(deps: RoomDeps, key: string, body: unknown): Promise<Reply> {
  const fields = asRecord(body);
  const token = asToken(fields.token);
  const version = asVersion(fields.version);
  if (!token) return refuse("not-your-seat");
  if (version === null) return refuse("stale");
  const gave = await resign(deps, key, token, version);
  if (!gave.ok) return refuse(gave.error);
  return accept({ room: gave.value });
}

export async function handleRematch(
  deps: RoomDeps,
  key: string,
  body: unknown,
): Promise<Reply> {
  const fields = asRecord(body);
  const token = asToken(fields.token);
  const version = asVersion(fields.version);
  if (!token) return refuse("not-your-seat");
  if (version === null) return refuse("stale");
  const again = await rematch(deps, key, token, version);
  if (!again.ok) return refuse(again.error);
  return accept({ room: again.value });
}

export async function handleLeave(deps: RoomDeps, key: string, body: unknown): Promise<Reply> {
  const token = asToken(asRecord(body).token);
  /* Leaving is idempotent and never worth an error. A caller doing it twice has got what it wanted. */
  if (token) await leaveRoom(deps, key, token);
  return accept({});
}
