import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines, Interval } from '@/lib/binance'
import {
  bollingerBands, rsi as calcRsi, vwap as calcVwap,
  ema, sma, supertrend as calcSupertrend, macd as calcMacd, closes as getCloses,
} from '@/lib/indicators'

function fp(n: number): string {
  if (!n || isNaN(n)) return '–'
  if (n >= 10000) return n.toFixed(0)
  if (n >= 1000) return n.toFixed(1)
  if (n >= 100) return n.toFixed(2)
  return n.toFixed(3)
}

interface CondItem { label: string; threshold: string; current: string; met: boolean }
interface StrategyResult { conditions: CondItem[]; signal: 'buy' | 'sell' | 'hold' }

// ─── Crypto Pulse ────────────────────────────────────────────────────────────
function computeVwapBbRsi(klines: Awaited<ReturnType<typeof fetchKlines>>, c: number[], price: number, inPosition: boolean): StrategyResult {
  const n = klines.length
  const bb = bollingerBands(c, 20, 2)
  const rsiVals = calcRsi(c, 14)
  const vwapVals = calcVwap(klines, 24)
  const rsiVal = rsiVals[n - 1]
  const bbLower = bb.lower[n - 1]
  const bbUpper = bb.upper[n - 1]
  const vwapVal = vwapVals[n - 1]

  if (!inPosition) {
    const rsiOk = rsiVal < 35
    const bbOk = price < bbLower
    const vwapOk = price < vwapVal
    return {
      conditions: [
        { label: 'RSI', threshold: '<35', current: rsiVal.toFixed(1), met: rsiOk },
        { label: 'BB下軌', threshold: `<$${fp(bbLower)}`, current: `$${fp(price)}`, met: bbOk },
        { label: 'VWAP', threshold: `<$${fp(vwapVal)}`, current: `$${fp(price)}`, met: vwapOk },
      ],
      signal: (rsiOk || bbOk) && vwapOk ? 'buy' : 'hold',
    }
  } else {
    const rsiOk = rsiVal > 65
    const bbOk = price > bbUpper
    const vwapOk = price > vwapVal
    return {
      conditions: [
        { label: 'RSI', threshold: '>65', current: rsiVal.toFixed(1), met: rsiOk },
        { label: 'BB上軌', threshold: `>$${fp(bbUpper)}`, current: `$${fp(price)}`, met: bbOk },
        { label: 'VWAP', threshold: `>$${fp(vwapVal)}`, current: `$${fp(price)}`, met: vwapOk },
      ],
      signal: (rsiOk || bbOk) && vwapOk ? 'sell' : 'hold',
    }
  }
}

// ─── MA Cross ────────────────────────────────────────────────────────────────
function computeMaCross(c: number[], price: number, inPosition: boolean): StrategyResult {
  const fast = 10, slow = 30
  const fastArr = sma(c, fast)
  const slowArr = sma(c, slow)
  const n = c.length
  const fastVal = fastArr[n - 1]
  const slowVal = slowArr[n - 1]
  const fastAboveSlow = fastVal > slowVal

  if (!inPosition) {
    return {
      conditions: [
        { label: `快MA(${fast})`, threshold: `>慢MA(${slow})`, current: `$${fp(fastVal)}`, met: fastAboveSlow },
        { label: `慢MA(${slow})`, threshold: '參考值', current: `$${fp(slowVal)}`, met: true },
      ],
      signal: fastAboveSlow ? 'buy' : 'hold',
    }
  } else {
    const fastBelowSlow = fastVal < slowVal
    return {
      conditions: [
        { label: `快MA(${fast})`, threshold: `<慢MA(${slow})`, current: `$${fp(fastVal)}`, met: fastBelowSlow },
        { label: `慢MA(${slow})`, threshold: '參考值', current: `$${fp(slowVal)}`, met: true },
      ],
      signal: fastBelowSlow ? 'sell' : 'hold',
    }
  }
}

