import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { runAllActiveTick } from '@/lib/engine'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const activeCount = (db.prepare('SELECT COUNT(*) as n FROM strategies WHERE is_active = 1').get() as { n: number }).n
  const positionCount = (db.prepare('SELECT COUNT(*) as n FROM positions').get() as { n: number }).n
  const lastLog = db.prepare('SELECT message, created_at FROM strategy_logs ORDER BY id DESC LIMIT 1').get() as { message: string; created_at: string } | undefined
  return NextResponse.json({
    activeStrategies: activeCount,
    openPositions: positionCount,
    lastTick: lastLog?.created_at ?? null,
    lastMessage: lastLog?.message ?? null,
  })
}

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const results = await runAllActiveTick()
    return NextResponse.json({ ok: true, results })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}
