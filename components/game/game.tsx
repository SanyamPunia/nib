"use client";

import { RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { chooseShot } from "@/lib/bot/choose.ts";
import { LEVEL_NAMES, type LevelName } from "@/lib/bot/levels.ts";
import { applyShot, type Match, newMatch, other, replay } from "@/lib/match/rules.ts";
import { distinctFrom, PEN_DOT, PENS, type PenId } from "@/lib/pens.ts";
import { frameOf } from "@/lib/sim/frame.ts";
import { canonicalShot } from "@/lib/sim/shot.ts";
import type { Frame, Side } from "@/lib/sim/types.ts";
import { cn } from "@/lib/utils.ts";
import { Arena } from "./arena.tsx";
import { PenPicker } from "./pen-picker.tsx";
import { RoomControls } from "./room-controls.tsx";
import { turnOf, useRoom } from "./use-room.ts";

/** Who the player is on this screen, and who the bot is when there is one. */
const YOU: Side = "a";
const BOT: Side = "b";

/**
 * A pause before the bot flicks.
 *
 * Not for the thinking, which takes three milliseconds at the hardest level. It is so a turn
 * changing hands is something the player sees happen.
 */
const BOT_PAUSE = 420;

type Opponent = "human" | LevelName | "room";

const OPPONENTS: readonly Opponent[] = ["human", ...LEVEL_NAMES, "room"];

const OPPONENT_LABEL: Record<Opponent, string> = {
  human: "Two players",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
  room: "Online",
};

interface State {
  /** The match on this screen. In a room the board comes from the room instead. */
  match: Match;
  /** The shot being animated, and the position it commits to once it has finished. */
  playing: { frames: readonly Frame[]; next: Match } | null;
  opponent: Opponent;
  models: Record<Side, PenId>;
}

function Dot({ pen, faint }: { pen: PenId; faint?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        PEN_DOT[pen],
        faint && "opacity-40",
      )}
    />
  );
}

/**
 * One match, on one screen.
 *
 * The committed position and the shot being animated are held in a single piece of state on
 * purpose. They are two views of the same moment, and keeping them apart let the board commit a
 * result while the flick that caused it was still in the air.
 *
 * A room replaces the board rather than the game. Everything below reads from one `match`, one
 * `models` and one `result`, and where those come from is the only thing a room changes.
 */
