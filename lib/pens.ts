/**
 * The pens a player can choose from.
 *
 * **Every model is the same object to the simulation.** Fourteen centimetres long, one across,
 * same mass, same inertia. A model changes the markings on the barrel and nothing else. Two
 * reasons, and both are hard rules:
 *
 * - The drawing must not lie about the collision shape. A marker drawn fatter than it collides
 *   would miss shots the player watched it reach, and no amount of art is worth that.
 * - Both players have to be playing the same game. A pen that was cosmetically different and
 *   physically different is a pen that wins more, and choosing one would stop being a choice.
 *
 * So the variety is all in the tip, the grip, the bands and the gloss. That turns out to be
 * plenty, because those are the parts a real pen is recognised by.
 */
export type PenId = "slate" | "brick" | "graphite" | "forest" | "amber" | "plum";

export interface PenModel {
  id: PenId;
  name: string;
  /** Length of the tapered tip, in centimetres. */
  tip: number;
  /** How blunt that tip is. Zero comes to a point, one is cut flat across. */
  blunt: number;
  /** The grip section, measured from the butt end. Null for a barrel with no grip. */
  grip: { from: number; to: number } | null;
  /** Width of the lighter collar behind the tip. Zero for none. */
  ferrule: number;
  /** A seam where the grip ends. */
  collar: boolean;
  /** A band around the butt. */
  capBand: boolean;
  /** Strength of the gloss line, zero to one. */
  gloss: number;
}

export const PENS: Record<PenId, PenModel> = {
  slate: {
    id: "slate",
    name: "Slate",
    tip: 1.2,
    blunt: 0.2,
    grip: { from: 0.8, to: 3.8 },
    ferrule: 0.45,
    collar: true,
    capBand: true,
    gloss: 0.3,
  },
  brick: {
    id: "brick",
    name: "Brick",
    tip: 1,
    blunt: 0.35,
    grip: { from: 0.6, to: 4.4 },
    ferrule: 0.3,
    collar: true,
    capBand: false,
    gloss: 0.24,
  },
  /* A pencil. Long conical point, bare barrel, ferrule at the other end. */
  graphite: {
    id: "graphite",
    name: "Graphite",
    tip: 2.2,
    blunt: 0.12,
    grip: null,
    ferrule: 0,
    collar: false,
    capBand: true,
    gloss: 0.1,
  },
  /* A marker. Cut flat, long rubber grip, wide collar. */
  forest: {
    id: "forest",
    name: "Forest",
    tip: 0.9,
    blunt: 0.6,
    grip: { from: 1.2, to: 5.2 },
    ferrule: 0.7,
    collar: true,
    capBand: true,
    gloss: 0.18,
  },
  /* A gel pen. Fine point and the shiniest barrel in the set. */
  amber: {
    id: "amber",
    name: "Amber",
    tip: 1.4,
    blunt: 0.1,
    grip: { from: 0.5, to: 2.4 },
    ferrule: 0.25,
    collar: false,
    capBand: false,
    gloss: 0.44,
  },
  /* A fountain pen. Grip set back from the nib, banded cap. */
  plum: {
    id: "plum",
    name: "Plum",
    tip: 1.1,
    blunt: 0.25,
    grip: { from: 2.2, to: 5 },
    ferrule: 0.55,
    collar: true,
    capBand: true,
    gloss: 0.34,
  },
};

export const PEN_IDS: readonly PenId[] = [
  "slate",
  "brick",
  "graphite",
  "forest",
  "amber",
  "plum",
];

/**
 * The only place a pen's identity becomes a class name.
 *
 * Written out rather than built from the id, because Tailwind finds the classes it generates by
 * reading the source, and a name assembled at runtime is a name it never sees.
 */
export const PEN_DOT: Record<PenId, string> = {
  slate: "bg-pen-slate",
  brick: "bg-pen-brick",
  graphite: "bg-pen-graphite",
  forest: "bg-pen-forest",
  amber: "bg-pen-amber",
  plum: "bg-pen-plum",
};

/**
 * The pen the other side is left holding once this side takes `chosen`.
 *
 * Two identical pens on one desk is a board nobody can read, so keeping the two apart is a
 * constraint rather than a nicety. Both sides choose from the same six, so the clash is a real one
 * and not a corner case: taking the pen the other side is holding is a trade, and they get the one
 * that was just put down. Handing them the first free model instead would quietly undo a choice
 * somebody had already made.
 *
 * The invariant holds either way round, because the two are never the same to begin with.
 */
export function tradedFor(chosen: PenId, mine: PenId, theirs: PenId): PenId {
  return theirs === chosen ? mine : theirs;
}
