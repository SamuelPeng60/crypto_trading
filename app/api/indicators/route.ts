import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines, Interval } from '@/lib/binance'
import {
  bollingerBands, rsi as calcRsi, vwap as calcVwap,
  ema, sma, supertrend as calcSupertrend, macd as calcMacd, closes as getCloses,
  atr as calcAtr,
} from '@/lib/indicators'
import { getDb } from '@/lib/db'
import { getSlStreak } from '@/lib/engine'

const DYN_TP_MULT = 3.5
const BINANCE_FEE = 0.001

// ─── 與引擎對齊的共用工具 ─────────────────────────────────────────────────────
// 面板顯示的是「引擎在下一個 tick 會看到什麼」，因此三條規則貫穿本檔所有 compute*：
//   1. 一律用最後一根「已收盤」K 棒（i = klines.length - 2），= engine 的 confirmedKlines
//   2. 參數一律從 strategies.params 讀（loadStrategyParams），不寫死
//   3. 進出場條件要判斷「事件」（翻轉／穿越）而非「當前狀態」，否則面板會整片亮綠燈
//      但引擎一次都不下單（2026-08-28 SOL 就是這樣）

/** 目前方向已持續幾根棒。從 `period` 起算 —— supertrend() 在暖機區間把 direction 預填為 1，
 *  一路往回數會把那段填充值也算進去，長多頭時棒數會虛報。 */
function barsInDirection(direction: number[], i: number, period: number): number {
  const floor = Math.max(period, 1)
  let idx = i
  while (idx > floor && direction[idx - 1] === direction[i]) idx--
  return i - idx + 1
}

/** 已實現波動率，與 lib/engine.ts vwapBbRsiSignal 內的 rv() 同一實作 */
function realizedVol(c: number[], i: number, w: number): number {
  if (i < w) return NaN
  let sumSq = 0
  for (let j = i - w + 1; j <= i; j++) {
    if (j > 0) { const r = Math.log(c[j] / c[j - 1]); sumSq += r * r }
  }
  return Math.sqrt(sumSq / w)
}

interface PositionSnapshot { entry_price: number; quantity: number; trail_high: number | null; trail_sl: number | null }

