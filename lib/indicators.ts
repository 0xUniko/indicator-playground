import { clamp } from "./utils";
import type { MACD } from "./types";

export function sma(values: number[], period: number): Array<number | null> {
  const res: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0) return res;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) res[i] = sum / period;
  }
  return res;
}

export function ema(values: number[], period: number): Array<number | null> {
  const res: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0) return res;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev == null) {
      if (i >= period - 1) {
        let sum = 0;
        for (let j = i - (period - 1); j <= i; j++) sum += values[j];
        prev = sum / period;
        res[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      res[i] = prev;
    }
  }
  return res;
}

export function rsi(values: number[], period: number): Array<number | null> {
  const res: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0) return res;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const up = Math.max(0, change);
    const down = Math.max(0, -change);
    if (i <= period) {
      gain += up;
      loss += down;
      if (i === period) {
        const avgGain = gain / period;
        const avgLoss = loss / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        res[i] = 100 - 100 / (1 + rs);
      }
    }
  }
  // Wilder's smoothing after seed
  gain = 0;
  loss = 0;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const up = Math.max(0, change);
    const down = Math.max(0, -change);
    if (i <= period) {
      gain += up;
      loss += down;
      if (i === period) {
        avgGain = gain / period;
        avgLoss = loss / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        res[i] = 100 - 100 / (1 + rs);
      }
    } else {
      avgGain = (avgGain * (period - 1) + up) / period;
      avgLoss = (avgLoss * (period - 1) + down) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      res[i] = 100 - 100 / (1 + rs);
    }
  }
  return res;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MACD {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdArr: Array<number | null> = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i]! - emaSlow[i]!) : null
  );
  const macdVals: number[] = macdArr.map((v) => (v == null ? NaN : v));
  const signalArr = ema(macdVals.map((v) => (Number.isNaN(v) ? 0 : v)), signalPeriod);
  const signal: Array<number | null> = signalArr.map((v, i) => (macdArr[i] == null ? null : v));
  const hist: Array<number | null> = macdArr.map((v, i) => (v == null || signal[i] == null ? null : v - signal[i]!));
  return { macd: macdArr, signal, hist };
}

