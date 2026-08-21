/**
 * Every limit a room has, in one file.
 *
 * The cap is the point of all of them. Five rooms is what stops a link somewhere busy turning into
 * a bill, and it is also the only way the feature can be taken from everybody at once, because
 * five requests with no account behind them can hold every slot. Two things answer that and both
 * are needed.
 *
 * A lease measures silence rather than age, so a room lives as long as somebody is in it and closes
 * a while after the last of them stops looking. And one caller may open only a few rooms an hour,
 * so the slots cannot be retaken the moment they free.
 */

/** Rooms alive at once, across everybody. */
export const MAX_ROOMS = 5;

/** How long a room survives with nothing happening in it. */
export const LEASE_MS = 30 * 60 * 1000;

/** Rooms one caller may open per window. */
export const CREATES_PER_WINDOW = 5;
export const CREATE_WINDOW_MS = 60 * 60 * 1000;

/** A seat is "here" within this, "away" within the next, and "gone" after that. */
export const HERE_MS = 12 * 1000;
export const AWAY_MS = 90 * 1000;
