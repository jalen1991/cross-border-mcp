import React from "react";
import { StrategyId, StrategyScore } from "../types/futures";
import { formatPct } from "../utils/format";

interface StrategyLeaderboardProps {
  scores: StrategyScore[];
  activeStrategyId: StrategyId;
  onSelect: (strategyId: StrategyId) => void;
}

export const StrategyLeaderboard: React.FC<StrategyLeaderboardProps> = ({
  scores,
  activeStrategyId,
  onSelect,
}) => {
  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">六策略同台横评</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            同一合约、同一段 K 线和同一套资金参数，各自使用默认参数。排序依据是样本外夏普。
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="text-slate-400 border-b border-slate-800">
              <th className="py-2 pr-2">排名</th>
              <th className="py-2 px-2">策略</th>
              <th className="py-2 px-2 text-right">样本外夏普</th>
              <th className="py-2 px-2 text-right">样本外收益</th>
              <th className="py-2 px-2 text-right">全样本收益</th>
              <th className="py-2 px-2 text-right">最大回撤</th>
              <th className="py-2 px-2 text-right">样本外笔数</th>
              <th className="py-2 pl-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70 font-mono">
            {scores.map((score, index) => {
              const active = score.strategyId === activeStrategyId;
              return (
                <tr key={score.strategyId} className={active ? "bg-indigo-950/40" : "hover:bg-slate-800/40"}>
                  <td className="py-2.5 pr-2 text-slate-400">{index + 1}</td>
                  <td className="py-2.5 px-2 font-sans">
                    <div className="text-slate-100 font-medium">{score.name}</div>
                    <div className="text-[11px] text-slate-500">{score.category}</div>
                  </td>
                  <td className={`py-2.5 px-2 text-right font-semibold ${score.outOfSampleTrades < 2 ? "text-slate-500" : score.outOfSampleSharpe >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    {score.outOfSampleTrades < 2 ? "样本不足" : score.outOfSampleSharpe.toFixed(2)}
                  </td>
                  <td className={`py-2.5 px-2 text-right ${score.outOfSampleReturnPct >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                    {formatPct(score.outOfSampleReturnPct, 1)}
                  </td>
                  <td className="py-2.5 px-2 text-right text-slate-300">{formatPct(score.totalReturnPct, 1)}</td>
                  <td className="py-2.5 px-2 text-right text-amber-400">-{score.maxDrawdownPct.toFixed(1)}%</td>
                  <td className="py-2.5 px-2 text-right text-slate-300">
                    {score.outOfSampleTrades}/{score.totalTrades}
                  </td>
                  <td className="py-2.5 pl-2 text-right font-sans">
                    <button
                      type="button"
                      onClick={() => onSelect(score.strategyId)}
                      className={`px-2.5 py-1 rounded text-xs transition ${
                        active
                          ? "bg-indigo-600 text-white"
                          : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                      }`}
                    >
                      {active ? "当前策略" : "载入回测"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
