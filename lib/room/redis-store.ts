import Redis from "ioredis";
import type { Side } from "../sim/types.ts";
import { CREATE_WINDOW_MS, CREATES_PER_WINDOW, LEASE_MS, MAX_ROOMS } from "./limits.ts";
import type { CreateOutcome, Room, RoomStore } from "./store.ts";

/**
 * The real store.
 *
 * Two things here are worth reading before changing anything.
 *
 * **The prefix is required and has no default.** Every key this class writes begins with it, and
 * the one destructive operation in the file deletes everything that begins with it. A default would
 * mean that a deployment with the variable missing writes into, and can erase, whichever namespace
 * that default happened to name. There is no safe value for that, so there is no value: a missing
 * prefix refuses to construct. A crash at boot is the cheapest possible version of this mistake.
 *
 * **Creating a room is one atomic step.** Counting rooms and then writing one lets two simultaneous
 * creates make a sixth, and there is nowhere to serialise them: route handlers are called, not
 * started, so there is no single process holding a lock. The cap, the rate limit and the write all
 * happen inside one script.
 */

/** Grows the room's life every time anything touches it, so the lease measures silence. */
const CREATE = `
local room, version, index, hits = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local json, now, lease = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3])
local maxRooms, window, maxCreates, code = tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]), ARGV[7]

redis.call('ZREMRANGEBYSCORE', index, '-inf', now - lease)
redis.call('ZREMRANGEBYSCORE', hits, '-inf', now - window)

if redis.call('ZCARD', hits) >= maxCreates then return 'too-many-rooms' end
if redis.call('ZCARD', index) >= maxRooms then return 'rooms-busy' end
if redis.call('EXISTS', room) == 1 then return 'key-taken' end

redis.call('SET', room, json, 'PX', lease)
redis.call('SET', version, 1, 'PX', lease)
redis.call('ZADD', index, now, code)
redis.call('ZADD', hits, now, now .. ':' .. code)
redis.call('PEXPIRE', hits, window)
return 'ok'
`;

/**
 * Compare and set on the version.
 *
 * The version lives in its own plain key rather than being read out of the room's JSON, so this
 * script never has to parse anything. A script that parsed JSON to find one integer would be doing
 * it on every poll of every room.
 */
const WRITE = `
local room, version, index = KEYS[1], KEYS[2], KEYS[3]
local json, expected, next = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3])
local now, lease, code = tonumber(ARGV[4]), tonumber(ARGV[5]), ARGV[6]

local current = redis.call('GET', version)
if not current then return nil end
if tonumber(current) ~= expected then return nil end

redis.call('SET', room, json, 'PX', lease)
redis.call('SET', version, next, 'PX', lease)
redis.call('ZADD', index, now, code)
return json
`;

/**
 * A namespace, required.
 *
 * The trailing colon is insisted on so that one prefix cannot be a prefix of another. Without it,
 * `nib` and `nibble` share a keyspace and `KEYS nib*` reaches into both.
 */
const PREFIX_SHAPE = /^[a-z0-9][a-z0-9_-]*:$/;

export class RedisRoomStore implements RoomStore {
  private readonly redis: Redis;
  private readonly prefix: string;

