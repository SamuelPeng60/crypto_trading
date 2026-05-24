// BTC 2026 Q1/Q2 診斷：市場結構 + 各策略逐筆交易明細
import {
  backtestSupertrend,
  backtestVwapBbRsi,
  backtestEmaRibbonSt,
  backtestMacdBbSqueeze,
  backtestAdaptiveCombo,
  backtestMaConsolidation,
} from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const SYMBOL  = 'BTCUSDT'
const CAPITAL = 1000
const BASE    = 'https://data-api.binance.vision'

const PERIODS = [
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
      all.push({ time: Math.floor((k[0] as number)/1000), open:+k[1], high:+k[2], low:+k[3], close:+k[4], volume:+k[5] })
    }
    from = (data[data.length-1][0] as number) + 1
    if (data.length < 1000) break
  }
  return all
}

function toDate(ts: number) { return new Date(ts * 1000).toISOString().slice(0, 10) }
function fmt(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }

// ── 市場結構分析 ─────────────────────────────────────────────────────────────

function marketSummary(label: string, k4h: Kline[]) {
  const first = k4h[0], last = k4h[k4h.length - 1]
  const priceChg = (last.close - first.open) / first.open * 100

  // 最高最低
  const high = Math.max(...k4h.map(k => k.high))
  const low  = Math.min(...k4h.map(k => k.low))
  const range = (high - low) / low * 100

  // 上漲棒比例
  const upBars = k4h.filter(k => k.close > k.open).length
  const upPct  = upBars / k4h.length * 100

  // 平均 ATR / close
  const atrs: number[] = []
  for (let i = 1; i < k4h.length; i++) {
    const hl  = k4h[i].high  - k4h[i].low
    const hpc = Math.abs(k4h[i].high  - k4h[i-1].close)
    const lpc = Math.abs(k4h[i].low   - k4h[i-1].close)
    atrs.push(Math.max(hl, hpc, lpc) / k4h[i].close * 100)
  }
  const avgAtrPct = atrs.reduce((a,b)=>a+b,0) / atrs.length

  // 趨勢強度：連續上漲棒 vs 連續下跌棒（移動後最長streak）
  let maxUp=0, maxDn=0, curUp=0, curDn=0
  for (const k of k4h) {
    if (k.close > k.open) { curUp++; curDn=0; maxUp=Math.max(maxUp,curUp) }
    else                  { curDn++; curUp=0; maxDn=Math.max(maxDn,curDn) }
  }

  console.log(`\n── ${label} 市場結構（4h bars: ${k4h.length}）──`)
  console.log(`  開盤 $${first.open.toFixed(0)}  →  收盤 $${last.close.toFixed(0)}   期間漲跌: ${fmt(priceChg)}`)
  console.log(`  最高 $${high.toFixed(0)}   最低 $${low.toFixed(0)}   高低幅度: ${fmt(range)}`)
  console.log(`  上漲棒: ${upPct.toFixed(1)}%   平均 ATR/close: ${avgAtrPct.toFixed(2)}%`)
  console.log(`  最長連漲streak: ${maxUp} 棒   最長連跌streak: ${maxDn} 棒`)

  // 月份拆解
  const monthly: Record<string, { first: number; last: number }> = {}
  for (const k of k4h) {
    const m = new Date(k.time*1000).toISOString().slice(0, 7)
    if (!monthly[m]) monthly[m] = { first: k.open, last: k.close }
    monthly[m].last = k.close
  }
  console.log('  月份拆解:')
  for (const [m, v] of Object.entries(monthly)) {
    const chg = (v.last - v.first) / v.first * 100
    console.log(`    ${m}: ${fmt(chg)}  ($${v.first.toFixed(0)} → $${v.last.toFixed(0)})`)
  }
}

// ── 策略診斷 ─────────────────────────────────────────────────────────────────

