import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

type Ctx = { params: Promise<{ sessionId: string }> }

// PATCH: stop all in session
export async function PATCH(_: NextRequest, { params }: Ctx) {
  const { sessionId } = await params
  const db = getDb()
  db.prepare("UPDATE strategies SET is_active=0, updated_at=datetime('now') WHERE session_id=?").run(sessionId)
  return NextResponse.json({ ok: true })
}

// DELETE: delete all in session (and their orders/positions/logs)
export async function DELETE(_: NextRequest, { params }: Ctx) {
  const { sessionId } = await params
  const db = getDb()
  const strategies = db.prepare('SELECT id FROM strategies WHERE session_id=?').all(sessionId) as { id: number }[]
  const ids = strategies.map(s => s.id)
  if (ids.length) {
    const ph = ids.map(() => '?').join(',')
    db.prepare(`DELETE FROM positions WHERE strategy_id IN (${ph})`).run(...ids)
    db.prepare(`DELETE FROM orders WHERE strategy_id IN (${ph})`).run(...ids)
    db.prepare(`DELETE FROM strategy_logs WHERE strategy_id IN (${ph})`).run(...ids)
    db.prepare(`DELETE FROM strategies WHERE id IN (${ph})`).run(...ids)
  }
  return NextResponse.json({ ok: true })
}
