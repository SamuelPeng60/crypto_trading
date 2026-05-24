// BTC strategy comparison — honest version (Fix 4)
import { backtestVwapBbRsi, backtestAdaptiveCombo, backtestSupertrend } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const SYMBOL = 'BTCUSDT'
const INTERVAL = '4h'
const CAPITAL = 1000
const BASE = 'https://data-api.binance.vision'

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
    const data = await res.json() as unknown[][]
    if (!data.length) break
    for (const k of data) {
      if ((k[0] as number) > endMs) break
      all.push({ time: Math.floor((k[0] as number) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })
    }
    from = (data[data.length - 1][0] as number) + 1
    if (data.length < 1000) break
  }
  return all
}

const vwapParams = {
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  atrPeriod: 14, atrSlMultiplier: 1.0, trailAtrMult: 2.0,
  volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.3,
  tradeSize: CAPITAL,
}

const adaptiveParams = {
  fastEma: 5, midEma: 13, slowEma: 34, atrPeriod: 14, multiplier: 2.5,
  ema200Filter: true, atrSlMultiplier: 1.5,
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  tradeSize: CAPITAL,
}

const stParams = {
  atrPeriod: 10, multiplier: 3, ema200Filter: true, tradeSize: CAPITAL,
}

async function main() {
  const results: Record<string, number[]> = { vwap: [], adaptive: [], st: [] }

  for (const p of PERIODS) {
    const startMs = new Date(p.start).getTime()
    const endMs   = new Date(p.end).getTime()
    process.stdout.write(`Fetching ${p.label}...`)
    const klines = await fetchKlines(SYMBOL, INTERVAL, startMs, endMs)
    console.log(` ${klines.length} bars`)

    const rv = backtestVwapBbRsi(klines as any, vwapParams, CAPITAL)
    const ra = backtestAdaptiveCombo(klines as any, adaptiveParams, CAPITAL)
    const rs = backtestSupertrend(klines as any, stParams, CAPITAL)

    results.vwap.push(rv.totalReturn)
    results.adaptive.push(ra.totalReturn)
    results.st.push(rs.totalReturn)
  }

  const labels = PERIODS.map(p => p.label)
  const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length

  console.log('\n=== BTC 策略比較（誠實版 Fix4）===')
  console.log('期間       | vwap_bb_rsi | adaptive_combo | supertrend')
  console.log('-----------|-------------|----------------|----------')
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i].padEnd(10)
    console.log(`${l} | ${fmt(results.vwap[i]).padStart(11)} | ${fmt(results.adaptive[i]).padStart(14)} | ${fmt(results.st[i]).padStart(10)}`)
  }
  console.log('-----------|-------------|----------------|----------')
  console.log(`${'平均'.padEnd(10)} | ${fmt(avg(results.vwap)).padStart(11)} | ${fmt(avg(results.adaptive)).padStart(14)} | ${fmt(avg(results.st)).padStart(10)}`)
}

main().catch(console.error)
