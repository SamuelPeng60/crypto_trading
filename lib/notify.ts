export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  if (!token || !chatId) return
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    })
  } catch {
    // Notification errors are non-fatal
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