// ─── RSI ─────────────────────────────────────────────────────────────────────
function computeRsiStrategy(c: number[], inPosition: boolean): StrategyResult {
  const rsiVals = calcRsi(c, 14)
  const rsiVal = rsiVals[c.length - 1]

  if (!inPosition) {
    const met = rsiVal < 30
    return {
      conditions: [{ label: 'RSI(14)', threshold: '<30 超賣', current: rsiVal.toFixed(1), met }],
      signal: met ? 'buy' : 'hold',
    }
  } else {
    const met = rsiVal > 70
    return {
      conditions: [{ label: 'RSI(14)', threshold: '>70 超買', current: rsiVal.toFixed(1), met }],
      signal: met ? 'sell' : 'hold',
    }
  }
}

// ─── SuperTrend ───────────────────────────────────────────────────────────────
function computeSupertrend(klines: Awaited<ReturnType<typeof fetchKlines>>, c: number[], price: number, inPosition: boolean): StrategyResult {
  const n = klines.length
  const st = calcSupertrend(klines, 10, 3)
  const ema200Arr = ema(c, 200)
  const dir = st.direction[n - 1]
  const ema200Val = ema200Arr[n - 1]
  const isBullish = dir === 1
  const aboveEma200 = price > ema200Val

  if (!inPosition) {
    return {
      conditions: [
        { label: 'SuperTrend方向', threshold: '多頭(↑)', current: isBullish ? '多頭' : '空頭', met: isBullish },
        { label: 'EMA200', threshold: `>$${fp(ema200Val)}`, current: `$${fp(price)}`, met: aboveEma200 },
      ],
      signal: isBullish && aboveEma200 ? 'buy' : 'hold',
    }
  } else {
    const isBearish = dir === -1
    return {
      conditions: [
        { label: 'SuperTrend方向', threshold: '空頭(↓)', current: isBearish ? '空頭' : '多頭', met: isBearish },
      ],
      signal: isBearish ? 'sell' : 'hold',
    }
  }
}

// ─── EMA Ribbon + SuperTrend ─────────────────────────────────────────────────
function computeEmaRibbonSt(klines: Awaited<ReturnType<typeof fetchKlines>>, c: number[], price: number, inPosition: boolean): StrategyResult {
  const n = klines.length
  const st = calcSupertrend(klines, 14, 2.5)
  const fastArr = ema(c, 5)
  const slowArr = ema(c, 34)
  const ema200Arr = ema(c, 200)
  const dir = st.direction[n - 1]
  const fastVal = fastArr[n - 1]
  const slowVal = slowArr[n - 1]
  const ema200Val = ema200Arr[n - 1]
  const stBullish = dir === 1
  const fastAboveSlow = fastVal > slowVal
  const aboveEma200 = price > ema200Val

  if (!inPosition) {
    return {
      conditions: [
        { label: 'SuperTrend', threshold: '多頭(↑)', current: stBullish ? '多頭' : '空頭', met: stBullish },
        { label: `EMA5 > EMA34`, threshold: `>$${fp(slowVal)}`, current: `$${fp(fastVal)}`, met: fastAboveSlow },
        { label: 'EMA200', threshold: `>$${fp(ema200Val)}`, current: `$${fp(price)}`, met: aboveEma200 },
      ],
      signal: stBullish && fastAboveSlow && aboveEma200 ? 'buy' : 'hold',
    }
  } else {
    const stBearish = dir === -1
    const fastBelowMid = fastVal < ema(c, 13)[n - 1]
    return {
      conditions: [
        { label: 'SuperTrend', threshold: '空頭(↓)', current: stBearish ? '空頭' : '多頭', met: stBearish },
        { label: 'EMA5 < EMA13', threshold: `<$${fp(ema(c, 13)[n - 1])}`, current: `$${fp(fastVal)}`, met: fastBelowMid },
      ],
      signal: stBearish || fastBelowMid ? 'sell' : 'hold',
    }
  }
}

