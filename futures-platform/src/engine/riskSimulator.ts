import { getContractBySymbol } from "../data/contracts";
import { LiveOrder, LivePosition, PositionSide, RiskRuleConfig } from "../types/futures";
import { calcCommission, calcRequiredMargin } from "./backtester";

export interface AccountSummary {
  initialBalance: number;
  cashBalance: number;
  unrealizedPnl: number;
  realizedPnl: number;
  dynamicEquity: number;
  marginUsed: number;
  availableFunds: number;
  marginUtilizationPct: number;
  riskDegreeLevel: "安全" | "预警" | "高危" | "强平触发";
  dailyPnlPct: number;
}

export function computeAccountSummary(
  initialBalance: number,
  cashBalance: number,
  realizedPnl: number,
  positions: LivePosition[],
  riskRules: RiskRuleConfig
): AccountSummary {
  let unrealizedPnl = 0;
  let marginUsed = 0;

  for (const pos of positions) {
    unrealizedPnl += pos.unrealizedPnl;
    marginUsed += pos.marginUsed;
  }

  const dynamicEquity = cashBalance + unrealizedPnl;
  const availableFunds = dynamicEquity - marginUsed;
  const marginUtilizationPct = dynamicEquity > 0 ? (marginUsed / dynamicEquity) * 100 : 100;
  const dailyPnlPct = initialBalance > 0 ? ((dynamicEquity - initialBalance) / initialBalance) * 100 : 0;

  let riskDegreeLevel: AccountSummary["riskDegreeLevel"] = "安全";
  if (marginUtilizationPct >= riskRules.autoForceCloseMarginPct) {
    riskDegreeLevel = "强平触发";
  } else if (
    marginUtilizationPct >= riskRules.maxMarginUtilizationPct ||
    dailyPnlPct <= -riskRules.maxDailyLossPct
  ) {
    riskDegreeLevel = "高危";
  } else if (marginUtilizationPct >= riskRules.maxMarginUtilizationPct * 0.7) {
    riskDegreeLevel = "预警";
  }

  return {
    initialBalance,
    cashBalance,
    unrealizedPnl,
    realizedPnl,
    dynamicEquity,
    marginUsed,
    availableFunds,
    marginUtilizationPct,
    riskDegreeLevel,
    dailyPnlPct,
  };
}

export function markPositionsToMarket(
  positions: LivePosition[],
  quotes: Record<string, number>
): LivePosition[] {
  return positions.map((pos) => {
    const contract = getContractBySymbol(pos.symbol);
    const lastPrice = quotes[pos.symbol] ?? pos.lastPrice;
    const diff = pos.side === "LONG" ? lastPrice - pos.avgEntryPrice : pos.avgEntryPrice - lastPrice;
    const unrealizedPnl = diff * contract.multiplier * pos.lots;
    const marginUsed = calcRequiredMargin(contract, lastPrice, pos.lots);
    const returnOnMarginPct = marginUsed > 0 ? (unrealizedPnl / marginUsed) * 100 : 0;

    return {
      ...pos,
      lastPrice,
      marginUsed,
      unrealizedPnl,
      returnOnMarginPct,
    };
  });
}

export interface OrderValidationResult {
  allowed: boolean;
  reason?: string;
}

export function validateNewOrder(
  symbol: string,
  _side: PositionSide,
  lots: number,
  price: number,
  summary: AccountSummary,
  riskRules: RiskRuleConfig
): OrderValidationResult {
  if (lots <= 0 || !Number.isInteger(lots)) {
    return { allowed: false, reason: "下单手数必须为正整数" };
  }

  if (riskRules.circuitBreakerActive && summary.dailyPnlPct <= -riskRules.maxDailyLossPct) {
    return {
      allowed: false,
      reason: `触发单日最大亏损熔断阈值 (-${riskRules.maxDailyLossPct}%)，禁止新开仓`,
    };
  }

  if (lots > riskRules.maxSingleOrderLots) {
    return {
      allowed: false,
      reason: `超过单笔最大手数限制 (${riskRules.maxSingleOrderLots}手)`,
    };
  }

  const contract = getContractBySymbol(symbol);
  const newMargin = calcRequiredMargin(contract, price, lots);
  const newComm = calcCommission(contract, price, lots);

  if (newMargin + newComm > summary.availableFunds) {
    return {
      allowed: false,
      reason: `可用资金不足（需 ¥${(newMargin + newComm).toFixed(0)}，可用 ¥${summary.availableFunds.toFixed(0)}）`,
    };
  }

  const postMarginUtil =
    summary.dynamicEquity > 0
      ? ((summary.marginUsed + newMargin) / summary.dynamicEquity) * 100
      : 100;

  if (postMarginUtil > riskRules.maxMarginUtilizationPct) {
    return {
      allowed: false,
      reason: `开仓后保证金占用率 (${postMarginUtil.toFixed(1)}%) 超过风控上限 (${riskRules.maxMarginUtilizationPct}%)`,
    };
  }

  return { allowed: true };
}

