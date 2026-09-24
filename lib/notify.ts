export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  if (!token || !chatId) return
  try {
    const send = (parseMode?: string) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}) }),
    })
    let res = await send('Markdown')
    // 訊息內嵌幣安錯誤（例如 "Filter failure: LOT_SIZE"）時，未成對的 _ * ` [ 會讓 Telegram
    // 回 400 "can't parse entities" 整則拒收 —— 偏偏是最需要收到的失敗警報。改用純文字重送。
    if (res.status === 400) {
      const body = await res.json().catch(() => ({})) as { description?: string }
      if (body.description?.includes("can't parse entities")) res = await send()
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      console.error(`[notify] Telegram sendMessage failed chat_id=${chatId} status=${res.status}`, body)
    }
  } catch (e) {
    console.error(`[notify] Telegram sendMessage error chat_id=${chatId}`, e)
  }
}

export async function sendTelegramPhoto(token: string, chatId: string, photo: Buffer, caption?: string): Promise<void> {
  if (!token || !chatId) return
  try {
    const formData = new FormData()
    formData.append('chat_id', chatId)
    formData.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'chart.png')
    if (caption) formData.append('caption', caption)
    await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST',
      body: formData,
    })
  } catch {
    // Notification errors are non-fatal
  }
}
