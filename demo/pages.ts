import type { FaceInfo } from "../src/render/book";

/**
 * What the demo book says. Every face is drawn on a 768-wide canvas in the
 * 500 × 740 "CSS page" units of the live page, scaled by k. The live page
 * itself is HTML (index.html) and is printed from its own layout.
 */

export const LEAVES = 6;
/** Page size in CSS pixels for the DOM page that lies on the paper. */
export const DOM_W = 500;
export const DOM_H = 740;
/** The face that carries a live HTML form (the right page of the second spread). */
export const FORM_FACE = 3;

const INK = "#2B2620";
const SOFT = "#6F6558";
const ACCENT = "#8A2F3A";
const SERIF = 'Georgia, "Times New Roman", serif';

type Block = { kind: "eyebrow" | "title" | "text" | "small" | "rule" | "mono"; text?: string };

const PAGES: Record<number, Block[]> = {
  0: [
    { kind: "eyebrow", text: "An open-source book" },
    { kind: "title", text: "hardcover" },
    { kind: "text", text: "A book for the web you can hold with a pointer. Every sheet is one angle about the spine, a spring, and a little arc." },
    { kind: "rule" },
    { kind: "small", text: "Use a mouse, a trackpad or a finger. Keys work too: ← → to turn, Esc to close, Z for the reading view." },
  ],
  1: [
    { kind: "eyebrow", text: "1 · Drag" },
    { kind: "title", text: "Take the paper anywhere" },
    { kind: "text", text: "Grab this page wherever you like and pull it across. The edge stays under your finger; the corner you hold leads the bend." },
    { kind: "small", text: "Let go past the middle and it turns. Short of it, it falls back." },
  ],
  2: [
    { kind: "eyebrow", text: "2 · Flick" },
    { kind: "title", text: "Throw it" },
    { kind: "text", text: "A quick flick turns a page even if you barely moved it. Speed decides before distance does." },
    { kind: "small", text: "The release speed becomes the page's angular velocity, so a hard throw lands with a little overshoot." },
  ],
  4: [
    { kind: "eyebrow", text: "3 · Catch" },
    { kind: "title", text: "Grab it mid-air" },
    { kind: "text", text: "Flick a page and catch it before it lands. It stops in your hand. Pull it back, or let it go again." },
    { kind: "small", text: "Nothing has to finish playing before you can touch it." },
  ],
  5: [
    { kind: "eyebrow", text: "4 · Close" },
    { kind: "title", text: "Shut the book" },
    { kind: "text", text: "Pull the cover's edge (outside the pages, on the left) across, or press Esc. The pages you turned ride along, innermost first." },
    { kind: "small", text: "Tap the shut book to open it again." },
  ],
  6: [
    { kind: "eyebrow", text: "Under the hood" },
    { kind: "title", text: "One number per sheet" },
    { kind: "mono", text: "θ = 0      lying right" },
    { kind: "mono", text: "θ = π      lying left" },
    { kind: "text", text: "A drag sets a target angle, a spring chases it, and a release hands the spring a velocity." },
  ],
  7: [
    { kind: "eyebrow", text: "No collisions in 3D" },
    { kind: "title", text: "An ordering instead" },
    { kind: "mono", text: "cover ≥ flyleaf ≥ p1 ≥ p2 ≥ … ≥ 0" },
    { kind: "text", text: "All sheets turn about the same spine, so “never pass through” is one inequality per neighbour, fixed up every step." },
  ],
  8: [
    { kind: "eyebrow", text: "The fore-edge" },
    { kind: "title", text: "You can see which side is thicker" },
    { kind: "text", text: "Each sheet reaches a little less far than the one beneath it, so the stack shows its layers. Turn pages and watch the stack move." },
  ],
  12: [
    { kind: "eyebrow", text: "Fin" },
    { kind: "title", text: "Read how it works" },
    { kind: "text", text: "The article in the repository walks through the model, the physics, the shader and the tests." },
  ],
};

function wrap(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function pageNumber(g: CanvasRenderingContext2D, face: number, k: number, gutter: "left" | "right") {
  g.font = `400 ${13 * k}px ${SERIF}`;
  g.fillStyle = SOFT;
  g.textAlign = gutter === "left" ? "right" : "left";
  g.fillText(String(face + 1), gutter === "left" ? (DOM_W - 48) * k : 48 * k, (DOM_H - 40) * k);
  g.textAlign = "left";
}

/** `printLive` draws the HTML page that lives on FORM_FACE. */
export function makePaintFace(printLive: (g: CanvasRenderingContext2D, width: number) => void) {
  return (g: CanvasRenderingContext2D, width: number, _height: number, info: FaceInfo) => {
    const k = width / DOM_W;
    const x = 56 * k;
    const maxW = (DOM_W - 112) * k;
    if (info.face === FORM_FACE) {
      printLive(g, width);
      return;
    }
    const blocks = PAGES[info.face];
    if (blocks) {
      let y = 92 * k;
      g.textBaseline = "alphabetic";
      for (const b of blocks) {
        switch (b.kind) {
          case "eyebrow":
            g.font = `600 ${12 * k}px ${SERIF}`;
            g.fillStyle = ACCENT;
            g.fillText(b.text!.toUpperCase(), x, y);
            y += 58 * k;
            break;
          case "title":
            g.font = `400 ${36 * k}px ${SERIF}`;
            g.fillStyle = INK;
            for (const line of wrap(g, b.text!, maxW)) {
              g.fillText(line, x, y);
              y += 44 * k;
            }
            y += 18 * k;
            break;
          case "text":
            g.font = `400 ${19 * k}px ${SERIF}`;
            g.fillStyle = INK;
            for (const line of wrap(g, b.text!, maxW)) {
              g.fillText(line, x, y);
              y += 30 * k;
            }
            y += 20 * k;
            break;
          case "small":
            g.font = `italic 400 ${16 * k}px ${SERIF}`;
            g.fillStyle = SOFT;
            for (const line of wrap(g, b.text!, maxW)) {
              g.fillText(line, x, y);
              y += 25 * k;
            }
            y += 18 * k;
            break;
          case "mono":
            g.font = `400 ${16 * k}px ui-monospace, Menlo, monospace`;
            g.fillStyle = ACCENT;
            g.fillText(b.text!, x, y);
            y += 30 * k;
            break;
          case "rule":
            g.fillStyle = "rgba(43,38,32,0.25)";
            g.fillRect(x, y - 8 * k, 64 * k, 1.5 * k);
            y += 34 * k;
            break;
        }
      }
    } else {
      // Pages without words get a quiet ornament.
      g.strokeStyle = "rgba(138,47,58,0.35)";
      g.lineWidth = 1.2 * k;
      const cx = (DOM_W / 2) * k;
      const cy = (DOM_H / 2) * k;
      g.beginPath();
      g.moveTo(cx - 40 * k, cy);
      g.lineTo(cx - 8 * k, cy);
      g.moveTo(cx + 8 * k, cy);
      g.lineTo(cx + 40 * k, cy);
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, 3 * k, 0, Math.PI * 2);
      g.stroke();
    }
    pageNumber(g, info.face, k, info.gutter);
  };
}
