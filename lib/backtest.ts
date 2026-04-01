import { Kline } from './binance'
import { sma, ema, rsi, closes, supertrend, bollingerBands, vwap, atr as calcAtr, macd as calcMacd } from './indicators'

const BINANCE_FEE = 0.001  // Binance spot trading fee (0.1% per trade)

export interface TradeRecord {
  time: number
  side: 'buy' | 'sell'
  price: number
  quantity: number
  pnl?: number
}

export interface BacktestResult {
  initialCapital: number
  finalCapital: number
  totalReturn: number       // %
  maxDrawdown: number       // %
  winRate: number           // %
  totalTrades: number
  winTrades: number
  lossTrades: number
  sharpeRatio: number
  trades: TradeRecord[]
  equity: { time: number; value: number }[]
}

// ── shared helpers ──────────────────────────────────────────────────────────

function calcStats(
  initialCapital: number,
  trades: TradeRecord[],
  equity: { time: number; value: number }[],
): BacktestResult {
  const finalCapital = equity.at(-1)?.value ?? initialCapital
  const totalReturn = ((finalCapital - initialCapital) / initialCapital) * 100

  // max drawdown
  let peak = initialCapital, maxDrawdown = 0
  for (const e of equity) {
    if (e.value > peak) peak = e.value
    const dd = (peak - e.value) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const closedTrades = trades.filter((t) => t.pnl !== undefined)
  const winTrades = closedTrades.filter((t) => (t.pnl ?? 0) > 0).length
  const lossTrades = closedTrades.filter((t) => (t.pnl ?? 0) <= 0).length
  const winRate = closedTrades.length ? (winTrades / closedTrades.length) * 100 : 0

  // simple daily returns for Sharpe (annualized, rf=0)
  const returns: number[] = []
  for (let i = 1; i < equity.length; i++) {
    returns.push((equity[i].value - equity[i - 1].value) / equity[i - 1].value)
  }
  const meanR = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const stdR = Math.sqrt(returns.reduce((a, b) => a + (b - meanR) ** 2, 0) / (returns.length || 1))
  const sharpeRatio = stdR ? (meanR / stdR) * Math.sqrt(365) : 0

  return {
    initialCapital, finalCapital, totalReturn, maxDrawdown,
    winRate, totalTrades: closedTrades.length, winTrades, lossTrades,
    sharpeRatio, trades, equity,
  }
}

// ── MA Cross ────────────────────────────────────────────────────────────────

export interface MaCrossParams {
  fastPeriod: number
  slowPeriod: number
  maType: 'sma' | 'ema'
  tradeSize: number    // USDT per trade
  stopLoss?: number    // % e.g. 3
  takeProfit?: number  // % e.g. 6
}

export function backtestMaCross(
  klines: Kline[],
  params: MaCrossParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)
  const fn = params.maType === 'ema' ? ema : sma
  const fast = fn(c, params.fastPeriod)
  const slow = fn(c, params.slowPeriod)

  let capital = initialCapital
  let position: { price: number; qty: number } | null = null
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(fast[i]) || isNaN(slow[i]) || isNaN(fast[i - 1]) || isNaN(slow[i - 1])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * klines[i].close : 0) })
      continue
    }

    const price = klines[i].close
    const crossUp = fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]
    const crossDown = fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]

    // stop-loss / take-profit check
    if (position) {
      const pct = (price - position.price) / position.price * 100
      if (
        (params.stopLoss && pct <= -params.stopLoss) ||
        (params.takeProfit && pct >= params.takeProfit)
      ) {
        const pnl = (price - position.price) * position.qty
        capital += position.qty * price * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
        position = null
      }
    }

    if (crossUp && !position && capital >= params.tradeSize) {
      const qty = params.tradeSize / price
      capital -= params.tradeSize * (1 + BINANCE_FEE)
      position = { price, qty }
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
    } else if (crossDown && position) {
      const pnl = (price - position.price) * position.qty
      capital += position.qty * price * (1 - BINANCE_FEE)
      trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
      position = null
    }

    equity.push({ time: klines[i].time, value: capital + (position ? position.qty * price : 0) })
  }

  // close open position at end
  if (position) {
    const price = klines.at(-1)!.close
    const pnl = (price - position.price) * position.qty
    capital += position.qty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines.at(-1)!.time, side: 'sell', price, quantity: position.qty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}

