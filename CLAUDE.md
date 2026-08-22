# CLAUDE.md

@AGENTS.md

@~/.claude/rules/base.md

@~/.claude/rules/frontend.md

@~/.claude/rules/typescript.md

## Project overview

nib, a minimal pen fight game. One desk, two pens, and a flick each in turn. You lose when
your pen goes off the desk. The whole product is a single screen, and the design goal is a
surface that says almost nothing and a simulation that is exactly right.

The picture is deliberately flat. The camera looks straight down, and a pen reads as a round
object through the shading across its own short axis and the shadow underneath it, not
through perspective. The desk is drawn as a slab with one visible near face, because the game
is about falling off an edge and the edge has to look like one.

## Rule 0, provenance hygiene, non-negotiable

**Nothing in this repository may name, link to, or identify any external product, site,
author, or project that informed its design.** This outranks every other rule in this file,
and it applies whether or not the repository is public.

Scope, with no exceptions: source code, comments and doc-strings, every markdown file
including this one, commit messages and bodies, branch and tag names, `package.json` fields,
page titles, metadata, Open Graph text, the favicon, file and directory names, CSS class
names, test fixture names, variable names, the deployment project name (it appears in the
deploy URL), and issue, pull request and release text.

In practice:

1. **Never use credit or lineage phrasing that points outward.** Describe what the code
   does, not what it resembles.
2. **Never copy path data, sprite sheets, or asset files from anywhere.** Every shape in this
   project is drawn here.
3. **Never add a credit, even a kind one.** The answer is a flat no, not a smaller mention.
4. **Design notes that need external context do not live here.** They live outside this
   directory entirely. Do not create a file here for them, and do not add a `.gitignore`
   entry for them either, because the ignore file is itself committed and the entry would
   name the thing it hides.

"Pen fight" is the name of a playground game and names no product, so the game itself can be
described plainly. The rule is about anything that would point at a particular existing
implementation of it.

If you are unsure whether a sentence leaks, delete the sentence.

## The simulation is the product

`lib/sim/` is the whole game. Everything else draws it or arranges turns around it. Four
things about it are load-bearing, and each one is enforced by a test.

1. **It is deterministic, and that is a hard constraint rather than a nicety.** A shot is
   four numbers, and both sides of a match resolve it by running the same code rather than by
   sending the outcome. Two consequences follow, and neither is optional:

   - **No transcendental functions anywhere in the step loop.** `sin`, `cos`, `tan`, `pow`
     and `atan2` are not specified to the last bit by IEEE-754 and their results differ
     between JavaScript engines. Only add, subtract, multiply, divide and `sqrt` are exact.
     A heading is therefore stored as a unit vector and turned by adding a perpendicular step
     and renormalising, never by rotating through an angle. See `step.ts`.
   - **No wall clock and no randomness.** The step is fixed at `DT` and is never a frame
     delta, or the outcome of a shot would depend on the refresh rate of the screen it was
     watched on.

2. **It is symmetric under swapping the pens and mirroring the desk.** That transformation is
   what turns one player's position into the other's, so if it is not an exact symmetry the
   two players are playing different games. It has already been broken once, by a collision
   routine that used whichever pen it was handed first as its reference. `run.test.ts` holds
   the test that caught it, and every new routine in `contact.ts` has to give the same answer
   with its arguments exchanged.

3. **A contact is one point, not two.** A flat broadside is the commonest collision in the
   game and it is tempting to give it a contact at each end of the overlap. Do not. Each
   point prices in a rotation that the pair cancels out, the impulse comes out about four
   times too small, and every collision resolves as if nothing bounced whatever
   `RESTITUTION` is set to. One point at the middle of the overlap carries the right
   effective mass, turns neither pen on a square hit and both on an offset one, and needs no
   solver iteration, because one contact is a one-line system with an exact answer.

4. **Rest is an exact state.** Friction subtracts a fixed amount per step and clamps, so a
   pen reaches exactly zero rather than approaching it. That is what gives a shot a definite
   end, and it is why `atRest` compares against zero and not against a tolerance. Never
   replace Coulomb friction with a drag proportional to speed.

`lib/sim/` holds no React, no I/O and no colour. It runs under `node --test` with nothing
booted, which is why the races and the geometry are tested in milliseconds.

## Top speed is set by one property, not by feel

`MAX_LAUNCH_SPEED` exists to make this true: **a full-power flick from the opening position, aimed at
the other pen, stays on the desk.** A first move at full power must not be a way to lose by accident.
There is 29cm of desk in front of a pen at the start and a full flick slides about 27.

It does not make full power safe in every direction, and no value can. From the opening a pen is 17cm
from the other pen but 11cm from its own edge and 14cm from the sides, so anything strong enough to
reach the opponent is more than strong enough to reach the player's own edge. That is arithmetic. A
full-power flick backwards or sideways leaves the desk, and should.

