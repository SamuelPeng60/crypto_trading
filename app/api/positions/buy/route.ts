import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { manualBuy } from '@/lib/engine'

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const strategyId = Number(body?.strategyId)
  if (!strategyId) return NextResponse.json({ ok: false, message: '缺少 strategyId' }, { status: 400 })

  const result = await manualBuy(strategyId)
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
