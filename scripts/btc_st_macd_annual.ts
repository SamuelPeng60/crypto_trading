// BTC supertrend_macd 年度回測（含合併 2026Q1-Q2）
import { backtestSupertrendMacd } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CAPITAL = 1000
const PARAMS = { atrPeriod: 14, multiplier: 3.0, ema200Filter: true, macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: CAPITAL }

const PERIODS = [
  { label: '2021',      start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',      start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',      start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',      start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',      start: '2025-01-01', end: '2025-12-31' },
  { label: '2026Q1-Q2', start: '2026-01-01', end: '2026-05-24' },
]

async function fetchKlines(startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = []
  let from = startMs
  while (from < endMs) {
    const url = `${BASE}/api/v3/klines?symbol=BTCUSDT&interval=4h&startTime=${from}&limit=1000`
    const res = await fetch(url); const data = await res.json() as unknown[][]
    if (!data.length) break
    for (const k of data) {
      if ((k[0] as number) > endMs) break
      all.push({ time: Math.floor((k[0] as number)/1000), open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] })
    }
    from = (data[data.length-1][0] as number) + 1
    if (data.length < 1000) break
  }
  return all
}

async function main() {
  const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  console.log('\n=== BTC supertrend_macd 年度回測（4h, mult=3.0, MACD 12/26/9, CAPITAL=1000）===\n')

  const returns: number[] = []
  for (const p of PERIODS) {
    const startMs = new Date(p.start).getTime()
    const endMs   = new Date(p.end + 'T23:59:59Z').getTime()
    process.stdout.write(`${p.label}...`)
    const klines = await fetchKlines(startMs, endMs)
    const r = backtestSupertrendMacd(klines as any, PARAMS, CAPITAL)
    returns.push(r.totalReturn)
    console.log(` ${fmt(r.totalReturn)}  (${r.totalTrades} trades, winRate ${r.winRate.toFixed(0)}%, maxDD ${r.maxDrawdown.toFixed(1)}%)`)
  }

  console.log('\n平均（6 期）:', fmt(returns.reduce((a,b)=>a+b,0)/returns.length))
}

main().catch(console.error)
