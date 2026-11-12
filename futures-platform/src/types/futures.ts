export type Timeframe = "15m" | "1h" | "4h" | "1d";

export type MarketSector = "贵金属" | "股指期货" | "黑色建材" | "能源化工" | "有色金属" | "农产品";

export interface FuturesContract {
  symbol: string;
  name: string;
  exchange: "SHFE" | "CFFEX" | "DCE" | "CZCE" | "INE" | "CME";
  sector: MarketSector;
  currency: "CNY" | "USD";
  multiplier: number; // 合约乘数 (如 1手=10吨)
  tickSize: number; // 最小变动价位
  marginRate: number; // 保证金比例 (如 0.10 = 10%)
  commissionRate: number; // 手续费率 (成交额比例)
  commissionFixed: number; // 固定每手手续费
  basePrice: number; // 基准价格
  volatility: number; // 日化波动率特征
  trendBias: number; // 趋势漂移特征
  unit: string; // 报价单位 (如 元/吨, 元/克, 点)
}

export interface Candle {
  timestamp: number;
  timeStr: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number;
}

export type StrategyId =
  | "dual_ma"
  | "turtle_donchian"
  | "bollinger_reversion"
  | "macd_trend"
  | "r_breaker"
  | "rsi_atr_momentum";

export interface StrategyParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  description: string;
}

export interface StrategyDefinition {
  id: StrategyId;
  name: string;
  category: "趋势跟踪" | "均值回归" | "日内突破" | "动量波动";
  description: string;
  formulaSummary: string;
  params: StrategyParamDef[];
}

export type PositionSide = "LONG" | "SHORT";

export interface SignalEvent {
  index: number;
  timestamp: number;
  timeStr: string;
  action: "OPEN_LONG" | "OPEN_SHORT" | "CLOSE_LONG" | "CLOSE_SHORT" | "REVERSE_TO_LONG" | "REVERSE_TO_SHORT";
  price: number;
  reason: string;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  side: PositionSide;
  lots: number;
  entryIndex: number;
  entryTime: string;
  entryPrice: number;
  exitIndex: number;
  exitTime: string;
  exitPrice: number;
  grossPnl: number;
  commission: number;
  slippageCost: number;
  netPnl: number;
  returnPct: number; // 相对占用保证金收益率
  holdingBars: number;
  entryReason: string;
  exitReason: string;
}

export interface EquityPoint {
  index: number;
  timeStr: string;
  price: number;
  equity: number;
  balance: number;
  unrealizedPnl: number;
  marginUsed: number;
  drawdownPct: number;
  positionSide: PositionSide | null;
  positionLots: number;
}

export interface BacktestConfig {
  symbol: string;
  timeframe: Timeframe;
  strategyId: StrategyId;
  params: Record<string, number>;
  initialCapital: number;
  positionSizingMode: "FIXED_LOTS" | "RISK_PCT";
  fixedLots: number;
  riskPctPerTrade: number; // 如 2 表示单笔最多承担净值 2% 风险或保证金占比
  slippageTicks: number; // 滑点跳数
  stopLossPct: number; // 止损百分比 (0 表示不启用硬止损)
  takeProfitPct: number; // 止盈百分比 (0 表示不启用硬止盈)
  barCount: number;
}

export interface BacktestMetrics {
  initialCapital: number;
  finalEquity: number;
  netProfit: number;
  totalReturnPct: number;
  annualizedReturnPct: number;
  maxDrawdownPct: number;
  maxDrawdownAmount: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  winRatePct: number;
  profitFactor: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;
  totalCommission: number;
  totalSlippage: number;
  maxMarginUtilizationPct: number;
  avgHoldingBars: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  contract: FuturesContract;
  candles: Candle[];
  indicators: Record<string, (number | null)[]>;
  signals: SignalEvent[];
  trades: TradeRecord[];
  equityCurve: EquityPoint[];
  monthlyReturns: { month: string; returnPct: number; profit: number }[];
  metrics: BacktestMetrics;
}

export interface OptimizationCell {
  paramX: number;
  paramY: number;
  sharpeRatio: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  totalTrades: number;
  netProfit: number;
}

export interface OptimizationGridResult {
  paramXKey: string;
  paramXLabel: string;
  paramXValues: number[];
  paramYKey: string;
  paramYLabel: string;
  paramYValues: number[];
  cells: OptimizationCell[];
  bestCell: OptimizationCell | null;
}

export interface LivePosition {
  id: string;
  symbol: string;
  name: string;
  side: PositionSide;
  lots: number;
  avgEntryPrice: number;
  lastPrice: number;
  multiplier: number;
  marginUsed: number;
  unrealizedPnl: number;
  returnOnMarginPct: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  strategyTag: string;
  openedAt: string;
}

export interface LiveOrder {
  id: string;
  time: string;
  symbol: string;
  side: PositionSide;
  offset: "OPEN" | "CLOSE";
  lots: number;
  price: number;
  status: "FILLED" | "WORKING" | "REJECTED";
  source: string;
  commission: number;
  realizedPnl?: number;
  note?: string;
}

export interface RiskRuleConfig {
  maxMarginUtilizationPct: number; // 最大保证金占用率阈值 (如 70%)
  maxDailyLossPct: number; // 单日最大亏损熔断比例 (如 5%)
  maxSingleOrderLots: number; // 单笔最大下单手数
  autoForceCloseMarginPct: number; // 强平线 (如 95%)
  circuitBreakerActive: boolean; // 熔断开关
}
