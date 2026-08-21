"use client";

import { CheckIcon, RotateCcwIcon, SlidersHorizontalIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { chooseShot } from "@/lib/bot/choose.ts";
import { LEVEL_NAMES, type LevelName } from "@/lib/bot/levels.ts";
import { applyShot, type Match, newMatch, other } from "@/lib/match/rules.ts";
import { distinctFrom, PEN_DOT, PENS, type PenId } from "@/lib/pens.ts";
import { frameOf } from "@/lib/sim/frame.ts";
import type { Frame, Side } from "@/lib/sim/types.ts";
import { cn } from "@/lib/utils.ts";
import { Arena } from "./arena.tsx";
import { PenPicker } from "./pen-picker.tsx";

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

type Opponent = "human" | LevelName;

const OPPONENTS: readonly Opponent[] = ["human", ...LEVEL_NAMES];

const OPPONENT_LABEL: Record<Opponent, string> = {
  human: "Two players",
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

interface State {
  /** The match on this screen. */
  match: Match;
  /** The shot being animated, and the position it commits to once it has finished. */
  playing: { frames: readonly Frame[]; next: Match } | null;
  opponent: Opponent;
  models: Record<Side, PenId>;
}

/** The collapsed label. A separator is an element, never a middot character. */
function Summary({ parts }: { parts: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {parts.split("|").map((part, index) => (
        <span key={part} className="flex items-center gap-1.5">
          {index > 0 ? (
            <span
              aria-hidden="true"
              className="inline-block size-1 shrink-0 rounded-full bg-ink-soft"
            />
          ) : null}
          {part}
        </span>
      ))}
    </span>
  );
}

function Dot({ pen }: { pen: PenId }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", PEN_DOT[pen])}
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
 * Everything below reads from one `match`, one `models` and one `result`. There is no second source
 * for any of them and no server in this product at all.
 */
export function Game() {
  const [state, setState] = useState<State>(() => ({
    match: newMatch(),
    playing: null,
    opponent: "human",
    models: { a: "slate", b: "brick" },
  }));
  const { playing, opponent, match, models } = state;

  const result = match.result;
  const botTurn = opponent !== "human" && match.turn === BOT && !result;
  const winner = result?.winner ?? null;
  const over = Boolean(result);

  const onFlick = useCallback(
    (vx: number, vy: number, offset: number) => {
      if (playing || result) return;
      const applied = applyShot(match, { side: match.turn, vx, vy, offset });
      if (!applied.ok) return;
      setState((s) => ({
        ...s,
        playing: { frames: applied.shot.frames, next: applied.match },
      }));
    },
    [match, playing, result],
  );

  const onPlaybackEnd = useCallback(() => {
    setState((s) => (s.playing ? { ...s, match: s.playing.next, playing: null } : s));
  }, []);

  useEffect(() => {
    if (opponent === "human" || playing || result) return;
    if (state.match.turn !== BOT) return;
    const timer = setTimeout(() => {
      setState((s) => {
        if (s.opponent === "human" || s.playing) return s;
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

  /* Cosmetic, so it never restarts a match. It does have to keep the two pens telling apart. */
  const choosePen = (id: PenId) => {
    setState((s) => ({ ...s, models: { a: id, b: distinctFrom(id, s.models.b) } }));
  };

  const resting = useMemo(() => frameOf(match.world), [match.world]);
  const [setupOpen, setSetupOpen] = useState(false);

  /*
   * There is one thing to do on this screen, and it is flick a pen.
   *
   * Everything else is a once-a-session decision, and for a long time all of it sat open at the
   * bottom at once: an opponent to pick from four and a pen to pick from six, side by side and
   * permanently, for choices a player makes twice an evening. No amount of aligning them fixed
   * that, because the problem was never where they sat. It was that they were all there at all.
   *
   * So they are behind one control that says what the current setup is. Collapsed, the bottom of the
   * screen holds a single thing to interact with. Opened, it holds the choices and nothing else.
   */
  const canSetUp = !playing && (match.shots === 0 || over);
  const summary = `${OPPONENT_LABEL[opponent]}|${PENS[models.a].name}`;

  return (
    <main className="safe-area flex h-dvh flex-col items-center">
      <div className="flex h-16 shrink-0 items-end gap-3 pb-2 text-sm text-ink">
        <span data-status className="flex h-7 items-center gap-2">
          {winner ? (
            <>
              <Dot pen={models[winner]} />
              <span>
                {result?.ending === "self" ? "wins on a self knock" : "wins"}
                <span className="sr-only"> ({PENS[models[winner]].name})</span>
              </span>
            </>
          ) : (
            <>
              <Dot pen={models[match.turn]} />
              <span>
                to flick
                <span className="sr-only"> ({PENS[models[match.turn]].name})</span>
              </span>
            </>
          )}
        </span>
        {over ? (
          <span className="flex h-7 items-center">
            <Button size="dense" variant="ghost" onClick={() => startMatch(opponent)}>
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
          turn={match.turn}
          interactive={!playing && !result && !botTurn}
          models={models}
          won={winner}
          wonSeed={match.shots}
          onFlick={onFlick}
          onPlaybackEnd={onPlaybackEnd}
        />
      </div>

      <footer className="flex min-h-14 w-full shrink-0 flex-col items-center justify-center gap-3 px-3 pb-1">
        {canSetUp ? (
          <>
            {/*
             * The panel grows and shrinks rather than appearing. Its height comes from the grid
             * row, so nothing has to measure how tall the choices are at any width.
             *
             * `minmax(0, ...)` and not a bare `fr`. A bare `1fr` means `minmax(auto, 1fr)`, and
             * that `auto` floor is the content's own minimum height, so the row never actually
             * collapses and a closed panel pushes the page taller than the window.
             *
             * It stays mounted so both directions animate, which means it has to be taken out of
             * reach while closed. A panel that is invisible but still focusable and still read
             * aloud is worse than one that pops.
             */}
            <div
              data-setup
              inert={!setupOpen}
              className={cn(
                "grid w-full transition-[grid-template-rows] duration-300 ease-out",
                "motion-reduce:transition-none",
              )}
              style={{ gridTemplateRows: setupOpen ? "minmax(0, 1fr)" : "minmax(0, 0fr)" }}
            >
              {/*
               * `relative` is load-bearing, not decoration. The pen radios are `sr-only`, which is
               * `position: absolute`, and an absolute box is only clipped by an ancestor that is
               * also its containing block. With every ancestor static, the radios took their
               * containing block from outside this clip and hung 67px below the fold, invisible
               * but still scrollable. Positioning the clip makes it their containing block.
               */}
              <div className="relative min-h-0 overflow-hidden">
                <div className="flex justify-center pb-1">
                  <div className="flex flex-col items-center gap-3 sm:grid sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-4 sm:gap-y-2">
                    <div className="flex flex-col items-center gap-1 sm:contents">
                      <span
                        id="nib-opponent"
                        className="text-xs text-ink-soft sm:justify-self-end"
                      >
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
                        Your pen
                      </span>
                      <PenPicker chosen={models.a} labelledBy="nib-pen" onChoose={choosePen} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* One control, so its width and position do not move when its label does. */}
            <Button
              size="dense"
              variant="ghost"
              aria-expanded={setupOpen}
              className="w-44"
              onClick={() => setSetupOpen(!setupOpen)}
            >
              {setupOpen ? (
                <>
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                  Done
                </>
              ) : (
                <>
                  <SlidersHorizontalIcon aria-hidden="true" className="size-3.5" />
                  <Summary parts={summary} />
                </>
              )}
            </Button>
          </>
        ) : null}
      </footer>
    </main>
  );
}
