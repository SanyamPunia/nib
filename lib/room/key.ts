/**
 * Room codes.
 *
 * Four characters from an alphabet with nothing ambiguous in it. No O against 0, no I against 1,
 * because the whole job of a code is to survive being read out loud across a room and typed back
 * by somebody else.
 *
 * Thirty-two to the fourth is about a million, against a handful of rooms alive at once, so a
 * collision is not the reason `create` retries. It retries because two callers can pick the same
 * code in the same instant, and the store settles that atomically.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 4;

export function newRoomKey(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  let key = "";
  for (const byte of bytes) {
    /*
     * The alphabet is exactly 32 long, so masking to five bits is uniform. Taking a remainder
     * against a length that is not a power of two would quietly favour the earlier letters.
     */
    key += ALPHABET[byte & 31];
  }
  return key;
}

/** Uppercased and stripped, because a code is read out loud and typed back however it lands. */
export function normaliseRoomKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isRoomKey(raw: string): boolean {
  if (raw.length !== LENGTH) return false;
  for (const character of raw) {
    if (!ALPHABET.includes(character)) return false;
  }
  return true;
}

/** A seat token. Long enough that guessing it is not a thing anybody tries. */
export function newSeatToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
