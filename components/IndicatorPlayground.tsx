"use client";

import { genGBMBars, mulberry32 } from "@/lib/gbm";
import { ema, macd, rsi, sma } from "@/lib/indicators";
import type { Candle } from "@/lib/types";
import { clamp, toFixed2 } from "@/lib/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";

// ---------------------------
// Main component
// ---------------------------
const DEFAULT_MU = 0.001;
const DEFAULT_SIGMA = 0.02;

type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
const TF_TO_MINUTES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

export default function IndicatorPlayground() {
  // Use a fixed-seed RNG for initial data to avoid SSR/client mismatch
  const [baseCandles, setBaseCandles] = useState<Candle[]>(() => genGBMBars(80, 100, DEFAULT_MU, DEFAULT_SIGMA, mulberry32(1)));
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [selected, setSelected] = useState<number | null>(null);

  // Indicator settings
  // Common SMA/EMA line configs
  type LineConfig = { label: string; period: number; color: string; show: boolean };
  const [smaConfigs, setSmaConfigs] = useState<LineConfig[]>([
    { label: "SMA5", period: 5, color: "#ef4444", show: true },
    { label: "SMA10", period: 10, color: "#f59e0b", show: true },
    { label: "SMA20", period: 20, color: "#22c55e", show: true },
    { label: "SMA50", period: 50, color: "#3b82f6", show: false },
    { label: "SMA200", period: 200, color: "#a855f7", show: false },
  ]);
  const [emaConfigs, setEmaConfigs] = useState<LineConfig[]>([
    { label: "EMA5", period: 5, color: "#a855f7", show: false },
    { label: "EMA10", period: 10, color: "#60a5fa", show: false },
    { label: "EMA20", period: 20, color: "#f43f5e", show: false },
    { label: "EMA50", period: 50, color: "#14b8a6", show: false },
    { label: "EMA200", period: 200, color: "#eab308", show: false },
  ]);

  const [showRSI, setShowRSI] = useState(true);
  const [rsiPeriod, setRsiPeriod] = useState(14);

  const [showMACD, setShowMACD] = useState(true);
  const [macdFast, setMacdFast] = useState(12);
  const [macdSlow, setMacdSlow] = useState(26);
  const [macdSignal, setMacdSignal] = useState(9);

  // GBM parameters
  const [gbmMu, setGbmMu] = useState<number>(DEFAULT_MU);
  const [gbmSigma, setGbmSigma] = useState<number>(DEFAULT_SIGMA);

  // Batch generate count (adjustable)
  const [batchCount, setBatchCount] = useState<number>(50);

  // Undo/Redo stacks for edits
  const [undoStack, setUndoStack] = useState<Candle[][]>([]);
  const [redoStack, setRedoStack] = useState<Candle[][]>([]);
  const editSessionRef = useRef(false);
  const pushUndoSnapshot = (snapshot: Candle[]) => {
    setUndoStack((u) => [...u, snapshot.map((c) => ({ ...c }))]);
    setRedoStack([]);
  };
  const undo = () => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1];
      setRedoStack((r) => [...r, baseCandles.map((c) => ({ ...c }))]);
      setBaseCandles(prev.map((c) => ({ ...c })));
      return u.slice(0, -1);
    });
  };
  const redo = () => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const nextState = r[r.length - 1];
      setUndoStack((u) => [...u, baseCandles.map((c) => ({ ...c }))]);
      setBaseCandles(nextState.map((c) => ({ ...c })));
      return r.slice(0, -1);
    });
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(900);

  // Viewport state: pan/zoom on X axis
  const [viewStart, setViewStart] = useState(0); // index (float) of left-most bar
  const [viewCount, setViewCount] = useState(80); // number of bars visible

  // Observe container width for responsive chart
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w) setWidth(w);
      }
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  // Adjust viewport when timeframe changes to preserve visible time span and fit Y
  const prevTimeframeRef = useRef<Timeframe>("1m");
  useEffect(() => {
    const gOld = TF_TO_MINUTES[prevTimeframeRef.current] || 1;
    const gNew = TF_TO_MINUTES[timeframe] || 1;
    if (gOld === gNew) return;
    const oldLen = gOld <= 1 ? baseCandles.length : Math.floor(baseCandles.length / gOld);
    const newLen = gNew <= 1 ? baseCandles.length : Math.floor(baseCandles.length / gNew);
    if (newLen <= 0) {
      prevTimeframeRef.current = timeframe;
      return;
    }
    const baseStart = viewStart * gOld;
    const baseSpan = Math.max(1, viewCount) * gOld;
    let newCount = Math.max(5, Math.round(baseSpan / gNew));
    newCount = Math.min(newCount, Math.max(1, newLen));
    let newStart = baseStart / gNew;
    newStart = clamp(newStart, 0, Math.max(0, newLen - newCount));
    setViewCount(newCount);
    setViewStart(newStart);
    // Fit Y so user does not need manual adjust after TF change
    setYZoomFactor(1);
    setYCenter(null);
    prevTimeframeRef.current = timeframe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, baseCandles.length]);

  // Aggregate candles for current timeframe
  const candles = useMemo(() => {
    const g = TF_TO_MINUTES[timeframe];
    if (!g || g <= 1) return baseCandles;
    const out: Candle[] = [];
    const n = baseCandles.length;
    const lastGroup = Math.floor(n / g);
    for (let gi = 0; gi < lastGroup; gi++) {
      const start = gi * g;
      const end = Math.min(n - 1, start + g - 1);
      const first = baseCandles[start];
      const last = baseCandles[end];
      let hi = -Infinity;
      let lo = Infinity;
      for (let i = start; i <= end; i++) {
        const c = baseCandles[i];
        if (!c) continue;
        if (c.high > hi) hi = c.high;
        if (c.low < lo) lo = c.low;
      }
      out.push({ time: gi, open: first.open, high: hi, low: lo, close: last.close });
    }
    return out;
  }, [baseCandles, timeframe]);

  // Keep viewport within bounds when data length changes
  useEffect(() => {
    setViewCount((v) => Math.min(v, Math.max(1, candles.length)));
    setViewStart((s) => clamp(s, 0, Math.max(0, candles.length - Math.min(viewCount, candles.length))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length]);

  const closeValues = useMemo(() => candles.map((c) => c.close), [candles]);
  const smaSeries = useMemo(
    () =>
      smaConfigs.map((cfg) => ({
        ...cfg,
        values: sma(closeValues, cfg.period),
      })),
    [closeValues, smaConfigs]
  );
  const emaSeries = useMemo(
    () =>
      emaConfigs.map((cfg) => ({
        ...cfg,
        values: ema(closeValues, cfg.period),
      })),
    [closeValues, emaConfigs]
  );
  const rsiVals = useMemo(() => rsi(closeValues, rsiPeriod), [closeValues, rsiPeriod]);
  const macdVals = useMemo(() => macd(closeValues, macdFast, macdSlow, macdSignal), [closeValues, macdFast, macdSlow, macdSignal]);

  // Layout
  const [priceBaseHeight, setPriceBaseHeight] = useState(600); // SSR-safe default
  useEffect(() => {
    // After mount, grow to ~66vh to avoid scrollbars on typical layouts
    const h = Math.max(520, Math.floor(window.innerHeight * 0.66));
    setPriceBaseHeight(h);
    const onResize = () => setPriceBaseHeight(Math.max(520, Math.floor(window.innerHeight * 0.66)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const priceHeight = priceBaseHeight;
  const oscillators: Array<"RSI" | "MACD"> = [];
  if (showRSI) oscillators.push("RSI");
  if (showMACD) oscillators.push("MACD");
  const oscCount = oscillators.length;
  const oscHeight = oscCount > 0 ? 180 * oscCount + 16 * (oscCount - 1) : 0;
  const totalHeight = priceHeight + (oscHeight || 0);
  const paddingLeft = 48;
  const paddingRight = 16;
  const innerWidth = Math.max(100, width - paddingLeft - paddingRight);

  // X scale
  const step = innerWidth / Math.max(1, viewCount);
  const barW = clamp(Math.floor(step * 0.6), 3, 22);

  // Y scale base on visible window
  const visStart = Math.max(0, Math.floor(viewStart));
  const visEnd = Math.min(candles.length - 1, Math.ceil(viewStart + viewCount) - 1);
  const baseY = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = visStart; i <= visEnd; i++) {
      const c = candles[i];
      if (!c) continue;
      min = Math.min(min, c.low);
      max = Math.max(max, c.high);
    }
    for (const series of smaSeries) if (series.show) {
      for (let i = visStart; i <= visEnd; i++) {
        const v = series.values[i];
        if (v == null) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    for (const series of emaSeries) if (series.show) {
      for (let i = visStart; i <= visEnd; i++) {
        const v = series.values[i];
        if (v == null) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = (candles[visStart]?.close ?? 0) - 1;
      max = (candles[visStart]?.close ?? 0) + 1;
    }
    const pad = (max - min) * 0.08 || 1;
    return { min: min - pad, max: max + pad };
  }, [candles, smaSeries, emaSeries, visStart, visEnd]);

  // Vertical zoom state: factor and center price
  const [yZoomFactor, setYZoomFactor] = useState(1);
  const [yCenter, setYCenter] = useState<number | null>(null);

  const yRange = Math.max(1e-6, (baseY.max - baseY.min) * yZoomFactor);
  const yC = yCenter ?? (baseY.min + baseY.max) / 2;
  const yMin = yC - yRange / 2;
  const yMax = yC + yRange / 2;
  const priceToY = (p: number) => {
    const t = (p - yMin) / (yMax - yMin);
    return Math.round((1 - t) * (priceHeight - 20) + 10);
  };
  const yToPrice = (y: number) => {
    const t = clamp((y - 10) / (priceHeight - 20), 0, 1);
    const v = yMax - t * (yMax - yMin);
    return toFixed2(v);
  };

  // Interaction: drag O/H/L/C handles
  type DragField = "open" | "high" | "low" | "close";
  const dragRef = useRef<{ index: number; field: DragField } | null>(null);
  const [isDraggingCandle, setIsDraggingCandle] = useState(false);
  // Interaction: drag SMA/EMA points
  type MAKind = "SMA" | "EMA";
  const maDragRef = useRef<{ kind: MAKind; period: number; index: number } | null>(null);
  const [isDraggingMA, setIsDraggingMA] = useState(false);

  // Helper: apply edits from higher timeframe to underlying base candles
  const applyEditToGroup = (prev: Candle[], tfIndex: number, field: DragField, newVal: number): Candle[] => {
    const g = TF_TO_MINUTES[timeframe];
    if (g <= 1) {
      // 1m direct edit handled elsewhere
      return prev;
    }
    const out = [...prev];
    const n = prev.length;
    const start = tfIndex * g;
    const end = Math.min(n - 1, start + g - 1);
    if (start < 0 || start >= n) return prev;
    // Aggregate values of this group
    const aggOpen = prev[start]?.open ?? 0;
    const aggClose = prev[end]?.close ?? 0;
    let aggHigh = -Infinity;
    let aggLow = Infinity;
    for (let i = start; i <= end; i++) {
      const c = prev[i];
      if (!c) continue;
      if (c.high > aggHigh) aggHigh = c.high;
      if (c.low < aggLow) aggLow = c.low;
    }
    const randIndex = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

    if (field === "open") {
      const delta = newVal - aggOpen;
      const c = { ...out[start] };
      c.open = c.open + delta; // equals newVal
      c.high = Math.max(c.high, c.open, c.close);
      c.low = Math.min(c.low, c.open, c.close);
      out[start] = c;
      // maintain continuity: previous close == current open
      if (start - 1 >= 0) {
        const p = { ...out[start - 1] };
        p.close = c.open;
        p.high = Math.max(p.high, p.open, p.close);
        p.low = Math.min(p.low, p.open, p.close);
        out[start - 1] = p;
      }
      return out;
    }
    if (field === "close") {
      const delta = newVal - aggClose;
      const c = { ...out[end] };
      c.close = c.close + delta; // equals newVal
      c.high = Math.max(c.high, c.open, c.close);
      c.low = Math.min(c.low, c.open, c.close);
      out[end] = c;
      // maintain continuity: next open == current close
      if (end + 1 < out.length) {
        const n1 = { ...out[end + 1] };
        n1.open = c.close;
        n1.high = Math.max(n1.high, n1.open, n1.close);
        n1.low = Math.min(n1.low, n1.open, n1.close);
        out[end + 1] = n1;
      }
      return out;
    }
    if (field === "high") {
      let target = newVal;
      // Respect per-candle constraints
      const allowedMinHigh = [] as number[];
      for (let i = start; i <= end; i++) {
        const c = prev[i];
        allowedMinHigh.push(Math.max(c.open, c.close));
      }
      const floorHigh = Math.max(...allowedMinHigh);
      if (target < floorHigh) target = floorHigh;
      if (target >= aggHigh) {
        // raise: pick randomly among current max-high candles
        const maxIdxs: number[] = [];
        for (let i = start; i <= end; i++) if (prev[i].high === aggHigh) maxIdxs.push(i);
        const k = maxIdxs.length ? maxIdxs[randIndex(0, maxIdxs.length - 1)] : randIndex(start, end);
        const c = { ...out[k] };
        c.high = Math.max(target, Math.max(c.open, c.close));
        out[k] = c;
      } else {
        // lower: clamp all highs down to target respecting constraints
        for (let i = start; i <= end; i++) {
          const c = { ...out[i] };
          const minHi = Math.max(c.open, c.close);
          c.high = Math.max(minHi, Math.min(c.high, target));
          out[i] = c;
        }
        // ensure at least one equals target if feasible
        let candidates: number[] = [];
        for (let i = start; i <= end; i++) {
          const minHi = Math.max(out[i].open, out[i].close);
          if (minHi <= target) candidates.push(i);
        }
        if (candidates.length) {
          const k = candidates[randIndex(0, candidates.length - 1)];
          const c = { ...out[k] };
          c.high = Math.max(Math.max(c.open, c.close), target);
          out[k] = c;
        }
      }
      return out;
    }
    if (field === "low") {
      let target = newVal;
      // Respect per-candle constraints
      const allowedMaxLow = [] as number[];
      for (let i = start; i <= end; i++) {
        const c = prev[i];
        allowedMaxLow.push(Math.min(c.open, c.close));
      }
      const ceilLow = Math.min(...allowedMaxLow);
      if (target > ceilLow) target = ceilLow;
      if (target <= aggLow) {
        // lower: pick randomly among current min-low candles
        const minIdxs: number[] = [];
        for (let i = start; i <= end; i++) if (prev[i].low === aggLow) minIdxs.push(i);
        const k = minIdxs.length ? minIdxs[randIndex(0, minIdxs.length - 1)] : randIndex(start, end);
        const c = { ...out[k] };
        c.low = Math.min(target, Math.min(c.open, c.close));
        out[k] = c;
      } else {
        // raise: clamp all lows up to target respecting constraints
        for (let i = start; i <= end; i++) {
          const c = { ...out[i] };
          const maxLo = Math.min(c.open, c.close);
          c.low = Math.min(maxLo, Math.max(c.low, target));
          out[i] = c;
        }
        // ensure at least one equals target if feasible
        let candidates: number[] = [];
        for (let i = start; i <= end; i++) {
          const maxLo = Math.min(out[i].open, out[i].close);
          if (maxLo >= target) candidates.push(i);
        }
        if (candidates.length) {
          const k = candidates[randIndex(0, candidates.length - 1)];
          const c = { ...out[k] };
          c.low = Math.min(Math.min(c.open, c.close), target);
          out[k] = c;
        }
      }
      return out;
    }
    return out;
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { index, field } = dragRef.current;
      const svg = priceSvgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const newPrice = yToPrice(y);
      if (timeframe === "1m") {
        setBaseCandles((prev) => {
          if (!editSessionRef.current) {
            pushUndoSnapshot(prev);
            editSessionRef.current = true;
          }
          const next = [...prev];
          const baseIdx = index;
          const c0 = { ...next[baseIdx] };
          if (field === "open") {
            c0.open = newPrice;
            // continuity: previous close equals current open
            if (baseIdx - 1 >= 0) {
              const p = { ...next[baseIdx - 1] };
              p.close = c0.open;
              p.high = Math.max(p.high, p.open, p.close);
              p.low = Math.min(p.low, p.open, p.close);
              next[baseIdx - 1] = p;
            }
          }
          if (field === "close") {
            c0.close = newPrice;
            // continuity: next open equals current close
            if (baseIdx + 1 < next.length) {
              const n1 = { ...next[baseIdx + 1] };
              n1.open = c0.close;
              n1.high = Math.max(n1.high, n1.open, n1.close);
              n1.low = Math.min(n1.low, n1.open, n1.close);
              next[baseIdx + 1] = n1;
            }
          }
          if (field === "high") c0.high = Math.max(newPrice, c0.open, c0.close);
          if (field === "low") c0.low = Math.min(newPrice, c0.open, c0.close);
          c0.low = Math.min(c0.low, c0.open, c0.close, c0.high);
          c0.high = Math.max(c0.low, c0.open, c0.close, c0.high);
          next[baseIdx] = c0;
          return next;
        });
      } else {
        setBaseCandles((prev) => {
          if (!editSessionRef.current) {
            pushUndoSnapshot(prev);
            editSessionRef.current = true;
          }
          return applyEditToGroup(prev, index, field, newPrice);
        });
      }
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      editSessionRef.current = false;
      setIsDraggingCandle(false);
    };
    if (isDraggingCandle) {
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDraggingCandle, priceHeight, yMin, yMax, timeframe]);

  // Drag moving averages to adjust candles
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!maDragRef.current) return;
      const { kind, period, index } = maDragRef.current;
      const svg = priceSvgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const target = yToPrice(y);
      const g = TF_TO_MINUTES[timeframe] || 1;
      const nBase = baseCandles.length;
      const baseEnd = Math.min(nBase - 1, index * g + (g - 1));
      if (baseEnd < 0 || baseEnd >= nBase) return;
      if (kind === "SMA") {
        const j = index - (period - 1);
        if (j < 0) return;
        let windowSum = 0;
        for (let t = j; t <= index; t++) windowSum += (candles[t]?.close ?? 0);
        const newSum = period * target;
        const delta = newSum - windowSum;
        setBaseCandles((prev) => {
          if (!editSessionRef.current) {
            pushUndoSnapshot(prev);
            editSessionRef.current = true;
          }
          const out = [...prev];
          const c = { ...out[baseEnd] };
          c.close = c.close + delta;
          c.high = Math.max(c.high, c.open, c.close);
          c.low = Math.min(c.low, c.open, c.close);
          out[baseEnd] = c;
          // continuity: next open equals current close
          if (baseEnd + 1 < out.length) {
            const n1 = { ...out[baseEnd + 1] };
            n1.open = c.close;
            n1.high = Math.max(n1.high, n1.open, n1.close);
            n1.low = Math.min(n1.low, n1.open, n1.close);
            out[baseEnd + 1] = n1;
          }
          return out;
        });
      } else {
        const k = 2 / (period + 1);
        const emaVals = ema(closeValues, period);
        const prevE = emaVals[index - 1];
        if (prevE == null) return;
        const newClose = (target - (1 - k) * prevE) / k;
        const delta = newClose - (candles[index]?.close ?? newClose);
        setBaseCandles((prev) => {
          if (!editSessionRef.current) {
            pushUndoSnapshot(prev);
            editSessionRef.current = true;
          }
          const out = [...prev];
          const c = { ...out[baseEnd] };
          c.close = c.close + delta;
          c.high = Math.max(c.high, c.open, c.close);
          c.low = Math.min(c.low, c.open, c.close);
          out[baseEnd] = c;
          // continuity: next open equals current close
          if (baseEnd + 1 < out.length) {
            const n1 = { ...out[baseEnd + 1] };
            n1.open = c.close;
            n1.high = Math.max(n1.high, n1.open, n1.close);
            n1.low = Math.min(n1.low, n1.open, n1.close);
            out[baseEnd + 1] = n1;
          }
          return out;
        });
      }
    };
    const onUp = () => {
      maDragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      editSessionRef.current = false;
      setIsDraggingMA(false);
    };
    if (isDraggingMA) {
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [isDraggingMA, timeframe, baseCandles.length, candles, closeValues]);

  const priceSvgRef = useRef<SVGSVGElement | null>(null);

  // Pan and zoom handlers
  const panRef = useRef<{ lastX: number; lastY: number; startX: number; startY: number; active: boolean } | null>(null);

  const isHandleTarget = (el: EventTarget | null) => {
    return !!(el as Element | null)?.getAttribute?.("data-role") && (el as Element).getAttribute("data-role") === "handle";
  };

  const beginPan = (e: React.PointerEvent) => {
    // If starting on a drag handle, do not pan (let price handle drag instead)
    if (isHandleTarget(e.target)) return;
    // Record start; activate only after small threshold movement to preserve click-to-select
    panRef.current = { lastX: e.clientX, lastY: e.clientY, startX: e.clientX, startY: e.clientY, active: false };
  };
  const onPanMove = (e: React.PointerEvent) => {
    const pr = panRef.current;
    if (!pr) return;
    const dx0 = e.clientX - pr.startX;
    const dy0 = e.clientY - pr.startY;
    const dist = Math.hypot(dx0, dy0);
    if (!pr.active && dist > 3) {
      // Start panning and capture pointer once user moves
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      pr.active = true;
    }
    if (!pr.active) return;
    const dx = e.clientX - pr.lastX;
    const dy = e.clientY - pr.lastY;
    pr.lastX = e.clientX;
    pr.lastY = e.clientY;
    const deltaBars = dx / step;
    setViewStart((s) => clamp(s - deltaBars, 0, Math.max(0, candles.length - viewCount)));
    // Vertical pan: adjust yCenter by price per pixel
    const pricePerPixel = (yMax - yMin) / Math.max(1, (priceHeight - 20));
    setYCenter((c) => {
      const current = c ?? (baseY.min + baseY.max) / 2;
      // Make content follow the drag: dragging up (dy < 0) moves view up (decrease center)
      return current + dy * pricePerPixel;
    });
  };
  const endPan = (e: React.PointerEvent) => {
    const pr = panRef.current;
    if (!pr) return;
    if (pr.active) {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    }
    panRef.current = null;
  };

  const applyZoomAt = (clientX: number, deltaY: number) => {
    if (!priceSvgRef.current) return;
    const rect = priceSvgRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const anchorIndex = viewStart + clamp((x - paddingLeft) / step, 0, viewCount);
    const factor = deltaY > 0 ? 1.1 : 0.9;
    const newCount = clamp(Math.round(viewCount * factor), 5, Math.max(5, candles.length));
    const newStep = innerWidth / newCount;
    let newStart = anchorIndex - clamp((x - paddingLeft) / newStep, 0, newCount);
    newStart = clamp(newStart, 0, Math.max(0, candles.length - newCount));
    setViewCount(newCount);
    setViewStart(newStart);
  };

  const applyYZoomAt = (clientY: number, deltaY: number) => {
    if (!priceSvgRef.current) return;
    const rect = priceSvgRef.current.getBoundingClientRect();
    const y = clientY - rect.top;
    const anchorPrice = yToPrice(y);
    const factor = deltaY > 0 ? 1.1 : 0.9;
    setYZoomFactor((f) => clamp(f * factor, 0.05, 10));
    setYCenter(anchorPrice);
  };

  const zoomIn = () => {
    const centerX = (priceSvgRef.current?.getBoundingClientRect().left ?? 0) + paddingLeft + innerWidth / 2;
    applyZoomAt(centerX, -100);
  };
  const zoomOut = () => {
    const centerX = (priceSvgRef.current?.getBoundingClientRect().left ?? 0) + paddingLeft + innerWidth / 2;
    applyZoomAt(centerX, 100);
  };

  // Fullscreen toggle
  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await containerRef.current.requestFullscreen();
    }
  };

  // Attach non-passive wheel listener to allow preventDefault
  useEffect(() => {
    const el = priceSvgRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      if (ev.altKey) {
        applyYZoomAt(ev.clientY, ev.deltaY);
      } else {
        applyZoomAt(ev.clientX, ev.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel as EventListener);
  }, [applyZoomAt, innerWidth, paddingLeft, step, viewCount, viewStart, candles.length, yMin, yMax]);

  const handlePointerDown = (index: number, field: DragField) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { index, field };
    setSelected(index);
    if (!editSessionRef.current) {
      pushUndoSnapshot(baseCandles);
      editSessionRef.current = true;
    }
    setIsDraggingCandle(true);
    // Immediately apply a change on pointer down so a simple click sets value
    const svg = priceSvgRef.current;
    if (svg) {
      const rect = svg.getBoundingClientRect();
      const y = (e as any).clientY - rect.top;
      const newPrice = yToPrice(y);
      if (timeframe === "1m") {
        setBaseCandles((prev) => {
          const next = [...prev];
          const baseIdx = index;
          const c0 = { ...next[baseIdx] };
          
          if (field === "open") {
            c0.open = newPrice;
            if (baseIdx - 1 >= 0) {
              const p = { ...next[baseIdx - 1] };
              p.close = c0.open;
              p.high = Math.max(p.high, p.open, p.close);
              p.low = Math.min(p.low, p.open, p.close);
              next[baseIdx - 1] = p;
            }
          }
          if (field === "close") {
            c0.close = newPrice;
            if (baseIdx + 1 < next.length) {
              const n1 = { ...next[baseIdx + 1] };
              n1.open = c0.close;
              n1.high = Math.max(n1.high, n1.open, n1.close);
              n1.low = Math.min(n1.low, n1.open, n1.close);
              next[baseIdx + 1] = n1;
            }
          }
          if (field === "high") c0.high = Math.max(newPrice, c0.open, c0.close);
          if (field === "low") c0.low = Math.min(newPrice, c0.open, c0.close);
          c0.low = Math.min(c0.low, c0.open, c0.close, c0.high);
          c0.high = Math.max(c0.low, c0.open, c0.close, c0.high);
          
          next[baseIdx] = c0;
          return next;
        });
      } else {
        setBaseCandles((prev) => applyEditToGroup(prev, index, field, newPrice));
      }
    }
  };

  // Helpers to add/remove/reset data
  const addBar = () => {
    setBaseCandles((prev) => {
      pushUndoSnapshot(prev);
      const g = TF_TO_MINUTES[timeframe] || 1;
      const last = prev[prev.length - 1] ?? ({ close: 100 } as Candle);
      const gen = genGBMBars(g, last.close, gbmMu, gbmSigma, Math.random);
      const offset = prev.length;
      const appended = gen.map((c, i) => ({ ...c, time: offset + i }));
      const newArr = [...prev, ...appended];
      // Keep right edge pinned if we were at the end
      const atEnd = viewStart + viewCount >= candles.length - 0.01;
      if (atEnd) {
        const newLen = g <= 1 ? newArr.length : Math.floor(newArr.length / g);
        setViewStart(Math.max(0, newLen - viewCount));
      }
      return newArr;
    });
  };
  const addBars = (count: number) => {
    if (count <= 0) return;
    setBaseCandles((prev) => {
      pushUndoSnapshot(prev);
      const g = TF_TO_MINUTES[timeframe] || 1;
      const last = prev[prev.length - 1] ?? ({ close: 100 } as Candle);
      const total = Math.max(0, count) * g;
      const gen = genGBMBars(total, last.close, gbmMu, gbmSigma, Math.random);
      const offset = prev.length;
      const appended = gen.map((c, i) => ({ ...c, time: offset + i }));
      const newArr = [...prev, ...appended];
      const atEnd = viewStart + viewCount >= candles.length - 0.01;
      if (atEnd) {
        const newLen = g <= 1 ? newArr.length : Math.floor(newArr.length / g);
        setViewStart(Math.max(0, newLen - viewCount));
      }
      return newArr;
    });
  };
  const removeBar = () =>
    setBaseCandles((prev) => {
      if (prev.length <= 0) return prev;
      pushUndoSnapshot(prev);
      const g = TF_TO_MINUTES[timeframe] || 1;
      const cut = Math.min(prev.length, g);
      const newArr = prev.slice(0, prev.length - cut);
      const atEnd = viewStart + viewCount >= candles.length - 0.01;
      if (atEnd) {
        const newLen = g <= 1 ? newArr.length : Math.floor(newArr.length / g);
        setViewStart(Math.max(0, newLen - viewCount));
      }
      return newArr;
    });
  const resetData = () => {
    const g = TF_TO_MINUTES[timeframe] || 1;
    const data = genGBMBars(80 * g, 100, gbmMu, gbmSigma, mulberry32(1));
    setBaseCandles(data);
    // After reset, show the most recent window
    const newLen = g <= 1 ? data.length : Math.floor(data.length / g);
    setViewStart(Math.max(0, newLen - viewCount));
    setUndoStack([]);
    setRedoStack([]);
  };

  // Grid lines for price chart
  const gridYs = useMemo(() => {
    const lines: number[] = [];
    const ticks = 6;
    for (let i = 0; i <= ticks; i++) {
      const y = Math.round((i / ticks) * (priceHeight - 20) + 10);
      lines.push(y);
    }
    return lines;
  }, [priceHeight]);

  // Oscillator segments (stack if both enabled)
  const oscSegments = useMemo(() => {
    const segs: { kind: "RSI" | "MACD"; top: number; height: number }[] = [];
    let top = priceHeight + 16;
    if (showRSI) {
      segs.push({ kind: "RSI", top, height: 180 });
      top += 180 + 16;
    }
    if (showMACD) {
      segs.push({ kind: "MACD", top, height: 180 });
      top += 180 + 16;
    }
    return segs;
  }, [priceHeight, showRSI, showMACD]);

  return (
    <div className="w-full max-w-none">
      {/* Header + Controls on one line */}
      <div className="flex flex-wrap gap-3 items-center mb-2">
        <div className="flex items-center gap-2 pr-2 border-r border-black/10 dark:border-white/10">
          <span className="text-base font-semibold">K线 × 指标</span>
          <span className="hidden sm:inline text-xs opacity-70">拖拽编辑·滚轮缩放·拖动画布平移</span>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">时间框架</label>
          <div className="flex items-center gap-1 flex-wrap">
            {(["1m","5m","15m","1h","4h","1d"] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                className={`px-2 py-1 text-xs rounded border ${timeframe===tf?"bg-black/10 dark:bg-white/10 border-black/20 dark:border-white/20":"border-black/10 dark:border-white/10"}`}
                onClick={() => { setTimeframe(tf); setSelected(null); }}
                title={`切换至 ${tf}`}
              >{tf}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">GBM μ / σ</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step={0.001}
              className="w-24 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              value={gbmMu}
              onChange={(e) => setGbmMu(clamp(Number(e.target.value || 0), -1, 1))}
              title="漂移 μ (每根bar的期望对数收益)"
            />
            <input
              type="number"
              step={0.001}
              min={0}
              className="w-24 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              value={gbmSigma}
              onChange={(e) => setGbmSigma(clamp(Number(e.target.value || 0), 0, 2))}
              title="波动率 σ (每根bar的对数收益标准差)"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">SMA</label>
          <div className="flex flex-wrap items-center gap-2">
            {smaConfigs.map((cfg, idx) => (
              <label key={cfg.label} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={cfg.show}
                  onChange={(e) =>
                    setSmaConfigs((prev) => {
                      const next = [...prev];
                      next[idx] = { ...prev[idx], show: e.target.checked };
                      return next;
                    })
                  }
                  title={`显示 ${cfg.label}`}
                />
                <span style={{ color: cfg.color }} className="text-xs w-12">{cfg.label}</span>
                <input
                  type="number"
                  className="w-14 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
                  min={1}
                  value={cfg.period}
                  onChange={(e) =>
                    setSmaConfigs((prev) => {
                      const next = [...prev];
                      const val = clamp(parseInt(e.target.value || "1"), 1, 9999);
                      next[idx] = { ...prev[idx], period: val };
                      return next;
                    })
                  }
                  title={`${cfg.label} 周期`}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">EMA</label>
          <div className="flex flex-wrap items-center gap-2">
            {emaConfigs.map((cfg, idx) => (
              <label key={cfg.label} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={cfg.show}
                  onChange={(e) =>
                    setEmaConfigs((prev) => {
                      const next = [...prev];
                      next[idx] = { ...prev[idx], show: e.target.checked };
                      return next;
                    })
                  }
                  title={`显示 ${cfg.label}`}
                />
                <span style={{ color: cfg.color }} className="text-xs w-12">{cfg.label}</span>
                <input
                  type="number"
                  className="w-14 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
                  min={1}
                  value={cfg.period}
                  onChange={(e) =>
                    setEmaConfigs((prev) => {
                      const next = [...prev];
                      const val = clamp(parseInt(e.target.value || "1"), 1, 9999);
                      next[idx] = { ...prev[idx], period: val };
                      return next;
                    })
                  }
                  title={`${cfg.label} 周期`}
                />
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">RSI</label>
          <div className="flex items-center gap-2">
            <input id="rsi" type="checkbox" checked={showRSI} onChange={(e) => setShowRSI(e.target.checked)} />
            <input
              type="number"
              className="w-20 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              min={2}
              value={rsiPeriod}
              onChange={(e) => setRsiPeriod(clamp(parseInt(e.target.value || "2"), 2, 999))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">MACD (F,S,Sig)</label>
          <div className="flex items-center gap-2">
            <input id="macd" type="checkbox" checked={showMACD} onChange={(e) => setShowMACD(e.target.checked)} />
            <input
              type="number"
              className="w-14 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              min={1}
              value={macdFast}
              onChange={(e) => setMacdFast(clamp(parseInt(e.target.value || "1"), 1, 999))}
            />
            <input
              type="number"
              className="w-14 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              min={2}
              value={macdSlow}
              onChange={(e) => setMacdSlow(clamp(parseInt(e.target.value || "2"), 2, 999))}
            />
            <input
              type="number"
              className="w-14 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              min={1}
              value={macdSignal}
              onChange={(e) => setMacdSignal(clamp(parseInt(e.target.value || "1"), 1, 999))}
            />
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2 items-center">
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={undo} disabled={undoStack.length===0}>Undo</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={redo} disabled={redoStack.length===0}>Redo</button>
          <button className="h-9 px-3 rounded bg-foreground text-background" onClick={addBar} title="新增1根当前时间框架K线">Add Bar</button>
          <div className="flex items-center gap-1">
            <span className="text-xs opacity-70">x</span>
            <input
              type="number"
              min={1}
              className="w-16 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              value={batchCount}
              onChange={(e) => setBatchCount(clamp(parseInt(e.target.value || "1"), 1, 100000))}
              title="批量生成数量（以当前时间框架计）"
            />
            <button className="h-9 px-3 rounded bg-foreground/80 text-background" onClick={() => addBars(batchCount)} title="批量新增N根当前时间框架K线">Add xN</button>
          </div>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={removeBar}>Remove Bar</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={resetData}>Reset</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={zoomIn}>Zoom In</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={zoomOut}>Zoom Out</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={() => applyYZoomAt((priceSvgRef.current?.getBoundingClientRect().top ?? 0) + priceHeight / 2, -100)}>Y+</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={() => applyYZoomAt((priceSvgRef.current?.getBoundingClientRect().top ?? 0) + priceHeight / 2, 100)}>Y-</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={() => { setYZoomFactor(1); setYCenter(null); }}>Fit Y</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={toggleFullscreen}>全屏</button>
        </div>
      </div>

      {/* Charts */}
      <div ref={containerRef} className="w-full border border-black/10 dark:border-white/15 rounded-md overflow-hidden">
        <svg
          ref={priceSvgRef}
          width={width}
          height={totalHeight}
          className="block select-none"
          style={{ touchAction: "none", cursor: "grab" }}
          onPointerDown={beginPan}
          onPointerMove={onPanMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          {/* Price grid */}
          {gridYs.map((y, i) => (
            <line key={`grid-${i}`} x1={paddingLeft} x2={paddingLeft + innerWidth} y1={y} y2={y} stroke="currentColor" opacity={0.1} pointerEvents="none" />
          ))}

          {/* Price axis labels */}
          {gridYs.map((y, i) => {
            const val = yToPrice(y);
            return (
              <text key={`label-${i}`} x={6} y={y + 4} fontSize={11} opacity={0.7} pointerEvents="none">
                {val.toFixed(2)}
              </text>
            );
          })}

          {/* Background click targets to clear selection */}
          <rect
            x={paddingLeft}
            y={0}
            width={innerWidth}
            height={priceHeight}
            fill="transparent"
            onClick={() => setSelected(null)}
          />

          {/* Candles */}
          {candles.map((c, i) => {
            if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
            const x = paddingLeft + (i - viewStart) * step + step / 2;
            const yHigh = priceToY(c.high);
            const yLow = priceToY(c.low);
            const yOpen = priceToY(c.open);
            const yClose = priceToY(c.close);
            const up = c.close >= c.open;
            const color = up ? "#16a34a" : "#dc2626"; // green/red
            const top = Math.min(yOpen, yClose);
            const bodyH = Math.max(1, Math.abs(yClose - yOpen));
            return (
              <g key={i} onClick={() => setSelected(i)}>
                <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
                <rect x={x - barW / 2} y={top} width={barW} height={bodyH} fill={color} opacity={0.8} />
                {/* Hit area to make selection easier */}
                <rect x={x - Math.max(barW, step * 0.9) / 2} y={Math.min(yHigh, yLow)} width={Math.max(barW, step * 0.9)} height={Math.abs(yLow - yHigh)} fill="transparent" cursor="pointer" />
                {/* Selection highlight */}
                {selected === i && (
                  <rect x={x - Math.max(barW, step * 0.9) / 2} y={Math.min(yHigh, yLow)} width={Math.max(barW, step * 0.9)} height={Math.abs(yLow - yHigh)} fill="none" stroke="#3b82f6" strokeDasharray="4 4" />
                )}
                {/* Drag handles when selected */}
                {selected === i && (
                  <g>
                    {/* High */}
                    <circle data-role="handle" cx={x} cy={yHigh} r={6} fill="#111" stroke="#3b82f6" strokeWidth={2} onPointerDown={handlePointerDown(i, "high")} cursor="ns-resize" />
                    {/* Low */}
                    <circle data-role="handle" cx={x} cy={yLow} r={6} fill="#111" stroke="#3b82f6" strokeWidth={2} onPointerDown={handlePointerDown(i, "low")} cursor="ns-resize" />
                    {/* Open */}
                    <circle data-role="handle" cx={x - barW / 2 - 8} cy={yOpen} r={5} fill="#111" stroke="#eab308" strokeWidth={2} onPointerDown={handlePointerDown(i, "open")} cursor="ns-resize" />
                    <text x={x - barW / 2 - 8 - 4} y={yOpen + 4} textAnchor="end" fontSize={10} fill="#eab308">O</text>
                    {/* Close */}
                    <circle data-role="handle" cx={x + barW / 2 + 8} cy={yClose} r={5} fill="#111" stroke="#f97316" strokeWidth={2} onPointerDown={handlePointerDown(i, "close")} cursor="ns-resize" />
                    <text x={x + barW / 2 + 8 + 4} y={yClose + 4} textAnchor="start" fontSize={10} fill="#f97316">C</text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Overlays: SMA */}
          {smaSeries.map((series) => series.show && (
            <path
              key={series.label}
              d={series.values
                .map((v, i) => {
                  if (v == null) return null;
                  if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                  const x = paddingLeft + (i - viewStart) * step + step / 2;
                  const y = priceToY(v);
                  const prevNull = i - 1 < 0 || series.values[i - 1] == null || i - 1 < viewStart;
                  return `${prevNull ? "M" : "L"}${x} ${y}`;
                })
                .filter(Boolean)
                .join(" ")}
              fill="none"
              stroke={series.color}
              strokeWidth={1.3}
              pointerEvents="none"
            />
          ))}
          {/* Overlays: EMA */}
          {emaSeries.map((series) => series.show && (
            <path
              key={series.label}
              d={series.values
                .map((v, i) => {
                  if (v == null) return null;
                  if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                  const x = paddingLeft + (i - viewStart) * step + step / 2;
                  const y = priceToY(v);
                  const prevNull = i - 1 < 0 || series.values[i - 1] == null || i - 1 < viewStart;
                  return `${prevNull ? "M" : "L"}${x} ${y}`;
                })
                .filter(Boolean)
                .join(" ")}
              fill="none"
              stroke={series.color}
              strokeWidth={1.3}
              pointerEvents="none"
            />
          ))}

          {/* MA drag handles: invisible hit areas */}
          {smaSeries.map((series) => series.show && series.values.map((v, i) => {
            if (v == null) return null;
            if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
            const x = paddingLeft + (i - viewStart) * step + step / 2;
            const y = priceToY(v);
            return (
              <circle
                key={`sma-h-${series.label}-${i}`}
                data-role="handle"
                cx={x}
                cy={y}
                r={Math.max(6, Math.min(10, barW))}
                fill="transparent"
                stroke="transparent"
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                  maDragRef.current = { kind: "SMA", period: series.period, index: i };
                  setIsDraggingMA(true);
                  if (!editSessionRef.current) {
                    pushUndoSnapshot(baseCandles);
                    editSessionRef.current = true;
                  }
                }}
                cursor="ns-resize"
              />
            );
          }))}
          {emaSeries.map((series) => series.show && series.values.map((v, i) => {
            if (v == null) return null;
            if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
            const x = paddingLeft + (i - viewStart) * step + step / 2;
            const y = priceToY(v);
            return (
              <circle
                key={`ema-h-${series.label}-${i}`}
                data-role="handle"
                cx={x}
                cy={y}
                r={Math.max(6, Math.min(10, barW))}
                fill="transparent"
                stroke="transparent"
                onPointerDown={(e) => {
                  e.preventDefault();
                  (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                  maDragRef.current = { kind: "EMA", period: series.period, index: i };
                  setIsDraggingMA(true);
                  if (!editSessionRef.current) {
                    pushUndoSnapshot(baseCandles);
                    editSessionRef.current = true;
                  }
                }}
                cursor="ns-resize"
              />
            );
          }))}

          {/* Oscillators */}
          {oscSegments.map((seg, segIdx) => {
            if (seg.kind === "RSI") {
              const top = seg.top;
              const h = seg.height;
              const rsiToY = (v: number) => top + (1 - v / 100) * (h - 20) + 10;
              const y30 = rsiToY(30);
              const y70 = rsiToY(70);
              return (
                <g key={`rsi-${segIdx}`}> 
                  <rect x={paddingLeft} y={top} width={innerWidth} height={h} fill="none" stroke="currentColor" opacity={0.12} />
                  {/* bands */}
                  <line x1={paddingLeft} x2={paddingLeft + innerWidth} y1={y30} y2={y30} stroke="#f59e0b" opacity={0.4} />
                  <line x1={paddingLeft} x2={paddingLeft + innerWidth} y1={y70} y2={y70} stroke="#f59e0b" opacity={0.4} />
                  <text x={paddingLeft + 6} y={y30 - 4} fontSize={10} opacity={0.7}>30</text>
                  <text x={paddingLeft + 6} y={y70 - 4} fontSize={10} opacity={0.7}>70</text>
                  {/* line */}
                  <path
                    d={rsiVals
                      .map((v, i) => {
                        if (v == null) return null;
                        if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                        const x = paddingLeft + (i - viewStart) * step + step / 2;
                        const y = rsiToY(v);
                        const isStart = i === Math.ceil(viewStart) || rsiVals[i - 1] == null || i - 1 < viewStart;
                        return `${isStart ? "M" : "L"}${x} ${y}`;
                      })
                      .filter(Boolean)
                      .join(" ")}
                    fill="none"
                    stroke="#22c55e"
                    strokeWidth={1.5}
                  />
                  <text x={paddingLeft + 6} y={top + 14} fontSize={11} opacity={0.75}>RSI {rsiPeriod}</text>
                </g>
              );
            }
            if (seg.kind === "MACD") {
              const top = seg.top;
              const h = seg.height;
              // y-scale around 0 for MACD using visible range
              let min = 0, max = 0;
              for (let i = 0; i < candles.length; i++) {
                const m = macdVals.macd[i];
                const s = macdVals.signal[i];
                const hi = macdVals.hist[i];
                if (m != null) { min = Math.min(min, m); max = Math.max(max, m); }
                if (s != null) { min = Math.min(min, s); max = Math.max(max, s); }
                if (hi != null) { min = Math.min(min, hi); max = Math.max(max, hi); }
              }
              const padM = (max - min) * 0.2 || 1;
              min -= padM; max += padM;
              const vToY = (v: number) => top + (1 - (v - min) / (max - min)) * (h - 20) + 10;
              const y0 = vToY(0);
              return (
                <g key={`macd-${segIdx}`}>
                  <rect x={paddingLeft} y={top} width={innerWidth} height={h} fill="none" stroke="currentColor" opacity={0.12} />
                  <line x1={paddingLeft} x2={paddingLeft + innerWidth} y1={y0} y2={y0} stroke="currentColor" opacity={0.2} />
                  {/* histogram */}
                  {macdVals.hist.map((v, i) => {
                    if (v == null) return null;
                    if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                    const x = paddingLeft + (i - viewStart) * step + step / 2 - barW / 2;
                    const y = vToY(v);
                    const yBase = vToY(0);
                    const hh = Math.max(1, Math.abs(yBase - y));
                    const up = v >= 0;
                    return (
                      <rect key={`hist-${i}`} x={x} y={Math.min(y, yBase)} width={barW} height={hh} fill={up ? "#16a34a" : "#dc2626"} opacity={0.7} />
                    );
                  })}
                  {/* macd/ signal lines */}
                  <path
                    d={macdVals.macd
                      .map((v, i) => {
                        if (v == null) return null;
                        if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                        const x = paddingLeft + (i - viewStart) * step + step / 2;
                        const y = vToY(v);
                        const isStart = i === Math.ceil(viewStart) || macdVals.macd[i - 1] == null || i - 1 < viewStart;
                        return `${isStart ? "M" : "L"}${x} ${y}`;
                      })
                      .filter(Boolean)
                      .join(" ")}
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth={1.5}
                  />
                  <path
                    d={macdVals.signal
                      .map((v, i) => {
                        if (v == null) return null;
                        if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                        const x = paddingLeft + (i - viewStart) * step + step / 2;
                        const y = vToY(v);
                        const isStart = i === Math.ceil(viewStart) || macdVals.signal[i - 1] == null || i - 1 < viewStart;
                        return `${isStart ? "M" : "L"}${x} ${y}`;
                      })
                      .filter(Boolean)
                      .join(" ")}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                  />
                  <text x={paddingLeft + 6} y={top + 14} fontSize={11} opacity={0.75}>MACD {macdFast},{macdSlow} Sig {macdSignal}</text>
                </g>
              );
            }
            return null;
          })}
        </svg>
      </div>

      {/* Selected candle numeric editor */}
      {selected != null && candles[selected] && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["open", "high", "low", "close"] as const).map((field) => (
            <label key={field} className="text-sm">
              <span className="block mb-1 font-medium uppercase">{field}</span>
              <input
                type="number"
                step={0.01}
                className="w-full rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
                value={(candles[selected] as any)[field]}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (timeframe === "1m") {
                    setBaseCandles((prev) => {
                      pushUndoSnapshot(prev);
                      const next = [...prev];
                      const baseIdx = selected; // 1:1 for 1m
                      const c = { ...next[baseIdx] };
                      if (field === "open") {
                        c.open = v;
                        if (baseIdx - 1 >= 0) {
                          const p = { ...next[baseIdx - 1] };
                          p.close = c.open;
                          p.high = Math.max(p.high, p.open, p.close);
                          p.low = Math.min(p.low, p.open, p.close);
                          next[baseIdx - 1] = p;
                        }
                      }
                      if (field === "high") c.high = Math.max(v, c.open, c.close);
                      if (field === "low") c.low = Math.min(v, c.open, c.close);
                      if (field === "close") {
                        c.close = v;
                        if (baseIdx + 1 < next.length) {
                          const n1 = { ...next[baseIdx + 1] };
                          n1.open = c.close;
                          n1.high = Math.max(n1.high, n1.open, n1.close);
                          n1.low = Math.min(n1.low, n1.open, n1.close);
                          next[baseIdx + 1] = n1;
                        }
                      }
                      c.low = Math.min(c.low, c.open, c.close, c.high);
                      c.high = Math.max(c.low, c.open, c.close, c.high);
                      next[baseIdx] = c;
                      return next;
                    });
                  } else {
                    setBaseCandles((prev) => {
                      pushUndoSnapshot(prev);
                      return applyEditToGroup(prev, selected, field, v);
                    });
                  }
                }}
              />
            </label>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs opacity-70">
        提示：点击任意K线后，会出现四个可拖拽的锚点：左侧“O”为开盘价、右侧“C”为收盘价，中间上下两个为最高/最低价。
        滚轮缩放（Alt+滚轮为纵向缩放，普通滚轮为横向缩放），直接拖动画布可平移（支持横向与纵向），点击“全屏”可全屏查看。
      </p>
    </div>
  );
}
