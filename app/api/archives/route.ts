import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { fetchTicker, placeOrder, fetchAssetBalance, fetchLotStepSize, roundQty } from '@/lib/binance'
import { getSettings } from '@/lib/settings'

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const archives = db.prepare(`
    SELECT * FROM archives ORDER BY created_at DESC
  `).all()
  return NextResponse.json(archives)
}

export async function DELETE(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 })

  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM orders WHERE archive_id = ?').run(id)
    db.prepare('DELETE FROM positions WHERE archive_id = ?').run(id)
    db.prepare('DELETE FROM archives WHERE id = ?').run(id)
  })()

  return NextResponse.json({ ok: true })
}

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = getDb()
  const body = await req.json().catch(() => ({}))
  const name: string = body.name?.trim() || `封存 ${new Date().toLocaleDateString('zh-TW')}`
  const notes: string = body.notes?.trim() || ''

  // ── Step 1: Close all open positions before archiving ──
  const openPositions = db.prepare(`
    SELECT p.*, s.strategy_id as sid, s.symbol, s.mode,
           st.id as strat_id
    FROM positions p
    JOIN strategies st ON st.id = p.strategy_id
    WHERE p.archive_id IS NULL
  `).all() as {
    id: number; strategy_id: number; symbol: string; mode: string
    entry_price: number; quantity: number; strat_id: number
  }[]

  const settings = getSettings()
  const closeErrors: string[] = []

  for (const pos of openPositions) {
    try {
      const ticker = await fetchTicker(pos.symbol)
      const curPrice = ticker.price
      const now = new Date().toISOString()

      let sellQtyStr: string
      if (pos.mode === 'live') {
        const asset = pos.symbol.replace('USDT', '').replace('/', '')
        const freeBalance = await fetchAssetBalance(settings.apiKey, settings.apiSecret, asset)
        const stepSize = await fetchLotStepSize(pos.symbol)
        sellQtyStr = roundQty(Math.min(pos.quantity, freeBalance), stepSize)
        await placeOrder(settings.apiKey, settings.apiSecret, pos.symbol, 'SELL', sellQtyStr)
      } else {
        const stepSize = await fetchLotStepSize(pos.symbol)
        sellQtyStr = roundQty(pos.quantity, stepSize)
      }

      const soldQty = parseFloat(sellQtyStr)
      const BINANCE_FEE = 0.001
      const pnl = Math.round(soldQty * (curPrice * (1 - BINANCE_FEE) - pos.entry_price * (1 + BINANCE_FEE)) * 100) / 100

      db.prepare(`
        INSERT INTO orders (strategy_id, symbol, side, order_type, price, quantity, filled_price, status, pnl, mode, closed_at)
        VALUES (?, ?, 'sell', 'market', ?, ?, ?, 'filled', ?, ?, ?)
      `).run(pos.strategy_id, pos.symbol, curPrice, soldQty, curPrice, pnl, pos.mode, now)

      db.prepare('DELETE FROM positions WHERE id = ?').run(pos.id)
    } catch (e) {
      closeErrors.push(`${pos.symbol}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Check there's something to archive
  const count = (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE archive_id IS NULL`).get() as { c: number }).c
  if (count === 0) return NextResponse.json({ error: '目前沒有任何交易記錄可封存' }, { status: 400 })

  const doArchive = db.transaction(() => {
    // Compute summary from current (unarchived) orders — now includes the closes above
    const orders = db.prepare(`
      SELECT pnl, COALESCE(closed_at, created_at) as ts
      FROM orders WHERE side = 'sell' AND pnl IS NOT NULL AND archive_id IS NULL
      ORDER BY ts ASC
    `).all() as { pnl: number; ts: string }[]

    const totalPnl = Math.round(orders.reduce((s, o) => s + o.pnl, 0) * 100) / 100
    const totalTrades = orders.length
    const wins = orders.filter(o => o.pnl > 0).length
    const winRate = totalTrades ? Math.round((wins / totalTrades) * 1000) / 10 : 0

    // period_start = earliest buy order (when strategies actually started trading)
    // period_end   = today (archive date)
    const firstBuy = db.prepare(`
      SELECT created_at FROM orders WHERE side = 'buy' AND archive_id IS NULL ORDER BY created_at ASC LIMIT 1
    `).get() as { created_at: string } | undefined
    const periodStart = (firstBuy?.created_at ?? orders[0]?.ts ?? new Date().toISOString()).slice(0, 10)
    const periodEnd = new Date().toISOString().slice(0, 10)

    // Create archive record
    const row = db.prepare(`
      INSERT INTO archives (name, notes, period_start, period_end, total_pnl, total_trades, win_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, notes || null, periodStart, periodEnd, totalPnl, totalTrades, winRate)
    const archiveId = row.lastInsertRowid

    // Tag all current orders and positions
    db.prepare(`UPDATE orders SET archive_id = ? WHERE archive_id IS NULL`).run(archiveId)
    db.prepare(`UPDATE positions SET archive_id = ? WHERE archive_id IS NULL`).run(archiveId)

    // Stop all active strategies
    db.prepare(`UPDATE strategies SET is_active = 0, last_signal = 'hold' WHERE is_active = 1`).run()

    return { archiveId, totalPnl, totalTrades, winRate, periodStart, periodEnd }
  })

  const result = doArchive()
  return NextResponse.json({ ok: true, ...result, closeErrors: closeErrors.length ? closeErrors : undefined })
}
