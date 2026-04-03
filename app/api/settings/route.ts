import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/settings'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const s = getSettings()
  return NextResponse.json({
    ...s,
    apiKey: s.apiKey ? '****' + s.apiKey.slice(-4) : '',
    apiSecret: s.apiSecret ? '••••••••' : '',
    hasCredentials: !!(s.apiKey && s.apiSecret),
    hasTelegram: !!(s.telegramBotToken && s.telegramChatId),
  })
}

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  saveSettings(body)
  return NextResponse.json({ ok: true })
}
