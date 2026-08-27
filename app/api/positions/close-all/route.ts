import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { manualClosePosition } from '@/lib/engine'

// 一鍵平倉 = 對每個持倉跑一次與「個別平倉」完全相同的流程（lib/engine.ts manualClosePosition），
// 不另外實作一套下單/寫入邏輯。
export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const ids = (db.prepare('SELECT id FROM positions ORDER BY opened_at ASC').all() as { id: number }[]).map(r => r.id)
  if (ids.length === 0) return NextResponse.json({ closed: [], errors: [] })

  const closed: { symbol: string; price: number; pnl: number }[] = []
  const errors: string[] = []

  for (const id of ids) {
    const r = await manualClosePosition(id)
    if (r.ok) closed.push({ symbol: r.symbol!, price: r.price!, pnl: r.pnl! })
    else errors.push(r.message)
  }

  return NextResponse.json({ closed, errors })
}
