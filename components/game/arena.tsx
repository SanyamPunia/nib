"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  type Aim,
  arenaScale,
  type Celebration,
  drawArena,
  toWorld,
  type Viewport,
} from "@/lib/draw/arena.ts";
import { type Colors, readColors } from "@/lib/draw/colors.ts";
import { makeBurst } from "@/lib/draw/confetti.ts";
import { PENS, type PenId } from "@/lib/pens.ts";
import { MIN_LAUNCH_SPEED, PEN_DIAMETER, PEN_LENGTH } from "@/lib/sim/constants.ts";
import { maxSpeedAt } from "@/lib/sim/pen.ts";
import type { Frame, Side } from "@/lib/sim/types.ts";
import { closestOnAxis, length } from "@/lib/sim/vec.ts";

/** Centimetres per second of launch speed per centimetre pulled back. */
const DRAG_TO_SPEED = 17;
/** How far from a pen counts as taking hold of it. Generous, because a finger is wide. */
const GRAB_MARGIN = 2.6;
/**
 * Floor on that reach in CSS pixels, whatever the desk has shrunk to.
 *
 * The margin above is in centimetres of desk, which is the right unit for a game that has to feel
 * the same at any size. It is the wrong unit for a fingertip: on a small screen those centimetres
 * are a couple of dozen pixels and a thumb is nearer forty across. This only ever widens the target
 * and only on a desk small enough to need it.
 */
const MIN_GRAB_PX = 30;
const FRAME_MS = 1000 / 60;
/** How long a win is celebrated for. Short, because the burst is meant to snap. */
const BURST_MS = 1000;
const BURST_COUNT = 56;

interface ArenaProps {
  /** What to draw while nothing is moving. */
  resting: Frame;
  /** A shot to play through. Playing one locks out input until it finishes. */
  playback: readonly Frame[] | null;
  /** Whose flick it is, and so which pen can be taken hold of. */
  turn: Side;
  interactive: boolean;
  /** Which pen model each side is using. Cosmetic only, see `lib/pens.ts`. */
  models: Record<Side, PenId>;
  /** The winner, once there is one. Runs the burst, and changing it runs it again. */
  won: Side | null;
  /** Varied between wins so two bursts in a row are not the same burst. */
  wonSeed: number;
  onFlick: (vx: number, vy: number, offset: number) => void;
  onPlaybackEnd: () => void;
}

interface Drag {
  pointerId: number;
  /** Where the pull started, on the desk. */
  x: number;
  y: number;
  /**
   * Where along the pen it was taken hold of, as a signed distance from its centre.
   *
   * Fixed at the moment of the grab and never recomputed. The pointer leaves the pen as soon as
   * the pull begins, so anything derived from where it is now would slide the push along the pen
   * while the player aimed.
   */
  offset: number;
}

/**
 * The desk, and every pointer that touches it.
 *
 * Nothing here is React state. A drag updates on every pointer event and a playback updates
 * sixty times a second, and putting either through a re-render would spend a whole component
 * tree on redrawing one canvas. The aim, the drag, the palette and the frame on screen all live
 * in refs. React is told only when a flick has actually been played.
 *
 * **The canvas hears the press. The window hears everything after it.**
 *
 * Only `pointerdown` is a canvas handler. Move, release and cancel are all on the window, and
 * that is the fix for the longest-running bug this component had. Pulling back carries the
 * cursor away from the pen and, once the pen is anywhere near its own edge, clean off the canvas
 * element. Pointer capture is supposed to keep delivering to the canvas anyway, and it can be
 * refused or dropped, at which point moves simply stop arriving and the aim freezes where the
 * cursor crossed the boundary. It looks exactly like the drag being thrown away, and it happens
 * at the moment the player needs the longest pull.
 *
 * Capture is still requested, because it keeps the cursor consistent, but nothing depends on it.
 */
