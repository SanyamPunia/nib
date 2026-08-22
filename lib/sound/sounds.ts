/**
 * Every noise the game makes, and the one thing it does that is felt rather than heard.
 *
 * Pens meeting, winning, and a short buzz on a phone when the pens meet. The buzz lives here
 * rather than in a module of its own because it has to answer to the same switch: somebody who
 * silences the game means stop doing things at me, not stop making noise specifically. One flag,
 * one call site, one thing to get wrong.
 *
 * One `AudioContext` for both, because a page needs only one and a second would be a second thing
 * to unlock. Everything here fails silently on purpose. A browser with no Web Audio, a file that
 * will not fetch, a context the platform refuses to start: none of them may throw into a playback
 * loop that is drawing the game. Sound is the last thing in this product that should be able to
 * break it.
 *
 * Every clip is normalised to about a decibel below full scale before it lands in `public/sound/`,
 * so the gain constants below are the whole volume control and are comparable with each other. The
 * win sound arrived 11dB quieter than the knocks and was lifted rather than given its own scale,
 * because two sets of gain numbers that mean different things is how the balance drifts.
 */

const KNOCKS = 9;

/**
 * Loudness of the hardest hit, as a share of the clip's own level.
 *
 * A third is about ten decibels down, which is audible on laptop speakers and does not carry across
 * a room.
 */
const KNOCK_MAX_GAIN = 0.32;
/** Loudness of the softest hit worth hearing, so a graze is a tap rather than nothing. */
const KNOCK_MIN_GAIN = 0.06;

/**
 * Loudness of a win.
 *
 * A shade above the hardest knock, because it is the one moment in a match worth marking and it
 * happens once. Not more than a shade: it plays under a burst that is already doing that job.
 */
const WIN_GAIN = 0.38;

/**
 * The impact strength that earns full volume.
 *
 * Measured rather than guessed. Across every legal flick from the opening position, impact strength
 * runs from 1.5% to 49% with a median of 12%, so mapping the full 0 to 1 range onto the gain range
 * would leave every real collision whispering. This is the 95th percentile: harder hits than this
 * exist and they all play at `KNOCK_MAX_GAIN`.
 */
const LOUD_AT = 0.35;

/**
 * Curve from strength to loudness.
 *
 * Below one, so quiet hits are lifted towards audible. Hearing is closer to logarithmic than
 * linear, and a linear ramp spends most of its range on differences nobody can hear.
 */
const LOUDNESS_CURVE = 0.6;

/**
 * How much a knock's pitch may wander, either way.
 *
 * Nine clips in a game that knocks several times a match is few enough to notice. A few percent of
 * detune is under the threshold for sounding wrong and well over the threshold for making the same
 * recording twice sound like two different collisions. The win sound is not detuned: it plays once
 * a match, so there is no repetition to hide, and a jingle off pitch sounds broken rather than
 * varied.
 */
const DETUNE = 0.06;

/**
 * Length of the buzz, in milliseconds, for the softest and the hardest hit.
 *
 * Both are short. A phone's motor takes a few milliseconds to spin up and a few more to stop, so
 * anything under about eight is felt as nothing, and anything over about thirty stops reading as
 * an impact and starts reading as a notification.
 */
const BUZZ_MIN_MS = 8;
const BUZZ_MAX_MS = 26;

/** Where the choice to silence the game is kept, so it survives a reload. */
const MUTE_STORE = "nib:muted";

interface Kit {
  ctx: AudioContext;
  /** One buffer per knock, filled as each arrives. A hole is a clip that failed to load. */
  knocks: (AudioBuffer | null)[];
  win: AudioBuffer | null;
}

let kit: Kit | null = null;
let starting = false;
/**
 * Whether the game is silent.
 *
 * Held here rather than in the component that draws the control, because this is the module that
 * has to obey it and there is exactly one answer for the whole page. React mirrors it for the icon.
 */
let muted = false;
/** The knock played last, so the same recording never lands twice running. */
let lastKnock = -1;
/** The win currently sounding, so two of them cannot overlap. */
let winPlaying: AudioBufferSourceNode | null = null;

