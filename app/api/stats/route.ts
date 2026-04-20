import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getSessionFromCookieHeader } from '@/lib/auth'

interface OrderRow {
  id: number
  strategy_id: number
  strategy_name: string | null
  strategy_type: string | null
  symbol: string
  side: string
  pnl: number | null
  closed_at: string | null
  created_at: string
}

interface PositionRow {
  unrealized_pnl: number
}

interface StrategyRow {
  id: number
  symbol: string
  params: string
}

function buildEquityFromOrders(orders: OrderRow[]): { time: number; value: number }[] {
  // Use a Map to deduplicate timestamps (lightweight-charts requires strictly increasing time)
  const map = new Map<number, number>()
  let cum = 0
  for (const o of orders) {
    if (o.pnl == null) continue
    cum += o.pnl
    const raw = o.closed_at ?? o.created_at
    // SQLite stores dates as "YYYY-MM-DD HH:MM:SS" — normalize to ISO format
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'
    const ts = Math.floor(new Date(iso).getTime() / 1000)
    if (isNaN(ts)) continue
    map.set(ts, Math.round(cum * 100) / 100)
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([time, value]) => ({ time, value }))
}

function calcMaxDrawdown(equity: { value: number }[]): number {
  let peak = 0, mdd = 0
  for (const e of equity) {
    if (e.value > peak) peak = e.value
    const dd = peak - e.value
    if (dd > mdd) mdd = dd
  }
  return Math.round(mdd * 100) / 100
}

function calcSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const variance = pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  return std ? Math.round((mean / std) * Math.sqrt(252) * 100) / 100 : 0
}

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const { searchParams } = req.nextUrl
  const modeParam = searchParams.get('mode') ?? 'paper'   // 'paper' | 'live' | 'all'
  const safeMode = modeParam === 'live' ? 'live' : 'paper'
  const isAllMode = modeParam === 'all'

  const safeSession = (searchParams.get('session_id') ?? '').replace(/[^a-zA-Z0-9_-]/g, '')
  const safeStartDate = (searchParams.get('start_date') ?? '').replace(/[^0-9-]/g, '').slice(0, 10)
  const archiveIdParam = searchParams.get('archive_id') ?? ''
  const safeArchiveId = archiveIdParam.replace(/[^0-9]/g, '')

  // Build parameterized filter clauses — using "o." prefix for joined queries
  function ordersFilters(): { sql: string; args: (string | number)[] } {
    const c: string[] = [], a: (string | number)[] = []
    // Archive filter: default to current (unarchived)
    if (safeArchiveId) { c.push('o.archive_id = ?'); a.push(Number(safeArchiveId)) }
    else { c.push('o.archive_id IS NULL') }
    if (!isAllMode) { c.push('o.mode = ?'); a.push(safeMode) }
    if (safeSession) { c.push('o.strategy_id IN (SELECT id FROM strategies WHERE session_id = ?)'); a.push(safeSession) }
    if (safeStartDate) { c.push('COALESCE(o.closed_at, o.created_at) >= ?'); a.push(safeStartDate) }
    return { sql: c.map(x => 'AND ' + x).join(' '), args: a }
  }

  // Build parameterized filter clauses — for plain orders table (no alias)
  function plainFilters(): { sql: string; args: (string | number)[] } {
    const c: string[] = [], a: (string | number)[] = []
    if (safeArchiveId) { c.push('archive_id = ?'); a.push(Number(safeArchiveId)) }
    else { c.push('archive_id IS NULL') }
    if (!isAllMode) { c.push('mode = ?'); a.push(safeMode) }
    if (safeSession) { c.push('strategy_id IN (SELECT id FROM strategies WHERE session_id = ?)'); a.push(safeSession) }
    if (safeStartDate) { c.push('COALESCE(closed_at, created_at) >= ?'); a.push(safeStartDate) }
    return { sql: c.map(x => 'AND ' + x).join(' '), args: a }
  }

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  // SQLite stores datetime('now') as "YYYY-MM-DD HH:MM:SS" (space, not T) — match that format
  const todayISO = todayStart.toISOString().replace('T', ' ').slice(0, 19)

  // All closed trades (sell orders with PnL), filtered by mode + session
  const of1 = ordersFilters()
  const allOrders = db.prepare(`
    SELECT o.*, s.name as strategy_name, s.type as strategy_type
    FROM orders o
    LEFT JOIN strategies s ON o.strategy_id = s.id
    WHERE o.side = 'sell' AND o.pnl IS NOT NULL ${of1.sql}
    ORDER BY COALESCE(o.closed_at, o.created_at) ASC
  `).all(...of1.args) as OrderRow[]

  // Open positions (filtered by mode + session)
  const pf1 = plainFilters()
  const positions = db.prepare(`SELECT unrealized_pnl FROM positions WHERE 1=1 ${pf1.sql}`).all(...pf1.args) as PositionRow[]
  const unrealizedPnl = positions.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0)

  // Overall stats
  const totalPnl = allOrders.reduce((s, o) => s + (o.pnl ?? 0), 0)
  const todayOrders = allOrders.filter(o => (o.closed_at ?? o.created_at) >= todayISO)
  const todayPnl = todayOrders.reduce((s, o) => s + (o.pnl ?? 0), 0)
  const winTrades = allOrders.filter(o => (o.pnl ?? 0) > 0).length
  const winRate = allOrders.length ? Math.round((winTrades / allOrders.length) * 1000) / 10 : 0
  const equity = buildEquityFromOrders(allOrders)

  // Per-symbol equity curves (from all sell orders grouped by symbol)
  const symbolOrdersMap = new Map<string, OrderRow[]>()
  for (const o of allOrders) {
    if (!symbolOrdersMap.has(o.symbol)) symbolOrdersMap.set(o.symbol, [])
    symbolOrdersMap.get(o.symbol)!.push(o)
  }
  const symbolEquity: Record<string, { time: number; value: number }[]> = {}
  for (const [sym, orders] of symbolOrdersMap.entries()) {
    symbolEquity[sym] = buildEquityFromOrders(orders)
  }

  // Invested capital = tradeSize from each distinct strategy that has trades
  // tradeSize is the capital allocated per strategy (recycled each round, not cumulative)
  // Use a filter WITHOUT start_date so the denominator reflects full strategy capital,
  // not just the capital after the participant's start_date (which would inflate PnL ratio)
  function investedFilters(): { sql: string; args: (string | number)[] } {
    const c: string[] = [], a: (string | number)[] = []
    if (safeArchiveId) { c.push('o.archive_id = ?'); a.push(Number(safeArchiveId)) }
    else { c.push('o.archive_id IS NULL') }
    if (!isAllMode) { c.push('o.mode = ?'); a.push(safeMode) }
    if (safeSession) { c.push('o.strategy_id IN (SELECT id FROM strategies WHERE session_id = ?)'); a.push(safeSession) }
    return { sql: c.map(x => 'AND ' + x).join(' '), args: a }
  }
  const of2 = investedFilters()
  const strategiesWithTrades = db.prepare(`
    SELECT DISTINCT s.id, s.symbol, s.params
    FROM strategies s
    INNER JOIN orders o ON o.strategy_id = s.id
    WHERE o.side = 'sell' AND o.pnl IS NOT NULL ${of2.sql}
  `).all(...of2.args) as StrategyRow[]

  const symbolInvested: Record<string, number> = {}
  for (const s of strategiesWithTrades) {
    let tradeSize = 0
    try {
      const p = JSON.parse(s.params)
      tradeSize = Number(p.tradeSize ?? p.amountPerGrid ?? 0)
    } catch { /* ignore */ }
    if (tradeSize > 0) {
      symbolInvested[s.symbol] = (symbolInvested[s.symbol] ?? 0) + tradeSize
    }
  }
  for (const sym of Object.keys(symbolInvested)) {
    symbolInvested[sym] = Math.round(symbolInvested[sym] * 100) / 100
  }
  const totalInvested = Math.round(Object.values(symbolInvested).reduce((s, v) => s + v, 0) * 100) / 100

  // Per-strategy stats
  const strategyMap = new Map<number, OrderRow[]>()
  for (const o of allOrders) {
    if (!strategyMap.has(o.strategy_id)) strategyMap.set(o.strategy_id, [])
    strategyMap.get(o.strategy_id)!.push(o)
  }

  const strategies = []
  for (const [strategyId, orders] of strategyMap.entries()) {
    const first = orders[0]
    const sPnl = orders.reduce((s, o) => s + (o.pnl ?? 0), 0)
    const sTodayPnl = orders.filter(o => (o.closed_at ?? o.created_at) >= todayISO).reduce((s, o) => s + (o.pnl ?? 0), 0)
    const sWin = orders.filter(o => (o.pnl ?? 0) > 0)
    const sLoss = orders.filter(o => (o.pnl ?? 0) <= 0)
    const avgWin = sWin.length ? sWin.reduce((s, o) => s + (o.pnl ?? 0), 0) / sWin.length : 0
    const avgLoss = sLoss.length ? sLoss.reduce((s, o) => s + (o.pnl ?? 0), 0) / sLoss.length : 0
    const grossProfit = sWin.reduce((s, o) => s + (o.pnl ?? 0), 0)
    const grossLoss = Math.abs(sLoss.reduce((s, o) => s + (o.pnl ?? 0), 0))
    const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 100) / 100 : grossProfit > 0 ? 999 : 0
    const pnls = orders.map(o => o.pnl ?? 0)
    const sEquity = buildEquityFromOrders(orders)
    strategies.push({
      id: strategyId,
      name: first.strategy_name ?? `Strategy #${strategyId}`,
      type: first.strategy_type ?? '',
      symbol: first.symbol,
      totalPnl: Math.round(sPnl * 100) / 100,
      todayPnl: Math.round(sTodayPnl * 100) / 100,
      totalTrades: orders.length,
      winTrades: sWin.length,
      winRate: Math.round((sWin.length / orders.length) * 1000) / 10,
      maxDrawdown: calcMaxDrawdown(sEquity),
      sharpeRatio: calcSharpe(pnls),
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor,
      bestTrade: Math.round(Math.max(...pnls) * 100) / 100,
      worstTrade: Math.round(Math.min(...pnls) * 100) / 100,
      equity: sEquity,
    })
  }

  // Sort by totalPnl desc
  strategies.sort((a, b) => b.totalPnl - a.totalPnl)

  // Daily PnL breakdown
  const pf2 = plainFilters()
  const dailyBreakdown = db.prepare(`
    SELECT
      DATE(COALESCE(closed_at, created_at)) as date,
      symbol,
      ROUND(SUM(pnl), 2) as pnl,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as win_trades
    FROM orders
    WHERE side = 'sell' AND pnl IS NOT NULL ${pf2.sql}
    GROUP BY date, symbol
    ORDER BY date DESC, symbol ASC
  `).all(...pf2.args) as { date: string; symbol: string; pnl: number; trades: number; win_trades: number }[]

  // Per-symbol breakdown
  const pf3 = plainFilters()
  const symbolBreakdown = db.prepare(`
    SELECT
      symbol,
      ROUND(SUM(pnl), 2) as pnl,
      COUNT(*) as trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as win_trades,
      ROUND(MIN(pnl), 2) as worst_trade,
      ROUND(MAX(pnl), 2) as best_trade
    FROM orders
    WHERE side = 'sell' AND pnl IS NOT NULL ${pf3.sql}
    GROUP BY symbol
    ORDER BY pnl DESC
  `).all(...pf3.args) as { symbol: string; pnl: number; trades: number; win_trades: number; worst_trade: number; best_trade: number }[]

  // Backtest history (last 20)
  const backtestHistory = db.prepare(`
    SELECT b.id, b.symbol, b.interval, b.start_date, b.end_date,
           b.initial_capital, b.final_capital, b.total_return,
           b.max_drawdown, b.win_rate, b.total_trades, b.sharpe_ratio,
           b.created_at, s.name as strategy_name, s.type as strategy_type
    FROM backtest_results b
    LEFT JOIN strategies s ON b.strategy_id = s.id
    ORDER BY b.created_at DESC LIMIT 20
  `).all()

  return NextResponse.json({
    dailyBreakdown,
    symbolBreakdown,
    overall: {
      totalPnl: Math.round(totalPnl * 100) / 100,
      todayPnl: Math.round(todayPnl * 100) / 100,
      totalTrades: allOrders.length,
      winTrades,
      winRate,
      openPositions: positions.length,
      unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
    },
    equity,
    symbolEquity,
    totalInvested,
    symbolInvested,
    strategies,
    backtestHistory,
  })
}
