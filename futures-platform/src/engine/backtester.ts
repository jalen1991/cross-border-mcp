import { getContractBySymbol, roundToTick } from "../data/contracts";
import { generateMarketCandles, getBarsPerYear } from "../data/marketGenerator";
import {
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
  Candle,
  EquityPoint,
  FuturesContract,
  OptimizationCell,
  OptimizationGridResult,
  PositionSide,
  SignalEvent,
  TradeRecord,
} from "../types/futures";
import { calcATR } from "./indicators";
import { evaluateStrategySignals, getStrategyDefinition } from "./strategies";

export function calcCommission(
  contract: FuturesContract,
  price: number,
  lots: number
): number {
  const notional = price * contract.multiplier * lots;
  return notional * contract.commissionRate + contract.commissionFixed * lots;
}

export function calcRequiredMargin(
  contract: FuturesContract,
  price: number,
  lots: number
): number {
  return price * contract.multiplier * lots * contract.marginRate;
}

function determineLots(
  config: BacktestConfig,
  contract: FuturesContract,
  equity: number,
  price: number,
  atrValue: number | null
): number {
  const minMarginPerLot = calcRequiredMargin(contract, price, 1);
  const maxAffordableLots = Math.max(1, Math.floor((equity * 0.75) / Math.max(minMarginPerLot, 1)));

  if (config.positionSizingMode === "FIXED_LOTS") {
    return Math.max(1, Math.min(config.fixedLots, maxAffordableLots));
  }

  // ATR / Risk percentage sizing
  const riskBudget = equity * (Math.max(0.2, config.riskPctPerTrade) / 100);
  const effectiveStopMove =
    atrValue && atrValue > 0 ? atrValue * 2.0 : price * contract.volatility * 1.5;
  const riskPerLot = Math.max(effectiveStopMove * contract.multiplier, contract.tickSize * contract.multiplier);
  const targetLots = Math.floor(riskBudget / riskPerLot);
  return Math.max(1, Math.min(targetLots || 1, maxAffordableLots));
}

