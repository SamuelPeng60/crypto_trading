// BTC 6-strategy full comparison — best-return params, Fix4
import {
  backtestSupertrend,
  backtestVwapBbRsi,
  backtestEmaRibbonSt,
  backtestMacdBbSqueeze,
  backtestAdaptiveCombo,
  backtestMaConsolidation,
} from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const SYMBOL   = 'BTCUSDT'
const CAPITAL  = 1000
const BASE     = 'https://data-api.binance.vision'

const PERIODS = [
  { label: '2021',   start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',   start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',   start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',   start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',   start: '2025-01-01', end: '2025-12-31' },
  { label: '2026Q1', start: '2026-01-01', end: '2026-03-31' },
  { label: '2026Q2', start: '2026-04-01', end: '2026-05-24' },
]

async function fetchKlines(interval: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = []
  let from = startMs
  while (from < endMs) {
    const url = `${BASE}/api/v3/klines?symbol=${SYMBOL}&interval=${interval}&startTime=${from}&limit=1000`
    const res  = await fetch(url)
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

// ── Best-return params (from app/backtest/page.tsx BEST_RETURN_PRESET) ────────

const stParams = {
  atrPeriod: 14, multiplier: 1.5, ema200Filter: true, tradeSize: CAPITAL,
}

const vwapParams = {
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  atrPeriod: 14, atrSlMultiplier: 1.0, trailAtrMult: 2.0,
  volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.3,
  tradeSize: CAPITAL,
}

const ribbonParams = {
  fastEma: 5, midEma: 8, slowEma: 21,
  atrPeriod: 14, multiplier: 3.5,
  ema200Filter: true, atrSlMultiplier: 2.0,
  tradeSize: CAPITAL,
}

const macdParams = {
  macdFast: 12, macdSlow: 26, macdSignal: 9,
  bbPeriod: 15, rsiPeriod: 14, atrPeriod: 14,
  atrSlMultiplier: 2, atrTpMultiplier: 5,
  ema200Filter: true, tradeSize: CAPITAL,
}

const adaptiveParams = {
  fastEma: 5, midEma: 13, slowEma: 34,
  atrPeriod: 14, multiplier: 2.5,
  ema200Filter: true, atrSlMultiplier: 1.5,
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35,
  tradeSize: CAPITAL,
}

const consolParams = {
  ma1: 30, ma2: 45, ma3: 60,
  compressionPct: 1.5, consolidationBars: 8,
  trailAtrMult: 2.0, atrPeriod: 14,
  tradeSize: CAPITAL,
}

// ── Main ──────────────────────────────────────────────────────────────────────

type StratKey = 'st' | 'vwap' | 'ribbon' | 'macd' | 'adaptive' | 'consol'
const STRAT_LABELS: Record<StratKey, string> = {
  st:       'SuperTrend ',
  vwap:     'VWAP/BB/RSI',
  ribbon:   'EMA Ribbon ',
  macd:     'MACD Squeeze',
  adaptive: 'Adaptive   ',
  consol:   'MA Consol  ',
}

async function main() {
  const results: Record<StratKey, number[]> = {
    st: [], vwap: [], ribbon: [], macd: [], adaptive: [], consol: [],
  }

  for (const p of PERIODS) {
    const startMs = new Date(p.start).getTime()
    const endMs   = new Date(p.end + 'T23:59:59Z').getTime()

    process.stdout.write(`[${p.label}] Fetching 4h...`)
    const k4h = await fetchKlines('4h', startMs, endMs)
    process.stdout.write(` ${k4h.length} bars  | Fetching 1h...`)
    const k1h = await fetchKlines('1h', startMs, endMs)
    console.log(` ${k1h.length} bars`)

    results.st.push(      backtestSupertrend(k4h as any, stParams,       CAPITAL).totalReturn)
    results.vwap.push(    backtestVwapBbRsi( k4h as any, vwapParams,     CAPITAL).totalReturn)
    results.ribbon.push(  backtestEmaRibbonSt(k4h as any, ribbonParams,  CAPITAL).totalReturn)
    results.macd.push(    backtestMacdBbSqueeze(k4h as any, macdParams,  CAPITAL).totalReturn)
    results.adaptive.push(backtestAdaptiveCombo(k4h as any, adaptiveParams, CAPITAL).totalReturn)
    results.consol.push(  backtestMaConsolidation(k1h as any, consolParams, CAPITAL).totalReturn)
  }

  const fmt  = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const avg  = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
  const keys = Object.keys(results) as StratKey[]

  // ── Table ──────────────────────────────────────────────────────────────────
  const COL = 13
  const pad  = (s: string) => s.padStart(COL)
  const header = '期間       ' + keys.map(k => pad(STRAT_LABELS[k])).join('')
  console.log('\n=== BTC 6策略比較（最佳回測參數，Fix4，CAPITAL=1000）===')
  console.log(header)
  console.log('─'.repeat(header.length))

  for (let i = 0; i < PERIODS.length; i++) {
    const row = PERIODS[i].label.padEnd(11) + keys.map(k => pad(fmt(results[k][i]))).join('')
    console.log(row)
  }
  console.log('─'.repeat(header.length))

  const avgRow = '平均       ' + keys.map(k => pad(fmt(avg(results[k])))).join('')
  console.log(avgRow)

  // ── Ranking ────────────────────────────────────────────────────────────────
  const ranked = keys
    .map(k => ({ key: k, label: STRAT_LABELS[k].trim(), avg: avg(results[k]) }))
    .sort((a, b) => b.avg - a.avg)

  console.log('\n=== BTC 策略排名 ===')
  ranked.forEach((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`
    console.log(`${medal} ${r.label.padEnd(14)} 平均 ${fmt(r.avg)}`)
  })

  // ── Per-strategy bear market check ─────────────────────────────────────────
  console.log('\n=== 2022 熊市防守 ===')
  const bear = ranked.map(r => ({ ...r, bear: results[r.key][1] })).sort((a, b) => b.bear - a.bear)
  bear.forEach(r => console.log(`  ${r.label.padEnd(14)} 2022: ${fmt(r.bear)}`))
}

main().catch(console.error)
