/**
 * Parameter sweep for EMA Ribbon + SuperTrend  and  MACD + BB Squeeze
 * Run: npx tsx scripts/sweep.ts
 */
import { fetchKlines, fetchKlinesFull, Kline, Interval } from '../lib/binance'
import { backtestEmaRibbonSt, backtestMacdBbSqueeze, EmaRibbonStParams, MacdBbSqueezeParams } from '../lib/backtest'

const INITIAL = 10_000
const TRADE_SIZE = 1_000
const SYMBOL = 'BTCUSDT'

// ─────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────
function score(r: { totalReturn: number; maxDrawdown: number; sharpeRatio: number; totalTrades: number }) {
  if (r.totalTrades < 5) return -999
  // weighted: return/drawdown ratio + sharpe bonus
  const rorRatio = r.maxDrawdown > 0 ? r.totalReturn / r.maxDrawdown : 0
  return rorRatio * 0.5 + r.sharpeRatio * 0.5
}

function fmt(r: { totalReturn: number; maxDrawdown: number; sharpeRatio: number; winRate: number; totalTrades: number }) {
  return `ret=${r.totalReturn.toFixed(1)}%  dd=${r.maxDrawdown.toFixed(1)}%  sharpe=${r.sharpeRatio.toFixed(2)}  wr=${r.winRate.toFixed(0)}%  n=${r.totalTrades}`
}

// ─────────────────────────────────────────────
// EMA Ribbon + SuperTrend sweep
// ─────────────────────────────────────────────
async function sweepRibbon(klines: Kline[], label: string) {
  const results: { params: EmaRibbonStParams; score: number; summary: string }[] = []

  const ribbonSets: [number, number, number][] = [
    [5, 13, 34],
    [8, 21, 55],
    [9, 21, 55],
    [9, 21, 89],
    [13, 34, 89],
  ]
  const atrPeriods = [7, 10, 14]
  const multipliers = [2.0, 2.5, 3.0, 3.5]
  const atrSlMults = [1.0, 1.5, 2.0, 2.5]

  for (const [fast, mid, slow] of ribbonSets) {
    for (const atrPeriod of atrPeriods) {
      for (const multiplier of multipliers) {
        for (const atrSlMultiplier of atrSlMults) {
          const params: EmaRibbonStParams = {
            fastEma: fast, midEma: mid, slowEma: slow,
            atrPeriod, multiplier, ema200Filter: true,
            atrSlMultiplier, tradeSize: TRADE_SIZE,
          }
          const r = backtestEmaRibbonSt(klines, params, INITIAL)
          results.push({ params, score: score(r), summary: fmt(r) })
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score)
  console.log(`\n══ EMA Ribbon+ST  [${label}]  TOP 5 ══`)
  for (const { params: p, summary } of results.slice(0, 5)) {
    console.log(
      `  ema(${p.fastEma},${p.midEma},${p.slowEma})  atr=${p.atrPeriod}  mult=${p.multiplier}  sl=${p.atrSlMultiplier}  |  ${summary}`
    )
  }
  return results[0]
}

// ─────────────────────────────────────────────
// MACD + BB Squeeze sweep
// ─────────────────────────────────────────────
async function sweepMacd(klines: Kline[], label: string) {
  const results: { params: MacdBbSqueezeParams; score: number; summary: string }[] = []

  const macdSets: [number, number, number][] = [
    [8, 17, 9],
    [8, 21, 9],
    [12, 26, 9],
    [12, 26, 7],
    [5, 13, 5],
  ]
  const bbPeriods = [15, 20]
  const rsiPeriods = [10, 14]
  const slMults = [1.5, 2.0, 2.5]
  const tpMults = [3.0, 4.0, 5.0, 6.0]

  for (const [mf, ms, msig] of macdSets) {
    for (const bbPeriod of bbPeriods) {
      for (const rsiPeriod of rsiPeriods) {
        for (const atrSlMultiplier of slMults) {
          for (const atrTpMultiplier of tpMults) {
            const params: MacdBbSqueezeParams = {
              macdFast: mf, macdSlow: ms, macdSignal: msig,
              bbPeriod, rsiPeriod, atrPeriod: 14,
              atrSlMultiplier, atrTpMultiplier,
              ema200Filter: true, tradeSize: TRADE_SIZE,
            }
            const r = backtestMacdBbSqueeze(klines, params, INITIAL)
            results.push({ params, score: score(r), summary: fmt(r) })
          }
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score)
  console.log(`\n══ MACD+BB Squeeze  [${label}]  TOP 5 ══`)
  for (const { params: p, summary } of results.slice(0, 5)) {
    console.log(
      `  macd(${p.macdFast},${p.macdSlow},${p.macdSignal})  bb=${p.bbPeriod}  rsi=${p.rsiPeriod}  sl=${p.atrSlMultiplier}  tp=${p.atrTpMultiplier}  |  ${summary}`
    )
  }
  return results[0]
}

// ─────────────────────────────────────────────
// main
// ─────────────────────────────────────────────
async function main() {
  console.log('Fetching klines (more history)...')
  const [k4h, k1d, k1h] = await Promise.all([
    fetchKlinesFull(SYMBOL, '4h', 2000),   // ~333 days
    fetchKlinesFull(SYMBOL, '1d', 1000),   // ~1000 days (~2.7 years)
    fetchKlinesFull(SYMBOL, '1h', 2000),   // ~83 days
  ])
  console.log(`  4h=${k4h.length}  1d=${k1d.length}  1h=${k1h.length}  bars`)

  // EMA Ribbon — trend strategy, best on higher timeframes
  const best4hRibbon  = await sweepRibbon(k4h, 'BTCUSDT 4h')
  const best1dRibbon  = await sweepRibbon(k1d, 'BTCUSDT 1d')

  // MACD Squeeze — breakout, test 1h and 4h
  const best1hMacd    = await sweepMacd(k1h, 'BTCUSDT 1h')
  const best4hMacd    = await sweepMacd(k4h, 'BTCUSDT 4h')

  console.log('\n══ RECOMMENDATION ══')
  const ribbonWinner = best4hRibbon.score >= best1dRibbon.score ? { tf: '4h', r: best4hRibbon } : { tf: '1d', r: best1dRibbon }
  const macdWinner   = best1hMacd.score   >= best4hMacd.score   ? { tf: '1h', r: best1hMacd }  : { tf: '4h', r: best4hMacd }

  console.log(`\nEMA Ribbon best tf: ${ribbonWinner.tf}`)
  const rp = ribbonWinner.r.params
  console.log(`  fastEma=${rp.fastEma}  midEma=${rp.midEma}  slowEma=${rp.slowEma}  atrPeriod=${rp.atrPeriod}  multiplier=${rp.multiplier}  atrSlMultiplier=${rp.atrSlMultiplier}`)
  console.log(`  ${ribbonWinner.r.summary}`)

  console.log(`\nMACD Squeeze best tf: ${macdWinner.tf}`)
  const mp = macdWinner.r.params
  console.log(`  macdFast=${mp.macdFast}  macdSlow=${mp.macdSlow}  macdSignal=${mp.macdSignal}  bbPeriod=${mp.bbPeriod}  rsiPeriod=${mp.rsiPeriod}  sl=${mp.atrSlMultiplier}  tp=${mp.atrTpMultiplier}`)
  console.log(`  ${macdWinner.r.summary}`)
}

main().catch(console.error)
