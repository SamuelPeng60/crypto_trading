import crypto from 'crypto'
import { getDb } from './db'

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':')
    const attempt = crypto.scryptSync(password, salt, 64).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'))
  } catch {
    return false
  }
}

/** Seed default admin on first run */
export function ensureAdmin() {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
  if (count === 0) {
    db.prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')"
    ).run('admin', hashPassword('admin123'))
    console.log('[auth] Default admin created: admin / admin123')
  }
}

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  getDb().prepare(
    'INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, ?)'
  ).run(userId, token, expires)
  return token
}

export interface SessionUser {
  id: number
  username: string
  role: 'admin' | 'user'
}

export function getSession(token: string): SessionUser | null {
  const row = getDb().prepare(`
    SELECT u.id, u.username, u.role
    FROM user_sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token) as SessionUser | undefined
  return row ?? null
}

export function deleteSession(token: string): void {
  getDb().prepare('DELETE FROM user_sessions WHERE token = ?').run(token)
}

export function getSessionFromCookieHeader(cookieHeader: string | null): SessionUser | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/ct_session=([^;]+)/)
  if (!match) return null
  return getSession(match[1])
}
