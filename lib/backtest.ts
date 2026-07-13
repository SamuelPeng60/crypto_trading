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

// 動態止盈倍數 — 必須與 lib/engine.ts 的 DYN_TP_MULT 一致
const DYN_TP_MULT = 3.5

// 引擎每 5 分鐘用即時價檢查停損/停利，所以棒內就會觸發，不是等收盤。
// 回測必須比對棒內高低價，否則會系統性忽略掉所有「插針掃損」——這正是回測遠優於實盤的主因。
// 跳空時無法在缺口內成交，故以開盤價成交（較差的一邊）。
function slHitPrice(bar: Kline, sl: number): number | null {
  if (bar.low > sl) return null
  return Math.min(sl, bar.open)
}

function tpHitPrice(bar: Kline, tp: number): number | null {
  if (bar.high < tp) return null
  return Math.max(tp, bar.open)
}

// 動態止盈的觸發價：解 qty × (P×(1-fee) − entry×(1+fee)) ≥ threshold
function dynTpTriggerPrice(entryPrice: number, qty: number, threshold: number): number {
  return (threshold / qty + entryPrice * (1 + BINANCE_FEE)) / (1 - BINANCE_FEE)
}

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

    const effectiveTradeSize = Math.min((params.tradeSize / initialCapital) * capital, capital * 0.999)
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
      } else if (crossDown) {
        const pnl = (price - position.price) * position.qty
        capital += position.qty * price * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price, quantity: position.qty, pnl })
        position = null
      }
    } else if (crossUp && capital > 0) {
      const qty = effectiveTradeSize / price
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
      position = { price, qty }
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
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
    } else if (rsiVals[i] <= params.oversold && capital > 0) {
      const effectiveTradeSize = Math.min(params.tradeSize, capital * 0.999)
      const qty = effectiveTradeSize / price
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
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
  // holdings tracked by level INDEX to avoid floating-point key issues
  const holdings: Record<number, number> = {}  // levelIndex → qty held
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  let prevPrice = klines[0].close

  for (let i = 1; i < klines.length; i++) {
    const price = klines[i].close

    for (let li = 0; li < gridLevels.length; li++) {
      const level = gridLevels[li]
      const effectiveAmountPerGrid = Math.min(amountPerGrid, capital * 0.999)
      // price crosses below level → buy at this level
      if (prevPrice > level && price <= level && capital > 0) {
        const qty = effectiveAmountPerGrid / level
        capital -= effectiveAmountPerGrid * (1 + BINANCE_FEE)
        holdings[li] = (holdings[li] || 0) + qty
        trades.push({ time: klines[i].time, side: 'buy', price: level, quantity: qty })
      }
      // price crosses above level → sell holdings bought at PREVIOUS level (li-1)
      // so profit = level - gridLevels[li-1] = gridSize per unit
      if (li > 0 && prevPrice < level && price >= level && holdings[li - 1]) {
        const qty = holdings[li - 1]
        const buyPrice = gridLevels[li - 1]
        const pnl = (level - buyPrice) * qty
        capital += qty * level * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: level, quantity: qty, pnl })
        holdings[li - 1] = 0
      }
    }

    const heldValue = Object.entries(holdings).reduce((sum, [, qty]) => sum + qty * price, 0)
    equity.push({ time: klines[i].time, value: capital + heldValue })
    prevPrice = price
  }

  return calcStats(initialCapital, trades, equity)
}

// ── SuperTrend + MACD Entry Filter (Hybrid D) ───────────────────────────────

export interface SupertrendMacdParams {
  atrPeriod: number       // default 14
  multiplier: number      // default 3.0
  ema200Filter: boolean   // default true
  macdFast: number        // default 12
  macdSlow: number        // default 26
  macdSignal: number      // default 9
  tradeSize: number
}

