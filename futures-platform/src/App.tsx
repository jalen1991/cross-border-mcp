import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Cpu,
  Download,
  Layers,
  Play,
  ShieldAlert,
  Sliders,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { CandlestickChart } from "./components/CandlestickChart";
import { EquityDrawdownChart } from "./components/EquityDrawdownChart";
import { LiveTradingDesk } from "./components/LiveTradingDesk";
import { OptimizationHeatmap } from "./components/OptimizationHeatmap";
import { StrategyLeaderboard } from "./components/StrategyLeaderboard";
import { FUTURES_CONTRACTS, getContractBySymbol, roundToTick } from "./data/contracts";
import { generateMarketCandles } from "./data/marketGenerator";
import { calcCommission, calcRequiredMargin, compareStrategies, runBacktest, runParameterOptimization } from "./engine/backtester";
import {
  computeAccountSummary,
  createInitialSeedPositions,
  markPositionsToMarket,
  validateNewOrder,
} from "./engine/riskSimulator";
import {
  getDefaultParams,
  getStrategyDefinition,
  STRATEGY_DEFINITIONS,
} from "./engine/strategies";
import {
  BacktestConfig,
  LiveOrder,
  LivePosition,
  PositionSide,
  RiskRuleConfig,
  StrategyId,
  Timeframe,
} from "./types/futures";
import { formatCurrency, formatPct, formatPrice, formatSignedCurrency } from "./utils/format";