export function runBacktest(
  config: BacktestConfig,
  providedCandles?: Candle[]
): BacktestResult {
  const contract = getContractBySymbol(config.symbol);
  const candles =
    providedCandles ?? generateMarketCandles(contract, config.timeframe, config.barCount);
  const n = candles.length;

  const { desiredPosition, reasons, indicators } = evaluateStrategySignals(
    config.strategyId,
    candles,
    config.params
  );
  const atrSeries = calcATR(candles, 14);

  const signals: SignalEvent[] = [];
  const trades: TradeRecord[] = [];
  const equityCurve: EquityPoint[] = [];

  let balance = config.initialCapital;
  let peakEquity = balance;
  let maxDrawdownPct = 0;
  let maxDrawdownAmount = 0;
  let maxMarginUtilizationPct = 0;

  let currentSide: PositionSide | null = null;
  let currentLots = 0;
  let entryPrice = 0;
  let entryIndex = 0;
  let entryTime = "";
  let entryReason = "";
  let entryCommission = 0;
  let entrySlippageCost = 0;

  const slipAmount = config.slippageTicks * contract.tickSize;

  const closeCurrentPosition = (
    barIdx: number,
    rawExitPrice: number,
    exitReason: string,
    emitSignal: boolean
  ) => {
    if (!currentSide || currentLots <= 0) return;

    const execExitPrice = roundToTick(
      currentSide === "LONG" ? rawExitPrice - slipAmount : rawExitPrice + slipAmount,
      contract.tickSize
    );
    const exitSlipCost = Math.abs(execExitPrice - rawExitPrice) * contract.multiplier * currentLots;
    const exitComm = calcCommission(contract, execExitPrice, currentLots);

    const priceDiff =
      currentSide === "LONG" ? execExitPrice - entryPrice : entryPrice - execExitPrice;
    const grossSpacerPnl =
      (currentSide === "LONG" ? rawExitPrice - entryPrice : entryPrice - rawExitPrice) *
      contract.multiplier *
      currentLots;
    const realizedPricePnl = priceDiff * contract.multiplier * currentLots;
    const totalComm = entryCommission + exitComm;
    const totalSlip = entrySlippageCost + exitSlipCost;

    balance += realizedPricePnl - exitComm;

    const marginBase = Math.max(calcRequiredMargin(contract, entryPrice, currentLots), 1);
    const fullNetPnl = realizedPricePnl - totalComm;

    trades.push({
      id: `T-${String(trades.length + 1).padStart(3, "0")}`,
      symbol: contract.symbol,
      side: currentSide,
      lots: currentLots,
      entryIndex,
      entryTime,
      entryPrice,
      exitIndex: barIdx,
      exitTime: candles[barIdx].timeStr,
      exitPrice: execExitPrice,
      grossPnl: grossSpacerPnl + entrySlippageCost,
      commission: totalComm,
      slippageCost: totalSlip,
      netPnl: fullNetPnl,
      returnPct: (fullNetPnl / marginBase) * 100,
      holdingBars: Math.max(1, barIdx - entryIndex),
      entryReason,
      exitReason,
    });

    if (emitSignal) {
      signals.push({
        index: barIdx,
        timestamp: candles[barIdx].timestamp,
        timeStr: candles[barIdx].timeStr,
        action: currentSide === "LONG" ? "CLOSE_LONG" : "CLOSE_SHORT",
        price: execExitPrice,
        reason: exitReason,
      });
    }

    currentSide = null;
    currentLots = 0;
  };

  const openNewPosition = (
    barIdx: number,
    side: PositionSide,
    rawEntryPrice: number,
    reason: string,
    isReverse: boolean
  ) => {
    const execPrice = roundToTick(
      side === "LONG" ? rawEntryPrice + slipAmount : rawEntryPrice - slipAmount,
      contract.tickSize
    );
    const lots = determineLots(config, contract, Math.max(balance, config.initialCapital * 0.2), execPrice, atrSeries[barIdx]);
    const comm = calcCommission(contract, execPrice, lots);
    const slipCost = Math.abs(execPrice - rawEntryPrice) * contract.multiplier * lots;

    balance -= comm;
    currentSide = side;
    currentLots = lots;
    entryPrice = execPrice;
    entryIndex = barIdx;
    entryTime = candles[barIdx].timeStr;
    entryReason = reason || (side === "LONG" ? "策略做多信号" : "策略做空信号");
    entryCommission = comm;
    entrySlippageCost = slipCost;

    signals.push({
      index: barIdx,
      timestamp: candles[barIdx].timestamp,
      timeStr: candles[barIdx].timeStr,
      action: isReverse
        ? side === "LONG"
          ? "REVERSE_TO_LONG"
          : "REVERSE_TO_SHORT"
        : side === "LONG"
          ? "OPEN_LONG"
          : "OPEN_SHORT",
      price: execPrice,
      reason: entryReason,
    });
  };

  for (let i = 0; i < n; i++) {
    const bar = candles[i];

    // 1. Check intrabar Stop-Loss / Take-Profit if holding a position from prior bar
    if (currentSide && currentLots > 0 && i > entryIndex) {
      let stoppedOut = false;
      if (config.stopLossPct > 0) {
        const slPrice =
          currentSide === "LONG"
            ? entryPrice * (1 - config.stopLossPct / 100)
            : entryPrice * (1 + config.stopLossPct / 100);
        if (
          (currentSide === "LONG" && bar.low <= slPrice) ||
          (currentSide === "SHORT" && bar.high >= slPrice)
        ) {
          closeCurrentPosition(
            i,
            roundToTick(slPrice, contract.tickSize),
            `触发风控止损 (${config.stopLossPct}%)`,
            true
          );
          stoppedOut = true;
        }
      }

      if (!stoppedOut && config.takeProfitPct > 0 && currentSide) {
        const tpPrice =
          currentSide === "LONG"
            ? entryPrice * (1 + config.takeProfitPct / 100)
            : entryPrice * (1 - config.takeProfitPct / 100);
        if (
          (currentSide === "LONG" && bar.high >= tpPrice) ||
          (currentSide === "SHORT" && bar.low <= tpPrice)
        ) {
          closeCurrentPosition(
            i,
            roundToTick(tpPrice, contract.tickSize),
            `触发风控止盈 (${config.takeProfitPct}%)`,
            true
          );
        }
      }
    }

    // 2. Execute strategy signal discovered on prior bar [i - 1] at current bar's open (no look-ahead bias)
    if (i > 0 && i < n - 1) {
      const target = desiredPosition[i - 1];
      const sigReason = reasons[i - 1] || reasons[i] || "";
      const currentNum = currentSide === "LONG" ? 1 : currentSide === "SHORT" ? -1 : 0;

      if (target !== currentNum) {
        if (target === 0 && currentSide) {
          closeCurrentPosition(i, bar.open, sigReason || "策略平仓信号", true);
        } else if (target === 1) {
          const wasShort = currentSide === "SHORT";
          if (wasShort) {
            closeCurrentPosition(i, bar.open, sigReason || "反手平空", false);
          }
          if (!currentSide) {
            openNewPosition(i, "LONG", bar.open, sigReason || "策略开多", wasShort);
          }
        } else if (target === -1) {
          const wasLong = currentSide === "LONG";
          if (wasLong) {
            closeCurrentPosition(i, bar.open, sigReason || "反手平多", false);
          }
          if (!currentSide) {
            openNewPosition(i, "SHORT", bar.open, sigReason || "策略开空", wasLong);
          }
        }
      }
    }

    // Close open position on final bar so round-trip stats are complete
    if (i === n - 1 && currentSide) {
      closeCurrentPosition(i, bar.close, "回测期末结算平仓", true);
    }

    // 3. Mark-to-market equity calculation
    let unrealizedPnl = 0;
    let marginUsed = 0;
    if (currentSide && currentLots > 0) {
      const diff = currentSide === "LONG" ? bar.close - entryPrice : entryPrice - bar.close;
      unrealizedPnl = diff * contract.multiplier * currentLots;
      marginUsed = calcRequiredMargin(contract, bar.close, currentLots);
    }

    const equity = balance + unrealizedPnl;
    if (equity > peakEquity) {
      peakEquity = equity;
    }
    const ddAmount = peakEquity - equity;
    const ddPct = peakEquity > 0 ? (ddAmount / peakEquity) * 100 : 0;
    if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;
    if (ddAmount > maxDrawdownAmount) maxDrawdownAmount = ddAmount;

    const marginUtil = equity > 0 ? (marginUsed / equity) * 100 : 0;
    if (marginUtil > maxMarginUtilizationPct) maxMarginUtilizationPct = marginUtil;

    equityCurve.push({
      index: i,
      timeStr: bar.timeStr,
      price: bar.close,
      equity,
      balance,
      unrealizedPnl,
      marginUsed,
      drawdownPct: -ddPct,
      positionSide: currentSide,
      positionLots: currentLots,
    });
  }

  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? config.initialCapital;
  const netProfit = finalEquity - config.initialCapital;
  const totalReturnPct = (netProfit / config.initialCapital) * 100;

  const barsPerYear = getBarsPerYear(config.timeframe);
  const years = Math.max(n / barsPerYear, 1 / 52);
  const annualizedReturnPct =
    finalEquity > 0
      ? (Math.pow(finalEquity / config.initialCapital, 1 / years) - 1) * 100
      : -100;

  // Bar-by-bar returns for Sharpe & Sortino
  const barReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEq = equityCurve[i - 1].equity;
    if (prevEq > 0) {
      barReturns.push((equityCurve[i].equity - prevEq) / prevEq);
    }
  }

  const meanRet =
    barReturns.length > 0 ? barReturns.reduce((a, b) => a + b, 0) / barReturns.length : 0;
  const variance =
    barReturns.length > 1
      ? barReturns.reduce((acc, r) => acc + Math.pow(r - meanRet, 2), 0) / (barReturns.length - 1)
      : 0;
  const stdRet = Math.sqrt(variance);
  const rfPerBar = 0.02 / barsPerYear;
  const sharpeRatio =
    stdRet > 1e-9 ? ((meanRet - rfPerBar) / stdRet) * Math.sqrt(barsPerYear) : 0;

  const downsideVariance =
    barReturns.length > 1
      ? barReturns.reduce((acc, r) => {
          const diff = Math.min(0, r - rfPerBar);
          return acc + diff * diff;
        }, 0) /
        (barReturns.length - 1)
      : 0;
  const downsideStd = Math.sqrt(downsideVariance);
  const sortinoRatio =
    downsideStd > 1e-9 ? ((meanRet - rfPerBar) / downsideStd) * Math.sqrt(barsPerYear) : 0;

  const calmarRatio = maxDrawdownPct > 0.01 ? annualizedReturnPct / maxDrawdownPct : 0;

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossWinSum = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLossAbs = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));

  const avgWin = wins.length > 0 ? grossWinSum / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLossAbs / losses.length : 0;
  const profitFactor = grossLossAbs > 0 ? grossWinSum / grossLossAbs : grossWinSum > 0 ? 9.99 : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 9.99 : 0;
  const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  const totalCommission = trades.reduce((s, t) => s + t.commission, 0);
  const totalSlippage = trades.reduce((s, t) => s + t.slippageCost, 0);
  const avgHoldingBars =
    trades.length > 0 ? trades.reduce((s, t) => s + t.holdingBars, 0) / trades.length : 0;

  // Monthly / Segment returns aggregation
  const monthMap = new Map<string, { startEq: number; endEq: number }>();
  for (const pt of equityCurve) {
    const monthKey = pt.timeStr.slice(0, 7);
    const existing = monthMap.get(monthKey);
    if (!existing) {
      monthMap.set(monthKey, { startEq: pt.equity, endEq: pt.equity });
    } else {
      existing.endEq = pt.equity;
    }
  }
  const monthlyReturns = Array.from(monthMap.entries()).map(([month, { startEq, endEq }]) => ({
    month,
    profit: endEq - startEq,
    returnPct: startEq > 0 ? ((endEq - startEq) / startEq) * 100 : 0,
  }));

  const metrics: BacktestMetrics = {
    initialCapital: config.initialCapital,
    finalEquity,
    netProfit,
    totalReturnPct,
    annualizedReturnPct,
    maxDrawdownPct,
    maxDrawdownAmount,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    winRatePct,
    profitFactor,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    avgWin,
    avgLoss,
    payoffRatio,
    totalCommission,
    totalSlippage,
    maxMarginUtilizationPct,
    avgHoldingBars,
  };

  return {
    config,
    contract,
    candles,
    indicators,
    signals,
    trades,
    equityCurve,
    monthlyReturns,
    metrics,
  };
}

