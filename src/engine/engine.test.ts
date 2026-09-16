import { describe, expect, it } from "vitest";
import { BookEngine } from "./engine";
import { makeGeometry } from "./defaults";
import { PI } from "./spring";

/** The demo book: four turnable leaves, one flyleaf glued into the cover's side, fourteen fixed sheets under them. */
function makeBook(overrides: Partial<ConstructorParameters<typeof BookEngine>[0]> = {}) {
  const geometry = makeGeometry({ H: 1.48, boardT: 0.03, leafT: 0.0025, fillR: 14, sheetsUnderCover: 5, gutter: 0.025, hinge: 0.035 });
  return new BookEngine({ leafCount: 4, endpaperCount: 1, geometry, ...overrides });
}

/** Advance the engine like a frame loop would. */
function run(engine: BookEngine, seconds: number, dt = 1 / 120) {
  for (let t = 0; t < seconds; t += dt) engine.step(dt);
}

/** A drag from x0 to x1 over `seconds`, then release at the last velocity. */
function drag(engine: BookEngine, x0: number, x1: number, seconds: number, y = 0, onMargin = false) {
  const steps = Math.max(2, Math.round(seconds * 120));
  const sheet = engine.grab(x0, y, onMargin);
  for (let i = 1; i <= steps; i++) {
    engine.move(x0 + ((x1 - x0) * i) / steps);
    engine.step(1 / 120);
  }
  engine.release((x1 - x0) / seconds);
  return sheet;
}

/** The largest violation of the stack order, radians (0 = nothing crosses). */
function worstCrossing(engine: BookEngine) {
  const chain = engine.chain;
  let worst = 0;
  for (let i = 0; i < chain.length - 1; i++) worst = Math.max(worst, chain[i + 1].theta - chain[i].theta);
  return worst;
}

describe("BookEngine · resting state", () => {
  it("starts open at the first spread and idle", () => {
    const e = makeBook();
    expect(e.closed).toBe(false);
    expect(e.turnedCount()).toBe(0);
    expect(e.cover.theta).toBe(PI);
    expect(e.endpapers[0].theta).toBe(PI);
    expect(e.idle()).toBe(true);
  });

  it("restores a snapshot and reports it back", () => {
    const e = makeBook();
    e.setTurned(2);
    expect(e.turnedCount()).toBe(2);
    expect(e.snapshot()).toEqual({ leaves: [PI, PI, 0, 0], cover: PI });
    e.restore({ leaves: [0, 0, 0, 0], cover: 0 });
    expect(e.closed).toBe(true);
    expect(e.turnedCount()).toBe(0);
  });
});

