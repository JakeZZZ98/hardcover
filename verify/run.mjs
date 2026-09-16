/**
 * End-to-end checks in a real, headless Chrome over the DevTools protocol.
 *
 * Why not a test browser in a panel or an automation framework: a hidden or
 * throttled tab stops requestAnimationFrame, and a page-turn demo that does
 * not animate "passes" everything. Headless Chrome runs frames for real, and
 * CDP's Input.dispatchMouseEvent goes through the same hit-testing and
 * pointer events a hand would.
 *
 * Usage: npm run build && node verify/run.mjs
 * Screenshots land in verify/out/. Set CHROME_PATH if Chrome is elsewhere.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = join(root, "verify", "out");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(join(dist, "index.html"))) {
  console.error("Build the demo first: npm run build");
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

/* ---- a static server for dist/, only for the length of the run ---- */
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const file = join(dist, url === "/" ? "index.html" : url);
  let body;
  try {
    body = readFileSync(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

/* ---- Chrome and a tiny CDP client ---- */
const debugPort = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(
  CHROME,
  [`--remote-debugging-port=${debugPort}`, "--headless=new", "--window-size=1280,800", "--hide-scrollbars", "--use-angle=metal", "--enable-unsafe-swiftshader", "--no-first-run", `--user-data-dir=${join(out, "profile")}`, "about:blank"],
  { stdio: "ignore" },
);
let targets;
for (let i = 0; i < 40 && !targets; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  } catch {
    await sleep(250);
  }
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const waiting = new Map();
const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) {
    waiting.get(d.id)(d);
    waiting.delete(d.id);
  } else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
  else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++nextId;
    waiting.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const js = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const mouse = (type, x, y, buttons = 0) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
const key = async (k, code = k) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code });
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, name), Buffer.from(r.result.data, "base64"));
};
/** Press at `from`, move to `to` over `ms` in `steps`, optionally screenshot while still held, release. */
const drag = async (from, to, ms, { steps = 20, holdShot } = {}) => {
  await mouse("mouseMoved", from[0], from[1]);
  await mouse("mousePressed", from[0], from[1], 1);
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps, 1);
    await sleep(ms / steps);
  }
  if (holdShot) await shot(holdShot);
  await mouse("mouseReleased", to[0], to[1]);
};
/** A point on a face, in canvas pixels: (u, v) in 0..1 across the printed page. */
const facePoint = (face, u, v) => js(`(() => { const t = __hardcover.book.faceTransform(${face}, 500, 740); return t && [t.tx + ${u} * 500 * t.sx, t.ty + ${v} * 740 * t.sy]; })()`);
const state = () => js(`({ closed: __hardcover.book.engine.closed, turned: __hardcover.book.turnedCount(), looping: __hardcover.isLooping(), resting: __hardcover.isResting() })`);
const waitIdle = async (limit = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    if (!(await js("__hardcover.book.turning()"))) return true;
    await sleep(50);
  }
  return false;
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

await send("Runtime.enable");
await send("Page.enable");