The same number sets how hard a hit lands, which is why it is not tuned separately. The struck pen
receives about 0.46 of whatever slide was left over after the travel to contact, so a full opening
shot pushes the other pen roughly 4.5cm of the 11 it needs. One-shotting from the opening is just out
of reach, and that is what makes the first few flicks about position rather than power.

Three tests in `run.test.ts` hold all of it. Anything that raises the top speed, lowers desk friction
or moves the pens has to be checked against them.

## The arena has no walls

A pen is out when its **centre of mass** leaves the arena, which is the condition under which
a real pen tips off a real desk. Nothing bounces off a boundary, and there is no code
anywhere that does. Between first overhanging the edge and losing its centre, a pen sits half
off the desk, which is the game's most recognisable moment and comes out of the model for
free.

The desk drawn on screen is exactly the arena, so the line a pen is lost across is the desk's
own edge. `MARGIN` in `lib/draw/arena.ts` is room to draw a pen that has already gone, not more
playing surface, and it is kept tight because every centimetre of it is screen the desk does not
get. A pen whose centre has just crossed the edge trails seven centimetres behind it and is drawn
faintly, so clipping the far end of a pen that is already out costs nothing.

On a portrait screen the desk is limited by width and leaves room above and below it. That is
inherent to a landscape arena and is not worth fixing by shrinking the desk on every other
screen.

## The pen goes the opposite way to the hand

Take hold of your pen, pull away from where you want it to go, release. A catapult, not a
swipe. Pull the left pen left and it flies right.

The indicator is what makes that readable, and it is two halves pointing opposite ways: the
**arrow** runs along the launch, and the **wake** runs along the drag, back towards the hand.
Both are needed. An arrow alone, pointing away from a hand that is moving the other way, reads
as an inverted control, and the first thing anybody says about it is that the direction is
backwards. The wake is not decoration, it is the half of the picture that accounts for where
the hand actually went.

Getting here cost three wrong turns, all from one misreading, so they are worth naming. Asked
to invert the indicator, the input mapping was inverted instead, which made the pen follow the
hand. Asked why the pen then went backwards, a rule was added forbidding backward shots. Asked
why a leftward drag drew an upward arrow, the leftover jitter was finally found. Only the third
of those was a real defect. Neither of the first two was the thing being asked for.

## Any part of the pen is a handle, and which part decides the spin

The grab test measures to the pen's spine clamped to its ends, so a tip works as well as the
middle. Measuring to the centre would leave a fourteen-centimetre object with a
three-centimetre handle in the middle of it.

Where along the pen the grab lands is `Shot.offset`, fixed at the moment of the grab and never
recomputed, because the pointer leaves the pen as soon as the pull starts and anything derived
from where it is now would slide the push along the pen while the player aimed. A flick through
the centre of mass goes straight. One near a tip tumbles.

**Pushing off centre costs speed, and that is a rule rather than a feel adjustment.**
`maxSpeedAt` in `lib/sim/pen.ts` holds the energy of the push constant instead of its momentum,
so a flick at the tip is worth about half the distance of one through the middle. Two reasons,
and the second is the one that would not survive being "simplified" away:

- It makes the offset a choice. The middle of the pen is where the distance is and the ends are
  where the spin is, and a player has to pick. Constant momentum would hand out the spin free.
- It keeps the spin drawable. Constant momentum gives a tip flick at full power about fourteen
  turns a second, which at sixty frames is over eighty degrees between frames. That does not
  read as a fast spin, it reads as a pen flickering, and past ninety degrees it would appear to
  rotate backwards.

The clamp is in `launch`, so it holds for a shot arriving from anywhere and a client cannot ask
for more. The input calls the same function, so the arrow stops growing at the same point and
never promises a speed the pen will not be given.

## There is no forbidden direction

A pen can be flicked any way at all, including straight at its own edge. That loses, and losing
on purpose is a move.

A forward-only rule lived here for a while, and it is worth recording because the reasoning for it
sounded good. It was added as the wrong answer to a different problem: with the input mapping
accidentally inverted, dragging backwards moved the pen backwards, and rather than un-inverting
the mapping a rule was added forbidding the shot. Fixing the mapping made the rule pointless, and
it stayed.

What it cost was not a tactic. It left the control **dead across half its range**. A real player
dragged past the pen, got a hundred pointer moves and three seconds of nothing drawn and nothing
played, and reported it as the drag being lost. A gesture that silently does nothing is a fault
whatever the reason for it, and a limit whose only benefit is removing a way to lose does not earn
one.

**An arrow appears exactly when there is a shot to play.** That is the rule that survived. The aim
is not drawn below `MIN_LAUNCH_SPEED`, and the rules refuse a flick below the same number, because
without a floor a player can flick nothing and hand the turn back and there is no passing in this
game. The two thresholds are deliberately the same: anything the player can see, they can play.

`FORWARD_X` still exists and the bot still prefers to flick across the centre line. That is a
preference and not a rule: spending samples on shots that lose outright makes a weaker opponent
than spending them on shots that might win.

## A drag that never ends is the worst state this component has

