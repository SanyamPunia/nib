import { LEVEL_NAMES, type LevelName } from "./bot/levels.ts";
import { PEN_IDS, type PenId } from "./pens.ts";
import type { Side } from "./sim/types.ts";

/** Who you are playing. A person in the room, or the bot at one of its three strengths. */
export type Opponent = "human" | LevelName;

export interface Setup {
  opponent: Opponent;
  models: Record<Side, PenId>;
}

/** Where the choices are kept, alongside the mute under its own key. */
const STORE = "nib:setup";

function isPen(value: unknown): value is PenId {
  return typeof value === "string" && (PEN_IDS as readonly string[]).includes(value);
}

function isOpponent(value: unknown): value is Opponent {
  if (value === "human") return true;
  return typeof value === "string" && (LEVEL_NAMES as readonly string[]).includes(value);
}

/**
 * The remembered setup, or null when there is nothing usable to remember.
 *
 * Every field is checked rather than cast. Storage is the one input to this app a person can edit
 * by hand, and a pen id that is not in the catalogue would reach `PENS[id]` and draw nothing at
 * all. The two pens being different is checked for the same reason it is enforced when they are
 * picked: two identical pens is a board nobody can read.
 *
 * Call this from an effect and never while rendering. The server has no storage, so a value read
 * during render would make the first paint disagree with the markup it hydrates.
 */
export function readSetup(): Setup | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE);
  } catch {
    /* A browser with storage refused. There is nothing to remember and nothing to report. */
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { opponent, a, b } = parsed as Record<string, unknown>;
    if (!isOpponent(opponent) || !isPen(a) || !isPen(b) || a === b) return null;
    return { opponent, models: { a, b } };
  } catch {
    return null;
  }
}

/**
 * Remember a setup.
 *
 * Called from the handler that made the choice, never from an effect watching the value. A write
 * that runs because a render happened is a write that can run before the first read, and what it
 * would save over the remembered choices is the defaults.
 */
export function writeSetup(setup: Setup): void {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({ opponent: setup.opponent, a: setup.models.a, b: setup.models.b }),
    );
  } catch {
    /* A private window will forget. Not worth failing over. */
  }
}
