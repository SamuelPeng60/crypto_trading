import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'

function requireAdmin(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = getDb()
  if (user.role === 'admin') {
    const rows = db.prepare('SELECT * FROM participants ORDER BY created_at ASC').all()
    return NextResponse.json(rows)
  }
  // Non-admin: return only the participant whose name matches the current user
  const rows = db.prepare('SELECT * FROM participants WHERE name=? ORDER BY created_at ASC').all(user.username)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny
  const body = await req.json()
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO participants (name, investment, start_date, current_pnl, note, bound_session_id, allocated)
    VALUES (?, ?, ?, ?, ?, ?, 0)
  `).run(body.name, body.investment ?? 0, body.start_date, body.current_pnl ?? 0, body.note ?? null, body.bound_session_id ?? null)
  return NextResponse.json({ id: result.lastInsertRowid })
}

export async function PUT(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny
  const body = await req.json()
  const db = getDb()

  // Get current state before update
  const old = db.prepare('SELECT bound_session_id, allocated, investment FROM participants WHERE id=?').get(body.id) as
    { bound_session_id: string | null; allocated: number; investment: number } | undefined

  const newSessionId: string | null = body.bound_session_id ?? null
  const newInvestment: number = body.investment ?? 0

  const newAllocated = newSessionId ? newInvestment : 0

  // Wrap all strategy param updates + participant update in a single transaction
  // to prevent partial state if the server crashes mid-loop
  const updateAll = db.transaction(() => {
    if (old) {
      const oldSessionId = old.bound_session_id
      const oldAllocated = old.allocated ?? 0

      // Revert from old session if session changed
      if (oldSessionId && oldSessionId !== newSessionId && oldAllocated > 0) {
        const oldStrats = db.prepare('SELECT id, params FROM strategies WHERE session_id=?').all(oldSessionId) as { id: number; params: string }[]
        if (oldStrats.length > 0) {
          const revertPerStrat = oldAllocated / oldStrats.length
          for (const s of oldStrats) {
            const p = JSON.parse(s.params)
            p.tradeSize = Math.max(0, (p.tradeSize ?? 0) - revertPerStrat)
            db.prepare("UPDATE strategies SET params=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(p), s.id)
          }
        }
      }

      // Apply to new session
      if (newSessionId) {
        const newStrats = db.prepare('SELECT id, params FROM strategies WHERE session_id=?').all(newSessionId) as { id: number; params: string }[]
        if (newStrats.length > 0) {
          const prevAllocated = (oldSessionId === newSessionId) ? oldAllocated : 0
          const delta = newInvestment - prevAllocated
          if (delta !== 0) {
            const deltaPerStrat = delta / newStrats.length
            for (const s of newStrats) {
              const p = JSON.parse(s.params)
              p.tradeSize = Math.max(0, (p.tradeSize ?? 0) + deltaPerStrat)
              db.prepare("UPDATE strategies SET params=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(p), s.id)
            }
          }
        }
      }
    }

    db.prepare(`
      UPDATE participants SET name=?, investment=?, start_date=?, current_pnl=?, note=?,
        bound_session_id=?, allocated=?, updated_at=datetime('now')
      WHERE id=?
    `).run(body.name, newInvestment, body.start_date, body.current_pnl, body.note ?? null,
      newSessionId, newAllocated, body.id)
  })

  updateAll()
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny
  const { id } = await req.json()
  const db = getDb()
  db.prepare('DELETE FROM participants WHERE id=?').run(id)
  return NextResponse.json({ ok: true })
}
