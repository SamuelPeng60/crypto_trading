import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { fetchTicker, placeOrder, fetchAssetBalance, fetchLotStepSize, roundQty } from '@/lib/binance'
import { getSettings } from '@/lib/settings'

const BINANCE_FEE = 0.001

interface PositionRow {
  id: number
  strategy_id: number
  symbol: string
  entry_price: number
  quantity: number
  current_price: number
  mode: string
}

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const settings = getSettings()

  const positions = db.prepare(`
    SELECT id, strategy_id, symbol, entry_price, quantity, current_price, mode
    FROM positions ORDER BY opened_at ASC
  `).all() as PositionRow[]

  if (positions.length === 0) return NextResponse.json({ closed: [], errors: [] })

  const closed: { symbol: string; price: number; pnl: number }[] = []
  const errors: string[] = []

  for (const pos of positions) {
    try {
      // Get fresh price; fall back to stored current_price if unavailable
      let price = pos.current_price
      try {
        const ticker = await fetchTicker(pos.symbol)
        price = ticker.price
      } catch { /* use stored price */ }

      let exchangeId: string | undefined

      if (pos.mode === 'live') {
        try {
          const asset = pos.symbol.replace('USDT', '')
          const stepSize = await fetchLotStepSize(pos.symbol)
          const freeBalance = await fetchAssetBalance(settings.apiKey, settings.apiSecret, asset)
          const qtyStr = roundQty(Math.min(pos.quantity, freeBalance), stepSize)
          const result = await placeOrder(settings.apiKey, settings.apiSecret, pos.symbol, 'SELL', qtyStr)
          exchangeId = result.orderId
          if (result.price && parseFloat(result.price) > 0) price = parseFloat(result.price)
        } catch (e) {
          errors.push(`${pos.symbol} 實盤賣出失敗: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
      }

      const pnl = pos.quantity * (price * (1 - BINANCE_FEE) - pos.entry_price * (1 + BINANCE_FEE))
      const now = new Date().toISOString()

      db.prepare(`
        INSERT INTO orders (strategy_id, symbol, side, order_type, price, quantity, filled_price, status, pnl, mode, exchange_id, closed_at)
        VALUES (?, ?, 'sell', 'market', ?, ?, ?, 'filled', ?, ?, ?, ?)
      `).run(pos.strategy_id, pos.symbol, price, pos.quantity, price, pnl, pos.mode, exchangeId ?? null, now)

      db.prepare('DELETE FROM positions WHERE id = ?').run(pos.id)

      closed.push({ symbol: pos.symbol, price, pnl })
    } catch (e) {
      errors.push(`${pos.symbol}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return NextResponse.json({ closed, errors })
}