/** 該幣目前啟用中策略的持倉（供移動止損 / 動態止盈顯示用） */
function loadPosition(symbol: string, type: string): PositionSnapshot | undefined {
  try {
    return getDb().prepare(
      `SELECT p.entry_price, p.quantity, p.trail_high, p.trail_sl
       FROM positions p JOIN strategies s ON s.id = p.strategy_id
       WHERE s.symbol = ? AND s.type = ? AND s.is_active = 1 LIMIT 1`
    ).get(symbol, type) as PositionSnapshot | undefined
  } catch {
    return undefined
  }
}

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
// 對齊 lib/engine.ts vwapBbRsiSignal()：
//   買入 = !inTrend && (RSI < oversold || 下穿 BB 下軌) && price < VWAP
//   賣出 = (RSI > overbought || 上穿 BB 上軌) && price > VWAP
//   trailAtrMult > 0 時引擎會壓制訊號出場（suppressSignalSell），改由 ATR 移動止損負責
function computeVwapBbRsi(
  klines: Awaited<ReturnType<typeof fetchKlines>>,
  c: number[],
  inPosition: boolean,
  p: Record<string, unknown>,
  symbol: string,
): StrategyResult {
  const rsiPeriod    = (p.rsiPeriod as number) ?? 14
  const oversold     = (p.rsiOversold as number) ?? 35
  const overbought   = (p.rsiOverbought as number) ?? 65
  const bbPeriod     = (p.bbPeriod as number) ?? 20
  const bbStdDev     = (p.bbStdDev as number) ?? 2
  const vwapWindow   = (p.vwapWindow as number) ?? 24
  const trailAtrMult = (p.trailAtrMult as number) ?? 0
  const atrSlMult    = (p.atrSlMultiplier as number) ?? 1
  const atrPeriod    = (p.atrPeriod as number) ?? 14
  const volShortW    = (p.volRegimeShort as number) ?? 20
  const volLongW     = (p.volRegimeLong as number) ?? 60
  const volThresh    = (p.volRegimeThreshold as number) ?? 1.3

  const bb       = bollingerBands(c, bbPeriod, bbStdDev)
  const rsiVals  = calcRsi(c, rsiPeriod)
  const vwapVals = calcVwap(klines, vwapWindow)

  const i = klines.length - 2          // 最後一根已收盤棒
  const price   = c[i]
  const rsiVal  = rsiVals[i]
  const bbLower = bb.lower[i], bbUpper = bb.upper[i]
  const vwapVal = vwapVals[i]

  if (!inPosition) {
    // 波動率過濾：短期波動遠高於長期時判定為趨勢行情，引擎會暫停進場
    const sv = realizedVol(c, i, volShortW), lv = realizedVol(c, i, volLongW)
    const ratio = !isNaN(sv) && !isNaN(lv) && lv > 0 ? sv / lv : NaN
    const notInTrend = isNaN(ratio) || ratio <= volThresh

    const rsiOk = rsiVal < oversold
    // 引擎要求「穿越」下軌，不是持續在軌下
    const bbCross = !isNaN(bb.lower[i - 1]) && c[i - 1] > bb.lower[i - 1] && price <= bbLower
    const vwapOk = price < vwapVal

    return {
      conditions: [
        { label: '波動率過濾', threshold: `短/長 ≤${volThresh}`, current: isNaN(ratio) ? '–' : ratio.toFixed(2), met: notInTrend },
        { label: 'RSI', threshold: `<${oversold}`, current: rsiVal.toFixed(1), met: rsiOk },
        { label: 'BB下軌', threshold: `本棒下穿 $${fp(bbLower)}`, current: bbCross ? '剛下穿' : `$${fp(price)}`, met: bbCross },
        { label: 'VWAP', threshold: `<$${fp(vwapVal)}`, current: `$${fp(price)}`, met: vwapOk },
      ],
      signal: notInTrend && (rsiOk || bbCross) && vwapOk ? 'buy' : 'hold',
      targetPrice: Math.min(bbLower, vwapVal),
    }
  }

  // ── 持倉中 ──
  if (trailAtrMult > 0) {
    // 引擎在此模式下不看 RSI/BB 出場，只靠 ATR 移動止損（SL 只升不降）
    const atrVals = calcAtr(klines.slice(0, -1), atrPeriod)
    const curAtr  = atrVals[atrVals.length - 1]
    const pos     = loadPosition(symbol, 'vwap_bb_rsi')
    const trailHigh = pos?.trail_high ?? price
    const entry     = pos?.entry_price ?? price
    const freshSl   = Math.max(entry - atrSlMult * curAtr, trailHigh - trailAtrMult * curAtr)
    const slPrice   = pos?.trail_sl != null ? Math.max(freshSl, pos.trail_sl) : freshSl
    const hit = price <= slPrice
    return {
      conditions: [
        { label: 'ATR 移動止損', threshold: `≤$${fp(slPrice)}`, current: `$${fp(price)}`, met: hit },
        { label: '追蹤最高價', threshold: `− ${trailAtrMult}×ATR`, current: `$${fp(trailHigh)}`, met: true },
        { label: '訊號出場', threshold: `trailAtrMult=${trailAtrMult} → 已停用`, current: '只靠移動止損', met: false },
      ],
      signal: hit ? 'sell' : 'hold',
      targetPrice: slPrice,
    }
  }

  const rsiOk = rsiVal > overbought
  const bbCross = !isNaN(bb.upper[i - 1]) && c[i - 1] < bb.upper[i - 1] && price >= bbUpper
  const vwapOk = price > vwapVal
  return {
    conditions: [
      { label: 'RSI', threshold: `>${overbought}`, current: rsiVal.toFixed(1), met: rsiOk },
      { label: 'BB上軌', threshold: `本棒上穿 $${fp(bbUpper)}`, current: bbCross ? '剛上穿' : `$${fp(price)}`, met: bbCross },
      { label: 'VWAP', threshold: `>$${fp(vwapVal)}`, current: `$${fp(price)}`, met: vwapOk },
    ],
    signal: (rsiOk || bbCross) && vwapOk ? 'sell' : 'hold',
    targetPrice: Math.max(bbUpper, vwapVal),
  }
}

