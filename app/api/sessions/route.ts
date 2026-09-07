import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: NextRequest) {
  // proxy.ts 只檢查 cookie 是否存在、不驗證有效性，所以每支 API 都要自己驗 session
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const strats = db.prepare(
    'SELECT session_id, name, type, mode FROM strategies WHERE session_id IS NOT NULL ORDER BY created_at ASC'
  ).all() as { session_id: string; name: string; type: string; mode: string }[]

  const seen = new Map<string, { session_id: string; label: string; type: string; mode: string }>()
  for (const s of strats) {
    if (seen.has(s.session_id)) continue
    const label = /^\d{14}\s/.test(s.name)
      ? s.name.split(' ')[0]
      : /^策略/.test(s.name)
        ? s.name.replace(/\s+\S+$/, '')
        : s.name.replace(/\s+\S+$/, '') || s.name
    seen.set(s.session_id, { session_id: s.session_id, label, type: s.type, mode: s.mode })
  }

  return NextResponse.json([...seen.values()])
}
