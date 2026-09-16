# hardcover

A hardcover book for the web whose pages you can **drag, flick, catch mid-air and pull shut** — a small physics engine (no dependencies) and a three.js renderer.

![A page being dragged, flicked, caught and the book closed](docs/images/hero.webp)

**[Live demo](https://jakezzz98.github.io/hardcover/)** · [How it works](#how-it-works) · [Full article](docs/how-it-works.md) · [The maths, derived](docs/math.md) · [HTML on a turning page](docs/html-on-paper.md)

- Grab the paper **anywhere**; the edge you hold stays under your finger.
- **Flick** to turn, or drag past half-way; anything else falls back.
- **Catch** a page while it is still in the air.
- **Close** the cover by its edge — the pages ride along and never pass through it.
- A real **hardcover**: cloth boards, a spine, a gutter, and a fore-edge that thickens as you read.
- A page can hold **live HTML** — a form you can type into, carried on the paper when it turns.
- **No frames drawn** while nothing moves. Mouse, touch, keyboard, `prefers-reduced-motion`.

## Use it

Copy `src/` into your project (it only needs `three`), serve `public/textures/`, and:

```ts
import { mountBook } from "./src";

mountBook(document.querySelector("canvas")!, {
  leaves: 6,
  title: "MY BOOK",
  paintFace(g, width, height, { face }) {
    g.fillText(`Page ${face + 1}`, width * 0.12, height * 0.14);
  },
});
```

That's the whole setup: dragging, flicking, keyboard, resizing and the render loop are wired. `paintFace` draws each page onto a 768-pixel-wide canvas that already has paper on it.

| option | default | |
| --- | --- | --- |
| `leaves` | 4 | turnable leaves (each has two faces) |
| `title` | — | foil-stamped on the cover |
| `colors` | burgundy cloth, warm paper | `{ cloth, paper, ribbon, foil, headband }` |
| `paintFace(g, w, h, { face })` | — | draw a page; faces are numbered in reading order |
| `startOpen` | `false` | start open at the first spread |
| `texturesUrl` | `"textures/book-pattern/"` | where the cloth textures are served |
| `params` | see [the knobs](docs/how-it-works.md#14-the-knobs) | hand-feel: follow, flick, springs, bend |

It returns `{ book, destroy }`. Drive it from your code with `book.turnTo(3)`, `book.setCoverOpen(false)` and `book.onLanded((turned) => …)`.

**Only the physics?** `src/engine/` knows nothing about rendering:

```ts
const engine = new BookEngine({ leafCount: 6, geometry: makeGeometry({ H: 1.48, boardT: 0.03, leafT: 0.0025, fillR: 14, sheetsUnderCover: 6, gutter: 0.025, hinge: 0.035 }) });
engine.grab(0.8, 0); engine.move(0.2); engine.release(-2.5); // a flick
engine.step(1 / 60);                                         // your clock
engine.leaves[0].theta;                                      // 0 = lying right … π = lying left
```

---

## How it works

The idea in one sentence: **every sheet is one angle about the spine**, and everything else — following the hand, flicking, bending, not passing through, closing, looking thick — is built on that number. Below is each piece with its formula and the code that implements it (condensed from `src/`). The [full article](docs/how-it-works.md) tells the story at length, and [the maths](docs/math.md) derives every formula.

1. [One angle per sheet](#1-one-angle-per-sheet)
2. [Following the finger](#2-following-the-finger)
3. [Letting go: a flick, half-way, and a spring](#3-letting-go-a-flick-half-way-and-a-spring)
4. [Bending the paper](#4-bending-the-paper)
5. [Pages never pass through each other](#5-pages-never-pass-through-each-other)
6. [Closing the cover](#6-closing-the-cover)
7. [Looking thick](#7-looking-thick)
8. [A text field that stays on the paper](#8-a-text-field-that-stays-on-the-paper)
9. [Drawing only when something moves](#9-drawing-only-when-something-moves)

### 1. One angle per sheet

Seen from the book's tail, every sheet — each leaf, the flyleaf, the cover — swings about the spine. Its whole state is a hinge angle θ (0 lying right, π lying left), an angular velocity ω, and a mode.

![A sheet is one hinge angle about the spine](docs/images/hinge-angle.svg)

```ts
interface Sheet {
  theta: number;  // 0 … π
  omega: number;  // rad/s
  mode: "rest" | "drag" | "settle" | "bundle";
  target: number; // where a settle is heading: 0 or π
  bend: number;   // smoothed ω, for the paper's lag
}
```

Lengths are in page widths. `engine.step(dt)` advances every sheet from one clock, so the physics runs in unit tests without a browser.

### 2. Following the finger

From above, a sheet's fore-edge is at x = W cos θ. On grab we remember that and the pointer's x; when the pointer has moved by Δx, the sheet goes to the angle whose edge lies under it:

```math
\theta_{target} = \arccos\!\left(\frac{W\cos\theta_0 + \Delta x}{W}\right)
```

![The tip's projection follows the pointer](docs/images/drag-mapping.svg)

```ts
grab(x, y) {
  sheet.grabX0 = this.widthOf(sheet) * Math.cos(sheet.theta);
  sheet.px0 = x;
  // …
}
move(x) {
  const xt = sheet.grabX0 + (x - sheet.px0);
  sheet.thetaTarget = Math.acos(clamp(xt / this.widthOf(sheet), -1, 1));
}
```

θ chases the target on a stiff spring (40 ms), which smooths coarse pointer events and keeps ω meaningful for the release. The sheets are bent on the GPU, so the pointer is not raycast against them: it is intersected with the flat plane of the block's top, in the book's own frame.

### 3. Letting go: a flick, half-way, and a spring

The release velocity comes from the last 80 ms of pointer samples. Fast enough and direction wins; otherwise progress past half-way wins. The pointer's speed then becomes the page's spin — differentiating x = W cos θ gives ẋ = −W sin θ · ω:

```math
\omega_0 = -\frac{v_x}{W\,\max(\sin\theta,\ 0.35)}
```

```ts
release(vx) {
  if (Math.abs(vx) >= p.flick) target = vx < 0 ? PI : 0;                  // a flick: direction wins
  else target = progress >= p.threshold ? oppositeSide : sideItCameFrom;  // otherwise: half-way wins
  const omega0 = clamp(-vx / (W * Math.max(Math.sin(sheet.theta), 0.35)), -p.kick, p.kick);
  if (Math.abs(omega0) > Math.abs(sheet.omega)) sheet.omega = omega0;
  this.settle(sheet, target);                                             // a spring takes it from here
}
```

Every motion in the book is the same damped spring, set by a damping ratio ζ and a response time (ω = 2π / response), integrated with semi-implicit Euler:

```ts
export function springStep(x, v, target, damping, response, dt) {
  const w = (2 * PI) / response, k = w * w, c = 2 * damping * w;
  const hMax = Math.min(1 / 240, 0.5 / w);
  for (let t = dt; t > 0; t -= hMax) {
    const h = Math.min(t, hMax);
    v += (k * (target - x) - c * v) * h;
    x += v * h;
  }
  return [x, v];
}
```

The `0.5 / w` cap matters: semi-implicit Euler is only stable while (hω)² + 4ζhω < 4, so a fixed 1/240 s step diverges for responses under ~32 ms ([derivation](docs/math.md#4-springs-and-keeping-them-stable)).

Because a flying page is just a spring toward a target, **catching it** needs nothing special: `grab` takes the sheet in flight nearest the pointer and switches it back to `drag`.

### 4. Bending the paper

Each sheet has one bend angle c — a lift curl while it is in the air, plus a lag against its motion:

```math
c = \text{curl}\cdot\sin 2\theta - \text{lag}\cdot\bar\omega
```

A row of paper turns from direction θ at the spine to θ + c at the fore-edge, i.e. a circular arc. Integrating the tangent (cos φ, sin φ) with φ(u) = θ + c·u gives its shape in closed form:

```math
x(u) = \frac{L}{c}\big(\sin(\theta + cu) - \sin\theta\big), \qquad z(u) = \frac{L}{c}\big(\cos\theta - \cos(\theta + cu)\big)
```

![One row of paper is a circular arc](docs/images/bend-arc.svg)

That runs in the vertex shader, injected into `MeshStandardMaterial` so the lighting stays physically based:

```glsl
vec3 bent(vec2 p) {
  float u = p.x / uW;
  float c = uBend * (1.0 + uSpread * abs(p.y / uH - uGrabY));   // the corner you hold leads
  c = clamp(c, -uTheta * 0.97, (3.14159265 - uTheta) * 0.97);    // never below its own root
  float L = uW * uReach;
  float x = L * (sin(uTheta + c * u) - sin(uTheta)) / c;
  float z = L * (cos(uTheta) - cos(uTheta + c * u)) / c;
  return vec3(x, p.y, z + uZRoot + dip);                          // dip: the gutter (§7)
}
// objectNormal = normalize(cross(bent(p + dx) - bent(p - dx), bent(p + dy) - bent(p - dy)))
```

Clamping c to [−θ, π − θ] keeps every tangent angle in [0, π], so no part of the paper can dip below where it is bound. The normal is taken from the same function, so light slides across the curve.

### 5. Pages never pass through each other

No collision detection. All sheets turn about the same axis, so "cannot pass through" is just an ordering of angles:

```math
\theta_{cover} \ge \theta_{flyleaf} \ge \theta_0 \ge \theta_1 \ge \dots \ge 0
```

![Non-penetration is an ordering of angles](docs/images/angle-chain.svg)

After every step, one sweep forward and one back fix any pair that got out of order:

```ts
const contact = (a, b) => {                // a lies outside b
  if (a.theta >= b.theta) return;          // in order
  if (a.mode === "drag") { b.theta = a.theta; b.omega = Math.min(b.omega, a.omega); }        // the hand pushes
  else if (b.mode === "drag") { a.theta = b.theta; a.omega = Math.max(a.omega, b.omega); }
  else {                                   // two free sheets merge, conserving angular momentum
    const ma = a.isCover ? 8 : 1, mb = b.isCover ? 8 : 1;
    a.theta = b.theta = (ma * a.theta + mb * b.theta) / (ma + mb);
    a.omega = b.omega = (ma * a.omega + mb * b.omega) / (ma + mb);
  }
};
for (let i = 0; i < chain.length - 1; i++) contact(chain[i], chain[i + 1]);
for (let i = chain.length - 2; i >= 0; i--) contact(chain[i], chain[i + 1]);
```

The real `resolveChain` also wakes resting sheets it pushes, and retargets a settling sheet blocked by a resting one so the loop can go to sleep. The same neighbour angles limit each sheet's bend, so a bent page's edge stays between its neighbours too.

### 6. Closing the cover

The cover does not share the pages' axis: open, it hinges on the table; shut, it lies on top of the block. Its hinge travels between the two on a path that bulges round the back of the block, so between the cover and a page the ordering compares **positions against the cover's plane**, not angles:

```math
\text{clearance}(u) = \big(\mathbf{p}_{leaf}(u) - \mathbf{h}_{cover}\big) \cdot (\sin\theta_c,\ -\cos\theta_c)
```

![The cover hinges on a moving point](docs/images/cover-plane.svg)

```ts
coverLimit(i, thetaC) {   // the largest angle leaf i may take under the cover
  const inside = (t) => Math.min(this.clearance(i, t, thetaC, 1), this.clearance(i, t, thetaC, 0.5), this.clearance(i, t, thetaC, 0.25)) >= -1e-4;
  if (inside(thetaC)) return thetaC;
  if (!inside(0)) return 0;
  let lo = 0, hi = thetaC;
  for (let k = 0; k < 14; k++) { const mid = (lo + hi) / 2; if (inside(mid)) lo = mid; else hi = mid; }
  return lo;              // 14 halvings: within 2·10⁻⁴ rad
}
```

While the cover moves, the pages on its side follow it, each a little ahead of the next — `θ_target = θ_cover − fan · depth · sin θ_cover` — so the pages furthest from the cover fall first and all land together.

### 7. Looking thick

- **Stepped fore-edge.** Each sheet reaches a little less far than the one under it: `reach = 1 − 0.006 × (sheets below) + jitter`. Turn pages and one stack's edge grows while the other's shrinks.
- **Gutter.** Within 22 % of the spine a lying page curves up from its binding: `dip = (zFlat − zRoot) · |cos θ| · (1 − (1 − u/0.22)²)`, which meets the flat part with zero slope and shades itself through real normals.
- **Shadows without shadow maps.** A turning page lays a gradient on the stack, opacity `0.42 · sin(θ)^0.6`, fading toward its tip.

![The fore-edge steps back one sheet at a time](docs/images/fore-edge.svg)

### 8. A text field that stays on the paper

A DOM `<input>` cannot follow a bending WebGL mesh — no CSS transform maps a flat box onto a curve. But nobody types into a page while it is turning. So the page has two states:

| | the paper | the HTML page |
| --- | --- | --- |
| **still** | blank paper | laid exactly over the page: real, focusable, typeable |
| **moving** | a print of the HTML, typed value included | invisible (`opacity: 0`, `inert`) |

![Resting and moving](docs/images/rest-and-move.svg)

**Placing it.** Three points of the HTML page are pushed through the CPU copy of the shader's `bent()`, the book's matrix and the camera; their screen positions give a scale and a translate:

```ts
const a = facePoint(face, 0.2 * w, 0), b = facePoint(face, 0.8 * w, 0), c = facePoint(face, 0.2 * w, h);
const sx = (b.x - a.x) / (0.6 * w), sy = (c.y - a.y) / h;
page.style.transform = `translate(${a.x - 0.2 * w * sx}px, ${a.y}px) scale(${sx}, ${sy})`;
```

![Three points of the page, followed through the shader's maths](docs/images/face-transform.svg)

**Before anything moves** — synchronously, in the same pointer or key handler:

```ts
function leaveResting() {
  input.blur();                  // commit IME text, drop the focus ring
  book.repaintFace(FACE);        // paper + printDom(page): the HTML becomes ink (~0.6 ms)
  book.showFace(FACE, "print");
  page.classList.add("asleep");  // opacity 0, but still laid out so it can be printed
  page.inert = true;
}
```

**Printing text to the pixel.** `printDom` asks the browser where every word already is, then places the baseline by splitting that box in the font's ascent : descent ratio:

```ts
range.setStart(node, start);
range.setEnd(node, start + word.length);
const rect = range.getClientRects()[0];
const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = g.measureText(word);
g.fillText(word, X(rect.left), Y(rect.top) + (H(rect.height) * ascent) / (ascent + descent));
```

**Back at rest**, the HTML comes back, the paper under it turns blank (otherwise every letter is drawn twice), and the loop draws **one more frame**, because the swap happened after the last frame was drawn. On the demo the live page and its print differ by 1.6/255 per pixel on average, only at glyph edges. The [full walk-through](docs/html-on-paper.md) covers the options, the pitfalls and the tests.

### 9. Drawing only when something moves

```ts
idle() {
  return !this.active && !this.bundle && this.pending.length === 0 &&
    this.chain.every((s) => s.mode === "rest" && Math.abs(s.bend) < 0.01);
}
```

The loop requests another frame only while the book is not idle; input, resizes and loaded textures wake it. A settle ends when |θ − target| < 0.0015 and |ω| < 0.02 and snaps to exactly 0 or π, which keeps the ordering exact and lets the loop sleep.

---

## Develop

```bash
npm install
npm run dev      # the demo, with a tuning panel
npm test         # 23 unit tests: springs, dragging, flicks, catching, closing, geometry probes
npm run verify   # builds, then drives the demo in headless Chrome: 18 checks, incl. 60 fps and the live HTML page
```

`npm run verify` needs Google Chrome (set `CHROME_PATH` if it is not in the default macOS location).

```
src/mount.ts     mountBook(): the one-call setup
src/engine/      the physics (pure TypeScript, tested)
src/render/      book.ts: three.js model and bending shader · print-dom.ts: HTML → canvas
demo/            the demo page: tuning panel, reading view, live HTML page
examples/        the example above
verify/          end-to-end checks in headless Chrome
docs/            the article, the maths, HTML on paper, diagrams
```

## Limits

Touch is implemented but not yet tuned on real devices; pages bend along their width only (no corner curl); WebGL is required; moving text is a 768-pixel texture, softer than live text. [More](docs/how-it-works.md#15-limits).

## Credits

Cloth and page-edge textures: [Book Pattern](https://polyhaven.com/a/book_pattern) by Rob Tuytel, Poly Haven (CC0). Rendering: [three.js](https://threejs.org/). The angular ordering of sheets was used earlier by [3D FlipBook](https://github.com/iberezansky/flip-book-jquery); more related work in the [article](docs/how-it-works.md#16-credits-and-related-work).

## License

[MIT](LICENSE). Textures CC0.
