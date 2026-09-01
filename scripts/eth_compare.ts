// ETH 策略比較（誠實回測，已對齊引擎）
// 現況：ETH = adaptive_combo (id=14)；BTC/SOL/BNB 已換 supertrend_macd
// 問題：ETH 是否也該換 st_macd？
import { backtestAdaptiveCombo, backtestSupertrendMacd, backtestSupertrend } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CAPITAL = 10000
const SYMBOL = 'ETHUSDT'

const ADAPTIVE = {
  fastEma: 5, midEma: 13, slowEma: 34,
  atrPeriod: 14, multiplier: 2.5, ema200Filter: true, atrSlMultiplier: 1.5,
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  tradeSize: 1000,
}
const stm = (mult: number, atrPeriod = 14) => ({
  atrPeriod, multiplier: mult, ema200Filter: true,
  macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: 1000,
})
const st = (mult: number) => ({ atrPeriod: 14, multiplier: mult, ema200Filter: true, tradeSize: 1000 })

const CANDIDATES = [
  { label: 'adaptive 2.5/1.5 (現行)', run: backtestAdaptiveCombo, params: ADAPTIVE },
  { label: 'st_macd 14/2.0',          run: backtestSupertrendMacd, params: stm(2.0) },
  { label: 'st_macd 14/2.5',          run: backtestSupertrendMacd, params: stm(2.5) },
  { label: 'st_macd 14/3.0',          run: backtestSupertrendMacd, params: stm(3.0) },
  { label: 'st_macd 14/3.5',          run: backtestSupertrendMacd, params: stm(3.5) },
  { label: 'st_macd 10/3.0',          run: backtestSupertrendMacd, params: stm(3.0, 10) },
  { label: 'st_macd 20/3.0',          run: backtestSupertrendMacd, params: stm(3.0, 20) },
  { label: 'supertrend 14/3.0',       run: backtestSupertrend,     params: st(3.0) },
  { label: 'supertrend 14/2.5',       run: backtestSupertrend,     params: st(2.5) },
]

const PERIODS = [
  { label: '2021',   start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',   start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',   start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',   start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',   start: '2025-01-01', end: '2025-12-31' },
  { label: '2026YTD',start: '2026-01-01', end: '2026-08-31' },
]

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
  // 先抓好每期 K 線（避免每個策略重抓）
  const data: Record<string, Kline[]> = {}
  for (const per of PERIODS) {
    const warm = new Date(per.start).getTime() - 90 * 86400_000
    const endMs = new Date(per.end + 'T23:59:59Z').getTime()
    const kl = await fetchKlines(SYMBOL, warm, endMs)
    const startSec = new Date(per.start).getTime() / 1000
    const wi = kl.findIndex(k => k.time >= startSec)
    data[per.label] = kl.slice(Math.max(0, wi - 250))
    console.error(`fetched ${per.label}: ${data[per.label].length} bars`)
  }

  console.log(`\nETH 4h 誠實回測（每筆下單 1000 USDT，已扣手續費）\n`)
  const head = ['策略'.padEnd(24), ...PERIODS.map(p => p.label.padStart(8)), '合計'.padStart(9), 'ex2021'.padStart(9), '筆數'.padStart(6)]
  console.log(head.join(''))
  console.log('-'.repeat(24 + 8 * PERIODS.length + 9 + 9 + 6))

  for (const c of CANDIDATES) {
    const cells: string[] = []
    let total = 0, ex21 = 0, trades = 0
    for (const per of PERIODS) {
      const r = c.run(data[per.label] as never, c.params as never, CAPITAL)
      const p = pnlOf(r)
      total += p
      if (per.label !== '2021') ex21 += p
      trades += r.totalTrades
      cells.push(p.toFixed(0).padStart(8))
    }
    console.log(c.label.padEnd(24) + cells.join('') + total.toFixed(0).padStart(9) + ex21.toFixed(0).padStart(9) + String(trades).padStart(6))
  }
}

main()
