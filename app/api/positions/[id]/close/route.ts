import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { manualClosePosition } from '@/lib/engine'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const result = await manualClosePosition(Number(id))
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}