// ── RSI Strategy ────────────────────────────────────────────────────────────

export interface RsiParams {
  period: number
  oversold: number    // buy threshold e.g. 30
  overbought: number  // sell threshold e.g. 70
  tradeSize: number
  stopLoss?: number
  takeProfit?: number
}

export function backtestRsi(
  klines: Kline[],
  params: RsiParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)
  const rsiVals = rsi(c, params.period)

  let capital = initialCapital
  let position: { price: number; qty: number } | null = null
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(rsiVals[i])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * klines[i].close : 0) })
      continue
    }
    const price = klines[i].close

    if (position) {
      const pct = (price - position.price) / position.price * 100
      if (
        (params.stopLoss && pct <= -params.stopLoss) ||
        (params.takeProfit && pct >= params.takeProfit) ||
        rsiVals[i] >= params.overbought
      ) {
        const pnl = (price - position.price) * position.qty
        capital += position.qty * price * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
        position = null
      }
    } else if (rsiVals[i] <= params.oversold && capital >= params.tradeSize) {
      const qty = params.tradeSize / price
      capital -= params.tradeSize * (1 + BINANCE_FEE)
      position = { price, qty }
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
    }

    equity.push({ time: klines[i].time, value: capital + (position ? position.qty * price : 0) })
  }

  if (position) {
    const price = klines.at(-1)!.close
    const pnl = (price - position.price) * position.qty
    capital += position.qty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines.at(-1)!.time, side: 'sell', price, quantity: position.qty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}

// ── Grid Strategy ───────────────────────────────────────────────────────────

export interface GridParams {
  upperPrice: number
  lowerPrice: number
  gridCount: number
  amountPerGrid: number   // USDT per grid order
}

export function backtestGrid(
  klines: Kline[],
  params: GridParams,
  initialCapital: number,
): BacktestResult {
  const { upperPrice, lowerPrice, gridCount, amountPerGrid } = params
  const gridSize = (upperPrice - lowerPrice) / gridCount
  const gridLevels = Array.from({ length: gridCount + 1 }, (_, i) => lowerPrice + i * gridSize)

  let capital = initialCapital
  const holdings: Record<number, number> = {}  // gridLevel → qty held
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  // find initial price bucket
  let prevPrice = klines[0].close

  for (let i = 1; i < klines.length; i++) {
    const price = klines[i].close

    for (const level of gridLevels) {
      // price crosses below level → buy at level
      if (prevPrice > level && price <= level && capital >= amountPerGrid) {
        const qty = amountPerGrid / level
        capital -= amountPerGrid * (1 + BINANCE_FEE)
        holdings[level] = (holdings[level] || 0) + qty
        trades.push({ time: klines[i].time, side: 'buy', price: level, quantity: qty })
      }
      // price crosses above level → sell at level
      if (prevPrice < level && price >= level && holdings[level]) {
        const qty = holdings[level]
        const entryGuess = level - gridSize
        const pnl = (level - entryGuess) * qty
        capital += qty * level * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: level, quantity: qty, pnl })
        holdings[level] = 0
      }
    }

    const heldValue = Object.entries(holdings).reduce((sum, [, qty]) => sum + qty * price, 0)
    equity.push({ time: klines[i].time, value: capital + heldValue })
    prevPrice = price
  }

  return calcStats(initialCapital, trades, equity)
}

// ── SuperTrend Strategy ──────────────────────────────────────────────────────

export interface SupertrendParams {
  atrPeriod: number
  multiplier: number
  tradeSize: number
  ema200Filter: boolean
}

