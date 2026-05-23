import { backtestAdaptiveCombo, backtestVwapBbRsi, backtestSupertrend } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const BASE = 'https://data-api.binance.vision'
const CAPITAL = 1000

const PERIODS = [
  { label: '2021', start: '2021-01-01', end: '2021-12-31' },
  { label: '2022', start: '2022-01-01', end: '2022-12-31' },
  { label: '2023', start: '2023-01-01', end: '2023-12-31' },
  { label: '2024', start: '2024-01-01', end: '2024-12-31' },
  { label: '2025', start: '2025-01-01', end: '2025-12-31' },
  { label: '2026Q1-Q2', start: '2026-01-01', end: '2026-05-24' },
]

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = []
  let from = startMs
  while (from < endMs) {
    const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&limit=1000`
    const res = await fetch(url)
    const data = await res.json() as number[][]
    if (!data.length) break
    for (const k of data) {
      if (k[0] > endMs) break
      all.push({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })
    }
    from = data[data.length - 1][0] + 1
    if (data.length < 1000) break
  }
  return all
}

const adaptiveParams = {
  fastEma: 5, midEma: 13, slowEma: 34, atrPeriod: 14, multiplier: 2.5,
  ema200Filter: true, atrSlMultiplier: 1.5,
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  tradeSize: CAPITAL,
}

// also run vwap and supertrend for BTC/SOL/BNB to confirm full table
const vwapParams = {
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  atrPeriod: 14, atrSlMultiplier: 1.0, trailAtrMult: 2.0,
  volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.3,
  tradeSize: CAPITAL,
}

const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
const results: Record<string, number[]> = { BTC: [], ETH: [], SOL: [], BNB: [] }

async function main() {
  for (const p of PERIODS) {
    const startMs = new Date(p.start).getTime()
    const endMs   = new Date(p.end).getTime()
    process.stdout.write(`\n${p.label}: `)

    for (const sym of COINS) {
      process.stdout.write(`${sym.replace('USDT','')}.. `)
      const klines = await fetchKlines(sym, '4h', startMs, endMs)
      let r: { totalReturn: number }
      if (sym === 'ETHUSDT') {
        r = backtestAdaptiveCombo(klines as any, adaptiveParams, CAPITAL)
      } else {
        r = backtestVwapBbRsi(klines as any, vwapParams, CAPITAL)
      }
      const key = sym.replace('USDT', '')
      results[key].push(r.totalReturn)
    }
  }

  const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  console.log('\n\n=== 全期回測（誠實版）===')
  console.log('期間       | BTC         | ETH(adaptive) | SOL         | BNB         | 4幣平均')
  console.log('-----------|-------------|---------------|-------------|-------------|--------')
  for (let i = 0; i < PERIODS.length; i++) {
    const fourAvg = (results.BTC[i] + results.ETH[i] + results.SOL[i] + results.BNB[i]) / 4
    console.log(`${PERIODS[i].label.padEnd(10)} | ${fmt(results.BTC[i]).padStart(11)} | ${fmt(results.ETH[i]).padStart(13)} | ${fmt(results.SOL[i]).padStart(11)} | ${fmt(results.BNB[i]).padStart(11)} | ${fmt(fourAvg)}`)
  }
  console.log('-----------|-------------|---------------|-------------|-------------|--------')
  const grandAvg = (avg(results.BTC) + avg(results.ETH) + avg(results.SOL) + avg(results.BNB)) / 4
  console.log(`${'平均'.padEnd(10)} | ${fmt(avg(results.BTC)).padStart(11)} | ${fmt(avg(results.ETH)).padStart(13)} | ${fmt(avg(results.SOL)).padStart(11)} | ${fmt(avg(results.BNB)).padStart(11)} | ${fmt(grandAvg)}`)
}

main().catch(console.error)
