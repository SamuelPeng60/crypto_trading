/**
 * Annual backtest 2024 & 2025 — all strategies × all intervals
 * Run: npx tsx scripts/annual.ts
 */
import { fetchKlinesFull, Kline, Interval } from '../lib/binance'
import {
  backtestMaCross, backtestRsi, backtestSupertrend,
  backtestVwapBbRsi, backtestEmaRibbonSt, backtestMacdBbSqueeze,
} from '../lib/backtest'

const INITIAL = 10_000
const TRADE   = 1_000
const SYM     = 'BTCUSDT'

// best params from previous sweeps
const PARAMS = {
  ma_cross:      { fastPeriod:10, slowPeriod:30, maType:'ema' as const, tradeSize:TRADE },
  rsi:           { period:14, oversold:30, overbought:70, tradeSize:TRADE },
  supertrend:    { atrPeriod:10, multiplier:3, ema200Filter:true, tradeSize:TRADE },
  vwap_bb_rsi:   { rsiPeriod:14, rsiOversold:35, rsiOverbought:65, bbPeriod:20, bbStdDev:2, vwapWindow:48, atrPeriod:14, atrSlMultiplier:1.0, tradeSize:TRADE },
  ema_ribbon_st: { fastEma:5, midEma:8, slowEma:21, atrPeriod:14, multiplier:3.5, ema200Filter:true, atrSlMultiplier:2.0, tradeSize:TRADE },
  macd_bb_squeeze:{ macdFast:12, macdSlow:26, macdSignal:9, bbPeriod:15, rsiPeriod:14, atrPeriod:14, atrSlMultiplier:2, atrTpMultiplier:5, ema200Filter:true, tradeSize:TRADE },
}

const INTERVALS: Interval[] = ['15m','1h','4h','1d']
const STRATEGY_NAMES = Object.keys(PARAMS) as (keyof typeof PARAMS)[]

function run(klines: Kline[], type: keyof typeof PARAMS) {
  const p = PARAMS[type] as any
  switch (type) {
    case 'ma_cross':       return backtestMaCross(klines, p, INITIAL)
    case 'rsi':            return backtestRsi(klines, p, INITIAL)
    case 'supertrend':     return backtestSupertrend(klines, p, INITIAL)
    case 'vwap_bb_rsi':    return backtestVwapBbRsi(klines, p, INITIAL)
    case 'ema_ribbon_st':  return backtestEmaRibbonSt(klines, p, INITIAL)
    case 'macd_bb_squeeze':return backtestMacdBbSqueeze(klines, p, INITIAL)
  }
}

const STRATEGY_LABEL: Record<string, string> = {
  ma_cross:       'MA Cross      ',
  rsi:            'RSI           ',
  supertrend:     'SuperTrend    ',
  vwap_bb_rsi:    'Crypto Pulse  ',
  ema_ribbon_st:  'EMA Ribbon+ST ',
  macd_bb_squeeze:'MACD Squeeze  ',
}

function fmt(r: { totalReturn:number; winRate:number; maxDrawdown:number; totalTrades:number }) {
  const ok = r.totalReturn >= 10 ? ' ★' : ''
  return `ret=${r.totalReturn.toFixed(1).padStart(6)}%  wr=${r.winRate.toFixed(0).padStart(3)}%  dd=${r.maxDrawdown.toFixed(1).padStart(5)}%  n=${String(r.totalTrades).padStart(3)}${ok}`
}

async function main() {
  // year timestamps (unix seconds)
  const y2024s = new Date('2024-01-01T00:00:00Z').getTime() / 1000
  const y2024e = new Date('2024-12-31T23:59:59Z').getTime() / 1000
  const y2025s = new Date('2025-01-01T00:00:00Z').getTime() / 1000
  const y2025e = new Date('2025-12-31T23:59:59Z').getTime() / 1000

  console.log('Fetching klines for all intervals...')

  // Fetch enough data to cover both years for each interval
  const allKlines: Record<Interval, Kline[]> = {} as any
  for (const iv of INTERVALS) {
    const barsNeeded = iv === '15m' ? 35040 : iv === '1h' ? 8760 : iv === '4h' ? 4380 : 730
    allKlines[iv] = await fetchKlinesFull(SYM, iv, barsNeeded * 2)
    console.log(`  ${iv}: ${allKlines[iv].length} bars`)
  }

  const slice = (iv: Interval, s: number, e: number) =>
    allKlines[iv].filter(k => k.time >= s && k.time <= e)

  // Summary: best interval per strategy per year (for UI default)
  const bestInterval: Record<string, Record<string, { iv: string; wr: number; ret: number }>> = {}

  for (const year of ['2024', '2025'] as const) {
    const [ys, ye] = year === '2024' ? [y2024s, y2024e] : [y2025s, y2025e]
    console.log(`\n${'═'.repeat(65)}`)
    console.log(`  BTCUSDT ${year}  (★ = return ≥ 10%)`)
    console.log('═'.repeat(65))

    for (const strat of STRATEGY_NAMES) {
      console.log(`\n  ${STRATEGY_LABEL[strat]}`)
      let bestWr = { iv: '4h', wr: -1, ret: -999 }
      let bestRet = { iv: '4h', wr: -1, ret: -999 }

      for (const iv of INTERVALS) {
        const klines = slice(iv, ys, ye)
        if (klines.length < 20) { console.log(`    ${iv.padEnd(4)} insufficient data`); continue }
        const r = run(klines, strat)
        console.log(`    ${iv.padEnd(4)}  ${fmt(r)}`)
        if (r.totalTrades >= 3 && r.winRate > bestWr.wr) bestWr = { iv, wr: r.winRate, ret: r.totalReturn }
        if (r.totalTrades >= 3 && r.totalReturn > bestRet.ret) bestRet = { iv, wr: r.winRate, ret: r.totalReturn }
      }
      if (!bestInterval[strat]) bestInterval[strat] = {}
      bestInterval[strat][year] = bestWr
    }
  }

  console.log(`\n${'═'.repeat(65)}`)
  console.log('  BEST INTERVAL PER STRATEGY (by win rate, min 3 trades)')
  console.log('═'.repeat(65))
  console.log('\n  // Copy this into your UI default-interval map:')
  console.log('  const STRATEGY_DEFAULT_INTERVAL: Record<string, string> = {')
  for (const strat of STRATEGY_NAMES) {
    const b24 = bestInterval[strat]?.['2024']
    const b25 = bestInterval[strat]?.['2025']
    // pick whichever year had better avg win rate
    const pick = (b24 && b25)
      ? (b24.wr >= b25.wr ? b24.iv : b25.iv)
      : (b24?.iv ?? b25?.iv ?? '4h')
    console.log(`    ${strat.padEnd(20)}: '${pick}',  // 2024 best=${b24?.iv ?? '?'} wr=${b24?.wr?.toFixed(0) ?? '?'}%  2025 best=${b25?.iv ?? '?'} wr=${b25?.wr?.toFixed(0) ?? '?'}%`)
  }
  console.log('  }')
}

main().catch(console.error)
