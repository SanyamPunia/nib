import type { Reply } from "./handlers.ts";
import { PROTOCOL } from "./protocol.ts";
import { roomsConfigured, sharedRoomStore } from "./redis-store.ts";
import type { RoomDeps } from "./service.ts";

/**
 * The adapter between a Next route handler and `handlers.ts`.
 *
 * A route file reads the body, calls one handler and returns the result. Everything that could be
 * wrong lives one layer down, which is what lets the whole API be tested with no server running.
 *
 * Without `REDIS_URL` this answers 503 and the rest of the game is unaffected: the desk, the bot and
 * the whole single-screen product need no backend at all. Without `REDIS_PREFIX` it throws, because
 * a deployment that does not know whose keyspace it is writing to should not be serving.
 */
export async function roomRoute(
  request: Request,
  run: (deps: RoomDeps, caller: string, body: unknown) => Promise<Reply>,
): Promise<Response> {
  if (!roomsConfigured()) {
    return Response.json(
      { ok: false, error: "unavailable", protocol: PROTOCOL },
      { status: 503 },
    );
  }

  let body: unknown = null;
  if (request.method !== "GET") {
    try {
      body = await request.json();
    } catch {
      /* An unreadable body is an empty one. Every handler checks its fields anyway. */
      body = null;
    }
  }

  const deps: RoomDeps = { store: sharedRoomStore(), now: () => Date.now() };
  const reply = await run(deps, callerOf(request), body);
  return Response.json(reply.body, { status: reply.status });
}

/**
 * Who is asking, for the sake of the creation rate limit.
 *
 * The client address as the platform reports it. It is not an identity and is not treated as one:
 * it exists so that one machine cannot hold every room slot, and the cap behind it is what actually
 * protects the feature.
 */
function callerOf(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** The seat token as the browser sends it on a read, where there is no body to put it in. */
export function tokenOf(request: Request): string | null {
  return new URL(request.url).searchParams.get("token");
}
