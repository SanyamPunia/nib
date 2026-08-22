"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chooseShot } from "@/lib/bot/choose.ts";
import type { LevelName } from "@/lib/bot/levels.ts";
import { applyShot, type Match, newMatch } from "@/lib/match/rules.ts";
import { frameOf } from "@/lib/sim/frame.ts";
import type { Frame, Side } from "@/lib/sim/types.ts";

/** How long the desk sits untouched before it starts playing by itself. */
const IDLE_MS = 8000;
/** Between the flicks of a demonstration, so a turn changing hands is something you see. */
const FLICK_PAUSE = 460;
/** Between one demonstration ending and the next beginning. */
const RESTART_PAUSE = 1400;
/**
 * Flicks before a demonstration gives up and starts again.
 *
 * Two careful bots can circle each other for a very long time, and a demonstration that never
 * reaches a result is a demonstration of the least interesting part of the game.
 */
const MAX_FLICKS = 24;
/** Who plays it. Two different strengths, so it is a match rather than a mirror. */
const PLAYERS: Record<Side, LevelName> = { a: "medium", b: "hard" };

interface Demo {
  /** Bumped for each demonstration, so two of them from the same opening are not the same match. */
  run: number;
  match: Match;
  /** The flick being animated, and the position it commits to when it finishes. */
  playing: { frames: readonly Frame[]; next: Match } | null;
}

export interface Attract {
  running: boolean;
  /** What to draw between the demonstration's flicks. Null when it is not running. */
  resting: Frame | null;
  playback: readonly Frame[] | null;
  onPlaybackEnd: () => void;
}

function fresh(run: number): Demo {
  return { run, match: newMatch("a"), playing: null };
}

/**
 * The desk plays itself when nobody is playing on it.
 *
 * The opening screen is two pens lying still on a desk, and nothing on it says the desk can be
 * touched. This is what an arcade cabinet does with the same problem: after a while untouched, two
 * bots start a match in front of you and the screen demonstrates itself. The first press stops it.
 *
 * Three things it never does.
 *
 * **It never touches the real match.** The demonstration is a `Match` of its own, and what the
 * caller does with it is draw it. The moment it stops, the real resting position is drawn again
 * from state that was never modified.
 *
 * **It is silent.** The caller passes no impacts for these frames, so nothing knocks. A page that
 * started making noises at somebody who had not touched it would be a bug, and most browsers would
 * refuse it anyway for want of a gesture.
 *
 * **It does not run under `prefers-reduced-motion`.** Unprompted animation is exactly what that
 * setting is about, and this is the only animation in the product nobody asked for.
 */
export function useAttract(enabled: boolean): Attract {
  const [demo, setDemo] = useState<Demo | null>(null);
  const runRef = useRef(0);
  /** Assumed until the media query says otherwise, so nothing can animate before it is asked. */
  const [still, setStill] = useState(true);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setStill(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  /*
   * The countdown and the interactions that reset it, in one effect that owns its own timer.
   *
   * An earlier version counted interactions into state so a second effect could watch the number
   * and re-arm. That re-rendered the board on every press, including the press that takes hold of
   * a pen, and the board is built not to re-render there: a drag updates on every pointer event
   * and is drawn from refs precisely so that it costs no renders. Re-arming a timer is not state,
   * and this way it is not stored as any.
   *
   * The listeners exist only while a demonstration could run, so a match in progress carries none
   * of this at all.
   */
  useEffect(() => {
    if (!enabled || still) return;
    let timer = 0;
    const arm = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        runRef.current += 1;
        setDemo(fresh(runRef.current));
      }, IDLE_MS);
    };
    /* Setting it to null when it already is bails out inside React and costs no render. */
    const wake = () => {
      setDemo(null);
      arm();
    };

    arm();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [enabled, still]);

  /* A flick, a result, or an opened panel all end it at once rather than after the next frame. */
  useEffect(() => {
    if (!enabled) setDemo(null);
  }, [enabled]);

  /* One flick at a time, and a fresh match once this one is decided or has gone on too long. */
  useEffect(() => {
    if (!demo || demo.playing) return;

    if (demo.match.result || demo.match.shots >= MAX_FLICKS) {
      const timer = setTimeout(() => {
        runRef.current += 1;
        setDemo(fresh(runRef.current));
      }, RESTART_PAUSE);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setDemo((current) => {
        if (!current || current.playing || current.match.result) return current;
        const side = current.match.turn;
        const shot = chooseShot(
          current.match.world,
          side,
          PLAYERS[side],
          current.run * 97 + current.match.shots,
        );
        const applied = applyShot(current.match, shot);
        if (!applied.ok) return current;
        return { ...current, playing: { frames: applied.shot.frames, next: applied.match } };
      });
    }, FLICK_PAUSE);
    return () => clearTimeout(timer);
  }, [demo]);

  const onPlaybackEnd = useCallback(() => {
    setDemo((current) =>
      current?.playing ? { ...current, match: current.playing.next, playing: null } : current,
    );
  }, []);

  /* Memoised, because the arena repaints when this changes identity and not only when it differs. */
  const resting = useMemo(() => (demo ? frameOf(demo.match.world) : null), [demo]);

  return {
    running: demo !== null,
    resting,
    playback: demo?.playing?.frames ?? null,
    onPlaybackEnd,
  };
}
