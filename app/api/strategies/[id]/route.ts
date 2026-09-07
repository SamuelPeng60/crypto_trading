import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { forceCloseSessionPositions } from '@/lib/engine'
import { getSessionFromCookieHeader } from '@/lib/auth'

function requireAdmin(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = requireAdmin(req); if (deny) return deny
  const { id } = await params
  const body = await req.json()
  const db = getDb()
  db.prepare(`
    UPDATE strategies SET name=?, symbol=?, params=?, is_active=?, updated_at=datetime('now')
    WHERE id=?
  `).run(body.name, body.symbol, JSON.stringify(body.params), body.is_active ? 1 : 0, id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = requireAdmin(req); if (deny) return deny
  const { id } = await params
  const db = getDb()

  // 先以現價強制平倉（同 session 版刪除）。少了這步，live 模式下幣安的幣還在，
  // DB 的持倉紀錄卻被直接刪掉。
  await forceCloseSessionPositions([Number(id)])

  // Delete related records first (foreign_keys = ON blocks parent delete if children exist)
  db.prepare('DELETE FROM positions WHERE strategy_id=?').run(id)
  // 封存過的訂單不能刪（同 /api/orders DELETE 的保護），否則歷史封存會被清空；
  // 改為切斷關聯保留紀錄。
  db.prepare('UPDATE orders SET strategy_id=NULL WHERE strategy_id=? AND archive_id IS NOT NULL').run(id)
  db.prepare('DELETE FROM orders WHERE strategy_id=? AND archive_id IS NULL').run(id)
  db.prepare('DELETE FROM strategy_logs WHERE strategy_id=?').run(id)
  // sl_streak 以 strategy_id 為主鍵，不清掉的話 SQLite 重用 id 時，
  // 新策略會繼承舊的 max_sl，動態止盈會提前觸發
  db.prepare('DELETE FROM sl_streak WHERE strategy_id=?').run(id)
  db.prepare('DELETE FROM strategies WHERE id=?').run(id)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const deny = requireAdmin(req); if (deny) return deny
  const { id } = await params
  const body = await req.json()
  const db = getDb()
  if ('params' in body) {
    // Merge new params fields into existing params JSON
    const row = db.prepare('SELECT params FROM strategies WHERE id=?').get(id) as { params: string } | undefined
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const merged = { ...JSON.parse(row.params), ...body.params }
    db.prepare(`UPDATE strategies SET params=?, updated_at=datetime('now') WHERE id=?`).run(
      JSON.stringify(merged), id
    )
  } else {
    db.prepare(`UPDATE strategies SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(
      body.is_active ? 1 : 0, id
    )
  }
  return NextResponse.json({ ok: true })
}
