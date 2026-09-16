# hardcover

A hardcover book for the web whose pages you can **drag, flick, catch mid-air and pull shut** — a small, dependency-free physics engine and a three.js renderer.

![A page being dragged, flicked, caught and the book closed](docs/images/hero.webp)

**[Live demo](https://jakezzz98.github.io/hardcover/)** · **[How it works](docs/how-it-works.md)** · **[The maths](docs/math.md)** · **[HTML on a turning page](docs/html-on-paper.md)**

## What it does

- **Follows the hand.** Grab the paper anywhere; the edge you hold stays under the pointer and the corner you hold leads the bend.
- **Flicks and falls back.** A quick throw turns a page; a slow release turns it past half-way and drops it back otherwise.
- **Interruptible.** Catch a page while it is still in the air and pull it either way.
- **A real hardcover.** Cloth boards, a spine that wraps the block when shut, headbands, a ribbon, a gutter, and a fore-edge that visibly thickens on one side as you read.
- **Closes like a book.** Pull the cover's edge (or press Esc) and the turned pages ride along with it, innermost first, without ever passing through it.
- **Real HTML on a page.** While the book is still, a page can be live HTML — a form you can type into. When it moves, it is printed into the paper.
- **Quiet when still.** No animation frames at all while nothing moves.
- Mouse, trackpad, touch (Pointer Events) and keyboard; honours `prefers-reduced-motion`.

## Run it

```bash
npm install
npm run dev        # the demo at http://localhost:5173
npm test           # 23 engine tests, no browser needed
npm run verify     # builds, then drives the demo in headless Chrome (see verify/run.mjs)
```

`npm run verify` needs Google Chrome; set `CHROME_PATH` if it is not in the default macOS location.

## Use it

It is not on npm yet — copy `src/` into your project (it only needs `three`). The smallest setup ([examples/minimal.ts](examples/minimal.ts)):

```ts
import { createBook, type BookView } from "./src/render/book";

const canvas = document.querySelector("canvas")!;
const book = createBook(canvas, {
  leaves: 6,
  title: "MY BOOK",
  startOpen: true,
  paintFace(g, width, height, { face }) {
    g.font = `${Math.round(width / 14)}px Georgia, serif`;
    g.fillStyle = "#2b2620";
    g.fillText(`Page ${face + 1}`, width * 0.12, height * 0.14);
  },
});

const view: BookView = { cover: 1, shift: 1, zoom: 0, open: 1, leanX: 0, leanY: 0, curl: 1 };

// Draw only while something moves.
let raf = 0;
let last = performance.now();
function loop(now: number) {
  raf = 0;
  book.frame((now - last) / 1000, view);
  last = now;
  if (book.turning()) raf = requestAnimationFrame(loop);
}
function wake() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(loop);
}
book.onInvalidate(wake);

canvas.addEventListener("pointerdown", (e) => {
  if (book.pointerDown(e.offsetX, e.offsetY)) canvas.setPointerCapture(e.pointerId);
  wake();
});
canvas.addEventListener("pointermove", (e) => {
  book.pointerMove(e.offsetX, e.offsetY);
  wake();
});
canvas.addEventListener("pointerup", (e) => {
  book.pointerUp(e.offsetX, e.offsetY);
  wake();
});
wake();
```

Serve the textures in `public/textures/book-pattern/` and point `texturesUrl` at them. The [demo](demo/main.ts) adds camera springs for opening and closing, keyboard control, a tuning panel and a live HTML page.

**Only want the physics?** `src/engine/` has no dependencies and no renderer. Every sheet is a hinge angle you can draw however you like:

```ts
import { BookEngine, makeGeometry } from "./src/engine";

const engine = new BookEngine({
  leafCount: 6,
  endpaperCount: 1,
  geometry: makeGeometry({ H: 1.48, boardT: 0.03, leafT: 0.0025, fillR: 14, sheetsUnderCover: 7, gutter: 0.025, hinge: 0.035 }),
});

engine.grab(0.8, 0);          // pointer x across the spread (−1 … 1), y along the page
engine.move(0.2);
engine.release(-2.5);         // page widths per second: a flick to the left
engine.step(1 / 60);          // advance from your own clock
engine.leaves[0].theta;       // 0 = lying right … π = lying left
engine.bendOf(engine.leaves[0]); // the arc to draw it with
```

## Docs

- **[How it works](docs/how-it-works.md)** — the long read: what it had to feel like, the one-angle-per-sheet model, following the hand, flicks, catching, bending, the stacking order, closing, thickness, HTML on the paper, testing.
- **[The maths](docs/math.md)** — every formula derived: the drag mapping, spring parameters and why the integrator needs a step limit, the release velocity, the arc a page bends into, why the bend cannot cross a neighbour, the stacking order as inelastic contact, the cover's moving hinge and plane, fore-edge and shadows, placing HTML with a projection.
- **[Keeping HTML on a turning page](docs/html-on-paper.md)** — how a text field sits on the paper, typeable at rest and carried on the page while it turns: the options, the two states, the order of operations, how the printer lines text up to the pixel, pitfalls and tests.

## Layout

```
src/engine/        the physics: angles, springs, the stacking order, the cover (pure TS, tested)
src/render/        book.ts — three.js modelling and the bending-sheet shader; print-dom.ts — HTML → canvas
demo/              the demo page: pointer and keyboard wiring, view springs, tuning panel, page content
examples/          the minimal example above
verify/            end-to-end checks in headless Chrome over the DevTools protocol
docs/              how-it-works.md and its diagrams
public/textures/   Poly Haven "Book Pattern" (CC0)
```

## Limits

Touch input is implemented but not yet tuned on real devices, and there is no small-screen layout. Pages bend along their width only (no corner curl). WebGL is required. See [Limits](docs/how-it-works.md#15-limits) for the full list.

## Credits

Cloth and page-edge textures: [Book Pattern](https://polyhaven.com/a/book_pattern) by Rob Tuytel, Poly Haven (CC0). Rendering: [three.js](https://threejs.org/). Related work is credited in the [article](docs/how-it-works.md#16-credits-and-related-work).

## License

[MIT](LICENSE). Textures are CC0 (see `public/textures/book-pattern/LICENSE.md`).
