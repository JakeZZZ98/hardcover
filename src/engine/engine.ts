import { DEFAULT_PARAMS, GUTTER_SPAN } from "./defaults";
import { PI, clamp, lowPass, smooth01, springStep } from "./spring";
import type { BookEngineOptions, BookGeometry, BookParams, BookSnapshot, Sheet } from "./types";

/**
 * The book engine: the maths and physics of a hardcover whose pages can be
 * dragged, flicked, caught mid-air and closed.
 *
 * Every sheet — the turnable leaves, the endpapers glued into the cover's
 * side, and the cover itself — is a hinge angle θ about the spine: 0 lying
 * on the right, π lying on the left. Three things happen to a sheet:
 *
 *  - **drag**: the pointer's x maps to a target angle (the tip's projection
 *    follows the finger) and θ chases it with a stiff spring;
 *  - **settle**: released, θ springs to 0 or π — fast releases decide by
 *    velocity, slow ones by progress — and can be grabbed again any time;
 *  - **bundle**: while the cover moves, the sheets on its side follow it,
 *    the innermost falling ahead (a fan), never passing through it.
 *
 * Nothing collides in 3D. All sheets share one axis, so "cannot pass
 * through" is one ordering along the stack: cover ≥ endpapers ≥ leaf 0 ≥
 * leaf 1 ≥ … ≥ 0. `resolveChain` enforces it every step; the cover's own
 * limit on a leaf is solved against the cover's plane, because the cover's
 * hinge slides while the leaves stay bound at the spine.
 *
 * The bend a renderer draws (`bendOf`) is a per-sheet arc: lift curl plus
 * motion lag, clamped so the tip stays inside its neighbours.
 */

const makeSheet = (index: number, isCover = false): Sheet => ({
  index,
  isCover,
  theta: 0,
  omega: 0,
  mode: "rest",
  target: 0,
  origin: 0,
  bend: 0,
  grabY: -0.35,
  bendMin: -PI,
  bendMax: PI,
  grabX0: 1,
  px0: 0,
  thetaTarget: 0,
});

interface Pending {
  leaf: Sheet;
  target: number;
  at: number;
}

interface BundleEntry {
  sheet: Sheet;
  depth: number;
  glued: boolean;
}

export class BookEngine {
  readonly W: number;
  readonly H: number;
  readonly params: BookParams;
  readonly geom: BookGeometry;
  readonly leaves: Sheet[];
  readonly endpapers: Sheet[];
  /** π = open on the left, 0 = shut on the right. */
  readonly cover: Sheet;
  /** The sheet under the pointer, if any. */
  active: Sheet | null = null;
  /** Engine time, seconds (advanced by `step`). */
  time = 0;
  private bundle: BundleEntry[] | null = null;
  private pending: Pending[] = [];
  private readonly reduced: () => boolean;

  constructor({ leafCount, endpaperCount = 0, params, geometry, reduced }: BookEngineOptions) {
    this.W = geometry.W;
    this.H = geometry.H;
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.geom = geometry;
    this.reduced = reduced ?? (() => false);
    this.leaves = Array.from({ length: leafCount }, (_, i) => makeSheet(i));
    this.cover = makeSheet(-1, true);
    this.cover.theta = PI;
    this.endpapers = Array.from({ length: endpaperCount }, (_, k) => {
      const sheet = makeSheet(100 + k);
      sheet.theta = PI;
      return sheet;
    });
  }

  /* ------------------------------------------------------------------ */
  /* state queries                                                        */
  /* ------------------------------------------------------------------ */

  get closed(): boolean {
    return this.cover.mode === "rest" && this.cover.theta < PI / 2;
  }

  /** Front to back: the cover, the endpapers, then the leaves. */
  get chain(): Sheet[] {
    return [this.cover, ...this.endpapers, ...this.leaves];
  }

  isLeaf(sheet: Sheet): boolean {
    return sheet.index >= 0 && sheet.index < this.leaves.length;
  }

  /** The cover reaches past the page by its overhang. */
  widthOf(sheet: Sheet): number {
    return sheet.isCover ? this.geom.coverW : this.W;
  }

  /** Leaves lying (or heading) left. */
  turnedCount(): number {
    return this.leaves.filter((l) => (l.mode === "settle" ? l.target : l.theta) >= PI / 2).length;
  }

  /** The next leaf to turn forward, if any. */
  topRight(): Sheet | null {
    return this.leaves.find((l) => l.mode === "rest" && l.theta < PI / 2) ?? null;
  }

