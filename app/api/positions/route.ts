import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const db = getDb()
  const modeParam = req.nextUrl.searchParams.get('mode') ?? 'paper'
  const modeFilter = modeParam === 'all' ? '' : `AND p.mode = '${modeParam === 'live' ? 'live' : 'paper'}'`
  const rows = db.prepare(`
    SELECT p.*, s.name as strategy_name, s.type as strategy_type
    FROM positions p
    LEFT JOIN strategies s ON p.strategy_id = s.id
    WHERE 1=1 ${modeFilter}
    ORDER BY p.opened_at DESC
  `).all()
  return NextResponse.json(rows)
}
