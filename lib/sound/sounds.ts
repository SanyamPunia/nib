/**
 * Every noise the game makes: pens meeting, and winning.
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

interface Kit {
  ctx: AudioContext;
  /** One buffer per knock, filled as each arrives. A hole is a clip that failed to load. */
  knocks: (AudioBuffer | null)[];
  win: AudioBuffer | null;
}

let kit: Kit | null = null;
let starting = false;
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
 * Play one knock, as hard as it was hit.
 *
 * `strength` is the sim's own 0 to 1 measure, straight out of `ShotResult.impacts`. Nothing here
 * decides how hard a collision was, only how loud that should be.
 */
export function playKnock(strength: number): void {
  const active = kit;
  if (!active) return;

  const ready: number[] = [];
  for (let i = 0; i < KNOCKS; i++) if (active.knocks[i]) ready.push(i);
  if (ready.length === 0) return;

  const index = pick(ready);
  const buffer = active.knocks[index];
  if (!buffer) return;
  lastKnock = index;

  const level = Math.min(Math.max(strength, 0) / LOUD_AT, 1) ** LOUDNESS_CURVE;
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
  if (!active?.win) return;

  if (winPlaying) {
    try {
      winPlaying.stop();
    } catch {
      /* Already finished. */
    }
    winPlaying = null;
  }
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
