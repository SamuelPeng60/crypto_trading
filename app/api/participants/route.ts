import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { readAllocations, applyAllocation, revertAllocation } from '@/lib/participants'

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
  const old = db.prepare('SELECT bound_session_id, allocated, allocations, investment FROM participants WHERE id=?').get(body.id) as
    { bound_session_id: string | null; allocated: number; allocations: string | null; investment: number } | undefined

  const newSessionId: string | null = body.bound_session_id ?? null
  const newInvestment: number = body.investment ?? 0

  const newAllocated = newSessionId ? newInvestment : 0

  // Wrap all strategy param updates + participant update in a single transaction
  // to prevent partial state if the server crashes mid-loop
  const updateAll = db.transaction(() => {
    // 綁定或金額沒變 → 保留原配置紀錄（只改名字等欄位時不要重新分配）。
    // 有變 → 依紀錄完整退還，再依目前啟用中的策略重新分配（lib/participants.ts）。
    let allocations: string | null = old?.allocations ?? null
    if (old && (old.bound_session_id !== newSessionId || (old.allocated ?? 0) !== newAllocated)) {
      revertAllocation(db, readAllocations(db, old))
      const map = newSessionId ? applyAllocation(db, newSessionId, newAllocated) : {}
      allocations = JSON.stringify(map)
    }

    db.prepare(`
      UPDATE participants SET name=?, investment=?, start_date=?, current_pnl=?, note=?,
        bound_session_id=?, allocated=?, allocations=?, telegram_chat_id=?, updated_at=datetime('now')
      WHERE id=?
    `).run(body.name, newInvestment, body.start_date, body.current_pnl, body.note ?? null,
      newSessionId, newAllocated, allocations, body.telegram_chat_id ?? null, body.id)
  })

  updateAll()
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const deny = requireAdmin(req); if (deny) return deny
  const { id } = await req.json()
  const db = getDb()

  // 綁定時 PUT 會把 investment 加進策略的 tradeSize，刪除必須照同一份配置紀錄退還，
  // 否則策略的 tradeSize 永久保留這一份，之後每筆實盤買單都超額下單。
  const removeAll = db.transaction(() => {
    const old = db.prepare('SELECT bound_session_id, allocated, allocations FROM participants WHERE id=?').get(id) as
      { bound_session_id: string | null; allocated: number; allocations: string | null } | undefined
    if (old) revertAllocation(db, readAllocations(db, old))
    db.prepare('DELETE FROM participants WHERE id=?').run(id)
  })

  removeAll()
  return NextResponse.json({ ok: true })
}
