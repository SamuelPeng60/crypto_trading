import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb()
  const rows = db.prepare(`
    SELECT p.*, s.name as strategy_name, s.type as strategy_type
    FROM positions p
    LEFT JOIN strategies s ON p.strategy_id = s.id
    WHERE p.mode = 'paper'
    ORDER BY p.opened_at DESC
  `).all()
  return NextResponse.json(rows)
}
