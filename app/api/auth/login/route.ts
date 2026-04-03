import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyPassword, createSession, ensureAdmin } from '@/lib/auth'

// In-memory rate limiter: max 5 attempts per IP per 15 minutes
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const record = loginAttempts.get(ip)
  if (!record || now > record.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (record.count >= MAX_ATTEMPTS) return false
  record.count++
  return true
}

export async function POST(req: Request) {
  ensureAdmin()

  // Rate limiting by IP
  const ip = (req.headers as Headers).get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: '嘗試次數過多，請 15 分鐘後再試' }, { status: 429 })
  }

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
    maxAge: 7 * 24 * 60 * 60,
    sameSite: 'lax',
    secure: process.env.HTTPS === 'true',
  })
  return res
}