export function backtestSupertrend(
  klines: Kline[],
  params: SupertrendParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)
  const { trend, direction } = supertrend(klines, params.atrPeriod, params.multiplier)
  const ema200 = params.ema200Filter ? ema(c, 200) : null

  let capital = initialCapital
  let position: { price: number; qty: number } | null = null
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(trend[i]) || isNaN(direction[i])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * klines[i].close : 0) })
      continue
    }

    const price   = klines[i].close
    const prevDir = direction[i - 1]
    const curDir  = direction[i]
    const buySignal  = curDir === 1  && prevDir === -1
    const sellSignal = curDir === -1 && prevDir === 1
    const aboveEma   = !ema200 || isNaN(ema200[i]) || price > ema200[i]

    if (sellSignal && position) {
      const pnl = (price - position.price) * position.qty
      capital += position.qty * price * (1 - BINANCE_FEE)
      trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
      position = null
    }

    if (buySignal && !position && capital >= params.tradeSize && aboveEma) {
      const qty = params.tradeSize / price
      capital -= params.tradeSize * (1 + BINANCE_FEE)
      position = { price, qty }
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
    }

    equity.push({ time: klines[i].time, value: capital + (position ? position.qty * price : 0) })
  }

  if (position) {
    const price = klines.at(-1)!.close
    const pnl = (price - position.price) * position.qty
    capital += position.qty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines.at(-1)!.time, side: 'sell', price, quantity: position.qty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}

// ── VWAP + Bollinger Bands + RSI (Crypto Pulse) ──────────────────────────────

export interface VwapBbRsiParams {
  rsiPeriod: number
  rsiOversold: number
  rsiOverbought: number
  bbPeriod: number
  bbStdDev: number
  vwapWindow: number
  atrPeriod: number     // ATR period for dynamic SL
  atrSlMultiplier: number  // SL = entry - atrSlMultiplier × ATR
  tradeSize: number
  volRegimeShort?: number      // short realized-vol window (default 20)
  volRegimeLong?: number       // long realized-vol window (default 60)
  volRegimeThreshold?: number  // short/long ratio above which strategy goes flat (default 1.3)
}

function calcRealizedVol(c: number[], i: number, w: number): number {
  if (i < w) return NaN
  let sumSq = 0
  for (let j = i - w + 1; j <= i; j++) {
    if (j > 0) { const r = Math.log(c[j] / c[j - 1]); sumSq += r * r }
  }
  return Math.sqrt(sumSq / w)
}

export function backtestVwapBbRsi(
  klines: Kline[],
  params: VwapBbRsiParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)
  const rsiVals  = rsi(c, params.rsiPeriod)
  const bb       = bollingerBands(c, params.bbPeriod, params.bbStdDev)
  const vwapVals = vwap(klines, params.vwapWindow)
  const atrVals  = calcAtr(klines, params.atrPeriod)
  const volShortW = params.volRegimeShort     ?? 20
  const volLongW  = params.volRegimeLong      ?? 60
  const volThresh = params.volRegimeThreshold ?? 1.3

  let capital = initialCapital
  let position: { price: number; qty: number; sl: number } | null = null
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(rsiVals[i]) || isNaN(bb.lower[i]) || isNaN(vwapVals[i]) || isNaN(atrVals[i])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * klines[i].close : 0) })
      continue
    }

    const price     = klines[i].close
    const prevClose = klines[i - 1].close

    // SL: hard stop only — let the overbought signal handle profit-taking
    if (position && price <= position.sl) {
      const pnl = (position.sl - position.price) * position.qty
      capital += position.qty * position.sl * (1 - BINANCE_FEE)
      trades.push({ time: klines[i].time, side: 'sell', price: position.sl, quantity: position.qty, pnl })
      position = null
    }

    const oversoldSignal   = rsiVals[i] < params.rsiOversold || (prevClose > bb.lower[i - 1] && price <= bb.lower[i])
    const overboughtSignal = rsiVals[i] > params.rsiOverbought || (prevClose < bb.upper[i - 1] && price >= bb.upper[i])

    // Exit when mean reversion completes: overbought AND price recovered above VWAP
    if (position && overboughtSignal && price > vwapVals[i]) {
      const pnl = (price - position.price) * position.qty
      capital += position.qty * price * (1 - BINANCE_FEE)
      trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
      position = null
    }

    const sv = calcRealizedVol(c, i, volShortW)
    const lv = calcRealizedVol(c, i, volLongW)
    const inTrend = !isNaN(sv) && !isNaN(lv) && lv > 0 && sv / lv > volThresh

    if (oversoldSignal && !position && capital >= params.tradeSize && price < vwapVals[i] && !inTrend) {
      const qty = params.tradeSize / price
      const sl  = price - params.atrSlMultiplier * atrVals[i]  // dynamic SL scales with volatility
      capital -= params.tradeSize * (1 + BINANCE_FEE)
      position = { price, qty, sl }
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
    }

    equity.push({ time: klines[i].time, value: capital + (position ? position.qty * price : 0) })
  }

  if (position) {
    const price = klines.at(-1)!.close
    const pnl = (price - position.price) * position.qty
    capital += position.qty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines.at(-1)!.time, side: 'sell', price, quantity: position.qty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}

