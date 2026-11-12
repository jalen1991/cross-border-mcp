import { Candle, StrategyDefinition, StrategyId } from "../types/futures";
import {
  calcATR,
  calcBollingerBands,
  calcDonchianChannels,
  calcEMA,
  calcMACD,
  calcRSI,
  calcSMA,
} from "./indicators";

export const STRATEGY_DEFINITIONS: StrategyDefinition[] = [
  {
    id: "dual_ma",
    name: "双均线趋势系统 (Dual EMA Crossover)",
    category: "趋势跟踪",
    description:
      "经典CTA趋势跟踪策略：快线EMA上穿慢线EMA且价格站稳趋势过滤线时做多，下穿做空。适合螺纹钢、沪铜、原油等趋势性强的商品期货。",
    formulaSummary: "EMA(Fast) 上穿 EMA(Slow) -> 多头开仓/反手；EMA(Fast) 下穿 EMA(Slow) -> 空头开仓/反手",
    params: [
      {
        key: "fastPeriod",
        label: "快线周期 (Fast EMA)",
        min: 5,
        max: 40,
        step: 1,
        defaultValue: 10,
        description: "短期指数移动平均线周期",
      },
      {
        key: "slowPeriod",
        label: "慢线周期 (Slow EMA)",
        min: 20,
        max: 120,
        step: 5,
        defaultValue: 35,
        description: "长期指数移动平均线周期",
      },
    ],
  },
  {
    id: "turtle_donchian",
    name: "海龟唐奇安通道突破 (Turtle Donchian)",
    category: "趋势跟踪",
    description:
      "源自理查德·丹尼斯海龟交易法则：突破过去N根K线最高价入场做多，跌破过去M根K线最低价止盈离场；反向突破N周期最低价入场做空。",
    formulaSummary: "Close > Highest(High, N)[t-1] 做多；Close < Lowest(Low, M)[t-1] 平多 (空头对称)",
    params: [
      {
        key: "entryPeriod",
        label: "突破入场周期 (Entry N)",
        min: 10,
        max: 60,
        step: 2,
        defaultValue: 20,
        description: "唐奇安入场通道回溯周期",
      },
      {
        key: "exitPeriod",
        label: "离场保护周期 (Exit M)",
        min: 5,
        max: 30,
        step: 1,
        defaultValue: 10,
        description: "唐奇安离场通道回溯周期",
      },
    ],
  },
  {
    id: "bollinger_reversion",
    name: "布林带均值回归 (Bollinger Mean Reversion)",
    category: "均值回归",
    description:
      "在震荡区间行情中捕捉价格过度偏离后的回归：收盘跌破下轨超卖后收回做多，突破中轨/上轨平仓；触及上轨过热后回落做空。",
    formulaSummary: "Close < LowerBand(N, k) 抄底做多，回归 MiddleBand 止盈；Close > UpperBand(N, k) 摸顶做空",
    params: [
      {
        key: "period",
        label: "布林周期 (BB Period)",
        min: 10,
        max: 50,
        step: 2,
        defaultValue: 22,
        description: "布林中轨移动平均周期",
      },
      {
        key: "stdDev",
        label: "标准差倍数 (StdDev k)",
        min: 1.4,
        max: 3.2,
        step: 0.2,
        defaultValue: 2.0,
        description: "上下轨标准差宽度系数",
      },
    ],
  },
  {
    id: "macd_trend",
    name: "MACD 柱状动能共振 (MACD Momentum)",
    category: "动量波动",
    description:
      "结合 DIF/DEA 金叉死叉与长期均线多空过滤：仅在长期均线上方执行金叉做多，在长期均线下方执行死叉做空，减少震荡期假信号。",
    formulaSummary: "DIF 上穿 DEA 且 Close > SMA(Trend) 开多；DIF 下穿 DEA 平仓/反手",
    params: [
      {
        key: "fastPeriod",
        label: "快线周期 (Fast)",
        min: 6,
        max: 24,
        step: 2,
        defaultValue: 12,
        description: "MACD短期EMA参数",
      },
      {
        key: "slowPeriod",
        label: "慢线周期 (Slow)",
        min: 18,
        max: 52,
        step: 2,
        defaultValue: 26,
        description: "MACD长期EMA参数",
      },
      {
        key: "signalPeriod",
        label: "信号线周期 (DEA)",
        min: 5,
        max: 18,
        step: 1,
        defaultValue: 9,
        description: "DEA平滑周期",
      },
    ],
  },
  {
    id: "r_breaker",
    name: "R-Breaker 枢轴反转突破 (Pivot R-Breaker)",
    category: "日内突破",
    description:
      "曾连续多年蝉联《Futures Truth》十大交易系统：利用前周期滚动高低收构建观察价、反转价与突破价六档防线，兼顾趋势突破与假突破反转。",
    formulaSummary: "突破 Bbreak 顺势追多；触及 Ssetup 后跌破 Senter 反手做空；反之亦然",
    params: [
      {
        key: "lookback",
        label: "枢轴回溯窗口 (Lookback)",
        min: 6,
        max: 36,
        step: 2,
        defaultValue: 16,
        description: "计算枢轴高低收的滚动周期数",
      },
      {
        key: "breakFactor",
        label: "突破放大系数 (Break k)",
        min: 0.15,
        max: 0.65,
        step: 0.05,
        defaultValue: 0.35,
        description: "控制突破上轨与下轨距离的敏感系数",
      },
    ],
  },
  {
    id: "rsi_atr_momentum",
    name: "RSI + ATR 波动率自适应突破",
    category: "动量波动",
    description:
      "结合相对强弱指标与真实波幅ATR通道：当RSI进入强势区且价格突破均线+k倍ATR通道时顺势入场，利用波动率扩张捕捉主升/主跌浪。",
    formulaSummary: "RSI > 55 且 Close > EMA + k*ATR 开多；RSI < 45 且 Close < EMA - k*ATR 开空",
    params: [
      {
        key: "rsiPeriod",
        label: "RSI 周期",
        min: 7,
        max: 28,
        step: 1,
        defaultValue: 14,
        description: "相对强弱指标计算周期",
      },
      {
        key: "atrMult",
        label: "ATR 通道倍数",
        min: 0.8,
        max: 3.0,
        step: 0.2,
        defaultValue: 1.4,
        description: "ATR突破带宽乘数",
      },
    ],
  },
];