function stratDiag(name: string, result: ReturnType<typeof backtestSupertrend>) {
  const sells = result.trades.filter(t => t.side === 'sell' && t.pnl !== undefined)
  const wins  = sells.filter(t => (t.pnl ?? 0) > 0)
  const loss  = sells.filter(t => (t.pnl ?? 0) <= 0)
  const avgWin  = wins.length  ? wins.reduce((a,t)=>a+(t.pnl??0),0)/wins.length   : 0
  const avgLoss = loss.length  ? loss.reduce((a,t)=>a+(t.pnl??0),0)/loss.length   : 0
  const totalPnl = sells.reduce((a,t)=>a+(t.pnl??0),0)

  console.log(`\n  [${name}]  return: ${fmt(result.totalReturn)}   trades: ${sells.length}   winRate: ${result.winRate.toFixed(0)}%   maxDD: ${result.maxDrawdown.toFixed(1)}%`)
  if (sells.length === 0) { console.log('    → 0 筆交易'); return }
  console.log(`    avgWin: $${avgWin.toFixed(2)}   avgLoss: $${avgLoss.toFixed(2)}   totalPnl: $${totalPnl.toFixed(2)}`)
  // 印每筆交易
  for (const t of sells) {
    const pnlPct = (t.pnl ?? 0) / CAPITAL * 100
    const icon = (t.pnl ?? 0) > 0 ? '✓' : '✗'
    console.log(`    ${icon} sell ${toDate(t.time)}  price $${t.price.toFixed(0)}  pnl $${(t.pnl??0).toFixed(2)} (${pnlPct.toFixed(2)}%)`)
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const stParams     = { atrPeriod: 14, multiplier: 1.5, ema200Filter: true, tradeSize: CAPITAL }
const vwapParams   = { rsiPeriod:14, rsiOversold:35, rsiOverbought:65, bbPeriod:20, bbStdDev:2, vwapWindow:24, atrPeriod:14, atrSlMultiplier:1.0, trailAtrMult:2.0, volRegimeShort:20, volRegimeLong:60, volRegimeThreshold:1.3, tradeSize:CAPITAL }
const ribbonParams = { fastEma:5, midEma:8, slowEma:21, atrPeriod:14, multiplier:3.5, ema200Filter:true, atrSlMultiplier:2.0, tradeSize:CAPITAL }
const macdParams   = { macdFast:12, macdSlow:26, macdSignal:9, bbPeriod:15, rsiPeriod:14, atrPeriod:14, atrSlMultiplier:2, atrTpMultiplier:5, ema200Filter:true, tradeSize:CAPITAL }
const adaptiveParams = { fastEma:5, midEma:13, slowEma:34, atrPeriod:14, multiplier:2.5, ema200Filter:true, atrSlMultiplier:1.5, rsiPeriod:14, rsiOversold:35, rsiOverbought:65, bbPeriod:20, bbStdDev:2, vwapWindow:24, volRegimeShort:20, volRegimeLong:60, volRegimeThreshold:1.35, tradeSize:CAPITAL }
const consolParams = { ma1:30, ma2:45, ma3:60, compressionPct:1.5, consolidationBars:8, trailAtrMult:2.0, atrPeriod:14, tradeSize:CAPITAL }

async function main() {
  for (const p of PERIODS) {
    const startMs = new Date(p.start).getTime()
    const endMs   = new Date(p.end + 'T23:59:59Z').getTime()

    process.stdout.write(`\nFetching ${p.label}...`)
    const k4h = await fetchKlines('4h', startMs, endMs)
    const k1h = await fetchKlines('1h', startMs, endMs)
    console.log(` 4h: ${k4h.length} bars, 1h: ${k1h.length} bars`)

    marketSummary(p.label, k4h)

    console.log('\n  === 各策略明細 ===')
    stratDiag('SuperTrend  ', backtestSupertrend(k4h as any, stParams, CAPITAL))
    stratDiag('VWAP/BB/RSI ', backtestVwapBbRsi(k4h as any, vwapParams, CAPITAL))
    stratDiag('EMA Ribbon  ', backtestEmaRibbonSt(k4h as any, ribbonParams, CAPITAL))
    stratDiag('MACD Squeeze', backtestMacdBbSqueeze(k4h as any, macdParams, CAPITAL))
    stratDiag('Adaptive    ', backtestAdaptiveCombo(k4h as any, adaptiveParams, CAPITAL))
    stratDiag('MA Consol   ', backtestMaConsolidation(k1h as any, consolParams, CAPITAL))
  }
}

main().catch(console.error)
