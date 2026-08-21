"use client";

import { useCallback, useEffect, useRef } from "react";
import { drawBarrel } from "@/lib/draw/arena.ts";
import { readColors } from "@/lib/draw/colors.ts";
import { PEN_IDS, PENS, type PenId } from "@/lib/pens.ts";
import { PEN_DIAMETER, PEN_LENGTH } from "@/lib/sim/constants.ts";
import { cn } from "@/lib/utils.ts";

/**
 * How much of the pen a preview shows, in centimetres, measured back from the tip.
 *
 * A whole pen at this size is a line with a dot on the end: fourteen centimetres in sixty pixels
 * leaves the tip, the collar and the grip seam all inside two pixels of each other. The tip and a
 * short run of barrel is the part a pen is actually recognised by, and at this crop it is large
 * enough to read.
 */
const SHOW = 3.6;
const WIDTH = 54;
const HEIGHT = 19;

function PenPreview({ id }: { id: PenId }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const colors = readColors(canvas);
    const scale = WIDTH / SHOW;
    const half = PEN_LENGTH / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    /*
     * Centimetres in, device pixels out, shifted so the crop starts at the left edge. The rest of
     * the barrel is drawn off the side of the canvas and clipped, which is cheaper than teaching
     * `drawBarrel` about crops and keeps the preview drawing the same object as the desk does.
     */
    ctx.setTransform(
      scale * dpr,
      0,
      0,
      -scale * dpr,
      -(half - SHOW) * scale * dpr,
      (HEIGHT / 2) * dpr,
    );
    drawBarrel(ctx, PENS[id], colors.pens[id], colors, half, PEN_DIAMETER / 2, 1 / scale);
  }, [id]);

  useEffect(() => {
    draw();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => requestAnimationFrame(draw);
    media.addEventListener("change", refresh);
    return () => media.removeEventListener("change", refresh);
  }, [draw]);

  return (
    <canvas
      ref={ref}
      style={{ width: WIDTH, height: HEIGHT }}
      className="pointer-events-none select-none"
    />
  );
}

interface PenPickerProps {
  chosen: PenId;
  /** Id of the visible label that names this group. Supplied by whatever lays the row out. */
  labelledBy: string;
  onChoose: (id: PenId) => void;
}

/**
 * The pen catalogue, as a row of previews.
 *
 * Each is its own small canvas rather than an image, so a pen has exactly one drawing in the whole
 * project and a new model needs no asset.
 *
 * No names are shown. Six labels under six previews is a paragraph, and one label for the chosen
 * pen sat at the end of the row reading as a seventh option. The previews are the point, the
 * highlighted one says which is chosen, and every name is on its own control for anyone who needs
 * it read out.
 *
 * The controls are real radio inputs behind their labels, not buttons wearing `role="radio"`. An
 * input cannot contain a canvas, so the canvas sits beside it in the label, and the group gets
 * arrow-key navigation and correct semantics without anything being asserted by hand.
 *
 * The group is named by a label the caller owns, because that label is a cell in the caller's grid.
 * A legend of its own would either duplicate it or break the alignment that makes the row readable.
 */
export function PenPicker({ chosen, labelledBy, onChoose }: PenPickerProps) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start"
    >
      {/*
       * Three by two on a phone, one row on anything wider. Letting it wrap freely put five on one
       * line and the sixth alone underneath, which reads as an accident rather than a set.
       */}
      <div className="grid grid-cols-3 place-items-center gap-1 sm:flex sm:items-center">
        {PEN_IDS.map((id) => (
          <label
            key={id}
            title={PENS[id].name}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-md p-1",
              "transition-all duration-150",
              "has-focus-visible:ring-2 has-focus-visible:ring-focus-ring",
              id === chosen ? "bg-desk" : "opacity-55 hover:bg-desk-hover hover:opacity-100",
            )}
          >
            <input
              type="radio"
              name="pen"
              value={id}
              checked={id === chosen}
              onChange={() => onChoose(id)}
              aria-label={PENS[id].name}
              className="sr-only"
            />
            <PenPreview id={id} />
          </label>
        ))}
      </div>
    </div>
  );
}
