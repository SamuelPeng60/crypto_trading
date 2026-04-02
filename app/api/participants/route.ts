import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM participants ORDER BY created_at ASC').all()
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO participants (name, investment, start_date, current_pnl, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(body.name, body.investment ?? 0, body.start_date, body.current_pnl ?? 0, body.note ?? null)
  return NextResponse.json({ id: result.lastInsertRowid })
}

export async function PUT(req: NextRequest) {
  const body = await req.json()
  const db = getDb()
  db.prepare(`
    UPDATE participants SET name=?, investment=?, start_date=?, current_pnl=?, note=?, updated_at=datetime('now')
    WHERE id=?
  `).run(body.name, body.investment, body.start_date, body.current_pnl, body.note ?? null, body.id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const db = getDb()
  db.prepare('DELETE FROM participants WHERE id=?').run(id)
  return NextResponse.json({ ok: true })
}
