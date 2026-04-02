import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET() {
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
