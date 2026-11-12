import React, { useMemo, useState } from "react";
import { Candle, FuturesContract, SignalEvent } from "../types/futures";
import { formatPrice } from "../utils/format";

interface CandlestickChartProps {
  candles: Candle[];
  contract: FuturesContract;
  indicators: Record<string, (number | null)[]>;
  signals: SignalEvent[];
  visibleBars?: number;
}

const INDICATOR_COLORS = ["#fbbf24", "#38bdf8", "#c084fc", "#34d399"];

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  candles,
  contract,
  indicators,
  signals,
  visibleBars = 120,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [panOffset, setPanOffset] = useState<number>(0);

  const total = candles.length;
  const count = Math.min(visibleBars, total);
  const endIdx = Math.max(count, total - panOffset);
  const startIdx = Math.max(0, endIdx - count);

  const slice = useMemo(() => candles.slice(startIdx, endIdx), [candles, startIdx, endIdx]);

  const indicatorEntries = useMemo(() => {
    return Object.entries(indicators).map(([name, series], idx) => ({
      name,
      color: INDICATOR_COLORS[idx % INDICATOR_COLORS.length],
      values: series.slice(startIdx, endIdx),
    }));
  }, [indicators, startIdx, endIdx]);

  const signalByRelIdx = useMemo(() => {
    const map = new Map<number, SignalEvent>();
    for (const sig of signals) {
      if (sig.index >= startIdx && sig.index < endIdx) {
        map.set(sig.index - startIdx, sig);
      }
    }
    return map;
  }, [signals, startIdx, endIdx]);

  const { minPrice, maxPrice, maxVol } = useMemo(() => {
    let minP = Infinity;
    let maxP = -Infinity;
    let maxV = 1;
    for (let i = 0; i < slice.length; i++) {
      if (slice[i].low < minP) minP = slice[i].low;
      if (slice[i].high > maxP) maxP = slice[i].high;
      if (slice[i].volume > maxV) maxV = slice[i].volume;
      for (const ind of indicatorEntries) {
        const v = ind.values[i];
        if (v !== null && v !== undefined) {
          if (v < minP) minP = v;
          if (v > maxP) maxP = v;
        }
      }
    }
    if (!Number.isFinite(minP) || !Number.isFinite(maxP)) {
      minP = 0;
      maxP = 100;
    }
    const pad = Math.max((maxP - minP) * 0.07, contract.tickSize * 4);
    return { minPrice: minP - pad, maxPrice: maxP + pad, maxVol: maxV };
  }, [slice, indicatorEntries, contract.tickSize]);

  const width = 960;
  const height = 400;
  const padLeft = 14;
  const padRight = 68;
  const padTop = 18;
  const priceHeight = 272;
  const volTop = padTop + priceHeight + 18;
  const volHeight = 64;
  const plotWidth = width - padLeft - padRight;

  const xFor = (i: number) =>
    padLeft + (slice.length > 1 ? (i / (slice.length - 1)) * plotWidth : plotWidth / 2);
  const yForPrice = (p: number) =>
    padTop + priceHeight - ((p - minPrice) / Math.max(maxPrice - minPrice, 1e-6)) * priceHeight;
  const yForVol = (v: number) => volTop + volHeight - (v / maxVol) * volHeight;

  const candleWidth = Math.max(2.5, Math.min(9, (plotWidth / Math.max(slice.length, 1)) * 0.68));

  const activeRelIdx = hoverIdx !== null && hoverIdx < slice.length ? hoverIdx : slice.length - 1;
  const activeCandle = slice[activeRelIdx];
  const activeSignal = signalByRelIdx.get(activeRelIdx);

  const gridTicks = useMemo(() => {
    const steps = 5;
    const arr: number[] = [];
    for (let i = 0; i <= steps; i++) {
      arr.push(minPrice + ((maxPrice - minPrice) * i) / steps);
    }
    return arr;
  }, [minPrice, maxPrice]);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      {/* Header & OHLCV Inspector */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-100 text-sm">
            {contract.name} ({contract.symbol})
          </span>
          {activeCandle && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
              <span className="text-slate-400">{activeCandle.timeStr}</span>
              <span>
                开 <b className="text-slate-200">{formatPrice(activeCandle.open, contract.tickSize)}</b>
              </span>
              <span>
                高 <b className="text-rose-400">{formatPrice(activeCandle.high, contract.tickSize)}</b>
              </span>
              <span>
                低 <b className="text-emerald-400">{formatPrice(activeCandle.low, contract.tickSize)}</b>
              </span>
              <span>
                收{" "}
                <b
                  className={
                    activeCandle.close >= activeCandle.open ? "text-rose-400" : "text-emerald-400"
                  }
                >
                  {formatPrice(activeCandle.close, contract.tickSize)}
                </b>
              </span>
              <span className="text-slate-400">
                量 <b className="text-slate-200">{activeCandle.volume.toLocaleString()}</b>
              </span>
              <span className="text-slate-400">
                持仓 <b className="text-slate-200">{activeCandle.openInterest.toLocaleString()}</b>
              </span>
            </div>
          )}
        </div>

        {/* Window pan controls */}
        <div className="flex items-center gap-1.5">
          {indicatorEntries.map((ind) => {
            const val = ind.values[activeRelIdx];
            return (
              <span
                key={ind.name}
                className="px-2 py-0.5 rounded bg-slate-800/80 font-mono text-[11px]"
                style={{ color: ind.color }}
              >
                {ind.name}: {val !== null && val !== undefined ? formatPrice(val, contract.tickSize) : "--"}
              </span>
            );
          })}
          <div className="flex items-center gap-1 ml-2">
            <button
              type="button"
              onClick={() => setPanOffset((p) => Math.min(Math.max(0, total - count), p + 30))}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
              title="向历史回溯"
            >
              ◀ 早期
            </button>
            <button
              type="button"
              onClick={() => setPanOffset((p) => Math.max(0, p - 30))}
              disabled={panOffset === 0}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-xs transition"
              title="向最新推进"
            >
              最新 ▶
            </button>
          </div>
        </div>
      </div>

      {/* Signal Callout Banner */}
      {activeSignal && (
        <div className="px-3 py-1.5 rounded-lg bg-indigo-950/70 border border-indigo-500/40 text-xs flex items-center justify-between">
          <span className="text-indigo-200">
            策略信号触发 [{activeSignal.timeStr}]：
            <strong className="ml-1 text-white">{activeSignal.reason}</strong>
          </span>
          <span className="font-mono text-indigo-300">
            成交价 {formatPrice(activeSignal.price, contract.tickSize)}
          </span>
        </div>
      )}

      {/* SVG Canvas */}
      <div className="relative w-full overflow-hidden select-none">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto block"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width - padLeft;
            const idx = Math.round((relX / plotWidth) * (slice.length - 1));
            if (idx >= 0 && idx < slice.length) {
              setHoverIdx(idx);
            }
          }}
        >
          {/* Horizontal Price Grid */}
          {gridTicks.map((tick, idx) => {
            const y = yForPrice(tick);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                />
                <text
                  x={width - padRight + 6}
                  y={y + 4}
                  fill="#94a3b8"
                  fontSize="10.5"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {formatPrice(tick, contract.tickSize)}
                </text>
              </g>
            );
          })}

          {/* Separator between Price and Volume */}
          <line
            x1={padLeft}
            y1={volTop - 8}
            x2={width - padRight}
            y2={volTop - 8}
            stroke="#334155"
            strokeWidth={1}
          />

          {/* Candlesticks & Volume Bars (Chinese Futures Convention: Red = Up, Green = Down) */}
          {slice.map((c, i) => {
            const x = xFor(i);
            const isUp = c.close >= c.open;
            const color = isUp ? "#f43f5e" : "#10b981";
            const yHigh = yForPrice(c.high);
            const yLow = yForPrice(c.low);
            const yOpen = yForPrice(c.open);
            const yClose = yForPrice(c.close);
            const bodyTop = Math.min(yOpen, yClose);
            const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));

            const vY = yForVol(c.volume);
            const vH = Math.max(1, volTop + volHeight - vY);

            return (
              <g key={c.timestamp}>
                <line x1={x} y1={yHigh} x2={x} y2={yLow} stroke={color} strokeWidth={1.15} />
                <rect
                  x={x - candleWidth / 2}
                  y={bodyTop}
                  width={candleWidth}
                  height={bodyH}
                  fill={isUp ? "#f43f5e" : "#10b981"}
                  fillOpacity={isUp ? 0.85 : 0.9}
                  stroke={color}
                  strokeWidth={0.6}
                />
                <rect
                  x={x - candleWidth / 2}
                  y={vY}
                  width={candleWidth}
                  height={vH}
                  fill={color}
                  fillOpacity={0.42}
                />
              </g>
            );
          })}

          {/* Indicator Lines */}
          {indicatorEntries.map((ind) => {
            const pts: string[] = [];
            ind.values.forEach((v, i) => {
              if (v !== null && v !== undefined) {
                pts.push(`${pts.length === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yForPrice(v).toFixed(1)}`);
              }
            });
            if (pts.length < 2) return null;
            return (
              <path
                key={ind.name}
                d={pts.join(" ")}
                fill="none"
                stroke={ind.color}
                strokeWidth={1.5}
                strokeOpacity={0.92}
              />
            );
          })}

          {/* Buy / Sell Strategy Signal Markers */}
          {Array.from(signalByRelIdx.entries()).map(([relIdx, sig]) => {
            const x = xFor(relIdx);
            const bar = slice[relIdx];
            if (!bar) return null;
            const isBuy =
              sig.action === "OPEN_LONG" ||
              sig.action === "REVERSE_TO_LONG" ||
              sig.action === "CLOSE_SHORT";
            const y = isBuy ? yForPrice(bar.low) + 13 : yForPrice(bar.high) - 13;
            const badgeColor =
              sig.action === "CLOSE_LONG" || sig.action === "CLOSE_SHORT"
                ? "#94a3b8"
                : isBuy
                  ? "#fb7185"
                  : "#34d399";
            const label =
              sig.action === "OPEN_LONG"
                ? "多"
                : sig.action === "REVERSE_TO_LONG"
                  ? "反多"
                  : sig.action === "OPEN_SHORT"
                    ? "空"
                    : sig.action === "REVERSE_TO_SHORT"
                      ? "反空"
                      : "平";

            return (
              <g key={`${sig.index}-${sig.action}`}>
                <circle cx={x} cy={y} r={7.5} fill={badgeColor} fillOpacity={0.22} stroke={badgeColor} />
                <text
                  x={x}
                  y={y + 3.2}
                  textAnchor="middle"
                  fill="#f8fafc"
                  fontSize="8.5"
                  fontWeight="bold"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* Crosshair */}
          {hoverIdx !== null && slice[hoverIdx] && (
            <g>
              <line
                x1={xFor(hoverIdx)}
                y1={padTop}
                x2={xFor(hoverIdx)}
                y2={volTop + volHeight}
                stroke="#6366f1"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <line
                x1={padLeft}
                y1={yForPrice(slice[hoverIdx].close)}
                x2={width - padRight}
                y2={yForPrice(slice[hoverIdx].close)}
                stroke="#6366f1"
                strokeDasharray="3 3"
                strokeWidth={0.8}
              />
            </g>
          )}

          {/* X-axis Date Labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const idx = Math.min(slice.length - 1, Math.floor(ratio * (slice.length - 1)));
            const c = slice[idx];
            if (!c) return null;
            return (
              <text
                key={ratio}
                x={xFor(idx)}
                y={height - 4}
                textAnchor="middle"
                fill="#64748b"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {c.timeStr}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
