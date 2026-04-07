import { NextRequest, NextResponse } from 'next/server'
import { getSettings } from '@/lib/settings'
import { sendTelegramMessage } from '@/lib/notify'
import { getSessionFromCookieHeader } from '@/lib/auth'

// POST /api/settings/test  { action, apiKey?, apiSecret?, telegramBotToken?, telegramChatId? }
// Form values passed directly take priority over DB values so test works before saving.
export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { action } = body
  const settings = getSettings()

  if (action === 'binance') {
    const apiKey    = (body.apiKey    as string | undefined) || settings.apiKey
    const apiSecret = (body.apiSecret as string | undefined) || settings.apiSecret
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: '請先填寫 API Key 和 Secret' })
    }
    try {
      const { createHmac } = await import('crypto')
      const ts = Date.now()
      const qs = `timestamp=${ts}&recvWindow=5000`
      const sig = createHmac('sha256', apiSecret).update(qs).digest('hex')
      const res = await fetch(`https://api.binance.com/api/v3/account?${qs}&signature=${sig}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
        next: { revalidate: 0 },
      })
      if (!res.ok) {
        const err = await res.json()
        return NextResponse.json({ ok: false, error: err.msg || `HTTP ${res.status}` })
      }
      const data = await res.json()
      const usdtBalance = (data.balances as { asset: string; free: string }[])
        .find(b => b.asset === 'USDT')?.free ?? '0'
      return NextResponse.json({ ok: true, message: `連線成功！USDT 餘額：${parseFloat(usdtBalance).toFixed(2)}` })
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) })
    }
  }

  if (action === 'telegram') {
    const botToken = (body.telegramBotToken as string | undefined) || settings.telegramBotToken
    const chatId   = (body.telegramChatId   as string | undefined) || settings.telegramChatId
    if (!botToken || !chatId) {
      return NextResponse.json({ ok: false, error: '請先填寫 Bot Token 和 Chat ID' })
    }
    try {
      await sendTelegramMessage(
        botToken,
        chatId,
        '✅ *Crypto Trader* 通知測試成功！\n交易訊號將透過此頻道推播。'
      )
      return NextResponse.json({ ok: true, message: '測試訊息已送出，請查看 Telegram' })
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) })
    }
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
