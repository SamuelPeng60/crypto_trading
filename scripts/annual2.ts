/**
 * Annual backtest 2024 & 2025 — all strategies × all intervals × BTC/SOL/BNB
 * Run: npx tsx scripts/annual2.ts
 */
import { fetchKlinesFull, Kline, Interval } from '../lib/binance'
import {
  backtestMaCross, backtestRsi, backtestSupertrend,
  backtestVwapBbRsi, backtestEmaRibbonSt, backtestMacdBbSqueeze,
} from '../lib/backtest'

const INITIAL = 10_000
const TRADE   = 1_000

// best params from previous sweeps
const PARAMS = {
  ma_cross:       { fastPeriod:10, slowPeriod:30, maType:'ema' as const, tradeSize:TRADE },
  rsi:            { period:14, oversold:30, overbought:70, tradeSize:TRADE },
  supertrend:     { atrPeriod:10, multiplier:3, ema200Filter:true, tradeSize:TRADE },
  vwap_bb_rsi:    { rsiPeriod:14, rsiOversold:35, rsiOverbought:65, bbPeriod:20, bbStdDev:2, vwapWindow:48, atrPeriod:14, atrSlMultiplier:1.0, tradeSize:TRADE },
  ema_ribbon_st:  { fastEma:5, midEma:8, slowEma:21, atrPeriod:14, multiplier:3.5, ema200Filter:true, atrSlMultiplier:2.0, tradeSize:TRADE },
  macd_bb_squeeze:{ macdFast:12, macdSlow:26, macdSignal:9, bbPeriod:15, rsiPeriod:14, atrPeriod:14, atrSlMultiplier:2, atrTpMultiplier:5, ema200Filter:true, tradeSize:TRADE },
}

const INTERVALS: Interval[] = ['15m','1h','4h','1d']
const SYMBOLS = ['BTCUSDT','SOLUSDT','BNBUSDT']
const STRATEGY_NAMES = Object.keys(PARAMS) as (keyof typeof PARAMS)[]

