import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM strategies ORDER BY session_id ASC, created_at DESC').all()
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { name, type, symbol, params, session_id } = body
  if (!name || !type || !symbol || !params) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  const db = getDb()
  const result = db
    .prepare('INSERT INTO strategies (name, type, symbol, params, session_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, type, symbol, JSON.stringify(params), session_id ?? null)
  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}
