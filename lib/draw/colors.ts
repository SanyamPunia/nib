import { PEN_IDS, type PenId } from "../pens.ts";

/**
 * The palette the canvas draws with, read off the page rather than held here.
 *
 * `globals.css` is the only place a colour is written down, and the canvas is not allowed an
 * exception to that. Reading the custom properties off a real element means the drawing follows
 * the theme for free, including a theme that changed after the page loaded.
 */
export interface PenPalette {
  body: string;
  grip: string;
}

export interface Colors {
  desk: string;
  deskEdge: string;
  deskDrop: string;
  shadow: string;
  /*
   * The lit and shaded edges of any pen, painted as a gradient across its short axis. This is the
   * whole of the arena's dimensionality: the camera looks almost straight down, so a pen is read
   * as round by its shading and by the shadow under it, not by perspective. Shared by every
   * model, because the light does not change when the pen does.
   */
  penSheen: string;
  penShade: string;
  pens: Record<PenId, PenPalette>;
}

const SURFACE: Record<
  "desk" | "deskEdge" | "deskDrop" | "shadow" | "penSheen" | "penShade",
  string
> = {
  desk: "--desk",
  deskEdge: "--desk-edge",
  deskDrop: "--desk-drop",
  shadow: "--shadow",
  penSheen: "--pen-sheen",
  penShade: "--pen-shade",
};

export function readColors(el: Element): Colors {
  const style = getComputedStyle(el);
  const read = (token: string) => style.getPropertyValue(token).trim();

  const pens = {} as Record<PenId, PenPalette>;
  for (const id of PEN_IDS) {
    pens[id] = { body: read(`--pen-${id}`), grip: read(`--pen-${id}-grip`) };
  }

  return {
    desk: read(SURFACE.desk),
    deskEdge: read(SURFACE.deskEdge),
    deskDrop: read(SURFACE.deskDrop),
    shadow: read(SURFACE.shadow),
    penSheen: read(SURFACE.penSheen),
    penShade: read(SURFACE.penShade),
    pens,
  };
}

/**
 * A token colour at a given opacity.
 *
 * Every token in the stylesheet is written as three-digit or six-digit hex, so this only has to
 * understand hex. It returns the input unchanged when it is not hex, which keeps a mistyped token
 * visible on the canvas instead of turning the shape transparent and leaving nothing to notice.
 */
export function alpha(hex: string, a: number): string {
  const raw = hex.startsWith("#") ? hex.slice(1) : "";
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join("") : raw;
  if (full.length !== 6) return hex;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
