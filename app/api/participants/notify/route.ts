import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { sendTelegramMessage } from '@/lib/notify'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = getDb()
  const participant = db.prepare('SELECT name, telegram_chat_id FROM participants WHERE id=?').get(id) as
    { name: string; telegram_chat_id: string | null } | undefined

  if (!participant) return NextResponse.json({ error: '找不到參與者' }, { status: 404 })
  if (!participant.telegram_chat_id) return NextResponse.json({ error: '該參與者尚未設定 Telegram Chat ID' }, { status: 400 })

  const { telegramBotToken } = getSettings()
  if (!telegramBotToken) return NextResponse.json({ error: 'Telegram Bot Token 未設定' }, { status: 400 })

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  await sendTelegramMessage(telegramBotToken, participant.telegram_chat_id,
    `📢 *測試通知*\n嗨 ${participant.name}！\n這是一條測試訊息，確認您已成功綁定交易通知。\n\n時間：${now}`)

  return NextResponse.json({ ok: true })
}
