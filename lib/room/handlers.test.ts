import assert from "node:assert/strict";
import { test } from "node:test";
import {
  handleCreate,
  handleJoin,
  handleLeave,
  handleRead,
  handleRematch,
  handleResign,
  handleShot,
} from "./handlers.ts";
import { MemoryRoomStore } from "./memory-store.ts";
import type { RoomDeps } from "./service.ts";

/**
 * The API, tested with no server running.
 *
 * Everything that could be wrong lives in `handlers.ts`, so this is the whole surface. Most of it is
 * about what arrives rather than what happens: a body posted to a route is whatever somebody chose
 * to send, and every field has to survive being the wrong type, missing, or hostile.
 */
function deps(): RoomDeps {
  const clock = 1_000_000;
  return { store: new MemoryRoomStore(() => clock), now: () => clock };
}

function room(reply: { body: unknown }): {
  key: string;
  version: number;
  seat: string | null;
} {
  const body = reply.body as { room: { key: string; version: number; seat: string | null } };
  return body.room;
}

function token(reply: { body: unknown }): string {
  return (reply.body as { token: string }).token;
}

async function opened(d: RoomDeps) {
  const made = await handleCreate(d, { pen: "slate" }, "1.1.1.1");
  const key = room(made).key;
  const joined = await handleJoin(d, key, { pen: "brick" });
  return {
    key,
    host: token(made),
    guest: token(joined),
    version: room(joined).version,
  };
}

test("creating needs a pen the game actually has", async () => {
  const d = deps();
  for (const body of [null, {}, { pen: "" }, { pen: "gold" }, { pen: 7 }, { pen: {} }]) {
    const reply = await handleCreate(d, body, "1.1.1.1");
    assert.equal(reply.status, 404, JSON.stringify(body));
  }
  const good = await handleCreate(d, { pen: "forest" }, "1.1.1.1");
  assert.equal(good.status, 200);
  assert.equal(room(good).seat, "a");
  assert.ok(token(good));
});

test("every reply says which protocol built it", async () => {
  const d = deps();
  const made = await handleCreate(d, { pen: "slate" }, "1.1.1.1");
  assert.ok((made.body as { protocol: number }).protocol >= 1);
  const missing = await handleRead(d, "ZZZZ", null);
  assert.ok((missing.body as { protocol: number }).protocol >= 1);
});

test("a room that is not there is a 404, however the code was written", async () => {
  const d = deps();
  for (const key of ["ZZZZ", "", "nope", "!!!!"]) {
    const reply = await handleRead(d, key, null);
    assert.equal(reply.status, 404, key);
  }
});

test("reading without a token tells you about the room but seats you nowhere", async () => {
  const d = deps();
  const { key } = await opened(d);
  const seen = await handleRead(d, key, null);
  assert.equal(seen.status, 200);
  assert.equal(room(seen).seat, null);
});

test("a second guest is a 409, not a 500", async () => {
  const d = deps();
  const { key } = await opened(d);
  const third = await handleJoin(d, key, { pen: "amber" });
  assert.equal(third.status, 409);
  assert.equal((third.body as { error: string }).error, "room-full");
});

test("a flick without a token is refused before anything else looks at it", async () => {
  const d = deps();
  const { key, version } = await opened(d);
  for (const body of [null, {}, { version }, { token: "", version }, { token: 5, version }]) {
    const reply = await handleShot(d, key, body);
    assert.equal(reply.status, 403, JSON.stringify(body));
  }
});

test("a version that is not a whole number is not a version", async () => {
  const d = deps();
  const { key, host } = await opened(d);
  for (const version of [undefined, "2", 2.5, -1, Number.NaN, null]) {
    const reply = await handleShot(d, key, {
      token: host,
      version,
      shot: { vx: 100, vy: 0, offset: 0 },
    });
    assert.equal(reply.status, 409, String(version));
  }
});

