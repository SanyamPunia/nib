"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PenId } from "@/lib/pens.ts";
import type { RoomError, RoomView, Seat } from "@/lib/room/protocol.ts";
import { PROTOCOL } from "@/lib/room/protocol.ts";
import type { Shot } from "@/lib/sim/types.ts";

/**
 * A room, from the browser's side.
 *
 * Rooms are polled rather than pushed, and that is not a preference. A route handler is
 * `(Request) => Response`, and that signature cannot express taking over a connection, so there is
 * no socket to be had here. The cost is that a flick can take a poll interval to appear.
 *
 * That cost is much smaller here than it would be in a board game, because a flick takes a second
 * or two to play out on screen. The animation covers the round trip. It is the reason this feature
 * is comfortable on an interval that would feel broken in chess.
 *
 * The interval is therefore both the latency of the whole feature and its request rate, which is
 * why it changes with what is being waited for and stops entirely while the tab is hidden.
 */
const WAITING_FOR_THEM_MS = 1_400;
const WAITING_FOR_A_GUEST_MS = 1_800;
/** Nothing can change on our own turn except the other player leaving, so barely look. */
const OUR_TURN_MS = 4_500;

/** Enough to survive a refresh without losing your seat, and gone when the tab closes. */
const SEAT_STORE = "nib:seat";

export type RoomPhase = "out" | "working" | "in";

export interface RoomHandle {
  phase: RoomPhase;
  view: RoomView | null;
  seat: Seat | null;
  error: RoomError | null;
  create: (pen: PenId) => Promise<void>;
  join: (key: string, pen: PenId) => Promise<void>;
  play: (shot: Shot) => Promise<boolean>;
  again: () => Promise<void>;
  give: () => Promise<void>;
  leave: () => Promise<void>;
}

interface Seated {
  key: string;
  token: string;
}

function remember(seated: Seated | null): void {
  try {
    if (seated) sessionStorage.setItem(SEAT_STORE, JSON.stringify(seated));
    else sessionStorage.removeItem(SEAT_STORE);
  } catch {
    /* A refresh will cost the seat. Not worth failing over. */
  }
}

function recall(): Seated | null {
  try {
    const raw = sessionStorage.getItem(SEAT_STORE);
    if (!raw) return null;
    const seated = JSON.parse(raw) as Seated;
    return typeof seated?.key === "string" && typeof seated?.token === "string" ? seated : null;
  } catch {
    return null;
  }
}

interface Answer {
  ok: boolean;
  error?: RoomError;
  protocol?: number;
  room?: RoomView;
  token?: string;
}

