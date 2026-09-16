/**
 * Print a DOM page into a canvas, from its live layout.
 *
 * While a page lies still, real HTML sits on top of the paper — crisp,
 * selectable, focusable, with the browser's own caret. The moment the paper
 * has to move, the same page is printed into the sheet's texture and the DOM
 * is put away, so the paper that turns carries exactly what was on it, typed
 * values included.
 *
 * Not a general HTML renderer: it draws text (word by word, where the browser
 * laid it out), background fills with their radius, borders, text inputs,
 * textareas and selects (value or placeholder), checkboxes and underlines.
 * Because every position is read back from the browser's layout, the print
 * and the page agree to the pixel. The root may be scaled (uniformly per axis),
 * but it must be laid out: hide it with opacity, not `display: none`.
 */

const visibleColour = (value: string) => Boolean(value) && value !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(value);

function fontOf(style: CSSStyleDeclaration, k: number) {
  const size = Number.parseFloat(style.fontSize) * k;
  return `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
}

function applyText(g: CanvasRenderingContext2D, style: CSSStyleDeclaration, k: number) {
  g.font = fontOf(style, k);
  const spacing = style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing) * k;
  if ("letterSpacing" in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing}px`;
  g.textBaseline = "alphabetic";
  g.textAlign = "left";
}

const transformText = (text: string, style: CSSStyleDeclaration) =>
  style.textTransform === "uppercase" ? text.toUpperCase() : style.textTransform === "lowercase" ? text.toLowerCase() : text;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

/**
 * Draw `root` (a page `pageWidth × pageHeight` CSS pixels, possibly scaled on screen) onto `g`,
 * whose canvas is `canvasWidth` pixels wide. The paper is expected to be painted already.
 */
