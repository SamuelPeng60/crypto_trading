import { getDb } from './db'
import { fetchKlines, placeOrder, Kline } from './binance'
import { sma, ema, rsi, supertrend, bollingerBands, vwap as calcVwap, atr as calcAtr, macd as calcMacd } from './indicators'
import { getSettings } from './settings'
import { sendTelegramMessage } from './notify'
import type { Interval } from './binance'

export type Signal = 'buy' | 'sell' | 'hold'

interface StrategyRow {
  id: number
  name: string
  type: string
  symbol: string
  params: string
  last_signal: string
}

interface PositionRow {
  id: number
  strategy_id: number
  symbol: string
  side: string
  entry_price: number
  quantity: number
  current_price: number
  unrealized_pnl: number
  mode: string
}

// ── Risk management ─────────────────────────────────────────────────────────

function checkRiskLimits(): { ok: boolean; reason?: string } {
  const db = getDb()
  const settings = getSettings()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()
  const row = db.prepare(`
    SELECT COALESCE(SUM(pnl), 0) as total FROM orders
    WHERE pnl < 0 AND COALESCE(closed_at, created_at) >= ?
  `).get(todayISO) as { total: number }
  const todayLoss = Math.abs(row.total)
  if (settings.maxDailyLoss > 0 && todayLoss >= settings.maxDailyLoss) {
    return { ok: false, reason: `日損失 $${todayLoss.toFixed(2)} 已達上限 $${settings.maxDailyLoss}` }
  }
  return { ok: true }
}

// ── Notifications ────────────────────────────────────────────────────────────

async function notify(message: string) {
  const { telegramBotToken, telegramChatId } = getSettings()
  await sendTelegramMessage(telegramBotToken, telegramChatId, message)
}

// ── Logging ──────────────────────────────────────────────────────────────────

function logStrategy(db: ReturnType<typeof getDb>, strategyId: number, level: 'info' | 'warn' | 'error', message: string) {
  db.prepare('INSERT INTO strategy_logs (strategy_id, level, message) VALUES (?, ?, ?)').run(strategyId, level, message)
}

// ── Signal computation ──────────────────────────────────────────────────────

function maCrossSignal(klines: Kline[], p: Record<string, unknown>): Signal {
  const cls = klines.map(k => k.close)
  const fn = p.maType === 'sma' ? sma : ema
  const fast = fn(cls, p.fastPeriod as number)
  const slow = fn(cls, p.slowPeriod as number)
  const n = cls.length
  if (isNaN(fast[n - 1]) || isNaN(slow[n - 1]) || isNaN(fast[n - 2]) || isNaN(slow[n - 2])) return 'hold'
  if (fast[n - 2] <= slow[n - 2] && fast[n - 1] > slow[n - 1]) return 'buy'
  if (fast[n - 2] >= slow[n - 2] && fast[n - 1] < slow[n - 1]) return 'sell'
  return 'hold'
}

function rsiSignal(klines: Kline[], p: Record<string, unknown>): Signal {
  const cls = klines.map(k => k.close)
  const vals = rsi(cls, p.period as number)
  const cur = vals[vals.length - 1]
  if (isNaN(cur)) return 'hold'
  if (cur <= (p.oversold as number)) return 'buy'
  if (cur >= (p.overbought as number)) return 'sell'
  return 'hold'
}

function supertrendSignal(klines: Kline[], p: Record<string, unknown>): Signal {
  const { direction } = supertrend(klines, p.atrPeriod as number, p.multiplier as number)
  const n = direction.length
  if (n < 2) return 'hold'
  const cls = klines.map(k => k.close)
  if (p.ema200Filter) {
    const e200 = ema(cls, 200)
    const curE200 = e200[e200.length - 1]
    const curPrice = cls[cls.length - 1]
    if (!isNaN(curE200)) {
      if (direction[n - 2] === -1 && direction[n - 1] === 1 && curPrice > curE200) return 'buy'
      if (direction[n - 2] === 1 && direction[n - 1] === -1 && curPrice < curE200) return 'sell'
      return 'hold'
    }
  }
  if (direction[n - 2] === -1 && direction[n - 1] === 1) return 'buy'
  if (direction[n - 2] === 1 && direction[n - 1] === -1) return 'sell'
  return 'hold'
}