export function Arena({
  resting,
  playback,
  turn,
  interactive,
  models,
  won,
  wonSeed,
  onFlick,
  onPlaybackEnd,
}: ArenaProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<Viewport>({ width: 0, height: 0, dpr: 1 });
  const colorsRef = useRef<Colors | null>(null);
  const frameRef = useRef<Frame>(resting);
  const aimRef = useRef<Aim | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const burstRef = useRef<Celebration | null>(null);
  /*
   * The chosen models and whose flick it is are read through refs so `paint` keeps no
   * dependencies. It is called from the pointer handlers and from both animation loops, and a
   * `paint` that changed identity whenever the turn or a pen changed would tear down and rebuild
   * every one of those subscriptions.
   */
  const modelsRef = useRef(models);
  const activeRef = useRef<Side | null>(null);

  /*
   * `onFlick` changes identity on every render of the parent, and the handlers below are attached
   * to the window. Reading it through a ref keeps those subscriptions from being torn down and
   * rebuilt mid-drag, which is the one moment they have to survive.
   */
  const onFlickRef = useRef(onFlick);
  useEffect(() => {
    onFlickRef.current = onFlick;
  }, [onFlick]);

  useEffect(() => {
    modelsRef.current = models;
    activeRef.current = interactive ? turn : null;
    paintRef.current();
  }, [models, interactive, turn]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const colors = colorsRef.current;
    if (!canvas || !colors) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawArena(
      ctx,
      viewRef.current,
      {
        frame: frameRef.current,
        aim: aimRef.current,
        won: burstRef.current,
        models: { a: PENS[modelsRef.current.a], b: PENS[modelsRef.current.b] },
        active: activeRef.current,
      },
      colors,
    );
  }, []);

  /* So the effect above can repaint without taking `paint` as a dependency. */
  const paintRef = useRef(paint);
  paintRef.current = paint;

  const show = useCallback(
    (frame: Frame) => {
      frameRef.current = frame;
      paint();
    },
    [paint],
  );

  /**
   * End whatever drag is open, playing its shot or throwing it away.
   *
   * Idempotent, so it does not matter how many times or from where it is called.
   */
  const endDrag = useCallback(
    (fire: boolean) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      const aim = aimRef.current;
      aimRef.current = null;
      paint();
      if (!fire || !aim) return;
      if (length(aim.vx, aim.vy) < MIN_LAUNCH_SPEED) return;
      onFlickRef.current(aim.vx, aim.vy, aim.offset);
    },
    [paint],
  );

  /** Turn a client point into a point on the desk. Works for a native or a React event alike. */
  const pointAt = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return toWorld(viewRef.current, clientX - rect.left, clientY - rect.top);
  }, []);

  const applyMove = useCallback(
    (pointerId: number, clientX: number, clientY: number, buttons: number) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== pointerId) return;

      /* No button held means the release happened somewhere nothing told us about. */
      if (buttons === 0) {
        endDrag(false);
        return;
      }

      const point = pointAt(clientX, clientY);
      if (!point) return;

      /*
       * The pen goes the opposite way to the hand. Pull it back and let go, the way a catapult
       * works and the way a finger loads against a pen before it lets fly.
       *
       * The arrow is drawn along this launch and the wake along the drag, so the hand and the
       * shot each get their own half of the indicator. That separation is the whole reason the
       * hand can go one way while the pen goes the other without the control reading as
       * inverted: the drag is not unrepresented, it is the half of the picture pointing back at
       * the player.
       */
      const launchX = drag.x - point.x;
      const launchY = drag.y - point.y;
      const reach = length(launchX, launchY);
      if (reach < 1e-6) {
        aimRef.current = null;
        paint();
        return;
      }

      /*
       * The cap depends on where the pen was taken hold of. A flick near a tip spends part of
       * itself turning the pen, so it cannot be as fast, and the arrow stops growing sooner to
       * say so rather than promising a speed the simulation will refuse.
       */
      const speed = Math.min(reach * DRAG_TO_SPEED, maxSpeedAt(drag.offset));
      aimRef.current = {
        side: turn,
        vx: (launchX / reach) * speed,
        vy: (launchY / reach) * speed,
        offset: drag.offset,
      };
      paint();
    },
    [endDrag, paint, pointAt, turn],
  );

  /* Size the backing store to the device, and repaint whenever the box changes. */
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      viewRef.current = { width: rect.width, height: rect.height, dpr };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      colorsRef.current = readColors(canvas);
      paint();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [paint]);

  /*
   * Follow the theme.
   *
   * The palette is read off the element, so it is only as fresh as the last time it was read,
   * and a resize observer does not fire when a colour changes. Without this the page around the
   * canvas switches theme and the desk stays whatever it was drawn as, which is a dark slab
   * sitting on a light page.
   */
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      /* One frame later, so the new custom property values have been resolved. */
      requestAnimationFrame(() => {
        colorsRef.current = readColors(canvas);
        paint();
      });
    };
    media.addEventListener("change", refresh);
    return () => media.removeEventListener("change", refresh);
  }, [paint]);

  /* Everything after the press is heard on the window. See the note on this component. */
  useEffect(() => {
    const move = (event: PointerEvent) =>
      applyMove(event.pointerId, event.clientX, event.clientY, event.buttons);
    const finish = () => endDrag(true);
    const cancel = () => endDrag(false);
    const blurred = () => endDrag(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", blurred);

    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", blurred);
    };
  }, [applyMove, endDrag]);

  /*
   * Repaint the rest position when it changes, but never while a shot is playing. The committed
   * position arrives before the animation of the shot that produced it has finished, and drawing
   * it would snap both pens to their final places mid-flight.
   */
  useEffect(() => {
    if (playback) return;
    show(resting);
  }, [resting, playback, show]);

  useEffect(() => {
    if (!playback || playback.length === 0) {
      if (playback) onPlaybackEnd();
      return;
    }

    aimRef.current = null;
    dragRef.current = null;
    let raf = 0;
    const started = performance.now();

    const tick = (now: number) => {
      const index = Math.floor((now - started) / FRAME_MS);
      if (index >= playback.length) {
        const last = playback.at(-1);
        if (last) show(last);
        onPlaybackEnd();
        return;
      }
      const frame = playback[index];
      if (frame) show(frame);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playback, onPlaybackEnd, show]);

  /*
   * The burst. It starts when a winner appears, which is after the shot that decided it has
   * finished playing, so it never overlaps the animation of its own cause.
   */
  useEffect(() => {
    if (!won || playback) {
      burstRef.current = null;
      return;
    }
    const flecks = makeBurst(wonSeed * 2654435761 + (won === "a" ? 1 : 2), BURST_COUNT);
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = (now - started) / BURST_MS;
      if (progress >= 1) {
        burstRef.current = null;
        paint();
        return;
      }
      burstRef.current = { side: won, flecks, progress };
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      burstRef.current = null;
    };
  }, [won, wonSeed, playback, paint]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    /*
     * Anything still open is over, and this runs before every early return below. A press that
     * misses the pen used to leave the previous drag in place, and since a mouse reuses one
     * pointer id, the next move carried on measuring from that stale grab point.
     */
    endDrag(false);
    if (!interactive || playback) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;

    /*
     * Distance to the pen's spine, clamped to its ends, so any part of it can be taken hold of:
     * a tip, the middle, anywhere along it. Measuring to the centre instead would leave a
     * fourteen-centimetre object with a three-centimetre handle in the middle of it.
     */
    const pose = frameRef.current[turn];
    if (pose.out) return;
    const along = closestOnAxis(
      point.x,
      point.y,
      pose.x,
      pose.y,
      pose.ux,
      pose.uy,
      PEN_LENGTH / 2,
    );
    const reach = length(
      point.x - (pose.x + pose.ux * along),
      point.y - (pose.y + pose.uy * along),
    );
    const scale = arenaScale(viewRef.current);
    const grabbable = Math.max(
      PEN_DIAMETER / 2 + GRAB_MARGIN,
      scale > 0 ? MIN_GRAB_PX / scale : 0,
    );
    if (reach > grabbable) return;

    dragRef.current = {
      pointerId: event.pointerId,
      x: point.x,
      y: point.y,
      offset: along,
    };

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Nothing depends on capture. Moves come from the window either way. */
    }
  };

  return (
    <div ref={wrapRef} className="size-full">
      <canvas
        ref={canvasRef}
        aria-label="the desk, with both pens on it"
        role="img"
        className={interactive && !playback ? "cursor-grab" : "cursor-default"}
        onPointerDown={onPointerDown}
      />
    </div>
  );
}
