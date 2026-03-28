import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const strategyId = searchParams.get('strategyId')
  const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
  const db = getDb()
  const rows = db.prepare(`
    SELECT l.*, s.name as strategy_name
    FROM strategy_logs l
    LEFT JOIN strategies s ON l.strategy_id = s.id
    ${strategyId ? 'WHERE l.strategy_id = ?' : ''}
    ORDER BY l.id DESC LIMIT ?
  `).all(...(strategyId ? [strategyId, limit] : [limit]))
  return NextResponse.json(rows)
}