function vwapBbRsiSignal(klines: Kline[], p: Record<string, unknown>): Signal {
  const cls = klines.map(k => k.close)
  const rsiVals = rsi(cls, p.rsiPeriod as number)
  const bb = bollingerBands(cls, p.bbPeriod as number, p.bbStdDev as number)
  const vwapVals = calcVwap(klines, p.vwapWindow as number)
  const n = cls.length
  const curRsi = rsiVals[n - 1]
  const curLower = bb.lower[n - 1]
  const curUpper = bb.upper[n - 1]
  const curVwap = vwapVals[n - 1]
  const curPrice = cls[n - 1]
  if (isNaN(curRsi) || isNaN(curLower) || isNaN(curVwap)) return 'hold'
  const buy = (curRsi < (p.rsiOversold as number) || curPrice < curLower) && curPrice < curVwap
  const sell = (curRsi > (p.rsiOverbought as number) || curPrice > curUpper) && curPrice > curVwap
  if (buy) return 'buy'
  if (sell) return 'sell'
  return 'hold'
}

function emaRibbonStSignal(klines: Kline[], p: Record<string, unknown>): Signal {
  const cls = klines.map(k => k.close)
  const ema9Val  = ema(cls, p.fastEma as number || 9)
  const ema21Val = ema(cls, p.midEma  as number || 21)
  const ema55Val = ema(cls, p.slowEma as number || 55)
  const { direction } = supertrend(klines, p.atrPeriod as number || 10, p.multiplier as number || 3)
  const n = cls.length
  if (n < 2 || isNaN(ema9Val[n - 1]) || isNaN(ema21Val[n - 1]) || isNaN(ema55Val[n - 1])) return 'hold'

  const ribbonBull  = ema9Val[n - 1] > ema21Val[n - 1] && ema21Val[n - 1] > ema55Val[n - 1]
  const ribbonBreak = ema9Val[n - 1] < ema21Val[n - 1]
  const stFlipUp    = direction[n - 2] === -1 && direction[n - 1] === 1
  const stFlipDown  = direction[n - 2] === 1  && direction[n - 1] === -1

  if (p.ema200Filter) {
    const e200 = ema(cls, 200)
    const curE200 = e200[n - 1]
    if (!isNaN(curE200) && cls[n - 1] < curE200) return 'hold'
  }

  if (stFlipUp && ribbonBull) return 'buy'
  if (stFlipDown || ribbonBreak) return 'sell'
  return 'hold'
}

function macdBbSqueezeSignal(klines: Kline[], p: Record<string, unknown>): Signal {
  const cls = klines.map(k => k.close)
  const macdVals = calcMacd(cls, p.macdFast as number || 12, p.macdSlow as number || 26, p.macdSignal as number || 9)
  const rsiVals  = rsi(cls, p.rsiPeriod as number || 14)
  const n = cls.length
  if (n < 2 || isNaN(macdVals.histogram[n - 1])) return 'hold'

  const macdCrossUp = macdVals.histogram[n - 1] > 0 && macdVals.histogram[n - 2] <= 0
  const macdFlipDown = macdVals.histogram[n - 1] < 0

  // Exit signals
  if (macdFlipDown || rsiVals[n - 1] > 75) return 'sell'

  if (macdCrossUp) {
    const rsiOk = rsiVals[n - 1] >= 40 && rsiVals[n - 1] <= 65
    if (!rsiOk) return 'hold'
    if (p.ema200Filter) {
      const e200 = ema(cls, 200)
      if (!isNaN(e200[n - 1]) && cls[n - 1] < e200[n - 1]) return 'hold'
    }
    return 'buy'
  }
  return 'hold'
}

function gridSignal(klines: Kline[], p: Record<string, unknown>): Signal {
  const curPrice = klines[klines.length - 1].close
  const upper = p.upperPrice as number
  const lower = p.lowerPrice as number
  if (!upper || !lower || upper <= lower) return 'hold'
  const ratio = (curPrice - lower) / (upper - lower)
  if (ratio < 0.3) return 'buy'
  if (ratio > 0.7) return 'sell'
  return 'hold'
}

