import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const rows = db.prepare('SELECT * FROM strategies ORDER BY session_id ASC, created_at DESC').all()
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { name, type, symbol, params, session_id, mode } = body
  if (!name || !type || !symbol || !params) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }
  const db = getDb()
  const result = db
    .prepare('INSERT INTO strategies (name, type, symbol, params, session_id, mode) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, type, symbol, JSON.stringify(params), session_id ?? null, mode === 'live' ? 'live' : 'paper')
  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}
