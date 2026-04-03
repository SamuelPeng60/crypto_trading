import { NextResponse } from 'next/server'
import { getSessionFromCookieHeader, verifyPassword, hashPassword } from '@/lib/auth'
import { getDb } from '@/lib/db'

export async function POST(req: Request) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { oldPassword, newPassword } = await req.json()
  if (!oldPassword || !newPassword || newPassword.length < 12) {
    return NextResponse.json({ error: '新密碼至少 12 個字元' }, { status: 400 })
  }

  const db = getDb()
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as { password_hash: string } | undefined
  if (!row || !verifyPassword(oldPassword, row.password_hash)) {
    return NextResponse.json({ error: '目前密碼錯誤' }, { status: 400 })
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id)
  return NextResponse.json({ ok: true })
}