// ─── MA Cross ────────────────────────────────────────────────────────────────
// 對齊 lib/engine.ts maCrossSignal()：買賣都是「交叉事件」，不是「誰在上面」
function computeMaCross(c: number[], inPosition: boolean, p: Record<string, unknown>): StrategyResult {
  const fastP = (p.fastPeriod as number) ?? 10
  const slowP = (p.slowPeriod as number) ?? 30
  const fn = p.maType === 'sma' ? sma : ema
  const fastArr = fn(c, fastP)
  const slowArr = fn(c, slowP)

  const i = c.length - 2
  const crossUp   = fastArr[i - 1] <= slowArr[i - 1] && fastArr[i] > slowArr[i]
  const crossDown = fastArr[i - 1] >= slowArr[i - 1] && fastArr[i] < slowArr[i]
  const side = fastArr[i] > slowArr[i] ? '快線在上' : '快線在下'

  if (!inPosition) {
    return {
      conditions: [
        { label: `快MA(${fastP}) 上穿慢MA(${slowP})`, threshold: '本棒發生黃金交叉',
          current: crossUp ? '剛上穿' : side, met: crossUp },
        { label: `慢MA(${slowP})`, threshold: '參考值', current: `$${fp(slowArr[i])}`, met: true },
      ],
      signal: crossUp ? 'buy' : 'hold',
      targetPrice: slowArr[i],
    }
  }
  return {
    conditions: [
      { label: `快MA(${fastP}) 下穿慢MA(${slowP})`, threshold: '本棒發生死亡交叉',
        current: crossDown ? '剛下穿' : side, met: crossDown },
      { label: `慢MA(${slowP})`, threshold: '參考值', current: `$${fp(slowArr[i])}`, met: true },
    ],
    signal: crossDown ? 'sell' : 'hold',
    targetPrice: slowArr[i],
  }
}

// ─── RSI ─────────────────────────────────────────────────────────────────────
// 對齊 lib/engine.ts rsiSignal()：門檻取自 params，不寫死 30/70
function computeRsiStrategy(c: number[], inPosition: boolean, p: Record<string, unknown>): StrategyResult {
  const period     = (p.period as number) ?? 14
  const oversold   = (p.oversold as number) ?? 30
  const overbought = (p.overbought as number) ?? 70
  const rsiVals = calcRsi(c, period)
  const rsiVal  = rsiVals[c.length - 2]

  if (!inPosition) {
    const met = rsiVal <= oversold
    return {
      conditions: [{ label: `RSI(${period})`, threshold: `≤${oversold} 超賣`, current: rsiVal.toFixed(1), met }],
      signal: met ? 'buy' : 'hold',
    }
  }
  const met = rsiVal >= overbought
  return {
    conditions: [{ label: `RSI(${period})`, threshold: `≥${overbought} 超買`, current: rsiVal.toFixed(1), met }],
    signal: met ? 'sell' : 'hold',
  }
}

