import React from "react";
import { OptimizationCell, OptimizationGridResult } from "../types/futures";
import { formatPct } from "../utils/format";

interface OptimizationHeatmapProps {
  result: OptimizationGridResult;
  currentX: number;
  currentY: number;
  onApplyParams: (xVal: number, yVal: number) => void;
}

export const OptimizationHeatmap: React.FC<OptimizationHeatmapProps> = ({
  result,
  currentX,
  currentY,
  onApplyParams,
}) => {
  const cellMap = new Map<string, OptimizationCell>();
  let minSharpe = Infinity;
  let maxSharpe = -Infinity;

  for (const c of result.cells) {
    cellMap.set(`${c.paramX}_${c.paramY}`, c);
    if (c.sharpeRatio < minSharpe) minSharpe = c.sharpeRatio;
    if (c.sharpeRatio > maxSharpe) maxSharpe = c.sharpeRatio;
  }

  const getCellBg = (sharpe: number) => {
    const span = Math.max(maxSharpe - minSharpe, 0.01);
    const norm = Math.max(0, Math.min(1, (sharpe - minSharpe) / span));
    if (sharpe < 0) {
      return `rgba(16, 185, 129, ${0.15 + (1 - norm) * 0.25})`;
    }
    return `rgba(244, 63, 94, ${0.15 + norm * 0.58})`;
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            二维参数网格寻优热力图 (目标函数: 夏普比率 Sharpe)
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            点击任意参数网格单元即可一键将该参数组合载入回测引擎验证稳健性（避免孤岛过拟合）
          </p>
        </div>

        {result.bestCell && (
          <button
            type="button"
            onClick={() => onApplyParams(result.bestCell!.paramX, result.bestCell!.paramY)}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition shadow-sm"
          >
            一键应用最优参数 ({result.paramXKey}={result.bestCell.paramX}, {result.paramYKey}=
            {result.bestCell.paramY} | Sharpe {result.bestCell.sharpeRatio.toFixed(2)})
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs font-mono">
          <thead>
            <tr>
              <th className="p-2 text-left text-slate-400 border border-slate-800 bg-slate-950/60">
                {result.paramYLabel} \ {result.paramXLabel}
              </th>
              {result.paramXValues.map((x) => (
                <th
                  key={x}
                  className="p-2 text-center text-slate-300 border border-slate-800 bg-slate-950/60"
                >
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.paramYValues.map((y) => (
              <tr key={y}>
                <td className="p-2 font-semibold text-slate-300 border border-slate-800 bg-slate-950/60">
                  {y}
                </td>
                {result.paramXValues.map((x) => {
                  const cell = cellMap.get(`${x}_${y}`);
                  if (!cell) {
                    return (
                      <td
                        key={x}
                        className="p-2 text-center text-slate-600 border border-slate-800 bg-slate-950/40"
                      >
                        无效区间
                      </td>
                    );
                  }
                  const isSelected = x === currentX && y === currentY;
                  const isBest =
                    result.bestCell &&
                    x === result.bestCell.paramX &&
                    y === result.bestCell.paramY;

                  return (
                    <td
                      key={x}
                      onClick={() => onApplyParams(x, y)}
                      style={{ backgroundColor: getCellBg(cell.sharpeRatio) }}
                      className={`p-2 text-center border cursor-pointer transition hover:brightness-125 ${
                        isSelected
                          ? "border-indigo-400 ring-2 ring-indigo-500/60"
                          : "border-slate-800"
                      }`}
                    >
                      <div className="font-bold text-slate-100 flex items-center justify-center gap-1">
                        <span>{cell.sharpeRatio.toFixed(2)}</span>
                        {isBest && (
                          <span className="px-1 py-0.2 text-[9px] rounded bg-amber-500/90 text-slate-950 font-sans font-bold">
                            最优
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-300 mt-0.5">
                        {formatPct(cell.totalReturnPct, 1)} | {cell.totalTrades}笔
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
