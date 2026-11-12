import React, { useMemo, useState } from "react";
import { EquityPoint } from "../types/futures";
import { formatCurrency, formatPct } from "../utils/format";

interface EquityDrawdownChartProps {
  equityCurve: EquityPoint[];
  initialCapital: number;
}

export const EquityDrawdownChart: React.FC<EquityDrawdownChartProps> = ({
  equityCurve,
  initialCapital,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 960;
  const height = 300;
  const padLeft = 14;
  const padRight = 76;
  const padTop = 16;
  const eqHeight = 165;
  const ddTop = padTop + eqHeight + 22;
  const ddHeight = 68;
  const plotWidth = width - padLeft - padRight;

  const { minEq, maxEq, minDd } = useMemo(() => {
    let minE = initialCapital;
    let maxE = initialCapital;
    let minD = -1;
    for (const pt of equityCurve) {
      if (pt.equity < minE) minE = pt.equity;
      if (pt.equity > maxE) maxE = pt.equity;
      if (pt.drawdownPct < minD) minD = pt.drawdownPct;
    }
    const pad = Math.max((maxE - minE) * 0.08, initialCapital * 0.01);
    return { minEq: minE - pad, maxEq: maxE + pad, minDd: Math.min(minD * 1.15, -2) };
  }, [equityCurve, initialCapital]);

  const xFor = (i: number) =>
    padLeft +
    (equityCurve.length > 1 ? (i / (equityCurve.length - 1)) * plotWidth : plotWidth / 2);
  const yForEq = (eq: number) =>
    padTop + eqHeight - ((eq - minEq) / Math.max(maxEq - minEq, 1)) * eqHeight;
  const yForDd = (dd: number) =>
    ddTop + ((0 - dd) / Math.max(0 - minDd, 0.1)) * ddHeight;

  const eqPath = useMemo(() => {
    return equityCurve
      .map((pt, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yForEq(pt.equity).toFixed(1)}`)
      .join(" ");
  }, [equityCurve, minEq, maxEq]);

  const eqArea = useMemo(() => {
    if (equityCurve.length < 2) return "";
    return `${eqPath} L${xFor(equityCurve.length - 1).toFixed(1)},${(padTop + eqHeight).toFixed(
      1
    )} L${xFor(0).toFixed(1)},${(padTop + eqHeight).toFixed(1)} Z`;
  }, [eqPath, equityCurve.length]);

  const ddArea = useMemo(() => {
    if (equityCurve.length < 2) return "";
    const line = equityCurve
      .map((pt, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yForDd(pt.drawdownPct).toFixed(1)}`)
      .join(" ");
    return `${line} L${xFor(equityCurve.length - 1).toFixed(1)},${ddTop} L${xFor(0).toFixed(
      1
    )},${ddTop} Z`;
  }, [equityCurve, minDd]);

  const activeIdx =
    hoverIdx !== null && hoverIdx < equityCurve.length ? hoverIdx : equityCurve.length - 1;
  const activePt = equityCurve[activeIdx];

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100 text-sm">账户资金净值与动态回撤曲线</span>
          <span className="text-slate-400">基准初始资金 {formatCurrency(initialCapital)}</span>
        </div>
        {activePt && (
          <div className="flex flex-wrap items-center gap-4 font-mono">
            <span className="text-slate-400">{activePt.timeStr}</span>
            <span>
              动态权益:{" "}
              <b className={activePt.equity >= initialCapital ? "text-rose-400" : "text-emerald-400"}>
                {formatCurrency(activePt.equity)}
              </b>
            </span>
            <span>
              回撤: <b className="text-amber-400">{formatPct(activePt.drawdownPct, 2)}</b>
            </span>
            <span>
              保证金占用: <b className="text-sky-400">{formatCurrency(activePt.marginUsed)}</b>
            </span>
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block select-none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width - padLeft;
          const idx = Math.round((relX / plotWidth) * (equityCurve.length - 1));
          if (idx >= 0 && idx < equityCurve.length) setHoverIdx(idx);
        }}
      >
        <defs>
          <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.45" />
          </linearGradient>
        </defs>

        {/* Initial Capital Baseline */}
        <line
          x1={padLeft}
          y1={yForEq(initialCapital)}
          x2={width - padRight}
          y2={yForEq(initialCapital)}
          stroke="#475569"
          strokeDasharray="4 4"
        />

        {[0, 0.5, 1].map((r) => {
          const val = minEq + (maxEq - minEq) * r;
          const y = yForEq(val);
          return (
            <g key={r}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#1e293b" />
              <text
                x={width - padRight + 6}
                y={y + 4}
                fill="#94a3b8"
                fontSize="10"
                fontFamily="JetBrains Mono, monospace"
              >
                {formatCurrency(val)}
              </text>
            </g>
          );
        })}

        {/* Equity Area & Line */}
        {eqArea && <path d={eqArea} fill="url(#eqGrad)" />}
        {eqPath && <path d={eqPath} fill="none" stroke="#818cf8" strokeWidth={2} />}

        {/* Drawdown Panel */}
        <line x1={padLeft} y1={ddTop} x2={width - padRight} y2={ddTop} stroke="#334155" />
        {ddArea && <path d={ddArea} fill="url(#ddGrad)" stroke="#f59e0b" strokeWidth={1.2} />}
        <text
          x={width - padRight + 6}
          y={ddTop + 10}
          fill="#94a3b8"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          0.0%
        </text>
        <text
          x={width - padRight + 6}
          y={ddTop + ddHeight}
          fill="#fbbf24"
          fontSize="10"
          fontFamily="JetBrains Mono, monospace"
        >
          {minDd.toFixed(1)}%
        </text>

        {/* Crosshair */}
        {hoverIdx !== null && equityCurve[hoverIdx] && (
          <g>
            <line
              x1={xFor(hoverIdx)}
              y1={padTop}
              x2={xFor(hoverIdx)}
              y2={ddTop + ddHeight}
              stroke="#94a3b8"
              strokeDasharray="3 3"
            />
            <circle
              cx={xFor(hoverIdx)}
              cy={yForEq(equityCurve[hoverIdx].equity)}
              r={4}
              fill="#818cf8"
              stroke="#fff"
            />
          </g>
        )}
      </svg>
    </div>
  );
};