The aim freezes on screen, the pen cannot be taken hold of again, and the stale grab point
hijacks the next pointer move, so the arrow that comes back is measured from somewhere the hand
left long ago. It reads as the canvas having stopped responding, and it was reported as the aim
vanishing when pulling from a corner.

Four things allow it, and all four are guarded in `arena.tsx`:

1. **Listening for `pointermove` on the canvas only.** Pulling back carries the cursor away from
   the pen and, once the pen is near its own edge, off the element entirely. Capture is supposed to
   keep delivering moves to the canvas, and it can be refused or dropped, at which point the aim
   freezes where the cursor crossed the boundary. Move, release and cancel are all window handlers
   now and nothing depends on capture. Only `pointerdown` is a canvas handler.

2. **Listening for the release on the canvas only.** Pointer capture normally redirects a release
   back to the element, but capture can be refused or dropped, and a release landing outside the
   element then never arrives at all. `pointerup`, `pointercancel` and `blur` are handled on the
   **window**, and `endDrag` is idempotent so it does not matter how often or from where it runs.
   `blur` is needed because releasing the button after leaving the window produces no pointer
   event.
3. **Early returns in `pointerdown` that leave the previous drag standing.** A mouse reuses one
   pointer id, so a surviving drag captures the next move and measures from its old origin.
   `endDrag(false)` runs first, before any decision about whether a new drag starts.
4. **Trusting that a release was seen.** A `pointermove` with `event.buttons === 0` means it was
   not, and ends the drag.

Pulling from a tip is what surfaced this, because the grab starts seven centimetres nearer the
edge and the pull carries the cursor further out again.

Two related habits, both learned the hard way in `verify.mjs`. **Snapshot the idle canvas where
it is used, never once at the top**, or a check compares against a fingerprint taken several page
reloads ago. And **any check that reads the canvas after moving the pointer has to wait for the
repaint**, because the handler runs after the input command resolves. A probe without that wait
reported an arrow at every angle, when what it was seeing was the previous angle's arrow.

## The bot samples, it does not search

There is no tree here. A flick is three numbers and the simulation will say exactly where any of
them lands, so the bot draws candidates, rolls each one out to rest, and keeps the best. Two
hundred rollouts is three milliseconds, which is why it runs on the main thread and why there is
no worker.

Four things about it are load-bearing.

1. **It is deterministic, seeded from the position.** A match is meant to replay from nothing but
   the side that started and the list of flicks. If the bot rolled real dice, a bot match could
   not be replayed without recording every shot it played, and the shortest thing a shared link
   could carry would stop being the shots themselves. The same board, turn number and level always
   produce the same flick, and it still feels varied because the position is never the same twice.
   Being pure also makes it safe to call from a state updater React may run twice.

2. **Difficulty is calibrated miss, not depth.** A bot that draws enough candidates plays close to
   perfectly, which is unbeatable and no fun. `LEVELS` sets how many shots are considered and how
   far the hand slips. The slip matters more than the sample count.

3. **The slip is applied to the chosen shot, never to the candidates.** A weak opponent should
   understand the position and fail to execute, which is what a weak player looks like. Scattering
   the candidates instead produces something that cannot see, and that reads as broken rather than
   beatable.

4. **Losing outranks winning in the score.** The rules make taking both pens off a loss for
   whoever took the shot, so a bot that scored the two separately would trade its own pen for the
   win. Short of a result the score is the other pen's distance from an edge against its own room
   to spare, weighted two to one: their danger is worth more, but not much more, because the next
   flick is theirs.

`resolve` in `lib/sim/run.ts` exists for this. It is `runShot` without the frames, because
collecting a hundred poses per rollout would allocate tens of thousands of objects a turn to look
at none of them.

## Settings are for before a match, and nothing else

`canChoose` is `match.shots === 0`. That single condition covers both reasons.

**Not during a match.** A match in progress is something to lose, and switching opponent under the
player mid-match would either throw it away without asking or change who is holding a pen halfway
through. Making the control absent is the honest version of both, and it costs nothing the player
cannot get by finishing.

**Not after one either.** A result is a moment to read. Six previews and four chips underneath turn
it into a form. Playing again is the only thing worth offering there, and it brings the settings
back with it, because the new match has no flicks in it yet.

One thing follows from this and is relied on: **settings on screen always means no result**, because
a result cannot exist before a flick has been played. Nothing in that block has to ask about a
result, and the opponent chips do not need the guard they used to carry.

The footer keeps its height regardless. It is empty for most of a session now, and that is the right
trade: letting it collapse resizes the desk on the first flick of every match.

Adding a control to that block means deciding when it is absent, not only what it does.

### The panel grows, it does not appear

The choices open on a 300ms height animation rather than popping into place. Its height comes from a
grid row, so nothing has to measure how tall the choices are at any width:

```tsx
<div data-setup inert={!setupOpen} className="grid transition-[grid-template-rows]"
     style={{ gridTemplateRows: setupOpen ? "minmax(0, 1fr)" : "minmax(0, 0fr)" }}>
  <div className="relative min-h-0 overflow-hidden">{choices}</div>
</div>
```

