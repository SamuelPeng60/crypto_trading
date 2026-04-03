import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const archives = db.prepare(`
    SELECT * FROM archives ORDER BY created_at DESC
  `).all()
  return NextResponse.json(archives)
}

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = getDb()
  const body = await req.json().catch(() => ({}))
  const name: string = body.name?.trim() || `封存 ${new Date().toLocaleDateString('zh-TW')}`
  const notes: string = body.notes?.trim() || ''

  // Check there's something to archive
  const count = (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE archive_id IS NULL`).get() as { c: number }).c
  if (count === 0) return NextResponse.json({ error: '目前沒有任何交易記錄可封存' }, { status: 400 })

  const doArchive = db.transaction(() => {
    // Compute summary from current (unarchived) orders
    const orders = db.prepare(`
      SELECT pnl, COALESCE(closed_at, created_at) as ts
      FROM orders WHERE side = 'sell' AND pnl IS NOT NULL AND archive_id IS NULL
      ORDER BY ts ASC
    `).all() as { pnl: number; ts: string }[]

    const totalPnl = Math.round(orders.reduce((s, o) => s + o.pnl, 0) * 100) / 100
    const totalTrades = orders.length
    const wins = orders.filter(o => o.pnl > 0).length
    const winRate = totalTrades ? Math.round((wins / totalTrades) * 1000) / 10 : 0
    const periodStart = orders[0]?.ts?.slice(0, 10) ?? null
    const periodEnd = orders[orders.length - 1]?.ts?.slice(0, 10) ?? null

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
  return NextResponse.json({ ok: true, ...result })
}
