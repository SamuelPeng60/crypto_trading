import { NextRequest, NextResponse } from 'next/server'
import { getSettings } from '@/lib/settings'
import { sendTelegramMessage } from '@/lib/notify'

// POST /api/settings/test  { action: 'binance' | 'telegram' }
export async function POST(req: NextRequest) {
  const { action } = await req.json()
  const settings = getSettings()

  if (action === 'binance') {
    if (!settings.apiKey || !settings.apiSecret) {
      return NextResponse.json({ ok: false, error: '請先填寫 API Key 和 Secret' })
    }
    try {
      const { createHmac } = await import('crypto')
      const ts = Date.now()
      const qs = `timestamp=${ts}&recvWindow=5000`
      const sig = createHmac('sha256', settings.apiSecret).update(qs).digest('hex')
      const res = await fetch(`https://api.binance.com/api/v3/account?${qs}&signature=${sig}`, {
        headers: { 'X-MBX-APIKEY': settings.apiKey },
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
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      return NextResponse.json({ ok: false, error: '請先填寫 Bot Token 和 Chat ID' })
    }
    try {
      await sendTelegramMessage(
        settings.telegramBotToken,
        settings.telegramChatId,
        '✅ *Crypto Trader* 通知測試成功！\n交易訊號將透過此頻道推播。'
      )
      return NextResponse.json({ ok: true, message: '測試訊息已送出，請查看 Telegram' })
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) })
    }
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