// ── EMA Ribbon + SuperTrend Trend Rider ──────────────────────────────────────
// Entry: SuperTrend flips up + fast EMA > slow EMA (partial ribbon) + EMA200
// Exit:  SuperTrend flips down OR fast EMA crosses below mid EMA (ribbon breaks)
// SL:    ATR-based dynamic stop at entry
// NOTE:  Removed strict "all 3 EMAs aligned on same candle as ST flip" requirement —
//        that was too restrictive, producing <3 signals/year. Now only requires
//        fast > slow (trend direction confirmed) at the time of the ST flip.

export interface EmaRibbonStParams {
  fastEma: number          // 5
  midEma: number           // 13
  slowEma: number          // 34
  atrPeriod: number        // 14
  multiplier: number       // 2.5
  ema200Filter: boolean    // true
  atrSlMultiplier: number  // 2.0  — trailing stop multiplier (wider = let trend run)
  tradeSize: number
}

export function backtestEmaRibbonSt(
  klines: Kline[],
  params: EmaRibbonStParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)
  const emaFast  = ema(c, params.fastEma)
  const emaMid   = ema(c, params.midEma)
  const emaSlow  = ema(c, params.slowEma)
  const ema200Vals = params.ema200Filter ? ema(c, 200) : null
  const { direction } = supertrend(klines, params.atrPeriod, params.multiplier)
  const atrVals = calcAtr(klines, params.atrPeriod)

  let capital = initialCapital
  // trailingHigh tracks the highest close since entry to move the stop up
  let position: { price: number; qty: number; trailingHigh: number } | null = null
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(emaFast[i]) || isNaN(emaMid[i]) || isNaN(emaSlow[i]) || isNaN(direction[i]) || isNaN(atrVals[i])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * klines[i].close : 0) })
      continue
    }

    const price     = klines[i].close
    const trendUp   = emaFast[i] > emaSlow[i]         // fast > slow = bull direction
    const stFlipUp  = direction[i - 1] === -1 && direction[i] === 1
    const stFlipDown = direction[i - 1] === 1 && direction[i] === -1
    const aboveEma200 = !ema200Vals || isNaN(ema200Vals[i]) || price > ema200Vals[i]

    if (position) {
      // update trailing high
      if (price > position.trailingHigh) position.trailingHigh = price
      const trailingSl = position.trailingHigh - params.atrSlMultiplier * atrVals[i]

      // Trailing stop hit
      if (price <= trailingSl) {
        const exitPrice = trailingSl
        const pnl = (exitPrice - position.price) * position.qty
        capital += position.qty * exitPrice * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: exitPrice, quantity: position.qty, pnl })
        position = null
      }
      // Hard exit: SuperTrend flips down (trend reversal confirmed)
      else if (stFlipDown) {
        const pnl = (price - position.price) * position.qty
        capital += position.qty * price * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
        position = null
      }
    }

    // Entry: ST flips up + fast EMA > slow EMA + EMA200 filter
    if (!position && stFlipUp && trendUp && aboveEma200 && capital >= params.tradeSize) {
      const qty = params.tradeSize / price
      capital -= params.tradeSize * (1 + BINANCE_FEE)
      position = { price, qty, trailingHigh: price }
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
    }

    equity.push({ time: klines[i].time, value: capital + (position ? position.qty * price : 0) })
  }

  if (position) {
    const price = klines.at(-1)!.close
    const pnl = (price - position.price) * position.qty
    capital += position.qty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines.at(-1)!.time, side: 'sell', price, quantity: position.qty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}

