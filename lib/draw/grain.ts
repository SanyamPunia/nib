/**
 * The desk's texture: one small tile of neutral noise, built once and repeated.
 *
 * A flat fill of a single colour is what makes a large surface read as a screen rather than as
 * a thing. A few specks of grain across it is enough to stop that, at a strength low enough
 * that nobody looking at the desk would say it had a texture.
 *
 * The specks are pure black and pure white carrying their own alpha, rather than colours taken
 * from the stylesheet. That is deliberate and is not a hole in the rule that colour lives in
 * one file: the tile has to sit on a near-white desk in one theme and a near-black one in the
 * other, and a neutral grain is the only fill that lightens and darkens by the same amount on
 * both. Nothing here is a palette choice, so there is nothing for a token to hold.
 *
 * The noise is generated from a fixed seed, so the desk has the same grain on every machine and
 * on every repaint. A texture that reshuffled itself whenever the window was resized would be a
 * distraction that appeared only when something else was happening.
 */

const TILE = 128;
/** Peak alpha of a single speck, out of 255. Higher than this and the desk looks dirty. */
const SPECK = 9;
/** Roughly how many device pixels across one speck should be. */
const SPECK_PIXELS = 1.6;

let tile: HTMLCanvasElement | null = null;
/*
 * The pattern is cached alongside the scale it was built for. This runs once per frame of every
 * shot, and a fresh CanvasPattern sixty times a second is an allocation the animation does not
 * need. The scale only changes when the window does.
 */
let cached: { pattern: CanvasPattern; pixelsPerCm: number } | null = null;

function build(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const image = ctx.createImageData(TILE, TILE);
  /* xorshift32 from a fixed seed. Deterministic, and the renderer needs nothing better. */
  let state = 0x9e3779b9;
  for (let i = 0; i < TILE * TILE; i++) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;

    /* Signed, so half the specks lighten the desk and half darken it. */
    const swing = (state % 2048) / 2048 - 0.5;
    const at = i * 4;
    const lit = swing > 0 ? 255 : 0;
    image.data[at] = lit;
    image.data[at + 1] = lit;
    image.data[at + 2] = lit;
    image.data[at + 3] = Math.round(Math.abs(swing) * 2 * SPECK);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * A repeating grain pattern, sized so one speck lands on about `SPECK_PIXELS` device pixels.
 *
 * The pattern is defined in whatever space the context is currently in, which here is desk
 * centimetres, so without the transform below one speck would cover a whole centimetre of desk.
 * Returns null when the canvas cannot make a pattern, and the caller simply skips the texture.
 */
export function grainPattern(
  ctx: CanvasRenderingContext2D,
  pixelsPerCm: number,
): CanvasPattern | null {
  if (cached && cached.pixelsPerCm === pixelsPerCm) return cached.pattern;
  tile ??= build();
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return null;
  const cmPerSpeck = SPECK_PIXELS / pixelsPerCm;
  pattern.setTransform(new DOMMatrix([cmPerSpeck, 0, 0, cmPerSpeck, 0, 0]));
  cached = { pattern, pixelsPerCm };
  return pattern;
}
