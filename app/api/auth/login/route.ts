import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { verifyPassword, createSession, ensureAdmin } from '@/lib/auth'

// In-memory rate limiter: max 5 FAILED attempts per key per 15 minutes.
// 只累計失敗次數，成功登入會清空計數器 —— 否則正常使用者在 15 分鐘內登入 5 次也會被鎖。
const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000

/**
 * 限流的 key。Lightsail 是純 HTTP 直連、沒有反向代理，因此不會有 x-forwarded-for，
 * 舊版一律退回 'unknown' → 所有使用者共用同一個計數器，任何人打錯 5 次密碼就會
 * 把全站鎖 15 分鐘。取不到 IP 時改用帳號名，讓失敗次數至少隔離在單一帳號。
 */
function rateLimitKey(req: Request, username: string): string {
  const h = req.headers
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim()
    || h.get('x-real-ip')?.trim()
    || ''
  return ip ? `ip:${ip}` : `user:${username}`
}

function isRateLimited(key: string): boolean {
  const record = loginAttempts.get(key)
  if (!record || Date.now() > record.resetAt) {
    loginAttempts.delete(key)
    return false
  }
  return record.count >= MAX_ATTEMPTS
}

function recordFailure(key: string): void {
  const now = Date.now()
  const record = loginAttempts.get(key)
  if (!record || now > record.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return
  }
  record.count++
}

export async function POST(req: Request) {
  ensureAdmin()

  const { username, password } = await req.json()
  if (!username || !password) {
    return NextResponse.json({ error: '請輸入帳號密碼' }, { status: 400 })
  }

  const rlKey = rateLimitKey(req, String(username))
  if (isRateLimited(rlKey)) {
    return NextResponse.json({ error: '嘗試次數過多，請 15 分鐘後再試' }, { status: 429 })
  }

  const user = getDb().prepare(
    'SELECT id, username, password_hash, role FROM users WHERE username = ?'
  ).get(username) as { id: number; username: string; password_hash: string; role: string } | undefined

  if (!user || !verifyPassword(password, user.password_hash)) {
    recordFailure(rlKey)
    return NextResponse.json({ error: '帳號或密碼錯誤' }, { status: 401 })
  }

  loginAttempts.delete(rlKey)
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
