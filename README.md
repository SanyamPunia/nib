# nib

A very small pen fight game. Two pens on a desk, a flick each in turn, and you lose when your pen
goes off the edge. Against a bot at three difficulties, a friend on the same screen, or a friend on
another one over a four-character code.

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

Rooms need a Redis, set as `REDIS_URL`, and a namespace, set as `REDIS_PREFIX`. Without the URL
everything else still works and the room controls say rooms are unavailable. The prefix has no
default and a missing one refuses to start, because every key the store writes is scoped by it and
so is the only thing it ever deletes in bulk.

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
- **The picture.** No animation library and no 3D. Depth is a gradient across a pen's short axis and
  a shadow under it. The desk has a grain built from one noise tile generated from a fixed seed, so
  it is the same on every machine and does not reshuffle when the window resizes. On a tall screen
  the whole picture turns a quarter turn and the simulation never hears about it.
- **The rooms.** Seven route handlers and a Redis. A room stores who flicked first and the flicks, so
  a whole match is a few hundred bytes and both sides rebuild the board by replaying it. The server
  validates every flick with the same rules the browser runs, the seat token decides whose pen moves
  rather than anything in the flick itself, and every write carries the version it was made against.
  Every rule sits in one pure module that knows about neither HTTP nor Redis, so the races that
  matter are tested in milliseconds against an in-memory store and then re-tested unchanged against
  the live one.

Two dependencies were considered and measured away: a physics engine, which brings a broadphase and
an island solver for a problem with one pair of bodies and none of it written to be reproducible
across engines, and a 3D renderer, which would be more code than the whole of the drawing layer for
a picture that is deliberately flat.

## Layout

```
app/                layout, page, globals.css with every colour token
app/api/rooms/      the room API, a handful of lines per route
components/game/    the one feature: the arena, the match, the controls
components/ui/      the button primitive
lib/sim/            the simulation. Pure, no React, no colour
lib/match/          turns, legal flicks, and what ends a match
lib/bot/            the opponent. Pure, no React
lib/room/           every rule a room has, plus the wire types both sides import
lib/draw/           canvas drawing, and the desk-to-pixels mapping
lib/pens.ts         the pen catalogue
scripts/verify.mjs  drives the built app in Chrome and asserts against the canvas
```

`CLAUDE.md` holds the project rules, including the invariants the simulation is built on and the
decisions that were reversed on the way. `PLAN.md` is the plan of record: what is built, what is
next, and the questions still open.
