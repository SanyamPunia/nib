# PLAN

What is built, what is next, and the questions that are still open. Read `CLAUDE.md` first
for the rules this works under.

## Built

- **The simulation.** Two capsules on a plane, Coulomb friction against the desk, one
  contact between them with restitution and friction, and an out-of-bounds test on the centre
  of mass. Deterministic, pure, and covered by tests for symmetry under swapping the players,
  exact rest, no energy gain, and a slide distance checked against the friction constant.
- **Match rules.** Alternating flicks, three endings, and a refusal for a flick played out of
  turn, after the match is decided, at the wrong edge, or too softly to count.
- **The arena.** A canvas drawing the desk as a slab and each pen as a shaded capsule with a
  grip and a tip, playing a shot back at sixty frames a second. Follows the system theme.
- **Input.** Take hold of your pen, pull away from where you want it to go, release. A
  catapult, not a swipe. Power comes from the pull length and is capped. The indicator is an
  arrow along the launch plus a quiet wake along the drag, so the hand and the shot each get
  their own half of it. Neither half predicts where the pen will stop.
- **Any direction is playable.** Including straight at your own edge, which loses. There is a
  floor on launch speed, so nobody can pass by flicking nothing, and the arrow appears at exactly
  that floor: anything the player can see, they can play.
- **Where you grab decides the spin.** Any part of the pen can be taken hold of, and that point
  is the offset the flick is applied at. Through the middle it goes straight, near a tip it
  tumbles. Pushing off centre costs speed, so the middle is where the distance is and the ends
  are where the spin is.
- **Hotseat, and a bot.** Two players on one screen, or one of three bots. The bot samples
  candidate flicks, rolls each out to rest and keeps the best. Three milliseconds at the hardest
  level, and deterministic, so a bot match stays replayable from its shot list alone.
- **Six pens to choose from,** previewed as a tip and a short run of barrel. Models differ in
  markings only, never in size or mass, so the choice is cosmetic and both players keep identical
  physics. Taking the opponent's model moves them off it.
- **Whose turn it is shows on the pen.** A very faint bloom in the pen's own colour, under the pen
  rather than on it.
- **It plays on a phone.** The picture turns a quarter turn on a tall screen while the simulation
  stays exactly as it was, touch targets have a floor in pixels, and the footer stacks. Checked at a
  phone viewport in `pnpm verify`, including that a pen can be taken hold of and flicked there.
- **The opponent reads as two kinds of choice.** A person in the room on one side of a hairline, the
  bot's three strengths on the other, each marked with its own icon. One radiogroup still.
- **The settings only appear before a match.** They go away on the first flick and stay away on a
  result, which offers one thing: another match. That brings them back.
- **The footer is organised.** Match state on its own line, settings below it in an aligned
  label-and-control grid.
- **A win is celebrated.** A short burst of slivers in the winner's colours, from the middle of
  the desk. It clears itself.
- **A collision makes a noise.** Nine recordings, picked at random and detuned a few percent, at a
  volume taken from the impulse the sim measured. The sim reports which frame each collision landed
  on, so the knock is heard on the frame it is drawn on.
- **A win makes one too.** It starts with the burst, so neither overlaps the shot that caused them,
  and it plays once per win however many times the window is resized under it.
- **The gates.** `pnpm check` for lint, types, tests and build. `pnpm verify` drives the built app in
  Chrome and asserts forty-odd things a unit test cannot see, at a desktop and a phone viewport.

## Next, in order

1. **The last two sounds.** Pen against pen and winning are built, see below. The flick itself and
   a pen going off the edge are not, and both are the same shape of work: the sim already knows when
   a shot is launched and when `checkOut` fires, so each needs an event out of `run.ts` and a clip.
   The launch is the harder call of the two, because it happens under the player's own hand and a
   sound there can feel like lag.

2. **Replay in a link.** The strongest idea left. The simulation is deterministic
   and a shot is four numbers, so a whole match is a handful of bytes: the side that started
   plus a list of shots. A shared link replays the actual match rather than showing a picture
   of the end of it. Quantise each shot on the way in so the encoded form is the shot, and the
   sender and the receiver cannot round differently.

## Open questions

- **Whether the three bots are spaced right.** Easy, medium and hard differ in how many shots
  they consider and how badly their hand slips. The slip numbers were picked, not measured, and
  nobody has yet lost to hard often enough to say whether it is hard.
- **Whether one-shotting should be reachable at all.** Top speed is set so a full opening flick stays
  on the desk, which leaves it pushing the other pen about 4.5cm of the 11 it needs. The opening is
  therefore always about position. That may be exactly right, or it may make the first two flicks
  feel like a formality.
- **Whether the offset trade is tuned right.** Holding the push's energy constant makes a tip
  flick worth about half the distance of a centre one. That ratio falls out of the pen's mass and
  inertia rather than being chosen, and it decides how often a player gives up distance for spin.
  It has not been played enough to know.
- **A stalemate rule.** Two cautious players can flick forever. There is a shot counter on the
  match and no cap on it. A cap needs an ending that does not feel arbitrary.
- **Both pens off.** Currently a loss for whoever took the shot, on the grounds that they
  chose the power. A draw is the other defensible reading.
- **Whether the arena should shrink.** The desk is 40 by 28 centimetres with the pens 18 apart
  and 11 behind each. It leaves a visible empty middle. That gap is also what makes the
  opening shot a real judgement, so it should not be closed on the strength of a screenshot.
  Decide it by playing.
- **Restitution.** 0.35 gives the struck pen about four times the slide of the pen that hit
  it, which makes a clean knock-off comfortably achievable without following your own pen off.
  It has not been checked against a real pen on a real desk.

## Deliberate omissions

- No physics engine and no 3D renderer. `CLAUDE.md` says why.
- No accounts, no leaderboard, no tournament. A leaderboard is a different product from a
  single quiet screen, and it is worth being clear which one this is before anything is built
  towards it.
- No trajectory prediction in the aim guide, ever. Judging the shot is the game.
- **No online play.** It was built end to end, over a four-character code and a Redis, and then
  removed. Rooms had to be polled, because a route handler is `(Request) => Response` and that
  signature cannot take over a connection, so the opponent's flick arrived a poll interval after the
  round trip that stored it. Making your own flick optimistic fixed half of it and was measured: the
  first frame moved from 1675ms after release to 42ms with the request held for 1.5 seconds. The
  other screen still waited over two seconds, and no interval short enough to fix that is one this
  can afford to poll at. For a game whose whole loop is a single flick, that is the wrong feel. If it
  returns it returns on a connection that can push.
