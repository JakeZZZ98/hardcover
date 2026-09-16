import { springStep } from "./engine";
import { createBook, type Book, type BookOptions, type BookView } from "./render/book";

/**
 * The one-call setup: a book on a canvas with everything wired — pointer
 * dragging, keyboard, resizing, framing that follows the cover, and a render
 * loop that runs only while something moves.
 *
 *   const { book } = mountBook(canvas, { leaves: 6, title: "MY BOOK", paintFace });
 *
 * For custom camera work or live HTML on a page, use `createBook` directly
 * (see demo/main.ts).
 */

export interface MountOptions extends BookOptions {
  /** Arrow keys / Page Up / Page Down turn pages, Esc closes, Enter opens (when the canvas has focus). Default true. */
  keyboard?: boolean;
}

export interface MountedBook {
  book: Book;
  /** Draw again on the next frame — after changing `book.engine.params` or repainting a face. */
  wake(): void;
  destroy(): void;
}

export function mountBook(canvas: HTMLCanvasElement, options: MountOptions = {}): MountedBook {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const book = createBook(canvas, { reduced: () => reducedMotion.matches, ...options });
  const engine = book.engine;
  const leaves = engine.leaves.length;

  // Framing: shut = the cover centred, open = the spine centred. It follows the cover once the cover lands,
  // never during a drag (moving the camera under the finger would move the page under it too).
  let openTarget = engine.closed ? 0 : 1;
  const view: BookView = { cover: openTarget, shift: openTarget, zoom: 0, open: openTarget, leanX: 0, leanY: 0, curl: 1 };
  const velocity = { cover: 0, shift: 0, open: 0 };
  const stepView = (dt: number) => {
    if (engine.cover.mode === "rest") openTarget = engine.closed ? 0 : 1;
    let moving = false;
    for (const key of ["cover", "shift", "open"] as const) {
      if (reducedMotion.matches) {
        view[key] = openTarget;
        velocity[key] = 0;
        continue;
      }
      [view[key], velocity[key]] = springStep(view[key], velocity[key], openTarget, 1, 0.7, dt);
      if (Math.abs(view[key] - openTarget) < 5e-4 && Math.abs(velocity[key]) < 5e-3) {
        view[key] = openTarget;
        velocity[key] = 0;
      } else moving = true;
    }
    return moving;
  };

  // The loop runs only while something moves.
  let raf = 0;
  let last = 0;
  let invalidated = false;
  const loop = (now: number) => {
    raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const viewMoving = stepView(dt);
    invalidated = false;
    book.frame(dt, view);
    if (book.turning() || viewMoving || invalidated) raf = requestAnimationFrame(loop);
  };
  const wake = () => {
    invalidated = true;
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  book.onInvalidate(wake);

  // Calls from your code (book.turnTo(3), book.setCoverOpen(false), a repainted face) wake the loop too.
  for (const name of ["turnTo", "setCoverOpen", "repaintFace", "refreshFace", "showFace"] as const) {
    const original = book[name] as (...args: never[]) => void;
    (book as unknown as Record<string, unknown>)[name] = (...args: never[]) => {
      original(...args);
      wake();
    };
  }

  // Pointer: press on the paper (or the cover's edge), drag, let go.
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  let dragging: number | null = null;
  const onDown = (e: PointerEvent) => {
    if (dragging !== null || !book.pointerDown(...local(e))) return;
    e.preventDefault();
    dragging = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = "grabbing";
    wake();
  };
  const onMove = (e: PointerEvent) => {
    if (dragging === e.pointerId) {
      book.pointerMove(...local(e));
      wake();
    } else if (dragging === null) {
      canvas.style.cursor = book.hit(...local(e)) ? "grab" : "";
    }
  };
  const onUp = (e: PointerEvent) => {
    if (dragging !== e.pointerId) return;
    dragging = null;
    canvas.style.cursor = "";
    if (e.type === "pointercancel") book.pointerCancel();
    else book.pointerUp(...local(e));
    wake();
  };

  const onKey = (e: KeyboardEvent) => {
    const turned = book.turnedCount();
    if (e.key === "ArrowRight" || e.key === "PageDown") {
      if (engine.closed) book.setCoverOpen(true);
      else book.turnTo(Math.min(leaves, turned + 1));
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") book.turnTo(Math.max(0, turned - 1));
    else if (e.key === "Enter") book.setCoverOpen(true);
    else if (e.key === "Escape") book.setCoverOpen(false);
    else return;
    e.preventDefault();
    wake();
  };

  canvas.style.touchAction = "none"; // a horizontal drag on the paper is a page turn, not a scroll
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  if (options.keyboard !== false) {
    if (!canvas.hasAttribute("tabindex")) canvas.tabIndex = 0;
    canvas.addEventListener("keydown", onKey);
  }
  const resize = new ResizeObserver(() => {
    book.resize();
    wake();
  });
  resize.observe(canvas);
  wake();

  return {
    book,
    wake,
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("keydown", onKey);
      book.dispose();
    },
  };
}