type WorkspaceTab = "studio" | "optimizer" | "live" | "contracts";

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("studio");

  // Backtest & Strategy Studio state
  const [symbol, setSymbol] = useState<string>("RB2610");
  const [timeframe, setTimeframe] = useState<Timeframe>("1h");
  const [strategyId, setStrategyId] = useState<StrategyId>("dual_ma");
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>(() =>
    getDefaultParams("dual_ma")
  );
  const [initialCapital, setInitialCapital] = useState<number>(1_000_000);
  const [positionSizingMode, setPositionSizingMode] = useState<"FIXED_LOTS" | "RISK_PCT">(
    "RISK_PCT"
  );
  const [fixedLots, setFixedLots] = useState<number>(5);
  const [riskPctPerTrade, setRiskPctPerTrade] = useState<number>(2.0);
  const [slippageTicks, setSlippageTicks] = useState<number>(1);
  const [stopLossPct, setStopLossPct] = useState<number>(2.5);
  const [takeProfitPct, setTakeProfitPct] = useState<number>(6.0);
  const [trailingAtrMult, setTrailingAtrMult] = useState<number>(1.5);
  const [barCount, setBarCount] = useState<number>(360);

  const handleSelectStrategy = (nextId: StrategyId) => {
    setStrategyId(nextId);
    setStrategyParams(getDefaultParams(nextId));
  };

  const backtestConfig: BacktestConfig = useMemo(
    () => ({
      symbol,
      timeframe,
      strategyId,
      params: strategyParams,
      initialCapital,
      positionSizingMode,
      fixedLots,
      riskPctPerTrade,
      slippageTicks,
      stopLossPct,
      takeProfitPct,
      trailingAtrMult,
      barCount,
    }),
    [
      symbol,
      timeframe,
      strategyId,
      strategyParams,
      initialCapital,
      positionSizingMode,
      fixedLots,
      riskPctPerTrade,
      slippageTicks,
      stopLossPct,
      takeProfitPct,
      trailingAtrMult,
      barCount,
    ]
  );

  const backtestResult = useMemo(() => runBacktest(backtestConfig), [backtestConfig]);
  const strategyScores = useMemo(() => compareStrategies(backtestConfig), [backtestConfig]);

  const optimizationResult = useMemo(() => {
    if (activeTab !== "optimizer") return null;
    return runParameterOptimization(backtestConfig, 6);
  }, [activeTab, backtestConfig]);

  // Live Paper-Trading & Risk Center State
  const initialQuotes = useMemo(() => {
    const q: Record<string, number> = {};
    for (const c of FUTURES_CONTRACTS) {
      const candles = generateMarketCandles(c, "1h", 60);
      q[c.symbol] = candles[candles.length - 1]?.close ?? c.basePrice;
    }
    return q;
  }, []);

  const [liveQuotes, setLiveQuotes] = useState<Record<string, number>>(initialQuotes);
  const [prevDayCloses] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {};
    for (const c of FUTURES_CONTRACTS) {
      p[c.symbol] = roundToTick(initialQuotes[c.symbol] * 0.994, c.tickSize);
    }
    return p;
  });

  const seed = useMemo(() => createInitialSeedPositions(initialQuotes), [initialQuotes]);
  const [liveInitialBalance] = useState<number>(1_000_000);
  const [liveCashBalance, setLiveCashBalance] = useState<number>(1_000_000);
  const [liveRealizedPnl, setLiveRealizedPnl] = useState<number>(0);
  const [livePositions, setLivePositions] = useState<LivePosition[]>(seed.positions);
  const [liveOrders, setLiveOrders] = useState<LiveOrder[]>(seed.orders);
  const [autoBotEnabled, setAutoBotEnabled] = useState<boolean>(false);
  const [lastRejectReason, setLastRejectReason] = useState<string | null>(null);
  const [riskRules, setRiskRules] = useState<RiskRuleConfig>({
    maxMarginUtilizationPct: 70,
    maxDailyLossPct: 5,
    maxSingleOrderLots: 25,
    autoForceCloseMarginPct: 95,
    circuitBreakerActive: true,
  });

  const accountSummary = useMemo(
    () =>
      computeAccountSummary(
        liveInitialBalance,
        liveCashBalance,
        liveRealizedPnl,
        livePositions,
        riskRules
      ),
    [liveInitialBalance, liveCashBalance, liveRealizedPnl, livePositions, riskRules]
  );

  const stepMarketTick = useCallback(() => {
    setLiveQuotes((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const c of FUTURES_CONTRACTS) {
        const curr = prev[c.symbol] ?? c.basePrice;
        const delta = (Math.random() - 0.492) * c.volatility * 0.25 * curr;
        next[c.symbol] = Math.max(
          c.tickSize * 10,
          roundToTick(curr + delta, c.tickSize)
        );
      }
      setLivePositions((posList) => markPositionsToMarket(posList, next));
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      stepMarketTick();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [stepMarketTick]);

  const nowTimeStr = () => {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
  };

  const handleSubmitOrder = useCallback(
    (ordSymbol: string, side: PositionSide, lots: number, sourceLabel = "手工闪电报单") => {
      const contract = getContractBySymbol(ordSymbol);
      const execPrice = liveQuotes[ordSymbol] ?? contract.basePrice;
      const check = validateNewOrder(
        ordSymbol,
        side,
        lots,
        execPrice,
        accountSummary,
        riskRules
      );

      if (!check.allowed) {
        setLastRejectReason(check.reason ?? "风控拦截");
        setLiveOrders((prev) => [
          {
            id: `ORD-${8000 + prev.length + 1}`,
            time: nowTimeStr(),
            symbol: ordSymbol,
            side,
            offset: "OPEN",
            lots,
            price: execPrice,
            status: "REJECTED",
            source: sourceLabel,
            commission: 0,
            note: check.reason,
          },
          ...prev,
        ]);
        return;
      }

      setLastRejectReason(null);
      const comm = calcCommission(contract, execPrice, lots);
      setLiveCashBalance((b) => b - comm);

      setLivePositions((prev) => {
        const existingIdx = prev.findIndex(
          (p) => p.symbol === ordSymbol && p.side === side
        );
        if (existingIdx >= 0) {
          const existing = prev[existingIdx];
          const totalLots = existing.lots + lots;
          const avgEntry =
            (existing.avgEntryPrice * existing.lots + execPrice * lots) / totalLots;
          const updated: LivePosition = {
            ...existing,
            lots: totalLots,
            avgEntryPrice: roundToTick(avgEntry, contract.tickSize),
            lastPrice: execPrice,
            marginUsed: calcRequiredMargin(contract, execPrice, totalLots),
            unrealizedPnl:
              (side === "LONG" ? execPrice - avgEntry : avgEntry - execPrice) *
              contract.multiplier *
              totalLots,
          };
          const clone = [...prev];
          clone[existingIdx] = updated;
          return markPositionsToMarket(clone, liveQuotes);
        }

        const newPos: LivePosition = {
          id: `POS-${Date.now().toString().slice(-4)}`,
          symbol: ordSymbol,
          name: contract.name,
          side,
          lots,
          avgEntryPrice: execPrice,
          lastPrice: execPrice,
          multiplier: contract.multiplier,
          marginUsed: calcRequiredMargin(contract, execPrice, lots),
          unrealizedPnl: 0,
          returnOnMarginPct: 0,
          stopLossPrice: null,
          takeProfitPrice: null,
          strategyTag: sourceLabel,
          openedAt: nowTimeStr(),
        };
        return markPositionsToMarket([newPos, ...prev], liveQuotes);
      });

      setLiveOrders((prev) => [
        {
          id: `ORD-${8000 + prev.length + 1}`,
          time: nowTimeStr(),
          symbol: ordSymbol,
          side,
          offset: "OPEN",
          lots,
          price: execPrice,
          status: "FILLED",
          source: sourceLabel,
          commission: comm,
        },
        ...prev,
      ]);
    },
    [liveQuotes, accountSummary, riskRules]
  );

  // Auto-bot periodic signal execution when enabled
  useEffect(() => {
    if (!autoBotEnabled) return;
    const def = getStrategyDefinition(strategyId);
    const botTimer = window.setInterval(() => {
      const targetSymbol = symbol;
      const lastSig = backtestResult.signals[backtestResult.signals.length - 1];
      const preferSide: PositionSide =
        lastSig && (lastSig.action === "OPEN_SHORT" || lastSig.action === "REVERSE_TO_SHORT")
          ? "SHORT"
          : "LONG";
      setLivePositions((currPos) => {
        const alreadyHas = currPos.some((p) => p.symbol === targetSymbol);
        if (!alreadyHas) {
          setTimeout(() => {
            handleSubmitOrder(targetSymbol, preferSide, 1, `${def.name.split(" ")[0]} 自动托管`);
          }, 0);
        }
        return currPos;
      });
    }, 5000);
    return () => window.clearInterval(botTimer);
  }, [autoBotEnabled, symbol, strategyId, backtestResult.signals, handleSubmitOrder]);

  const handleClosePosition = (posId: string) => {
    const target = livePositions.find((p) => p.id === posId);
    if (!target) return;
    const contract = getContractBySymbol(target.symbol);
    const exitPrice = liveQuotes[target.symbol] ?? target.lastPrice;
    const comm = calcCommission(contract, exitPrice, target.lots);
    const gross =
      (target.side === "LONG"
        ? exitPrice - target.avgEntryPrice
        : target.avgEntryPrice - exitPrice) *
      contract.multiplier *
      target.lots;
    const netRealized = gross - comm;

    setLiveCashBalance((b) => b + netRealized);
    setLiveRealizedPnl((r) => r + netRealized);
    setLivePositions((prev) => prev.filter((p) => p.id !== posId));
    setLiveOrders((prev) => [
      {
        id: `ORD-${8000 + prev.length + 1}`,
        time: nowTimeStr(),
        symbol: target.symbol,
        side: target.side === "LONG" ? "SHORT" : "LONG",
        offset: "CLOSE",
        lots: target.lots,
        price: exitPrice,
        status: "FILLED",
        source: "手工市价平仓",
        commission: comm,
        realizedPnl: netRealized,
      },
      ...prev,
    ]);
  };

  const handleCloseAllPositions = () => {
    if (livePositions.length === 0) return;
    let totalNet = 0;
    const closeOrders: LiveOrder[] = [];
    livePositions.forEach((target, idx) => {
      const contract = getContractBySymbol(target.symbol);
      const exitPrice = liveQuotes[target.symbol] ?? target.lastPrice;
      const comm = calcCommission(contract, exitPrice, target.lots);
      const gross =
        (target.side === "LONG"
          ? exitPrice - target.avgEntryPrice
          : target.avgEntryPrice - exitPrice) *
        contract.multiplier *
        target.lots;
      const net = gross - comm;
      totalNet += net;
      closeOrders.push({
        id: `ORD-${8000 + liveOrders.length + idx + 1}`,
        time: nowTimeStr(),
        symbol: target.symbol,
        side: target.side === "LONG" ? "SHORT" : "LONG",
        offset: "CLOSE",
        lots: target.lots,
        price: exitPrice,
        status: "FILLED",
        source: "一键全平避险",
        commission: comm,
        realizedPnl: net,
      });
    });

    setLiveCashBalance((b) => b + totalNet);
    setLiveRealizedPnl((r) => r + totalNet);
    setLivePositions([]);
    setLiveOrders((prev) => [...closeOrders, ...prev]);
  };

  const exportTradesCsv = () => {
    const header = [
      "交易编号",
      "合约",
      "方向",
      "手数",
      "开仓时间",
      "开仓价",
      "平仓时间",
      "平仓价",
      "手续费",
      "滑点成本",
      "净盈亏(CNY)",
      "保证金收益率(%)",
      "持仓K线数",
      "开仓原因",
      "平仓原因",
    ].join(",");
    const rows = backtestResult.trades.map((t) =>
      [
        t.id,
        t.symbol,
        t.side,
        t.lots,
        t.entryTime,
        t.entryPrice,
        t.exitTime,
        t.exitPrice,
        t.commission.toFixed(2),
        t.slippageCost.toFixed(2),
        t.netPnl.toFixed(2),
        t.returnPct.toFixed(2),
        t.holdingBars,
        `"${t.entryReason}"`,
        `"${t.exitReason}"`,
      ].join(",")
    );
    const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backtest_${symbol}_${strategyId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeStrategyDef = getStrategyDefinition(strategyId);
  const { metrics } = backtestResult;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Financial Terminal Header & Live Ticker Strip */}
      <header className="sticky top-0 z-30 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-[1520px] mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-white">
                  AlphaQuant Futures
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  仿真行情数据 (Sample Market Feed)
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                专业期货量化策略研发 · 逐笔保证金回测 · 参数网格寻优 · 实时风控仿真工作台
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab("studio")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "studio"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              策略研发与回测工作台
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("optimizer")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "optimizer"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              参数寻优热力图
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("live")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "live"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              模拟实盘与风控中心
              {livePositions.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-rose-500/30 text-rose-200 text-[10px] font-mono">
                  {livePositions.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("contracts")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition ${
                activeTab === "contracts"
                  ? "bg-indigo-600 text-white shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              主力合约规格字典
            </button>
          </nav>
        </div>

        {/* Sub-header Live Futures Ticker Strip */}
        <div className="border-t border-slate-800/80 bg-slate-900/50">
          <div className="max-w-[1520px] mx-auto px-4 py-1.5 flex items-center gap-4 overflow-x-auto text-xs font-mono">
            {FUTURES_CONTRACTS.map((c) => {
              const last = liveQuotes[c.symbol] ?? c.basePrice;
              const prevClose = prevDayCloses[c.symbol] ?? c.basePrice;
              const chgPct = ((last - prevClose) / prevClose) * 100;
              const isSelected = c.symbol === symbol;
              return (
                <button
                  key={c.symbol}
                  type="button"
                  onClick={() => setSymbol(c.symbol)}
                  className={`flex items-center gap-2 px-2.5 py-1 rounded-lg shrink-0 transition border ${
                    isSelected
                      ? "bg-indigo-950/80 border-indigo-500/50 text-white"
                      : "border-transparent hover:bg-slate-800/70 text-slate-300"
                  }`}
                >
                  <span className="font-sans font-medium text-slate-300">{c.name}</span>
                  <span className="text-slate-400">{c.symbol}</span>
                  <span
                    className={`font-semibold ${
                      chgPct >= 0 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {formatPrice(last, c.tickSize)}
                  </span>
                  <span
                    className={`text-[11px] ${
                      chgPct >= 0 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {formatPct(chgPct, 2)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="max-w-[1520px] w-full mx-auto px-4 py-5 flex-1">
        {activeTab === "studio" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
            {/* Left Sidebar: Strategy Configuration & Execution Parameters */}
            <aside className="xl:col-span-3 flex flex-col gap-4">
              {/* Contract & Timeframe Selector */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Activity className="w-4 h-4 text-indigo-400" />
                  标的合约与回测周期
                </div>

                <div className="space-y-2.5 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">交易品种</label>
                    <select
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
                    >
                      {FUTURES_CONTRACTS.map((c) => (
                        <option key={c.symbol} value={c.symbol}>
                          [{c.exchange}] {c.symbol} {c.name} ({c.multiplier}
                          {c.unit.replace("元/", "")}/手)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">K线周期</label>
                      <div className="grid grid-cols-4 gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                        {(["15m", "1h", "4h", "1d"] as Timeframe[]).map((tf) => (
                          <button
                            key={tf}
                            type="button"
                            onClick={() => setTimeframe(tf)}
                            className={`py-1 rounded text-[11px] font-mono transition ${
                              timeframe === tf
                                ? "bg-indigo-600 text-white"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {tf}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-slate-400 block mb-1">样本K线数量</label>
                      <select
                        value={barCount}
                        onChange={(e) => setBarCount(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 font-mono text-slate-200"
                      >
                        <option value={240}>240 根</option>
                        <option value={360}>360 根</option>
                        <option value={500}>500 根</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quantitative Strategy Model Picker */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <Cpu className="w-4 h-4 text-indigo-400" />
                    量化策略模型库
                  </div>
                  <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 text-[11px]">
                    {activeStrategyDef.category}
                  </span>
                </div>

                <select
                  value={strategyId}
                  onChange={(e) => handleSelectStrategy(e.target.value as StrategyId)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  {STRATEGY_DEFINITIONS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <p className="text-xs text-slate-400 leading-relaxed">
                  {activeStrategyDef.description}
                </p>

                <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800/90 font-mono text-[11px] text-indigo-300">
                  {activeStrategyDef.formulaSummary}
                </div>

                {/* Dynamic Strategy Sliders */}
                <div className="space-y-3 pt-1">
                  {activeStrategyDef.params.map((p) => {
                    const val = strategyParams[p.key] ?? p.defaultValue;
                    return (
                      <div key={p.key} className="text-xs">
                        <div className="flex justify-between mb-1">
                          <span className="text-slate-300">{p.label}</span>
                          <span className="font-mono font-semibold text-indigo-300">{val}</span>
                        </div>
                        <input
                          type="range"
                          min={p.min}
                          max={p.max}
                          step={p.step}
                          value={val}
                          onChange={(e) =>
                            setStrategyParams((prev) => ({
                              ...prev,
                              [p.key]: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-indigo-500"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Capital, Position Sizing & Stop-Loss Config */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  资金管理与滑点止损设置
                </div>

                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">初始本金 (CNY)</label>
                      <select
                        value={initialCapital}
                        onChange={(e) => setInitialCapital(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 font-mono text-slate-200"
                      >
                        <option value={500_000}>¥500,000</option>
                        <option value={1_000_000}>¥1,000,000</option>
                        <option value={5_000_000}>¥5,000,000</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">单边滑点 (Ticks)</label>
                      <select
                        value={slippageTicks}
                        onChange={(e) => setSlippageTicks(Number(e.target.value))}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 font-mono text-slate-200"
                      >
                        <option value={0}>0 跳 (理想)</option>
                        <option value={1}>1 跳 (标准)</option>
                        <option value={2}>2 跳 (严苛)</option>
                        <option value={3}>3 跳 (冲击测试)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">仓位分配模型</label>
                    <div className="grid grid-cols-2 gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                      <button
                        type="button"
                        onClick={() => setPositionSizingMode("RISK_PCT")}
                        className={`py-1 rounded text-xs transition ${
                          positionSizingMode === "RISK_PCT"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-400"
                        }`}
                      >
                        ATR风险百分比
                      </button>
                      <button
                        type="button"
                        onClick={() => setPositionSizingMode("FIXED_LOTS")}
                        className={`py-1 rounded text-xs transition ${
                          positionSizingMode === "FIXED_LOTS"
                            ? "bg-indigo-600 text-white"
                            : "text-slate-400"
                        }`}
                      >
                        固定手数模型
                      </button>
                    </div>
                  </div>

                  {positionSizingMode === "RISK_PCT" ? (
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-400">单笔ATR风险预算</span>
                        <span className="font-mono text-slate-200">{riskPctPerTrade.toFixed(1)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.5}
                        max={5.0}
                        step={0.5}
                        value={riskPctPerTrade}
                        onChange={(e) => setRiskPctPerTrade(Number(e.target.value))}
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-400">每次固定开仓手数</span>
                        <span className="font-mono text-slate-200">{fixedLots} 手</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={30}
                        step={1}
                        value={fixedLots}
                        onChange={(e) => setFixedLots(Number(e.target.value))}
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-400">ATR 跟踪止损</span>
                      <span className="font-mono text-sky-300">
                        {trailingAtrMult === 0 ? "关闭" : `${trailingAtrMult.toFixed(1)}×`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={4}
                      step={0.5}
                      value={trailingAtrMult}
                      onChange={(e) => setTrailingAtrMult(Number(e.target.value))}
                      className="w-full accent-indigo-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-400">硬止损比例</span>
                        <span className="font-mono text-emerald-400">
                          {stopLossPct === 0 ? "关闭" : `-${stopLossPct}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={8}
                        step={0.5}
                        value={stopLossPct}
                        onChange={(e) => setStopLossPct(Number(e.target.value))}
                        className="w-full accent-indigo-500"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span className="text-slate-400">硬止盈比例</span>
                        <span className="font-mono text-rose-400">
                          {takeProfitPct === 0 ? "关闭" : `+${takeProfitPct}%`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={15}
                        step={1}
                        value={takeProfitPct}
                        onChange={(e) => setTakeProfitPct(Number(e.target.value))}
                        className="w-full accent-indigo-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab("optimizer")}
                    className="flex-1 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    参数网格寻优
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAutoBotEnabled(true);
                      setActiveTab("live");
                    }}
                    className="flex-1 py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition shadow"
                  >
                    <Play className="w-3.5 h-3.5" />
                    部署模拟实盘
                  </button>
                </div>
              </div>
            </aside>

            {/* Right Main Panel: Performance KPIs, K-Line Chart, Equity Curve & Trade Blotter */}
            <section className="xl:col-span-9 flex flex-col gap-4">
              {/* 8 Core Quantitative KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">累计净收益率</div>
                  <div
                    className={`text-base font-bold font-mono mt-1 ${
                      metrics.totalReturnPct >= 0 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {formatPct(metrics.totalReturnPct)}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {formatSignedCurrency(metrics.netProfit)}
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">年化收益率</div>
                  <div
                    className={`text-base font-bold font-mono mt-1 ${
                      metrics.annualizedReturnPct >= 0 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {formatPct(metrics.annualizedReturnPct, 1)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">复利年化折算</div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">夏普比率 (Sharpe)</div>
                  <div className="text-base font-bold font-mono text-indigo-300 mt-1">
                    {metrics.sharpeRatio.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    Sortino {metrics.sortinoRatio.toFixed(2)}
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">最大回撤 (Max DD)</div>
                  <div className="text-base font-bold font-mono text-amber-400 mt-1">
                    -{metrics.maxDrawdownPct.toFixed(2)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {formatCurrency(metrics.maxDrawdownAmount)}
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">卡玛比率 (Calmar)</div>
                  <div className="text-base font-bold font-mono text-sky-300 mt-1">
                    {metrics.calmarRatio.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">收益回撤性价比</div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">胜率 (Win Rate)</div>
                  <div className="text-base font-bold font-mono text-slate-100 mt-1">
                    {metrics.winRatePct.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {metrics.winningTrades}胜 / {metrics.losingTrades}负
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">盈亏因子 (PF)</div>
                  <div className="text-base font-bold font-mono text-slate-100 mt-1">
                    {metrics.profitFactor.toFixed(2)}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    赔率 {metrics.payoffRatio.toFixed(2)}
                  </div>
                </div>

                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400">交易笔数 & 成本</div>
                  <div className="text-base font-bold font-mono text-slate-100 mt-1">
                    {metrics.totalTrades} 笔
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    费+滑 {formatCurrency(metrics.totalCommission + metrics.totalSlippage)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {[backtestResult.inSample, backtestResult.outOfSample].map((sample) => (
                  <div key={sample.label} className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-400">
                        {sample.label}
                        <span className="ml-2 font-mono text-slate-500">
                          K线 {sample.startIndex + 1}–{sample.endIndex + 1}
                        </span>
                      </div>
                      <div className={`text-lg font-bold font-mono mt-1 ${sample.totalReturnPct >= 0 ? "text-rose-400" : "text-emerald-400"}`}>
                        {formatPct(sample.totalReturnPct)}
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs font-mono text-slate-300">
                      <span>夏普 <b className="text-indigo-300">{sample.sharpeRatio.toFixed(2)}</b></span>
                      <span>回撤 <b className="text-amber-400">-{sample.maxDrawdownPct.toFixed(1)}%</b></span>
                      <span>笔数 <b className="text-slate-100">{sample.totalTrades}</b></span>
                      <span>胜率 <b className="text-slate-100">{sample.winRatePct.toFixed(0)}%</b></span>
                    </div>
                  </div>
                ))}
              </div>

              <StrategyLeaderboard
                scores={strategyScores}
                activeStrategyId={strategyId}
                onSelect={handleSelectStrategy}
              />

              {/* Interactive K-Line Chart with Strategy Indicators & Signals */}
              <CandlestickChart
                candles={backtestResult.candles}
                contract={backtestResult.contract}
                indicators={backtestResult.indicators}
                signals={backtestResult.signals}
              />

              {/* Equity & Drawdown Curve */}
              <EquityDrawdownChart
                equityCurve={backtestResult.equityCurve}
                initialCapital={initialCapital}
              />

              {/* Round-Trip Trade Records Table */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">
                      历史逐笔平仓交割单 ({backtestResult.trades.length} 笔完整回合)
                    </h3>
                    <p className="text-xs text-slate-400">
                      严格按次根K线开盘价 + 双边滑点 + 交易所手续费标准撮合，杜绝未来函数
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={exportTradesCsv}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    导出 CSV 交割单
                  </button>
                </div>

                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="sticky top-0 bg-slate-900">
                      <tr className="text-slate-400 border-b border-slate-800">
                        <th className="py-2 pr-2">编号</th>
                        <th className="py-2 px-2">多空</th>
                        <th className="py-2 px-2 text-right">手数</th>
                        <th className="py-2 px-2">开仓时间 / 价格</th>
                        <th className="py-2 px-2">平仓时间 / 价格</th>
                        <th className="py-2 px-2 text-right">手续费+滑点</th>
                        <th className="py-2 px-2 text-right">净盈亏</th>
                        <th className="py-2 px-2 text-right">保证金回报</th>
                        <th className="py-2 pl-2">触发逻辑摘要</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {[...backtestResult.trades].reverse().map((tr) => (
                        <tr key={tr.id} className="hover:bg-slate-800/40">
                          <td className="py-2 pr-2 text-slate-400">{tr.id}</td>
                          <td className="py-2 px-2 font-sans">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                                tr.side === "LONG"
                                  ? "bg-rose-500/20 text-rose-300"
                                  : "bg-emerald-500/20 text-emerald-300"
                              }`}
                            >
                              {tr.side === "LONG" ? "做多" : "做空"}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right text-slate-200">{tr.lots}</td>
                          <td className="py-2 px-2 text-slate-300">
                            <div>
                              {formatPrice(tr.entryPrice, backtestResult.contract.tickSize)}
                            </div>
                            <div className="text-[10px] text-slate-500">{tr.entryTime}</div>
                          </td>
                          <td className="py-2 px-2 text-slate-300">
                            <div>
                              {formatPrice(tr.exitPrice, backtestResult.contract.tickSize)}
                            </div>
                            <div className="text-[10px] text-slate-500">{tr.exitTime}</div>
                          </td>
                          <td className="py-2 px-2 text-right text-slate-400">
                            {formatCurrency(tr.commission + tr.slippageCost, 1)}
                          </td>
                          <td
                            className={`py-2 px-2 text-right font-semibold ${
                              tr.netPnl >= 0 ? "text-rose-400" : "text-emerald-400"
                            }`}
                          >
                            {formatSignedCurrency(tr.netPnl)}
                          </td>
                          <td
                            className={`py-2 px-2 text-right ${
                              tr.returnPct >= 0 ? "text-rose-400" : "text-emerald-400"
                            }`}
                          >
                            {formatPct(tr.returnPct, 1)}
                          </td>
                          <td className="py-2 pl-2 font-sans text-slate-400 max-w-xs truncate">
                            {tr.entryReason} → {tr.exitReason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === "optimizer" && optimizationResult && (
          <div className="flex flex-col gap-5">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-white">
                  策略多维参数鲁棒性寻优 — {activeStrategyDef.name} ({symbol} · {timeframe})
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  参数在前 70% 行情上运行，格子颜色和最优选择看后 30% 样本外夏普，用来避开只在历史样本里有效的参数孤岛。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("studio")}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition"
              >
                返回策略回测详情视图
              </button>
            </div>

            <OptimizationHeatmap
              result={optimizationResult}
              currentX={strategyParams[optimizationResult.paramXKey]}
              currentY={strategyParams[optimizationResult.paramYKey]}
              onApplyParams={(xVal, yVal) => {
                setStrategyParams((prev) => ({
                  ...prev,
                  [optimizationResult.paramXKey]: xVal,
                  [optimizationResult.paramYKey]: yVal,
                }));
                setActiveTab("studio");
              }}
            />
          </div>
        )}

        {activeTab === "live" && (
          <LiveTradingDesk
            quotes={liveQuotes}
            summary={accountSummary}
            positions={livePositions}
            orders={liveOrders}
            riskRules={riskRules}
            autoBotEnabled={autoBotEnabled}
            activeStrategyName={`${symbol} · ${activeStrategyDef.name}`}
            lastRejectReason={lastRejectReason}
            onToggleAutoBot={() => setAutoBotEnabled((v) => !v)}
            onStepMarketTick={stepMarketTick}
            onSubmitManualOrder={(sym, side, lots) => handleSubmitOrder(sym, side, lots)}
            onClosePosition={handleClosePosition}
            onCloseAllPositions={handleCloseAllPositions}
            onUpdateRiskRules={setRiskRules}
          />
        )}

        {activeTab === "contracts" && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-white">
                国内四大期货交易所及能源中心主力合约参数字典
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                平台回测与模拟撮合均严格遵循以下合约乘数、最小变动价位（Tick）、交易所保证金比例与手续费标准
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-800">
                    <th className="py-2.5 pr-3">合约代码</th>
                    <th className="py-2.5 px-3">品种名称</th>
                    <th className="py-2.5 px-3">交易所</th>
                    <th className="py-2.5 px-3">板块分类</th>
                    <th className="py-2.5 px-3 text-right">合约乘数</th>
                    <th className="py-2.5 px-3 text-right">最小跳动(Tick)</th>
                    <th className="py-2.5 px-3 text-right">保证金比例</th>
                    <th className="py-2.5 px-3 text-right">每手保证金估算</th>
                    <th className="py-2.5 pl-3">手续费标准</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono">
                  {FUTURES_CONTRACTS.map((c) => {
                    const price = liveQuotes[c.symbol] ?? c.basePrice;
                    const margin1Lot = calcRequiredMargin(c, price, 1);
                    return (
                      <tr key={c.symbol} className="hover:bg-slate-800/40">
                        <td className="py-3 pr-3 font-bold text-indigo-300">{c.symbol}</td>
                        <td className="py-3 px-3 font-sans text-slate-100 font-medium">{c.name}</td>
                        <td className="py-3 px-3 text-slate-300">{c.exchange}</td>
                        <td className="py-3 px-3 font-sans">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {c.sector}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right text-slate-200">
                          {c.multiplier} ({c.unit})
                        </td>
                        <td className="py-3 px-3 text-right text-slate-200">{c.tickSize}</td>
                        <td className="py-3 px-3 text-right text-amber-300">
                          {(c.marginRate * 100).toFixed(0)}%
                        </td>
                        <td className="py-3 px-3 text-right text-sky-400">
                          {formatCurrency(margin1Lot)}
                        </td>
                        <td className="py-3 pl-3 font-sans text-slate-300">
                          {c.commissionRate > 0
                            ? `成交额 × ${(c.commissionRate * 10000).toFixed(2)}‱`
                            : `固定 ¥${c.commissionFixed.toFixed(1)} / 手`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
