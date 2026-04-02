import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyPassword, createSession, ensureAdmin } from '@/lib/auth'

export async function POST(req: Request) {
  ensureAdmin()

  const { username, password } = await req.json()
  if (!username || !password) {
    return NextResponse.json({ error: '請輸入帳號密碼' }, { status: 400 })
  }

  const user = getDb().prepare(
    'SELECT id, username, password_hash, role FROM users WHERE username = ?'
  ).get(username) as { id: number; username: string; password_hash: string; role: string } | undefined

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 })
  }

  const token = createSession(user.id)

  const res = NextResponse.json({ id: user.id, username: user.username, role: user.role })
  res.cookies.set('ct_session', token, {
    httpOnly: true,
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
    sameSite: 'lax',
  })
  return res
}
