import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const modeParam = req.nextUrl.searchParams.get('mode') ?? 'paper'

  let rows
  if (modeParam === 'all') {
    rows = db.prepare(`
      SELECT p.*, s.name as strategy_name, s.type as strategy_type
      FROM positions p
      LEFT JOIN strategies s ON p.strategy_id = s.id
      ORDER BY p.opened_at DESC
    `).all()
  } else {
    const safeMode = modeParam === 'live' ? 'live' : 'paper'
    rows = db.prepare(`
      SELECT p.*, s.name as strategy_name, s.type as strategy_type
      FROM positions p
      LEFT JOIN strategies s ON p.strategy_id = s.id
      WHERE p.mode = ?
      ORDER BY p.opened_at DESC
    `).all(safeMode)
  }
  return NextResponse.json(rows)
}
