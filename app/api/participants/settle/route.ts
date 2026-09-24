import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSettings } from '@/lib/settings'
import { getSessionFromCookieHeader } from '@/lib/auth'
import { fetchTicker, placeOrderIdempotent, avgFillPrice, fetchAssetBalance, fetchLotStepSize, roundQty } from '@/lib/binance'
import { withEngineLock } from '@/lib/engine'
import { readAllocations, revertAllocation } from '@/lib/participants'

const BINANCE_FEE = 0.001

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, final_pnl } = await req.json()
  if (!id || final_pnl === undefined) return NextResponse.json({ error: '缺少參數' }, { status: 400 })

  const db = getDb()
  const participant = db.prepare(
    'SELECT * FROM participants WHERE id = ?'
  ).get(id) as {
    id: number; name: string; investment: number; start_date: string
    bound_session_id: string | null; settled_at: string | null
    allocated: number | null; allocations: string | null
  } | undefined

  if (!participant) return NextResponse.json({ error: '找不到參與者' }, { status: 404 })
  if (participant.settled_at) return NextResponse.json({ error: '該參與者已結算' }, { status: 400 })
  if (!participant.bound_session_id) return NextResponse.json({ error: '該參與者未綁定策略' }, { status: 400 })

  // 照綁定時的配置紀錄結算（lib/participants.ts）。以前用 investment / 全部策略 tradeSize 加總
  // 當統一比例，但綁定是平分到每個策略 —— 只要各策略 tradeSize 不同，賣出份額與退還金額都對不上。
  const allocations = readAllocations(db, participant)
  const stratIds = Object.keys(allocations).map(Number)
  if (!stratIds.length) return NextResponse.json({ error: '找不到此參與者的資金配置' }, { status: 400 })

  const settings = getSettings()
  const closeErrors: string[] = []
  const now = new Date().toISOString()

  // ── Step 1: Sell participant's share of each open position ──
  // 在引擎鎖內執行，避免與 tick 或手動平倉同時動同一個持倉
  // 整段在鎖內：連點兩次結算時，後到的那個會在這裡看到 settled_at 已寫入而中止
  const alreadySettled = await withEngineLock(async () => {
    const fresh = db.prepare('SELECT settled_at FROM participants WHERE id = ?').get(id) as { settled_at: string | null } | undefined
    if (fresh?.settled_at) return true

    for (const stratId of stratIds) {
      const strat = db.prepare('SELECT params FROM strategies WHERE id = ?').get(stratId) as { params: string } | undefined
      if (!strat) continue
      const pos = db.prepare(
        'SELECT * FROM positions WHERE strategy_id = ? AND archive_id IS NULL'
      ).get(stratId) as {
        id: number; quantity: number; entry_price: number; symbol: string; mode: string
      } | undefined
      if (!pos) continue

      let tradeSize = 0
      try { tradeSize = JSON.parse(strat.params).tradeSize ?? 0 } catch { /* ignore */ }
      if (tradeSize <= 0) continue
      const share = Math.min(1, allocations[String(stratId)] / tradeSize)
      const sellQtyRaw = pos.quantity * share

      try {
        const ticker = await fetchTicker(pos.symbol)
        let price = ticker.price
        const stepSize = await fetchLotStepSize(pos.symbol)

        let sellQtyStr: string
        let exchangeId: string | null = null
        if (pos.mode === 'live') {
          const asset = pos.symbol.replace('USDT', '').replace('/', '')
          const freeBalance = await fetchAssetBalance(settings.apiKey, settings.apiSecret, asset)
          sellQtyStr = roundQty(Math.min(sellQtyRaw, freeBalance), stepSize)
          const result = await placeOrderIdempotent(settings.apiKey, settings.apiSecret, pos.symbol, 'SELL', sellQtyStr, `ct-p-${id}-${stratId}`)
          exchangeId = result.orderId
          price = avgFillPrice(result) ?? price
        } else {
          sellQtyStr = roundQty(sellQtyRaw, stepSize)
        }

        const soldQty = parseFloat(sellQtyStr)
        const pnl = Math.round(soldQty * (price * (1 - BINANCE_FEE) - pos.entry_price * (1 + BINANCE_FEE)) * 100) / 100

        // Record the sell order
        db.prepare(`
          INSERT INTO orders (strategy_id, symbol, side, order_type, price, quantity, filled_price, status, pnl, mode, exchange_id, closed_at)
          VALUES (?, ?, 'sell', 'market', ?, ?, ?, 'filled', ?, ?, ?, ?)
        `).run(stratId, pos.symbol, price, soldQty, price, pnl, pos.mode, exchangeId, now)

        // Reduce position quantity; delete if fully exited
        const remaining = Math.round((pos.quantity - soldQty) * 1e8) / 1e8
        if (remaining <= 0) {
          db.prepare('DELETE FROM positions WHERE id = ?').run(pos.id)
        } else {
          db.prepare('UPDATE positions SET quantity = ? WHERE id = ?').run(remaining, pos.id)
        }
      } catch (e) {
        closeErrors.push(`${pos.symbol}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    // ── Step 2: 照配置紀錄退還 tradeSize ──
    revertAllocation(db, allocations)

    // ── Step 3: Mark participant as settled ──
    db.prepare(`
      UPDATE participants SET settled_at = ?, final_pnl = ?, bound_session_id = NULL, allocated = 0, allocations = '{}', updated_at = datetime('now')
      WHERE id = ?
    `).run(now, final_pnl, id)
    return false
  })
  if (alreadySettled) return NextResponse.json({ error: '該參與者已結算' }, { status: 400 })

  return NextResponse.json({
    ok: true,
    name: participant.name,
    final_pnl,
    closeErrors: closeErrors.length ? closeErrors : undefined,
  })
}
