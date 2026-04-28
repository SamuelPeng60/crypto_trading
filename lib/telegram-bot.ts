/**
 * Telegram bot polling + command handler
 * Handles /chart [symbol] — screenshots the chart preview page and sends it
 */
import { getSettings } from './settings'
import { sendTelegramMessage, sendTelegramPhoto } from './notify'
import { getDb } from './db'

const SYMBOL_MAP: Record<string, string> = {
  btc: 'BTCUSDT', bitcoin: 'BTCUSDT',
  eth: 'ETHUSDT', ethereum: 'ETHUSDT',
  sol: 'SOLUSDT', solana: 'SOLUSDT',
  bnb: 'BNBUSDT',
}

let lastUpdateId = 0
let pollingActive = false

async function takeChartScreenshot(symbol: string): Promise<Buffer | null> {
  const port = process.env.PORT || 3333
  const url = `http://localhost:${port}/chart-preview/${symbol}`

  let browser = null
  try {
    // Dynamic import so puppeteer is not bundled at startup
    const puppeteer = await import('puppeteer')
    browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    })
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 600 })
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 })

    // Wait for chart data to load (set by client.tsx after fetch completes)
    await page.waitForSelector('#chart-preview[data-loaded]', { timeout: 15000 })

    const el = await page.$('#chart-preview')
    if (!el) return null

    const buffer = await el.screenshot({ type: 'png' })
    return Buffer.from(buffer)
  } catch (e) {
    console.error('[telegram-bot] screenshot error:', e)
    return null
  } finally {
    await browser?.close()
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleUpdate(update: any) {
  const msg = update.message
  if (!msg?.text) return

  const text: string = msg.text.trim()
  const chatId = String(msg.chat.id)
  const settings = getSettings()
  if (!settings.telegramBotToken) return

  if (text.startsWith('/start') || text.startsWith('/mychatid')) {
    await sendTelegramMessage(
      settings.telegramBotToken, chatId,
      `您的 Chat ID 是：\`${chatId}\`\n\n` +
      `如果您是系統參與者，可直接輸入：\n\`/register 您的姓名\`\n自動完成綁定，無需通知管理員。`
    )
    return
  }

  if (text.startsWith('/register')) {
    const namePart = text.slice('/register'.length).trim()
    if (!namePart) {
      await sendTelegramMessage(settings.telegramBotToken, chatId,
        '請輸入您在系統中的姓名，例如：\n`/register 王小明`')
      return
    }
    try {
      const db = getDb()
      const participant = db.prepare('SELECT id, name, telegram_chat_id FROM participants WHERE name = ?').get(namePart) as
        { id: number; name: string; telegram_chat_id: string | null } | undefined
      if (!participant) {
        await sendTelegramMessage(settings.telegramBotToken, chatId,
          `❌ 找不到姓名「${namePart}」的參與者。\n請確認與系統中的姓名完全一致。`)
        return
      }
      db.prepare("UPDATE participants SET telegram_chat_id=?, updated_at=datetime('now') WHERE id=?").run(chatId, participant.id)
      await sendTelegramMessage(settings.telegramBotToken, chatId,
        `✅ 綁定成功！\n您（${namePart}）已設定完成，之後的買入／賣出訊號都會發送到這裡。`)
    } catch (e) {
      console.error('[telegram-bot] /register error:', e)
      await sendTelegramMessage(settings.telegramBotToken, chatId, '❌ 綁定時發生錯誤，請稍後再試。')
    }
    return
  }

  if (!text.startsWith('/chart')) return

  const parts = text.split(/\s+/)
  const symbolInput = (parts[1] || 'btc').toLowerCase().replace('usdt', '')
  const symbol = SYMBOL_MAP[symbolInput] || (symbolInput.toUpperCase() + 'USDT')

  await sendTelegramMessage(settings.telegramBotToken, chatId, `📊 正在截圖 ${symbol} K線圖，請稍候...`)

  const imageBuffer = await takeChartScreenshot(symbol)
  if (!imageBuffer) {
    await sendTelegramMessage(settings.telegramBotToken, chatId, `❌ 截圖失敗，請確認 \`${symbol}\` 為有效幣種`)
    return
  }

  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
  await sendTelegramPhoto(settings.telegramBotToken, chatId, imageBuffer, `${symbol} 4h K線圖 · ${now}`)
}

export async function startTelegramPolling() {
  if (pollingActive) return
  pollingActive = true
  console.log('[telegram-bot] polling started')

  const loop = async () => {
    while (pollingActive) {
      const settings = getSettings()
      if (!settings.telegramBotToken) {
        await new Promise(r => setTimeout(r, 10000))
        continue
      }

      try {
        const res = await fetch(
          `https://api.telegram.org/bot${settings.telegramBotToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`,
          { signal: AbortSignal.timeout(35000) }
        )
        if (res.ok) {
          const data = await res.json()
          for (const update of data.result || []) {
            lastUpdateId = update.update_id
            handleUpdate(update).catch(e => console.error('[telegram-bot] handle error:', e))
          }
        }
      } catch {
        // timeout / network error — continue
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  }

  loop().catch(e => console.error('[telegram-bot] polling loop error:', e))
}
