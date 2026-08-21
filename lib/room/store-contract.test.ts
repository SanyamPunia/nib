import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CREATES_PER_WINDOW, MAX_ROOMS } from "./limits.ts";
import { MemoryRoomStore } from "./memory-store.ts";
import { RedisRoomStore } from "./redis-store.ts";
import type { Room, RoomStore } from "./store.ts";

/**
 * One suite, run against both stores, insisting they behave the same.
 *
 * The rules in `service.ts` are tested against the in-memory store because that takes milliseconds.
 * This is what earns the right to do that: if the two stores ever disagree, one of them is wrong and
 * these say which case.
 *
 * **The Redis half runs under a throwaway prefix, generated per test.** It never uses the one a
 * deployment would set. That is deliberate: this file holds the only destructive call in the
 * project, and pointing it at a namespace that no application owns means the worst it can do is
 * delete keys it made itself seconds earlier. It is skipped entirely without `REDIS_URL`, so the
 * suite is green on a machine that has never seen a Redis.
 */
const URL = process.env.REDIS_URL;

interface Harness {
  store: RoomStore;
  done: () => Promise<void>;
}

const opened: RedisRoomStore[] = [];

function memory(): Harness {
  return { store: new MemoryRoomStore(() => Date.now()), done: async () => {} };
}

function redis(): Harness {
  const prefix = `nibtest-${Math.random().toString(36).slice(2, 10)}:`;
  const store = new RedisRoomStore(URL ?? "", prefix);
  opened.push(store);
  return { store, done: () => store.clear(prefix) };
}

after(async () => {
  for (const store of opened) await store.close();
});

const backends: [string, () => Harness][] = URL
  ? [
      ["memory", memory],
      ["redis", redis],
    ]
  : [["memory", memory]];

function room(key: string, now: number): Room {
  return {
    key,
    first: "a",
    shots: [],
    seats: { a: "token-a", b: null },
    pens: { a: "slate", b: "brick" },
    resigned: null,
    version: 1,
    touchedAt: now,
  };
}

/** Room codes are four characters from a fixed alphabet, so test keys have to look like real ones. */
function code(n: number): string {
  return `T${String(n).padStart(3, "2").slice(-3)}`;
}

for (const [name, make] of backends) {
  test(`${name}: a created room reads back, and an unknown one does not`, async () => {
    const h = make();
    try {
      const now = Date.now();
      assert.deepEqual(await h.store.create(room(code(1), now), "caller", now), { ok: true });
      const read = await h.store.read(code(1));
      assert.ok(read);
      assert.equal(read.key, code(1));
      assert.equal(read.pens.a, "slate");
      assert.equal(await h.store.read(code(9)), null);
    } finally {
      await h.done();
    }
  });

  test(`${name}: the same code cannot be taken twice`, async () => {
    const h = make();
    try {
      const now = Date.now();
      await h.store.create(room(code(1), now), "one", now);
      const again = await h.store.create(room(code(1), now), "two", now);
      assert.deepEqual(again, { ok: false, reason: "key-taken" });
    } finally {
      await h.done();
    }
  });

  test(`${name}: the cap holds across different callers`, async () => {
    const h = make();
    try {
      const now = Date.now();
      for (let i = 0; i < MAX_ROOMS; i++) {
        const made = await h.store.create(room(code(i), now), `caller-${i}`, now);
        assert.deepEqual(made, { ok: true }, `room ${i} was refused`);
      }
      const over = await h.store.create(room(code(99), now), "caller-new", now);
      assert.deepEqual(over, { ok: false, reason: "rooms-busy" });
    } finally {
      await h.done();
    }
  });

  test(`${name}: one caller is rate limited before the cap is reached`, async () => {
    const h = make();
    try {
      const now = Date.now();
      for (let i = 0; i < CREATES_PER_WINDOW; i++) {
        await h.store.create(room(code(i), now), "same-caller", now);
      }
      const over = await h.store.create(room(code(98), now), "same-caller", now);
      assert.deepEqual(over, { ok: false, reason: "too-many-rooms" });
    } finally {
      await h.done();
    }
  });

  test(`${name}: a write lands only against the version it expects`, async () => {
    const h = make();
    try {
      const now = Date.now();
      await h.store.create(room(code(1), now), "caller", now);

      const first = await h.store.write(
        { ...room(code(1), now), version: 2, resigned: "b" },
        1,
      );
      assert.ok(first, "a write against the current version was refused");
      assert.equal(first.version, 2);
      assert.equal(first.resigned, "b");

      /* The same write again, still claiming version one, which the room has now passed. */
      const stale = await h.store.write({ ...room(code(1), now), version: 2 }, 1);
      assert.equal(stale, null);

      const read = await h.store.read(code(1));
      assert.equal(read?.version, 2, "a refused write changed the room anyway");
    } finally {
      await h.done();
    }
  });

  test(`${name}: writing to a room that is not there does nothing`, async () => {
    const h = make();
    try {
      const written = await h.store.write(room(code(7), Date.now()), 1);
      assert.equal(written, null);
    } finally {
      await h.done();
    }
  });

  test(`${name}: dropping a room frees its code and its slot`, async () => {
    const h = make();
    try {
      const now = Date.now();
      await h.store.create(room(code(1), now), "caller", now);
      await h.store.drop(code(1));
      assert.equal(await h.store.read(code(1)), null);
      const again = await h.store.create(room(code(1), now), "caller-two", now);
      assert.deepEqual(again, { ok: true }, "the code was still held after a drop");
    } finally {
      await h.done();
    }
  });

  test(`${name}: a seat is unheard from until it is touched`, async () => {
    const h = make();
    try {
      const now = Date.now();
      await h.store.create(room(code(1), now), "caller", now);
      assert.deepEqual(await h.store.seenAt(code(1)), { a: null, b: null });

      await h.store.touchSeat(code(1), "a", now);
      const seen = await h.store.seenAt(code(1));
      assert.equal(seen.a, now);
      assert.equal(seen.b, null);
    } finally {
      await h.done();
    }
  });

  test(`${name}: touching a seat does not disturb the room`, async () => {
    const h = make();
    try {
      const now = Date.now();
      await h.store.create(room(code(1), now), "caller", now);
      await h.store.touchSeat(code(1), "a", now + 5);
      const read = await h.store.read(code(1));
      assert.equal(read?.version, 1, "a poll advanced the version");
    } finally {
      await h.done();
    }
  });
}

test("a prefix that could reach another namespace is refused", () => {
  for (const bad of ["", "nib", "NIB:", ":", "-nib:", "nib:extra"]) {
    assert.throws(() => new RedisRoomStore("redis://127.0.0.1:1", bad), /REDIS_PREFIX/, bad);
  }
  /* And a good one constructs without connecting, because the client is lazy. */
  const fine = new RedisRoomStore("redis://127.0.0.1:1", "nib:");
  opened.push(fine);
});

test("clearing refuses a prefix it does not hold", async () => {
  const store = new RedisRoomStore("redis://127.0.0.1:1", "nib-guard:");
  opened.push(store);
  await assert.rejects(() => store.clear("somebody-else:"), /Refusing to clear/);
});