test("a shot has to be three numbers before it is anything else", async () => {
  const d = deps();
  const { key, host, version } = await opened(d);
  for (const shot of [
    undefined,
    null,
    {},
    { vx: 100 },
    { vx: "100", vy: 0, offset: 0 },
    { vx: 100, vy: null, offset: 0 },
  ]) {
    const reply = await handleShot(d, key, { token: host, version, shot });
    assert.equal(reply.status, 409, JSON.stringify(shot));
  }
});

test("numbers the simulation cannot use come back as a refusal, not a crash", async () => {
  const d = deps();
  const { key, host, version } = await opened(d);
  const reply = await handleShot(d, key, {
    token: host,
    version,
    shot: { vx: Number.NaN, vy: Number.POSITIVE_INFINITY, offset: -Number.NaN },
  });
  assert.equal(reply.status, 422);
  assert.equal((reply.body as { error: string }).error, "too-soft");
});

test("a good flick lands and advances the version", async () => {
  const d = deps();
  const { key, host, version } = await opened(d);
  const played = await handleShot(d, key, {
    token: host,
    version,
    shot: { vx: 100, vy: 0, offset: 0 },
  });
  assert.equal(played.status, 200);
  assert.equal(room(played).version, version + 1);

  /* The same body again, now describing a board that has moved. */
  const stale = await handleShot(d, key, {
    token: host,
    version,
    shot: { vx: 100, vy: 0, offset: 0 },
  });
  assert.equal(stale.status, 409);
  assert.equal((stale.body as { error: string }).error, "stale");
});

test("flicking out of turn is a 409 that says so", async () => {
  const d = deps();
  const { key, guest, version } = await opened(d);
  const reply = await handleShot(d, key, {
    token: guest,
    version,
    shot: { vx: -100, vy: 0, offset: 0 },
  });
  assert.equal(reply.status, 409);
  assert.equal((reply.body as { error: string }).error, "not-your-turn");
});

test("giving up, then playing again, in that order only", async () => {
  const d = deps();
  const { key, host, guest, version } = await opened(d);

  const early = await handleRematch(d, key, { token: host, version });
  assert.equal(early.status, 409);

  const gave = await handleResign(d, key, { token: guest, version });
  assert.equal(gave.status, 200);

  const again = await handleRematch(d, key, { token: host, version: room(gave).version });
  assert.equal(again.status, 200);
});

test("someone else's token gets nowhere", async () => {
  const d = deps();
  const { key, version } = await opened(d);
  for (const call of [handleShot, handleResign, handleRematch]) {
    const reply = await call(d, key, {
      token: "deadbeef",
      version,
      shot: { vx: 100, vy: 0, offset: 0 },
    });
    assert.equal(reply.status, 403, call.name);
  }
});

test("leaving is idempotent and never an error", async () => {
  const d = deps();
  const { key, host } = await opened(d);
  for (const body of [null, {}, { token: "nonsense" }, { token: host }, { token: host }]) {
    const reply = await handleLeave(d, key, body);
    assert.equal(reply.status, 200, JSON.stringify(body));
  }
});

test("being busy and being wrong are different answers", async () => {
  const d = deps();
  /* Five rooms from five callers fills the cap, and the sixth caller is told to wait. */
  for (let i = 0; i < 5; i++) {
    const made = await handleCreate(d, { pen: "slate" }, `caller-${i}`);
    assert.equal(made.status, 200, `room ${i}`);
  }
  const busy = await handleCreate(d, { pen: "slate" }, "caller-new");
  assert.equal(busy.status, 503);
  assert.equal((busy.body as { error: string }).error, "rooms-busy");
});

test("one caller asking too often is told to slow down, not that the game is full", async () => {
  const d = deps();
  let sawRate = false;
  for (let i = 0; i < 8; i++) {
    const made = await handleCreate(d, { pen: "slate" }, "one-caller");
    if (made.status === 429) sawRate = true;
  }
  assert.ok(sawRate, "one caller was never rate limited");
});