function run(klines: Kline[], type: keyof typeof PARAMS) {
  const p = PARAMS[type] as any
  switch (type) {
    case 'ma_cross':        return backtestMaCross(klines, p, INITIAL)
    case 'rsi':             return backtestRsi(klines, p, INITIAL)
    case 'supertrend':      return backtestSupertrend(klines, p, INITIAL)
    case 'vwap_bb_rsi':     return backtestVwapBbRsi(klines, p, INITIAL)
    case 'ema_ribbon_st':   return backtestEmaRibbonSt(klines, p, INITIAL)
    case 'macd_bb_squeeze': return backtestMacdBbSqueeze(klines, p, INITIAL)
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

  console.log('Fetching klines for all symbols × intervals...')

  // Fetch klines for each symbol × interval
  const allKlines: Record<string, Record<Interval, Kline[]>> = {}
  for (const sym of SYMBOLS) {
    allKlines[sym] = {} as Record<Interval, Kline[]>
    for (const iv of INTERVALS) {
      const barsNeeded = iv === '15m' ? 35040 : iv === '1h' ? 8760 : iv === '4h' ? 4380 : 730
      allKlines[sym][iv] = await fetchKlinesFull(sym, iv, barsNeeded * 2)
      console.log(`  ${sym} ${iv}: ${allKlines[sym][iv].length} bars`)
    }
  }

  const slice = (sym: string, iv: Interval, s: number, e: number) =>
    allKlines[sym][iv].filter(k => k.time >= s && k.time <= e)

  // bestReturn/bestWr: keyed by strat → interval → { totalRet, wr } summed across symbols+years
  // We track per-strat, per-interval: sum of returns and WR across all symbols × both years
  type IvStats = { totalReturn: number; winRate: number; count: number }
  const ivReturnAcc: Record<string, Record<string, IvStats>> = {}
  const ivWrAcc: Record<string, Record<string, IvStats>> = {}
  for (const strat of STRATEGY_NAMES) {
    ivReturnAcc[strat] = {}
    ivWrAcc[strat] = {}
    for (const iv of INTERVALS) {
      ivReturnAcc[strat][iv] = { totalReturn: 0, winRate: 0, count: 0 }
      ivWrAcc[strat][iv]     = { totalReturn: 0, winRate: 0, count: 0 }
    }
  }

  for (const year of ['2024', '2025'] as const) {
    const [ys, ye] = year === '2024' ? [y2024s, y2024e] : [y2025s, y2025e]
    console.log(`\n${'═'.repeat(75)}`)
    console.log(`  ${year}  (★ = return ≥ 10%)`)
    console.log('═'.repeat(75))

    for (const sym of SYMBOLS) {
      console.log(`\n  ── ${sym} ──`)
      for (const strat of STRATEGY_NAMES) {
        console.log(`\n    ${STRATEGY_LABEL[strat]}`)
        for (const iv of INTERVALS) {
          const klines = slice(sym, iv, ys, ye)
          if (klines.length < 20) {
            console.log(`      ${iv.padEnd(4)} insufficient data`)
            continue
          }
          const r = run(klines, strat)
          console.log(`      ${iv.padEnd(4)}  ${fmt(r)}`)
          if (r.totalTrades >= 3) {
            ivReturnAcc[strat][iv].totalReturn += r.totalReturn
            ivReturnAcc[strat][iv].winRate     += r.winRate
            ivReturnAcc[strat][iv].count++
            ivWrAcc[strat][iv].totalReturn += r.totalReturn
            ivWrAcc[strat][iv].winRate     += r.winRate
            ivWrAcc[strat][iv].count++
          }
        }
      }
    }
  }

  // Compute best intervals by averaging across all symbols × years
  console.log(`\n${'═'.repeat(75)}`)
  console.log('  BEST_RETURN_INTERVAL  (avg return across BTC/SOL/BNB × 2024+2025)')
  console.log('═'.repeat(75))
  const BEST_RETURN_INTERVAL: Record<string, string> = {}
  for (const strat of STRATEGY_NAMES) {
    let bestIv = '4h', bestAvgRet = -Infinity
    for (const iv of INTERVALS) {
      const acc = ivReturnAcc[strat][iv]
      if (acc.count === 0) continue
      const avgRet = acc.totalReturn / acc.count
      if (avgRet > bestAvgRet) { bestAvgRet = avgRet; bestIv = iv }
    }
    BEST_RETURN_INTERVAL[strat] = bestIv
    console.log(`  ${strat.padEnd(20)}: '${bestIv}'  // avg return=${bestAvgRet.toFixed(1)}%`)
  }

  console.log(`\n${'═'.repeat(75)}`)
  console.log('  BEST_WR_INTERVAL  (avg win rate across BTC/SOL/BNB × 2024+2025)')
  console.log('═'.repeat(75))
  const BEST_WR_INTERVAL: Record<string, string> = {}
  for (const strat of STRATEGY_NAMES) {
    let bestIv = '4h', bestAvgWr = -Infinity
    for (const iv of INTERVALS) {
      const acc = ivWrAcc[strat][iv]
      if (acc.count === 0) continue
      const avgWr = acc.winRate / acc.count
      if (avgWr > bestAvgWr) { bestAvgWr = avgWr; bestIv = iv }
    }
    BEST_WR_INTERVAL[strat] = bestIv
    console.log(`  ${strat.padEnd(20)}: '${bestIv}'  // avg WR=${bestAvgWr.toFixed(1)}%`)
  }

  // Output copy-paste maps
  console.log(`\n${'═'.repeat(75)}`)
  console.log('  // Copy-paste: BEST_RETURN_INTERVAL map')
  console.log('  const STRATEGY_BEST_RETURN_INTERVAL: Record<StratType, string> = {')
  for (const strat of STRATEGY_NAMES) {
    console.log(`    ${strat.padEnd(20)}: '${BEST_RETURN_INTERVAL[strat]}',`)
  }
  console.log('  }')

  console.log('\n  // Copy-paste: BEST_WR_INTERVAL map')
  console.log('  const STRATEGY_BEST_WR_INTERVAL: Record<StratType, string> = {')
  for (const strat of STRATEGY_NAMES) {
    console.log(`    ${strat.padEnd(20)}: '${BEST_WR_INTERVAL[strat]}',`)
  }
  console.log('  }')
}

main().catch(console.error)
