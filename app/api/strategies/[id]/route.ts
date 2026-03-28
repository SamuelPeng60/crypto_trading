import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const db = getDb()
  db.prepare(`
    UPDATE strategies SET name=?, symbol=?, params=?, is_active=?, updated_at=datetime('now')
    WHERE id=?
  `).run(body.name, body.symbol, JSON.stringify(body.params), body.is_active ? 1 : 0, id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getDb()
  // Delete related records first (foreign_keys = ON blocks parent delete if children exist)
  db.prepare('DELETE FROM positions WHERE strategy_id=?').run(id)
  db.prepare('DELETE FROM orders WHERE strategy_id=?').run(id)
  db.prepare('DELETE FROM strategy_logs WHERE strategy_id=?').run(id)
  db.prepare('DELETE FROM strategies WHERE id=?').run(id)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { is_active } = await req.json()
  const db = getDb()
  db.prepare(`UPDATE strategies SET is_active=?, updated_at=datetime('now') WHERE id=?`).run(
    is_active ? 1 : 0, id
  )
  return NextResponse.json({ ok: true })
}
