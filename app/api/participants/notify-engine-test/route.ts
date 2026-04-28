import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { sendTelegramMessage } from '@/lib/notify'
import { getSessionFromCookieHeader } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { session_id } = await req.json()
  if (!session_id) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 })

  const { telegramBotToken } = getSettings()
  if (!telegramBotToken) return NextResponse.json({ error: 'Telegram Bot Token 未設定' }, { status: 400 })

  const db = getDb()
  const parts = db.prepare(
    "SELECT name, telegram_chat_id FROM participants WHERE bound_session_id = ? AND telegram_chat_id IS NOT NULL AND telegram_chat_id != ''"
  ).all(session_id) as { name: string; telegram_chat_id: string }[]

  console.log(`[notifyParticipants] session=${session_id} found=${parts.length} participant(s):`, parts.map(p => p.name))

  if (parts.length === 0) {
    return NextResponse.json({ error: `找不到綁定此 session 且設有 Telegram 的參與者（session_id: ${session_id}）` }, { status: 404 })
  }

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  const errors: string[] = []
  for (const p of parts) {
    try {
      await sendTelegramMessage(telegramBotToken, p.telegram_chat_id,
        `🔧 *引擎通知測試*\n嗨 ${p.name}！\n這是模擬引擎通知路徑的測試訊息。\n\n時間：${now}`)
    } catch (e) {
      errors.push(p.name)
      console.error(`[notifyParticipants-test] failed for ${p.name}:`, e)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, sent: parts.length - errors.length, failed: errors })
  }
  return NextResponse.json({ ok: true, sent: parts.length, names: parts.map(p => p.name) })
}