function makeContext(): AudioContext | null {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

async function load(ctx: AudioContext, path: string): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await ctx.decodeAudioData(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Build the context and fetch the clips.
 *
 * Called from the first press on the desk, which is the gesture a browser wants before it will let
 * a page make a noise, and which is also a second or two before the earliest possible collision.
 * That gap is the whole reason this is separate from playing: decoding after the pens have already
 * met would miss the knock it was decoding for.
 */
export function primeSounds(): void {
  /* Nothing to fetch and no context to build for someone who has turned it off. Unmuting primes. */
  if (muted) return;
  if (kit || starting) {
    void kit?.ctx.resume().catch(() => {});
    return;
  }
  starting = true;

  const ctx = makeContext();
  if (!ctx) return;
  const built: Kit = {
    ctx,
    knocks: Array.from({ length: KNOCKS }, () => null),
    win: null,
  };
  kit = built;
  void ctx.resume().catch(() => {});

  for (let i = 0; i < KNOCKS; i++) {
    void load(ctx, `/sound/knock-${i + 1}.mp3`).then((buffer) => {
      built.knocks[i] = buffer;
    });
  }
  void load(ctx, "/sound/win.mp3").then((buffer) => {
    built.win = buffer;
  });
}

/** Start one buffer at a gain, and clean its nodes up afterwards. Returns the source, or null. */
function fire(
  active: Kit,
  buffer: AudioBuffer,
  gainValue: number,
  rate: number,
): AudioBufferSourceNode | null {
  try {
    const source = active.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;

    const gain = active.ctx.createGain();
    gain.gain.value = gainValue;

    source.connect(gain).connect(active.ctx.destination);
    source.start();
    /* Nothing holds a reference once it has played, so the graph does not grow over a match. */
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    return source;
  } catch {
    /* A sound nobody heard is not worth an exception. */
    return null;
  }
}

/** Which knock to play. Never the one before it, so a repeat cannot read as a stuck sound. */
function pick(ready: number[]): number {
  const choices = ready.length > 1 ? ready.filter((i) => i !== lastKnock) : ready;
  const from = choices.length > 0 ? choices : ready;
  return from[Math.floor(Math.random() * from.length)] as number;
}

/**
 * Buzz the phone, for as long as the hit was hard.
 *
 * Fails silently like everything else here, and on most machines it does nothing at all: iOS
 * Safari has no `vibrate` at all, and a desktop that has the method has no motor behind it. Both
 * of those are fine. Nothing checks what kind of device this is, because the presence of the
 * method is the only honest test available and a user agent string is not one.
 */
function buzz(level: number): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(Math.round(BUZZ_MIN_MS + (BUZZ_MAX_MS - BUZZ_MIN_MS) * level));
  } catch {
    /* A buzz nobody felt is not worth an exception. */
  }
}

/**
 * Play one knock, as hard as it was hit, and buzz for as long.
 *
 * `strength` is the sim's own 0 to 1 measure, straight out of `ShotResult.impacts`. Nothing here
 * decides how hard a collision was, only how loud and how long that should be.
 *
 * The buzz comes before the audio and does not depend on it. A phone that could not build an
 * `AudioContext`, or is sitting on a silent switch, can still be told the pens met.
 */
export function playKnock(strength: number): void {
  if (muted) return;
  const level = Math.min(Math.max(strength, 0) / LOUD_AT, 1) ** LOUDNESS_CURVE;
  buzz(level);

  const active = kit;
  if (!active) return;

  const ready: number[] = [];
  for (let i = 0; i < KNOCKS; i++) if (active.knocks[i]) ready.push(i);
  if (ready.length === 0) return;

  const index = pick(ready);
  const buffer = active.knocks[index];
  if (!buffer) return;
  lastKnock = index;

  fire(
    active,
    buffer,
    KNOCK_MIN_GAIN + (KNOCK_MAX_GAIN - KNOCK_MIN_GAIN) * level,
    1 + (Math.random() * 2 - 1) * DETUNE,
  );
}

/**
 * Play the win.
 *
 * Once, whatever calls it. The caller runs off an effect that can re-run for reasons that have
 * nothing to do with the match, so stopping whatever is already sounding is what keeps two copies
 * from stacking into something twice as loud.
 */
export function playWin(): void {
  const active = kit;
  if (muted || !active?.win) return;

  stopWin();
  const source = fire(active, active.win, WIN_GAIN, 1);
  winPlaying = source;
  if (source) {
    const done = source.onended;
    source.onended = (event) => {
      if (winPlaying === source) winPlaying = null;
      if (typeof done === "function") done.call(source, event);
    };
  }
}

/** Cut off a win that is still sounding. Silent if none is. */
function stopWin(): void {
  if (!winPlaying) return;
  try {
    winPlaying.stop();
  } catch {
    /* Already finished. */
  }
  winPlaying = null;
}

/**
 * Turn the sound off or on, and remember which.
 *
 * Muting stops a win that is still playing, because the one moment somebody reaches for this is
 * while a noise they did not want is coming out of the machine. Unmuting primes, since the click
 * that did it is the gesture a browser wants before a page may make a noise, and priming here is
 * what lets `primeSounds` skip the fetch entirely for someone who arrived muted.
 */
export function muteSounds(next: boolean): void {
  muted = next;
  /* Cut a buzz that is mid-pulse, for the same reason a win that is mid-play is stopped. */
  if (next && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(0);
    } catch {
      /* Nothing to stop. */
    }
  }
  try {
    localStorage.setItem(MUTE_STORE, next ? "1" : "0");
  } catch {
    /* A private window will forget. Not worth failing over. */
  }
  if (next) stopWin();
  else primeSounds();
}

/**
 * Apply the remembered choice and report it.
 *
 * Called from an effect rather than read while rendering. The server has no storage, so reading it
 * during render would make the first paint disagree with the markup it hydrates.
 */
export function restoreMute(): boolean {
  let stored = false;
  try {
    stored = localStorage.getItem(MUTE_STORE) === "1";
  } catch {
    stored = false;
  }
  muted = stored;
  return stored;
}