Three parts of that are load-bearing, and each one was a bug first.

**`minmax(0, 0fr)` and never a bare `0fr`.** A bare `fr` means `minmax(auto, 1fr)`, and that `auto`
floor is the content's own minimum height. The row then never collapses. It reads as closed on a
desktop, where the desk has room to give up, and holds the page taller than the window on a phone.

**`relative` on the clip.** The pen radios are `sr-only`, which is `position: absolute`, and an
absolute box is only clipped by an ancestor that is also its containing block. With every ancestor
static, the radios took their containing block from outside the clip and hung 67px below the fold,
invisible but still scrollable. `pnpm verify` caught this, not a glance at the screen.

**`inert` while closed.** The panel stays mounted so both directions animate, which means it has to
be taken out of reach by hand. A panel that is invisible but still focusable and still read aloud is
worse than one that pops.

The trigger is one button whose label swaps rather than two that trade places, at a fixed width, so
neither its position nor its size moves when the panel opens.

Anything that measures the footer, the canvas, or a pen's position has to wait out the transition
first. `pnpm verify` has a `panelSettled()` for exactly that, and stale measurements have bitten
that file more than any other mistake.

**The button is the fixed point, so the footer is `justify-end` and never `justify-center`.**
Centring the stack meant the slack around the button shrank as the panel grew, which slid the button
6px down the screen as it opened, measured at both viewports. The one control on the screen has to
stay exactly where it was pressed. The footer keeps `min-h-14` so the closed height is unchanged and
a fixed `pb-2.5` so the button's distance from the bottom edge cannot vary, and the space the panel
needs comes out of the desk above it. `verify.mjs` asserts the button's box is identical open and
closed.

**The content fades and lifts in, on two timings rather than one.** Opening waits 100ms before the
content settles in over 200ms, so the desk has started giving the room up before anything appears in
it. Closing runs at once over 150ms, so the content is gone before the space shuts behind it. One
symmetric transition reads as the panel dragging its contents around with it. Both directions are
branched class strings on the inner box, and both are off under `motion-reduce`.

### One question, two kinds of answer

The opponent row is a person or the bot, and the bot has three strengths. Those were four chips in
one row, which read as four opponents of the same kind and made "Two players" look like a fourth
difficulty. They are now split by a hairline rule, with `UsersIcon` on the person and `BotIcon`
marking the three strengths.

Two details in that are deliberate. The rule is an element, never a glyph, per the shared rules. And
the three strengths sit in their own box at `gap-1` inside a row at `gap-2`, because at one gap the
bot icon sat nearer "Easy" than the rule and read as part of that chip rather than as a label for all
three.

It stays **one** radiogroup. The split is how it looks, not what it is: exactly one of the four is
the opponent, and a screen reader should hear one choice, not two.

### The pen catalogue is one row, at every width

Six columns on a phone, one flex row above `sm`. It was three by two, which cost a row of footer
height and left the catalogue far narrower than the opponent row above it, so two centred groups had
visibly different left edges. On a 390px phone the change takes the footer from 192px to 157px and
hands those 35px to the desk.

**The preview's backing store is always the desktop size, and CSS is what shrinks it.** Drawing
smaller would mean a second scale to keep in step with the desk's own. Scaling a larger drawing down
is supersampling, so the phone gets the sharper preview of the two.

**A grid, and a capped width rather than a fixed one.** Free wrapping put five previews on one line
and the sixth alone underneath, which reads as an accident. A fixed width overflows a 320px screen.
Six columns of `w-full max-w-11` shrink to whatever they are given, so the row cannot wrap and cannot
overflow: checked at 320px as well as 390px.

## Architecture

```
app/                    layout, page, globals.css, icon.svg
public/sound/           nine knock recordings and the win, normalised and trimmed
components/
  game/                 the one feature
    arena.tsx           the canvas, its pointer handling and its playback loop
    game.tsx            one match, and the only React state in the project
    pen-picker.tsx      the catalogue, previewed through the arena's own barrel drawing
  ui/button.tsx         the button primitive
lib/
  sim/                  the simulation. Pure, no React, no colour
    constants.ts        every tunable number, in one place
    vec.ts              scalar 2D helpers that do not allocate
    types.ts            Pen, World, Shot, Frame
    pen.ts              construction, setup, launch, the out-of-bounds test
    contact.ts          capsule against capsule, and the one contact point
    step.ts             friction, the impulse solve, integration
    run.ts              one flick to rest, with frames to draw or without
    frame.ts            the drawable part of a world
  pens.ts               the pen catalogue. Cosmetic only, and the one id-to-class map
  match/rules.ts        turns, which flicks are legal, and what ends a match
  bot/                  the opponent. Pure, no React
    levels.ts           the three difficulties
    choose.ts           draw candidate flicks, roll them out, keep the best
  sound/sounds.ts       the nine knocks and the win, on one audio context
  draw/                 canvas drawing. No React
    colors.ts           the palette, read off the page
    grain.ts            the desk's texture, one noise tile built once
    confetti.ts         the burst a win draws
    arena.ts            the whole scene, plus the desk-to-pixels mapping
  site.ts               name, description and origin. One place
  utils.ts              cn()
scripts/verify.mjs      drives the built app in a real browser
```