// ─── MACD + BB Squeeze ────────────────────────────────────────────────────────
function computeMacdBbSqueeze(klines: Awaited<ReturnType<typeof fetchKlines>>, c: number[], price: number, inPosition: boolean): StrategyResult {
  const n = klines.length
  const macdResult = calcMacd(c, 12, 26, 9)
  const bb = bollingerBands(c, 20, 2)
  const rsiVals = calcRsi(c, 14)
  const ema200Arr = ema(c, 200)

  const hist = macdResult.histogram[n - 1]
  const rsiVal = rsiVals[n - 1]
  const ema200Val = ema200Arr[n - 1]

  // BB bandwidth vs 40-bar average
  const bandwidths = bb.upper.map((u, i) => isNaN(u) || isNaN(bb.lower[i]) ? NaN : u - bb.lower[i])
  const recentBws = bandwidths.slice(Math.max(0, n - 40)).filter(v => !isNaN(v))
  const avgBw = recentBws.reduce((a, b) => a + b, 0) / (recentBws.length || 1)
  const curBw = bandwidths[n - 1]
  const inSqueeze = curBw <= avgBw

  if (!inPosition) {
    const histPositive = hist > 0
    const rsiOk = rsiVal >= 35 && rsiVal <= 70
    const aboveEma200 = price > ema200Val
    return {
      conditions: [
        { label: 'MACD Histogram', threshold: '>0', current: hist.toFixed(2), met: histPositive },
        { label: 'BB壓縮', threshold: '帶寬≤40棒均值', current: inSqueeze ? '壓縮中' : '擴張中', met: inSqueeze },
        { label: 'RSI(14)', threshold: '35~70', current: rsiVal.toFixed(1), met: rsiOk },
        { label: 'EMA200', threshold: `>$${fp(ema200Val)}`, current: `$${fp(price)}`, met: aboveEma200 },
      ],
      signal: histPositive && inSqueeze && rsiOk && aboveEma200 ? 'buy' : 'hold',
    }
  } else {
    const histNegative = hist < 0
    return {
      conditions: [
        { label: 'MACD Histogram', threshold: '<0', current: hist.toFixed(2), met: histNegative },
      ],
      signal: histNegative ? 'sell' : 'hold',
    }
  }
}

// ─── Grid ─────────────────────────────────────────────────────────────────────
function computeGrid(price: number): StrategyResult {
  return {
    conditions: [
      { label: '網格策略', threshold: '依設定區間', current: `現價 $${fp(price)}`, met: true },
    ],
    signal: 'hold',
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const symbol = searchParams.get('symbol') || 'BTCUSDT'
  const interval = (searchParams.get('interval') || '4h') as Interval
  const strategy = searchParams.get('strategy') || 'vwap_bb_rsi'
  const inPosition = searchParams.get('inPosition') === 'true'

  try {
    const klines = await fetchKlines(symbol, interval, 300)
    const c = getCloses(klines)
    const price = c[c.length - 1]

    let result: StrategyResult
    switch (strategy) {
      case 'vwap_bb_rsi':   result = computeVwapBbRsi(klines, c, price, inPosition); break
      case 'ma_cross':      result = computeMaCross(c, price, inPosition); break
      case 'rsi':           result = computeRsiStrategy(c, inPosition); break
      case 'supertrend':    result = computeSupertrend(klines, c, price, inPosition); break
      case 'ema_ribbon_st': result = computeEmaRibbonSt(klines, c, price, inPosition); break
      case 'macd_bb_squeeze': result = computeMacdBbSqueeze(klines, c, price, inPosition); break
      case 'grid':          result = computeGrid(price); break
      default:              result = computeVwapBbRsi(klines, c, price, inPosition)
    }

    // VWAP price level (only for vwap_bb_rsi)
    let vwapLevel: number | undefined
    if (strategy === 'vwap_bb_rsi') {
      const vwapVals = calcVwap(klines, 24)
      vwapLevel = vwapVals[klines.length - 1]
    }

    return NextResponse.json({ price, signal: result.signal, conditions: result.conditions, vwapLevel })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
