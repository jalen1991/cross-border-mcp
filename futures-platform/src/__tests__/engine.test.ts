import { describe, expect, it } from "vitest";
import { FUTURES_CONTRACTS, getContractBySymbol, roundToTick } from "../data/contracts";
import { generateMarketCandles } from "../data/marketGenerator";
import {
  calcCommission,
  calcRequiredMargin,
  compareStrategies,
  runBacktest,
  runParameterOptimization,
  SAMPLE_HOLDOUT_RATIO,
} from "../engine/backtester";
import { calcATR, calcBollingerBands, calcEMA, calcRSI, calcSMA } from "../engine/indicators";
import {
  computeAccountSummary,
  markPositionsToMarket,
  validateNewOrder,
} from "../engine/riskSimulator";
import { getDefaultParams, STRATEGY_DEFINITIONS } from "../engine/strategies";
import { BacktestConfig, Candle, RiskRuleConfig } from "../types/futures";

describe("Futures Quantitative Engine & Backtester", () => {
  it("generates deterministic OHLCV candles respecting contract tickSize and OHLC invariants", () => {
    const rb = getContractBySymbol("RB2610");
    const c1 = generateMarketCandles(rb, "1h", 150);
    const c2 = generateMarketCandles(rb, "1h", 150);

    expect(c1).toHaveLength(150);
    expect(c1).toEqual(c2);

    for (const bar of c1) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      expect(bar.volume).toBeGreaterThan(0);
      expect(bar.openInterest).toBeGreaterThan(0);
      expect(roundToTick(bar.close, rb.tickSize)).toBe(bar.close);
    }
  });

  it("computes technical indicators accurately without NaN propagation", () => {
    const rb = getContractBySymbol("AU2612");
    const candles = generateMarketCandles(rb, "1d", 80);
    const closes = candles.map((c) => c.close);

    const sma10 = calcSMA(closes, 10);
    const ema10 = calcEMA(closes, 10);
    const rsi14 = calcRSI(closes, 14);
    const atr14 = calcATR(candles, 14);
    const boll = calcBollingerBands(closes, 20, 2);

    expect(sma10[8]).toBeNull();
    expect(sma10[9]).not.toBeNull();
    expect(ema10[9]).toBeCloseTo(sma10[9] as number, 6);

    for (let i = 20; i < closes.length; i++) {
      expect(rsi14[i]).toBeGreaterThanOrEqual(0);
      expect(rsi14[i]).toBeLessThanOrEqual(100);
      expect(atr14[i]).toBeGreaterThan(0);
      expect(boll.upper[i]!).toBeGreaterThanOrEqual(boll.middle[i]!);
      expect(boll.lower[i]!).toBeLessThanOrEqual(boll.middle[i]!);
    }
  });

  it("runs all 6 strategies across futures contracts with consistent equity accounting", () => {
    for (const strat of STRATEGY_DEFINITIONS) {
      const cfg: BacktestConfig = {
        symbol: FUTURES_CONTRACTS[0].symbol,
        timeframe: "1h",
        strategyId: strat.id,
        params: getDefaultParams(strat.id),
        initialCapital: 1_000_000,
        positionSizingMode: "RISK_PCT",
        fixedLots: 5,
        riskPctPerTrade: 2,
        slippageTicks: 1,
        stopLossPct: 2.5,
        takeProfitPct: 6.0,
        barCount: 300,
      };

      const res = runBacktest(cfg);
      expect(res.equityCurve).toHaveLength(300);
      expect(Number.isFinite(res.metrics.finalEquity)).toBe(true);
      expect(Number.isFinite(res.metrics.sharpeRatio)).toBe(true);
      expect(res.metrics.maxDrawdownPct).toBeGreaterThanOrEqual(0);

      // Final position is closed on last bar so sum of netPnl equals finalEquity - initialCapital
      const sumTradeNetPnl = res.trades.reduce((acc, t) => acc + t.netPnl, 0);
      expect(res.metrics.netProfit).toBeCloseTo(sumTradeNetPnl, 4);
    }
  });

  it("runs 2D parameter grid optimization and identifies valid best Sharpe cell", () => {
    const cfg: BacktestConfig = {
      symbol: "IF2612",
      timeframe: "1h",
      strategyId: "dual_ma",
      params: getDefaultParams("dual_ma"),
      initialCapital: 1_000_000,
      positionSizingMode: "FIXED_LOTS",
      fixedLots: 2,
      riskPctPerTrade: 2,
      slippageTicks: 1,
      stopLossPct: 0,
      takeProfitPct: 0,
      barCount: 240,
    };

    const grid = runParameterOptimization(cfg, 4);
    expect(grid.cells.length).toBeGreaterThan(0);
    expect(grid.bestCell).not.toBeNull();
    // Ensure fastPeriod < slowPeriod constraint respected
    for (const cell of grid.cells) {
      expect(cell.paramX).toBeLessThan(cell.paramY);
    }
  });

  it("enforces margin, single-order lot limit, and circuit breaker rules in paper-trading simulator", () => {
    const contract = getContractBySymbol("CU2611"); // Copper: 5 tons/lot
    const margin = calcRequiredMargin(contract, 76000, 2);
    expect(margin).toBe(76000 * 5 * 2 * 0.1);

    const comm = calcCommission(contract, 76000, 2);
    expect(comm).toBeCloseTo(76000 * 5 * 2 * 0.00005, 4);

    const rules: RiskRuleConfig = {
      maxMarginUtilizationPct: 60,
      maxDailyLossPct: 5,
      maxSingleOrderLots: 10,
      autoForceCloseMarginPct: 95,
      circuitBreakerActive: true,
    };

    const marked = markPositionsToMarket(
      [
        {
          id: "P1",
          symbol: "CU2611",
          name: contract.name,
          side: "LONG",
          lots: 2,
          avgEntryPrice: 75000,
          lastPrice: 75000,
          multiplier: contract.multiplier,
          marginUsed: 0,
          unrealizedPnl: 0,
          returnOnMarginPct: 0,
          stopLossPrice: null,
          takeProfitPrice: null,
          strategyTag: "test",
          openedAt: "09:00:00",
        },
      ],
      { CU2611: 76000 }
    );

    expect(marked[0].unrealizedPnl).toBe((76000 - 75000) * 5 * 2);

    const summary = computeAccountSummary(500_000, 500_000, 0, marked, rules);
    expect(summary.dynamicEquity).toBe(510_000);

    // Exceeds single order lots
    const tooManyLots = validateNewOrder("CU2611", "LONG", 15, 76000, summary, rules);
    expect(tooManyLots.allowed).toBe(false);

    // Exceeds margin utilization limit
    const overMargin = validateNewOrder("CU2611", "LONG", 8, 76000, summary, rules);
    expect(overMargin.allowed).toBe(false);

    // Reasonable 1-lot order passes
    const validOrder = validateNewOrder("CU2611", "LONG", 1, 76000, summary, rules);
    expect(validOrder.allowed).toBe(true);
  });

  it("splits every backtest into a 70/30 in-sample and out-of-sample window", () => {
    const cfg: BacktestConfig = {
      symbol: "RB2610",
      timeframe: "1h",
      strategyId: "dual_ma",
      params: getDefaultParams("dual_ma"),
      initialCapital: 1_000_000,
      positionSizingMode: "FIXED_LOTS",
      fixedLots: 2,
      riskPctPerTrade: 2,
      slippageTicks: 1,
      stopLossPct: 0,
      takeProfitPct: 0,
      barCount: 200,
    };
    const result = runBacktest(cfg);
    expect(result.splitIndex).toBe(Math.floor(200 * (1 - SAMPLE_HOLDOUT_RATIO)));
    expect(result.inSample.endIndex).toBe(result.splitIndex - 1);
    expect(result.outOfSample.startIndex).toBe(result.splitIndex);
    expect(result.inSample.totalTrades + result.outOfSample.totalTrades).toBe(result.metrics.totalTrades);
    expect(result.outOfSample.endEquity).toBeCloseTo(result.metrics.finalEquity, 4);
  });

  it("ranks all six strategies on one shared candle path", () => {
    const cfg: BacktestConfig = {
      symbol: "AU2612",
      timeframe: "1h",
      strategyId: "turtle_donchian",
      params: getDefaultParams("turtle_donchian"),
      initialCapital: 1_000_000,
      positionSizingMode: "FIXED_LOTS",
      fixedLots: 1,
      riskPctPerTrade: 2,
      slippageTicks: 1,
      stopLossPct: 2,
      takeProfitPct: 0,
      trailingAtrMult: 1.5,
      barCount: 180,
    };
    const scores = compareStrategies(cfg);
    expect(scores).toHaveLength(STRATEGY_DEFINITIONS.length);
    const traded = (score: (typeof scores)[number]) => (score.outOfSampleTrades >= 2 ? 1 : 0);
    for (let i = 1; i < scores.length; i++) {
      const prev = scores[i - 1];
      const curr = scores[i];
      if (traded(prev) === traded(curr)) {
        expect(prev.outOfSampleSharpe).toBeGreaterThanOrEqual(curr.outOfSampleSharpe);
      } else {
        expect(traded(prev)).toBeGreaterThan(traded(curr));
      }
    }
  });

  it("closes a long trend with the ATR trailing stop when price reverses", () => {
    const contract = getContractBySymbol("RB2610");
    const candles: Candle[] = [];
    let price = 3600;
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 90; i++) {
      const ret = i === 85 ? -0.12 : i < 25 ? -0.002 : 0.006;
      const open = price;
      const close = roundToTick(price * (1 + ret), contract.tickSize);
      candles.push({
        timestamp: start + i * 3600_000,
        timeStr: `2026-01-${String((i % 28) + 1).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00`,
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
        volume: 10000,
        openInterest: 80000,
      });
      price = close;
    }

    const result = runBacktest(
      {
        symbol: "RB2610",
        timeframe: "1h",
        strategyId: "dual_ma",
        params: { fastPeriod: 4, slowPeriod: 12 },
        initialCapital: 1_000_000,
        positionSizingMode: "FIXED_LOTS",
        fixedLots: 1,
        riskPctPerTrade: 2,
        slippageTicks: 0,
        stopLossPct: 0,
        takeProfitPct: 0,
        trailingAtrMult: 1,
        barCount: candles.length,
      },
      candles
    );

    expect(result.trades.some((trade) => trade.exitReason.includes("ATR 跟踪止损"))).toBe(true);
  });
});
