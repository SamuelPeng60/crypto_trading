import { NextRequest, NextResponse } from 'next/server'
import { fetchKlinesFull, Interval } from '@/lib/binance'
import { getSessionFromCookieHeader } from '@/lib/auth'
import {
  backtestMaCross, backtestRsi, backtestGrid, backtestSupertrend, backtestVwapBbRsi,
  backtestEmaRibbonSt, backtestMacdBbSqueeze, backtestAdaptiveCombo, backtestMaConsolidation,
  backtestSupertrendMacd,
  MaCrossParams, RsiParams, GridParams, SupertrendParams, VwapBbRsiParams,
  EmaRibbonStParams, MacdBbSqueezeParams, AdaptiveComboParams, MaConsolidationBreakoutParams,
  SupertrendMacdParams,
} from '@/lib/backtest'
import { getDb } from '@/lib/db'

export async function POST(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { strategyId, type, symbol, interval, startDate, endDate, initialCapital, params } = body

  try {
    const startMs = new Date(startDate).getTime()
    const endMs = new Date(endDate).getTime()
    const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24)

    // estimate needed candles based on interval
    const intervalMinutes: Record<string, number> = {
      '1m': 1, '5m': 5, '15m': 15, '30m': 30,
      '1h': 60, '4h': 240, '1d': 1440,
    }
    const minutes = intervalMinutes[interval] || 60
    const needed = Math.ceil((diffDays * 24 * 60) / minutes) + 100

    const klines = await fetchKlinesFull(symbol, interval as Interval, Math.min(needed, 8640), endMs)
    const filtered = klines.filter(k => k.time * 1000 >= startMs && k.time * 1000 <= endMs)

    if (filtered.length < 10) {
      return NextResponse.json({ error: 'Not enough data for selected date range' }, { status: 400 })
    }

    let result
    if (type === 'ma_cross') {
      result = backtestMaCross(filtered, params as MaCrossParams, initialCapital)
    } else if (type === 'rsi') {
      result = backtestRsi(filtered, params as RsiParams, initialCapital)
    } else if (type === 'grid') {
      result = backtestGrid(filtered, params as GridParams, initialCapital)
    } else if (type === 'supertrend') {
      result = backtestSupertrend(filtered, params as SupertrendParams, initialCapital)
    } else if (type === 'vwap_bb_rsi') {
      result = backtestVwapBbRsi(filtered, params as VwapBbRsiParams, initialCapital)
    } else if (type === 'ema_ribbon_st') {
      result = backtestEmaRibbonSt(filtered, params as EmaRibbonStParams, initialCapital)
    } else if (type === 'macd_bb_squeeze') {
      result = backtestMacdBbSqueeze(filtered, params as MacdBbSqueezeParams, initialCapital)
    } else if (type === 'adaptive_combo') {
      result = backtestAdaptiveCombo(filtered, params as AdaptiveComboParams, initialCapital)
    } else if (type === 'ma_consolidation_breakout') {
      result = backtestMaConsolidation(filtered, params as MaConsolidationBreakoutParams, initialCapital)
    } else if (type === 'supertrend_macd') {
      result = backtestSupertrendMacd(filtered, params as SupertrendMacdParams, initialCapital)
    } else {
      return NextResponse.json({ error: 'Unknown strategy type' }, { status: 400 })
    }

    // Only persist results for admin users
    if (user.role === 'admin') {
      const db = getDb()
      const row = db.prepare(`
        INSERT INTO backtest_results
          (strategy_id, symbol, interval, start_date, end_date, initial_capital,
           final_capital, total_return, max_drawdown, win_rate, total_trades,
           sharpe_ratio, trades_json, equity_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        strategyId || null, symbol, interval, startDate, endDate, initialCapital,
        result.finalCapital, result.totalReturn, result.maxDrawdown, result.winRate,
        result.totalTrades, result.sharpeRatio,
        JSON.stringify(result.trades),
        JSON.stringify(result.equity),
      )
      return NextResponse.json({ ...result, id: row.lastInsertRowid })
    }

    return NextResponse.json({ ...result, id: null })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const user = getSessionFromCookieHeader(req.headers.get('cookie'))
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const rows = db.prepare(`
    SELECT id, strategy_id, symbol, interval, start_date, end_date,
           initial_capital, final_capital, total_return, max_drawdown,
           win_rate, total_trades, sharpe_ratio, created_at
    FROM backtest_results ORDER BY created_at DESC LIMIT 50
  `).all()
  return NextResponse.json(rows)
}