export function Game() {
  const [state, setState] = useState<State>(() => ({
    match: newMatch(),
    playing: null,
    opponent: "human",
    models: { a: "slate", b: "brick" },
  }));
  const { playing, opponent } = state;
  const room = useRoom();

  /** Shots already played out on screen. A room's board is the first this many of its list. */
  const [shown, setShown] = useState(0);
  const enteredRef = useRef<string | null>(null);

  const view = opponent === "room" && room.phase === "in" ? room.view : null;
  const inRoom = view !== null;

  /*
   * Walking into a room shows the board as it stands, rather than replaying the match from its first
   * flick. Joining a game in progress should look like sitting down at it.
   */
  useEffect(() => {
    if (!view) {
      enteredRef.current = null;
      return;
    }
    if (enteredRef.current !== view.key) {
      enteredRef.current = view.key;
      setShown(view.shots.length);
    }
  }, [view]);

  /* A rematch empties the shot list, so what has been shown has to come back with it. */
  useEffect(() => {
    if (view && view.shots.length < shown) setShown(view.shots.length);
  }, [view, shown]);

  const roomMatch = useMemo(
    () => (view ? replay(view.first, view.shots.slice(0, shown)) : null),
    [view, shown],
  );

  const match = roomMatch ?? state.match;
  const models = view ? view.pens : state.models;
  const resigned = view?.resigned ?? null;
  const result = match.result;
  const mySeat = view?.seat ?? null;
  const bothIn = view ? view.present.a !== "empty" && view.present.b !== "empty" : true;
  const settled = view ? shown === view.shots.length : true;
  const botTurn = opponent !== "human" && opponent !== "room" && match.turn === BOT && !result;

  const winner = resigned ? other(resigned) : (result?.winner ?? null);
  const over = Boolean(resigned || result);

  const canFlick = inRoom
    ? Boolean(mySeat) && bothIn && settled && !over && turnOf(view) === mySeat
    : !result;

  /* A room animates only what the server has confirmed, in the order it confirmed it. */
  useEffect(() => {
    if (!view || playing) return;
    if (view.shots.length <= shown) return;
    const base = replay(view.first, view.shots.slice(0, shown));
    const next = view.shots[shown];
    if (!base || !next) return;
    const applied = applyShot(base, next);
    if (!applied.ok) return;
    setState((s) => ({ ...s, playing: { frames: applied.shot.frames, next: applied.match } }));
  }, [view, shown, playing]);

  const onFlick = useCallback(
    (vx: number, vy: number, offset: number) => {
      if (playing) return;
      if (inRoom) {
        if (!mySeat) return;
        /*
         * Put into canonical form here as well as on the server, so what is checked locally is the
         * same four numbers the server will store and everyone will replay.
         */
        const shot = canonicalShot(mySeat, { side: mySeat, vx, vy, offset });
        if (!applyShot(match, shot).ok) return;
        void room.play(shot);
        return;
      }
      if (result) return;
      const applied = applyShot(match, { side: match.turn, vx, vy, offset });
      if (!applied.ok) return;
      setState((s) => ({
        ...s,
        playing: { frames: applied.shot.frames, next: applied.match },
      }));
    },
    [inRoom, match, mySeat, playing, result, room],
  );

  const onPlaybackEnd = useCallback(() => {
    setState((s) => {
      if (!s.playing) return s;
      /* In a room the board is the shot list, so finishing one only moves the marker along it. */
      if (s.opponent === "room") return { ...s, playing: null };
      return { ...s, match: s.playing.next, playing: null };
    });
    if (inRoom) setShown((n) => n + 1);
  }, [inRoom]);

  useEffect(() => {
    if (opponent === "human" || opponent === "room" || playing || result) return;
    if (state.match.turn !== BOT) return;
    const timer = setTimeout(() => {
      setState((s) => {
        if (s.opponent === "human" || s.opponent === "room" || s.playing) return s;
        if (s.match.result || s.match.turn !== BOT) return s;
        const shot = chooseShot(s.match.world, BOT, s.opponent, s.match.shots);
        const applied = applyShot(s.match, shot);
        if (!applied.ok) return s;
        return { ...s, playing: { frames: applied.shot.frames, next: applied.match } };
      });
    }, BOT_PAUSE);
    return () => clearTimeout(timer);
  }, [opponent, playing, result, state.match]);

  const startMatch = (next: Opponent) => {
    const first = result ? other(result.winner) : YOU;
    setState((s) => ({ ...s, match: newMatch(first), playing: null, opponent: next }));
  };

  const playAgain = () => {
    if (inRoom) {
      void room.again();
      return;
    }
    startMatch(opponent);
  };

  /* Cosmetic, so it never restarts a match. It does have to keep the two pens telling apart. */
  const choosePen = (id: PenId) => {
    setState((s) => ({ ...s, models: { a: id, b: distinctFrom(id, s.models.b) } }));
  };

  const resting = useMemo(() => frameOf(match.world), [match.world]);

  /*
   * Settings are for before a match, and nothing else. Not during one, because a match in progress
   * is something to lose. Not after one either, because a result is a moment to read and six
   * previews under it turn it into a form. Playing again brings them back.
   *
   * In a room the choice of opponent stays reachable, because leaving is how you get out.
   */
  const canChoose = inRoom ? true : match.shots === 0;

  return (
    <main className="safe-area flex h-dvh flex-col items-center">
      <div className="flex h-16 shrink-0 items-end gap-3 pb-2 text-sm text-ink">
        <span data-status className="flex h-7 items-center gap-2">
          {inRoom && !bothIn ? (
            <>
              <Dot pen={models[mySeat ?? "a"]} />
              <span>waiting for the other pen</span>
            </>
          ) : winner ? (
            <>
              <Dot pen={models[winner]} />
              <span>
                {resigned
                  ? "wins, they gave up"
                  : result?.ending === "self"
                    ? "wins on a self knock"
                    : "wins"}
                <span className="sr-only"> ({PENS[models[winner]].name})</span>
              </span>
            </>
          ) : (
            <>
              <Dot
                pen={models[match.turn]}
                faint={inRoom && view.present[match.turn] === "gone"}
              />
              <span>
                to flick
                <span className="sr-only"> ({PENS[models[match.turn]].name})</span>
              </span>
            </>
          )}
        </span>
        {over ? (
          <span className="flex h-7 items-center">
            <Button size="dense" variant="ghost" onClick={playAgain}>
              <RotateCcwIcon aria-hidden="true" className="size-3.5" />
              Again
            </Button>
          </span>
        ) : null}
      </div>

      <div className="min-h-0 w-full flex-1 px-3 pb-3 sm:px-4 sm:pb-4">
        <Arena
          resting={resting}
          playback={playing?.frames ?? null}
          turn={inRoom ? (mySeat ?? match.turn) : match.turn}
          interactive={!playing && canFlick && !botTurn}
          models={models}
          won={winner}
          wonSeed={match.shots}
          onFlick={onFlick}
          onPlaybackEnd={onPlaybackEnd}
        />
      </div>

      <footer className="flex h-52 w-full shrink-0 items-center justify-center px-3 sm:h-32">
        {canChoose ? (
          <div className="flex flex-col items-center gap-3 sm:grid sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-4 sm:gap-y-2">
            <div className="flex flex-col items-center gap-1 sm:contents">
              <span id="nib-opponent" className="text-xs text-ink-soft sm:justify-self-end">
                Opponent
              </span>
              <div
                role="radiogroup"
                aria-labelledby="nib-opponent"
                className="flex flex-wrap items-center justify-center gap-1 sm:justify-start"
              >
                {OPPONENTS.map((choice) => (
                  <Button
                    key={choice}
                    size="dense"
                    variant={choice === opponent ? "outline" : "ghost"}
                    role="radio"
                    aria-checked={choice === opponent}
                    onClick={() => {
                      if (choice === opponent) return;
                      if (inRoom) void room.leave();
                      startMatch(choice);
                    }}
                  >
                    {OPPONENT_LABEL[choice]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 sm:contents">
              <span id="nib-pen" className="text-xs text-ink-soft sm:justify-self-end">
                {opponent === "room" ? "Room" : "Your pen"}
              </span>
              {opponent === "room" ? (
                <RoomControls room={room} pen={state.models.a} />
              ) : (
                <PenPicker chosen={state.models.a} labelledBy="nib-pen" onChoose={choosePen} />
              )}
            </div>
          </div>
        ) : null}
      </footer>
    </main>
  );
}
