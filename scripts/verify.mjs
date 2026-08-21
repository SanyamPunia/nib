/*
 * Drives the built app in a real browser.
 *
 * The unit tests cover the simulation, which is where the game's rules live. They cannot
 * see the things that only exist once a browser is involved: whether the canvas got a
 * backing store, whether a pointer drag on a pen actually resolves a shot, and whether the
 * page fits the window instead of scrolling. Every check here is one of those.
 *
 * Run it against a production build, not the dev server, so what is measured is what
 * deploys.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { launch } from "puppeteer-core";
import { arenaRotated, arenaScale, toCanvas } from "../lib/draw/arena.ts";
import {
  ARENA_HEIGHT as ARENA_HEIGHT_CM,
  PEN_LENGTH,
  START_OFFSET,
} from "../lib/sim/constants.ts";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = process.env.PORT ?? "3111";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SHOTS = "scripts/shots";

const failures = [];
function check(name, ok, detail = "") {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ""}`);
    failures.push(name);
  }
}

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(ORIGIN, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server never answered on ${ORIGIN}`);
}

const server = spawn("pnpm", ["start", "--port", PORT], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});
let browser;

try {
  await waitForServer();
  await mkdir(SHOTS, { recursive: true });

  browser = await launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });

  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(ORIGIN, { waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");

  const canvas = await page.evaluate(() => {
    const el = document.querySelector("canvas");
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { w: el.width, h: el.height, cssW: rect.width, cssH: rect.height };
  });
  check("the canvas has a backing store", !!canvas && canvas.w > 0 && canvas.h > 0);
  check(
    "the backing store matches the device, not the css box",
    !!canvas && canvas.w === Math.round(canvas.cssW * 2),
    canvas ? `${canvas.w} against ${canvas.cssW} css px at dpr 2` : "",
  );

  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  check(
    "the page does not scroll in either axis",
    overflow.x <= 0 && overflow.y <= 0,
    `x ${overflow.x}, y ${overflow.y}`,
  );

  /* Something has to be painted, or every later check would pass against a blank canvas. */
  const painted = await page.evaluate(() => {
    const el = document.querySelector("canvas");
    const ctx = el?.getContext("2d");
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return opaque / (data.length / 4);
  });
  check("the desk is drawn", painted > 0.2, `${(painted * 100).toFixed(1)}% of pixels painted`);

  await page.screenshot({ path: `${SHOTS}/idle-dark.png` });

  /*
   * Both themes, every time. The desk, the slab's near face and the two pens are four tones
   * that have to stay apart in each one, and a palette change that collapses two of them is
   * invisible in whichever theme happens to be the one being looked at.
   */
  const deskPixel = () =>
    page.evaluate(() => {
      const el = document.querySelector("canvas");
      const ctx = el?.getContext("2d");
      if (!ctx || !el) return null;
      /* Middle of the desk, between the two pens, so it is desk and never pen. */
      const { data } = ctx.getImageData(
        Math.round(el.width / 2),
        Math.round(el.height / 2),
        1,
        1,
      );
      return [data[0], data[1], data[2]];
    });

  const darkDesk = await deskPixel();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${SHOTS}/idle-light.png` });
  const lightDesk = await deskPixel();
  check(
    "the canvas repaints itself when the theme changes",
    !!darkDesk && !!lightDesk && Math.abs(darkDesk[0] - lightDesk[0]) > 60,
    `dark ${darkDesk?.join(",")} against light ${lightDesk?.join(",")}`,
  );
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await new Promise((r) => setTimeout(r, 400));

  const statusBefore = await page.$eval("[data-status]", (el) =>
    el.textContent.trim().toLowerCase(),
  );
  check(
    "the idle page says whose flick it is",
    statusBefore.includes("to flick"),
    statusBefore,
  );

  /*
   * Take hold of the pen whose turn it is and pull away from the opponent, which launches it
   * towards them. The pen sits a little left of centre, and the geometry that puts it there is
   * asserted in the unit tests, so this only has to find it and pull.
   */
  const box = await page.$eval("canvas", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const view = { width: box.w, height: box.h, dpr: 2 };
  /*
   * A point on the desk, in centimetres, as page coordinates for the mouse. Every drag below
   * is written in the simulation's own units and mapped through the same function the app
   * draws with, so no distance here can drift away from the arena it is aiming at.
   */
  const at = (x, y) => {
    const p = toCanvas(view, x, y);
    return { x: box.x + p.x, y: box.y + p.y };
  };
  const penA = at(-START_OFFSET, 0);
  check("the arena has a usable scale", arenaScale(view) > 4, `${arenaScale(view)} px per cm`);

  /* A cheap fingerprint of what is painted, for checking that something changed, or did not. */
  const canvasHash = () =>
    page.evaluate(() => {
      const el = document.querySelector("canvas");
      const ctx = el?.getContext("2d");
      if (!ctx || !el) return "";
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      /*
       * A fine stride on purpose. The aim is dotted hairlines, so a pull along the pen's own length
       * paints a couple of hundred device pixels in one narrow column. Sampling every 997th byte
       * missed them nearly every time and reported that nothing had been drawn. The loop runs in the
       * page and only the number crosses, so being thorough here costs nothing worth saving.
       */
      let h = 0;
      for (let i = 0; i < data.length; i += 13) h = (h * 31 + data[i]) | 0;
      return String(h);
    });

  /*
   * Every part of the pen is a handle. A tip, the middle, anywhere along it. Each grab is
   * pulled a little and then returned to where it started before releasing, so the aim is read
   * without ever playing a shot and the next grab starts from the same position.
   */
  const grabIdle = await canvasHash();
  const grabs = [
    ["the lower end", -PEN_LENGTH / 2 + 1],
    ["the middle", 0],
    ["the upper end", PEN_LENGTH / 2 - 1],
  ];
  for (const [where, offset] of grabs) {
    const hold = at(-START_OFFSET, offset);
    const drawn = at(-START_OFFSET - 4, offset);
    await page.mouse.move(hold.x, hold.y);
    await page.mouse.down();
    await page.mouse.move(drawn.x, drawn.y, { steps: 8 });
    const held = await canvasHash();
    check(`the pen can be taken hold of by ${where}`, held !== grabIdle);
    await page.mouse.move(hold.x, hold.y, { steps: 8 });
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 250));
  }
  const stillBlue = await page.$eval("[data-status]", (el) =>
    el.textContent.trim().toLowerCase(),
  );
  check(
    "returning the pull to its start plays nothing",
    stillBlue.includes("slate"),
    stillBlue,
  );

  /*
   * The pull has to keep tracking once the cursor is off the canvas.
   *
   * Pulling back carries the cursor away from the pen, and from anywhere near a player's own edge
   * it leaves the element entirely. Handling moves on the canvas alone made the aim freeze at
   * that boundary, which is indistinguishable from the drag being thrown away and happens exactly
   * when the longest pull is needed. Below the canvas is the status row, which is the nearest
   * non-canvas ground a real cursor can reach.
   */
  const outsideHold = at(-START_OFFSET, 0);
  await page.mouse.move(outsideHold.x, outsideHold.y);
  await page.mouse.down();
  await page.mouse.move(outsideHold.x - 4 * arenaScale(view), outsideHold.y, { steps: 6 });
  await new Promise((r) => setTimeout(r, 120));
  const insideCanvas = await canvasHash();
  await page.mouse.move(outsideHold.x - 60, box.y + box.h + 30, { steps: 8 });
  await new Promise((r) => setTimeout(r, 120));
  const offCanvas = await canvasHash();
  check(
    "the pull keeps tracking after the cursor leaves the canvas",
    offCanvas !== insideCanvas,
    "the aim froze at the canvas boundary",
  );
  /* Back to the grab point, so releasing plays nothing and the next check starts clean. */
  await page.mouse.move(outsideHold.x, outsideHold.y, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));

  /*
   * A press that misses the pen has to end whatever drag was open.
   *
   * A mouse reuses one pointer id, so a drag left open by a missed release used to carry on
   * measuring from its stale grab point, and the arrow that came back was anchored somewhere the
   * hand had long left. The press is dispatched rather than clicked because the point is to
   * arrive while a drag is still open, which one physical mouse button cannot do.
   */
  const staleIdle = await canvasHash();
  const staleHold = at(-START_OFFSET, PEN_LENGTH / 2 - 1);
  const stalePull = at(-START_OFFSET - 5, PEN_LENGTH / 2 - 1);
  await page.mouse.move(staleHold.x, staleHold.y);
  await page.mouse.down();
  await page.mouse.move(stalePull.x, stalePull.y, { steps: 8 });
  await new Promise((r) => setTimeout(r, 120));
  check("the aim is drawn before the interrupting press", (await canvasHash()) !== staleIdle);

  const empty = at(START_OFFSET / 2, -10);
  await page.evaluate(
    (x, y) => {
      const el = document.querySelector("canvas");
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: 99,
          clientX: rect.left + x,
          clientY: rect.top + y,
          buttons: 1,
          bubbles: true,
        }),
      );
    },
    empty.x - box.x,
    empty.y - box.y,
  );
  await new Promise((r) => setTimeout(r, 120));
  check("a press that misses the pen clears the open drag", (await canvasHash()) === staleIdle);
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));

  /*
   * The release has to be heard even when it lands off the canvas. Pulling from a tip starts the
   * grab nearer the edge and carries the cursor further out again, so this is the ordinary case
   * rather than an awkward one.
   */
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));
  const offCanvasHold = at(-START_OFFSET, 0);
  await page.mouse.move(offCanvasHold.x, offCanvasHold.y);
  await page.mouse.down();
  await page.mouse.move(offCanvasHold.x, box.y - 12, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 4000));
  const afterOffCanvas = await page.$eval("[data-status]", (el) =>
    el.textContent.trim().toLowerCase(),
  );
  check(
    "a release outside the canvas still plays the shot",
    !afterOffCanvas.includes("slate"),
    afterOffCanvas,
  );

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));

  /*
   * A pull in any direction draws something and plays something.
   *
   * There is no forbidden direction. One was added here for a while, on the theory that flicking
   * yourself off the desk was a mistake worth preventing, and it left the control dead across
   * half its range: a real player dragged past the pen and got a hundred pointer moves of
   * nothing. Losing on purpose is a move. A gesture that silently does nothing is a fault.
   */
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));
  const anyIdle = await canvasHash();
  const anyHold = at(-START_OFFSET, 0);
  await page.mouse.move(anyHold.x, anyHold.y);
  await page.mouse.down();
  const blind = [];
  for (const [label, x, y] of [
    ["away from the opponent", -6, 0],
    ["towards the opponent", 6, 0],
    ["sideways", 0, 6],
    ["diagonally back", -4, -4],
    ["diagonally across", 4, 4],
  ]) {
    const to = at(-START_OFFSET + x, y);
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await new Promise((r) => setTimeout(r, 110));
    if ((await canvasHash()) === anyIdle) blind.push(label);
  }
  check("a pull draws an aim whichever way it goes", blind.length === 0, blind.join(", "));
  await page.mouse.move(anyHold.x, anyHold.y, { steps: 6 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));

  /* And a pull towards the opponent launches the pen at the player's own edge, which loses. */
  const suicideHold = at(-START_OFFSET, 0);
  const suicidePull = at(-START_OFFSET + 12, 0);
  await page.mouse.move(suicideHold.x, suicideHold.y);
  await page.mouse.down();
  await page.mouse.move(suicidePull.x, suicidePull.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      (document.querySelector("[data-status]")?.textContent ?? "")
        .toLowerCase()
        .includes("self knock"),
    { timeout: 20000 },
  );
  const afterSuicide = await page.$eval("[data-status]", (el) =>
    el.textContent.trim().toLowerCase(),
  );
  check(
    "pulling the wrong way plays a shot, and it loses",
    afterSuicide.includes("self knock"),
    afterSuicide,
  );

  /*
   * The win is celebrated, and then it stops. Both halves matter: a burst that never cleared would
   * leave slivers on the desk for the next match to be played around.
   */
  const midBurst = await canvasHash();
  await new Promise((r) => setTimeout(r, 260));
  await page.screenshot({ path: `${SHOTS}/won.png` });
  await new Promise((r) => setTimeout(r, 2600));
  const settled = await canvasHash();
  check("winning draws a burst, and it clears itself", midBurst !== settled);

  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));

  /*
   * Aim along the pen's own length. This is the case that showed an arrowhead and a wake with
   * no shaft joining them, because the shaft was buried under the pen for its whole length.
   */
  const beforeLengthwise = await canvasHash();
  await page.mouse.move(penA.x, penA.y);
  await page.mouse.down();
  const lengthwise = at(-START_OFFSET, 7);
  await page.mouse.move(lengthwise.x, lengthwise.y, { steps: 12 });
  /* Wait for the repaint. Reading the canvas straight after an input command races the handler. */
  await new Promise((r) => setTimeout(r, 150));
  const lengthwiseHash = await canvasHash();
  check("an aim along the pen draws something", lengthwiseHash !== beforeLengthwise);
  await page.screenshot({ path: `${SHOTS}/aiming-lengthwise.png` });
  await page.mouse.up();

  /* Reload rather than resetting through the interface, so this does not depend on how that
   * shot happened to end. */
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));

  await page.mouse.move(penA.x, penA.y);
  await page.mouse.down();
  const pulled = at(-START_OFFSET - 6, 0);
  await page.mouse.move(pulled.x, pulled.y, { steps: 12 });
  await page.screenshot({ path: `${SHOTS}/aiming.png` });

  const aiming = await page.evaluate(() => {
    const el = document.querySelector("canvas");
    const ctx = el?.getContext("2d");
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
    return opaque;
  });
  await page.mouse.up();

  const idlePixels = await page.evaluate(() => 1);
  check("the aim guide is drawn while dragging", aiming > 0, `${aiming} opaque pixels`);
  void idlePixels;

  /* The shot animates, then the turn passes. Give it comfortably longer than a shot lasts. */
  await page.waitForFunction(
    () => {
      const text = (document.querySelector("[data-status]")?.textContent ?? "").toLowerCase();
      return text.includes("wins") || text.includes("to flick");
    },
    { timeout: 15000 },
  );
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: `${SHOTS}/after-shot.png` });

  const moved = await page.evaluate(() => {
    const el = document.querySelector("canvas");
    const ctx = el?.getContext("2d");
    if (!ctx) return null;
    const { data, width, height } = ctx.getImageData(0, 0, el.width, el.height);
    /* Find the horizontal spread of every strongly coloured pixel, to locate the pens. */
    let minX = width;
    let maxX = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 26) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    return { minX, maxX, width };
  });
  check(
    "both pens are still on the picture after the shot",
    !!moved && moved.maxX > moved.minX,
    moved ? `pens span x ${moved.minX} to ${moved.maxX} of ${moved.width}` : "",
  );

  /*
   * Six centimetres of pull is about a hundred centimetres a second, which runs out before it
   * reaches the other pen. So the shot has to decide nothing and hand the turn over, and naming
   * the pen that receives it is what proves the pen went opposite the hand. Had it followed the
   * hand instead, it would have run at its own edge and either stopped short or lost the match,
   * and neither of those passes this.
   */
  const statusAfter = await page.$eval("[data-status]", (el) =>
    el.textContent.trim().toLowerCase(),
  );
  check(
    "the flick passed the turn to the other pen",
    statusAfter.includes("to flick") && statusAfter.includes("brick"),
    statusAfter,
  );

  /*
   * Where the pen is taken hold of has to change the shot, and the only honest way to check the
   * offset is plumbed all the way through is to play the same pull twice from two places and
   * see two different desks. Both pulls are five centimetres, which is under the cap at either
   * grip, so the speed is identical and the spin is the only thing that differs.
   */
  const playFrom = async (offset) => {
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector("canvas");
    await new Promise((r) => setTimeout(r, 300));
    const hold = at(-START_OFFSET, offset);
    const pull = at(-START_OFFSET - 5, offset);
    await page.mouse.move(hold.x, hold.y);
    await page.mouse.down();
    await page.mouse.move(pull.x, pull.y, { steps: 10 });
    if (offset !== 0) await page.screenshot({ path: `${SHOTS}/aiming-tip.png` });
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-status]")?.textContent ?? "")
          .toLowerCase()
          .includes("brick"),
      { timeout: 15000 },
    );
    await new Promise((r) => setTimeout(r, 3000));
    return canvasHash();
  };

  const fromMiddle = await playFrom(0);
  const fromTip = await playFrom(PEN_LENGTH / 2 - 1);
  check(
    "the same pull from a tip and from the middle land differently",
    fromMiddle !== fromTip,
    `${fromMiddle} against ${fromTip}`,
  );
  await page.screenshot({ path: `${SHOTS}/after-tip-flick.png` });

  /*
   * The bot has to take its turn on its own. Nothing else in the page can hand the turn back to
   * blue, so seeing blue again after one flick is proof the red pen was played for it.
   */
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));

  /*
   * The setup lives behind one control, so anything that reaches for a choice has to open it first.
   * The collapsed control is the only thing on the page carrying `aria-expanded="false"`, which is
   * what makes it addressable without a test-only attribute.
   */
  const openSetup = () =>
    page.evaluate(() => {
      const control = [...document.querySelectorAll("button")].find(
        (el) => el.getAttribute("aria-expanded") === "false",
      );
      if (!(control instanceof HTMLElement)) return false;
      control.click();
      return true;
    });

  /* Long enough to outlast the panel's 300ms grow, so nothing is measured mid-transition. */
  const panelSettled = async () => {
    await new Promise((r) => setTimeout(r, 420));
    return true;
  };

  check("the setup opens from its one control", await openSetup());
  await panelSettled();

  const picked = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('[role="radio"]')].find(
      (el) => el.innerText.trim().toLowerCase() === "easy",
    );
    if (!(chip instanceof HTMLElement)) return false;
    chip.click();
    return true;
  });
  check("the opponent can be chosen", picked);
  await new Promise((r) => setTimeout(r, 200));
  const chosen = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('[role="radio"]')].find(
      (el) => el.innerText.trim().toLowerCase() === "easy",
    );
    return chip?.getAttribute("aria-checked");
  });
  check("the chosen opponent is marked", chosen === "true", String(chosen));

  /* A gentle pull, so the flick decides nothing and the bot gets a turn to take. */
  const botHold = at(-START_OFFSET, 0);
  const botPull = at(-START_OFFSET - 3, 0);
  await page.mouse.move(botHold.x, botHold.y);
  await page.mouse.down();
  await page.mouse.move(botPull.x, botPull.y, { steps: 8 });
  await page.mouse.up();

  await page.waitForFunction(
    () =>
      (document.querySelector("[data-status]")?.textContent ?? "")
        .toLowerCase()
        .includes("brick"),
    { timeout: 15000 },
  );
  let botPlayed = true;
  try {
    await page.waitForFunction(
      () => {
        const text = (document.querySelector("[data-status]")?.textContent ?? "").toLowerCase();
        return text.includes("slate") || text.includes("wins");
      },
      { timeout: 20000 },
    );
  } catch {
    botPlayed = false;
  }
  const afterBot = await page.$eval("[data-status]", (el) =>
    el.textContent.trim().toLowerCase(),
  );
  check("the bot takes its own turn", botPlayed, afterBot);
  await page.screenshot({ path: `${SHOTS}/against-bot.png` });

  /*
   * Choosing a pen has to change the desk, and choosing the one the opponent is holding has to
   * move the opponent off it. Two identical pens on one desk is a board nobody can read, so that
   * second rule is load-bearing rather than tidy.
   */
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));

  const pickPen = (name) =>
    page.evaluate((wanted) => {
      const input = [...document.querySelectorAll('input[type="radio"][name="pen"]')].find(
        (el) => el.getAttribute("aria-label") === wanted,
      );
      if (!(input instanceof HTMLElement)) return false;
      input.click();
      return true;
    }, name);

  await openSetup();
  await panelSettled();
  const withSlate = await canvasHash();
  check("the pen catalogue can be picked from", await pickPen("Graphite"));
  await new Promise((r) => setTimeout(r, 250));
  const withGraphite = await canvasHash();
  check("choosing a pen redraws the desk", withSlate !== withGraphite);

  /* Brick is what the opponent starts with, so this forces the swap. */
  check("the opponent's own pen can be chosen", await pickPen("Brick"));
  await new Promise((r) => setTimeout(r, 250));
  const withBrick = await canvasHash();
  check("taking the opponent's pen moves them off it", withBrick !== withGraphite);
  const bothNamed = await page.evaluate(() =>
    [...document.querySelectorAll('input[type="radio"][name="pen"]')]
      .filter((el) => el.checked)
      .map((el) => el.getAttribute("aria-label")),
  );
  check("exactly one pen is marked as yours", bothNamed.length === 1, bothNamed.join(","));
  await page.screenshot({ path: `${SHOTS}/pens.png` });

  /*
   * A phone. The arena is landscape and a phone is not, so this is the one viewport where the whole
   * picture is arranged differently, and every assertion above was made against the other one.
   */
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, hasTouch: true });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 400));

  const phoneOverflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  check(
    "a phone does not scroll in either axis",
    phoneOverflow.x <= 0 && phoneOverflow.y <= 0,
    `x ${phoneOverflow.x}, y ${phoneOverflow.y}`,
  );

  const phoneBox = await page.$eval("canvas", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const phoneView = { width: phoneBox.w, height: phoneBox.h, dpr: 3 };
  check("the desk turns on a phone", arenaRotated(phoneView));
  const phoneScale = arenaScale(phoneView);
  /* Turned, the arena's short side is the one across the screen. */
  const deskAcross = ARENA_HEIGHT_CM * phoneScale;
  check(
    "the turned desk fills the width it is given",
    deskAcross > phoneBox.w * 0.8,
    `${Math.round(deskAcross)}px of ${Math.round(phoneBox.w)}px`,
  );
  await openSetup();
  await panelSettled();
  const clipped = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('input[type="radio"][name="pen"]')].map((el) =>
      (el.parentElement ?? el).getBoundingClientRect(),
    );
    const lowest = Math.max(...labels.map((r) => r.bottom));
    return { lowest, viewport: window.innerHeight };
  });
  check(
    "the phone footer is not clipped",
    clipped.lowest <= clipped.viewport,
    `last preview ends at ${Math.round(clipped.lowest)} of ${clipped.viewport}`,
  );
  await page.screenshot({ path: `${SHOTS}/phone.png` });

  /*
   * And it is playable. The same world coordinates as the desktop checks, mapped through the same
   * function the app draws with, so this drag needs to know nothing about which way round the desk
   * ended up.
   */
  /*
   * Measured again, after the setup was opened and closed above. Opening it grows the footer and
   * shrinks the canvas, so anything holding a box from before that is pointing at where the pen used
   * to be. This is the third time a stale measurement has bitten this file.
   */
  await page.evaluate(() => {
    const done = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").trim().toLowerCase().includes("done"),
    );
    if (done instanceof HTMLElement) done.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const flickBox = await page.$eval("canvas", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const flickView = { width: flickBox.w, height: flickBox.h, dpr: 3 };
  const phoneAt = (x, y) => {
    const p = toCanvas(flickView, x, y);
    return { x: flickBox.x + p.x, y: flickBox.y + p.y };
  };
  const phoneHold = phoneAt(-START_OFFSET, 0);
  const phonePull = phoneAt(-START_OFFSET - 5, 0);
  await page.mouse.move(phoneHold.x, phoneHold.y);
  await page.mouse.down();
  await page.mouse.move(phonePull.x, phonePull.y, { steps: 8 });
  await new Promise((r) => setTimeout(r, 120));
  const phoneAiming = await canvasHash();
  await page.mouse.up();
  let phonePlayed = true;
  try {
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-status]")?.textContent ?? "")
          .toLowerCase()
          .includes("brick"),
      { timeout: 15000 },
    );
  } catch {
    phonePlayed = false;
  }
  check("a pen can be taken hold of and flicked on a phone", phonePlayed);
  check("the aim draws on a phone", phoneAiming !== (await canvasHash()));

  /*
   * A result is a moment to read, not a form. The settings go away with the match and come back only
   * when the player asks for another one.
   */
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("canvas");
  await new Promise((r) => setTimeout(r, 300));

  /*
   * What the bottom of the screen is for.
   *
   * There is one thing to do on this screen and it is flick a pen. The choices are a once-a-session
   * decision, so collapsed there is a single control down there, during a match there is nothing at
   * all, and the choices appear only when asked for.
   */
  /*
   * The panel animates open and shut, so it stays in the document while collapsed and cannot be
   * tested by asking whether the choices exist. Two things matter instead. A player cares whether
   * the panel takes up any room, which is its height. A screen reader cares about `inert`, because
   * a panel that is invisible but still focusable and still read aloud is worse than one that pops.
   */
  const panelState = () =>
    page.evaluate(() => {
      const panel = document.querySelector("[data-setup]");
      if (!panel) return null;
      return {
        height: panel.getBoundingClientRect().height,
        reachable: !panel.hasAttribute("inert"),
      };
    });
  const choicesShown = async () => {
    const panel = await panelState();
    return panel !== null && panel.height > 1 && panel.reachable;
  };
  const controlShown = () =>
    page.evaluate(() => document.querySelectorAll('button[aria-expanded="false"]').length);

  check("before a match the bottom holds one control", (await controlShown()) === 1);
  check("and the choices are not on screen until asked for", !(await choicesShown()));
  /*
   * Exactly zero and not merely small. The row is sized `minmax(0, 0fr)` closed, and a bare `0fr`
   * would mean `minmax(auto, 0fr)`, whose `auto` floor is the choices' own height. That collapses
   * to nothing visually here but leaves the panel holding the page taller than the window.
   */
  check("a closed panel takes up no room at all", (await panelState())?.height === 0);
  const opened = (await openSetup()) && (await panelSettled());
  check("opening it shows the choices", opened && (await choicesShown()));
  await page.evaluate(() => {
    const done = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").trim().toLowerCase().includes("done"),
    );
    if (done instanceof HTMLElement) done.click();
  });
  await panelSettled();
  check("closing it puts them away", !(await choicesShown()));

  const endHold = at(-START_OFFSET, 0);
  const endPull = at(-START_OFFSET + 12, 0);
  await page.mouse.move(endHold.x, endHold.y);
  await page.mouse.down();
  await page.mouse.move(endPull.x, endPull.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      (document.querySelector("[data-status]")?.textContent ?? "")
        .toLowerCase()
        .includes("knock"),
    { timeout: 20000 },
  );
  await new Promise((r) => setTimeout(r, 1600));
  check("a finished match still offers the setup, still collapsed", !(await choicesShown()));

  const askedAgain = await page.evaluate(() => {
    const again = [...document.querySelectorAll("button")].find((el) =>
      (el.textContent ?? "").trim().toLowerCase().includes("again"),
    );
    if (!(again instanceof HTMLElement)) return false;
    again.click();
    return true;
  });
  check("a result offers another match", askedAgain);
  await new Promise((r) => setTimeout(r, 300));
  const backToPlay = await page.$eval("[data-status]", (el) =>
    el.textContent.trim().toLowerCase(),
  );
  check("and the new match is waiting on a flick", backToPlay.includes("to flick"), backToPlay);

  check("nothing logged an error", consoleErrors.length === 0, consoleErrors.join(" | "));

  await writeFile(
    `${SHOTS}/report.json`,
    JSON.stringify({ canvas, overflow, painted, statusBefore, statusAfter }, null, 2),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

console.log(
  failures.length === 0 ? "\nverify: all checks passed" : `\nverify: ${failures.length} failed`,
);
process.exit(failures.length === 0 ? 0 : 1);
