"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Candle = {
  time: number; // simple index-based time
  open: number;
  high: number;
  low: number;
  close: number;
};

type MACD = {
  macd: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
};

// ---------------------------
// Indicator calculations
// ---------------------------
function sma(values: number[], period: number): Array<number | null> {
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

function ema(values: number[], period: number): Array<number | null> {
  const res: Array<number | null> = Array(values.length).fill(null);
  if (period <= 0) return res;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev == null) {
      if (i >= period - 1) {
        // seed with SMA for first definable value
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

function rsi(values: number[], period: number): Array<number | null> {
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
    } else {
      // Wilder's smoothing
      const prev = res[i - 1];
      // compute previous average gain/loss indirectly
      // we track using a rolling update; we need to keep state, so recompute from previous averages
      // Instead, maintain running avgs
    }
  }
  // To avoid complexity above, compute with a pass that keeps running averages after seed
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

function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MACD {
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

// ---------------------------
// Utils
// ---------------------------
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function toFixed2(n: number) {
  return Math.round(n * 100) / 100;
}

// Seedable PRNG (deterministic for SSR hydration safety)
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function genRandomWalkBars(n = 60, start = 100, rng: () => number = Math.random): Candle[] {
  const res: Candle[] = [];
  let last = start;
  for (let i = 0; i < n; i++) {
    const drift = (rng() - 0.5) * 1.6; // small drift
    const open = last;
    let close = open + drift + (rng() - 0.5) * 1.2;
    close = toFixed2(close);
    const high = toFixed2(Math.max(open, close) + rng() * 1.5 + 0.2);
    const low = toFixed2(Math.min(open, close) - rng() * 1.5 - 0.2);
    res.push({ time: i, open: toFixed2(open), high, low, close });
    last = close;
  }
  return res;
}

// ---------------------------
// Main component
// ---------------------------
export default function IndicatorPlayground() {
  // Use a fixed-seed RNG for initial data to avoid SSR/client mismatch
  const [candles, setCandles] = useState<Candle[]>(() => genRandomWalkBars(80, 100, mulberry32(1)));
  const [selected, setSelected] = useState<number | null>(null);

  // Indicator settings
  const [showSMA, setShowSMA] = useState(true);
  const [showEMA, setShowEMA] = useState(false);
  const [smaPeriod, setSmaPeriod] = useState(20);
  const [emaPeriod, setEmaPeriod] = useState(20);

  const [showRSI, setShowRSI] = useState(true);
  const [rsiPeriod, setRsiPeriod] = useState(14);

  const [showMACD, setShowMACD] = useState(true);
  const [macdFast, setMacdFast] = useState(12);
  const [macdSlow, setMacdSlow] = useState(26);
  const [macdSignal, setMacdSignal] = useState(9);

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

  // Keep viewport within bounds when data length changes
  useEffect(() => {
    setViewCount((v) => Math.min(v, Math.max(1, candles.length)));
    setViewStart((s) => clamp(s, 0, Math.max(0, candles.length - Math.min(viewCount, candles.length))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles.length]);

  const closeValues = useMemo(() => candles.map((c) => c.close), [candles]);
  const smaVals = useMemo(() => sma(closeValues, smaPeriod), [closeValues, smaPeriod]);
  const emaVals = useMemo(() => ema(closeValues, emaPeriod), [closeValues, emaPeriod]);
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

  // Y scale for price: include indicators shown
  const priceMin = useMemo(() => {
    let min = Number.POSITIVE_INFINITY;
    for (const c of candles) min = Math.min(min, c.low);
    if (showSMA) for (const v of smaVals) if (v != null) min = Math.min(min, v);
    if (showEMA) for (const v of emaVals) if (v != null) min = Math.min(min, v);
    return min;
  }, [candles, showSMA, showEMA, smaVals, emaVals]);
  const priceMax = useMemo(() => {
    let max = Number.NEGATIVE_INFINITY;
    for (const c of candles) max = Math.max(max, c.high);
    if (showSMA) for (const v of smaVals) if (v != null) max = Math.max(max, v);
    if (showEMA) for (const v of emaVals) if (v != null) max = Math.max(max, v);
    return max;
  }, [candles, showSMA, showEMA, smaVals, emaVals]);
  const pad = (priceMax - priceMin) * 0.08 || 1;
  const yMin = priceMin - pad;
  const yMax = priceMax + pad;
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

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { index, field } = dragRef.current;
      const svg = priceSvgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const newPrice = yToPrice(y);
      setCandles((prev) => {
        const next = [...prev];
        const c = { ...next[index] };
        if (field === "open") c.open = newPrice;
        if (field === "close") c.close = newPrice;
        if (field === "high") c.high = Math.max(newPrice, c.open, c.close);
        if (field === "low") c.low = Math.min(newPrice, c.open, c.close);
        // enforce invariants
        c.low = Math.min(c.low, c.open, c.close, c.high);
        c.high = Math.max(c.low, c.open, c.close, c.high);
        next[index] = c;
        return next;
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    if (dragRef.current) {
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [priceHeight, yMin, yMax]);

  const priceSvgRef = useRef<SVGSVGElement | null>(null);

  // Pan and zoom handlers
  const panRef = useRef<{ lastX: number; startX: number; active: boolean } | null>(null);

  const isHandleTarget = (el: EventTarget | null) => {
    return !!(el as Element | null)?.getAttribute?.("data-role") && (el as Element).getAttribute("data-role") === "handle";
  };

  const beginPan = (e: React.PointerEvent) => {
    // If starting on a drag handle, do not pan (let price handle drag instead)
    if (isHandleTarget(e.target)) return;
    // Record start; activate only after small threshold movement to preserve click-to-select
    panRef.current = { lastX: e.clientX, startX: e.clientX, active: false };
  };
  const onPanMove = (e: React.PointerEvent) => {
    const pr = panRef.current;
    if (!pr) return;
    const dxAbs = Math.abs(e.clientX - pr.startX);
    if (!pr.active && dxAbs > 3) {
      // Start panning and capture pointer once user moves
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      pr.active = true;
    }
    if (!pr.active) return;
    const dx = e.clientX - pr.lastX;
    pr.lastX = e.clientX;
    const deltaBars = dx / step;
    setViewStart((s) => clamp(s - deltaBars, 0, Math.max(0, candles.length - viewCount)));
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
      applyZoomAt(ev.clientX, ev.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel as EventListener);
  }, [applyZoomAt, innerWidth, paddingLeft, step, viewCount, viewStart, candles.length]);

  const handlePointerDown = (index: number, field: DragField) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { index, field };
    setSelected(index);
  };

  // Helpers to add/remove/reset data
  const addBar = () => {
    setCandles((prev) => {
      const last = prev[prev.length - 1] ?? ({ close: 100 } as Candle);
      const next = genRandomWalkBars(1, last.close, Math.random);
      const nextOne = { ...next[0], time: prev.length };
      const newArr = [...prev, nextOne];
      // Keep right edge pinned if we were at the end
      const atEnd = viewStart + viewCount >= prev.length - 0.01;
      if (atEnd) setViewStart(Math.max(0, newArr.length - viewCount));
      return newArr;
    });
  };
  const addBars = (count: number) => {
    if (count <= 0) return;
    setCandles((prev) => {
      const last = prev[prev.length - 1] ?? ({ close: 100 } as Candle);
      const gen = genRandomWalkBars(count, last.close, Math.random);
      const offset = prev.length;
      const appended = gen.map((c, i) => ({ ...c, time: offset + i }));
      const newArr = [...prev, ...appended];
      const atEnd = viewStart + viewCount >= prev.length - 0.01;
      if (atEnd) setViewStart(Math.max(0, newArr.length - viewCount));
      return newArr;
    });
  };
  const removeBar = () =>
    setCandles((prev) => {
      if (prev.length <= 1) return prev;
      const newArr = prev.slice(0, -1);
      const atEnd = viewStart + viewCount >= prev.length - 0.01;
      if (atEnd) setViewStart(Math.max(0, newArr.length - viewCount));
      return newArr;
    });
  const resetData = () => {
    const data = genRandomWalkBars(80, 100, mulberry32(1));
    setCandles(data);
    // After reset, show the most recent window
    setViewStart(Math.max(0, data.length - viewCount));
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
          <label className="text-sm font-medium">SMA</label>
          <div className="flex items-center gap-2">
            <input id="sma" type="checkbox" checked={showSMA} onChange={(e) => setShowSMA(e.target.checked)} />
            <input
              type="number"
              className="w-20 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              min={1}
              value={smaPeriod}
              onChange={(e) => setSmaPeriod(clamp(parseInt(e.target.value || "1"), 1, 999))}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">EMA</label>
          <div className="flex items-center gap-2">
            <input id="ema" type="checkbox" checked={showEMA} onChange={(e) => setShowEMA(e.target.checked)} />
            <input
              type="number"
              className="w-20 rounded border border-black/10 dark:border-white/20 bg-transparent px-2 py-1"
              min={1}
              value={emaPeriod}
              onChange={(e) => setEmaPeriod(clamp(parseInt(e.target.value || "1"), 1, 999))}
            />
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
        <div className="flex gap-2">
          <button className="h-9 px-3 rounded bg-foreground text-background" onClick={addBar}>Add Bar</button>
          <button className="h-9 px-3 rounded bg-foreground/80 text-background" onClick={() => addBars(20)}>Add x20</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={removeBar}>Remove Bar</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={resetData}>Reset</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={zoomIn}>Zoom In</button>
          <button className="h-9 px-3 rounded border border-black/10 dark:border-white/20" onClick={zoomOut}>Zoom Out</button>
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
            <line key={`grid-${i}`} x1={paddingLeft} x2={paddingLeft + innerWidth} y1={y} y2={y} stroke="currentColor" opacity={0.1} />
          ))}

          {/* Price axis labels */}
          {gridYs.map((y, i) => {
            const val = yToPrice(y);
            return (
              <text key={`label-${i}`} x={6} y={y + 4} fontSize={11} opacity={0.7}>
                {val.toFixed(2)}
              </text>
            );
          })}

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

          {/* Overlays: SMA/EMA */}
          {showSMA && (
            <path
              d={smaVals
                .map((v, i) => {
                  if (v == null) return null;
                  if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                  const x = paddingLeft + (i - viewStart) * step + step / 2;
                  const y = priceToY(v);
                  const isStart = i === Math.ceil(viewStart) || smaVals[i - 1] == null || i - 1 < viewStart;
                  return `${isStart ? "M" : "L"}${x} ${y}`;
                })
                .filter(Boolean)
                .join(" ")}
              fill="none"
              stroke="#eab308"
              strokeWidth={1.5}
            />
          )}
          {showEMA && (
            <path
              d={emaVals
                .map((v, i) => {
                  if (v == null) return null;
                  if (i < Math.floor(viewStart) || i >= Math.ceil(viewStart + viewCount)) return null;
                  const x = paddingLeft + (i - viewStart) * step + step / 2;
                  const y = priceToY(v);
                  const isStart = i === Math.ceil(viewStart) || emaVals[i - 1] == null || i - 1 < viewStart;
                  return `${isStart ? "M" : "L"}${x} ${y}`;
                })
                .filter(Boolean)
                .join(" ")}
              fill="none"
              stroke="#a855f7"
              strokeWidth={1.5}
            />
          )}

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
                  setCandles((prev) => {
                    const next = [...prev];
                    const c = { ...next[selected] };
                    if (field === "open") c.open = v;
                    if (field === "high") c.high = Math.max(v, c.open, c.close);
                    if (field === "low") c.low = Math.min(v, c.open, c.close);
                    if (field === "close") c.close = v;
                    c.low = Math.min(c.low, c.open, c.close, c.high);
                    c.high = Math.max(c.low, c.open, c.close, c.high);
                    next[selected] = c;
                    return next;
                  });
                }}
              />
            </label>
          ))}
        </div>
      )}

      <p className="mt-2 text-xs opacity-70">
        提示：点击任意K线后，会出现四个可拖拽的锚点：左侧“O”为开盘价、右侧“C”为收盘价，中间上下两个为最高/最低价。
        拖拽或右侧输入框修改后，上方SMA/EMA与下方RSI/MACD会实时更新。滚轮缩放，按住 Shift 并拖动进行平移，点击“全屏”可全屏查看。
      </p>
    </div>
  );
}
