import { NextResponse } from 'next/server'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: Request) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ id: user.id, username: user.username, role: user.role })
}