  /** The last leaf turned, if any — the one that can turn back. */
  topLeft(): Sheet | null {
    const left = this.leaves.filter((l) => l.mode === "rest" && l.theta >= PI / 2);
    return left.length ? left[left.length - 1] : null;
  }

  idle(): boolean {
    return (
      !this.active &&
      !this.bundle &&
      this.pending.length === 0 &&
      this.chain.every((s) => s.mode === "rest" && Math.abs(s.bend) < 0.01)
    );
  }

  /* ------------------------------------------------------------------ */
  /* geometry                                                             */
  /* ------------------------------------------------------------------ */

  /** Where leaf i is bound: its height in the block, whichever side it lies on. */
  bindZ(i: number): number {
    const g = this.geom;
    return g.boardT + (g.fillR + this.leaves.length - i) * g.leafT;
  }

  /** Height of leaf i's flat part: on the right the block's top (up from the gutter), on the left the i-th layer on the cover. */
  flatZ(i: number, theta: number): number {
    const g = this.geom;
    const right = this.bindZ(i) + g.gutter;
    // On the left the endpapers lie under the turned leaves: leaf i is layer endpapers + i + 1.
    const left = g.boardT + (this.endpapers.length + i + 1) * g.leafT + 0.0005;
    return right + (left - right) * smooth01(theta / PI);
  }

  /** The cover's hinge for a cover angle: slides from the open joint to the shut position, bulging outward half-way. */
  coverPlane(thetaC: number): { x: number; z: number } {
    const g = this.geom;
    const m = smooth01(thetaC / PI);
    const b = g.bulge * Math.sin(m * PI);
    return {
      x: g.hingeClosed.x + (g.hingeOpen.x - g.hingeClosed.x) * m - b * 0.7,
      z: g.hingeClosed.z + (g.hingeOpen.z - g.hingeClosed.z) * m + b * 0.7,
    };
  }

  /** Signed distance from a point on leaf i (at angle thetaP, u along the page) to the cover's inner face; negative = inside the cover. */
  clearance(i: number, thetaP: number, thetaC: number, u: number): number {
    const h = this.coverPlane(thetaC);
    const L = this.W * u;
    const profile = u < GUTTER_SPAN ? 1 - (1 - u / GUTTER_SPAN) ** 2 : 1;
    const lift = (this.flatZ(i, thetaP) - this.bindZ(i)) * Math.abs(Math.cos(thetaP)) * profile;
    const px = L * Math.cos(thetaP);
    const pz = this.bindZ(i) + L * Math.sin(thetaP) + lift;
    return (px - h.x) * Math.sin(thetaC) - (pz - h.z) * Math.cos(thetaC);
  }