`lib/` holds no React. Hooks live with their feature in `components/game/`.

**The renderer never simulates.** `runShot` returns the frames, and `arena.tsx` plays them
back. A `Frame` carries position and heading and nothing else, specifically so that no
drawing code can be tempted to integrate anything. Frames are never sent anywhere either: a
shot is four numbers and the far side of a match replays it.

**Nothing in `components/game/arena.tsx` is React state.** A drag updates on every pointer
event and a playback updates sixty times a second, and putting either through a re-render
would spend a component tree on repainting one canvas. The aim, the drag, the palette and the
frame on screen all live in refs. React is told only when a flick has been played.

**The aim starts at the pen's surface, not its centre.** `surfaceReach` in
`lib/draw/arena.ts` works out where that is, from the point the pen was taken hold of. Drawing
the aim from the centre and letting the pen cover the overlap looks right for a shot across the
pen, where the shaft appears after half a centimetre, and falls apart for a shot along it, where
the shaft is buried for seven and all that shows is an arrowhead and a wake with nothing joining
them. It is unit tested, because the eye only catches it at the extremes.

**The desk's grain is neutral on purpose, and that is not a hole in the colour rule.** The tile
in `lib/draw/grain.ts` is pure black and pure white specks carrying their own alpha. It has to
sit on a near-white desk in one theme and a near-black one in the other, and a neutral grain is
the only fill that lightens and darkens by the same amount on both, so there is no palette choice
for a token to hold. It is generated from a fixed seed, because a texture that reshuffled itself
on every resize would be a distraction that appeared only when something else was happening.

**The canvas reads its colours off its own element.** `globals.css` is the only place a colour
is written down and the canvas gets no exception. It also has to re-read them when the theme
changes, because a resize observer does not fire when a colour does. `verify.mjs` asserts
that it does.

## A pen model changes markings and nothing else

`lib/pens.ts` holds the catalogue. Every model is the same object to the simulation: fourteen
centimetres long, one across, same mass, same inertia. What varies is the tip, the grip, the bands
and the gloss. Two reasons, and both are hard rules.

- **The drawing must not lie about the collision shape.** A marker drawn fatter than it collides
  would miss shots the player watched it reach, and no amount of art is worth that.
- **Both players have to be playing the same game.** A pen that was cosmetically different and
  physically different is a pen that wins more, and choosing one would stop being a choice.

That turns out to be plenty of variety, because the tip and the grip are what a real pen is
recognised by.

**The previews draw through `drawBarrel`, the same function the desk uses.** A preview with its own
drawing would drift from the pen it is advertising, and the drift would only show up after a player
had chosen on the strength of it. It is also why a new model needs no asset: there is one drawing
of a pen in this project.

**A preview shows the tip and a short run of barrel, not the whole pen.** Fourteen centimetres in
sixty pixels puts the tip, the collar and the grip seam within two pixels of each other.

**No two pens on a desk may be the same model.** `distinctFrom` moves the opponent off whichever
model the player takes. Two identical pens is a board nobody can read.

Colour lives in `globals.css` as one token pair per model, and `PEN_DOT` is the single place a pen
id becomes a class name. It is written out rather than assembled, because Tailwind finds the
classes it generates by reading the source and never sees a name built at runtime.

## The turn is shown on the pen, not only in the text

The pen to be flicked is very faintly lit in its own colour, so the cue needs no key and works the
same in a two-player match as against a bot. It sits *under* the pen rather than on it: a highlight
that changed the object would make the two pens look like different pens, and the player is
choosing between models on exactly that basis.

**Three stops, all of them faint.** The first version was two stops at four times this strength and
it read as the pen being selected in an interface rather than as a pen being lit. At this opacity
two stops band into a visible ring, which is the same problem in a quieter voice. What is wanted is
for the eye to find the pen without being told about it.

The status dot beside the text is keyed to the chosen model too, not to the side. Once a player can
pick a plum pen, a dot that stayed blue is a dot that is lying.

## The one flourish

A win throws a burst of slivers out from the middle of the desk, in the winner's own two colours.
Slivers rather than dots, because the game is two long thin objects on a desk. It borrows the
winner's palette, so the burst adds no colour the page did not already have. One second, and it
clears itself: a burst that stayed would leave marks on the desk for the next match to be played
around.

**It has to snap.** The first version spread a third as far over half again the time and read as a
smudge appearing near the middle of the desk rather than as anything being thrown. What fixed it
was not more pieces. It was throwing them all outward rather than spreading them evenly across a
disc, which is what leaves a pile in the middle, then getting them out fast, holding them at full
strength while they travel, and taking them away quickly at the end. Three quarters of the distance
is covered in the first third of the flight.

It runs only once the shot that decided the match has finished playing, so it never overlaps the
animation of its own cause. `verify.mjs` checks both that it appears and that it goes.