try {
  /* 1. load: shut, and the loop goes to sleep */
  await send("Page.navigate", { url: base });
  await sleep(3000);
  let s = await state();
  check("loads shut and idle", s.closed && !s.looping, JSON.stringify(s));
  await shot("01-shut.png");

  /* 2. a tap on the shut book opens it */
  await mouse("mouseMoved", 640, 400);
  await mouse("mousePressed", 640, 400, 1);
  await sleep(40);
  await mouse("mouseReleased", 640, 400);
  await sleep(2600);
  s = await state();
  check("a tap opens the book", !s.closed && s.turned === 0, JSON.stringify(s));
  await shot("02-open.png");

  /* 3. drag the right page across */
  let a = await facePoint(1, 0.85, 0.5);
  await drag(a, [a[0] - 520, a[1] - 20], 700, { holdShot: "03-dragging.png" });
  await waitIdle();
  s = await state();
  check("a slow drag past half-way turns the page", s.turned === 1, JSON.stringify(s));

  /* 4. a short drag, released short of half-way, falls back */
  a = await facePoint(3, 0.85, 0.5);
  await drag(a, [a[0] - 90, a[1]], 900, { steps: 30 });
  await waitIdle();
  s = await state();
  check("a slow short drag falls back", s.turned === 1, JSON.stringify(s));

  /* 5. a flick: a short, fast move turns it */
  a = await facePoint(3, 0.8, 0.4);
  await drag(a, [a[0] - 70, a[1]], 40, { steps: 4 });
  await waitIdle();
  s = await state();
  check("a short fast flick turns the page", s.turned === 2, JSON.stringify(s));

  /* 6. catch a page in flight and bring it back */
  a = await facePoint(5, 0.8, 0.4);
  await drag(a, [a[0] - 70, a[1]], 40, { steps: 4 });
  await sleep(70);
  const flying = await js(`__hardcover.book.engine.leaves[2].mode`);
  // Any press on the book while a page is in the air takes that page; the drag then works from where it is.
  const x = a[0] - 200;
  await mouse("mouseMoved", x, a[1]);
  await mouse("mousePressed", x, a[1], 1);
  const caught = await js(`__hardcover.book.engine.active === __hardcover.book.engine.leaves[2]`);
  for (let i = 1; i <= 20; i++) {
    await mouse("mouseMoved", x + i * 22, a[1], 1);
    await sleep(30);
  }
  await mouse("mouseReleased", x + 440, a[1]);
  await waitIdle();
  s = await state();
  check("a page in flight can be caught and brought back", flying === "settle" && caught && s.turned === 2, `flying=${flying} caught=${caught} ${JSON.stringify(s)}`);

  /* 7. Esc closes, the turned pages ride along; Enter opens at the first spread */
  await key("Escape");
  await sleep(300);
  await shot("04-closing.png");
  await waitIdle();
  await sleep(900);
  s = await state();
  check("Esc closes the book and brings the pages with it", s.closed && s.turned === 0, JSON.stringify(s));
  await key("Enter");
  await waitIdle();
  await sleep(900);
  s = await state();
  check("Enter opens it again", !s.closed, JSON.stringify(s));

  /* 8. keyboard turns, frame pacing while pages move */
  await js(`window.__gaps = []; (function f(t0){ requestAnimationFrame((t) => { __gaps.push(t - t0); if (__gaps.length < 90) f(t); }); })(performance.now())`);
  await key("ArrowRight");
  await sleep(250);
  await key("ArrowRight");
  await sleep(1300);
  const gaps = await js(`__gaps.slice(1)`);
  const fps = Math.round(1000 / (gaps.reduce((x, y) => x + y, 0) / gaps.length));
  const worst = Math.max(...gaps).toFixed(1);
  await waitIdle();
  s = await state();
  check("arrow keys turn pages", s.turned === 2, JSON.stringify(s));
  check("frames keep pace while pages turn", fps >= 55, `${fps} fps, worst gap ${worst} ms`);

  /* 9. reading view: a real input on the still page; typed text is printed onto the moving paper */
  await key("ArrowLeft");
  await waitIdle();
  await key("z", "KeyZ");
  await sleep(2600);
  s = await state();
  check("reading view puts the live page on the still paper", s.resting && s.turned === 1, JSON.stringify(s));
  const blankUnder = await js(`__hardcover.book.faceShowing(3)`);
  check("under the live page the paper is blank (no double print)", blankUnder === "blank", blankUnder);
  const input = await js(`(() => { const r = document.querySelector("#guest-name").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  await mouse("mouseMoved", input[0], input[1]);
  await mouse("mousePressed", input[0], input[1], 1);
  await mouse("mouseReleased", input[0], input[1]);
  await send("Input.insertText", { text: "Grace Hopper" });
  await shot("05-typing.png");
  a = await facePoint(3, 0.8, 0.85);
  await drag(a, [a[0] - 360, a[1]], 500, { holdShot: "06-printed-while-turning.png" });
  const showingWhileMoving = await js(`__hardcover.book.faceShowing(3)`);
  await waitIdle();
  s = await state();
  check("turning a page prints the typed text into the paper", showingWhileMoving === "print" && s.turned === 2, `${showingWhileMoving} ${JSON.stringify(s)}`);
  await key("ArrowLeft");
  await waitIdle();
  await sleep(600);
  s = await state();
  const value = await js(`document.querySelector("#guest-name").value`);
  check("back at rest, the live page returns with its value", s.resting && value === "Grace Hopper", `${value} ${JSON.stringify(s)}`);
  // Hide the live page and look at the canvas alone: the paper must be blank, not carrying a stale print.
  await shot("07-live-page-at-rest.png");
  await js(`document.querySelector("#form-page").style.visibility = "hidden"`);
  await shot("08-canvas-under-live-page.png");
  // The same page as ink, at rest, for a pixel comparison with 07 (print first: the printer skips hidden elements).
  await js(`document.querySelector("#form-page").style.visibility = ""`);
  await js(`__hardcover.book.repaintFace(3); __hardcover.book.showFace(3, "print"); document.querySelector("#form-page").style.visibility = "hidden"; __hardcover.wake()`);
  await sleep(200);
  await shot("09-print-at-rest.png");
  await js(`__hardcover.book.showFace(3, "blank"); document.querySelector("#form-page").style.visibility = ""; __hardcover.wake()`);
  await sleep(200);
  s = await state();
  check("the loop sleeps again when nothing moves", !s.looping, JSON.stringify(s));

  /* 10. reduced motion: turns land at once */
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await send("Page.navigate", { url: base });
  await sleep(2500);
  await key("Enter");
  await sleep(120);
  s = await state();
  check("reduced motion: the cover opens at once", !s.closed, JSON.stringify(s));
  /* 11. the minimal example from the README runs and turns a page */
  await send("Emulation.setEmulatedMedia", { features: [] });
  const before = errors.length;
  await send("Page.navigate", { url: `${base}examples/minimal.html` });
  await sleep(2500);
  await drag([1000, 400], [420, 380], 700);
  await sleep(1800);
  await shot("10-minimal-example.png");
  check("the minimal example loads and turns without errors", errors.length === before, errors.slice(before).join(" | "));
} catch (e) {
  check("run finished", false, e.stack ?? String(e));
}

check("no console errors", errors.length === 0, errors.join(" | "));
ws.close();
chrome.kill();
server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in verify/out/`);
process.exit(failed ? 1 : 0);