  constructor(url: string, prefix: string) {
    if (!PREFIX_SHAPE.test(prefix)) {
      throw new Error(
        `REDIS_PREFIX must look like "example:" and was ${JSON.stringify(prefix)}. ` +
          "Every key this store writes, and the only thing it ever deletes in bulk, is scoped by " +
          "it, so there is no default and no empty value.",
      );
    }
    this.prefix = prefix;
    /* Bounded, so a wrong or unreachable URL fails a request rather than holding one open. */
    this.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 4000,
    });
  }

  private room(key: string): string {
    return `${this.prefix}room:${key}`;
  }

  private version(key: string): string {
    return `${this.prefix}room:${key}:v`;
  }

  private get index(): string {
    return `${this.prefix}rooms`;
  }

  private seenKey(key: string, seat: Side): string {
    return `${this.prefix}seen:${key}:${seat}`;
  }

  async create(room: Room, caller: string, now: number): Promise<CreateOutcome> {
    const outcome = await this.redis.eval(
      CREATE,
      4,
      this.room(room.key),
      this.version(room.key),
      this.index,
      `${this.prefix}hits:${caller}`,
      JSON.stringify(room),
      String(now),
      String(LEASE_MS),
      String(MAX_ROOMS),
      String(CREATE_WINDOW_MS),
      String(CREATES_PER_WINDOW),
      room.key,
    );
    if (outcome === "ok") return { ok: true };
    if (outcome === "rooms-busy" || outcome === "too-many-rooms" || outcome === "key-taken") {
      return { ok: false, reason: outcome };
    }
    return { ok: false, reason: "rooms-busy" };
  }

  async read(key: string): Promise<Room | null> {
    const json = await this.redis.get(this.room(key));
    if (!json) return null;
    try {
      return JSON.parse(json) as Room;
    } catch {
      /* Unreadable is the same as absent. Nothing good comes of guessing at half a room. */
      return null;
    }
  }

  async write(room: Room, expected: number): Promise<Room | null> {
    const written = await this.redis.eval(
      WRITE,
      3,
      this.room(room.key),
      this.version(room.key),
      this.index,
      JSON.stringify(room),
      String(expected),
      String(room.version),
      String(room.touchedAt),
      String(LEASE_MS),
      room.key,
    );
    if (typeof written !== "string") return null;
    return JSON.parse(written) as Room;
  }

  async drop(key: string): Promise<void> {
    await this.redis
      .multi()
      .del(this.room(key), this.version(key), this.seenKey(key, "a"), this.seenKey(key, "b"))
      .zrem(this.index, key)
      .exec();
  }

  async touchSeat(key: string, seat: Side, now: number): Promise<void> {
    await this.redis.set(this.seenKey(key, seat), String(now), "PX", LEASE_MS);
  }

  async seenAt(key: string): Promise<Record<Side, number | null>> {
    const seen = await this.redis.mget(this.seenKey(key, "a"), this.seenKey(key, "b"));
    /* Indexing is checked, so a short reply reads as "never heard from" rather than as a crash. */
    const read = (value: string | null | undefined) =>
      value === null || value === undefined ? null : Number(value);
    return { a: read(seen[0]), b: read(seen[1]) };
  }

  /**
   * Delete everything this prefix owns. Only ever called by a test tearing itself down.
   *
   * It has to be told which prefix it is wiping, and refuses if that is not the one it holds. The
   * constructor already makes an empty or absent prefix impossible, so this is the second lock on
   * the same door: erasing another application's data now takes actively naming that application.
   */
  async clear(expectPrefix: string): Promise<void> {
    if (expectPrefix !== this.prefix) {
      throw new Error(
        `Refusing to clear ${JSON.stringify(this.prefix)} when asked for ` +
          `${JSON.stringify(expectPrefix)}.`,
      );
    }
    const keys = await this.redis.keys(`${this.prefix}*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

/** Whether rooms can work at all here. Without a URL the rest of the game is unaffected. */
export function roomsConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

let shared: RedisRoomStore | null = null;

/**
 * The one store the route handlers use.
 *
 * A module-level singleton, because a route handler is called rather than started and there is
 * nowhere to construct one and hand it around. A client per request would open a connection per
 * request.
 *
 * A missing prefix throws rather than degrading. A missing URL is a feature that is switched off,
 * which is a reasonable thing for a deployment to be. A missing prefix is a deployment that does
 * not know whose data it is about to write, which is not.
 */
export function sharedRoomStore(): RedisRoomStore {
  if (shared) return shared;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set, so rooms are unavailable.");
  shared = new RedisRoomStore(url, process.env.REDIS_PREFIX ?? "");
  return shared;
}