export function getStrategyDefinition(id: StrategyId): StrategyDefinition {
  return STRATEGY_DEFINITIONS.find((s) => s.id === id) ?? STRATEGY_DEFINITIONS[0];
}

export function getDefaultParams(id: StrategyId): Record<string, number> {
  const def = getStrategyDefinition(id);
  const out: Record<string, number> = {};
  for (const p of def.params) {
    out[p.key] = p.defaultValue;
  }
  return out;
}

export interface StrategySignalOutput {
  /** Target position after bar i: 1 = LONG, -1 = SHORT, 0 = FLAT */
  desiredPosition: number[];
  reasons: string[];
  indicators: Record<string, (number | null)[]>;
}

export function evaluateStrategySignals(
  strategyId: StrategyId,
  candles: Candle[],
  params: Record<string, number>
): StrategySignalOutput {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const desiredPosition = new Array<number>(n).fill(0);
  const reasons = new Array<string>(n).fill("");
  const indicators: Record<string, (number | null)[]> = {};

  if (strategyId === "dual_ma") {
    const fastP = Math.max(2, Math.round(params.fastPeriod ?? 10));
    const slowP = Math.max(fastP + 2, Math.round(params.slowPeriod ?? 35));
    const emaFast = calcEMA(closes, fastP);
    const emaSlow = calcEMA(closes, slowP);
    indicators[`EMA(${fastP})`] = emaFast;
    indicators[`EMA(${slowP})`] = emaSlow;

    let pos = 0;
    for (let i = 1; i < n; i++) {
      const fPrev = emaFast[i - 1];
      const sPrev = emaSlow[i - 1];
      const fCurr = emaFast[i];
      const sCurr = emaSlow[i];
      if (fPrev !== null && sPrev !== null && fCurr !== null && sCurr !== null) {
        if (fPrev <= sPrev && fCurr > sCurr) {
          pos = 1;
          reasons[i] = `EMA(${fastP}) 上穿 EMA(${slowP}) 金叉做多`;
        } else if (fPrev >= sPrev && fCurr < sCurr) {
          pos = -1;
          reasons[i] = `EMA(${fastP}) 下穿 EMA(${slowP}) 死叉做空`;
        }
      }
      desiredPosition[i] = pos;
    }
    return { desiredPosition, reasons, indicators };
  }

  if (strategyId === "turtle_donchian") {
    const entryP = Math.max(5, Math.round(params.entryPeriod ?? 20));
    const exitP = Math.max(3, Math.min(entryP - 1, Math.round(params.exitPeriod ?? 10)));
    const { entryHigh, entryLow, exitHigh, exitLow } = calcDonchianChannels(candles, entryP, exitP);
    indicators[`上轨(${entryP})`] = entryHigh;
    indicators[`下轨(${entryP})`] = entryLow;

    let pos = 0;
    for (let i = 1; i < n; i++) {
      const eh = entryHigh[i];
      const el = entryLow[i];
      const xh = exitHigh[i];
      const xl = exitLow[i];
      const c = closes[i];

      if (pos === 1 && xl !== null && c < xl) {
        pos = 0;
        reasons[i] = `跌破${exitP}周期保护低点止盈平多`;
      } else if (pos === -1 && xh !== null && c > xh) {
        pos = 0;
        reasons[i] = `突破${exitP}周期保护高点止盈平空`;
      }

      if (pos <= 0 && eh !== null && c > eh) {
        pos = 1;
        reasons[i] = `突破${entryP}周期唐奇安上轨追多`;
      } else if (pos >= 0 && el !== null && c < el) {
        pos = -1;
        reasons[i] = `跌破${entryP}周期唐奇安下轨追空`;
      }

      desiredPosition[i] = pos;
    }
    return { desiredPosition, reasons, indicators };
  }

  if (strategyId === "bollinger_reversion") {
    const period = Math.max(5, Math.round(params.period ?? 22));
    const stdDev = Number(params.stdDev ?? 2.0);
    const { middle, upper, lower } = calcBollingerBands(closes, period, stdDev);
    indicators[`BOLL上轨`] = upper;
    indicators[`BOLL中轨`] = middle;
    indicators[`BOLL下轨`] = lower;

    let pos = 0;
    for (let i = 1; i < n; i++) {
      const m = middle[i];
      const u = upper[i];
      const l = lower[i];
      const c = closes[i];
      if (m === null || u === null || l === null) continue;

      if (pos === 1 && c >= m) {
        pos = 0;
        reasons[i] = "价格回归布林中轨平多止盈";
      } else if (pos === -1 && c <= m) {
        pos = 0;
        reasons[i] = "价格回归布林中轨平空止盈";
      }

      if (pos === 0) {
        if (c < l) {
          pos = 1;
          reasons[i] = `跌破布林下轨(${stdDev}σ)超卖均值回归做多`;
        } else if (c > u) {
          pos = -1;
          reasons[i] = `突破布林上轨(${stdDev}σ)超买均值回归做空`;
        }
      }

      desiredPosition[i] = pos;
    }
    return { desiredPosition, reasons, indicators };
  }

  if (strategyId === "macd_trend") {
    const fastP = Math.max(4, Math.round(params.fastPeriod ?? 12));
    const slowP = Math.max(fastP + 4, Math.round(params.slowPeriod ?? 26));
    const sigP = Math.max(3, Math.round(params.signalPeriod ?? 9));
    const { macd, signal } = calcMACD(closes, fastP, slowP, sigP);
    const trendMa = calcSMA(closes, slowP * 2);
    indicators[`SMA(${slowP * 2})`] = trendMa;

    let pos = 0;
    for (let i = 1; i < n; i++) {
      const mPrev = macd[i - 1];
      const sPrev = signal[i - 1];
      const mCurr = macd[i];
      const sCurr = signal[i];
      const tMa = trendMa[i];
      if (mPrev === null || sPrev === null || mCurr === null || sCurr === null) continue;

      const crossUp = mPrev <= sPrev && mCurr > sCurr;
      const crossDown = mPrev >= sPrev && mCurr < sCurr;

      if (pos === 1 && crossDown) {
        if (tMa !== null && closes[i] < tMa) {
          pos = -1;
          reasons[i] = "MACD死叉且位于趋势均线下方，反手做空";
        } else {
          pos = 0;
          reasons[i] = "MACD死叉平多观望";
        }
      } else if (pos === -1 && crossUp) {
        if (tMa !== null && closes[i] > tMa) {
          pos = 1;
          reasons[i] = "MACD金叉且位于趋势均线上方，反手做多";
        } else {
          pos = 0;
          reasons[i] = "MACD金叉平空观望";
        }
      } else if (pos === 0) {
        if (crossUp && (tMa === null || closes[i] >= tMa)) {
          pos = 1;
          reasons[i] = "MACD金叉共振开多";
        } else if (crossDown && (tMa === null || closes[i] <= tMa)) {
          pos = -1;
          reasons[i] = "MACD死叉共振开空";
        }
      }

      desiredPosition[i] = pos;
    }
    return { desiredPosition, reasons, indicators };
  }

  if (strategyId === "r_breaker") {
    const lookback = Math.max(4, Math.round(params.lookback ?? 16));
    const breakFactor = Number(params.breakFactor ?? 0.35);

    const bBreakArr: (number | null)[] = new Array(n).fill(null);
    const sBreakArr: (number | null)[] = new Array(n).fill(null);

    let pos = 0;
    for (let i = lookback; i < n; i++) {
      let highPrev = -Infinity;
      let lowPrev = Infinity;
      for (let j = i - lookback; j < i; j++) {
        if (candles[j].high > highPrev) highPrev = candles[j].high;
        if (candles[j].low < lowPrev) lowPrev = candles[j].low;
      }
      const closePrev = candles[i - 1].close;

      const sSetup = highPrev + breakFactor * (closePrev - lowPrev);
      const bSetup = lowPrev - breakFactor * (highPrev - closePrev);
      const sEnter = ((1 + 0.07) / 2) * (highPrev + lowPrev) - 0.07 * lowPrev;
      const bEnter = ((1 + 0.07) / 2) * (highPrev + lowPrev) - 0.07 * highPrev;
      const bBreak = sSetup + breakFactor * (sSetup - bSetup);
      const sBreak = bSetup - breakFactor * (sSetup - bSetup);

      bBreakArr[i] = bBreak;
      sBreakArr[i] = sBreak;

      const c = candles[i].close;
      const h = candles[i].high;
      const l = candles[i].low;

      if (pos === 0) {
        if (c > bBreak) {
          pos = 1;
          reasons[i] = "价格向上突破 R-Breaker 多头突破线追多";
        } else if (c < sBreak) {
          pos = -1;
          reasons[i] = "价格向下跌破 R-Breaker 空头突破线追空";
        }
      } else if (pos === 1) {
        if (h > sSetup && c < sEnter) {
          pos = -1;
          reasons[i] = "触及观察上轨后跌破反转线，R-Breaker 多翻空";
        } else if (c < sBreak) {
          pos = -1;
          reasons[i] = "跌破空头突破线止损反手";
        }
      } else if (pos === -1) {
        if (l < bSetup && c > bEnter) {
          pos = 1;
          reasons[i] = "触及观察下轨后收复反转线，R-Breaker 空翻多";
        } else if (c > bBreak) {
          pos = 1;
          reasons[i] = "突破多头突破线止损反手";
        }
      }

      desiredPosition[i] = pos;
    }

    indicators["R-Breaker多突"] = bBreakArr;
    indicators["R-Breaker空突"] = sBreakArr;
    return { desiredPosition, reasons, indicators };
  }

  // rsi_atr_momentum
  const rsiP = Math.max(4, Math.round(params.rsiPeriod ?? 14));
  const atrMult = Number(params.atrMult ?? 1.4);
  const emaBase = calcEMA(closes, rsiP * 2);
  const atr = calcATR(candles, rsiP);
  const rsi = calcRSI(closes, rsiP);

  const upperBand: (number | null)[] = new Array(n).fill(null);
  const lowerBand: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (emaBase[i] !== null && atr[i] !== null) {
      upperBand[i] = (emaBase[i] as number) + atrMult * (atr[i] as number);
      lowerBand[i] = (emaBase[i] as number) - atrMult * (atr[i] as number);
    }
  }
  indicators["ATR上轨"] = upperBand;
  indicators["EMA中轴"] = emaBase;
  indicators["ATR下轨"] = lowerBand;

  let pos = 0;
  for (let i = 1; i < n; i++) {
    const r = rsi[i];
    const u = upperBand[i];
    const l = lowerBand[i];
    const m = emaBase[i];
    const c = closes[i];
    if (r === null || u === null || l === null || m === null) continue;

    if (pos === 1 && (c < m || r < 45)) {
      pos = 0;
      reasons[i] = "跌破EMA中轴或RSI动量衰减平多";
    } else if (pos === -1 && (c > m || r > 55)) {
      pos = 0;
      reasons[i] = "收复EMA中轴或RSI动量反弹平空";
    }

    if (pos === 0) {
      if (r > 55 && c > u) {
        pos = 1;
        reasons[i] = `RSI(${r.toFixed(1)})强势且突破ATR波动上轨做多`;
      } else if (r < 45 && c < l) {
        pos = -1;
        reasons[i] = `RSI(${r.toFixed(1)})弱势且跌破ATR波动下轨做空`;
      }
    }

    desiredPosition[i] = pos;
  }

  return { desiredPosition, reasons, indicators };
}