  /** The largest angle leaf i may take under a cover at thetaC without its tip crossing the cover (bisection). */
  coverLimit(i: number, thetaC: number): number {
    const inside = (t: number) =>
      Math.min(this.clearance(i, t, thetaC, 1), this.clearance(i, t, thetaC, 0.5), this.clearance(i, t, thetaC, 0.25)) >= -1e-4;
    if (inside(thetaC)) return thetaC;
    if (!inside(0)) return 0;
    let lo = 0;
    let hi = thetaC;
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** The arc a renderer should draw for a sheet, radians (0 = flat), already clamped to its neighbours. */
  bendOf(sheet: Sheet): number {
    if (sheet.isCover) return 0;
    const p = this.params;
    const c = p.curl * Math.sin(2 * sheet.theta) - p.lag * sheet.bend;
    const f = 1 + p.spread * 0.85;
    const lo = sheet.bendMin / f;
    const hi = sheet.bendMax / f;
    return clamp(clamp(c, -2.2, 2.2), Math.min(lo, 0), Math.max(hi, 0));
  }

  /* ------------------------------------------------------------------ */
  /* input                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Grab whatever is under the pointer at (x, y) in page-plane units (x from
   * −W to W across the spread). `onMargin`: the pointer is on the cover's
   * square, outside the pages. Returns the sheet taken, or null.
   */
  grab(x: number, y: number, onMargin = false): Sheet | null {
    if (this.active) return this.active;
    let sheet: Sheet | null = null;
    const flying = this.leaves.filter((l) => l.mode === "settle");
    if (this.cover.mode !== "rest" || this.closed || (onMargin && x < 0)) sheet = this.cover;
    else if (flying.length) {
      // Catch the one whose tip is nearest the pointer.
      flying.sort((a, b) => Math.abs(this.W * Math.cos(a.theta) - x) - Math.abs(this.W * Math.cos(b.theta) - x));
      sheet = flying[0];
    } else {
      sheet = x >= 0 ? this.topRight() : (this.topLeft() ?? this.cover);
    }
    if (!sheet) return null;
    if (sheet.isCover && !this.bundle) this.buildBundle();
    this.pending = this.pending.filter((q) => q.leaf !== sheet);
    sheet.mode = "drag";
    sheet.origin = sheet.theta > PI / 2 ? PI : 0;
    sheet.grabX0 = this.widthOf(sheet) * Math.cos(sheet.theta);
    sheet.px0 = x;
    sheet.grabY = clamp(y / this.H, -0.5, 0.5);
    sheet.thetaTarget = sheet.theta;
    this.active = sheet;
    return sheet;
  }

  /** The pointer moved to x (page-plane units). */
  move(x: number): void {
    const sheet = this.active;
    if (!sheet) return;
    const xt = sheet.grabX0 + (x - sheet.px0);
    sheet.thetaTarget = Math.acos(clamp(xt / this.widthOf(sheet), -1, 1));
  }

  /** Let go with the pointer moving at `vx` page widths per second (negative = toward the left). */
  release(vx: number): void {
    const sheet = this.active;
    if (!sheet) return;
    this.active = null;
    const p = this.params;
    let target: number;
    if (Math.abs(vx) >= p.flick) target = vx < 0 ? PI : 0;
    else {
      const progress = sheet.origin === 0 ? sheet.theta / PI : 1 - sheet.theta / PI;
      const done = progress >= p.threshold;
      target = sheet.origin === 0 ? (done ? PI : 0) : done ? 0 : PI;
    }
    const kick = sheet.isCover ? p.kick * 0.6 : p.kick;
    const omega0 = clamp(-vx / (this.widthOf(sheet) * Math.max(Math.sin(sheet.theta), 0.35)), -kick, kick);
    sheet.omega = Math.abs(omega0) > Math.abs(sheet.omega) ? omega0 : sheet.omega;
    this.settle(sheet, target);
  }

  /** Cancel a drag without a fling (pointer lost): the sheet falls to the nearer side. */
  cancel(): void {
    const sheet = this.active;
    if (!sheet) return;
    this.active = null;
    this.settle(sheet, sheet.theta > PI / 2 ? PI : 0);
  }

  /* ------------------------------------------------------------------ */
  /* programmatic turns                                                   */
  /* ------------------------------------------------------------------ */

  /** Turn so that `count` leaves lie on the left, 120 ms apart when several move. */
  turnTo(count: number): void {
    if (this.closed || this.cover.mode !== "rest") return;
    const heading = (l: Sheet) => (l.mode === "settle" ? l.target : l.theta);
    const turned = this.leaves.filter((l) => heading(l) >= PI / 2).length;
    let delay = 0;
    if (count > turned) {
      for (const l of this.leaves) {
        if (heading(l) < PI / 2 && this.leaves.indexOf(l) < count) {
          this.queue(l, PI, delay);
          delay += 0.12;
        }
      }
    } else {
      for (const l of [...this.leaves].reverse()) {
        if (heading(l) >= PI / 2 && this.leaves.indexOf(l) >= count) {
          this.queue(l, 0, delay);
          delay += 0.12;
        }
      }
    }
  }

  /** Close or open the cover; the sheets on its side come along. */
  setClosed(closed: boolean): void {
    const c = this.cover;
    if (c.mode === "drag") return;
    if (!this.bundle) this.buildBundle();
    c.origin = c.theta > PI / 2 ? PI : 0;
    if (c.mode === "rest") c.omega = closed ? -2.5 : 2.5;
    this.settle(c, closed ? 0 : PI);
  }

  /** Where the cover is heading (or lies). */
  coverHeading(): "open" | "closed" {
    const c = this.cover;
    const theta = c.mode === "settle" ? c.target : c.theta;
    return theta >= PI / 2 ? "open" : "closed";
  }

  reset(): void {
    for (const l of this.leaves) Object.assign(l, { theta: 0, omega: 0, bend: 0, mode: "rest" });
    for (const l of this.endpapers) Object.assign(l, { theta: PI, omega: 0, bend: 0, mode: "rest" });
    Object.assign(this.cover, { theta: PI, omega: 0, bend: 0, mode: "rest" });
    this.bundle = null;
    this.active = null;
    this.pending = [];
  }

  snapshot(): BookSnapshot {
    return {
      leaves: this.leaves.map((l) => ((l.mode === "settle" ? l.target : l.theta) >= PI / 2 ? PI : 0)),
      cover: this.coverHeading() === "open" ? PI : 0,
    };
  }

  /** Jump to a resting state: `turned` leaves on the left, the cover open or shut. */
  restore(snap: BookSnapshot): void {
    this.reset();
    snap.leaves.forEach((t, i) => {
      if (this.leaves[i]) this.leaves[i].theta = t;
    });
    if (snap.cover < PI / 2) {
      this.cover.theta = 0;
      for (const l of this.endpapers) l.theta = 0;
      for (const l of this.leaves) l.theta = 0;
    }
  }

  /** Convenience: lie open with the first `turned` leaves on the left. */
  setTurned(turned: number, coverOpen = true): void {
    this.restore({ leaves: this.leaves.map((_, i) => (i < turned ? PI : 0)), cover: coverOpen ? PI : 0 });
  }

  /* ------------------------------------------------------------------ */
  /* stepping                                                             */
  /* ------------------------------------------------------------------ */

  step(dt: number): void {
    this.time += dt;
    const p = this.params;
    const reduced = this.reduced();
    for (const q of this.pending.splice(0)) {
      if (q.at <= this.time) this.kick(q.leaf, q.target);
      else this.pending.push(q);
    }
    for (const sheet of this.chain) {
      if (sheet.mode === "rest" || sheet.mode === "bundle") {
        sheet.bend *= Math.exp(-dt / p.bendResponse);
        continue;
      }
      const before = sheet.theta;
      if (sheet.mode === "drag") {
        if (p.follow <= 0) {
          sheet.theta = sheet.thetaTarget;
          sheet.omega = (sheet.theta - before) / Math.max(dt, 1e-4);
        } else {
          [sheet.theta, sheet.omega] = springStep(sheet.theta, sheet.omega, sheet.thetaTarget, 1, p.follow / 1000, dt);
        }
      } else if (reduced) {
        sheet.theta = sheet.target;
        sheet.omega = 0;
        sheet.bend = 0;
        sheet.mode = "rest";
        continue;
      } else {
        const [d, r] = sheet.isCover ? [p.coverDamping, p.coverResponse] : [p.damping, p.response];
        [sheet.theta, sheet.omega] = springStep(sheet.theta, sheet.omega, sheet.target, d, r, dt);
        if (Math.abs(sheet.theta - sheet.target) < 0.0015 && Math.abs(sheet.omega) < 0.02) {
          sheet.theta = sheet.target;
          sheet.omega = 0;
          sheet.mode = "rest";
        }
      }
      // Sheets cannot pass through the block: the angle stays in [0, π]; the leftover speed goes into the bend (a flop).
      if (sheet.theta < 0) {
        sheet.theta = 0;
        sheet.omega = Math.max(0, sheet.omega);
      }
      if (sheet.theta > PI) {
        sheet.theta = PI;
        sheet.omega = Math.min(0, sheet.omega);
      }
      const measured = (sheet.theta - before) / Math.max(dt, 1e-4);
      sheet.bend = lowPass(sheet.bend, measured, p.bendResponse, dt);
    }
    this.stepBundle(dt, reduced);
    this.resolveChain();
  }

  /* ------------------------------------------------------------------ */
  /* internals                                                            */
  /* ------------------------------------------------------------------ */

  private settle(sheet: Sheet, target: number): void {
    sheet.mode = "settle";
    sheet.target = target;
  }

  private queue(leaf: Sheet, target: number, delay: number): void {
    if (leaf.mode === "drag") return;
    if (delay === 0 || this.reduced()) this.kick(leaf, target);
    else this.pending.push({ leaf, target, at: this.time + delay });
  }

  private kick(leaf: Sheet, target: number): void {
    leaf.origin = leaf.theta > PI / 2 ? PI : 0;
    leaf.grabY = -0.35;
    if (leaf.mode === "rest") leaf.omega = target > leaf.theta ? 3.5 : -3.5;
    this.settle(leaf, target);
  }

  /** The sheets that ride with the cover: endpapers, then whatever leaves lie on the left, innermost deepest. */
  private buildBundle(): void {
    const list: BundleEntry[] = this.endpapers.map((sheet, k) => ({ sheet, depth: k, glued: k === 0 }));
    const turned = this.leaves.filter((l) => l.mode !== "drag" && (l.mode === "settle" ? l.target : l.theta) >= PI / 2);
    turned.forEach((sheet, j) => list.push({ sheet, depth: this.endpapers.length + j, glued: false }));
    for (const b of list) b.sheet.mode = "bundle";
    this.pending = this.pending.filter((q) => !turned.includes(q.leaf));
    this.bundle = list;
  }

  private stepBundle(dt: number, reduced: boolean): void {
    if (!this.bundle) return;
    const p = this.params;
    const c = this.cover;
    for (const { sheet, depth, glued } of this.bundle) {
      const before = sheet.theta;
      if (glued || reduced) {
        sheet.theta = c.theta;
        sheet.omega = c.omega;
        sheet.bend = 0;
        continue;
      }
      const lim = this.isLeaf(sheet) ? this.coverLimit(sheet.index, c.theta) : c.theta;
      const target = clamp(c.theta - p.fan * depth * Math.sin(c.theta), 0, lim);
      [sheet.theta, sheet.omega] = springStep(sheet.theta, sheet.omega, target, 1, 0.1 + 0.025 * depth, dt);
      if (sheet.theta > lim) {
        sheet.theta = lim;
        sheet.omega = Math.min(sheet.omega, c.omega);
      }
      if (sheet.theta < 0) {
        sheet.theta = 0;
        sheet.omega = 0;
      }
      sheet.bend = lowPass(sheet.bend, (sheet.theta - before) / Math.max(dt, 1e-4), p.bendResponse, dt);
    }
    if (c.mode === "rest") {
      for (const { sheet } of this.bundle) {
        sheet.theta = c.theta;
        sheet.omega = 0;
        sheet.mode = "rest";
      }
      this.bundle = null;
    }
  }

  /**
   * Contact along the stack: cover ≥ endpapers ≥ leaf 0 ≥ leaf 1 ≥ … ≥ 0.
   * A dragged sheet is rigid and pushes; two free sheets merge by mass (the
   * cover counts eight). Forward then backward so a push travels down a run.
   * A settling sheet blocked by a resting one retargets to it, otherwise it
   * would jitter against it for ever and the loop could never go idle.
   */
  private resolveChain(): void {
    const chain = this.chain;
    const wake = (s: Sheet) => {
      if (s.mode === "rest") {
        s.mode = "settle";
        s.target = s.theta > PI / 2 ? PI : 0;
      }
    };
    const contact = (a: Sheet, b: Sheet) => {
      const aEff = a.isCover && this.isLeaf(b) ? this.coverLimit(b.index, a.theta) : a.theta;
      const margin = a.theta - aEff;
      if (aEff >= b.theta - 1e-6) return;
      const aRigid = a.mode === "drag";
      const bRigid = b.mode === "drag";
      if (aRigid && !bRigid) {
        wake(b);
        b.theta = aEff;
        if (b.omega > a.omega) b.omega = a.omega;
      } else if (bRigid && !aRigid) {
        wake(a);
        a.theta = b.theta + margin;
        if (a.omega < b.omega) a.omega = b.omega;
      } else {
        const ma = a.isCover ? 8 : 1;
        const mb = b.isCover ? 8 : 1;
        const th = (ma * aEff + mb * b.theta) / (ma + mb);
        const w = (ma * a.omega + mb * b.omega) / (ma + mb);
        wake(a);
        wake(b);
        a.theta = th + margin;
        b.theta = th;
        a.omega = b.omega = w;
      }
      if (b.mode === "settle" && a.mode === "rest" && b.target > aEff) b.target = aEff;
      if (a.mode === "settle" && b.mode === "rest" && a.target < b.theta + margin) a.target = b.theta + margin;
    };
    for (let i = 0; i < chain.length - 1; i++) contact(chain[i], chain[i + 1]);
    for (let i = chain.length - 2; i >= 0; i--) contact(chain[i], chain[i + 1]);
    for (const s of chain) s.theta = clamp(s.theta, 0, PI);
    // The tip must not cross a neighbour either: bend limits for the renderer.
    for (let i = 0; i < chain.length; i++) {
      const s = chain[i];
      const outer = i > 0 ? chain[i - 1] : null;
      const outerTheta = !outer ? PI : outer.isCover && this.isLeaf(s) ? this.coverLimit(s.index, outer.theta) : outer.theta;
      s.bendMax = outerTheta - s.theta;
      s.bendMin = (i < chain.length - 1 ? chain[i + 1].theta : 0) - s.theta;
    }
  }
}
