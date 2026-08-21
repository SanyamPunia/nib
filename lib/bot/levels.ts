/**
 * The three opponents.
 *
 * Difficulty here is not search depth, because there is no tree to search. A flick is three
 * numbers and the simulation will tell you exactly where any of them lands, so a bot that draws
 * enough candidates and keeps the best one plays close to perfectly. That is unbeatable and no
 * fun, so difficulty is mostly calibrated miss: how many shots it considers, and how far its
 * hand slips from the one it picked.
 *
 * The errors matter more than the sample count. A hundred samples with a shaky hand still loses
 * to twenty with a steady one, which is also true of the game itself.
 */
export type LevelName = "easy" | "medium" | "hard";

export interface Level {
  /** Candidate flicks considered. */
  samples: number;
  /** Sideways slip, as a fraction of the shot's own direction. */
  aim: number;
  /** Slip in strength, as a fraction of the chosen speed. */
  power: number;
  /** Slip in where along the pen the flick lands, in centimetres. */
  offset: number;
}

export const LEVELS: Record<LevelName, Level> = {
  easy: { samples: 18, aim: 0.32, power: 0.24, offset: 2.6 },
  medium: { samples: 70, aim: 0.12, power: 0.1, offset: 1.2 },
  hard: { samples: 200, aim: 0.035, power: 0.03, offset: 0.4 },
};

export const LEVEL_NAMES: readonly LevelName[] = ["easy", "medium", "hard"];
