import * as THREE from "three";
import { BookEngine, GUTTER_SPAN, makeGeometry, PI, smooth01, type BookParams, type Sheet } from "../engine";

/**
 * A hardcover in WebGL — modelling and rendering on top of the book engine.
 *
 * Physics lives in ../engine (pure TS, unit-tested). This file turns its
 * angles into a book: cloth boards (Poly Haven "Book Pattern", CC0) with
 * turn-ins and a paste-down, a spine cloth that lies flat when open and
 * wraps the back when shut, headbands, a ribbon, a paper block whose
 * fore-edge steps back sheet by sheet, and the sheets themselves — one
 * subdivided plane each, bent in the vertex shader from the engine's angle
 * and arc. No shadow map: the gutter shades itself through real normals,
 * turning pages cast a soft gradient, the book sits on a blurred contact
 * shadow.
 *
 * World units: a page is 1 wide. The book lies in the XY plane facing the
 * camera (+z), spine along y at x = 0.
 *
 * Sheets, front to back: the front cover, the flyleaf (an endpaper glued
 * into the cover's side, so it opens and closes with it), then `leaves`
 * turnable leaves, then a fixed text block. Faces are numbered in reading
 * order: face 0 is the flyleaf's back (the first left page), face 2i+1 the
 * front of leaf i, face 2i+2 its back. Spread s shows faces 2s (left) and
 * 2s+1 (right).
 */

/* --------------------------------------------------------------------------- */
/* layout                                                                       */
/* --------------------------------------------------------------------------- */

const PAGE_W = 1.0;
const SQUARE = 0.02;
const BOARD_T = 0.03;
const LEAF_T = 0.0025;
const GUTTER = 0.025;
const HINGE = 0.035;
/** Each sheet in a stack reaches this much less far than the one under it: the fore-edge steps back. */
const REACH_STEP = 0.006;
const CORNER_R = 0.022;
const TURN_IN = 0.05;
const TURN_T = 0.0015;
const OVERHANG = SQUARE + 0.005;
const COVER_W = PAGE_W + OVERHANG;
const SEG_X = 56;
const SEG_Y = 24;
const TEX_W = 768;

/** The resting pose, degrees: the shut book's yaw / pitch / roll, and how far the open book tips back until zoomed in. */
export interface BookPose {
  closedYaw: number;
  closedPitch: number;
  closedRoll: number;
  openTilt: number;
}
const DEFAULT_POSE: BookPose = { closedYaw: 0, closedPitch: -40, closedRoll: 0, openTilt: 22 };

export interface FaceInfo {
  face: number;
  /** The leaf carrying it: −1 is the flyleaf. */
  leaf: number;
  side: "front" | "back";
  /** Which edge of the printed page is the spine. */
  gutter: "left" | "right";
}

export interface BookOptions {
  /** Turnable leaves (default 4). */
  leaves?: number;
  /** Fixed sheets under them on the right (default 14). */
  fixedLeaves?: number;
  /** Page height over width (default 1.48). */
  aspect?: number;
  colors?: Partial<{ cloth: string; paper: string; ribbon: string; foil: string; headband: string }>;
  /** Foil-stamped on the front board; omit for a plain cover. */
  title?: string;
  titleFont?: string;
  /** Where the Book Pattern textures live, with a trailing slash. */
  texturesUrl?: string;
  /** Draw a face's content on top of the paper. `g` is already painted with paper, grain and gutter shade. */
  paintFace?: (g: CanvasRenderingContext2D, width: number, height: number, info: FaceInfo) => void;
  params?: Partial<BookParams>;
  /** Read every step: true lands every settle at once. */
  reduced?: () => boolean;
  pose?: Partial<BookPose>;
  /** Start shut (default) or lying open at the first spread. */
  startOpen?: boolean;
}

export interface BookView {
  /** 0 = shut, 1 = the cover lies open (drives framing; the engine drives the geometry). */
  cover: number;
  /** 0 = the shut book centred, 1 = the spine centred. */
  shift: number;
  /** 0 = the whole open book in view, 1 = the spread fills the stage. */
  zoom: number;
  /** 0 = the shut pose, 1 = lying open (tipped back by `openTilt` degrees until zoomed in). */
  open: number;
  /** Extra lean, degrees. */
  leanX: number;
  leanY: number;
  /** Gutter depth scale, 0..1: pages relax flat while a DOM page lies on them. */
  curl: number;
}

export interface FaceTransform {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}

export interface Book {
  readonly engine: BookEngine;
  readonly faceCount: number;
  /** Draw one frame. `dt` in seconds. */
  frame(dt: number, view: BookView): void;
  /** True while anything in the book is still moving. */
  turning(): boolean;
  turnedCount(): number;
  turnTo(leaves: number): void;
  setCoverOpen(open: boolean, immediate?: boolean): void;
  /** Fires once the sheets settle after a turn, with the leaves now on the left. */
  onLanded(callback: (turned: number) => void): void;
  /** Fires when the book needs a redraw for a reason the engine cannot see (a texture or a font arrived). */
  onInvalidate(callback: () => void): void;
  /** The canvas a face prints into (768 wide, page-shaped). Call `refreshFace` after drawing into it. */
  faceCanvas(face: number): HTMLCanvasElement;
  /** Repaint a face: paper, then `paintFace`. */
  repaintFace(face: number): void;
  /** Upload a face canvas you drew into yourself. */
  refreshFace(face: number): void;
  /** Show the face's print (while it can move) or blank paper (while a DOM page lies on top of it). */
  showFace(face: number, what: "print" | "blank"): void;
  faceShowing(face: number): "print" | "blank";
  /** Where a DOM page of `domW × domH` CSS pixels must sit to cover a face right now, as scale + translate in canvas pixels. */
  faceTransform(face: number, domW: number, domH: number): FaceTransform | null;
  /** Is the canvas point over the book? */
  hit(x: number, y: number): boolean;
  /** Pointer gestures, in canvas CSS pixels. `pointerDown` returns what was grabbed. */
  pointerDown(x: number, y: number): "leaf" | "cover" | "cover-margin" | null;
  pointerMove(x: number, y: number): void;
  /** Let go. `tap` false: a press without movement just drops the sheet instead of turning it. */
  pointerUp(x: number, y: number, tap?: boolean): void;
  pointerCancel(): void;
  dragMoved(): boolean;
  resize(): void;
  dispose(): void;
}