describe("BookEngine · dragging a page", () => {
  it("follows the pointer: the tip's projection tracks the finger", () => {
    const e = makeBook({ params: { follow: 0 } });
    e.grab(0.8, 0);
    e.move(0.3);
    e.step(1 / 60);
    // grabX0 = W·cos 0 = 1; pointer moved −0.5 → target x = 0.5 → θ = acos(0.5)
    expect(e.leaves[0].theta).toBeCloseTo(Math.acos(0.5), 5);
    expect(e.leaves[0].mode).toBe("drag");
  });

  it("released short of the threshold, the page falls back and the loop goes idle", () => {
    const e = makeBook();
    drag(e, 0.9, 0.6, 0.6);
    run(e, 3);
    expect(e.turnedCount()).toBe(0);
    expect(e.leaves[0].theta).toBe(0);
    expect(e.idle()).toBe(true);
  });

  it("released past the threshold, the page turns", () => {
    const e = makeBook();
    drag(e, 0.9, -0.5, 1.0);
    run(e, 3);
    expect(e.turnedCount()).toBe(1);
    expect(e.leaves[0].theta).toBe(PI);
    expect(e.idle()).toBe(true);
  });

  it("a fast flick turns the page even from a short drag", () => {
    const e = makeBook();
    drag(e, 0.9, 0.7, 0.05); // 4 page widths per second, well over the 1.2 threshold
    expect(e.leaves[0].mode).toBe("settle");
    expect(e.leaves[0].target).toBe(PI);
    run(e, 3);
    expect(e.turnedCount()).toBe(1);
  });

  it("a page in flight can be caught, pulled back and let go", () => {
    const e = makeBook();
    drag(e, 0.9, 0.7, 0.05);
    run(e, 0.09);
    const flying = e.leaves[0];
    expect(flying.mode).toBe("settle");
    const caught = e.grab(0.2, 0);
    expect(caught).toBe(flying);
    expect(flying.mode).toBe("drag");
    e.step(1 / 60);
    expect(Math.abs(flying.omega)).toBeLessThan(1); // it stops in the hand
    for (let i = 0; i < 30; i++) {
      e.move(0.2 + i * 0.03);
      e.step(1 / 120);
    }
    e.release(0.2);
    run(e, 3);
    expect(e.turnedCount()).toBe(0);
  });

  it("turning back: the last turned page comes back when dragged from the left", () => {
    const e = makeBook();
    e.setTurned(2);
    const sheet = drag(e, -0.9, 0.6, 0.8);
    expect(sheet).toBe(e.leaves[1]);
    run(e, 3);
    expect(e.turnedCount()).toBe(1);
  });

  it("never lets a page sink into the block: θ stays within [0, π]", () => {
    const e = makeBook({ params: { damping: 0.4 } });
    drag(e, 0.9, 0.2, 0.03);
    for (let t = 0; t < 3; t += 1 / 120) {
      e.step(1 / 120);
      for (const s of e.chain) {
        expect(s.theta).toBeGreaterThanOrEqual(0);
        expect(s.theta).toBeLessThanOrEqual(PI);
      }
    }
  });
});

describe("BookEngine · programmatic turns", () => {
  it("turnTo staggers several pages and lands them all", () => {
    const e = makeBook();
    e.turnTo(3);
    run(e, 0.05);
    expect(e.leaves.filter((l) => l.mode === "settle").length).toBe(1); // the rest are queued 120 ms apart
    run(e, 3);
    expect(e.turnedCount()).toBe(3);
    expect(e.idle()).toBe(true);
    e.turnTo(1);
    run(e, 3);
    expect(e.turnedCount()).toBe(1);
  });

  it("with reduced motion every turn lands at once", () => {
    const e = makeBook({ reduced: () => true });
    e.turnTo(2);
    e.step(1 / 60);
    expect(e.turnedCount()).toBe(2);
    expect(e.leaves[1].theta).toBe(PI);
    expect(e.idle()).toBe(true);
    e.setClosed(true);
    e.step(1 / 60);
    expect(e.closed).toBe(true);
  });
});

