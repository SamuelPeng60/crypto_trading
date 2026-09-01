import { backtestAdaptiveCombo, backtestSupertrendMacd } from '../lib/backtest'
interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CAPITAL = 10000, SYMBOL = 'ETHUSDT'
const PERIODS = [
  { label: '2021',    start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',    start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',    start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',    start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',    start: '2025-01-01', end: '2025-12-31' },
  { label: '2026H1',  start: '2026-01-01', end: '2026-06-30' },
  { label: '2026Q3',  start: '2026-07-01', end: '2026-08-31' },
]
const stm = (a: number, m: number) => ({ atrPeriod: a, multiplier: m, ema200Filter: true, macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: 1000 })
const C = [
  { label: 'adaptive 2.5/1.5 (現行)', run: backtestAdaptiveCombo, params: { fastEma:5, midEma:13, slowEma:34, atrPeriod:14, multiplier:2.5, ema200Filter:true, atrSlMultiplier:1.5, rsiPeriod:14, rsiOversold:35, rsiOverbought:65, bbPeriod:20, bbStdDev:2, vwapWindow:24, tradeSize:1000 } },
  { label: 'st_macd 14/2.0', run: backtestSupertrendMacd, params: stm(14, 2.0) },
  { label: 'st_macd 20/2.0', run: backtestSupertrendMacd, params: stm(20, 2.0) },
  { label: 'st_macd 14/2.5', run: backtestSupertrendMacd, params: stm(14, 2.5) },
]
async function fetchKlines(symbol: string, s: number, e: number): Promise<Kline[]> {
  const all: Kline[] = []; let from = s
  while (from < e) {
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${from}&limit=1000`)
    const d = await res.json() as unknown[][]; if (!d.length) break
    for (const k of d) { if ((k[0] as number) > e) break; all.push({ time: Math.floor((k[0] as number)/1000), open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] }) }
    from = (d[d.length-1][0] as number) + 1; if (d.length < 1000) break
  }
  return all
}
const pnlOf = (r: { trades: { side: string; pnl?: number }[] }) => r.trades.filter(t=>t.side==='sell').reduce((s,t)=>s+(t.pnl??0),0)
async function main() {
  const data: Record<string, Kline[]> = {}
  const bh: Record<string, number> = {}
  for (const p of PERIODS) {
    const warm = new Date(p.start).getTime() - 90*86400_000
    const endMs = new Date(p.end + 'T23:59:59Z').getTime()
    const kl = await fetchKlines(SYMBOL, warm, endMs)
    const ss = new Date(p.start).getTime()/1000
    const wi = kl.findIndex(k=>k.time>=ss)
    data[p.label] = kl.slice(Math.max(0, wi-250))
    const inP = kl.slice(wi)
    bh[p.label] = (inP.at(-1)!.close / inP[0].open - 1) * 100
  }
  console.log('\nETH 4h 誠實回測（每筆 1000 USDT，含手續費）—— 逐期損益 USDT / 筆數 / 勝率\n')
  console.log('策略'.padEnd(24) + PERIODS.map(p=>p.label.padStart(10)).join('') + '合計'.padStart(11))
  console.log('-'.repeat(24 + 10*PERIODS.length + 11))
  for (const c of C) {
    const cells: string[] = []; let tot = 0
    const detail: string[] = []
    for (const p of PERIODS) {
      const r = c.run(data[p.label] as never, c.params as never, CAPITAL)
      const v = pnlOf(r); tot += v
      cells.push(v.toFixed(0).padStart(10))
      detail.push(`${r.totalTrades}筆/${r.winRate.toFixed(0)}%`.padStart(10))
    }
    console.log(c.label.padEnd(24) + cells.join('') + tot.toFixed(0).padStart(11))
    console.log(''.padEnd(24) + detail.join(''))
  }
  console.log('\nETH 買入持有 %：' + PERIODS.map(p=>`${p.label} ${bh[p.label].toFixed(0)}%`).join('  '))
}
main()