Accent is spent here and nowhere else. If a second flourish is ever wanted, take it from this one
rather than adding to it.

## Sound

Two noises. The pens meeting, and winning. No launch sound, no sound for a pen going off, no music.

**The sim says when, not the browser.** `step` returns the normal impulse on the step a contact
begins, `run.ts` turns that into `ShotResult.impacts` as a frame index plus a strength, and the
playback loop plays a knock when it passes that frame. The browser cannot work this out for itself:
it only ever sees poses, and two pens a millimetre apart on one frame and touching on the next look
identical from outside. The step that resolved the contact runs at 480Hz and the frames it is drawn
on run at 60.

**A collision is its onset, not its duration.** One collision spans more than one step, because the
overlap it leaves is corrected over the next few, so the pens are still touching while that happens.
Measured across every legal flick, the longest contact in the game is three steps. Without
`Manifold.touching` each of those reports its own impulse and one knock is heard three times. The
`touching` flag is not an optimisation, it is what makes an impact mean a collision.

**Strength is derived, not tuned.** The impulse over `PEN_MASS * MAX_LAUNCH_SPEED`, which is the
largest momentum a pen can carry, so retuning either constant carries through. There is a floor
under it, because two pens settling exchange a tiny impulse that nobody saw happen.

**The loudness curve was measured, and this is the part that would be got wrong.** Impact strength
across every legal flick runs from 1.5% to 49% with a median of 12%, so mapping the full 0 to 1
range onto a volume range leaves every real collision whispering. `LOUD_AT` is the 95th percentile
of real hits rather than the theoretical maximum. Anything retuning the physics should re-measure it.

**The clips were trimmed to their transient before anything else.** They arrived with between 65ms
and 175ms of leading silence. Late is bad on its own, and a spread between clips is worse: a knock
that lands at a different delay each time reads as broken rather than late. They now start within
3ms of each other. Anything added to `public/sound/` gets the same treatment.

**Trim in the decoded samples, never by seeking.** These files' containers lie about their own
length, by ten to thirty milliseconds and in one case by more, and two ffmpeg approaches that
trusted them both silently destroyed clips: `-to` before `-i` cut one to 60ms of its 139ms, and a
`-ss` seek landed 78ms past where it was asked to, straight through the transient the trim exists to
protect. Decode to PCM, find the first sample over the floor, cut there, and assert afterwards that
every clip still starts where it should. The assertion is the part that matters, because both
failures produced playable files that passed every other check.

**Every clip is normalised to about a decibel under full scale on the way in, so the gain constants
are the whole volume control and mean the same thing as each other.** The win sound arrived 11dB
quieter than the knocks. Playing it at a gain of 1 would have sounded about right and left the
codebase with two scales that read alike and are not, which is how a balance drifts the next time
either is touched. It was lifted on encode instead.

**The win sounds once per win, and the guard for that is not decoration.** Its effect re-runs
whenever the paint callback changes identity, which a resize and a theme change both do. The burst
restarting there is invisible; the sound restarting is the obvious bug in the feature. A ref holds
which win has been sounded, and `verify.mjs` resizes the window after a win and asserts nothing
played again.

**The pitch is nudged a few percent per knock.** Nine recordings in a game that knocks several times
a match is few enough to notice, and the detune is what makes the same clip twice sound like two
collisions. `verify.mjs` asserts the rate is never exactly 1.

**It fails silently, everywhere.** No Web Audio, a clip that will not fetch, a context the platform
refuses to start: every one of them is caught and dropped. Sound is the last thing in this product
that should be able to break a loop that is drawing the game.

**The context is built on the first press, not on load.** A browser wants a gesture before a page
may make a noise, and the press that grabs a pen is a second or two ahead of the earliest collision
it could be needed for. Decoding nine files after the pens have already met would miss the knock it
was decoding for.

**There is no mute control.** Nobody asked for one and the footer has been rebuilt enough times
already. If one is wanted, the argument against putting it in the setup panel is that the panel only
appears before a match and after one, so it could not silence the match you are in.

## On a phone the camera turns, not the desk

The arena is landscape and a phone is not. A flat desk on a tall screen is limited by width and
leaves most of the height empty, so `arenaRotated` draws the whole picture a quarter turn round and
the desk gets about a third more of the screen.

**The simulation never hears about it.** The arena stays forty by twenty-eight centimetres with the
pens at either end of its long axis, so the physics, the bot and the shot list are identical on
every device, and a match played on a phone replays the same on a desktop. That is not a detail: the
replay-in-a-link idea in `PLAN.md` depends on a shot meaning the same thing everywhere.

Three things follow from doing it this way:

- **The decision is measured, not asked.** Whichever way round makes the desk bigger wins, so there
  is no breakpoint to keep in step with the layout and no orientation media query to disagree with.
- **The transforms keep their handedness.** Both forms of `setTransform` have the same determinant,
  so a pen drawn through its own heading vector still turns the way the simulation says it does.
  Getting this wrong mirrors every pen and nothing else, which is easy to miss.
