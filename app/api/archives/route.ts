import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { manualClosePosition } from '@/lib/engine'

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
  // 複用 manualClosePosition（引擎鎖、實際餘額、冪等下單、實際成交價、通知）。
  // 任何一筆平倉失敗就中止封存：以前失敗的持倉照樣被標上 archive_id、策略全部停掉，
  // 幣留在幣安卻沒有任何策略管它，而且之後重啟策略時引擎會把封存持倉當成現有持倉。
  const openIds = (db.prepare('SELECT id FROM positions WHERE archive_id IS NULL').all() as { id: number }[]).map(r => r.id)
  const closeErrors: string[] = []
  for (const id of openIds) {
    const r = await manualClosePosition(id, '封存平倉')
    if (!r.ok) closeErrors.push(r.message)
  }
  if (closeErrors.length) {
    return NextResponse.json({ error: '部分持倉平倉失敗，已中止封存（已成功平倉的保留）', closeErrors }, { status: 409 })
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
  return NextResponse.json({ ok: true, ...result })
}
