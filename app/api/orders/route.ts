import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const limit = Math.min(Number(searchParams.get('limit') || 100), 500)
  const symbol = searchParams.get('symbol')
  const date = searchParams.get('date') // YYYY-MM-DD

  const conditions: string[] = []
  const args: (string | number)[] = []

  if (symbol) { conditions.push('o.symbol = ?'); args.push(symbol) }
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
