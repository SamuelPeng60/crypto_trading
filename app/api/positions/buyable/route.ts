import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { fetchKlines, fetchTicker, Interval } from '@/lib/binance'
import { supertrend } from '@/lib/indicators'
import { isTrendStrategy } from '@/lib/engine'
import { getSettings } from '@/lib/settings'

interface Row { id: number; name: string; type: string; symbol: string; params: string; mode: string }

// 手動買入的候選清單：啟用中且目前無持倉的策略。
// 趨勢策略額外回傳 SuperTrend 方向與翻空線，讓對話框在下單前顯示出場點與下檔距離。
export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const settings = getSettings()
  const rows = db.prepare(`
    SELECT s.id, s.name, s.type, s.symbol, s.params, s.mode
    FROM strategies s
    WHERE s.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.strategy_id = s.id)
    ORDER BY s.symbol
  `).all() as Row[]

  const candidates = await Promise.all(rows.map(async r => {
    const params = JSON.parse(r.params) as Record<string, unknown>
    const mode = r.mode ?? settings.mode
    let tradeSize = (params.tradeSize as number) || (params.amountPerGrid as number) || 1000
    if (settings.maxPositionSize > 0) tradeSize = Math.min(tradeSize, settings.maxPositionSize)

    const base = {
      strategyId: r.id, name: r.name, type: r.type, symbol: r.symbol, mode, tradeSize,
      price: null as number | null,
      isTrend: isTrendStrategy(r.type),
      stDirection: null as 'long' | 'short' | null,
      stLine: null as number | null,
      barsInDir: null as number | null,
      allowed: true,
      reason: '',
    }

    try {
      base.price = (await fetchTicker(r.symbol)).price
    } catch {
      return { ...base, allowed: false, reason: '取得報價失敗' }
    }

    if (!base.isTrend) return base

    try {
      const interval = ((params.interval as string) || '1h') as Interval
      const klines = await fetchKlines(r.symbol, interval, 300)
      const { direction, trend } = supertrend(
        klines.slice(0, -1),
        (params.atrPeriod as number) || 14,
        (params.multiplier as number) || 3,
      )
      const i = direction.length - 1
      let flipIdx = i
      while (flipIdx > 0 && direction[flipIdx - 1] === direction[i]) flipIdx--

      base.stDirection = direction[i] === 1 ? 'long' : 'short'
      base.stLine = trend[i]
      base.barsInDir = i - flipIdx + 1
      if (direction[i] !== 1) {
        base.allowed = false
        base.reason = 'SuperTrend 為空頭，買進後要等下一次翻多再翻空才會出場，中間沒有止損'
      }
    } catch {
      base.allowed = false
      base.reason = '無法計算 SuperTrend 狀態'
    }
    return base
  }))

  return NextResponse.json({ candidates })
}