- **`toWorld` and `toCanvas` carry the rotation, so nothing else has to know.** Input, the previews
  and `verify.mjs` all go through them, which is why the phone checks in that script use the same
  world coordinates as the desktop ones and need no idea which way the desk ended up.

Which way the turn goes is fixed rather than arbitrary: the player's own end of the desk is at the
bottom of the screen, because the pen they reach for has to be the one nearest their hand.

## The page respects the phone's own edges

`.safe-area` in `globals.css` puts `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` on
`main`. Everything is border-box and the page is `h-dvh`, so that comes out of the height rather than
adding to it and the page still fills the window exactly.

The bottom keeps a floor of half a rem of its own, because the settings sit right on the edge of the
window otherwise. That is true on a phone with no home indicator and on a desktop as well, so it is
not really a safe-area concern at all, just somewhere the layout needed a little room.

**Dense chips carry less side padding than the other sizes.** A `ghost` chip has no visible box, so
its padding reads as gap: four of them in a row spread into unrelated words instead of one set of
choices, and only the selected one looked like a control at all.

The development indicator is moved to the top left in `next.config.ts`, because its default corner is
where the settings are. That is courtesy, not layout, and it does not exist in a build.

## A touch target has a floor in pixels

`GRAB_MARGIN` is in centimetres of desk, which is the right unit for a game that has to feel the
same at any size, and the wrong unit for a fingertip. On a small screen those centimetres come to a
couple of dozen pixels and a thumb is nearer forty across, so `MIN_GRAB_PX` widens the reach when
the desk has shrunk. It can only ever widen it.

Pulling back suits a thumb, as it happens. The finger moves away from the pen rather than sitting on
top of the thing being aimed, so the pen is only covered at the moment it is taken hold of.

## The match reads above the desk, the settings below it

Three bands, and which one a thing belongs to is decided by what it is about.

**Above:** the state of the match, and the one action that follows from it. It sits there because it
is about the desk, so it works as a caption, and because the board then separates it from the
settings far more strongly than any rule could. There was a hairline rule doing that job when both
sat below, and moving the status up made it redundant.

**Below:** settings only, in a two-column grid. Names right-aligned against a shared edge, controls
left-aligned against another.

That grid is the whole point of the lower band. The controls were on one line with the status once,
unlabelled and all at the same weight, and four unrelated things read as one sentence. A label column
costs two small words and turns a scatter into a list.

**Both control groups are `justify-start` on a wide screen, and that is load-bearing.** They were
`justify-center` first, which centres each group inside its column and destroys the shared left edge
the grid exists to create: one label was followed by two hundred pixels of nothing and the other by
thirty. Two rows of identical structure, two different geometries, and the whole thing read as
scattered again. Centring is right only on a phone, where the label sits above its controls and there
is no column to align to.

**Both bands have reserved height.** Letting either collapse resizes the desk, and a desk that
changes size when a match starts or ends is worse than a little empty space. The upper band is fixed
even though its content is short, because a result arrives with a button beside it.

**The upper band is bottom-aligned,** so its spare height sits above the caption rather than below
it. A caption belongs to the thing it describes. Centred in the band it read as a page title pinned
to the top of the window.

**The caption and its action are centred together, as one thing.** This was built the other way
first: three columns with the caption locked to the middle one and the action hanging off the right,
so the words never moved between states. That holds still the wrong thing. The eye reads the pair as
a single line, and pinning half of it puts the line itself off centre. The caption shifting left when
a result arrives is correct, because something arrived beside it.

**Both children carry the control height,** so their text sits on one baseline. Bottom-aligning a
bare line of text against a twenty-eight pixel button aligns the boxes and misses the text by four
pixels. Anything alignment-related here wants measuring rather than eyeballing: at a screenshot's
reduced scale a four pixel error is invisible, and both of these were reported by someone looking at
the real thing after being called done.

**On a phone each group stacks its name above its controls, and the previews go three by two.** The
`sm:contents` on each group is what lets one piece of markup be a stack on a narrow screen and a pair
of grid cells on a wide one, so the label column exists exactly where there is room for it. Letting
the previews wrap freely instead put five on one line and the sixth alone underneath, which reads as
an accident rather than as a set.

**No names under the previews.** Six labels is a paragraph, and one label for the chosen pen at the
end of the row read as a seventh option. The highlighted preview says which is chosen and every name
is on its own control for anyone who needs it read out.

**A selected chip or preview is marked by its background, not by a border.** A row of bordered boxes
reads as a row of things all equally selected, which is the opposite of what a selection is for.

## There is no online play, and it is not an oversight

It was built end to end and removed: seven route handlers, a Redis store behind a required key
prefix, a shot-list-as-match record, seat tokens, version compare-and-set, a global room cap, a
lease that measured silence, and a per-caller rate limit. All of it worked. It came out because of
one thing that none of it could fix.

**A room had to be polled.** A route handler is `(Request) => Response`, and that signature cannot
express taking over a connection, so there was no socket to be had. The opponent's flick therefore
arrived a poll interval after the round trip that stored it.

