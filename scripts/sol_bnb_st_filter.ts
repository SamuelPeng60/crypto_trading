// SOL / BNB Crypto Pulse + SuperTrend 方向過濾 比較回測
// 比較：原始 vwap_bb_rsi (trail=2.0, sl=1.0) vs 加上 ST 多頭過濾 (stAtrPeriod=10, stMult=3.0)
import { backtestVwapBbRsi } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CAPITAL = 1000

const BASE_PARAMS = {
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  atrPeriod: 14, atrSlMultiplier: 1.0, trailAtrMult: 2.0,
  volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.3,
  tradeSize: CAPITAL,
}

const ST_PARAMS = { ...BASE_PARAMS, stAtrPeriod: 10, stMultiplier: 3.0 }

const PERIODS = [
  { label: '2021',      start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',      start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',      start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',      start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',      start: '2025-01-01', end: '2025-12-31' },
  { label: '2026Q1',    start: '2026-01-01', end: '2026-03-31' },
  { label: '2026Q2',    start: '2026-04-01', end: '2026-06-02' },
]

const SYMBOLS = ['SOLUSDT', 'BNBUSDT']

async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = []
  let from = startMs
  while (from < endMs) {
    const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${from}&limit=1000`
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

async function main() {
  const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const fmtDiff = (a: number, b: number) => {
    const d = b - a
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%'
  }

  console.log('\n=== SOL / BNB Crypto Pulse + SuperTrend 方向過濾 比較（4h, trail=2.0, sl=1.0）===\n')
  console.log('ST 參數：atrPeriod=10, multiplier=3.0（進場時 SuperTrend 需為多頭方向）\n')

  for (const symbol of SYMBOLS) {
    console.log(`─── ${symbol.replace('USDT', '')} ──────────────────────────────────────`)
    console.log(`${'期間'.padEnd(10)} ${'無ST過濾'.padStart(10)} ${'有ST過濾'.padStart(10)} ${'差值'.padStart(8)} ${'有ST交易數'.padStart(10)}`)
    console.log('─'.repeat(52))

    const baseReturns: number[] = []
    const stReturns: number[] = []

    for (const p of PERIODS) {
      const startMs = new Date(p.start).getTime()
      const endMs   = new Date(p.end).getTime() + 86400000

      const klines = await fetchKlines(symbol, startMs, endMs)
      if (klines.length < 50) {
        console.log(`${p.label.padEnd(10)} 資料不足`)
        continue
      }

      const base = backtestVwapBbRsi(klines, BASE_PARAMS, CAPITAL)
      const st   = backtestVwapBbRsi(klines, ST_PARAMS, CAPITAL)

      baseReturns.push(base.totalReturn)
      stReturns.push(st.totalReturn)

      const diff = fmtDiff(base.totalReturn, st.totalReturn)
      const diffNum = st.totalReturn - base.totalReturn
      const diffStr = (diffNum >= 0 ? '+' : '') + diffNum.toFixed(1) + '%'
      const marker = diffNum > 1 ? ' ✓' : diffNum < -1 ? ' ✗' : ''

      console.log(
        `${p.label.padEnd(10)} ${fmt(base.totalReturn).padStart(10)} ${fmt(st.totalReturn).padStart(10)} ${diffStr.padStart(8)}${marker}  (${st.totalTrades}筆)`
      )
    }

    const avgBase = baseReturns.reduce((s, v) => s + v, 0) / baseReturns.length
    const avgSt   = stReturns.reduce((s, v) => s + v, 0) / stReturns.length
    const avgDiff = avgSt - avgBase
    console.log('─'.repeat(52))
    console.log(
      `${'平均'.padEnd(10)} ${fmt(avgBase).padStart(10)} ${fmt(avgSt).padStart(10)} ${((avgDiff >= 0 ? '+' : '') + avgDiff.toFixed(1) + '%').padStart(8)}`
    )
    console.log()
  }

  // 2幣合計平均
  console.log('=== 2 幣各期平均比較 ===\n')
  const allBase: number[][] = PERIODS.map(() => [])
  const allSt:   number[][] = PERIODS.map(() => [])

  for (const symbol of SYMBOLS) {
    for (let pi = 0; pi < PERIODS.length; pi++) {
      const p = PERIODS[pi]
      const startMs = new Date(p.start).getTime()
      const endMs   = new Date(p.end).getTime() + 86400000
      const klines  = await fetchKlines(symbol, startMs, endMs)
      if (klines.length < 50) continue
      const base = backtestVwapBbRsi(klines, BASE_PARAMS, CAPITAL)
      const st   = backtestVwapBbRsi(klines, ST_PARAMS, CAPITAL)
      allBase[pi].push(base.totalReturn)
      allSt[pi].push(st.totalReturn)
    }
  }

  console.log(`${'期間'.padEnd(10)} ${'無ST（2幣均）'.padStart(12)} ${'有ST（2幣均）'.padStart(12)} ${'差值'.padStart(8)}`)
  console.log('─'.repeat(46))
  const grandBase: number[] = []
  const grandSt:   number[] = []
  for (let pi = 0; pi < PERIODS.length; pi++) {
    if (!allBase[pi].length) continue
    const b = allBase[pi].reduce((s, v) => s + v, 0) / allBase[pi].length
    const s = allSt[pi].reduce((x, v) => x + v, 0) / allSt[pi].length
    const d = s - b
    grandBase.push(b)
    grandSt.push(s)
    console.log(
      `${PERIODS[pi].label.padEnd(10)} ${fmt(b).padStart(12)} ${fmt(s).padStart(12)} ${((d >= 0 ? '+' : '') + d.toFixed(1) + '%').padStart(8)}`
    )
  }
  const gb = grandBase.reduce((s, v) => s + v, 0) / grandBase.length
  const gs = grandSt.reduce((s, v) => s + v, 0) / grandSt.length
  console.log('─'.repeat(46))
  console.log(`${'全期平均'.padEnd(10)} ${fmt(gb).padStart(12)} ${fmt(gs).padStart(12)} ${((gs - gb >= 0 ? '+' : '') + (gs - gb).toFixed(1) + '%').padStart(8)}`)
}

main().catch(console.error)
