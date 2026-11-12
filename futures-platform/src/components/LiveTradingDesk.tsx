import React, { useState } from "react";
import { FUTURES_CONTRACTS, getContractBySymbol } from "../data/contracts";
import { calcCommission, calcRequiredMargin } from "../engine/backtester";
import { AccountSummary } from "../engine/riskSimulator";
import { LiveOrder, LivePosition, PositionSide, RiskRuleConfig } from "../types/futures";
import { formatCurrency, formatPct, formatPrice, formatSignedCurrency } from "../utils/format";

interface LiveTradingDeskProps {
  quotes: Record<string, number>;
  summary: AccountSummary;
  positions: LivePosition[];
  orders: LiveOrder[];
  riskRules: RiskRuleConfig;
  autoBotEnabled: boolean;
  activeStrategyName: string;
  lastRejectReason: string | null;
  onToggleAutoBot: () => void;
  onStepMarketTick: () => void;
  onSubmitManualOrder: (symbol: string, side: PositionSide, lots: number) => void;
  onClosePosition: (posId: string) => void;
  onCloseAllPositions: () => void;
  onUpdateRiskRules: (next: RiskRuleConfig) => void;
}

export const LiveTradingDesk: React.FC<LiveTradingDeskProps> = ({
  quotes,
  summary,
  positions,
  orders,
  riskRules,
  autoBotEnabled,
  activeStrategyName,
  lastRejectReason,
  onToggleAutoBot,
  onStepMarketTick,
  onSubmitManualOrder,
  onClosePosition,
  onCloseAllPositions,
  onUpdateRiskRules,
}) => {
  const [orderSymbol, setOrderSymbol] = useState<string>("RB2610");
  const [orderLots, setOrderLots] = useState<number>(2);

  const selectedContract = getContractBySymbol(orderSymbol);
  const currentQuote = quotes[orderSymbol] ?? selectedContract.basePrice;
  const estMargin = calcRequiredMargin(selectedContract, currentQuote, orderLots);
  const estComm = calcCommission(selectedContract, currentQuote, orderLots);

  const riskBadgeClass =
    summary.riskDegreeLevel === "安全"
      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
      : summary.riskDegreeLevel === "预警"
        ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
        : "bg-rose-500/20 text-rose-300 border-rose-500/40";

  return (
    <div className="flex flex-col gap-5">
      {/* Top Account Capital & Margin Risk Bar */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
          <div className="text-xs text-slate-400">动态权益 (Dynamic Equity)</div>
          <div className="text-lg font-bold font-mono text-slate-100 mt-1">
            {formatCurrency(summary.dynamicEquity)}
          </div>
          <div
            className={`text-xs font-mono mt-0.5 ${
              summary.dailyPnlPct >= 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            当日 {formatPct(summary.dailyPnlPct)}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
          <div className="text-xs text-slate-400">浮动盈亏 (Unrealized PnL)</div>
          <div
            className={`text-lg font-bold font-mono mt-1 ${
              summary.unrealizedPnl >= 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {formatSignedCurrency(summary.unrealizedPnl)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">逐笔盯市实时结算</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
          <div className="text-xs text-slate-400">平仓已实现盈亏</div>
          <div
            className={`text-lg font-bold font-mono mt-1 ${
              summary.realizedPnl >= 0 ? "text-rose-400" : "text-emerald-400"
            }`}
          >
            {formatSignedCurrency(summary.realizedPnl)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">已扣除双边手续费</div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
          <div className="text-xs text-slate-400">占用保证金 (Margin Used)</div>
          <div className="text-lg font-bold font-mono text-sky-400 mt-1">
            {formatCurrency(summary.marginUsed)}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            可用资金 {formatCurrency(summary.availableFunds)}
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
          <div className="text-xs text-slate-400">风险度 (保证金占用率)</div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-lg font-bold font-mono text-slate-100">
              {summary.marginUtilizationPct.toFixed(1)}%
            </span>
            <span className={`px-2 py-0.5 text-[11px] rounded border ${riskBadgeClass}`}>
              {summary.riskDegreeLevel}
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-2">
            <div
              className={`h-full transition-all ${
                summary.marginUtilizationPct > riskRules.maxMarginUtilizationPct
                  ? "bg-rose-500"
                  : summary.marginUtilizationPct > 40
                    ? "bg-amber-400"
                    : "bg-indigo-500"
              }`}
              style={{ width: `${Math.min(100, summary.marginUtilizationPct)}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
          <div className="text-xs text-slate-400">策略量化托管引擎</div>
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={onToggleAutoBot}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition ${
                autoBotEnabled
                  ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200"
              }`}
            >
              {autoBotEnabled ? "● 自动跟单运行中" : "○ 启动自动跟单"}
            </button>
            <button
              type="button"
              onClick={onStepMarketTick}
              className="py-1.5 px-2.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white text-xs font-medium transition"
              title="立即推进一拍Tick行情"
            >
              推进Tick
            </button>
          </div>
          <div className="text-[11px] text-slate-500 truncate mt-1">
            绑定: {activeStrategyName}
          </div>
        </div>
      </div>

      {lastRejectReason && (
        <div className="px-4 py-2.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-xs text-rose-200 flex items-center justify-between">
          <span>事前风控拦截提示：{lastRejectReason}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Manual Order Ticket + Pre-trade Risk Controls */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">模拟柜台闪电报单 (CTP仿真)</h3>
              <span className="text-[11px] font-mono text-indigo-400">市价对手价撮合</span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="text-slate-400 block mb-1">交易合约</label>
                <select
                  value={orderSymbol}
                  onChange={(e) => setOrderSymbol(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  {FUTURES_CONTRACTS.map((c) => (
                    <option key={c.symbol} value={c.symbol}>
                      {c.symbol} - {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-slate-400 block mb-1">报单手数 (Lots)</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={orderLots}
                  onChange={(e) => setOrderLots(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="rounded-lg bg-slate-950/70 border border-slate-800/80 p-3 text-xs space-y-1.5 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">最新对手价:</span>
                <span className="text-slate-100 font-semibold">
                  {formatPrice(currentQuote, selectedContract.tickSize)} {selectedContract.unit}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">合约乘数 / 保证金率:</span>
                <span className="text-slate-300">
                  {selectedContract.multiplier} / {(selectedContract.marginRate * 100).toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">预计占用保证金:</span>
                <span className="text-sky-400">{formatCurrency(estMargin)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">预计开仓手续费:</span>
                <span className="text-slate-300">{formatCurrency(estComm, 2)}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={() => onSubmitManualOrder(orderSymbol, "LONG", orderLots)}
                className="py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition shadow"
              >
                买入开多 (Buy Long)
              </button>
              <button
                type="button"
                onClick={() => onSubmitManualOrder(orderSymbol, "SHORT", orderLots)}
                className="py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow"
              >
                卖出开空 (Sell Short)
              </button>
            </div>
          </div>

          {/* Pre-trade & Intraday Risk Rules Engine */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">事前与盘中风控参数阀值</h3>
              <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={riskRules.circuitBreakerActive}
                  onChange={(e) =>
                    onUpdateRiskRules({
                      ...riskRules,
                      circuitBreakerActive: e.target.checked,
                    })
                  }
                  className="rounded accent-indigo-500"
                />
                启用亏损熔断
              </label>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-400">最大保证金占用上限</span>
                  <span className="font-mono text-slate-200">
                    {riskRules.maxMarginUtilizationPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={90}
                  step={5}
                  value={riskRules.maxMarginUtilizationPct}
                  onChange={(e) =>
                    onUpdateRiskRules({
                      ...riskRules,
                      maxMarginUtilizationPct: Number(e.target.value),
                    })
                  }
                  className="w-full accent-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-400">单笔最大报单手数上限</span>
                  <span className="font-mono text-slate-200">{riskRules.maxSingleOrderLots} 手</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={riskRules.maxSingleOrderLots}
                  onChange={(e) =>
                    onUpdateRiskRules({
                      ...riskRules,
                      maxSingleOrderLots: Number(e.target.value),
                    })
                  }
                  className="w-full accent-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-slate-400">单日最大亏损熔断线</span>
                  <span className="font-mono text-rose-400">-{riskRules.maxDailyLossPct}%</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={15}
                  step={0.5}
                  value={riskRules.maxDailyLossPct}
                  onChange={(e) =>
                    onUpdateRiskRules({
                      ...riskRules,
                      maxDailyLossPct: Number(e.target.value),
                    })
                  }
                  className="w-full accent-indigo-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Active Positions & Order Blotter */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-100">
                实时持仓监控 ({positions.length} 笔在途合约)
              </h3>
              {positions.length > 0 && (
                <button
                  type="button"
                  onClick={onCloseAllPositions}
                  className="px-3 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/40 text-rose-300 text-xs font-medium transition"
                >
                  一键全平紧急避险
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-3">合约</th>
                    <th className="py-2 px-2">方向</th>
                    <th className="py-2 px-2 text-right">手数</th>
                    <th className="py-2 px-2 text-right">开仓均价</th>
                    <th className="py-2 px-2 text-right">最新价</th>
                    <th className="py-2 px-2 text-right">占用保证金</th>
                    <th className="py-2 px-2 text-right">逐笔浮盈</th>
                    <th className="py-2 px-2">归属策略</th>
                    <th className="py-2 pl-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono">
                  {positions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 font-sans">
                        当前空仓观望中，可通过左侧闪电报单面板或开启自动跟单生成持仓
                      </td>
                    </tr>
                  ) : (
                    positions.map((pos) => {
                      const c = getContractBySymbol(pos.symbol);
                      return (
                        <tr key={pos.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 pr-3">
                            <div className="font-semibold text-slate-100">{pos.symbol}</div>
                            <div className="text-[11px] text-slate-400 font-sans">{pos.name}</div>
                          </td>
                          <td className="py-2.5 px-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[11px] font-sans font-semibold ${
                                pos.side === "LONG"
                                  ? "bg-rose-500/20 text-rose-300"
                                  : "bg-emerald-500/20 text-emerald-300"
                              }`}
                            >
                              {pos.side === "LONG" ? "多头 LONG" : "空头 SHORT"}
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-right text-slate-200">{pos.lots}</td>
                          <td className="py-2.5 px-2 text-right text-slate-300">
                            {formatPrice(pos.avgEntryPrice, c.tickSize)}
                          </td>
                          <td className="py-2.5 px-2 text-right text-slate-100 font-semibold">
                            {formatPrice(pos.lastPrice, c.tickSize)}
                          </td>
                          <td className="py-2.5 px-2 text-right text-sky-400">
                            {formatCurrency(pos.marginUsed)}
                          </td>
                          <td
                            className={`py-2.5 px-2 text-right font-semibold ${
                              pos.unrealizedPnl >= 0 ? "text-rose-400" : "text-emerald-400"
                            }`}
                          >
                            {formatSignedCurrency(pos.unrealizedPnl)} (
                            {formatPct(pos.returnOnMarginPct, 1)})
                          </td>
                          <td className="py-2.5 px-2 font-sans text-slate-400">{pos.strategyTag}</td>
                          <td className="py-2.5 pl-2 text-right">
                            <button
                              type="button"
                              onClick={() => onClosePosition(pos.id)}
                              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-sans text-xs transition"
                            >
                              市价平仓
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Order Execution Blotter */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-100 mb-3">当日委托与成交回报流水</h3>
            <div className="overflow-x-auto max-h-60 overflow-y-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="py-2 pr-2">委托编号</th>
                    <th className="py-2 px-2">时间</th>
                    <th className="py-2 px-2">合约</th>
                    <th className="py-2 px-2">开平方向</th>
                    <th className="py-2 px-2 text-right">手数</th>
                    <th className="py-2 px-2 text-right">成交价</th>
                    <th className="py-2 px-2">状态</th>
                    <th className="py-2 pl-2">来源 / 备注</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {orders.map((ord) => (
                    <tr key={ord.id} className="hover:bg-slate-800/30">
                      <td className="py-2 pr-2 text-slate-400">{ord.id}</td>
                      <td className="py-2 px-2 text-slate-300">{ord.time}</td>
                      <td className="py-2 px-2 text-slate-100 font-semibold">{ord.symbol}</td>
                      <td className="py-2 px-2 font-sans">
                        <span
                          className={
                            ord.side === "LONG" ? "text-rose-400" : "text-emerald-400"
                          }
                        >
                          {ord.side === "LONG" ? "买" : "卖"}
                          {ord.offset === "OPEN" ? "开仓" : "平仓"}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right text-slate-200">{ord.lots}</td>
                      <td className="py-2 px-2 text-right text-slate-200">{ord.price}</td>
                      <td className="py-2 px-2 font-sans">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            ord.status === "FILLED"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {ord.status === "FILLED" ? "全部成交" : "风控拒单"}
                        </span>
                      </td>
                      <td className="py-2 pl-2 font-sans text-slate-400">
                        {ord.source}
                        {ord.realizedPnl !== undefined && (
                          <span
                            className={`ml-1.5 font-mono ${
                              ord.realizedPnl >= 0 ? "text-rose-400" : "text-emerald-400"
                            }`}
                          >
                            ({formatSignedCurrency(ord.realizedPnl)})
                          </span>
                        )}
                        {ord.note && <span className="text-rose-300 ml-1">({ord.note})</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