export function computeSignal(type: string, params: Record<string, unknown>, klines: Kline[]): Signal {
  try {
    switch (type) {
      case 'ma_cross':    return maCrossSignal(klines, params)
      case 'rsi':         return rsiSignal(klines, params)
      case 'supertrend':  return supertrendSignal(klines, params)
      case 'vwap_bb_rsi':    return vwapBbRsiSignal(klines, params)
      case 'ema_ribbon_st':  return emaRibbonStSignal(klines, params)
      case 'macd_bb_squeeze': return macdBbSqueezeSignal(klines, params)
      case 'grid':           return gridSignal(klines, params)
      default:            return 'hold'
    }
  } catch {
    return 'hold'
  }
}

// ── Order helpers ───────────────────────────────────────────────────────────

function insertOrder(
  db: ReturnType<typeof getDb>,
  strategyId: number,
  symbol: string,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  mode: string,
  pnl?: number,
  exchangeId?: string,
) {
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO orders (strategy_id, symbol, side, order_type, price, quantity, filled_price, status, pnl, mode, exchange_id, closed_at)
    VALUES (?, ?, ?, 'market', ?, ?, ?, 'filled', ?, ?, ?, ?)
  `).run(strategyId, symbol, side, price, quantity, price, pnl ?? null, mode, exchangeId ?? null, side === 'sell' ? now : null)
}

function openPosition(
  db: ReturnType<typeof getDb>,
  strategyId: number,
  symbol: string,
  price: number,
  quantity: number,
  mode: string,
) {
  db.prepare(`
    INSERT OR REPLACE INTO positions (strategy_id, symbol, side, entry_price, quantity, current_price, unrealized_pnl, mode)
    VALUES (?, ?, 'long', ?, ?, ?, 0, ?)
  `).run(strategyId, symbol, price, quantity, price, mode)
}

function closePosition(
  db: ReturnType<typeof getDb>,
  position: PositionRow,
  curPrice: number,
  strategyId: number,
  symbol: string,
  mode: string,
  reason: string,
  exchangeId?: string,
): string {
  const pnl = (curPrice - position.entry_price) * position.quantity
  insertOrder(db, strategyId, symbol, 'sell', curPrice, position.quantity, mode, pnl, exchangeId)
  db.prepare('DELETE FROM positions WHERE id = ?').run(position.id)
  return `${reason} @ ${curPrice.toFixed(2)}, PnL=${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`
}

// ── Main tick ───────────────────────────────────────────────────────────────

export async function runStrategyTick(strategyId: number): Promise<{ signal: Signal; message: string }> {
  const db = getDb()
  const strategy = db.prepare('SELECT * FROM strategies WHERE id = ?').get(strategyId) as StrategyRow | undefined
  if (!strategy) return { signal: 'hold', message: 'Strategy not found' }

  // Risk check before any action
  const risk = checkRiskLimits()
  if (!risk.ok) {
    db.prepare("UPDATE strategies SET is_active=0, updated_at=datetime('now') WHERE id=?").run(strategyId)
    const msg = `風控停止: ${risk.reason}`
    logStrategy(db, strategyId, 'warn', msg)
    await notify(`⛔ *${strategy.name}* 已被風控停止\n${risk.reason}`)
    return { signal: 'hold', message: msg }
  }

  const settings = getSettings()
  const mode = settings.mode
  const params = JSON.parse(strategy.params) as Record<string, unknown>
  const interval = ((params.interval as string) || '1h') as Interval
  const limit = Math.max(300, ((params.slowPeriod as number) || 0) * 2 + 50)

  let klines: Kline[]
  try {
    klines = await fetchKlines(strategy.symbol, interval, limit)
  } catch (e) {
    const msg = `K線抓取失敗: ${e}`
    logStrategy(db, strategyId, 'error', msg)
    return { signal: 'hold', message: msg }
  }

  const signal = computeSignal(strategy.type, params, klines)
  const curPrice = klines[klines.length - 1].close

  const position = db.prepare(
    'SELECT * FROM positions WHERE strategy_id = ? AND symbol = ? AND mode = ?'
  ).get(strategyId, strategy.symbol, mode) as PositionRow | undefined

  const modeLabel = mode === 'live' ? '🔴 實盤' : '🟡 模擬'

  // Helper: persist last_signal for next tick
  const saveSignal = (s: Signal) => {
    db.prepare("UPDATE strategies SET last_signal=?, updated_at=datetime('now') WHERE id=?").run(s, strategyId)
  }

  // ── Open position on buy signal ──
  // Guard: only enter on a FRESH buy (previous tick was not already 'buy')
  // This prevents immediately buying on activation if conditions happen to be met
  const isFreshBuy = signal === 'buy' && strategy.last_signal !== 'buy'
  if (isFreshBuy && !position) {
    let rawSize = ((params.tradeSize as number) || (params.amountPerGrid as number) || 1000)
    if (settings.maxPositionSize > 0) rawSize = Math.min(rawSize, settings.maxPositionSize)
    const qty = rawSize / curPrice

    let exchangeId: string | undefined
    if (mode === 'live') {
      try {
        const result = await placeOrder(settings.apiKey, settings.apiSecret, strategy.symbol, 'BUY', qty.toFixed(6))
        exchangeId = result.orderId
      } catch (e) {
        const msg = `實盤下單失敗: ${e}`
        logStrategy(db, strategyId, 'error', msg)
        await notify(`❌ *${strategy.name}* 買單失敗\n${msg}`)
        return { signal: 'hold', message: msg }
      }
    }

    insertOrder(db, strategyId, strategy.symbol, 'buy', curPrice, qty, mode, undefined, exchangeId)
    openPosition(db, strategyId, strategy.symbol, curPrice, qty, mode)
    const msg = `BUY @ ${curPrice.toFixed(2)}, qty=${qty.toFixed(6)}`
    logStrategy(db, strategyId, 'info', msg)
    await notify(`📈 *${strategy.name}* 買入\n${strategy.symbol} @ $${curPrice.toLocaleString()}\n數量: ${qty.toFixed(6)}\n${modeLabel}`)
    saveSignal('buy')
    return { signal, message: msg }
  }

  // ── Close position on sell signal ──
  if (signal === 'sell' && position) {
    let exchangeId: string | undefined
    if (mode === 'live') {
      try {
        const result = await placeOrder(settings.apiKey, settings.apiSecret, strategy.symbol, 'SELL', position.quantity.toFixed(6))
        exchangeId = result.orderId
      } catch (e) {
        const msg = `實盤賣單失敗: ${e}`
        logStrategy(db, strategyId, 'error', msg)
        await notify(`❌ *${strategy.name}* 賣單失敗\n${msg}`)
        return { signal: 'hold', message: msg }
      }
    }
    const msg = closePosition(db, position, curPrice, strategyId, strategy.symbol, mode, 'SELL', exchangeId)
    logStrategy(db, strategyId, 'info', msg)
    const pnl = (curPrice - position.entry_price) * position.quantity
    await notify(`📉 *${strategy.name}* 賣出\n${strategy.symbol} @ $${curPrice.toLocaleString()}\nPnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}\n${modeLabel}`)
    saveSignal('sell')
    return { signal, message: msg }
  }

  // ── SL / TP check on open position ──
  if (position) {
    const unrealizedPnl = (curPrice - position.entry_price) * position.quantity
    db.prepare('UPDATE positions SET current_price = ?, unrealized_pnl = ? WHERE id = ?')
      .run(curPrice, unrealizedPnl, position.id)

    // Fixed % stop-loss
    if (params.stopLoss) {
      const slPrice = position.entry_price * (1 - (params.stopLoss as number) / 100)
      if (curPrice <= slPrice) {
        let exchangeId: string | undefined
        if (mode === 'live') {
          try {
            const result = await placeOrder(settings.apiKey, settings.apiSecret, strategy.symbol, 'SELL', position.quantity.toFixed(6))
            exchangeId = result.orderId
          } catch { /* continue to close locally */ }
        }
        const msg = closePosition(db, position, curPrice, strategyId, strategy.symbol, mode, 'SL HIT', exchangeId)
        logStrategy(db, strategyId, 'warn', msg)
        const pnl = (curPrice - position.entry_price) * position.quantity
        await notify(`🛑 *${strategy.name}* 止損\n${strategy.symbol} @ $${curPrice.toLocaleString()}\nPnL: $${pnl.toFixed(2)}\n${modeLabel}`)
        saveSignal('sell')
        return { signal: 'sell', message: msg }
      }
    }

    // Fixed % take-profit
    if (params.takeProfit) {
      const tpPrice = position.entry_price * (1 + (params.takeProfit as number) / 100)
      if (curPrice >= tpPrice) {
        let exchangeId: string | undefined
        if (mode === 'live') {
          try {
            const result = await placeOrder(settings.apiKey, settings.apiSecret, strategy.symbol, 'SELL', position.quantity.toFixed(6))
            exchangeId = result.orderId
          } catch { /* continue to close locally */ }
        }
        const msg = closePosition(db, position, curPrice, strategyId, strategy.symbol, mode, 'TP HIT', exchangeId)
        logStrategy(db, strategyId, 'info', msg)
        const pnl = (curPrice - position.entry_price) * position.quantity
        await notify(`🎯 *${strategy.name}* 止盈\n${strategy.symbol} @ $${curPrice.toLocaleString()}\nPnL: +$${pnl.toFixed(2)}\n${modeLabel}`)
        saveSignal('sell')
        return { signal: 'sell', message: msg }
      }
    }

    // ATR-based take-profit (for macd_bb_squeeze)
    if (params.atrTpMultiplier) {
      const atrVals = calcAtr(klines, (params.atrPeriod as number) || 14)
      const curAtr = atrVals[atrVals.length - 1]
      if (!isNaN(curAtr)) {
        const tpPrice = position.entry_price + (params.atrTpMultiplier as number) * curAtr
        if (curPrice >= tpPrice) {
          let exchangeId: string | undefined
          if (mode === 'live') {
            try {
              const result = await placeOrder(settings.apiKey, settings.apiSecret, strategy.symbol, 'SELL', position.quantity.toFixed(6))
              exchangeId = result.orderId
            } catch { /* continue to close locally */ }
          }
          const msg = closePosition(db, position, curPrice, strategyId, strategy.symbol, mode, 'ATR TP', exchangeId)
          logStrategy(db, strategyId, 'info', msg)
          const pnl = (curPrice - position.entry_price) * position.quantity
          await notify(`🎯 *${strategy.name}* ATR 止盈\n${strategy.symbol} @ $${curPrice.toLocaleString()}\nPnL: +$${pnl.toFixed(2)}\n${modeLabel}`)
          saveSignal('sell')
          return { signal: 'sell', message: msg }
        }
      }
    }

    // ATR-based stop-loss
    if (params.atrSlMultiplier) {
      const atrVals = calcAtr(klines, (params.atrPeriod as number) || 14)
      const curAtr = atrVals[atrVals.length - 1]
      if (!isNaN(curAtr)) {
        const slPrice = position.entry_price - (params.atrSlMultiplier as number) * curAtr
        if (curPrice <= slPrice) {
          let exchangeId: string | undefined
          if (mode === 'live') {
            try {
              const result = await placeOrder(settings.apiKey, settings.apiSecret, strategy.symbol, 'SELL', position.quantity.toFixed(6))
              exchangeId = result.orderId
            } catch { /* continue to close locally */ }
          }
          const msg = closePosition(db, position, curPrice, strategyId, strategy.symbol, mode, 'ATR SL', exchangeId)
          logStrategy(db, strategyId, 'warn', msg)
          const pnl = (curPrice - position.entry_price) * position.quantity
          await notify(`🛑 *${strategy.name}* ATR 止損\n${strategy.symbol} @ $${curPrice.toLocaleString()}\nPnL: $${pnl.toFixed(2)}\n${modeLabel}`)
          saveSignal('sell')
          return { signal: 'sell', message: msg }
        }
      }
    }

    const pnlStr = `${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}`
    saveSignal(signal)
    return { signal: 'hold', message: `HOLD @ ${curPrice.toFixed(2)}, 浮動盈虧 ${pnlStr} USDT` }
  }

  saveSignal(signal)
  return { signal: 'hold', message: `HOLD @ ${curPrice.toFixed(2)}` }
}

export async function runAllActiveTick(): Promise<Array<{ strategyId: number; name: string; signal: Signal; message: string }>> {
  const db = getDb()
  const strategies = db.prepare('SELECT * FROM strategies WHERE is_active = 1').all() as StrategyRow[]
  const results = await Promise.all(
    strategies.map(async (s) => {
      const result = await runStrategyTick(s.id)
      return { strategyId: s.id, name: s.name, ...result }
    })
  )
  return results
}
