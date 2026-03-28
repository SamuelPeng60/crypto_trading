import { getDb } from './db'
import { encrypt, decrypt } from './crypto'

export interface AppSettings {
  apiKey: string
  apiSecret: string
  mode: 'paper' | 'live'
  maxDailyLoss: number
  maxPositionSize: number   // max USDT per trade (0 = unlimited)
  defaultCapital: number
  telegramBotToken: string
  telegramChatId: string
}

const SENSITIVE = ['apiKey', 'apiSecret', 'telegramBotToken']

export function getSettings(): AppSettings {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const map: Record<string, string> = {}
  for (const { key, value } of rows) {
    map[key] = SENSITIVE.includes(key) ? decrypt(value) : value
  }
  return {
    apiKey: map.apiKey || '',
    apiSecret: map.apiSecret || '',
    mode: (map.mode as 'paper' | 'live') || 'paper',
    maxDailyLoss: Number(map.maxDailyLoss) || 500,
    maxPositionSize: Number(map.maxPositionSize) || 0,
    defaultCapital: Number(map.defaultCapital) || 10000,
    telegramBotToken: map.telegramBotToken || '',
    telegramChatId: map.telegramChatId || '',
  }
}

export function saveSettings(settings: Partial<AppSettings>) {
  const db = getDb()
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const upsertMany = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) upsert.run(k, v)
  })
  const entries = Object.entries(settings).map(([k, v]) => {
    const val = String(v)
    return [k, SENSITIVE.includes(k) ? encrypt(val) : val] as [string, string]
  })
  upsertMany(entries)
}