// ── Adaptive Combo (EMA Ribbon + ST in trend, Crypto Pulse in sideways) ─────
// Regime detection: ST direction + EMA fast vs slow
//   TRENDING UP  → ST direction=1 & fast > slow → EMA Ribbon + ST logic
//   TRENDING DOWN → ST direction=-1 & fast < slow → no trade (sideways, no short)
//   SIDEWAYS     → otherwise → Crypto Pulse (VWAP + BB + RSI mean reversion)

export interface AdaptiveComboParams {
  tradeSize: number
  // EMA Ribbon + ST
  fastEma?: number         // default 5
  midEma?: number          // default 13
  slowEma?: number         // default 34
  atrPeriod?: number       // default 14
  multiplier?: number      // ST multiplier, default 2.5
  ema200Filter?: boolean   // default true
  atrSlMultiplier?: number // default 1.5
  // Crypto Pulse
  rsiPeriod?: number       // default 14
  rsiOversold?: number     // default 35
  rsiOverbought?: number   // default 65
  bbPeriod?: number        // default 20
  bbStdDev?: number        // default 2
  vwapWindow?: number      // default 24
}

export function backtestAdaptiveCombo(
  klines: Kline[],
  params: AdaptiveComboParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)

  // EMA Ribbon + ST indicators
  const fastEmaPeriod  = params.fastEma        ?? 5
  const midEmaPeriod   = params.midEma         ?? 13
  const slowEmaPeriod  = params.slowEma        ?? 34
  const atrPeriodVal   = params.atrPeriod      ?? 14
  const stMultiplier   = params.multiplier     ?? 2.5
  const atrSlMult      = params.atrSlMultiplier ?? 1.5
  const useEma200      = params.ema200Filter   ?? true

  // Crypto Pulse indicators
  const rsiPeriodVal   = params.rsiPeriod      ?? 14
  const rsiOversold    = params.rsiOversold    ?? 35
  const rsiOverbought  = params.rsiOverbought  ?? 65
  const bbPeriodVal    = params.bbPeriod       ?? 20
  const bbStdDevVal    = params.bbStdDev       ?? 2
  const vwapWindowVal  = params.vwapWindow     ?? 24

  const emaFast   = ema(c, fastEmaPeriod)
  const emaMid    = ema(c, midEmaPeriod)
  const emaSlow   = ema(c, slowEmaPeriod)
  const ema200Vals = useEma200 ? ema(c, 200) : null
  const { direction } = supertrend(klines, atrPeriodVal, stMultiplier)
  const atrVals   = calcAtr(klines, atrPeriodVal)

  const rsiVals  = rsi(c, rsiPeriodVal)
  const bb       = bollingerBands(c, bbPeriodVal, bbStdDevVal)
  const vwapVals = vwap(klines, vwapWindowVal)

  let capital  = initialCapital
  let inPosition = false
  let entryPrice = 0
  let entryMode: 'trend' | 'pulse' | null = null
  let trailingHigh = 0
  let atrStopLevel = 0
  let positionQty  = 0

  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    const hasAllTrend = !isNaN(emaFast[i]) && !isNaN(emaMid[i]) && !isNaN(emaSlow[i]) &&
                        !isNaN(direction[i]) && !isNaN(atrVals[i])
    const hasAllPulse = !isNaN(rsiVals[i]) && !isNaN(bb.lower[i]) && !isNaN(vwapVals[i]) && !isNaN(atrVals[i])

    if (!hasAllTrend && !hasAllPulse) {
      equity.push({ time: klines[i].time, value: capital + (inPosition ? positionQty * klines[i].close : 0) })
      continue
    }

    const price = klines[i].close

    // ── Regime detection using previous bar ──
    const isTrendingUp = hasAllTrend &&
      direction[i - 1] === 1 && emaFast[i - 1] > emaSlow[i - 1]

    // ── Exit logic ──
    if (inPosition && entryMode === 'trend' && hasAllTrend) {
      // Update trailing high
      if (price > trailingHigh) trailingHigh = price
      const trailingSl = trailingHigh - atrSlMult * atrVals[i]
      const stFlipDown = direction[i - 1] === 1 && direction[i] === -1

      if (price <= trailingSl) {
        // Trailing stop hit
        const exitPrice = trailingSl
        const pnl = (exitPrice - entryPrice) * positionQty
        capital += positionQty * exitPrice * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: exitPrice, quantity: positionQty, pnl })
        inPosition = false; entryMode = null
      } else if (stFlipDown || emaFast[i] < emaMid[i]) {
        // ST flips down or ribbon breaks
        const pnl = (price - entryPrice) * positionQty
        capital += positionQty * price * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price, quantity: positionQty, pnl })
        inPosition = false; entryMode = null
      }
    }

    if (inPosition && entryMode === 'pulse' && hasAllPulse) {
      // Pulse ATR stop (fixed at entry)
      if (price <= atrStopLevel) {
        const pnl = (atrStopLevel - entryPrice) * positionQty
        capital += positionQty * atrStopLevel * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: atrStopLevel, quantity: positionQty, pnl })
        inPosition = false; entryMode = null
      } else {
        // Overbought exit: signal + price above VWAP
        const overboughtSignal = rsiVals[i] > rsiOverbought || price > bb.upper[i]
        if (overboughtSignal && price > vwapVals[i]) {
          const pnl = (price - entryPrice) * positionQty
          capital += positionQty * price * (1 - BINANCE_FEE)
          trades.push({ time: klines[i].time, side: 'sell', price, quantity: positionQty, pnl })
          inPosition = false; entryMode = null
        }
      }
    }

    // ── Entry logic ──
    if (!inPosition) {
      if (isTrendingUp) {
        // TRENDING UP → EMA Ribbon + ST entry
        const stFlipUp = direction[i - 1] === -1 && direction[i] === 1
        const trendUp  = emaFast[i] > emaSlow[i]
        const aboveEma200 = !ema200Vals || isNaN(ema200Vals[i]) || price > ema200Vals[i]

        if (stFlipUp && trendUp && aboveEma200 && capital >= params.tradeSize) {
          const qty = params.tradeSize / price
          capital -= params.tradeSize * (1 + BINANCE_FEE)
          inPosition  = true
          entryPrice  = price
          entryMode   = 'trend'
          trailingHigh = price
          positionQty = qty
          trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
        }
      } else if (hasAllPulse) {
        // SIDEWAYS → Crypto Pulse entry
        const oversoldSignal = rsiVals[i] < rsiOversold || price < bb.lower[i]
        if (oversoldSignal && price < vwapVals[i] && capital >= params.tradeSize) {
          const qty = params.tradeSize / price
          const sl  = price - atrSlMult * atrVals[i]
          capital -= params.tradeSize * (1 + BINANCE_FEE)
          inPosition   = true
          entryPrice   = price
          entryMode    = 'pulse'
          atrStopLevel = sl
          positionQty  = qty
          trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
        }
      }
    }

    equity.push({ time: klines[i].time, value: capital + (inPosition ? positionQty * price : 0) })
  }

  // Close open position at end
  if (inPosition) {
    const price = klines.at(-1)!.close
    const pnl = (price - entryPrice) * positionQty
    capital += positionQty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines.at(-1)!.time, side: 'sell', price, quantity: positionQty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}

