import { toFixed2 } from "./utils";
import type { Candle } from "./types";

// Seedable PRNG (deterministic for SSR hydration safety)
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Geometric Brownian Motion bars with intra-bar substeps to estimate high/low
export function genGBMBars(
  n = 60,
  start = 100,
  mu = 0.001,
  sigma = 0.02,
  rng: () => number = Math.random,
  substeps = 4
): Candle[] {
  const res: Candle[] = [];
  let last = start;
  for (let i = 0; i < n; i++) {
    const open = last;
    let price = open;
    let barHigh = open;
    let barLow = open;
    const dt = 1 / substeps;
    for (let s = 0; s < substeps; s++) {
      // Box-Muller for standard normal from uniform rng
      let u1 = 0, u2 = 0;
      while (u1 === 0) { u1 = rng(); }
      u2 = rng();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const step = (mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z;
      price = price * Math.exp(step);
      barHigh = Math.max(barHigh, price);
      barLow = Math.min(barLow, price);
    }
    const close = price;
    res.push({
      time: i,
      open: toFixed2(open),
      high: toFixed2(barHigh),
      low: toFixed2(barLow),
      close: toFixed2(close),
    });
    last = close;
  }
  return res;
}