/* --------------------------------------------------------------------------- */
/* textures                                                                     */
/* --------------------------------------------------------------------------- */

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
/** A fixed irregularity per sheet, so the stepped fore-edge does not read as a ruled pattern. */
const jitter = (k: number) => {
  const r = seeded(101 + k * 37);
  return (r() - 0.5) * 0.004;
};

function grainCanvas(size = 256) {
  const rand = seeded(7);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = rand();
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v > 0.5 ? 255 : 90;
    img.data[i + 3] = Math.floor(Math.abs(v - 0.5) * 22);
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.05;
  g.strokeStyle = "#6b5a2c";
  g.lineWidth = 0.6;
  for (let k = 0; k < 90; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const l = 4 + rand() * 14;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return c;
}
let GRAIN: HTMLCanvasElement | null = null;

/** Paper, grain, the shadow that pools toward the spine and the fore-edge line. */
export function paintPaper(g: CanvasRenderingContext2D, width: number, height: number, gutter: "left" | "right", paper = "#F6F2E8") {
  GRAIN ??= grainCanvas();
  g.fillStyle = paper;
  g.fillRect(0, 0, width, height);
  g.save();
  g.fillStyle = g.createPattern(GRAIN, "repeat")!;
  g.fillRect(0, 0, width, height);
  g.restore();
  const gw = width * 0.14;
  const grad = gutter === "left" ? g.createLinearGradient(0, 0, gw, 0) : g.createLinearGradient(width, 0, width - gw, 0);
  grad.addColorStop(0, "rgba(110,90,40,0.10)");
  grad.addColorStop(1, "rgba(110,90,40,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, width, height);
  const ew = Math.round(width * 0.027);
  const eg = gutter === "left" ? g.createLinearGradient(width - ew, 0, width, 0) : g.createLinearGradient(ew, 0, 0, 0);
  eg.addColorStop(0, "rgba(90,70,30,0)");
  eg.addColorStop(1, "rgba(90,70,30,0.22)");
  g.fillStyle = eg;
  g.fillRect(gutter === "left" ? width - ew : 0, 0, ew, height);
  g.fillStyle = "rgba(70,55,25,0.45)";
  g.fillRect(gutter === "left" ? width - 2 : 0, 0, 2, height);
}

function stripesCanvas(colors: string[], size: number) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = 4;
  const g = c.getContext("2d")!;
  for (let k = 0; k < size; k++) {
    g.fillStyle = colors[k % colors.length];
    g.fillRect(k, 0, 1, 4);
  }
  return c;
}

function canvasTexture(canvas: HTMLCanvasElement, { repeat = [1, 1] as [number, number], srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (wrap) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* --------------------------------------------------------------------------- */
/* the bent sheet                                                               */
/* --------------------------------------------------------------------------- */

/**
 * One row of paper (fixed y) is a circular arc that leaves the spine at angle
 * θ and turns by `c` over the page: tangent φ(u) = θ + c·u. Integrating
 * (cos φ, sin φ) gives the closed form below; `c` grows away from the grab
 * row so the grabbed corner leads. The gutter lifts (or drops) the first
 * GUTTER_SPAN of the width from the binding to the sheet's flat height.
 */
const BEND_GLSL = /* glsl */ `
  uniform float uTheta, uBend, uSpread, uGrabY, uZRoot, uZFlat, uW, uH, uReach;
  vec3 bent(vec2 p) {
    float u = p.x / uW;
    float yy = p.y / uH;
    float c = uBend * (1.0 + uSpread * abs(yy - uGrabY));
    c = clamp(c, -uTheta * 0.97, (3.14159265 - uTheta) * 0.97);
    float th = uTheta;
    float L = uW * uReach;
    float x, z;
    if (abs(c) < 1e-4) { x = L * u * cos(th); z = L * u * sin(th); }
    else { x = L * (sin(th + c * u) - sin(th)) / c; z = L * (cos(th) - cos(th + c * u)) / c; }
    float dip = (uZFlat - uZRoot) * abs(cos(th)) * (1.0 - pow(max(0.0, 1.0 - u / ${GUTTER_SPAN.toFixed(4)}), 2.0));
    return vec3(x, p.y, z + uZRoot + dip);
  }
`;

interface SheetUniforms {
  uTheta: { value: number };
  uBend: { value: number };
  uSpread: { value: number };
  uGrabY: { value: number };
  uZRoot: { value: number };
  uZFlat: { value: number };
  uW: { value: number };
  uH: { value: number };
  uReach: { value: number };
  uBack: { value: THREE.Texture };
  uShade: { value: number };
}

/** The same arc as the shader, on the CPU — for placing DOM pages. */
function bentPoint(u: SheetUniforms, px: number, py: number, out: THREE.Vector3) {
  const uu = px / u.uW.value;
  const yy = py / u.uH.value;
  let c = u.uBend.value * (1 + u.uSpread.value * Math.abs(yy - u.uGrabY.value));
  c = Math.max(-u.uTheta.value * 0.97, Math.min((PI - u.uTheta.value) * 0.97, c));
  const th = u.uTheta.value;
  const L = u.uW.value * u.uReach.value;
  let x: number;
  let z: number;
  if (Math.abs(c) < 1e-4) {
    x = L * uu * Math.cos(th);
    z = L * uu * Math.sin(th);
  } else {
    x = (L * (Math.sin(th + c * uu) - Math.sin(th))) / c;
    z = (L * (Math.cos(th) - Math.cos(th + c * uu))) / c;
  }
  const dip = (u.uZFlat.value - u.uZRoot.value) * Math.abs(Math.cos(th)) * (1 - Math.pow(Math.max(0, 1 - uu / GUTTER_SPAN), 2));
  return out.set(x, py, z + u.uZRoot.value + dip);
}

/* --------------------------------------------------------------------------- */
/* board shapes                                                                 */
/* --------------------------------------------------------------------------- */

/** A board: square at the spine, the two outer corners rounded, bevelled all round; x from 0 to w. */
function boardGeometry(w: number, pageH: number) {
  const h = pageH + SQUARE * 2;
  const r = 0.035;
  const bev = 0.006;
  const s = new THREE.Shape();
  s.moveTo(0, -h / 2);
  s.lineTo(w - r, -h / 2);
  s.quadraticCurveTo(w, -h / 2, w, -h / 2 + r);
  s.lineTo(w, h / 2 - r);
  s.quadraticCurveTo(w, h / 2, w - r, h / 2);
  s.lineTo(0, h / 2);
  s.lineTo(0, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: BOARD_T - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 3, curveSegments: 10 });
  g.translate(0, 0, bev);
  return g;
}

/** The cloth folded over the board's inside: a thin frame, outer edge 4 mm in from the board, inner edge TURN_IN in. */
function turnInGeometry(w: number, pageH: number) {
  const h = pageH + SQUARE * 2;
  const o = 0.004;
  const r = 0.031;
  const outer = new THREE.Shape();
  outer.moveTo(0, -h / 2 + o);
  outer.lineTo(w - o - r, -h / 2 + o);
  outer.quadraticCurveTo(w - o, -h / 2 + o, w - o, -h / 2 + o + r);
  outer.lineTo(w - o, h / 2 - o - r);
  outer.quadraticCurveTo(w - o, h / 2 - o, w - o - r, h / 2 - o);
  outer.lineTo(0, h / 2 - o);
  outer.lineTo(0, -h / 2 + o);
  const hole = new THREE.Path();
  const i = TURN_IN;
  const ri = 0.012;
  hole.moveTo(i * 0.6, -h / 2 + i);
  hole.lineTo(w - i - ri, -h / 2 + i);
  hole.quadraticCurveTo(w - i, -h / 2 + i, w - i, -h / 2 + i + ri);
  hole.lineTo(w - i, h / 2 - i - ri);
  hole.quadraticCurveTo(w - i, h / 2 - i, w - i - ri, h / 2 - i);
  hole.lineTo(i * 0.6, h / 2 - i);
  hole.lineTo(i * 0.6, -h / 2 + i);
  outer.holes.push(hole);
  return new THREE.ExtrudeGeometry(outer, { depth: TURN_T, bevelEnabled: false, curveSegments: 8 });
}

/* --------------------------------------------------------------------------- */
/* the book                                                                     */
/* --------------------------------------------------------------------------- */

export function createBook(canvas: HTMLCanvasElement, options: BookOptions = {}): Book {
  const LEAVES = Math.max(1, Math.round(options.leaves ?? 4));
  const FILL_R = Math.max(2, Math.round(options.fixedLeaves ?? 14));
  const PAGE_H = options.aspect ?? 1.48;
  const TEX_H = Math.round((TEX_W * PAGE_H) / PAGE_W);
  const Z_TOP = BOARD_T + (FILL_R + LEAVES + 1) * LEAF_T;
  const BOARD_H = PAGE_H + SQUARE * 2;
  const COLORS = { cloth: "#8A2F3A", paper: "#F6F2E8", ribbon: "#E52B1F", foil: "#E6C47A", headband: "#EE2A1E", ...options.colors };
  const base = options.texturesUrl ?? "textures/book-pattern/";
  const TEXTURES = {
    detail: `${base}book_pattern_detail_1k.jpg`,
    nor: `${base}book_pattern_nor_gl_1k.jpg`,
    rough: `${base}book_pattern_rough_1k.jpg`,
    ao: `${base}book_pattern_ao_1k.jpg`,
    edge: `${base}book_edge_band.jpg`,
  };
  const pose: BookPose = { ...DEFAULT_POSE, ...options.pose };
  const reduced = options.reduced ?? (() => false);
  const FACE_COUNT = 2 * LEAVES + 1;
  const placeOf = (face: number): { leaf: number; side: "front" | "back" } =>
    face === 0 ? { leaf: -1, side: "back" } : { leaf: Math.floor((face - 1) / 2), side: face % 2 === 1 ? "front" : "back" };

  const GEOMETRY = makeGeometry({ H: PAGE_H, boardT: BOARD_T, leafT: LEAF_T, fillR: FILL_R, sheetsUnderCover: LEAVES + 1, gutter: GUTTER, hinge: HINGE, overhang: OVERHANG });

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe6ddc8, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(-1.6, 2.2, 4.5);
  scene.add(sun);

  // Environment: a small studio — a warm grey room and three soft boxes — baked once, for the cloth and the foil.
  {
    const room = new THREE.Scene();
    room.add(new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshStandardMaterial({ color: 0x8a8378, side: THREE.BackSide, roughness: 1 })));
    const softbox = (w: number, h: number, x: number, y: number, z: number, intensity: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e6).multiplyScalar(intensity) }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      room.add(m);
    };
    softbox(4, 3, -3, 3, 4, 3.2);
    softbox(3, 3, 4, 1, 3, 1.4);
    softbox(6, 2, 0, -4, 4, 0.9);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
  }

  const engine = new BookEngine({ leafCount: LEAVES, endpaperCount: 1, geometry: GEOMETRY, reduced, params: options.params });
  engine.restore({ leaves: Array.from({ length: LEAVES }, () => 0), cover: options.startOpen ? PI : 0 });
  const book = new THREE.Group();
  scene.add(book);

  /* ---- materials ------------------------------------------------------------- */
  const loader = new THREE.TextureLoader();
  const disposables: Array<{ dispose(): void }> = [];
  let invalidate: () => void = () => {};
  const tex = (url: string, { srgb = false, repeat = [1, 1] as [number, number] } = {}) => {
    const t = loader.load(url, () => invalidate());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    disposables.push(t);
    return t;
  };
  const clothMaterial = (color: string, repeat: [number, number], extra: THREE.MeshStandardMaterialParameters = {}) => {
    const ao = tex(TEXTURES.ao, { repeat });
    ao.channel = 0;
    return new THREE.MeshStandardMaterial({
      color,
      map: tex(TEXTURES.detail, { repeat }),
      roughness: 1,
      normalMap: tex(TEXTURES.nor, { repeat }),
      normalScale: new THREE.Vector2(1.4, 1.4),
      roughnessMap: tex(TEXTURES.rough, { repeat }),
      aoMap: ao,
      aoMapIntensity: 0.7,
      ...extra,
    });
  };
  const clothMat = clothMaterial(COLORS.cloth, [2.6, 2.6]);
  const spineMat = clothMaterial(COLORS.cloth, [0.3, 2.6], { side: THREE.DoubleSide });
  const ribbonMat = clothMaterial(COLORS.ribbon, [0.4, 3], { side: THREE.DoubleSide });

  const blankCanvas = (gutter: "left" | "right") => {
    const c = document.createElement("canvas");
    c.width = TEX_W;
    c.height = TEX_H;
    paintPaper(c.getContext("2d")!, TEX_W, TEX_H, gutter, COLORS.paper);
    return canvasTexture(c, { wrap: false });
  };
  const blank = { right: blankCanvas("left"), left: blankCanvas("right") };

  const cornerAlpha = (() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = Math.round((256 * PAGE_H) / PAGE_W);
    const g = c.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#fff";
    g.beginPath();
    g.roundRect(0, 0, c.width, c.height, CORNER_R * 256);
    g.fill();
    return new THREE.CanvasTexture(c);
  })();

  /* ---- boards, turn-ins, paste-down, spine ------------------------------------ */
  const boardGeo = boardGeometry(COVER_W, PAGE_H);
  const turnInGeo = turnInGeometry(COVER_W, PAGE_H);
  const backBoard = new THREE.Mesh(boardGeo, clothMat);
  book.add(backBoard);
  {
    const ti = new THREE.Mesh(turnInGeo, clothMat);
    ti.position.z = BOARD_T;
    backBoard.add(ti);
  }
  const coverHinge = new THREE.Group();
  book.add(coverHinge);
  coverHinge.add(new THREE.Mesh(boardGeo, clothMat));
  {
    const ti = new THREE.Mesh(turnInGeo, clothMat);
    ti.position.z = -TURN_T;
    coverHinge.add(ti);
    const pdGeo = new THREE.PlaneGeometry(COVER_W - TURN_IN - TURN_IN * 0.6 + 0.004, BOARD_H - TURN_IN * 2 + 0.004);
    const pd = new THREE.Mesh(pdGeo, new THREE.MeshStandardMaterial({ map: blank.left, roughness: 0.95 }));
    pd.rotation.y = Math.PI;
    pd.position.set(TURN_IN * 0.6 + pdGeo.parameters.width / 2 - 0.002, 0, -0.0006);
    coverHinge.add(pd);
  }

  /* the title, foil-stamped into the front board */
  if (options.title) {
    const text = options.title;
    const font = options.titleFont ?? '600 112px Georgia, "Times New Roman", serif';
    const titleCanvas = document.createElement("canvas");
    titleCanvas.width = 1024;
    titleCanvas.height = 256;
    const titleMask = canvasTexture(titleCanvas, { wrap: false, srgb: false });
    const drawTitle = () => {
      const g = titleCanvas.getContext("2d")!;
      g.fillStyle = "#000";
      g.fillRect(0, 0, titleCanvas.width, titleCanvas.height);
      g.font = font;
      g.textAlign = "center";
      g.textBaseline = "middle";
      if ("letterSpacing" in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "10px";
      g.fillStyle = "#fff";
      g.fillText(text, 512, 128, 980);
      titleMask.needsUpdate = true;
      invalidate();
    };
    drawTitle();
    void document.fonts?.load(font).then(drawTitle).catch(() => {});
    const titleGeo = new THREE.PlaneGeometry(0.62, 0.155);
    // The press: the foil sits in a shallow dent, so a darker rim of cloth shows just below the letters.
    const titlePress = new THREE.Mesh(
      titleGeo,
      new THREE.MeshBasicMaterial({ color: "#2a0c10", alphaMap: titleMask, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
    );
    titlePress.position.set(COVER_W / 2 + 0.0015, PAGE_H * 0.24 - 0.003, BOARD_T + 0.0006);
    coverHinge.add(titlePress);
    // The foil: metallic gold that picks up the studio environment; lit from within so it still reads as gold from above.
    const title = new THREE.Mesh(
      titleGeo,
      new THREE.MeshStandardMaterial({
        color: COLORS.foil,
        metalness: 1,
        roughness: 0.22,
        envMapIntensity: 2.4,
        emissive: COLORS.foil,
        emissiveIntensity: 0.9,
        alphaMap: titleMask,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    title.position.set(COVER_W / 2, PAGE_H * 0.24, BOARD_T + 0.0008);
    coverHinge.add(title);
  }

  // The spine cloth: a quadratic from the back board's hinge to the cover's, bulging round the block's back when shut.
  const SPINE_SEG = 28;
  const spineGeo = new THREE.PlaneGeometry(1, BOARD_H, SPINE_SEG, 1);
  book.add(new THREE.Mesh(spineGeo, spineMat));
  const backHingeX = (thetaC: number) => {
    const m = smooth01(thetaC / PI);
    return GEOMETRY.hingeClosed.x + (HINGE - GEOMETRY.hingeClosed.x) * m;
  };
  const placeCoverAndSpine = (thetaC: number) => {
    const B = engine.coverPlane(thetaC);
    coverHinge.rotation.y = -thetaC;
    coverHinge.position.x = B.x;
    coverHinge.position.z = B.z;
    const m = smooth01(thetaC / PI);
    const A = { x: backHingeX(thetaC), z: BOARD_T * 0.72 };
    const bulge = 0.028 * (1 - m);
    const C = { x: (A.x + B.x) / 2 - bulge, z: (A.z + B.z) / 2 + bulge * 0.3 };
    const pos = spineGeo.attributes.position;
    for (let i = 0; i <= SPINE_SEG; i++) {
      const t = i / SPINE_SEG;
      const it = 1 - t;
      const x = it * it * A.x + 2 * it * t * C.x + t * t * B.x;
      const z = it * it * A.z + 2 * it * t * C.z + t * t * B.z;
      for (let j = 0; j < 2; j++) {
        const k = j * (SPINE_SEG + 1) + i;
        pos.setX(k, x);
        pos.setZ(k, z);
      }
    }
    pos.needsUpdate = true;
    spineGeo.computeVertexNormals();
    backBoard.position.x = A.x;
  };

  /* ---- headbands and the ribbon ------------------------------------------------ */
  const headMat = new THREE.MeshStandardMaterial({ map: canvasTexture(stripesCanvas([COLORS.headband, "#F3ECCF"], 16), { repeat: [3, 1] }), roughness: 0.8 });
  const headH = Z_TOP - BOARD_T + GUTTER * 0.6;
  const headGeo = new THREE.CylinderGeometry(0.009, 0.009, headH, 12);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(headGeo, headMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(0.009, side * (PAGE_H / 2 + 0.004), BOARD_T + headH / 2);
    book.add(m);
  }
  // The ribbon leaves the block at the tail, under every turnable leaf (so it never shows on a page), and lies on the table.
  const RIBBON_W = 0.07;
  const RIBBON_Z = BOARD_T + FILL_R * LEAF_T + GUTTER * 0.55;
  {
    const N = 24;
    const g = new THREE.PlaneGeometry(RIBBON_W, 1, 1, N);
    const pos = g.attributes.position;
    const y0 = -PAGE_H / 2 - 0.001;
    const P = [
      [y0, RIBBON_Z],
      [y0 - 0.06, RIBBON_Z - 0.004],
      [y0 - 0.075, 0.004],
      [y0 - 0.24, 0.004],
    ];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const it = 1 - t;
      const y = it ** 3 * P[0][0] + 3 * it * it * t * P[1][0] + 3 * it * t * t * P[2][0] + t ** 3 * P[3][0];
      const z = it ** 3 * P[0][1] + 3 * it * it * t * P[1][1] + 3 * it * t * t * P[2][1] + t ** 3 * P[3][1];
      for (let j = 0; j < 2; j++) {
        const k = i * 2 + j;
        pos.setY(k, y);
        pos.setZ(k, z);
      }
    }
    g.computeVertexNormals();
    const tail = new THREE.Mesh(g, ribbonMat);
    tail.position.x = 0.36;
    tail.rotation.z = -0.05;
    book.add(tail);
  }

  /* ---- contact shadow ----------------------------------------------------------- */
  const contactShadow = (() => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 512;
    const g = c.getContext("2d")!;
    g.filter = "blur(26px)";
    g.fillStyle = "rgba(60, 40, 10, 1)";
    g.beginPath();
    g.roundRect(70, 70, 372, 372, 40);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.26, depthWrite: false }));
    m.position.z = -0.002;
    m.renderOrder = -1;
    book.add(m);
    return m;
  })();

  /* ---- sheets ---------------------------------------------------------------------- */
  const leafGeo = new THREE.PlaneGeometry(PAGE_W, PAGE_H, SEG_X, SEG_Y);
  leafGeo.translate(PAGE_W / 2, 0, 0);

  interface SheetMesh {
    mesh: THREE.Mesh;
    u: SheetUniforms;
    material: THREE.MeshStandardMaterial;
  }
  function makeSheet(front: THREE.Texture, back: THREE.Texture): SheetMesh {
    const u: SheetUniforms = {
      uTheta: { value: 0 },
      uBend: { value: 0 },
      uSpread: { value: engine.params.spread },
      uGrabY: { value: -0.35 },
      uZRoot: { value: 0 },
      uZFlat: { value: 0 },
      uW: { value: PAGE_W },
      uH: { value: PAGE_H },
      uReach: { value: 1 },
      uBack: { value: back },
      uShade: { value: 0.5 },
    };
    const material = new THREE.MeshStandardMaterial({ map: front, roughness: 0.9, side: THREE.DoubleSide, alphaMap: cornerAlpha, alphaTest: 0.5 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      // Position from the arc; the normal by finite differences of the same function, so lighting follows the bend.
      shader.vertexShader =
        BEND_GLSL +
        "varying float vCurl;\n" +
        shader.vertexShader
          .replace(
            "#include <beginnormal_vertex>",
            `
        float dx = uW / ${SEG_X}.0, dy = uH / ${SEG_Y}.0;
        vec3 tx = bent(position.xy + vec2(dx, 0.0)) - bent(position.xy - vec2(dx, 0.0));
        vec3 ty = bent(position.xy + vec2(0.0, dy)) - bent(position.xy - vec2(0.0, dy));
        vec3 objectNormal = normalize(cross(tx, ty));
        vCurl = abs(uBend) * (position.x / uW);`,
          )
          .replace("#include <begin_vertex>", "vec3 transformed = bent(position.xy);");
      // Two faces on one plane: the back samples its own texture, mirrored; the fold darkens with the bend.
      shader.fragmentShader =
        "uniform sampler2D uBack; uniform float uShade; varying float vCurl;\n" +
        shader.fragmentShader.replace(
          "#include <map_fragment>",
          `
        vec4 sampledDiffuseColor = gl_FrontFacing ? texture2D(map, vMapUv) : texture2D(uBack, vec2(1.0 - vMapUv.x, vMapUv.y));
        sampledDiffuseColor.rgb *= 1.0 - uShade * 0.35 * clamp(vCurl, 0.0, 1.0);
        diffuseColor *= sampledDiffuseColor;`,
        );
    };
    const mesh = new THREE.Mesh(leafGeo, material);
    mesh.frustumCulled = false;
    book.add(mesh);
    return { mesh, u, material };
  }

  // The fixed block on the right: sheets that never turn.
  const fillers: SheetMesh[] = [];
  const fillerReach: number[] = [];
  const zOf = (below: number) => BOARD_T + (below + 1) * LEAF_T;
  const reachOf = (below: number) => 1 - REACH_STEP * below;
  for (let k = 0; k < FILL_R; k++) {
    const s = makeSheet(blank.right, blank.left);
    s.u.uTheta.value = 0;
    s.u.uZRoot.value = zOf(k);
    s.u.uZFlat.value = zOf(k) + GUTTER;
    const reach = reachOf(k) + jitter(k);
    s.u.uReach.value = reach;
    fillerReach.push(reach);
    fillers.push(s);
  }

  // The printed faces: one canvas per face.
  const faces: Array<{ canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; material: THREE.MeshStandardMaterial | null; u: SheetUniforms | null; info: FaceInfo }> = [];
  for (let face = 0; face < FACE_COUNT; face++) {
    const { leaf, side } = placeOf(face);
    const c = document.createElement("canvas");
    c.width = TEX_W;
    c.height = TEX_H;
    faces.push({ canvas: c, texture: canvasTexture(c, { wrap: false }), material: null, u: null, info: { face, leaf, side, gutter: side === "front" ? "left" : "right" } });
  }
  const repaintFace = (face: number) => {
    const f = faces[face];
    if (!f) return;
    const g = f.canvas.getContext("2d")!;
    g.save();
    paintPaper(g, TEX_W, TEX_H, f.info.gutter, COLORS.paper);
    g.restore();
    // Hand the painter a clean state: dark ink, serif, alphabetic baseline.
    g.save();
    g.fillStyle = g.strokeStyle = "#2B2620";
    g.font = `${Math.round(TEX_W / 26)}px Georgia, "Times New Roman", serif`;
    g.textBaseline = "alphabetic";
    options.paintFace?.(g, TEX_W, TEX_H, f.info);
    g.restore();
    f.texture.needsUpdate = true;
  };
  faces.forEach((_, face) => repaintFace(face));
  const faceOfSheet = (leaf: number, side: "front" | "back") => faces.findIndex((f) => f.info.leaf === leaf && f.info.side === side);
  const sheetFor = (leaf: number) => {
    const front = faceOfSheet(leaf, "front");
    const back = faceOfSheet(leaf, "back");
    const s = makeSheet(front >= 0 ? faces[front].texture : blank.right, back >= 0 ? faces[back].texture : blank.left);
    for (const idx of [front, back]) {
      if (idx >= 0) {
        faces[idx].material = s.material;
        faces[idx].u = s.u;
      }
    }
    return s;
  };
  const flyleaf = sheetFor(-1);
  const leafMeshes: SheetMesh[] = [];
  for (let i = 0; i < LEAVES; i++) leafMeshes.push(sheetFor(i));

  /* shadows the turning sheets cast on the block */
  const shadowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform float uAlpha; varying vec2 vUv;
      void main(){ float ey = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
        float a = uAlpha * pow(1.0 - vUv.x, 1.6) * ey; gl_FragColor = vec4(0.12, 0.09, 0.04, a); }`,
  });
  const shadowGeo = new THREE.PlaneGeometry(1, PAGE_H);
  shadowGeo.translate(0.5, 0, 0);
  const shadowMeshes = [flyleaf, ...leafMeshes].map(() => {
    const sh = new THREE.Mesh(shadowGeo, shadowMat.clone());
    sh.renderOrder = 1;
    book.add(sh);
    return sh;
  });
  const coverShadowGeo = new THREE.PlaneGeometry(1, BOARD_H);
  coverShadowGeo.translate(0.5, 0, 0);
  const coverShadow = new THREE.Mesh(coverShadowGeo, shadowMat.clone());
  coverShadow.renderOrder = 1;
  book.add(coverShadow);

  /* ---- the block's sides: fore-edge, head and tail, one row per resting sheet ---- */
  const edgeTex = tex(TEXTURES.edge, { srgb: true });
  const edgeMat = new THREE.MeshStandardMaterial({ map: edgeTex, roughness: 0.92, side: THREE.DoubleSide });
  const MAX_ROWS = FILL_R + LEAVES + 3;
  const ruledStrip = () => {
    const g = new THREE.BufferGeometry();
    const n = (MAX_ROWS + 1) * 2;
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const idx: number[] = [];
    for (let r = 0; r < MAX_ROWS; r++) {
      const a = r * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    g.setIndex(idx);
    const mesh = new THREE.Mesh(g, edgeMat);
    mesh.frustumCulled = false;
    book.add(mesh);
    return mesh;
  };
  const blockSides = {
    right: { fore: ruledStrip(), head: ruledStrip(), tail: ruledStrip() },
    left: { fore: ruledStrip(), head: ruledStrip(), tail: ruledStrip() },
  };
  interface Row {
    x: number;
    z: number;
  }
  const fillStrips = (sides: { fore: THREE.Mesh; head: THREE.Mesh; tail: THREE.Mesh }, rows: Row[]) => {
    const n = rows.length;
    const r = CORNER_R;
    const put = (mesh: THREE.Mesh, fn: (row: Row, j: number, v: number) => [number, number, number, number, number]) => {
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const uv = mesh.geometry.attributes.uv as THREE.BufferAttribute;
      rows.forEach((row, ri) => {
        for (let j = 0; j < 2; j++) {
          const [x, y, z, u, v] = fn(row, j, n > 1 ? ri / (n - 1) : 0);
          const k = ri * 2 + j;
          pos.setXYZ(k, x, y, z);
          uv.setXY(k, u, v);
        }
      });
      pos.needsUpdate = true;
      uv.needsUpdate = true;
      mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
      mesh.geometry.computeVertexNormals();
      mesh.visible = n >= 2;
    };
    put(sides.fore, (row, j, v) => [row.x, j ? PAGE_H / 2 - r : -PAGE_H / 2 + r, row.z, j ? 1 : 0, v]);
    put(sides.head, (row, j, v) => [j ? row.x - Math.sign(row.x) * r : 0, PAGE_H / 2, row.z, j ? 0.7 : 0, v]);
    put(sides.tail, (row, j, v) => [j ? row.x - Math.sign(row.x) * r : 0, -PAGE_H / 2, row.z, j ? 0.7 : 0, v]);
  };

  /* ---- per-frame sync ------------------------------------------------------------- */
  const flyBindZ = BOARD_T + (FILL_R + LEAVES + 1) * LEAF_T;
  const flyFlatZ = (theta: number) => {
    const right = flyBindZ + GUTTER;
    const left = BOARD_T + LEAF_T + 0.0005;
    return right + (left - right) * smooth01(theta / PI);
  };
  const flyReach = (theta: number) => {
    const m = smooth01(theta / PI);
    return reachOf(FILL_R + LEAVES) + (reachOf(0) - reachOf(FILL_R + LEAVES)) * m + jitter(50);
  };
  let gutterScale = 1;

  // `curl` relaxes the gutter: the flat parts keep their heights (so the stacks stay in order) and the
  // bindings rise toward them, which is what lets a DOM page lie within a pixel of the paper.
  const syncSheet = (s: SheetMesh, sheet: Sheet, zRoot: number, zFlat: number, reach: number) => {
    s.u.uZFlat.value = zFlat;
    s.u.uZRoot.value = zFlat + (zRoot - zFlat) * gutterScale;
    s.u.uReach.value = reach;
    s.u.uTheta.value = sheet.theta;
    s.u.uBend.value = engine.bendOf(sheet);
    s.u.uGrabY.value = sheet.grabY;
    s.u.uSpread.value = engine.params.spread;
  };
  const syncShadow = (sh: THREE.Mesh, sheet: Sheet, reach: number, zRight: number, zLeft: number) => {
    const lift = Math.sin(sheet.theta);
    const xTip = PAGE_W * reach * Math.cos(sheet.theta);
    sh.visible = lift > 0.01 && Math.abs(xTip) > 0.01;
    sh.scale.x = xTip;
    sh.position.z = (xTip > 0 ? zRight : zLeft) - LEAF_T * 0.5;
    (sh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.42 * Math.pow(lift, 0.6) * 0.9;
  };

  const sync = () => {
    fillers.forEach((f, k) => {
      f.u.uZFlat.value = zOf(k) + GUTTER;
      f.u.uZRoot.value = zOf(k) + GUTTER * (1 - gutterScale);
    });
    const fly = engine.endpapers[0];
    syncSheet(flyleaf, fly, flyBindZ, flyFlatZ(fly.theta), flyReach(fly.theta));
    syncShadow(shadowMeshes[0], fly, flyReach(fly.theta), flyBindZ + GUTTER, flyFlatZ(PI));
    engine.leaves.forEach((leaf, i) => {
      // A leaf's fore-edge step depends on how many sheets lie under it — on the right, then on the left.
      const bR = FILL_R + LEAVES - 1 - i;
      const bL = i;
      const m = smooth01(leaf.theta / PI);
      const reach = reachOf(bR) + (reachOf(bL) - reachOf(bR)) * m + jitter(100 + i);
      syncSheet(leafMeshes[i], leaf, engine.bindZ(i), engine.flatZ(i, leaf.theta), reach);
      syncShadow(shadowMeshes[i + 1], leaf, reach, engine.bindZ(i) + GUTTER, engine.flatZ(i, PI));
    });
    const c = engine.cover;
    placeCoverAndSpine(c.theta);
    {
      const lift = Math.sin(c.theta);
      const xTip = COVER_W * Math.cos(c.theta);
      coverShadow.visible = lift > 0.01 && Math.abs(xTip) > 0.01;
      coverShadow.scale.x = xTip;
      coverShadow.position.z = (xTip > 0 ? GEOMETRY.hingeClosed.z : BOARD_T) + 0.0006;
      (coverShadow.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.42 * Math.pow(lift, 0.6);
    }
    // The block's sides, bottom to top, from whatever rests on each side (a sheet in flight belongs to neither).
    const rightRows: Row[] = [{ x: PAGE_W * fillerReach[0], z: BOARD_T }];
    fillerReach.forEach((r, k) => rightRows.push({ x: PAGE_W * r, z: zOf(k) + GUTTER }));
    for (let i = LEAVES - 1; i >= 0; i--) {
      const l = engine.leaves[i];
      if (l.mode === "rest" && l.theta < PI / 2) rightRows.push({ x: PAGE_W * leafMeshes[i].u.uReach.value, z: engine.bindZ(i) + GUTTER });
    }
    if (fly.mode === "rest" && fly.theta < PI / 2) rightRows.push({ x: PAGE_W * flyleaf.u.uReach.value, z: flyBindZ + GUTTER });
    fillStrips(blockSides.right, rightRows);
    const leftRows: Row[] = [];
    if (fly.mode === "rest" && fly.theta >= PI / 2) {
      leftRows.push({ x: -PAGE_W * flyleaf.u.uReach.value, z: BOARD_T }, { x: -PAGE_W * flyleaf.u.uReach.value, z: flyleaf.u.uZFlat.value });
    }
    for (let i = 0; i < LEAVES; i++) {
      const l = engine.leaves[i];
      if (l.mode === "rest" && l.theta >= PI / 2) {
        if (!leftRows.length) leftRows.push({ x: -PAGE_W * leafMeshes[i].u.uReach.value, z: BOARD_T });
        leftRows.push({ x: -PAGE_W * leafMeshes[i].u.uReach.value, z: leafMeshes[i].u.uZFlat.value });
      }
    }
    fillStrips(blockSides.left, leftRows);
  };

  /* ---- framing --------------------------------------------------------------------- */
  const size = { w: 1, h: 1 };
  const resize = () => {
    size.w = canvas.clientWidth || 1;
    size.h = canvas.clientHeight || 1;
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
  };
  resize();
  const fit = (uw: number, uh: number, fw: number, fh: number) => {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(uh / fh / (2 * tan), uw / fw / (2 * tan * camera.aspect));
  };

  /* ---- landing callback ------------------------------------------------------------ */
  let landed: ((turned: number) => void) | null = null;
  let wasMoving = false;
  let lastTurned = engine.turnedCount();

  const frame: Book["frame"] = (dt, view) => {
    engine.step(Math.max(0, Math.min(0.05, dt)));
    gutterScale = Math.max(0, Math.min(1, view.curl));
    sync();

    const k = THREE.MathUtils.clamp(view.cover, 0, 1);
    const closedDist = fit(COVER_W, BOARD_H + 0.12, 0.9, 0.84);
    const openDist = fit(COVER_W * 2, BOARD_H + 0.16, 0.95, 0.84);
    const zoomDist = fit(PAGE_W * 2 + SQUARE, BOARD_H, 0.94, 0.92);
    const baseDist = closedDist + (openDist - closedDist) * k;
    camera.position.set(0, 0, baseDist + (zoomDist - baseDist) * view.zoom);
    camera.lookAt(0, 0, 0);

    book.position.x = (-COVER_W / 2) * (1 - view.shift);
    book.position.y = 0.1 * (1 - view.zoom);
    book.rotation.x = THREE.MathUtils.degToRad(view.leanX + pose.closedPitch * (1 - view.open) - pose.openTilt * view.open * (1 - view.zoom));
    book.rotation.y = THREE.MathUtils.degToRad(view.leanY + pose.closedYaw * (1 - view.open));
    book.rotation.z = THREE.MathUtils.degToRad(pose.closedRoll * (1 - view.open));
    // The contact shadow follows the cover itself, so it narrows while the book is being shut by hand.
    const shut = 1 - Math.min(k, smooth01(engine.cover.theta / PI));
    const w = 2 * COVER_W + 0.34 + (COVER_W + 0.3 - (2 * COVER_W + 0.34)) * shut;
    contactShadow.scale.set(w, BOARD_H + 0.34, 1);
    contactShadow.position.x = (COVER_W / 2) * shut;

    renderer.render(scene, camera);

    const moving = !engine.idle();
    if (wasMoving && !moving) {
      const turned = engine.turnedCount();
      if (turned !== lastTurned) {
        lastTurned = turned;
        landed?.(turned);
      }
    }
    wasMoving = moving;
  };

  /* ---- pointer → the page plane ------------------------------------------------------ */
  // The sheets are bent on the GPU, so a CPU raycast against the meshes would miss. Instead the pointer is cast
  // onto the flat plane of the block's top in the book's own frame; the engine only needs that x (and y).
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const inverse = new THREE.Matrix4();
  const localRay = new THREE.Ray();
  const hitPoint = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(Z_TOP + GUTTER));
  const planeHit = (x: number, y: number): { x: number; y: number } | null => {
    ndc.set((x / size.w) * 2 - 1, -(y / size.h) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    book.updateMatrixWorld();
    inverse.copy(book.matrixWorld).invert();
    localRay.copy(ray.ray).applyMatrix4(inverse);
    return localRay.intersectPlane(plane, hitPoint) ? { x: hitPoint.x, y: hitPoint.y } : null;
  };
  const onBook = (p: { x: number; y: number } | null) =>
    !!p &&
    (engine.closed ? p.x >= GEOMETRY.hingeClosed.x - 0.02 && p.x <= COVER_W + 0.02 : Math.abs(p.x) <= COVER_W + 0.02) &&
    Math.abs(p.y) <= PAGE_H / 2 + SQUARE + 0.02;
  const onMargin = (p: { x: number; y: number }) => Math.abs(p.x) > PAGE_W - 0.05 || Math.abs(p.y) > PAGE_H / 2 - 0.03;

  interface Drag {
    samples: Array<{ t: number; x: number }>;
    downT: number;
    downX: number;
    downY: number;
    moved: boolean;
  }
  let drag: Drag | null = null;
  const pointerDown: Book["pointerDown"] = (x, y) => {
    const p = planeHit(x, y);
    if (!onBook(p) || !p) return null;
    const margin = onMargin(p);
    const sheet = engine.grab(p.x, p.y, margin);
    if (!sheet) return null;
    drag = { samples: [{ t: performance.now(), x: p.x }], downT: performance.now(), downX: p.x, downY: p.y, moved: false };
    return sheet.isCover ? (margin ? "cover-margin" : "cover") : "leaf";
  };
  const pointerMove: Book["pointerMove"] = (x, y) => {
    if (!drag) return;
    const p = planeHit(x, y);
    if (!p) return;
    const now = performance.now();
    drag.samples.push({ t: now, x: p.x });
    // Release velocity comes from the last 80 ms of movement, measured on the wall clock.
    while (drag.samples.length > 2 && drag.samples[0].t < now - 80) drag.samples.shift();
    if (Math.hypot(p.x - drag.downX, p.y - drag.downY) > 0.02) drag.moved = true;
    engine.move(p.x);
  };
  const pointerUp: Book["pointerUp"] = (_x, _y, tap = true) => {
    const d = drag;
    drag = null;
    if (!d || !engine.active) return;
    if (!tap && !d.moved) {
      engine.cancel();
      return;
    }
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = Math.max(0.008, (last.t - first.t) / 1000);
    let vx = (last.x - first.x) / dt;
    const isClick = !d.moved && performance.now() - d.downT < 250;
    if (isClick) {
      // A tap: the right page turns left, the left page turns back, the shut book opens.
      const flick = engine.params.flick * 1.5;
      vx = engine.active.isCover && engine.active.theta < PI / 2 ? -flick : d.downX >= 0 ? -flick : flick;
    }
    engine.release(vx);
  };

  const tmp = new THREE.Vector3();
  const facePoint = (face: number, x: number, y: number, domW: number, domH: number) => {
    const entry = faces[face];
    const along = entry.info.side === "front" ? x / domW : 1 - x / domW;
    bentPoint(entry.u!, THREE.MathUtils.clamp(along, 0, 0.9999) * PAGE_W, (0.5 - y / domH) * PAGE_H, tmp);
    tmp.applyMatrix4(book.matrixWorld);
    tmp.project(camera);
    return { x: ((tmp.x + 1) / 2) * size.w, y: ((1 - tmp.y) / 2) * size.h };
  };

  const faceShowing = (face: number): "print" | "blank" => {
    const entry = faces[face];
    if (!entry?.material || !entry.u) return "blank";
    return (entry.info.side === "front" ? entry.material.map : entry.u.uBack.value) === entry.texture ? "print" : "blank";
  };

  return {
    engine,
    faceCount: FACE_COUNT,
    frame,
    turning: () => !engine.idle(),
    turnedCount: () => engine.turnedCount(),
    turnTo(n) {
      engine.turnTo(n);
    },
    setCoverOpen(open, immediate = false) {
      if (immediate) engine.restore({ leaves: engine.snapshot().leaves, cover: open ? PI : 0 });
      else engine.setClosed(!open);
    },
    onLanded(callback) {
      landed = callback;
      lastTurned = engine.turnedCount();
    },
    onInvalidate(callback) {
      invalidate = callback;
    },
    faceCanvas(face) {
      return faces[face].canvas;
    },
    repaintFace,
    refreshFace(face) {
      if (faces[face]) faces[face].texture.needsUpdate = true;
    },
    showFace(face, what) {
      const entry = faces[face];
      if (!entry?.material || !entry.u) return;
      const map = what === "print" ? entry.texture : entry.info.side === "front" ? blank.right : blank.left;
      if (entry.info.side === "front") {
        if (entry.material.map !== map) {
          entry.material.map = map;
          entry.material.needsUpdate = true;
        }
      } else if (entry.u.uBack.value !== map) {
        entry.u.uBack.value = map;
      }
    },
    faceShowing,
    faceTransform(face, domW, domH) {
      if (!faces[face]?.u) return null;
      book.updateMatrixWorld();
      const x0 = domW * 0.2;
      const x1 = domW * 0.8;
      const a = facePoint(face, x0, 0, domW, domH);
      const b = facePoint(face, x1, 0, domW, domH);
      const c = facePoint(face, x0, domH, domW, domH);
      const sx = (b.x - a.x) / (x1 - x0);
      const sy = (c.y - a.y) / domH;
      if (!(sx > 0.05) || !(sy > 0.05)) return null;
      return { sx, sy, tx: a.x - x0 * sx, ty: a.y };
    },
    hit(x, y) {
      return onBook(planeHit(x, y));
    },
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel() {
      drag = null;
      engine.cancel();
    },
    dragMoved: () => Boolean(drag?.moved),
    resize,
    dispose() {
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((m) => {
          (m as THREE.MeshStandardMaterial).map?.dispose();
          m.dispose();
        });
      });
      faces.forEach((f) => f.texture.dispose());
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
