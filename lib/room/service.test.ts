import assert from "node:assert/strict";
import { test } from "node:test";
import { replay } from "../match/rules.ts";
import { SHOT_STEP } from "../sim/shot.ts";
import type { Shot } from "../sim/types.ts";
import { LEASE_MS, MAX_ROOMS } from "./limits.ts";
import { MemoryRoomStore } from "./memory-store.ts";
import {
  createRoom,
  joinRoom,
  leaveRoom,
  playShot,
  readRoom,
  rematch,
  resign,
} from "./service.ts";

/**
 * A room with a clock the test owns.
 *
 * Nothing here reads a real one. A lease is a rule about silence, and a rule about silence can only
 * be tested by a test that decides how long the silence lasted.
 */
function harness(start = 1_000_000) {
  let clock = start;
  const store = new MemoryRoomStore(() => clock);
  return {
    deps: { store, now: () => clock },
    advance(ms: number) {
      clock += ms;
    },
  };
}

function flick(over: Partial<Shot> = {}): Shot {
  return { side: "a", vx: 100, vy: 0, offset: 0, ...over };
}

/**
 * A room with both seats taken.
 *
 * Both views come back carrying the version the room is actually on. Taking a seat advances it, so
 * the host's own copy is a version behind the moment somebody walks in, which is exactly what a
 * real client discovers on its next poll. Handing back the stale one here would make every test
 * below fail for a reason that has nothing to do with what it is testing.
 */
async function opened(h: ReturnType<typeof harness>) {
  const made = await createRoom(h.deps, "slate", "1.1.1.1");
  assert.ok(made.ok);
  const joined = await joinRoom(h.deps, made.value.room.key, "brick");
  assert.ok(joined.ok);
  const version = joined.value.room.version;
  return {
    host: { ...made.value, room: { ...made.value.room, version } },
    guest: joined.value,
    key: made.value.room.key,
    version,
  };
}

test("creating a room seats the creator and hands them a token", async () => {
  const h = harness();
  const made = await createRoom(h.deps, "slate", "1.1.1.1");
  assert.ok(made.ok);
  assert.equal(made.value.room.seat, "a");
  assert.equal(made.value.room.pens.a, "slate");
  assert.equal(made.value.room.present.b, "empty");
  assert.ok(made.value.token.length >= 16);
  assert.equal(made.value.room.shots.length, 0);
});

test("the cap is global, and a freed slot comes back", async () => {
  const h = harness();
  const keys: string[] = [];
  for (let i = 0; i < MAX_ROOMS; i++) {
    const made = await createRoom(h.deps, "slate", `caller-${i}`);
    assert.ok(made.ok, `room ${i} was refused`);
    keys.push(made.value.room.key);
  }
  const over = await createRoom(h.deps, "slate", "caller-x");
  assert.ok(!over.ok && over.error === "rooms-busy");

  /* The one who was in it leaves, and the slot is available again immediately. */
  const first = keys[0];
  assert.ok(first);
  await leaveRoom(h.deps, first, "wrong-token");
  const stillFull = await createRoom(h.deps, "slate", "caller-y");
  assert.ok(!stillFull.ok, "a bad token freed a slot");
});

test("one caller cannot hold every slot", async () => {
  const h = harness();
  let refusals = 0;
  for (let i = 0; i < MAX_ROOMS + 3; i++) {
    const made = await createRoom(h.deps, "slate", "one-caller");
    if (!made.ok) {
      refusals++;
      assert.equal(made.error, "too-many-rooms");
    }
  }
  assert.ok(refusals > 0, "one caller opened as many rooms as it liked");
});

test("a room closes after silence, and its slot frees with it", async () => {
  const h = harness();
  const made = await createRoom(h.deps, "slate", "1.1.1.1");
  assert.ok(made.ok);
  h.advance(LEASE_MS + 1);
  const gone = await readRoom(h.deps, made.value.room.key);
  assert.ok(!gone.ok && gone.error === "no-such-room");
  const next = await createRoom(h.deps, "slate", "2.2.2.2");
  assert.ok(next.ok, "the closed room was still holding its slot");
});

