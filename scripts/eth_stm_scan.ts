// ETH supertrend_macd 參數掃描 —— 檢查最佳值是「穩健高原」還是單點過擬合
import { backtestSupertrendMacd } from '../lib/backtest'
interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CAPITAL = 10000
const SYMBOL = 'ETHUSDT'

const PERIODS = [
  { label: '2021',    start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',    start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',    start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',    start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',    start: '2025-01-01', end: '2025-12-31' },
  { label: '2026YTD', start: '2026-01-01', end: '2026-08-31' },
]
const ATRS = [7, 10, 14, 20]
const MULTS = [1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.5]

async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = []
  let from = startMs
  while (from < endMs) {
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${from}&limit=1000`)
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
const pnlOf = (r: { trades: { side: string; pnl?: number }[] }) =>
  r.trades.filter(t => t.side === 'sell').reduce((s, t) => s + (t.pnl ?? 0), 0)

async function main() {
  const data: Record<string, Kline[]> = {}
  for (const per of PERIODS) {
    const warm = new Date(per.start).getTime() - 90 * 86400_000
    const endMs = new Date(per.end + 'T23:59:59Z').getTime()
    const kl = await fetchKlines(SYMBOL, warm, endMs)
    const startSec = new Date(per.start).getTime() / 1000
    const wi = kl.findIndex(k => k.time >= startSec)
    data[per.label] = kl.slice(Math.max(0, wi - 250))
  }

  console.log('\nETH st_macd 參數掃描（ex-2021 損益 USDT，每筆 1000）')
  console.log('atr\mult' + MULTS.map(m => String(m).padStart(8)).join(''))
  const rows: { atr: number; mult: number; ex21: number; total: number; negYears: number; worst: number; trades: number; mdd: number }[] = []
  for (const atr of ATRS) {
    const cells: string[] = []
    for (const mult of MULTS) {
      const p = { atrPeriod: atr, multiplier: mult, ema200Filter: true, macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: 1000 }
      let ex21 = 0, total = 0, neg = 0, worst = 0, trades = 0, mdd = 0
      for (const per of PERIODS) {
        const r = backtestSupertrendMacd(data[per.label] as never, p, CAPITAL)
        const v = pnlOf(r)
        total += v
        trades += r.totalTrades
        if (r.maxDrawdown > mdd) mdd = r.maxDrawdown
        if (per.label !== '2021') { ex21 += v; if (v < 0) neg++; if (v < worst) worst = v }
      }
      rows.push({ atr, mult, ex21, total, negYears: neg, worst, trades, mdd })
      cells.push(ex21.toFixed(0).padStart(8))
    }
    console.log(String(atr).padEnd(8) + cells.join(''))
  }

  console.log('\n前 10 名（依 ex-2021）:')
  console.log('atr mult   ex2021    合計  虧損年 最差年   筆數  最大回撤')
  for (const r of [...rows].sort((a, b) => b.ex21 - a.ex21).slice(0, 10)) {
    console.log(`${String(r.atr).padStart(3)} ${String(r.mult).padStart(4)} ${r.ex21.toFixed(0).padStart(8)} ${r.total.toFixed(0).padStart(7)} ${String(r.negYears).padStart(6)} ${r.worst.toFixed(0).padStart(6)} ${String(r.trades).padStart(6)} ${r.mdd.toFixed(1).padStart(8)}%`)
  }
  const neg = rows.filter(r => r.ex21 < 0).length
  console.log(`\n${rows.length} 組中 ex-2021 為負的有 ${neg} 組；中位數 ${[...rows].sort((a,b)=>a.ex21-b.ex21)[Math.floor(rows.length/2)].ex21.toFixed(0)}`)
}
main()
