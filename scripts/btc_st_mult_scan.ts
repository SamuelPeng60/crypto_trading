// SuperTrend multiplier 掃描：找在 2026Q1/Q2 表現更穩健的值
import { backtestSupertrend } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CAPITAL = 1000

const PERIODS = [
  { label: '2021',   start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',   start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',   start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',   start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',   start: '2025-01-01', end: '2025-12-31' },
  { label: '2026Q1', start: '2026-01-01', end: '2026-03-31' },
  { label: '2026Q2', start: '2026-04-01', end: '2026-05-24' },
]
const MULTS = [1.5, 2.0, 2.5, 3.0, 3.5]

async function fetchKlines(interval: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = []
  let from = startMs
  while (from < endMs) {
    const url = `${BASE}/api/v3/klines?symbol=BTCUSDT&interval=${interval}&startTime=${from}&limit=1000`
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
  const allKlines: Kline[][] = []
  for (const p of PERIODS) {
    process.stdout.write(`Fetching ${p.label}...`)
    const k = await fetchKlines('4h', new Date(p.start).getTime(), new Date(p.end + 'T23:59:59Z').getTime())
    allKlines.push(k)
    console.log(` ${k.length} bars`)
  }

  const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const avg = (a: number[]) => a.reduce((s,x)=>s+x,0)/a.length

  const COL = 9
  const pad = (s: string) => s.padStart(COL)

  console.log('\n=== SuperTrend multiplier 掃描（4h, atrPeriod=14, ema200=true）===')
  console.log('mult  ' + PERIODS.map(p => p.label.padStart(COL)).join('') + pad('平均') + pad('trades平均'))
  console.log('─'.repeat(6 + (PERIODS.length + 2) * COL))

  for (const mult of MULTS) {
    const returns: number[] = []
    const tradeCounts: number[] = []
    for (const kl of allKlines) {
      const r = backtestSupertrend(kl as any, { atrPeriod: 14, multiplier: mult, ema200Filter: true, tradeSize: CAPITAL }, CAPITAL)
      returns.push(r.totalReturn)
      tradeCounts.push(r.totalTrades)
    }
    const avgTrades = tradeCounts.reduce((a,b)=>a+b,0)/tradeCounts.length
    console.log(
      String(mult).padEnd(6) +
      returns.map(r => pad(fmt(r))).join('') +
      pad(fmt(avg(returns))) +
      pad(avgTrades.toFixed(1))
    )
  }
}

main().catch(console.error)
