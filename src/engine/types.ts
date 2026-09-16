/**
 * Types for the book engine.
 *
 * The engine knows nothing about a renderer or a UI framework. Every sheet is
 * a hinge angle about the spine, in radians: 0 = lying on the right,
 * π = lying on the left. Lengths are in page widths (a page is 1 wide, `H` tall).
 */

/** The hand-feel. Springs use Apple's pair: a damping ratio and a response in seconds. */
export interface BookParams {
  /** Follow spring while dragging, ms (0 = the sheet moves in the same frame as the pointer). */
  follow: number;
  /** Settle spring after release: damping ratio (1 = critically damped) … */
  damping: number;
  /** … and response, seconds. */
  response: number;
  /** A release faster than this (page widths per second) turns the page whatever its progress. */
  flick: number;
  /** A slow release past this progress (0..1) completes the turn; short of it the page falls back. */
  threshold: number;
  /** Cap on the angular velocity handed to the settle spring, rad/s. */
  kick: number;
  /** Lift curl: how much the root lags the tip while a page lifts (× sin 2θ), radians. Negative = the tip droops. */
  curl: number;
  /** Motion lag: bend = −lag × smoothed angular velocity (the tip trails the root). */
  lag: number;
  /** Time constant of the bend's low-pass, seconds. */
  bendResponse: number;
  /** Rows far from the grab point bend this much more (× |y − grabY|), so the grabbed corner leads. */
  spread: number;
  /** The cover's own settle spring (it is heavier than a page). */
  coverDamping: number;
  coverResponse: number;
  /** Closing: the sheets inside fall ahead of the cover by this much per sheet (× sin θ), radians. */
  fan: number;
}

/**
 * The physical layout the engine shares with the renderer: where sheets are
 * bound, how high they lie, where the cover hinges. World units = page widths.
 */
export interface BookGeometry {
  /** Page width (always 1) and height. */
  W: number;
  H: number;
  /** The cover's width: the page plus the square (the board's overhang) plus the joint. */
  coverW: number;
  /** Board thickness; the sheets start above it. */
  boardT: number;
  /** One sheet's thickness. */
  leafT: number;
  /** Fixed sheets under the turnable ones on the right (the rest of the text block). */
  fillR: number;
  /** Gutter depth: a resting sheet rises this much from its binding to its flat part. */
  gutter: number;
  /** The front cover's hinge when the book lies open … */
  hingeOpen: { x: number; z: number };
  /** … and when it is shut on top of the block. */
  hingeClosed: { x: number; z: number };
  /** Half-way, the hinge bulges outward by this much (the spine cloth wraps the back). */
  bulge: number;
}

export type SheetMode = "rest" | "drag" | "settle" | "bundle";

/** One hinged sheet: a turnable leaf, an endpaper, or the cover. */
export interface Sheet {
  /** Leaves: 0 … n−1 from the front; endpapers: 100 + k; the cover: −1. */
  index: number;
  isCover: boolean;
  theta: number;
  omega: number;
  mode: SheetMode;
  /** Settle target, 0 or π. */
  target: number;
  /** Which side it lay on when grabbed. */
  origin: number;
  /** Smoothed angular velocity that drives the motion lag. */
  bend: number;
  /** Where along the height it was grabbed, −0.5 … 0.5. */
  grabY: number;
  /** Bend limits from the neighbours in the stack, radians (set every step). */
  bendMin: number;
  bendMax: number;
  /* drag bookkeeping */
  grabX0: number;
  px0: number;
  thetaTarget: number;
}

export interface BookSnapshot {
  leaves: number[];
  cover: number;
}

export interface BookEngineOptions {
  leafCount: number;
  /** Sheets glued into the cover's side that open and close with it (the flyleaf). 0 for none. */
  endpaperCount?: number;
  params?: Partial<BookParams>;
  geometry: BookGeometry;
  /** Read every step: when true, settles land at once (prefers-reduced-motion). */
  reduced?: () => boolean;
}