async function ask(path: string, body?: unknown): Promise<Answer> {
  try {
    /*
     * Built rather than declared with holes in it. `exactOptionalPropertyTypes` is on, so a field
     * present and undefined is not the same as a field absent, and `fetch` means the second.
     */
    const init: RequestInit =
      body === undefined
        ? { method: "GET" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const response = await fetch(`/api/rooms${path}`, init);
    const answer = (await response.json()) as Answer;
    /*
     * A tab open across a deploy is running a different build from the server, and both of them run
     * the simulation. Reporting that is the only honest thing to do: guessing would mean replaying a
     * shot under rules it was not played under.
     */
    if (answer.protocol !== undefined && answer.protocol !== PROTOCOL) {
      return { ok: false, error: "protocol-mismatch" };
    }
    return answer;
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

export function useRoom(): RoomHandle {
  const [phase, setPhase] = useState<RoomPhase>("out");
  const [view, setView] = useState<RoomView | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const seatedRef = useRef<Seated | null>(null);

  const adopt = useCallback((answer: Answer): boolean => {
    if (!answer.ok || !answer.room) {
      setError(answer.error ?? "unavailable");
      return false;
    }
    setError(null);
    setView(answer.room);
    return true;
  }, []);

  const forget = useCallback(() => {
    seatedRef.current = null;
    remember(null);
    setView(null);
    setPhase("out");
  }, []);

  /* Pick the seat back up after a refresh, before anything else happens. */
  useEffect(() => {
    const seated = recall();
    if (!seated) return;
    seatedRef.current = seated;
    setPhase("working");
    void ask(`/${seated.key}?token=${encodeURIComponent(seated.token)}`).then((answer) => {
      if (answer.ok && answer.room) {
        setView(answer.room);
        setPhase("in");
      } else {
        forget();
      }
    });
  }, [forget]);

  const enter = useCallback(async (path: string, body: unknown, key: string) => {
    setPhase("working");
    const answer = await ask(path, body);
    if (!answer.ok || !answer.room || !answer.token) {
      setError(answer.error ?? "unavailable");
      setPhase("out");
      return;
    }
    const seated = { key: answer.room.key || key, token: answer.token };
    seatedRef.current = seated;
    remember(seated);
    setView(answer.room);
    setError(null);
    setPhase("in");
  }, []);

  const create = useCallback((pen: PenId) => enter("", { pen }, ""), [enter]);

  const join = useCallback(
    (key: string, pen: PenId) => enter(`/${encodeURIComponent(key)}/join`, { pen }, key),
    [enter],
  );

  const write = useCallback(
    async (suffix: string, extra: Record<string, unknown> = {}): Promise<boolean> => {
      const seated = seatedRef.current;
      if (!seated || !view) return false;
      const answer = await ask(`/${seated.key}${suffix}`, {
        token: seated.token,
        version: view.version,
        ...extra,
      });
      if (answer.ok) return adopt(answer);
      if (answer.error === "no-such-room") {
        forget();
        return false;
      }
      /*
       * Anything refused is corrected by taking the server's word for the room, never by retrying.
       * Whatever was being written was decided against a board that has since moved.
       */
      setError(answer.error ?? "unavailable");
      const fresh = await ask(`/${seated.key}?token=${encodeURIComponent(seated.token)}`);
      if (fresh.ok && fresh.room) setView(fresh.room);
      return false;
    },
    [adopt, forget, view],
  );

  const play = useCallback((shot: Shot) => write("/shot", { shot }), [write]);
  const again = useCallback(async () => {
    await write("/rematch");
  }, [write]);
  const give = useCallback(async () => {
    await write("/resign");
  }, [write]);

  const leave = useCallback(async () => {
    const seated = seatedRef.current;
    forget();
    if (seated) await ask(`/${seated.key}/leave`, { token: seated.token });
  }, [forget]);

  /* The poll. Its interval is the feature's latency and its request rate at the same time. */
  useEffect(() => {
    if (phase !== "in" || !view) return;
    const seated = seatedRef.current;
    if (!seated) return;

    const mine = view.seat;
    const waitingForGuest = view.present.a === "empty" || view.present.b === "empty";
    const ourTurn = mine !== null && turnOf(view) === mine;
    const every = waitingForGuest
      ? WAITING_FOR_A_GUEST_MS
      : ourTurn
        ? OUR_TURN_MS
        : WAITING_FOR_THEM_MS;

    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      const answer = await ask(`/${seated.key}?token=${encodeURIComponent(seated.token)}`);
      if (stop) return;
      if (answer.error === "no-such-room") {
        forget();
        return;
      }
      if (answer.ok && answer.room) setView(answer.room);
    };

    const timer = setInterval(tick, every);
    const wake = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [phase, view, forget]);

  return {
    phase,
    view,
    seat: view?.seat ?? null,
    error,
    create,
    join,
    play,
    again,
    give,
    leave,
  };
}

/**
 * Whose flick it is, from the shot list alone.
 *
 * The turn alternates from whoever started, so it needs no state of its own. Deriving it here keeps
 * the poll from having to trust a field that could disagree with the shots beside it.
 */
export function turnOf(view: RoomView): Seat {
  const started = view.first;
  return view.shots.length % 2 === 0 ? started : started === "a" ? "b" : "a";
}
