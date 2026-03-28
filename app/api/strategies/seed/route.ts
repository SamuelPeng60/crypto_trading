import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']

const BASE_PARAMS = {
  interval: '1h',
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 65,
  bbPeriod: 20,
  bbStdDev: 2,
  vwapWindow: 24,
  atrPeriod: 14,
  atrSlMultiplier: 1.5,
  tradeSize: 1000,
}

const NAME: Record<string, string> = {
  BTCUSDT: 'Crypto Pulse BTC',
  ETHUSDT: 'Crypto Pulse ETH',
  BNBUSDT: 'Crypto Pulse BNB',
  SOLUSDT: 'Crypto Pulse SOL',
}

export async function POST() {
  const db = getDb()
  const created: string[] = []
  const skipped: string[] = []

  for (const symbol of SYMBOLS) {
    const existing = db.prepare(
      "SELECT id FROM strategies WHERE type='vwap_bb_rsi' AND symbol=?"
    ).get(symbol)

    if (existing) {
      // Just activate if already exists
      db.prepare("UPDATE strategies SET is_active=1, updated_at=datetime('now') WHERE type='vwap_bb_rsi' AND symbol=?").run(symbol)
      skipped.push(symbol)
      continue
    }

    db.prepare(`
      INSERT INTO strategies (name, type, symbol, params, is_active)
      VALUES (?, 'vwap_bb_rsi', ?, ?, 1)
    `).run(NAME[symbol], symbol, JSON.stringify(BASE_PARAMS))
    created.push(symbol)
  }

  return NextResponse.json({ ok: true, created, activated: skipped })
}
