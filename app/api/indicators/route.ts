import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines, Interval } from '@/lib/binance'
import {
  bollingerBands, rsi as calcRsi, vwap as calcVwap,
  ema, sma, supertrend as calcSupertrend, macd as calcMacd, closes as getCloses,
} from '@/lib/indicators'
import { getDb } from '@/lib/db'
import { getSlStreak } from '@/lib/engine'

const DYN_TP_MULT = 3.5
const BINANCE_FEE = 0.001

function fp(n: number): string {
  if (!n || isNaN(n)) return '–'
  if (n >= 10000) return n.toFixed(0)
  if (n >= 1000) return n.toFixed(1)
  if (n >= 100) return n.toFixed(2)
  return n.toFixed(3)
}

interface CondItem { label: string; threshold: string; current: string; met: boolean }
interface StrategyResult { conditions: CondItem[]; signal: 'buy' | 'sell' | 'hold'; targetPrice?: number }

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
    // price needs to drop below BOTH bbLower AND vwapVal to satisfy price-based conditions
    return {
      conditions: [
        { label: 'RSI', threshold: '<35', current: rsiVal.toFixed(1), met: rsiOk },
        { label: 'BB下軌', threshold: `<$${fp(bbLower)}`, current: `$${fp(price)}`, met: bbOk },
        { label: 'VWAP', threshold: `<$${fp(vwapVal)}`, current: `$${fp(price)}`, met: vwapOk },
      ],
      signal: (rsiOk || bbOk) && vwapOk ? 'buy' : 'hold',
      targetPrice: Math.min(bbLower, vwapVal),
    }
  } else {
    const rsiOk = rsiVal > 65
    const bbOk = price > bbUpper
    const vwapOk = price > vwapVal
    // price needs to rise above BOTH bbUpper AND vwapVal to satisfy price-based conditions
    return {
      conditions: [
        { label: 'RSI', threshold: '>65', current: rsiVal.toFixed(1), met: rsiOk },
        { label: 'BB上軌', threshold: `>$${fp(bbUpper)}`, current: `$${fp(price)}`, met: bbOk },
        { label: 'VWAP', threshold: `>$${fp(vwapVal)}`, current: `$${fp(price)}`, met: vwapOk },
      ],
      signal: (rsiOk || bbOk) && vwapOk ? 'sell' : 'hold',
      targetPrice: Math.max(bbUpper, vwapVal),
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
      targetPrice: ema200Val,
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

// ─── SuperTrend + MACD ────────────────────────────────────────────────────────
// 讀該幣實際在跑的策略參數；查不到（該幣沒有啟用中的策略）則回空物件走預設值
function loadStrategyParams(symbol: string, type: string): Record<string, unknown> {
  try {
    const row = getDb().prepare(
      `SELECT params FROM strategies WHERE symbol = ? AND type = ? AND is_active = 1 LIMIT 1`
    ).get(symbol, type) as { params: string } | undefined
    return row ? JSON.parse(row.params) : {}
  } catch {
    return {}
  }
}

// 條件與 lib/engine.ts supertrendMacdSignal 對齊：只用已收盤 K 棒，
// 且進出場條件是「方向翻轉事件」而非「當前方向」
function computeSupertrendMacd(
  klines: Awaited<ReturnType<typeof fetchKlines>>,
  c: number[],
  inPosition: boolean,
  p: Record<string, unknown>,
): StrategyResult {
  const st = calcSupertrend(klines, (p.atrPeriod as number) ?? 14, (p.multiplier as number) ?? 3.0)
  const ema200Arr = ema(c, 200)
  const macdResult = calcMacd(
    c, (p.macdFast as number) ?? 12, (p.macdSlow as number) ?? 26, (p.macdSignal as number) ?? 9
  )

  // 最後一根 K 棒仍在形成中，引擎不會拿它判斷 → 一律看倒數第二根（最後已收盤棒）
  const i = klines.length - 2
  const dir = st.direction[i]
  const closePrice = c[i]
  const ema200Val = ema200Arr[i]
  const hist = macdResult.histogram[i]

  // 目前方向已持續幾根棒（=1 代表這根剛翻轉）
  let flipIdx = i
  while (flipIdx > 0 && st.direction[flipIdx - 1] === dir) flipIdx--
  const barsInDir = i - flipIdx + 1
  const dirLabel = dir === 1 ? '多頭' : '空頭'

  if (!inPosition) {
    const flipUp = st.direction[i - 1] === -1 && dir === 1
    const macdPos = !isNaN(hist) && hist > 0
    const useEma200 = p.ema200Filter !== false && !isNaN(ema200Val)
    const aboveEma200 = closePrice > ema200Val

    const conditions: CondItem[] = [
      {
        label: 'SuperTrend 翻多',
        threshold: '本棒由空翻多',
        current: flipUp ? '剛翻多' : `${dirLabel}已 ${barsInDir} 棒`,
        met: flipUp,
      },
      { label: 'MACD Histogram', threshold: '>0', current: isNaN(hist) ? '–' : hist.toFixed(2), met: macdPos },
    ]
    if (useEma200) {
      conditions.push({
        label: 'EMA200', threshold: `>$${fp(ema200Val)}`, current: `$${fp(closePrice)}`, met: aboveEma200,
      })
    }
    return {
      conditions,
      signal: flipUp && macdPos && (!useEma200 || aboveEma200) ? 'buy' : 'hold',
      targetPrice: ema200Val,
    }
  } else {
    const flipDown = st.direction[i - 1] === 1 && dir === -1
    return {
      conditions: [
        {
          label: 'SuperTrend 翻空',
          threshold: '本棒由多翻空',
          current: flipDown ? '剛翻空' : `${dirLabel}已 ${barsInDir} 棒`,
          met: flipDown,
        },
      ],
      signal: flipDown ? 'sell' : 'hold',
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
      targetPrice: ema200Val,
    }
  } else {
    const stBearish = dir === -1
    const ema13Val = ema(c, 13)[n - 1]
    const fastBelowMid = fastVal < ema13Val
    return {
      conditions: [
        { label: 'SuperTrend', threshold: '空頭(↓)', current: stBearish ? '空頭' : '多頭', met: stBearish },
        { label: 'EMA5 < EMA13', threshold: `<$${fp(ema13Val)}`, current: `$${fp(fastVal)}`, met: fastBelowMid },
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
      targetPrice: ema200Val,
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
      case 'supertrend':      result = computeSupertrend(klines, c, price, inPosition); break
      case 'supertrend_macd': result = computeSupertrendMacd(klines, c, inPosition, loadStrategyParams(symbol, strategy)); break
      case 'ema_ribbon_st':   result = computeEmaRibbonSt(klines, c, price, inPosition); break
      case 'macd_bb_squeeze': result = computeMacdBbSqueeze(klines, c, price, inPosition); break
      case 'grid':          result = computeGrid(price); break
      default:              result = computeVwapBbRsi(klines, c, price, inPosition)
    }

    // Dynamic TP condition: append when in position and sl_streak has a recorded max loss
    // (trend strategies are exempt from dynamic TP — mirror lib/engine.ts isTrendType)
    const isTrendType = strategy === 'supertrend' || strategy === 'supertrend_macd'
    if (inPosition && !isTrendType) {
      try {
        const db = getDb()
        const stratRow = db.prepare(
          `SELECT s.id FROM strategies s
           LEFT JOIN positions p ON p.strategy_id = s.id
           WHERE s.symbol = ? AND s.type = ? AND p.symbol = ?
           LIMIT 1`
        ).get(symbol, strategy, symbol) as { id: number } | undefined

        if (stratRow) {
          const maxSl = getSlStreak(db, stratRow.id)
          if (maxSl > 0) {
            const dynTpThreshold = maxSl * DYN_TP_MULT
            const posRow = db.prepare(
              `SELECT entry_price, quantity FROM positions WHERE strategy_id = ? LIMIT 1`
            ).get(stratRow.id) as { entry_price: number; quantity: number } | undefined

            const currentPnl = posRow
              ? posRow.quantity * (price * (1 - BINANCE_FEE) - posRow.entry_price * (1 + BINANCE_FEE))
              : NaN

            const met = !isNaN(currentPnl) && currentPnl >= dynTpThreshold
            result.conditions.push({
              label: '動態止盈',
              threshold: `+$${dynTpThreshold.toFixed(2)} (最大SL×${DYN_TP_MULT})`,
              current: isNaN(currentPnl) ? '–' : `${currentPnl >= 0 ? '+' : ''}$${currentPnl.toFixed(2)}`,
              met,
            })
          }
        }
      } catch { /* db query optional — don't fail the whole response */ }
    }

    // VWAP price level (only for vwap_bb_rsi)
    let vwapLevel: number | undefined
    if (strategy === 'vwap_bb_rsi') {
      const vwapVals = calcVwap(klines, 24)
      vwapLevel = vwapVals[klines.length - 1]
    }

    return NextResponse.json({ price, signal: result.signal, conditions: result.conditions, vwapLevel, targetPrice: result.targetPrice })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
