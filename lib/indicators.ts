import { Kline } from './binance'

export function sma(closes: number[], period: number): number[] {
  const result: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    const sum = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    result.push(sum / period)
  }
  return result
}

export function ema(closes: number[], period: number): number[] {
  const result: number[] = []
  const k = 2 / (period + 1)
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { result.push(NaN); continue }
    if (i === period - 1) {
      result.push(closes.slice(0, period).reduce((a, b) => a + b, 0) / period)
      continue
    }
    result.push(closes[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

export function rsi(closes: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(NaN)
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) avgGain += diff
    else avgLoss += Math.abs(diff)
  }
  avgGain /= period
  avgLoss /= period
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss))
  }
  return result
}

export function closes(klines: Kline[]): number[] {
  return klines.map((k) => k.close)
}

// True Range & ATR
export function atr(klines: Kline[], period: number): number[] {
  const tr: number[] = [NaN]
  for (let i = 1; i < klines.length; i++) {
    const hl  = klines[i].high - klines[i].low
    const hpc = Math.abs(klines[i].high - klines[i - 1].close)
    const lpc = Math.abs(klines[i].low  - klines[i - 1].close)
    tr.push(Math.max(hl, hpc, lpc))
  }
  // Wilder's smoothing
  const result: number[] = new Array(period).fill(NaN)
  let sum = 0
  for (let i = 1; i <= period; i++) sum += tr[i]
  result.push(sum / period)
  for (let i = period + 1; i < klines.length; i++) {
    result.push((result[result.length - 1] * (period - 1) + tr[i]) / period)
  }
  return result
}

// SuperTrend — returns { trend[], direction[] }
// direction: 1 = uptrend (buy), -1 = downtrend (sell)
export function supertrend(
  klines: Kline[],
  period = 10,
  multiplier = 3.0,
): { trend: number[]; direction: number[] } {
  const atrVals = atr(klines, period)
  const trend: number[] = new Array(klines.length).fill(NaN)
  const direction: number[] = new Array(klines.length).fill(1)

  let upperBand = NaN, lowerBand = NaN

  for (let i = period; i < klines.length; i++) {
    const hl2   = (klines[i].high + klines[i].low) / 2
    const rawUp = hl2 + multiplier * atrVals[i]
    const rawLo = hl2 - multiplier * atrVals[i]

    // tighten bands
    const prevUp = isNaN(upperBand) ? rawUp : upperBand
    const prevLo = isNaN(lowerBand) ? rawLo : lowerBand
    upperBand = rawUp < prevUp || klines[i - 1].close > prevUp ? rawUp : prevUp
    lowerBand = rawLo > prevLo || klines[i - 1].close < prevLo ? rawLo : prevLo

    const prevDir = direction[i - 1]
    if (prevDir === -1 && klines[i].close > upperBand) {
      direction[i] = 1
    } else if (prevDir === 1 && klines[i].close < lowerBand) {
      direction[i] = -1
    } else {
      direction[i] = prevDir
    }

    trend[i] = direction[i] === 1 ? lowerBand : upperBand
  }
  return { trend, direction }
}

// Bollinger Bands
export function bollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2.0,
): { mid: number[]; upper: number[]; lower: number[] } {
  const mid   = sma(closes, period)
  const upper = mid.map((m, i) => {
    if (isNaN(m)) return NaN
    const slice = closes.slice(Math.max(0, i - period + 1), i + 1)
    const variance = slice.reduce((s, v) => s + (v - m) ** 2, 0) / slice.length
    return m + stdDev * Math.sqrt(variance)
  })
  const lower = mid.map((m, i) => {
    if (isNaN(m)) return NaN
    const slice = closes.slice(Math.max(0, i - period + 1), i + 1)
    const variance = slice.reduce((s, v) => s + (v - m) ** 2, 0) / slice.length
    return m - stdDev * Math.sqrt(variance)
  })
  return { mid, upper, lower }
}

// MACD — returns { macd, signal, histogram }
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const fastEmaArr = ema(closes, fastPeriod)
  const slowEmaArr = ema(closes, slowPeriod)

  const macdLine: number[] = closes.map((_, i) =>
    isNaN(fastEmaArr[i]) || isNaN(slowEmaArr[i]) ? NaN : fastEmaArr[i] - slowEmaArr[i]
  )

  const signalArr: number[] = new Array(closes.length).fill(NaN)
  const histArr: number[] = new Array(closes.length).fill(NaN)

  const startIdx = macdLine.findIndex(v => !isNaN(v))
  if (startIdx < 0) return { macd: macdLine, signal: signalArr, histogram: histArr }

  const validMacd = macdLine.slice(startIdx)
  const signalComputed = ema(validMacd, signalPeriod)

  for (let i = 0; i < signalComputed.length; i++) {
    signalArr[startIdx + i] = signalComputed[i]
    if (!isNaN(signalComputed[i])) {
      histArr[startIdx + i] = validMacd[i] - signalComputed[i]
    }
  }

  return { macd: macdLine, signal: signalArr, histogram: histArr }
}

// VWAP (cumulative, resets each "session" — we use a rolling window for backtesting)
export function vwap(klines: Kline[], window = 0): number[] {
  // window=0 → cumulative from start; window>0 → rolling window
  const result: number[] = []
  let cumTP  = 0, cumVol = 0
  for (let i = 0; i < klines.length; i++) {
    const tp = (klines[i].high + klines[i].low + klines[i].close) / 3
    if (window > 0 && i >= window) {
      const old = (klines[i - window].high + klines[i - window].low + klines[i - window].close) / 3
      cumTP  -= old  * klines[i - window].volume
      cumVol -= klines[i - window].volume
    }
    cumTP  += tp * klines[i].volume
    cumVol += klines[i].volume
    result.push(cumVol > 0 ? cumTP / cumVol : tp)
  }
  return result
}
