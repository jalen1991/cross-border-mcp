import { Candle } from "../types/futures";

export function calcSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

export function calcEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let ema = sum / period;
  result[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

export function calcATR(candles: Candle[], period: number): (number | null)[] {
  const n = candles.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (period <= 0 || n < period + 1) return result;

  const tr: number[] = new Array(n).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const hl = candles[i].high - candles[i].low;
    const hc = Math.abs(candles[i].high - candles[i - 1].close);
    const lc = Math.abs(candles[i].low - candles[i - 1].close);
    tr[i] = Math.max(hl, hc, lc);
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += tr[i];
  }
  let atr = sum / period;
  result[period] = atr;

  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = atr;
  }
  return result;
}

export function calcRSI(closes: number[], period: number): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (period <= 0 || n <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function calcBollingerBands(
  closes: number[],
  period: number,
  stdDevMult: number
): {
  middle: (number | null)[];
  upper: (number | null)[];
  lower: (number | null)[];
} {
  const n = closes.length;
  const middle = calcSMA(closes, period);
  const upper: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      sqSum += diff * diff;
    }
    const std = Math.sqrt(sqSum / period);
    upper[i] = mean + stdDevMult * std;
    lower[i] = mean - stdDevMult * std;
  }

  return { middle, upper, lower };
}

export function calcDonchianChannels(
  candles: Candle[],
  entryPeriod: number,
  exitPeriod: number
): {
  entryHigh: (number | null)[];
  entryLow: (number | null)[];
  exitHigh: (number | null)[];
  exitLow: (number | null)[];
} {
  const n = candles.length;
  const entryHigh: (number | null)[] = new Array(n).fill(null);
  const entryLow: (number | null)[] = new Array(n).fill(null);
  const exitHigh: (number | null)[] = new Array(n).fill(null);
  const exitLow: (number | null)[] = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (i >= entryPeriod) {
      let maxH = -Infinity;
      let minL = Infinity;
      // Prior N bars (excluding current bar to avoid look-ahead bias)
      for (let j = i - entryPeriod; j < i; j++) {
        if (candles[j].high > maxH) maxH = candles[j].high;
        if (candles[j].low < minL) minL = candles[j].low;
      }
      entryHigh[i] = maxH;
      entryLow[i] = minL;
    }
    if (i >= exitPeriod) {
      let maxH = -Infinity;
      let minL = Infinity;
      for (let j = i - exitPeriod; j < i; j++) {
        if (candles[j].high > maxH) maxH = candles[j].high;
        if (candles[j].low < minL) minL = candles[j].low;
      }
      exitHigh[i] = maxH;
      exitLow[i] = minL;
    }
  }

  return { entryHigh, entryLow, exitHigh, exitLow };
}

export function calcMACD(
  closes: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
} {
  const n = closes.length;
  const fastEma = calcEMA(closes, fastPeriod);
  const slowEma = calcEMA(closes, slowPeriod);
  const macd: (number | null)[] = new Array(n).fill(null);
  const signal: (number | null)[] = new Array(n).fill(null);
  const histogram: (number | null)[] = new Array(n).fill(null);

  const validMacdValues: number[] = [];
  const validIndices: number[] = [];

  for (let i = 0; i < n; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      const m = (fastEma[i] as number) - (slowEma[i] as number);
      macd[i] = m;
      validMacdValues.push(m);
      validIndices.push(i);
    }
  }

  if (validMacdValues.length >= signalPeriod) {
    const sigEma = calcEMA(validMacdValues, signalPeriod);
    for (let k = 0; k < sigEma.length; k++) {
      const s = sigEma[k];
      if (s !== null) {
        const origIdx = validIndices[k];
        signal[origIdx] = s;
        histogram[origIdx] = (macd[origIdx] as number) - s;
      }
    }
  }

  return { macd, signal, histogram };
}
