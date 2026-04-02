import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const limit = Math.min(Number(searchParams.get('limit') || 100), 500)
  const symbol = searchParams.get('symbol')
  const date = searchParams.get('date') // YYYY-MM-DD
  const strategyType = searchParams.get('strategyType')
  const strategyId = searchParams.get('strategyId')
  const side = searchParams.get('side')

  const sessionId = searchParams.get('sessionId')

  const conditions: string[] = []
  const args: (string | number)[] = []

  if (symbol) { conditions.push('o.symbol = ?'); args.push(symbol) }
  if (strategyType) { conditions.push('s.type = ?'); args.push(strategyType) }
  if (strategyId) { conditions.push('o.strategy_id = ?'); args.push(Number(strategyId)) }
  if (sessionId) { conditions.push('s.session_id = ?'); args.push(sessionId) }
  if (side) { conditions.push('o.side = ?'); args.push(side) }
  if (date) {
    conditions.push("DATE(COALESCE(o.closed_at, o.created_at)) = ?")
    args.push(date)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const db = getDb()
  const rows = db.prepare(`
    SELECT o.*, s.name as strategy_name, s.type as strategy_type
    FROM orders o
    LEFT JOIN strategies s ON o.strategy_id = s.id
    ${where}
    ORDER BY o.created_at DESC LIMIT ?
  `).all(...args, limit)
  return NextResponse.json(rows)
}

export async function DELETE(req: Request) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, all, mode } = await req.json()
  const db = getDb()

  if (all) {
    // Delete all orders, optionally filtered by mode
    if (mode && ['paper', 'live'].includes(mode)) {
      db.prepare('DELETE FROM orders WHERE mode = ?').run(mode)
    } else {
      db.prepare('DELETE FROM orders').run()
    }
    return NextResponse.json({ ok: true })
  }

  if (id) {
    db.prepare('DELETE FROM orders WHERE id = ?').run(id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '缺少參數' }, { status: 400 })
}
