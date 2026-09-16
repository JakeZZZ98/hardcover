import { createBook, type BookView } from "../src/render/book";

// The smallest useful setup: an open book, drawn only while something moves.
const canvas = document.querySelector("canvas")!;
const book = createBook(canvas, {
  leaves: 6,
  title: "MY BOOK",
  texturesUrl: "../textures/book-pattern/",
  startOpen: true,
  paintFace(g, width, height, { face }) {
    g.font = `${Math.round(width / 14)}px Georgia, serif`;
    g.fillStyle = "#2b2620";
    g.fillText(`Page ${face + 1}`, width * 0.12, height * 0.14);
  },
});

// A fixed framing for an open book. (The demo animates these with springs as the cover opens and closes.)
const view: BookView = { cover: 1, shift: 1, zoom: 0, open: 1, leanX: 0, leanY: 0, curl: 1 };

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
  if (!book.pointerDown(e.offsetX, e.offsetY)) return;
  canvas.setPointerCapture(e.pointerId);
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
new ResizeObserver(() => {
  book.resize();
  wake();
}).observe(canvas);
wake();
