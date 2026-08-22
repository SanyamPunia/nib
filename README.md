# nib

A very small pen fight game. Two pens on a desk, a flick each in turn, and you lose when your pen
goes off the edge. Against a bot at three difficulties, or a friend on the same
screen.

The whole product is a single screen. The camera looks straight down, so a pen reads as a round
object through the shading across its own short axis and the shadow underneath it, and the desk is
drawn as a slab with one visible edge because the game is about falling off one.

## Running it

```bash
pnpm install
pnpm dev
```

`pnpm check` is the gate: lint, typecheck, tests, build. `pnpm verify` runs the built app in a real
browser and asserts against the live canvas, at a desktop and a phone viewport. Run it after
`pnpm build`.

There is no configuration and there are no environment variables. The whole game runs in the
browser.

## What is in here

Everything the game needs is written in this repository.

- **The simulation.** Two capsules on a plane, Coulomb friction against the desk, one contact
  between them, and an out-of-bounds test on the centre of mass, so a pen resting half off the desk
  comes free from the model. It is deterministic to the last bit: no transcendental functions
  anywhere in the step loop, because `sin` and `cos` are not specified to the last bit by IEEE-754
  and differ between JavaScript engines. A heading is a unit vector turned by adding a perpendicular
  step, never an angle. It is also exactly symmetric under swapping the pens and mirroring the desk,
  which is the transformation that turns one player's position into the other's.
- **The flick.** Pull back and let go. The indicator is an arrow along the launch and a wake along
  the drag, so the hand and the shot each get half of it, and neither half predicts where the pen
  will stop. Where along the pen you take hold is where the push lands, so a flick near a tip
  tumbles, and it costs speed: the middle of the pen is where the distance is and the ends are where
  the spin is.
- **The bot.** No tree. A flick is three numbers and the simulation says exactly where any of them
  lands, so it draws candidates, rolls each out to rest and keeps the best. Two hundred rollouts is
  three milliseconds, which is why it runs on the main thread. Difficulty is calibrated miss rather
  than depth, applied to the chosen shot so a weak opponent understands the position and fails to
  execute.
- **The pens.** Six models, previewed as a tip and a short run of barrel, drawn through the same
  function the desk uses so a preview cannot drift from what it advertises. They differ in markings
  only, never in size or mass: the drawing must not lie about the collision shape, and both players
  have to be playing the same game.
- **The sound.** Two noises, the pens meeting and winning. The knock is one of nine recordings
  picked at random and nudged a few percent off pitch, so the same clip twice does not read as the
  same collision twice, and its volume comes from the impulse the simulation measured. The
  simulation also says which frame each collision landed on, so a knock is heard on the frame it is
  drawn on. Every clip is trimmed to its transient and normalised on the way in: the knocks arrived
  with between 65ms and 175ms of leading silence, a spread that would have read as the sound being
  broken rather than late, and the win arrived 11dB quieter than the rest. Trimming happens in the
  decoded samples, because the containers understate their own length and every approach that
  trusted them destroyed a clip while leaving it playable.
- **The picture.** No animation library and no 3D. Depth is a gradient across a pen's short axis and
  a shadow under it. The desk has a grain built from one noise tile generated from a fixed seed, so
  it is the same on every machine and does not reshuffle when the window resizes. On a tall screen
  the whole picture turns a quarter turn and the simulation never hears about it.

Two dependencies were considered and measured away: a physics engine, which brings a broadphase and
an island solver for a problem with one pair of bodies and none of it written to be reproducible
across engines, and a 3D renderer, which would be more code than the whole of the drawing layer for
a picture that is deliberately flat.

## Layout

```
app/                layout, page, globals.css with every colour token
components/game/    the one feature: the arena, the match, the controls
components/ui/      the button primitive
lib/sim/            the simulation. Pure, no React, no colour
lib/match/          turns, legal flicks, and what ends a match
lib/bot/            the opponent. Pure, no React
lib/draw/           canvas drawing, and the desk-to-pixels mapping
lib/pens.ts         the pen catalogue
scripts/verify.mjs  drives the built app in Chrome and asserts against the canvas
```

`CLAUDE.md` holds the project rules, including the invariants the simulation is built on and the
decisions that were reversed on the way. `PLAN.md` is the plan of record: what is built, what is
next, and the questions still open.
