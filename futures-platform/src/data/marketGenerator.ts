import { Candle, FuturesContract, Timeframe } from "../types/futures";
import { roundToTick } from "./contracts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

function formatTimestamp(ts: number, timeframe: Timeframe): string {
  const d = new Date(ts);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  if (timeframe === "1d") {
    return `${yyyy}-${mm}-${dd}`;
  }
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Generates deterministic multi-regime futures OHLCV + Open Interest candles.
 * Incorporates trend regimes, mean-reverting consolidations, and volatility clustering
 * so that both trend-following and mean-reversion strategies encounter realistic market structure.
 */
export function generateMarketCandles(
  contract: FuturesContract,
  timeframe: Timeframe,
  barCount = 360,
  seedOffset = 0
): Candle[] {
  const seed = hashString(`${contract.symbol}_${timeframe}_${seedOffset}`);
  const rng = mulberry32(seed);

  const tfScale = Math.sqrt(TIMEFRAME_MINUTES[timeframe] / 1440);
  const baseVol = contract.volatility * tfScale;
  const stepMs = TIMEFRAME_MINUTES[timeframe] * 60 * 1000;
  const endTs = Date.UTC(2026, 10, 11, 7, 0, 0);
  let currentTs = endTs - barCount * stepMs;

  const candles: Candle[] = [];
  let price = contract.basePrice * (0.94 + rng() * 0.08);
  let openInterest = Math.round(120000 + rng() * 180000);
  let currentVol = baseVol;

  // Multi-regime cycle parameters
  let regimeRemaining = 0;
  let regimeDrift = contract.trendBias * tfScale;
  let regimeVolMult = 1.0;

  for (let i = 0; i < barCount; i++) {
    if (regimeRemaining <= 0) {
      regimeRemaining = Math.floor(28 + rng() * 55);
      const r = rng();
      if (r < 0.36) {
        // Bull trend regime
        regimeDrift = (0.0018 + rng() * 0.0024) * tfScale;
        regimeVolMult = 0.95 + rng() * 0.35;
      } else if (r < 0.68) {
        // Bear trend regime
        regimeDrift = -(0.0016 + rng() * 0.0023) * tfScale;
        regimeVolMult = 1.05 + rng() * 0.45;
      } else {
        // Sideways / mean-reverting range regime
        regimeDrift = (rng() - 0.5) * 0.0004 * tfScale;
        regimeVolMult = 0.72 + rng() * 0.25;
      }
    }
    regimeRemaining--;

    // GARCH-like volatility clustering
    const z = gaussian(rng);
    currentVol = 0.85 * currentVol + 0.15 * baseVol * regimeVolMult * (0.6 + 0.5 * Math.abs(z));

    const openRaw = price;
    const ret = regimeDrift + currentVol * z;
    const closeRaw = Math.max(contract.tickSize * 20, openRaw * (1 + ret));

    const intraSpread = Math.abs(closeRaw - openRaw) + openRaw * currentVol * (0.35 + rng() * 0.85);
    const upperWick = intraSpread * (0.2 + rng() * 0.55);
    const lowerWick = intraSpread * (0.2 + rng() * 0.55);

    const highRaw = Math.max(openRaw, closeRaw) + upperWick;
    const lowRaw = Math.max(contract.tickSize * 10, Math.min(openRaw, closeRaw) - lowerWick);

    const open = roundToTick(openRaw, contract.tickSize);
    const close = roundToTick(closeRaw, contract.tickSize);
    const high = roundToTick(Math.max(open, close, highRaw), contract.tickSize);
    const low = roundToTick(Math.min(open, close, lowRaw), contract.tickSize);

    const moveIntensity = Math.abs(ret) / Math.max(baseVol, 1e-6);
    const volume = Math.max(
      500,
      Math.round((32000 + rng() * 45000) * (0.65 + 0.85 * moveIntensity) * tfScale * 2.2)
    );
    openInterest = Math.max(
      25000,
      Math.round(openInterest + (rng() - 0.485) * volume * 0.12)
    );

    candles.push({
      timestamp: currentTs,
      timeStr: formatTimestamp(currentTs, timeframe),
      open,
      high,
      low,
      close,
      volume,
      openInterest,
    });

    price = close;
    currentTs += stepMs;
  }

  return candles;
}

export function getBarsPerYear(timeframe: Timeframe): number {
  switch (timeframe) {
    case "15m":
      return 245 * 16;
    case "1h":
      return 245 * 6;
    case "4h":
      return 245 * 2;
    case "1d":
      return 245;
  }
}
