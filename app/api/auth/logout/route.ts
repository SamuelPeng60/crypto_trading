import { NextResponse } from 'next/server'
import { deleteSession } from '@/lib/auth'

export async function POST(req: Request) {
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie.match(/ct_session=([^;]+)/)
  if (match) deleteSession(match[1])

  const res = NextResponse.json({ ok: true })
  res.cookies.set('ct_session', '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
