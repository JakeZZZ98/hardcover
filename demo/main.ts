import GUI from "lil-gui";
import { PI, springStep } from "../src/engine";
import { createBook, type BookView } from "../src/render/book";
import { printDom } from "../src/render/print-dom";
import { DOM_H, DOM_W, FORM_FACE, LEAVES, makePaintFace } from "./pages";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#book")!;
const formPage = document.querySelector<HTMLElement>("#form-page")!;
const nameInput = document.querySelector<HTMLInputElement>("#guest-name")!;
const status = document.querySelector<HTMLElement>("#status")!;
const announce = document.querySelector<HTMLElement>("#announce")!;
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

const book = createBook(canvas, {
  leaves: LEAVES,
  title: "HARDCOVER",
  paintFace: makePaintFace((g, width) => printDom(formPage, g, width, DOM_W, DOM_H)),
  reduced: () => reducedQuery.matches,
});

/* ---- view springs: framing follows the cover once it lands ------------------------ */
const view: BookView = { cover: 0, shift: 0, zoom: 0, open: 0, leanX: 0, leanY: 0, curl: 1 };
const velocity = { cover: 0, shift: 0, zoom: 0, open: 0, curl: 0 };
const settings = { reading: false, timeScale: 1 };
let openTarget = book.engine.closed ? 0 : 1;

function viewTargets() {
  const c = book.engine.cover;
  if (c.mode === "rest") openTarget = book.engine.closed ? 0 : 1;
  const zoom = settings.reading && openTarget === 1 ? 1 : 0;
  return { cover: openTarget, shift: openTarget, open: openTarget, zoom, curl: zoom ? 0.3 : 1 };
}

function stepView(dt: number): boolean {
  const t = viewTargets();
  let moving = false;
  for (const key of ["cover", "shift", "zoom", "open", "curl"] as const) {
    if (reducedQuery.matches) {
      view[key] = t[key];
      velocity[key] = 0;
      continue;
    }
    [view[key], velocity[key]] = springStep(view[key], velocity[key], t[key], 1, 0.7, dt);
    if (Math.abs(view[key] - t[key]) < 0.0005 && Math.abs(velocity[key]) < 0.005) {
      view[key] = t[key];
      velocity[key] = 0;
    } else moving = true;
  }
  return moving;
}

/* ---- resting: a real <input> lies on the still page -------------------------------- */
let resting = false;
const formFaceVisible = () => {
  const turned = book.turnedCount();
  return !book.engine.closed && (2 * turned === FORM_FACE || 2 * turned + 1 === FORM_FACE);
};

/** Leave the resting state: the DOM page becomes ink, and the paper can move. */
function leaveResting() {
  if (!resting) return;
  resting = false;
  if (document.activeElement === nameInput) nameInput.blur();
  book.repaintFace(FORM_FACE); // prints the live page as it is now, typed value included
  book.showFace(FORM_FACE, "print");
  formPage.classList.add("asleep");
  formPage.inert = true;
}

/** Enter it when everything is still: returns true if the paper changed (so one more frame must be drawn). */
function enterResting(): boolean {
  if (resting) return false;
  const t = book.faceTransform(FORM_FACE, DOM_W, DOM_H);
  if (!t) return false;
  resting = true;
  formPage.style.transform = `translate(${t.tx}px, ${t.ty}px) scale(${t.sx}, ${t.sy})`;
  formPage.classList.remove("asleep");
  formPage.inert = false;
  book.showFace(FORM_FACE, "blank");
  return true;
}

/* ---- the loop runs only while something moves ------------------------------------- */
let raf = 0;
let last = 0;
let frames = 0;
let fpsWindow = performance.now();
let fps = 0;
let invalidated = true;

function loop(now: number) {
  raf = 0;
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) * settings.timeScale;
  last = now;
  const viewMoving = stepView(dt);
  book.frame(dt, view);
  invalidated = false;

  const still = !book.turning() && !viewMoving;
  let paperChanged = false;
  if (still && settings.reading && view.zoom === 1 && formFaceVisible()) paperChanged = enterResting();
  else if (resting && !still) leaveResting();

  frames++;
  if (now - fpsWindow > 500) {
    fps = Math.round((frames * 1000) / (now - fpsWindow));
    frames = 0;
    fpsWindow = now;
  }
  status.textContent = `render loop: running · ${fps} fps`;

  // Swapping the print for blank paper happens after this frame was drawn: draw once more, or the print lingers.
  if (!still || paperChanged || invalidated) raf = requestAnimationFrame(loop);
  else status.textContent = "render loop: asleep (nothing is moving)";
}

function wake() {
  invalidated = true;
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(loop);
}
book.onInvalidate(wake);

let lastAnnounced = -1;
book.onLanded((turned) => {
  if (turned === lastAnnounced) return;
  lastAnnounced = turned;
  announce.textContent = `Pages ${2 * turned + 1} and ${2 * turned + 2} of ${2 * LEAVES + 1}`;
});