// ─── SuperTrend ───────────────────────────────────────────────────────────────
// 對齊 lib/engine.ts supertrendSignal()：進出場都是「方向翻轉事件」；
// EMA200 只過濾進場，不過濾出場（2026-05-24 修正過的行為）
function computeSupertrend(
  klines: Awaited<ReturnType<typeof fetchKlines>>,
  c: number[],
  inPosition: boolean,
  p: Record<string, unknown>,
): StrategyResult {
  const atrPeriod = (p.atrPeriod as number) ?? 10
  const mult      = (p.multiplier as number) ?? 3
  const st = calcSupertrend(klines, atrPeriod, mult)
  const ema200Arr = ema(c, 200)

  const i = klines.length - 2
  const dir = st.direction[i]
  const closePrice = c[i]
  const ema200Val = ema200Arr[i]
  const barsInDir = barsInDirection(st.direction, i, atrPeriod)
  const dirLabel = dir === 1 ? '多頭' : '空頭'

  if (!inPosition) {
    const flipUp = st.direction[i - 1] === -1 && dir === 1
    const useEma200 = p.ema200Filter !== false && !isNaN(ema200Val)
    const aboveEma200 = closePrice > ema200Val

    const conditions: CondItem[] = [
      { label: 'SuperTrend 翻多', threshold: '本棒由空翻多',
        current: flipUp ? '剛翻多' : `${dirLabel}已 ${barsInDir} 棒`, met: flipUp },
    ]
    if (useEma200) {
      conditions.push({ label: 'EMA200', threshold: `>$${fp(ema200Val)}`, current: `$${fp(closePrice)}`, met: aboveEma200 })
    }
    return {
      conditions,
      signal: flipUp && (!useEma200 || aboveEma200) ? 'buy' : 'hold',
      targetPrice: st.trend[i],
    }
  }

  const flipDown = st.direction[i - 1] === 1 && dir === -1
  return {
    conditions: [
      { label: 'SuperTrend 翻空', threshold: '本棒由多翻空',
        current: flipDown ? '剛翻空' : `${dirLabel}已 ${barsInDir} 棒`, met: flipDown },
      { label: '翻空線', threshold: '跌破即出場', current: `$${fp(st.trend[i])}`, met: false },
    ],
    signal: flipDown ? 'sell' : 'hold',
    targetPrice: st.trend[i],
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
  const barsInDir = barsInDirection(st.direction, i, (p.atrPeriod as number) ?? 14)
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
// 對齊 lib/engine.ts emaRibbonStSignal()：
//   EMA200 過濾不通過時整個回 hold（進出場都擋）
//   買入 = ST 翻多 && fastEMA > slowEMA；賣出 = ST 翻空 || fastEMA < midEMA
function computeEmaRibbonSt(
  klines: Awaited<ReturnType<typeof fetchKlines>>,
  c: number[],
  inPosition: boolean,
  p: Record<string, unknown>,
): StrategyResult {
  const fastP = (p.fastEma as number) ?? 5
  const midP  = (p.midEma as number) ?? 13
  const slowP = (p.slowEma as number) ?? 34
  const atrPeriod = (p.atrPeriod as number) ?? 14
  const mult = (p.multiplier as number) ?? 2.5

  const st = calcSupertrend(klines, atrPeriod, mult)
  const fastArr = ema(c, fastP), midArr = ema(c, midP), slowArr = ema(c, slowP)
  const ema200Arr = ema(c, 200)

  const i = klines.length - 2
  const dir = st.direction[i]
  const closePrice = c[i]
  const ema200Val = ema200Arr[i]
  const barsInDir = barsInDirection(st.direction, i, atrPeriod)
  const dirLabel = dir === 1 ? '多頭' : '空頭'

  // 引擎：ema200Filter 不通過 → 直接 hold，連賣出都不觸發
  const useEma200 = p.ema200Filter !== false && !isNaN(ema200Val)
  const ema200Blocked = useEma200 && closePrice < ema200Val
  const ema200Row: CondItem = {
    label: 'EMA200 閘門', threshold: `>$${fp(ema200Val)}（不過則進出場全停）`,
    current: `$${fp(closePrice)}`, met: !ema200Blocked,
  }

  if (!inPosition) {
    const flipUp = st.direction[i - 1] === -1 && dir === 1
    const fastAboveSlow = fastArr[i] > slowArr[i]
    const conditions: CondItem[] = [
      { label: 'SuperTrend 翻多', threshold: '本棒由空翻多',
        current: flipUp ? '剛翻多' : `${dirLabel}已 ${barsInDir} 棒`, met: flipUp },
      { label: `EMA${fastP} > EMA${slowP}`, threshold: `>$${fp(slowArr[i])}`, current: `$${fp(fastArr[i])}`, met: fastAboveSlow },
    ]
    if (useEma200) conditions.push(ema200Row)
    return {
      conditions,
      signal: !ema200Blocked && flipUp && fastAboveSlow ? 'buy' : 'hold',
      targetPrice: st.trend[i],
    }
  }

  const flipDown = st.direction[i - 1] === 1 && dir === -1
  const ribbonBreak = fastArr[i] < midArr[i]
  const conditions: CondItem[] = [
    { label: 'SuperTrend 翻空', threshold: '本棒由多翻空',
      current: flipDown ? '剛翻空' : `${dirLabel}已 ${barsInDir} 棒`, met: flipDown },
    { label: `EMA${fastP} < EMA${midP}（ribbon 破壞）`, threshold: `<$${fp(midArr[i])}`, current: `$${fp(fastArr[i])}`, met: ribbonBreak },
  ]
  if (useEma200) conditions.push(ema200Row)
  return {
    conditions,
    signal: !ema200Blocked && (flipDown || ribbonBreak) ? 'sell' : 'hold',
    targetPrice: st.trend[i],
  }
}

// ─── MACD + BB Squeeze ────────────────────────────────────────────────────────
// 對齊 lib/engine.ts macdBbSqueezeSignal()：
//   histogram < 0 先判定賣出（不論有無持倉）
//   買入要求 histogram「由負轉正」的那一根，而非持續為正
function computeMacdBbSqueeze(
  klines: Awaited<ReturnType<typeof fetchKlines>>,
  c: number[],
  inPosition: boolean,
  p: Record<string, unknown>,
): StrategyResult {
  const macdResult = calcMacd(c,
    (p.macdFast as number) ?? 12, (p.macdSlow as number) ?? 26, (p.macdSignal as number) ?? 9)
  const bb = bollingerBands(c, (p.bbPeriod as number) ?? 20, 2)   // 引擎此處 stdDev 寫死 2
  const rsiVals = calcRsi(c, (p.rsiPeriod as number) ?? 14)
  const ema200Arr = ema(c, 200)

  const i = c.length - 2
  const hist = macdResult.histogram[i]
  const rsiVal = rsiVals[i]
  const ema200Val = ema200Arr[i]
  const closePrice = c[i]

  if (inPosition) {
    const histNegative = hist < 0
    return {
      conditions: [{ label: 'MACD Histogram', threshold: '<0', current: isNaN(hist) ? '–' : hist.toFixed(2), met: histNegative }],
      signal: histNegative ? 'sell' : 'hold',
    }
  }

  const macdCrossUp = hist > 0 && macdResult.histogram[i - 1] <= 0
  // BB 帶寬 vs 前 40 棒均值（與引擎同樣不含當根）
  const lookback = Math.min(40, i)
  let sumBw = 0, cnt = 0
  for (let j = i - lookback; j < i; j++) {
    const bw = bb.upper[j] - bb.lower[j]
    if (!isNaN(bw)) { sumBw += bw; cnt++ }
  }
  const avgBw = cnt > 0 ? sumBw / cnt : 0
  const curBw = bb.upper[i] - bb.lower[i]
  const inSqueeze = !isNaN(curBw) && curBw <= avgBw
  const rsiOk = rsiVal >= 35 && rsiVal <= 70
  const useEma200 = p.ema200Filter !== false && !isNaN(ema200Val)
  const aboveEma200 = closePrice >= ema200Val

  const conditions: CondItem[] = [
    { label: 'MACD Histogram 轉正', threshold: '本棒由負轉正',
      current: macdCrossUp ? '剛轉正' : (isNaN(hist) ? '–' : hist.toFixed(2)), met: macdCrossUp },
    { label: 'BB壓縮', threshold: '帶寬≤前40棒均值', current: inSqueeze ? '壓縮中' : '擴張中', met: inSqueeze },
    { label: 'RSI(14)', threshold: '35~70', current: rsiVal.toFixed(1), met: rsiOk },
  ]
  if (useEma200) {
    conditions.push({ label: 'EMA200', threshold: `>$${fp(ema200Val)}`, current: `$${fp(closePrice)}`, met: aboveEma200 })
  }
  return {
    conditions,
    signal: macdCrossUp && inSqueeze && rsiOk && (!useEma200 || aboveEma200) ? 'buy' : 'hold',
    targetPrice: ema200Val,
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

    // 所有 compute* 一律吃該幣實際在跑的策略參數，並只看已收盤 K 棒（見檔頭「與引擎對齊的共用工具」）
    const sp = loadStrategyParams(symbol, strategy)

    let result: StrategyResult
    switch (strategy) {
      case 'vwap_bb_rsi':     result = computeVwapBbRsi(klines, c, inPosition, sp, symbol); break
      case 'ma_cross':        result = computeMaCross(c, inPosition, sp); break
      case 'rsi':             result = computeRsiStrategy(c, inPosition, sp); break
      case 'supertrend':      result = computeSupertrend(klines, c, inPosition, sp); break
      case 'supertrend_macd': result = computeSupertrendMacd(klines, c, inPosition, sp); break
      case 'ema_ribbon_st':   result = computeEmaRibbonSt(klines, c, inPosition, sp); break
      case 'macd_bb_squeeze': result = computeMacdBbSqueeze(klines, c, inPosition, sp); break
      case 'grid':            result = computeGrid(price); break
      default:                result = computeVwapBbRsi(klines, c, inPosition, sp, symbol)
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
      const vwapVals = calcVwap(klines, (sp.vwapWindow as number) ?? 24)
      vwapLevel = vwapVals[klines.length - 2]
    }

    return NextResponse.json({ price, signal: result.signal, conditions: result.conditions, vwapLevel, targetPrice: result.targetPrice })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
