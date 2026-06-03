// 全期回測彙整：BTC=supertrend_macd, ETH=adaptive_combo, SOL/BNB=vwap_bb_rsi
import {
  backtestSupertrendMacd, backtestAdaptiveCombo, backtestVwapBbRsi
} from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CAP  = 1000

const PERIODS = [
  { label: '2021',      start: '2021-01-01', end: '2021-12-31' },
  { label: '2022',      start: '2022-01-01', end: '2022-12-31' },
  { label: '2023',      start: '2023-01-01', end: '2023-12-31' },
  { label: '2024',      start: '2024-01-01', end: '2024-12-31' },
  { label: '2025',      start: '2025-01-01', end: '2025-12-31' },
  { label: '2026Q1-Q2', start: '2026-01-01', end: '2026-05-24' },
]

const btcP  = { atrPeriod:14, multiplier:3.0, ema200Filter:true, macdFast:12, macdSlow:26, macdSignal:9, tradeSize:CAP }
const ethP  = { fastEma:5, midEma:13, slowEma:34, atrPeriod:14, multiplier:2.5, ema200Filter:true, atrSlMultiplier:1.5, rsiPeriod:14, rsiOversold:35, rsiOverbought:65, bbPeriod:20, bbStdDev:2, vwapWindow:24, volRegimeShort:20, volRegimeLong:60, volRegimeThreshold:1.35, tradeSize:CAP }
const vwapP = { rsiPeriod:14, rsiOversold:35, rsiOverbought:65, bbPeriod:20, bbStdDev:2, vwapWindow:24, atrPeriod:14, atrSlMultiplier:1.0, trailAtrMult:2.0, volRegimeShort:20, volRegimeLong:60, volRegimeThreshold:1.3, tradeSize:CAP }

async function fetch4h(sym: string, startMs: number, endMs: number): Promise<Kline[]> {
  const all: Kline[] = []
  let from = startMs
  while (from < endMs) {
    const url = `${BASE}/api/v3/klines?symbol=${sym}&interval=4h&startTime=${from}&limit=1000`
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
  const rows: { label: string; btc: number; eth: number; sol: number; bnb: number }[] = []

  for (const p of PERIODS) {
    const s = new Date(p.start).getTime()
    const e = new Date(p.end + 'T23:59:59Z').getTime()
    process.stdout.write(`${p.label}... `)

    const [btcK, ethK, solK, bnbK] = await Promise.all([
      fetch4h('BTCUSDT', s, e),
      fetch4h('ETHUSDT', s, e),
      fetch4h('SOLUSDT', s, e),
      fetch4h('BNBUSDT', s, e),
    ])
    const btc = backtestSupertrendMacd(btcK as any, btcP, CAP).totalReturn
    const eth = backtestAdaptiveCombo(ethK as any, ethP, CAP).totalReturn
    const sol = backtestVwapBbRsi(solK as any, vwapP, CAP).totalReturn
    const bnb = backtestVwapBbRsi(bnbK as any, vwapP, CAP).totalReturn
    rows.push({ label: p.label, btc, eth, sol, bnb })
    console.log(`BTC ${fmt(btc)}  ETH ${fmt(eth)}  SOL ${fmt(sol)}  BNB ${fmt(bnb)}`)
  }

  console.log('\n=== 全期回測彙整 ===')
  console.log('| 期間 | BTC ★ | ETH ▲ | SOL | BNB | 4幣平均 |')
  console.log('|------|--------|--------|-----|-----|--------|')

  const avgs = rows.map(r => {
    const avg = (r.btc + r.eth + r.sol + r.bnb) / 4
    const emoji = r.label === '2022' ? '🐻' : r.label === '2025' ? '📊' : r.label.includes('2026') ? '📊' : '🐂'
    console.log(`| ${r.label} ${emoji} | ${fmt(r.btc)} | ${fmt(r.eth)} | ${fmt(r.sol)} | ${fmt(r.bnb)} | **${fmt(avg)}** |`)
    return avg
  })
  const grandAvg = avgs.reduce((a,b)=>a+b,0)/avgs.length
  console.log(`\n★ BTC = supertrend_macd（4h, mult=3.0, MACD 12/26/9）`)
  console.log(`▲ ETH = adaptive_combo（4h, mult=2.5, atrSl=1.5）`)
  console.log(`  SOL/BNB = vwap_bb_rsi（4h, trail=2.0, sl=1.0）`)
  console.log(`\n6 期 4 幣整體平均：${fmt(grandAvg)}`)
}

function fmt(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }

main().catch(console.error)