/* ---- pointer ---------------------------------------------------------------------- */
const local = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
let dragging: number | null = null;

function startDrag(e: PointerEvent, target: Element) {
  const p = local(e);
  const got = book.pointerDown(p.x, p.y);
  if (!got) return;
  e.preventDefault();
  leaveResting();
  dragging = e.pointerId;
  target.setPointerCapture(e.pointerId);
  canvas.classList.add("dragging");
  wake();
}
canvas.addEventListener("pointerdown", (e) => startDrag(e, canvas));
// On the DOM page, the paper around the field still turns the page.
formPage.addEventListener("pointerdown", (e) => {
  if ((e.target as Element).closest("input, label")) return;
  startDrag(e, formPage);
});
const move = (e: PointerEvent) => {
  const p = local(e);
  if (dragging === e.pointerId) {
    book.pointerMove(p.x, p.y);
    wake();
  } else if (e.currentTarget === canvas) {
    canvas.classList.toggle("over-book", book.hit(p.x, p.y));
  }
};
const up = (e: PointerEvent) => {
  if (dragging !== e.pointerId) return;
  const p = local(e);
  dragging = null;
  canvas.classList.remove("dragging");
  if (e.type === "pointercancel") book.pointerCancel();
  else book.pointerUp(p.x, p.y);
  wake();
};
for (const el of [canvas, formPage]) {
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/* ---- keyboard --------------------------------------------------------------------- */
window.addEventListener("keydown", (e) => {
  if (e.target === nameInput) {
    if (e.key === "Escape") nameInput.blur();
    return;
  }
  const engine = book.engine;
  const turned = book.turnedCount();
  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
      if (engine.closed) book.setCoverOpen(true);
      else book.turnTo(Math.min(LEAVES, turned + 1));
      break;
    case "ArrowLeft":
    case "PageUp":
      if (!engine.closed) book.turnTo(Math.max(0, turned - 1));
      break;
    case "Enter":
      if (engine.closed) book.setCoverOpen(true);
      break;
    case "Escape":
      book.setCoverOpen(false);
      break;
    case "z":
    case "Z":
      settings.reading = !settings.reading;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      break;
    default:
      return;
  }
  e.preventDefault();
  leaveResting();
  wake();
});

/* ---- panel -------------------------------------------------------------------------- */
const gui = new GUI({ title: "hardcover" });
const p = book.engine.params;
const hand = gui.addFolder("Hand-feel");
hand.add(p, "follow", 0, 200, 1).name("follow (ms)");
hand.add(p, "damping", 0.3, 1.2, 0.01).name("settle damping");
hand.add(p, "response", 0.15, 1.5, 0.01).name("settle response (s)");
hand.add(p, "flick", 0.3, 4, 0.05).name("flick (widths/s)");
hand.add(p, "threshold", 0.2, 0.8, 0.01).name("half-way");
hand.add(p, "kick", 2, 30, 0.5).name("max release (rad/s)");
const bend = gui.addFolder("Bend");
bend.add(p, "curl", -0.6, 0.8, 0.01).name("lift curl");
bend.add(p, "lag", 0, 0.4, 0.005).name("motion lag");
bend.add(p, "bendResponse", 0.02, 0.4, 0.005).name("bend response (s)");
bend.add(p, "spread", 0, 2, 0.05).name("corner lead");
const cover = gui.addFolder("Cover");
cover.add(p, "coverDamping", 0.3, 1.2, 0.01).name("damping");
cover.add(p, "coverResponse", 0.2, 1.5, 0.01).name("response (s)");
cover.add(p, "fan", 0, 0.5, 0.01).name("fan");
cover.close();
const scene = gui.addFolder("View");
scene.add(settings, "reading").name("reading view (Z)");
scene.add(settings, "timeScale", { "1×": 1, "½×": 0.5, "¼×": 0.25, "⅒×": 0.1 }).name("speed");
const actions = {
  next: () => book.turnTo(Math.min(LEAVES, book.turnedCount() + 1)),
  previous: () => book.turnTo(Math.max(0, book.turnedCount() - 1)),
  toggleCover: () => book.setCoverOpen(book.engine.coverHeading() === "closed"),
  toStart: () => book.turnTo(0),
};
scene.add(actions, "next").name("next page →");
scene.add(actions, "previous").name("← previous page");
scene.add(actions, "toggleCover").name("open / close");
scene.add(actions, "toStart").name("back to the start");
gui.onChange(() => {
  leaveResting();
  wake();
});
if (window.innerWidth < 700) gui.close();

/* ---- sizing ------------------------------------------------------------------------- */
new ResizeObserver(() => {
  book.resize();
  leaveResting();
  wake();
}).observe(canvas);

// Web fonts or not, print the live page once its layout is final.
void document.fonts.ready.then(() => {
  book.repaintFace(FORM_FACE);
  wake();
});

// A handle for scripted checks (see verify/).
Object.assign(window, { __hardcover: { book, view, settings, wake, isResting: () => resting, isLooping: () => raf !== 0, PI } });
wake();
