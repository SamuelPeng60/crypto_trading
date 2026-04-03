import { NextResponse } from 'next/server'
import { getSessionFromCookieHeader, hashPassword } from '@/lib/auth'
import { getDb } from '@/lib/db'

function requireAdmin(req: Request) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return null
  return user
}

export async function GET(req: Request) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const users = getDb().prepare(
    'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
  ).all()
  return NextResponse.json(users)
}

export async function POST(req: Request) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { username, password, role = 'user' } = await req.json()
  if (!username || !password || password.length < 12) {
    return NextResponse.json({ error: '密碼至少 12 個字元' }, { status: 400 })
  }
  if (!['admin', 'user'].includes(role)) {
    return NextResponse.json({ error: '無效角色' }, { status: 400 })
  }
  try {
    const { lastInsertRowid } = getDb().prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run(username, hashPassword(password), role)
    return NextResponse.json({ id: Number(lastInsertRowid) })
  } catch {
    return NextResponse.json({ error: '帳號已存在' }, { status: 409 })
  }
}

export async function DELETE(req: Request) {
  const admin = requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  if (id === admin.id) return NextResponse.json({ error: '無法刪除自己' }, { status: 400 })

  const db = getDb()
  // Prevent deleting last admin
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: string } | undefined
  if (!target) return NextResponse.json({ error: '使用者不存在' }, { status: 404 })
  if (target.role === 'admin') {
    const adminCount = (db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get() as { c: number }).c
    if (adminCount <= 1) return NextResponse.json({ error: '至少需保留一位 Admin' }, { status: 400 })
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: Request) {
  if (!requireAdmin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, password } = await req.json()
  if (!id || !password || password.length < 12) {
    return NextResponse.json({ error: '密碼至少 12 個字元' }, { status: 400 })
  }
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
  return NextResponse.json({ ok: true })
}
