import { describe, expect, it } from "vitest";
import { lowPass, springStep } from "./spring";

describe("springStep", () => {
  it("stays bounded and converges for short responses and long frames", () => {
    for (const response of [0.005, 0.01, 0.02, 0.03, 0.04, 0.5, 2]) {
      for (const damping of [0.3, 0.82, 1, 1.2]) {
        for (const dt of [1 / 120, 1 / 30]) {
          let x = 0;
          let v = 0;
          let peak = 0;
          for (let t = 0; t < 12; t += dt) {
            [x, v] = springStep(x, v, 1, damping, response, dt);
            peak = Math.max(peak, Math.abs(x));
          }
          expect(Number.isFinite(x)).toBe(true);
          expect(peak).toBeLessThan(2);
          expect(x).toBeCloseTo(1, 3);
        }
      }
    }
  });

  it("is critically damped at ζ = 1: no overshoot", () => {
    let x = 0;
    let v = 0;
    let peak = 0;
    for (let i = 0; i < 240; i++) {
      [x, v] = springStep(x, v, 1, 1, 0.5, 1 / 120);
      peak = Math.max(peak, x);
    }
    expect(peak).toBeLessThanOrEqual(1 + 1e-3);
  });
});

describe("lowPass", () => {
  it("does not depend on how the time is split into frames", () => {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 60; i++) a = lowPass(a, 1, 0.09, 1 / 60);
    for (let i = 0; i < 240; i++) b = lowPass(b, 1, 0.09, 1 / 240);
    expect(a).toBeCloseTo(b, 10);
    expect(a).toBeCloseTo(1 - Math.exp(-1 / 0.09), 10);
  });
});