**Making your own flick optimistic fixed half of the problem and proved the other half.** The shot
was appended to the list locally and animated from there, which is safe here because the simulation
is deterministic: canonicalise the four numbers first and the server replays the identical flick.
Measured with the request deliberately held for 1.5 seconds, the first frame moved from 1675ms after
release to 42ms. The other screen still waited over two seconds, and it always would have. For a
game whose whole loop is one flick and a second of animation, that is the wrong feel.

Two things are worth keeping from it, because they are the parts that would be rebuilt:

- **A match is a shot list, not a board.** `newMatch` plus `applyShot` per flick is all a position
  ever needs, because the simulation is deterministic. That is why a `replay()` helper existed and
  why rebuilding one is a few lines rather than a design.
- **Determinism is what makes any of it possible.** It paid for fair physics, then a replayable bot,
  then this. Anything that reintroduces a transcendental into the step loop takes all three away.

If online play returns, it returns on a connection that can push. Do not rebuild it on polling: the
number above is what that costs, and it was measured rather than guessed.

## Tests run under strip-only TypeScript

`pnpm test` is Node's own runner with `--experimental-strip-types`, which erases types and refuses
anything that would need code generated for it. No parameter properties, no enums, no namespaces
anywhere the tests can reach. A constructor writes its own field assignments.

## Stack declaration

| Parameter | This project |
|---|---|
| Framework | Next.js 16.3, App Router, Turbopack |
| Package manager | `pnpm`. Commit `pnpm-lock.yaml`, never a `package-lock.json`. |
| Linter and formatter | Biome, not ESLint or Prettier |
| Icon library | `lucide-react` |
| Color system | Semantic tokens in `globals.css` only. **No hex, no palette utilities, no arbitrary color values in components.** Tokens the markup needs are registered under `@theme inline` so a component can write `bg-desk` rather than point at the variable. |
| Type scale | `text-sm` carries the UI. There is almost no text. |
| Casing | **All lowercase**, via `text-transform` on `body`. Write copy in sentence case. |
| Theme | Follows the system through `prefers-color-scheme`. There is no `data-theme` override, because there is no control that would set one. Adding a toggle is the change that adds the attribute. |
| Default radius | `rounded-full` for controls. The desk has its own radius in `lib/draw/arena.ts`. |
| Fonts | The system sans stack. Revisit when the page has enough text to care. |
| Class helper | `cn()` |
| Build gate | `pnpm check` |
| Browser gate | `pnpm verify`, run after `pnpm build` |

## Dependency rule

The simulation, the collision geometry, the renderer, the bot and the match rules are written here.
There are five runtime dependencies: Next, React, `clsx`, `tailwind-merge` and `lucide-react`.
Adding a sixth needs a reason in this table.

The project reads no environment variable and holds no credential. It was not always so: online play
brought `ioredis` and a connection string, and both left with it.

Two things this project will be asked for and should not take:

- **A physics engine.** The whole simulation is two capsules on a plane with one contact
  between them. A general engine brings a broadphase, a constraint graph and an island solver
  for a problem that has one pair, and none of it is written to be bit-reproducible across
  engines, which is the one property this needs most.
- **A 3D renderer.** The camera looks straight down. Depth comes from shading across a pen's
  short axis and a shadow under it, and a scene graph and a WebGL context would be more code
  than the whole of `lib/draw/` for a picture that is deliberately flat.

## No second copy of a measurement

**Nothing outside `lib/sim/constants.ts` may hold its own copy of an arena measurement.** This
has already gone wrong twice. `verify.mjs` worked out where a pen was from its own arena width,
height and starting offset, and all three went stale the day those numbers were retuned: nothing
failed, because the grab margin is wider than the error it had built up, so a drag aimed almost
two centimetres off the pen still landed on it while every drag distance in the file was ten
percent short. The grab test in `arena.tsx` had the pen's half-length written in as a literal 7.

Both were correct on the day they were written, which is what makes the fault hard to see: it
does not appear until a constant moves, and then it appears as something else entirely. Import
the constant, and for anything positional map it through `toCanvas`, which is the same function
the app draws with.

## Commands

```bash
pnpm dev
pnpm typecheck
pnpm lint         # biome
pnpm format       # biome, writing
pnpm test         # node:test, the simulation, the match rules and the drawing geometry
pnpm build
pnpm check        # the gate: lint, typecheck, test, build
pnpm verify       # drives the built app in Chrome, run after pnpm build
```

`pnpm verify` needs Chrome at the path in `scripts/verify.mjs` and writes screenshots to
`scripts/shots/`, which is git-ignored and excluded from Biome. It runs with type stripping so
it can import the app's own constants and geometry.

## Keeping this current

Any new directory under `lib/`, `components/` or `app/` gets added to the architecture tree
with a line saying what belongs there and what does not. Any new invariant in the simulation
gets added to "The simulation is the product", with the test that enforces it named. Never
leave a new directory undocumented.
