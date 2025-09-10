export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function toFixed2(n: number) {
  return Math.round(n * 100) / 100;
}