// ── MACD + BB Squeeze Breakout ───────────────────────────────────────────────
// Entry: MACD histogram crosses positive + BB narrow (below 40-bar avg) + RSI 35-70 + EMA200
// Exit:  MACD histogram turns negative OR TP/SL hit
// SL/TP: ATR-based (atrSlMultiplier× stop, atrTpMultiplier× target)
// NOTE:  Removed strict "prevInSqueeze && expanding" (5-condition simultaneous gate) which
//        produced 0 trades on 4h. Now uses looser bandwidth < 40-bar average as squeeze proxy.

export interface MacdBbSqueezeParams {
  macdFast: number         // 12
  macdSlow: number         // 26
  macdSignal: number       // 9
  bbPeriod: number         // 20
  rsiPeriod: number        // 14
  atrPeriod: number        // 14
  atrSlMultiplier: number  // 2
  atrTpMultiplier: number  // 4
  ema200Filter: boolean    // true
  tradeSize: number
}

export function backtestMacdBbSqueeze(
  klines: Kline[],
  params: MacdBbSqueezeParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)
  const macdVals   = calcMacd(c, params.macdFast, params.macdSlow, params.macdSignal)
  const bb         = bollingerBands(c, params.bbPeriod, 2)
  const rsiVals    = rsi(c, params.rsiPeriod)
  const ema200Vals = params.ema200Filter ? ema(c, 200) : null
  const atrVals    = calcAtr(klines, params.atrPeriod)

  const bandwidth: number[] = bb.mid.map((m, i) =>
    isNaN(m) || isNaN(bb.upper[i]) ? NaN : (bb.upper[i] - bb.lower[i]) / m
  )

  let capital = initialCapital
  let position: { price: number; qty: number; sl: number; tp: number } | null = null
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(macdVals.histogram[i]) || isNaN(rsiVals[i]) || isNaN(atrVals[i]) || isNaN(bandwidth[i])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * klines[i].close : 0) })
      continue
    }

    const price = klines[i].close

    // SL / TP
    if (position) {
      if (price <= position.sl) {
        const pnl = (position.sl - position.price) * position.qty
        capital += position.qty * position.sl * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: position.sl, quantity: position.qty, pnl })
        position = null
      } else if (price >= position.tp) {
        const pnl = (position.tp - position.price) * position.qty
        capital += position.qty * position.tp * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: position.tp, quantity: position.qty, pnl })
        position = null
      }
    }

    // Signal-based exit: MACD turns negative (momentum fades)
    if (position && macdVals.histogram[i] < 0) {
      const pnl = (price - position.price) * position.qty
      capital += position.qty * price * (1 - BINANCE_FEE)
      trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
      position = null
    }

    // Squeeze: bandwidth below 40-bar rolling average (loose squeeze proxy)
    const lookback = Math.min(40, i)
    let avgBw = 0, bwCount = 0
    for (let j = i - lookback; j < i; j++) {
      if (!isNaN(bandwidth[j])) { avgBw += bandwidth[j]; bwCount++ }
    }
    avgBw = bwCount > 0 ? avgBw / bwCount : bandwidth[i]
    const inOrNearSqueeze = bandwidth[i] <= avgBw          // at or below average = compressed
    const macdCrossUp     = macdVals.histogram[i] > 0 && macdVals.histogram[i - 1] <= 0
    const rsiOk           = rsiVals[i] >= 35 && rsiVals[i] <= 70   // wider RSI range
    const aboveEma200     = !ema200Vals || isNaN(ema200Vals[i]) || price > ema200Vals[i]

    if (!position && macdCrossUp && inOrNearSqueeze && rsiOk && aboveEma200 && capital >= params.tradeSize) {
      const qty = params.tradeSize / price
      const sl  = price - params.atrSlMultiplier * atrVals[i]
      const tp  = price + params.atrTpMultiplier * atrVals[i]
      capital -= params.tradeSize * (1 + BINANCE_FEE)
      position = { price, qty, sl, tp }
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
    }

    equity.push({ time: klines[i].time, value: capital + (position ? position.qty * price : 0) })
  }

  if (position) {
    const price = klines.at(-1)!.close
    const pnl = (price - position.price) * position.qty
    capital += position.qty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines.at(-1)!.time, side: 'sell', price, quantity: position.qty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}