export function createInitialSeedPositions(quotes: Record<string, number>): {
  positions: LivePosition[];
  orders: LiveOrder[];
} {
  const rbQuote = quotes["RB2610"] ?? 3480;
  const auQuote = quotes["AU2612"] ?? 618.5;
  const ifQuote = quotes["IF2612"] ?? 4120.0;

  const rbContract = getContractBySymbol("RB2610");
  const auContract = getContractBySymbol("AU2612");
  const ifContract = getContractBySymbol("IF2612");

  const rbEntry = rbQuote - 26;
  const auEntry = Number((auQuote - 3.4).toFixed(2));
  const ifEntry = Number((ifQuote + 18.4).toFixed(1));

  const rawPositions: LivePosition[] = [
    {
      id: "POS-101",
      symbol: "RB2610",
      name: rbContract.name,
      side: "LONG",
      lots: 8,
      avgEntryPrice: rbEntry,
      lastPrice: rbQuote,
      multiplier: rbContract.multiplier,
      marginUsed: calcRequiredMargin(rbContract, rbQuote, 8),
      unrealizedPnl: (rbQuote - rbEntry) * rbContract.multiplier * 8,
      returnOnMarginPct: 0,
      stopLossPrice: Math.round(rbEntry * 0.98),
      takeProfitPrice: Math.round(rbEntry * 1.04),
      strategyTag: "双均线趋势系统",
      openedAt: "09:15:08",
    },
    {
      id: "POS-102",
      symbol: "AU2612",
      name: auContract.name,
      side: "LONG",
      lots: 2,
      avgEntryPrice: auEntry,
      lastPrice: auQuote,
      multiplier: auContract.multiplier,
      marginUsed: calcRequiredMargin(auContract, auQuote, 2),
      unrealizedPnl: (auQuote - auEntry) * auContract.multiplier * 2,
      returnOnMarginPct: 0,
      stopLossPrice: Number((auEntry * 0.985).toFixed(2)),
      takeProfitPrice: Number((auEntry * 1.035).toFixed(2)),
      strategyTag: "海龟唐奇安突破",
      openedAt: "09:42:19",
    },
    {
      id: "POS-103",
      symbol: "IF2612",
      name: ifContract.name,
      side: "SHORT",
      lots: 1,
      avgEntryPrice: ifEntry,
      lastPrice: ifQuote,
      multiplier: ifContract.multiplier,
      marginUsed: calcRequiredMargin(ifContract, ifQuote, 1),
      unrealizedPnl: (ifEntry - ifQuote) * ifContract.multiplier * 1,
      returnOnMarginPct: 0,
      stopLossPrice: Number((ifEntry * 1.02).toFixed(1)),
      takeProfitPrice: Number((ifEntry * 0.965).toFixed(1)),
      strategyTag: "R-Breaker 枢轴反转",
      openedAt: "10:18:45",
    },
  ];

  const positions = markPositionsToMarket(rawPositions, quotes);

  const orders: LiveOrder[] = [
    {
      id: "ORD-8003",
      time: "10:18:45",
      symbol: "IF2612",
      side: "SHORT",
      offset: "OPEN",
      lots: 1,
      price: ifEntry,
      status: "FILLED",
      source: "R-Breaker 自动托管",
      commission: calcCommission(ifContract, ifEntry, 1),
    },
    {
      id: "ORD-8002",
      time: "09:42:19",
      symbol: "AU2612",
      side: "LONG",
      offset: "OPEN",
      lots: 2,
      price: auEntry,
      status: "FILLED",
      source: "海龟唐奇安突破",
      commission: calcCommission(auContract, auEntry, 2),
    },
    {
      id: "ORD-8001",
      time: "09:15:08",
      symbol: "RB2610",
      side: "LONG",
      offset: "OPEN",
      lots: 8,
      price: rbEntry,
      status: "FILLED",
      source: "双均线趋势系统",
      commission: calcCommission(rbContract, rbEntry, 8),
    },
  ];

  return { positions, orders };
}