export function printDom(root: HTMLElement, g: CanvasRenderingContext2D, canvasWidth: number, pageWidth: number, pageHeight: number) {
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width < 1 || rootRect.height < 1) return;
  const scaleX = rootRect.width / pageWidth;
  const scaleY = rootRect.height / pageHeight;
  const k = canvasWidth / pageWidth;
  const X = (x: number) => ((x - rootRect.left) / scaleX) * k;
  const Y = (y: number) => ((y - rootRect.top) / scaleY) * k;
  const W = (w: number) => (w / scaleX) * k;
  const H = (h: number) => (h / scaleY) * k;

  const skip = (el: Element) => {
    const style = getComputedStyle(el);
    return style.display === "none" || style.visibility === "hidden" || (el as HTMLElement).dataset.print === "skip";
  };

  const drawElement = (el: HTMLElement) => {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const x = X(r.left);
    const y = Y(r.top);
    const w = W(r.width);
    const h = H(r.height);
    const radius = Number.parseFloat(style.borderTopLeftRadius) * k;

    if (visibleColour(style.backgroundColor)) {
      g.fillStyle = style.backgroundColor;
      roundRect(g, x, y, w, h, radius);
      g.fill();
    }
    const border = (width: string, colour: string, draw: (t: number) => void) => {
      const t = Number.parseFloat(width) * k;
      if (t > 0 && visibleColour(colour)) {
        g.fillStyle = colour;
        draw(t);
      }
    };
    if (radius > 0 && Number.parseFloat(style.borderTopWidth) > 0 && visibleColour(style.borderTopColor)) {
      g.strokeStyle = style.borderTopColor;
      g.lineWidth = Number.parseFloat(style.borderTopWidth) * k;
      roundRect(g, x + g.lineWidth / 2, y + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, radius);
      g.stroke();
    } else {
      border(style.borderTopWidth, style.borderTopColor, (t) => g.fillRect(x, y, w, t));
      border(style.borderRightWidth, style.borderRightColor, (t) => g.fillRect(x + w - t, y, t, h));
      border(style.borderLeftWidth, style.borderLeftColor, (t) => g.fillRect(x, y, t, h));
      border(style.borderBottomWidth, style.borderBottomColor, (t) => g.fillRect(x, y + h - t, w, t));
    }

    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      const s = Math.min(w, h);
      g.fillStyle = el.checked ? style.accentColor && style.accentColor !== "auto" ? style.accentColor : "#000" : "#fff";
      roundRect(g, x, y, s, s, 2 * k);
      g.fill();
      if (el.checked) {
        g.strokeStyle = "#fff";
        g.lineWidth = 1.6 * k;
        g.beginPath();
        g.moveTo(x + s * 0.22, y + s * 0.52);
        g.lineTo(x + s * 0.42, y + s * 0.72);
        g.lineTo(x + s * 0.78, y + s * 0.3);
        g.stroke();
      } else {
        g.strokeStyle = "#767676";
        g.lineWidth = 1 * k;
        g.stroke();
      }
      return;
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
      const value = el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.textContent ?? "") : el.value;
      const text = value || (el instanceof HTMLSelectElement ? "" : el.placeholder);
      if (!text) return;
      const colour = value || el instanceof HTMLSelectElement ? style.color : getComputedStyle(el, "::placeholder").color;
      applyText(g, style, k);
      g.fillStyle = colour;
      const padL = (Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.borderLeftWidth)) * k;
      const padR = (Number.parseFloat(style.paddingRight) + Number.parseFloat(style.borderRightWidth)) * k;
      const padT = (Number.parseFloat(style.paddingTop) + Number.parseFloat(style.borderTopWidth)) * k;
      const padB = (Number.parseFloat(style.paddingBottom) + Number.parseFloat(style.borderBottomWidth)) * k;
      const metrics = g.measureText(text);
      const ascent = metrics.fontBoundingBoxAscent ?? Number.parseFloat(style.fontSize) * k * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? Number.parseFloat(style.fontSize) * k * 0.2;
      const contentW = w - padL - padR;
      const tx = style.textAlign === "center" ? x + padL + (contentW - metrics.width) / 2 : style.textAlign === "right" || style.textAlign === "end" ? x + w - padR - metrics.width : x + padL;
      const centre = y + padT + (h - padT - padB) / 2;
      g.save();
      g.beginPath();
      g.rect(x + padL, y, contentW, h);
      g.clip();
      g.fillText(text, tx, centre + (ascent - descent) / 2);
      g.restore();
    }
  };

  // Elements first (fills, rules, fields), then every text node on top.
  const hidden = new Set<Element>();
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (hidden.has(el.parentElement as Element) || skip(el)) {
      hidden.add(el);
      continue;
    }
    if (el instanceof SVGElement || el.tagName === "OPTION") continue;
    drawElement(el);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement;
    if (!parent || hidden.has(parent) || parent.closest("select, option, textarea, svg")) continue;
    if (!node.data.trim()) continue;
    const style = getComputedStyle(parent);
    if (!visibleColour(style.color)) continue;
    applyText(g, style, k);
    g.fillStyle = style.color;
    const underline = style.textDecorationLine.includes("underline");
    for (const match of node.data.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      range.setStart(node, start);
      range.setEnd(node, start + match[0].length);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      const word = transformText(match[0], style);
      const metrics = g.measureText(word);
      const ascent = metrics.fontBoundingBoxAscent ?? Number.parseFloat(style.fontSize) * k * 0.8;
      const descent = metrics.fontBoundingBoxDescent ?? Number.parseFloat(style.fontSize) * k * 0.2;
      // The browser's line box for the word, split by the font's ascent and descent, gives the baseline.
      const top = Y(rect.top);
      const baseline = top + (H(rect.height) * ascent) / (ascent + descent);
      const left = X(rect.left);
      g.fillText(word, left, baseline);
      if (underline) g.fillRect(left, baseline + 2 * k, W(rect.width), Math.max(1, k * 0.8));
    }
  }
  range.detach();
}
