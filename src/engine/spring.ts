/**
 * Numeric helpers for the book engine — pure functions, no state.
 *
 * `springStep` takes Apple's pair (damping ratio + response seconds) and is
 * stepped by the caller, so the engine advances every sheet from one clock
 * and tests run it with no animation frame at all.
 */

export const PI = Math.PI;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Hermite smoothstep on 0..1. */
export const smooth01 = (k: number): number => {
  const t = clamp(k, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Advance a damped spring by `dt` seconds (semi-implicit Euler, sub-stepped
 * at ≤ 1/240 s so a 50 ms frame stays stable). Returns [value, velocity].
 */
export function springStep(x: number, v: number, target: number, damping: number, response: number, dt: number): [number, number] {
  const w = (2 * PI) / Math.max(0.01, response);
  const k = w * w;
  const c = 2 * damping * w;
  let t = dt;
  while (t > 0) {
    const h = Math.min(t, 1 / 240);
    const a = k * (target - x) - c * v;
    v += a * h;
    x += v * h;
    t -= h;
  }
  return [x, v];
}

/** Exponential low-pass: `value` chases `input` with time constant `tau`. */
export const lowPass = (value: number, input: number, tau: number, dt: number): number =>
  value + (input - value) * (1 - Math.exp(-dt / Math.max(1e-4, tau)));