export function runParameterOptimization(
  baseConfig: BacktestConfig,
  stepsPerAxis = 6
): OptimizationGridResult {
  const def = getStrategyDefinition(baseConfig.strategyId);
  const pX = def.params[0];
  const pY = def.params[1] ?? def.params[0];

  const contract = getContractBySymbol(baseConfig.symbol);
  const sharedCandles = generateMarketCandles(contract, baseConfig.timeframe, baseConfig.barCount);

  const buildAxisValues = (min: number, max: number, step: number, count: number): number[] => {
    const vals: number[] = [];
    const span = max - min;
    const rawStep = Math.max(step, span / Math.max(1, count - 1));
    for (let i = 0; i < count; i++) {
      const v = min + i * rawStep;
      const snapped = Math.round(v / step) * step;
      const decimals = step < 1 ? 2 : 0;
      const clean = Number(Math.min(max, Math.max(min, snapped)).toFixed(decimals));
      if (!vals.includes(clean)) vals.push(clean);
    }
    return vals;
  };

  const paramXValues = buildAxisValues(pX.min, pX.max, pX.step, stepsPerAxis);
  const paramYValues = buildAxisValues(pY.min, pY.max, pY.step, stepsPerAxis);

  const cells: OptimizationCell[] = [];
  let bestCell: OptimizationCell | null = null;

  for (const xVal of paramXValues) {
    for (const yVal of paramYValues) {
      // Skip invalid combinations where fast >= slow
      if (
        (baseConfig.strategyId === "dual_ma" || baseConfig.strategyId === "macd_trend") &&
        xVal >= yVal
      ) {
        continue;
      }
      if (baseConfig.strategyId === "turtle_donchian" && yVal >= xVal) {
        continue;
      }

      const nextParams = {
        ...baseConfig.params,
        [pX.key]: xVal,
        [pY.key]: yVal,
      };
      const res = runBacktest({ ...baseConfig, params: nextParams }, sharedCandles);
      const cell: OptimizationCell = {
        paramX: xVal,
        paramY: yVal,
        sharpeRatio: res.metrics.sharpeRatio,
        totalReturnPct: res.metrics.totalReturnPct,
        maxDrawdownPct: res.metrics.maxDrawdownPct,
        winRatePct: res.metrics.winRatePct,
        totalTrades: res.metrics.totalTrades,
        netProfit: res.metrics.netProfit,
      };
      cells.push(cell);

      if (
        cell.totalTrades >= 2 &&
        (!bestCell || cell.sharpeRatio > bestCell.sharpeRatio)
      ) {
        bestCell = cell;
      }
    }
  }

  if (!bestCell && cells.length > 0) {
    bestCell = [...cells].sort((a, b) => b.totalReturnPct - a.totalReturnPct)[0];
  }

  return {
    paramXKey: pX.key,
    paramXLabel: pX.label,
    paramXValues,
    paramYKey: pY.key,
    paramYLabel: pY.label,
    paramYValues,
    cells,
    bestCell,
  };
}