export function backtestSupertrendMacd(
  klines: Kline[],
  params: SupertrendMacdParams,
  initialCapital: number,
): BacktestResult {
  const c = closes(klines)
  const { direction } = supertrend(klines, params.atrPeriod, params.multiplier)
  const ema200 = params.ema200Filter ? ema(c, 200) : null
  const macdVals = calcMacd(c, params.macdFast, params.macdSlow, params.macdSignal)

  let capital = initialCapital
  let position: { price: number; qty: number } | null = null
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  // 引擎只用已收盤 K 棒算訊號（confirmedKlines），flip 要等訊號棒收盤後的下一個
  // 5 分鐘 tick 才成交 → 誠實成交價 = 下一棒開盤價，而非訊號棒收盤價。
  // （4h 加密市場 open[i] ≈ close[i-1]，實測影響 ±2 USDT / 5.5 年，但對齊到位）
  for (let i = 2; i < klines.length; i++) {
    const price = klines[i].close   // 僅用於 equity 標記

    if (isNaN(direction[i - 1])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * price : 0) })
      continue
    }

    // 訊號看 bar i-1（引擎在 bar i 期間看到的最後一根已收盤棒），成交於 bar i 開盤
    const fillPrice   = klines[i].open
    const sigClose    = klines[i - 1].close
    const stFlipUp    = direction[i - 2] === -1 && direction[i - 1] === 1
    const stFlipDown  = direction[i - 2] === 1  && direction[i - 1] === -1
    const macdHist    = macdVals.histogram[i - 1]
    const macdPos     = !isNaN(macdHist) && macdHist > 0
    const aboveEma    = !ema200 || isNaN(ema200[i - 1]) || sigClose > ema200[i - 1]

    // Exit: ST flip down ONLY (no MACD exit — avoids premature cuts)
    if (position && stFlipDown) {
      const pnl = (fillPrice - position.price) * position.qty
      capital += position.qty * fillPrice * (1 - BINANCE_FEE)
      trades.push({ time: klines[i].time, side: 'sell', price: fillPrice, quantity: position.qty, pnl })
      position = null
    }

    // Entry: ST flip up + MACD histogram positive + EMA200 filter
    if (!position && stFlipUp && macdPos && aboveEma && capital > 0) {
      const effectiveTradeSize = Math.min(params.tradeSize, capital * 0.999)
      const qty = effectiveTradeSize / fillPrice
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
      position = { price: fillPrice, qty }
      trades.push({ time: klines[i].time, side: 'buy', price: fillPrice, quantity: qty })
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

    if (buySignal && !position && capital > 0 && aboveEma) {
      const effectiveTradeSize = Math.min(params.tradeSize, capital * 0.999)
      const qty = effectiveTradeSize / price
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
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
  atrPeriod: number        // ATR period for dynamic SL
  atrSlMultiplier: number  // initial hard SL = entry - atrSlMultiplier × ATR
  trailAtrMult?: number    // trailing stop multiplier; SL rises to (max_close - trailAtrMult×ATR)
                           // when > 0: RSI overbought exit disabled; trailing stop is sole exit
                           // when 0 (default): use original RSI overbought exit, no trailing
  tradeSize: number
  volRegimeShort?: number      // short realized-vol window (default 20)
  volRegimeLong?: number       // long realized-vol window (default 60)
  volRegimeThreshold?: number  // short/long vol ratio above which strategy pauses (default 1.3)
  cooldownBars?: number        // bars to skip after any sell before re-entry (default 0)
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

  const cooldownBars = params.cooldownBars ?? 0
  const trailMult    = params.trailAtrMult ?? 0   // 0 = disabled

  // 引擎的買入訊號逐棒展開，供 Fresh Buy Guard 使用（見下方進場條件）
  const buySig: boolean[] = klines.map((_, i) => {
    if (i < 1 || isNaN(rsiVals[i]) || isNaN(bb.lower[i]) || isNaN(vwapVals[i])) return false
    const price = klines[i].close
    const sv = calcRealizedVol(c, i, volShortW)
    const lv = calcRealizedVol(c, i, volLongW)
    const inTrend = !isNaN(sv) && !isNaN(lv) && lv > 0 && sv / lv > volThresh
    const oversold = rsiVals[i] < params.rsiOversold ||
                     (klines[i - 1].close > bb.lower[i - 1] && price <= bb.lower[i])
    return !inTrend && oversold && price < vwapVals[i]
  })

  let capital = initialCapital
  let position: { price: number; qty: number; sl: number; high: number } | null = null
  let cooldownRemaining = 0
  let maxSl = 0   // 歷史最大停損金額（同引擎 sl_streak 表）
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  // 出場並更新 sl_streak：虧損出場記錄最大虧損，獲利出場歸零（同 lib/engine.ts:632-633）
  const closeAt = (exitPrice: number, time: number) => {
    const pos = position!
    const pnl = (exitPrice - pos.price) * pos.qty
    capital += pos.qty * exitPrice * (1 - BINANCE_FEE)
    trades.push({ time, side: 'sell', price: exitPrice, quantity: pos.qty, pnl })
    if (pnl > 0) maxSl = 0
    else if (pnl < 0) maxSl = Math.max(maxSl, Math.abs(pnl))
    position = null
    cooldownRemaining = cooldownBars
  }

  for (let i = 1; i < klines.length; i++) {
    if (cooldownRemaining > 0) cooldownRemaining--

    if (isNaN(rsiVals[i]) || isNaN(bb.lower[i]) || isNaN(vwapVals[i]) || isNaN(atrVals[i])) {
      equity.push({ time: klines[i].time, value: capital + (position ? position.qty * klines[i].close : 0) })
      continue
    }

    const bar       = klines[i]
    const price     = bar.close
    const prevClose = klines[i - 1].close
    // 引擎用「已收盤 K 棒」計算 ATR（confirmedKlines），棒進行中還不知道這根的 ATR
    const prevAtr   = atrVals[i - 1]

    // ── 棒內出場檢查（引擎每 5 分鐘用即時價檢查，不等收盤）─────────────────────────
    let exitedThisBar = false
    if (position && !isNaN(prevAtr)) {
      // 止損位：只升不降（同引擎 positions.trail_sl 欄位）
      const freshInit  = position.price - params.atrSlMultiplier * prevAtr
      const freshTrail = trailMult > 0 ? position.high - trailMult * prevAtr : -Infinity
      position.sl = Math.max(position.sl, freshInit, freshTrail)

      const slExit = slHitPrice(bar, position.sl)
      const dynTp  = maxSl > 0 ? dynTpTriggerPrice(position.price, position.qty, maxSl * DYN_TP_MULT) : null
      const tpExit = dynTp !== null ? tpHitPrice(bar, dynTp) : null

      // 同一根棒同時觸及止損與動態止盈時，保守假設止損先到
      if (slExit !== null) {
        closeAt(slExit, bar.time)
        exitedThisBar = true
      } else if (tpExit !== null) {
        closeAt(tpExit, bar.time)
        exitedThisBar = true
      }
    }

    const overboughtSignal = rsiVals[i] > params.rsiOverbought || (prevClose < bb.upper[i - 1] && price >= bb.upper[i])

    // ── Overbought exit — only when trailMult=0 (trailing stop is sole exit otherwise) ──
    if (trailMult === 0 && position && overboughtSignal && price > vwapVals[i]) {
      closeAt(price, bar.time)
      exitedThisBar = true
    }

    // 收盤後才更新 trailing high（引擎用 lastConfirmedClose）
    if (position && price > position.high) position.high = price

    // ── Fresh Buy Guard（同引擎 isFreshBuy）───────────────────────────────────────
    // 引擎每個 tick 都把「已收盤 K 棒算出的訊號」回存 last_signal，因此只有訊號從
    // 非 buy「轉變」為 buy 的那根棒才會進場。超賣持續成立時，停損出場後不會馬上再買回，
    // 要等訊號先熄滅再重新亮起。回測原本沒有這道關卡，因此進場次數遠多於實盤。
    const freshBuy = buySig[i] && !buySig[i - 1]

    if (freshBuy && !position && !exitedThisBar && capital > 0 && cooldownRemaining === 0) {
      const effectiveTradeSize = Math.min(params.tradeSize, capital * 0.999)
      const qty = effectiveTradeSize / price
      const sl  = price - params.atrSlMultiplier * atrVals[i]
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
      position = { price, qty, sl, high: price }
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

      // Trailing stop hit — exit at trailing stop level (stop order fills at stop price)
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
    if (!position && stFlipUp && trendUp && aboveEma200 && capital > 0) {
      const effectiveTradeSize = Math.min(params.tradeSize, capital * 0.999)
      const qty = effectiveTradeSize / price
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
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
  // Vol regime filter — pauses SIDEWAYS entries when market is trending hard
  volRegimeShort?: number      // default 20
  volRegimeLong?: number       // default 60
  volRegimeThreshold?: number  // default 1.3
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

  const volShortW  = params.volRegimeShort     ?? 20
  const volLongW   = params.volRegimeLong      ?? 60
  const volThresh  = params.volRegimeThreshold ?? 1.3

  const emaFast   = ema(c, fastEmaPeriod)
  const emaMid    = ema(c, midEmaPeriod)
  const emaSlow   = ema(c, slowEmaPeriod)
  const ema200Vals = useEma200 ? ema(c, 200) : null
  const { direction } = supertrend(klines, atrPeriodVal, stMultiplier)
  const atrVals   = calcAtr(klines, atrPeriodVal)

  const rsiVals  = rsi(c, rsiPeriodVal)
  const bb       = bollingerBands(c, bbPeriodVal, bbStdDevVal)
  const vwapVals = vwap(klines, vwapWindowVal)

  // 引擎的買入訊號逐棒展開，供 Fresh Buy Guard 使用（見下方進場條件）
  const buySig: boolean[] = klines.map((_, i) => {
    if (i < 1) return false
    const price = c[i]
    const hasTrend = !isNaN(emaFast[i]) && !isNaN(emaSlow[i]) && !isNaN(direction[i])
    const stFlipUp = hasTrend && direction[i - 1] === -1 && direction[i] === 1
    const prevUptrend = hasTrend && direction[i - 1] === 1 && emaFast[i - 1] > emaSlow[i - 1]
    const aboveEma200 = !ema200Vals || isNaN(ema200Vals[i]) || price > ema200Vals[i]

    if (prevUptrend || stFlipUp) {
      // TRENDING → EMA Ribbon + ST
      return stFlipUp && emaFast[i] > emaSlow[i] && aboveEma200
    }
    // SIDEWAYS → Crypto Pulse
    if (isNaN(rsiVals[i]) || isNaN(bb.lower[i]) || isNaN(vwapVals[i])) return false
    const isTrendingDown = hasTrend && direction[i - 1] === -1 && emaFast[i - 1] < emaSlow[i - 1]
    if (isTrendingDown) return false
    const oversold = rsiVals[i] < rsiOversold || price < bb.lower[i]
    return oversold && price < vwapVals[i]
  })

  let capital  = initialCapital
  let inPosition = false
  let entryPrice = 0
  let entryMode: 'trend' | 'pulse' | null = null
  let trailingHigh = 0   // used for both modes (matches engine: trail_high for all positions)
  let positionQty  = 0
  let maxSl = 0          // 歷史最大停損金額（同引擎 sl_streak 表）

  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  // 出場並更新 sl_streak：虧損出場記錄最大虧損，獲利出場歸零（同 lib/engine.ts:632-633）
  const closeAt = (exitPrice: number, time: number) => {
    const pnl = (exitPrice - entryPrice) * positionQty
    capital += positionQty * exitPrice * (1 - BINANCE_FEE)
    trades.push({ time, side: 'sell', price: exitPrice, quantity: positionQty, pnl })
    if (pnl > 0) maxSl = 0
    else if (pnl < 0) maxSl = Math.max(maxSl, Math.abs(pnl))
    inPosition = false
    entryMode = null
  }

  for (let i = 1; i < klines.length; i++) {
    const hasAllTrend = !isNaN(emaFast[i]) && !isNaN(emaMid[i]) && !isNaN(emaSlow[i]) &&
                        !isNaN(direction[i]) && !isNaN(atrVals[i])
    const hasAllPulse = !isNaN(rsiVals[i]) && !isNaN(bb.lower[i]) && !isNaN(vwapVals[i]) && !isNaN(atrVals[i])

    if (!hasAllTrend && !hasAllPulse) {
      equity.push({ time: klines[i].time, value: capital + (inPosition ? positionQty * klines[i].close : 0) })
      continue
    }

    const bar   = klines[i]
    const price = bar.close
    // 引擎用「已收盤 K 棒」計算 ATR（confirmedKlines），棒進行中還不知道這根的 ATR
    const prevAtr = atrVals[i - 1]

    // ── Regime detection using previous bar ──
    const prevUptrend = hasAllTrend && direction[i - 1] === 1 && emaFast[i - 1] > emaSlow[i - 1]
    const stFlipUpNow = hasAllTrend && direction[i - 1] === -1 && direction[i] === 1
    const inTrendingMode = prevUptrend || stFlipUpNow

    // ── 棒內出場檢查（引擎每 5 分鐘用即時價檢查，不等收盤）─────────────────────────
    // 止損位用上一根已收盤棒的 trailing high 與 ATR（同引擎；此處不做「只升不降」，
    // 因為引擎的 adaptive_combo 每個 tick 都以當前 ATR 重算 trailHigh − atrSl×ATR）
    let exitedThisBar = false
    if (inPosition && !isNaN(prevAtr)) {
      const currentSl = trailingHigh - atrSlMult * prevAtr
      const slExit = slHitPrice(bar, currentSl)
      const dynTp  = maxSl > 0 ? dynTpTriggerPrice(entryPrice, positionQty, maxSl * DYN_TP_MULT) : null
      const tpExit = dynTp !== null ? tpHitPrice(bar, dynTp) : null

      // 同一根棒同時觸及止損與動態止盈時，保守假設止損先到
      if (slExit !== null) {
        closeAt(slExit, bar.time)
        exitedThisBar = true
      } else if (tpExit !== null) {
        closeAt(tpExit, bar.time)
        exitedThisBar = true
      }
    }

    // ── Trend mode exit（訊號出場，於收盤判斷）──
    if (inPosition && entryMode === 'trend' && hasAllTrend) {
      const stFlipDown = direction[i - 1] === 1 && direction[i] === -1
      if (stFlipDown || emaFast[i] < emaMid[i]) {
        closeAt(price, bar.time)
        exitedThisBar = true
      }
    }

    // ── Pulse mode exit（訊號出場，於收盤判斷）──
    if (inPosition && entryMode === 'pulse' && hasAllPulse) {
      const overboughtSignal = rsiVals[i] > rsiOverbought || price > bb.upper[i]
      if (overboughtSignal && price > vwapVals[i]) {
        closeAt(price, bar.time)
        exitedThisBar = true
      }
    }

    // 收盤後才更新 trailing high（引擎用 lastConfirmedClose）
    if (inPosition && price > trailingHigh) trailingHigh = price

    // ── Entry logic ──
    // Fresh Buy Guard（同引擎 isFreshBuy）：訊號必須從非 buy「轉變」為 buy 才進場
    const freshBuy = buySig[i] && !buySig[i - 1]
    if (freshBuy && !inPosition && !exitedThisBar && capital > 0) {
      const effectiveTradeSize = Math.min(params.tradeSize, capital * 0.999)
      const qty = effectiveTradeSize / price
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
      inPosition   = true
      entryPrice   = price
      entryMode    = inTrendingMode ? 'trend' : 'pulse'
      trailingHigh = price
      positionQty  = qty
      trades.push({ time: klines[i].time, side: 'buy', price, quantity: qty })
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

    // SL / TP — exit at stop/target price (stop order fills at trigger level); continue prevents same-bar re-entry
    if (position) {
      if (price <= position.sl) {
        const exitPrice = position.sl
        const pnl = (exitPrice - position.price) * position.qty
        capital += position.qty * exitPrice * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: exitPrice, quantity: position.qty, pnl })
        position = null
        equity.push({ time: klines[i].time, value: capital })
        continue
      } else if (price >= position.tp) {
        const exitPrice = position.tp
        const pnl = (exitPrice - position.price) * position.qty
        capital += position.qty * exitPrice * (1 - BINANCE_FEE)
        trades.push({ time: klines[i].time, side: 'sell', price: exitPrice, quantity: position.qty, pnl })
        position = null
        equity.push({ time: klines[i].time, value: capital })
        continue
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

    if (!position && macdCrossUp && inOrNearSqueeze && rsiOk && aboveEma200 && capital > 0) {
      const effectiveTradeSize = Math.min(params.tradeSize, capital * 0.999)
      const qty = effectiveTradeSize / price
      const sl  = price - params.atrSlMultiplier * atrVals[i]
      const tp  = price + params.atrTpMultiplier * atrVals[i]
      capital -= effectiveTradeSize * (1 + BINANCE_FEE)
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

// ── MA Consolidation Breakout ─────────────────────────────────────────────────
// Dual-timeframe: 4H filter (SMA30/45/60 compression + price above MAs) + 1H execution
// Entry: 3 SMAs compressed for N bars on 4H, then 1H dips below lower bound and recovers
// Exit:  ATR trailing stop using 4H ATR (tracks highest close since entry)
// SL floor: consolidation lower bound (min of three SMAs over consolidation window)

export interface MaConsolidationBreakoutParams {
  ma1: number               // 30
  ma2: number               // 45
  ma3: number               // 60
  compressionPct: number    // 1.5 (%)
  consolidationBars: number // 8 (4H bars)
  trailAtrMult: number      // 2.0
  atrPeriod: number         // 14
  tradeSize: number         // 1000
}

function resample1hTo4h(klines1h: Kline[]): Kline[] {
  const BAR_SEC = 4 * 3600
  const result: Kline[] = []
  let i = 0
  while (i < klines1h.length) {
    const barStart = Math.floor(klines1h[i].time / BAR_SEC) * BAR_SEC
    let j = i
    while (j < klines1h.length && Math.floor(klines1h[j].time / BAR_SEC) * BAR_SEC === barStart) j++
    const slice = klines1h.slice(i, j)
    result.push({
      time: barStart,
      open: slice[0].open,
      high: Math.max(...slice.map(k => k.high)),
      low: Math.min(...slice.map(k => k.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((s, k) => s + k.volume, 0),
    })
    i = j
  }
  return result
}

export function backtestMaConsolidation(
  klines1h: Kline[],
  params: MaConsolidationBreakoutParams,
  initialCapital: number,
): BacktestResult {
  const { ma1, ma2, ma3, compressionPct, consolidationBars, trailAtrMult, atrPeriod, tradeSize } = params
  const threshold = compressionPct / 100
  const BAR_SEC = 4 * 3600

  const klines4h = resample1hTo4h(klines1h)
  const cls4h = klines4h.map(k => k.close)
  const ma1Vals = sma(cls4h, ma1)
  const ma2Vals = sma(cls4h, ma2)
  const ma3Vals = sma(cls4h, ma3)
  const atr4hVals = calcAtr(klines4h, atrPeriod)

  const time4hToIdx = new Map<number, number>()
  for (let j = 0; j < klines4h.length; j++) time4hToIdx.set(klines4h[j].time, j)

  let capital = initialCapital
  let inPosition = false
  let entryPrice = 0
  let positionQty = 0
  let trailingHigh = 0
  let sl = 0
  let prevDipped = false
  const trades: TradeRecord[] = []
  const equity: { time: number; value: number }[] = []

  for (let i = 0; i < klines1h.length; i++) {
    const bar = klines1h[i]
    const price = bar.close
    const j4h = time4hToIdx.get(Math.floor(bar.time / BAR_SEC) * BAR_SEC - BAR_SEC)

    if (inPosition) {
      if (j4h !== undefined && !isNaN(atr4hVals[j4h])) {
        trailingHigh = Math.max(trailingHigh, price)
        sl = Math.max(sl, trailingHigh - trailAtrMult * atr4hVals[j4h])
      }
      if (price <= sl) {
        const exitPrice = sl
        const pnl = (exitPrice - entryPrice) * positionQty
        capital += positionQty * exitPrice * (1 - BINANCE_FEE)
        trades.push({ time: bar.time, side: 'sell', price: exitPrice, quantity: positionQty, pnl })
        inPosition = false
        prevDipped = false
        equity.push({ time: bar.time, value: capital })
        continue
      }
    } else if (j4h !== undefined && j4h >= consolidationBars - 1) {
      let inConsolidation = true
      let lbMin = Infinity
      for (let k = j4h - consolidationBars + 1; k <= j4h; k++) {
        const m1 = ma1Vals[k], m2 = ma2Vals[k], m3 = ma3Vals[k]
        if (isNaN(m1) || isNaN(m2) || isNaN(m3)) { inConsolidation = false; break }
        const hi = Math.max(m1, m2, m3), lo = Math.min(m1, m2, m3)
        if ((hi - lo) / ((m1 + m2 + m3) / 3) > threshold) { inConsolidation = false; break }
        if (klines4h[k].close < lo) { inConsolidation = false; break }
        lbMin = Math.min(lbMin, lo)
      }

      if (inConsolidation && lbMin !== Infinity) {
        const lowerBound = lbMin
        if (prevDipped && price >= lowerBound && capital > 0) {
          const effectiveSize = Math.min(tradeSize, capital * 0.999)
          positionQty = effectiveSize / price
          entryPrice = price
          trailingHigh = price
          sl = lowerBound
          capital -= effectiveSize * (1 + BINANCE_FEE)
          inPosition = true
          prevDipped = false
          trades.push({ time: bar.time, side: 'buy', price, quantity: positionQty })
        } else if (price < lowerBound) {
          prevDipped = true
        } else {
          prevDipped = false
        }
      } else {
        prevDipped = false
      }
    } else {
      prevDipped = false
    }

    equity.push({ time: bar.time, value: capital + (inPosition ? positionQty * price : 0) })
  }

  if (inPosition) {
    const price = klines1h.at(-1)!.close
    const pnl = (price - entryPrice) * positionQty
    capital += positionQty * price * (1 - BINANCE_FEE)
    trades.push({ time: klines1h.at(-1)!.time, side: 'sell', price, quantity: positionQty, pnl })
  }

  return calcStats(initialCapital, trades, equity)
}
