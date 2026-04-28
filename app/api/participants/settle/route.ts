import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { fetchTicker, placeOrder, fetchAssetBalance, fetchLotStepSize, roundQty } from '@/lib/binance'

const BINANCE_FEE = 0.001

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, final_pnl } = await req.json()
  if (!id || final_pnl === undefined) return NextResponse.json({ error: '缺少參數' }, { status: 400 })

  const db = getDb()
  const participant = db.prepare(
    'SELECT * FROM participants WHERE id = ?'
  ).get(id) as {
    id: number; name: string; investment: number; start_date: string
    bound_session_id: string | null; settled_at: string | null
  } | undefined

  if (!participant) return NextResponse.json({ error: '找不到參與者' }, { status: 404 })
  if (participant.settled_at) return NextResponse.json({ error: '該參與者已結算' }, { status: 400 })
  if (!participant.bound_session_id) return NextResponse.json({ error: '該參與者未綁定策略' }, { status: 400 })

  const sessId = participant.bound_session_id
  const strategies = db.prepare(
    "SELECT * FROM strategies WHERE session_id = ?"
  ).all(sessId) as { id: number; params: string; mode: string; symbol: string }[]

  if (!strategies.length) return NextResponse.json({ error: '找不到綁定的策略' }, { status: 404 })

  const totalTradeSize = strategies.reduce((sum, s) => {
    try { return sum + (JSON.parse(s.params).tradeSize ?? 0) } catch { return sum }
  }, 0)
  if (totalTradeSize <= 0) return NextResponse.json({ error: '策略 tradeSize 為 0，無法計算比例' }, { status: 400 })

  const ratio = participant.investment / totalTradeSize
  const settings = getSettings()
  const closeErrors: string[] = []
  const now = new Date().toISOString()

  // ── Step 1: Sell participant's share of each open position ──
  for (const strat of strategies) {
    const pos = db.prepare(
      'SELECT * FROM positions WHERE strategy_id = ? AND archive_id IS NULL'
    ).get(strat.id) as {
      id: number; quantity: number; entry_price: number; symbol: string; mode: string
    } | undefined
    if (!pos) continue

    const sellQtyRaw = pos.quantity * ratio

    try {
      const ticker = await fetchTicker(pos.symbol)
      const curPrice = ticker.price
      const stepSize = await fetchLotStepSize(pos.symbol)

      let sellQtyStr: string
      if (pos.mode === 'live') {
        const asset = pos.symbol.replace('USDT', '').replace('/', '')
        const freeBalance = await fetchAssetBalance(settings.apiKey, settings.apiSecret, asset)
        sellQtyStr = roundQty(Math.min(sellQtyRaw, freeBalance), stepSize)
        await placeOrder(settings.apiKey, settings.apiSecret, pos.symbol, 'SELL', sellQtyStr)
      } else {
        sellQtyStr = roundQty(sellQtyRaw, stepSize)
      }

      const soldQty = parseFloat(sellQtyStr)
      const pnl = Math.round(soldQty * (curPrice * (1 - BINANCE_FEE) - pos.entry_price * (1 + BINANCE_FEE)) * 100) / 100

      // Record the sell order
      db.prepare(`
        INSERT INTO orders (strategy_id, symbol, side, order_type, price, quantity, filled_price, status, pnl, mode, closed_at)
        VALUES (?, ?, 'sell', 'market', ?, ?, ?, 'filled', ?, ?, ?)
      `).run(strat.id, pos.symbol, curPrice, soldQty, curPrice, pnl, pos.mode, now)

      // Reduce position quantity; delete if fully exited
      const remaining = Math.round((pos.quantity - soldQty) * 1e8) / 1e8
      if (remaining <= 0) {
        db.prepare('DELETE FROM positions WHERE id = ?').run(pos.id)
      } else {
        db.prepare('UPDATE positions SET quantity = ? WHERE id = ?').run(remaining, pos.id)
      }
    } catch (e) {
      closeErrors.push(`${pos.symbol}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // ── Step 2: Reduce each strategy's tradeSize by participant's share ──
  for (const strat of strategies) {
    try {
      const params = JSON.parse(strat.params)
      if (typeof params.tradeSize === 'number' && params.tradeSize > 0) {
        params.tradeSize = Math.round((params.tradeSize - params.tradeSize * ratio) * 100) / 100
        db.prepare("UPDATE strategies SET params = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(params), strat.id)
      }
    } catch { /* ignore parse errors */ }
  }

  // ── Step 3: Mark participant as settled ──
  db.prepare(`
    UPDATE participants SET settled_at = ?, final_pnl = ?, bound_session_id = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(now, final_pnl, id)

  return NextResponse.json({
    ok: true,
    name: participant.name,
    final_pnl,
    closeErrors: closeErrors.length ? closeErrors : undefined,
  })
}
