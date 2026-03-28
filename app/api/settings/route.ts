import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/settings'

export async function GET() {
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
  const body = await req.json()
  saveSettings(body)
  return NextResponse.json({ ok: true })
}
