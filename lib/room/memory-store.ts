import type { Side } from "../sim/types.ts";
import { CREATE_WINDOW_MS, CREATES_PER_WINDOW, LEASE_MS, MAX_ROOMS } from "./limits.ts";
import type { CreateOutcome, Room, RoomStore } from "./store.ts";

/**
 * The store the rules are tested against.
 *
 * It exists so the races that matter can be exercised in milliseconds without a network, and so
 * `store-contract.test.ts` can run the same suite against this and against Redis and insist they
 * behave identically. When they disagree, one of them is wrong and the test says which case.
 *
 * It expires rooms on read, the way Redis expires them with a key lifetime. Nothing sweeps in the
 * background, because a store nobody is reading has nothing to be wrong about.
 */
export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Room>();
  private seen = new Map<string, number>();
  private creates = new Map<string, number[]>();
  private readonly clock: () => number;

  /*
   * Written out rather than as a parameter property. `pnpm test` runs Node in strip-only mode,
   * which erases types and refuses anything that would need code generated for it, and a parameter
   * property is exactly that. The same rule rules out enums and namespaces anywhere the tests can
   * reach.
   */
  constructor(clock: () => number) {
    this.clock = clock;
  }

  private live(key: string): Room | null {
    const room = this.rooms.get(key);
    if (!room) return null;
    if (this.clock() - room.touchedAt > LEASE_MS) {
      this.rooms.delete(key);
      return null;
    }
    return room;
  }

  private aliveCount(): number {
    let alive = 0;
    for (const key of [...this.rooms.keys()]) if (this.live(key)) alive++;
    return alive;
  }

  async create(room: Room, caller: string, now: number): Promise<CreateOutcome> {
    const recent = (this.creates.get(caller) ?? []).filter((at) => now - at < CREATE_WINDOW_MS);
    if (recent.length >= CREATES_PER_WINDOW) {
      /* Recorded even when refused, so hammering the endpoint cannot shorten the window. */
      this.creates.set(caller, recent);
      return { ok: false, reason: "too-many-rooms" };
    }
    if (this.aliveCount() >= MAX_ROOMS) return { ok: false, reason: "rooms-busy" };
    if (this.live(room.key)) return { ok: false, reason: "key-taken" };

    this.rooms.set(room.key, structuredClone(room));
    this.creates.set(caller, [...recent, now]);
    return { ok: true };
  }

  async read(key: string): Promise<Room | null> {
    const room = this.live(key);
    return room ? structuredClone(room) : null;
  }

  async write(room: Room, expected: number): Promise<Room | null> {
    const current = this.live(room.key);
    if (!current || current.version !== expected) return null;
    this.rooms.set(room.key, structuredClone(room));
    return structuredClone(room);
  }

  async drop(key: string): Promise<void> {
    this.rooms.delete(key);
    this.seen.delete(`${key}:a`);
    this.seen.delete(`${key}:b`);
  }

  async touchSeat(key: string, seat: Side, now: number): Promise<void> {
    this.seen.set(`${key}:${seat}`, now);
  }

  async seenAt(key: string): Promise<Record<Side, number | null>> {
    return {
      a: this.seen.get(`${key}:a`) ?? null,
      b: this.seen.get(`${key}:b`) ?? null,
    };
  }
}