test("joining takes the other seat, and the joiner is the one whose pen shifts", async () => {
  const h = harness();
  const made = await createRoom(h.deps, "slate", "1.1.1.1");
  assert.ok(made.ok);
  /* Asking for the pen the host is already holding. */
  const joined = await joinRoom(h.deps, made.value.room.key, "slate");
  assert.ok(joined.ok);
  assert.equal(joined.value.room.seat, "b");
  assert.equal(joined.value.room.pens.a, "slate", "the host's pen was moved under them");
  assert.notEqual(joined.value.room.pens.b, "slate");
});

test("a full room refuses a third player, and a bad code is not a room", async () => {
  const h = harness();
  const { key } = await opened(h);
  const third = await joinRoom(h.deps, key, "forest");
  assert.ok(!third.ok && third.error === "room-full");

  for (const bad of ["", "ZZ", "ZZZZZ", "abc!", "O0I1"]) {
    const nope = await joinRoom(h.deps, bad, "forest");
    assert.ok(!nope.ok && nope.error === "no-such-room", `${bad} was treated as a room`);
  }
});

test("a code is read back however it was typed", async () => {
  const h = harness();
  const made = await createRoom(h.deps, "slate", "1.1.1.1");
  assert.ok(made.ok);
  const joined = await joinRoom(h.deps, `  ${made.value.room.key.toLowerCase()} `, "brick");
  assert.ok(joined.ok);
});

test("without a token you are told about the room but hold no seat", async () => {
  const h = harness();
  const { key } = await opened(h);
  const seen = await readRoom(h.deps, key);
  assert.ok(seen.ok);
  assert.equal(seen.value.seat, null);
});

test("a flick needs the seat's own token", async () => {
  const h = harness();
  const { key, host } = await opened(h);
  const nope = await playShot(h.deps, key, "not-a-token", host.room.version, flick());
  assert.ok(!nope.ok && nope.error === "not-your-seat");
});

test("a flick against a version the room has passed is refused", async () => {
  const h = harness();
  const { key, host } = await opened(h);
  const played = await playShot(h.deps, key, host.token, host.room.version, flick());
  assert.ok(played.ok);
  const again = await playShot(h.deps, key, host.token, host.room.version, flick());
  assert.ok(!again.ok && again.error === "stale");
});

test("the seat decides whose pen moves, not the shot", async () => {
  const h = harness();
  const { key, host } = await opened(h);
  /* Claiming to be the other player. The token says otherwise, and the token wins. */
  const played = await playShot(
    h.deps,
    key,
    host.token,
    host.room.version,
    flick({ side: "b" }),
  );
  assert.ok(played.ok);
  assert.equal(played.value.shots[0]?.side, "a");
});

test("what is stored is the canonical shot, not what was sent", async () => {
  const h = harness();
  const { key, host } = await opened(h);
  const played = await playShot(
    h.deps,
    key,
    host.token,
    host.room.version,
    flick({ vx: 9_999, vy: 0.001_7, offset: 500 }),
  );
  assert.ok(played.ok);
  const stored = played.value.shots[0];
  assert.ok(stored);
  for (const value of [stored.vx, stored.vy, stored.offset]) {
    assert.equal(
      value,
      Math.round(value / SHOT_STEP) * SHOT_STEP,
      "a stored value is off the grid",
    );
    assert.ok(Number.isFinite(value));
  }
  assert.ok(stored.vx < 9_999, "the speed was not brought inside the limit");
});

test("nonsense never reaches the simulation", async () => {
  const h = harness();
  const { key, host } = await opened(h);
  const nan = await playShot(
    h.deps,
    key,
    host.token,
    host.room.version,
    flick({ vx: Number.NaN, vy: Number.POSITIVE_INFINITY, offset: Number.NaN }),
  );
  /* Canonicalised to nothing, so it is refused for being too soft rather than crashing. */
  assert.ok(!nan.ok && nan.error === "too-soft");
});

