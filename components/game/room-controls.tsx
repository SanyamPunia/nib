"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import type { PenId } from "@/lib/pens.ts";
import { isRoomKey, normaliseRoomKey } from "@/lib/room/key.ts";
import type { RoomError } from "@/lib/room/protocol.ts";
import type { RoomHandle } from "./use-room.ts";

/**
 * What a room says when it cannot do the thing.
 *
 * Every one of these is a sentence a player can act on. "Busy" and "wait a minute" are separated
 * because they are different situations: one is the game being full and the other is this browser
 * having asked too often, and telling somebody to wait when the answer is to try later is worse
 * than saying nothing.
 */
const SAID: Record<RoomError, string> = {
  "protocol-mismatch": "The game updated. Reload to carry on.",
  "no-such-room": "No room with that code.",
  "room-full": "That room already has two players.",
  "rooms-busy": "Every room is taken. Try again shortly.",
  "too-many-rooms": "That is a lot of rooms. Give it a minute.",
  "not-your-seat": "That is not your pen.",
  stale: "The board moved. Catching up.",
  "not-your-turn": "Not your flick yet.",
  "match-over": "That match has finished.",
  "too-soft": "Too gentle to count.",
  unavailable: "Rooms are unavailable right now.",
};

export function RoomControls({ room, pen }: { room: RoomHandle; pen: PenId }) {
  const [typed, setTyped] = useState("");
  const code = normaliseRoomKey(typed);
  const busy = room.phase === "working";

  if (room.phase === "in" && room.view) {
    return (
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
        <span className="text-xs text-ink-soft">Code</span>
        {/* Uppercase because it is read out loud and typed back, which is the one string here
            whose case carries meaning. */}
        <span className="font-mono text-sm tracking-widest text-ink uppercase">
          {room.view.key}
        </span>
        <Button size="dense" variant="ghost" onClick={() => void room.leave()}>
          Leave
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
      <Button size="dense" disabled={busy} onClick={() => void room.create(pen)}>
        New room
      </Button>
      <span className="text-xs text-ink-soft">or</span>
      <input
        value={typed}
        onChange={(event) => setTyped(event.target.value.slice(0, 4))}
        placeholder="Code"
        aria-label="Room code"
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="h-7 w-20 rounded-full border border-desk-edge bg-desk px-3 text-center text-xs uppercase tracking-widest text-ink transition-all duration-200 placeholder:text-xs placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      />
      <Button
        size="dense"
        disabled={busy || !isRoomKey(code)}
        onClick={() => void room.join(code, pen)}
      >
        Join
      </Button>
      {room.error ? <span className="text-xs text-ink-soft">{SAID[room.error]}</span> : null}
    </div>
  );
}
