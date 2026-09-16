import type { BookGeometry, BookParams } from "./types";

/** The hand-feel tuned by hand in the prototype: quick to follow, a soft landing, a light flick. */
export const DEFAULT_PARAMS: BookParams = {
  follow: 40,
  damping: 0.82,
  response: 0.5,
  flick: 1.2,
  threshold: 0.5,
  kick: 12,
  curl: 0.32,
  lag: 0.12,
  bendResponse: 0.09,
  spread: 0.7,
  coverDamping: 0.92,
  coverResponse: 0.72,
  fan: 0.16,
};

/**
 * How far from the spine the gutter reaches, as a fraction of the page width.
 * Shared by the engine's clearance test and the renderer's vertex shader, so
 * the paper the physics reasons about is the paper that gets drawn.
 */
export const GUTTER_SPAN = 0.22;

export interface GeometryInput {
  H: number;
  boardT: number;
  leafT: number;
  fillR: number;
  /** Turnable leaves plus endpapers: how many sheets the shut cover sits on top of. */
  sheetsUnderCover: number;
  gutter: number;
  /** Half the open spine width: the boards' hinges sit at ±hinge when the book lies open. */
  hinge: number;
  /** How far the cover reaches past the page: the square plus the joint. */
  overhang?: number;
  bulge?: number;
}

/**
 * A hardcover's layout: hinges at ±hinge when open, both pulled to just
 * outside the block's back (x = −0.005) when shut; the shut cover rests 1 mm
 * above the block's flat top (which includes the gutter rise).
 */
export function makeGeometry({ H, boardT, leafT, fillR, sheetsUnderCover, gutter, hinge, overhang = 0.025, bulge = 0.02 }: GeometryInput): BookGeometry {
  const zClosed = boardT + (fillR + sheetsUnderCover) * leafT + gutter + 0.001;
  return {
    W: 1,
    H,
    coverW: 1 + overhang,
    boardT,
    leafT,
    fillR,
    gutter,
    hingeOpen: { x: -hinge, z: boardT },
    hingeClosed: { x: -0.005, z: zClosed },
    bulge,
  };
}