describe("BookEngine · the cover", () => {
  it("closing carries the turned pages and the flyleaf with it; opening brings only the flyleaf back", () => {
    const e = makeBook();
    e.setTurned(2);
    e.setClosed(true);
    run(e, 4);
    expect(e.closed).toBe(true);
    expect(e.turnedCount()).toBe(0);
    expect(e.endpapers[0].theta).toBe(0);
    expect(e.idle()).toBe(true);
    e.setClosed(false);
    run(e, 4);
    expect(e.closed).toBe(false);
    expect(e.endpapers[0].theta).toBe(PI);
    expect(e.turnedCount()).toBe(0);
  });

  it("nothing crosses its neighbour while the cover closes over a page still turning", () => {
    const e = makeBook();
    e.turnTo(1);
    run(e, 0.12);
    e.setClosed(true);
    let worst = 0;
    for (let t = 0; t < 4; t += 1 / 120) {
      e.step(1 / 120);
      worst = Math.max(worst, worstCrossing(e));
    }
    expect(worst).toBeLessThan(1e-6);
    expect(e.closed).toBe(true);
  });

  it("a page riding the cover keeps its tip out of the cover's plane", () => {
    const e = makeBook();
    e.setTurned(2);
    e.setClosed(true);
    let worst = 0;
    for (let t = 0; t < 4; t += 1 / 120) {
      e.step(1 / 120);
      for (const leaf of e.leaves) {
        for (const u of [0.25, 0.5, 1]) worst = Math.min(worst, e.clearance(leaf.index, leaf.theta, e.cover.theta, u));
      }
    }
    expect(worst).toBeGreaterThan(-0.002);
  });

  it("dragging the cover's margin closes the book; a tap on the shut book opens it", () => {
    const e = makeBook();
    const sheet = drag(e, -1.0, 0.6, 0.5, 0, true);
    expect(sheet).toBe(e.cover);
    run(e, 4);
    expect(e.closed).toBe(true);
    const tapped = e.grab(0.3, 0);
    expect(tapped).toBe(e.cover);
    e.release(-e.params.flick * 1.5);
    run(e, 4);
    expect(e.closed).toBe(false);
  });

  it("the shut cover sits above every sheet's flat part", () => {
    const e = makeBook();
    const top = e.flatZ(0, 0);
    expect(e.geom.hingeClosed.z).toBeGreaterThan(top);
    expect(e.coverLimit(0, 0.001)).toBeGreaterThanOrEqual(0);
    expect(e.coverLimit(0, PI)).toBe(PI);
  });
});

describe("BookEngine · bend", () => {
  it("is flat at rest and never crosses a neighbour", () => {
    const e = makeBook();
    e.step(1 / 60);
    expect(e.bendOf(e.leaves[0])).toBe(0);
    e.setTurned(1);
    e.setClosed(true);
    for (let t = 0; t < 2; t += 1 / 120) {
      e.step(1 / 120);
      const leaf = e.leaves[0];
      const f = 1 + e.params.spread * 0.85;
      expect(e.bendOf(leaf) * f).toBeLessThanOrEqual(leaf.bendMax + 1e-9);
      expect(e.bendOf(leaf) * f).toBeGreaterThanOrEqual(leaf.bendMin - 1e-9);
    }
  });

  it("the cover is rigid", () => {
    const e = makeBook();
    expect(e.bendOf(e.cover)).toBe(0);
  });
});

describe("BookEngine · geometry probe", () => {
  /** The deepest any turned leaf gets into the cover's inner face, sampled at 41 points along the page, over a whole close. */
  function deepest(e: BookEngine, seconds: number, each?: (t: number) => void) {
    let worst = 0;
    for (let t = 0; t < seconds; t += 1 / 120) {
      each?.(t);
      e.step(1 / 120);
      for (const leaf of e.leaves) {
        if (leaf.theta < 0.02) continue; // lying on the right, under the shut cover's plane by construction
        for (let k = 1; k <= 40; k++) worst = Math.min(worst, e.clearance(leaf.index, leaf.theta, e.cover.theta, k / 40));
      }
    }
    return worst;
  }

  it("a page flicked a moment before the book is shut never cuts into the cover", () => {
    const e = makeBook();
    e.setTurned(1);
    drag(e, 0.9, 0.7, 0.05);
    run(e, 0.05);
    e.setClosed(true);
    expect(deepest(e, 4)).toBeGreaterThan(-0.002);
    expect(e.closed).toBe(true);
  });

  it("shutting the cover by hand over two turned pages never cuts into the cover", () => {
    const e = makeBook();
    e.setTurned(2);
    e.grab(-1.0, 0, true);
    const worst = deepest(e, 4, (t) => {
      if (t < 0.6) e.move(-1.0 + (t / 0.6) * 1.8);
      else if (e.active) e.release(1.5);
    });
    expect(worst).toBeGreaterThan(-0.002);
    expect(e.closed).toBe(true);
  });
});