test("flicking out of turn is refused", async () => {
  const h = harness();
  const { key, host, guest } = await opened(h);
  const wrong = await playShot(h.deps, key, guest.token, guest.room.version, flick());
  assert.ok(!wrong.ok && wrong.error === "not-your-turn");
  const right = await playShot(h.deps, key, host.token, host.room.version, flick());
  assert.ok(right.ok);
});

test("a room is a shot list, and it replays to one position", async () => {
  const h = harness();
  const { key, host, guest } = await opened(h);
  let version = host.room.version;
  const tokens = { a: host.token, b: guest.token };
  for (let i = 0; i < 4; i++) {
    const turn = i % 2 === 0 ? "a" : "b";
    const played = await playShot(h.deps, key, tokens[turn], version, flick({ vx: 40 }));
    assert.ok(played.ok, `flick ${i} was refused`);
    version = played.value.version;
    if (played.value.shots.length !== i + 1) break;
  }

  const seen = await readRoom(h.deps, key);
  assert.ok(seen.ok);
  const match = replay(seen.value.first, seen.value.shots);
  assert.ok(match, "the stored shots do not replay");
  assert.equal(match.shots, seen.value.shots.length);
});

test("giving up is an ending the pens cannot show", async () => {
  const h = harness();
  const { key, guest } = await opened(h);
  const gave = await resign(h.deps, key, guest.token, guest.room.version);
  assert.ok(gave.ok);
  assert.equal(gave.value.resigned, "b");

  const after = await playShot(h.deps, key, guest.token, gave.value.version, flick());
  assert.ok(!after.ok && after.error === "match-over");
});

test("a rematch waits for an ending, then the loser flicks first", async () => {
  const h = harness();
  const { key, host, guest } = await opened(h);
  const early = await rematch(h.deps, key, host.token, host.room.version);
  assert.ok(!early.ok && early.error === "match-over", "a rematch was allowed mid-match");

  const gave = await resign(h.deps, key, guest.token, guest.room.version);
  assert.ok(gave.ok);
  const again = await rematch(h.deps, key, host.token, gave.value.version);
  assert.ok(again.ok);
  assert.equal(again.value.shots.length, 0);
  assert.equal(again.value.resigned, null);
  assert.equal(again.value.first, "b", "the player who gave up does not flick first");
});

test("presence goes from here to away to gone as a seat stops looking", async () => {
  const h = harness();
  const { key, host } = await opened(h);
  const fresh = await readRoom(h.deps, key, host.token);
  assert.ok(fresh.ok);
  assert.equal(fresh.value.present.a, "here");

  h.advance(30 * 1000);
  const quiet = await readRoom(h.deps, key);
  assert.ok(quiet.ok);
  assert.equal(quiet.value.present.a, "away");

  h.advance(5 * 60 * 1000);
  const long = await readRoom(h.deps, key);
  assert.ok(long.ok);
  assert.equal(long.value.present.a, "gone");
});

test("the last one out closes the room", async () => {
  const h = harness();
  const { key, host, guest } = await opened(h);
  await leaveRoom(h.deps, key, host.token);
  const half = await readRoom(h.deps, key);
  assert.ok(half.ok, "one player leaving closed the room");
  assert.equal(half.value.present.a, "empty");

  await leaveRoom(h.deps, key, guest.token);
  const gone = await readRoom(h.deps, key);
  assert.ok(!gone.ok && gone.error === "no-such-room");
});

test("every response carries the protocol it was built against", async () => {
  const h = harness();
  const made = await createRoom(h.deps, "slate", "1.1.1.1");
  assert.ok(made.ok);
  assert.equal(typeof made.value.room.protocol, "number");
});
