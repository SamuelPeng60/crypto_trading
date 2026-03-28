/**
 * High-return parameter sweep — optimise for totalReturn
 * Run: npx tsx scripts/sweep2.ts
 */
import { fetchKlinesFull } from '../lib/binance'
import {
  backtestEmaRibbonSt, EmaRibbonStParams,
  backtestVwapBbRsi,   VwapBbRsiParams,
  backtestSupertrend,  SupertrendParams,
} from '../lib/backtest'

const INITIAL = 10_000
const TRADE   = 1_000
const SYMBOL  = 'BTCUSDT'

type Row = { label: string; ret: number; wr: number; dd: number; sharpe: number; n: number }

function run(label: string, ret: number, wr: number, dd: number, sharpe: number, n: number): Row {
  return { label, ret, wr, dd, sharpe, n }
}

// ─────────────────────────────────────────────
// Sweeps
// ─────────────────────────────────────────────
function sweepRibbon(klines: ReturnType<typeof Array.prototype.filter>, label: string) {
  const results: { p: EmaRibbonStParams; ret: number; r: ReturnType<typeof backtestEmaRibbonSt> }[] = []
  const ribbons: [number,number,number][] = [[5,13,34],[8,21,55],[9,21,55],[5,8,21],[3,8,21]]
  const atrPs  = [7,10,14]
  const mults  = [2.0,2.5,3.0,3.5]
  const slMult = [1.5,2.0,2.5,3.0]   // trailing ATR multiplier — bigger = more room to run

  for (const [f,m,s] of ribbons)
    for (const atrPeriod of atrPs)
      for (const multiplier of mults)
        for (const atrSlMultiplier of slMult) {
          const p: EmaRibbonStParams = { fastEma:f, midEma:m, slowEma:s, atrPeriod, multiplier, ema200Filter:true, atrSlMultiplier, tradeSize:TRADE }
          const r = backtestEmaRibbonSt(klines as any, p, INITIAL)
          if (r.totalTrades >= 3) results.push({ p, ret: r.totalReturn, r })
        }

  results.sort((a,b) => b.ret - a.ret)
  console.log(`\n── EMA Ribbon [${label}] TOP 5 by return ──`)
  for (const {p,r} of results.slice(0,5))
    console.log(`  ema(${p.fastEma},${p.midEma},${p.slowEma}) atr=${p.atrPeriod} mult=${p.multiplier} trail=${p.atrSlMultiplier}  ret=${r.totalReturn.toFixed(1)}%  wr=${r.winRate.toFixed(0)}%  dd=${r.maxDrawdown.toFixed(1)}%  n=${r.totalTrades}`)
  return results[0]
}

function sweepPulse(klines: ReturnType<typeof Array.prototype.filter>, label: string) {
  const results: { p: VwapBbRsiParams; ret: number; r: ReturnType<typeof backtestVwapBbRsi> }[] = []
  const vwapWins  = [12, 24, 48]
  const oversolds = [25, 30, 35]
  const overbts   = [65, 70, 75]
  const atrSls    = [1.0, 1.5, 2.0]

  for (const vwapWindow of vwapWins)
    for (const rsiOversold of oversolds)
      for (const rsiOverbought of overbts)
        for (const atrSlMultiplier of atrSls) {
          const p: VwapBbRsiParams = {
            rsiPeriod:14, rsiOversold, rsiOverbought,
            bbPeriod:20, bbStdDev:2, vwapWindow,
            atrPeriod:14, atrSlMultiplier, tradeSize:TRADE,
          }
          const r = backtestVwapBbRsi(klines as any, p, INITIAL)
          if (r.totalTrades >= 5) results.push({ p, ret: r.totalReturn, r })
        }

  results.sort((a,b) => b.ret - a.ret)
  console.log(`\n── Crypto Pulse [${label}] TOP 5 by return ──`)
  for (const {p,r} of results.slice(0,5))
    console.log(`  vwap=${p.vwapWindow} rsi(${p.rsiOversold}/${p.rsiOverbought}) atrSl=${p.atrSlMultiplier}  ret=${r.totalReturn.toFixed(1)}%  wr=${r.winRate.toFixed(0)}%  dd=${r.maxDrawdown.toFixed(1)}%  n=${r.totalTrades}`)
  return results[0]
}

function sweepST(klines: ReturnType<typeof Array.prototype.filter>, label: string) {
  const results: { p: SupertrendParams; ret: number; r: ReturnType<typeof backtestSupertrend> }[] = []
  const atrPs  = [7,10,14]
  const mults  = [1.5,2.0,2.5,3.0,3.5]
  const ema200 = [true, false]

  for (const atrPeriod of atrPs)
    for (const multiplier of mults)
      for (const ema200Filter of ema200) {
        const p: SupertrendParams = { atrPeriod, multiplier, ema200Filter, tradeSize:TRADE }
        const r = backtestSupertrend(klines as any, p, INITIAL)
        if (r.totalTrades >= 3) results.push({ p, ret: r.totalReturn, r })
      }

  results.sort((a,b) => b.ret - a.ret)
  console.log(`\n── SuperTrend [${label}] TOP 5 by return ──`)
  for (const {p,r} of results.slice(0,5))
    console.log(`  atr=${p.atrPeriod} mult=${p.multiplier} ema200=${p.ema200Filter}  ret=${r.totalReturn.toFixed(1)}%  wr=${r.winRate.toFixed(0)}%  dd=${r.maxDrawdown.toFixed(1)}%  n=${r.totalTrades}`)
  return results[0]
}

// ─────────────────────────────────────────────
async function main() {
  console.log('Fetching 2-year data...')
  const [k1h, k4h, k1d] = await Promise.all([
    fetchKlinesFull(SYMBOL, '1h',  17520),
    fetchKlinesFull(SYMBOL, '4h',  4380),
    fetchKlinesFull(SYMBOL, '1d',  730),
  ])
  console.log(`  1h=${k1h.length}  4h=${k4h.length}  1d=${k1d.length}`)

  const now = Date.now() / 1000
  const cut1y = now - 365*86400
  const k1h_1y = k1h.filter(k => k.time >= cut1y)
  const k4h_1y = k4h.filter(k => k.time >= cut1y)
  const k1d_1y = k1d.filter(k => k.time >= cut1y)

  // EMA Ribbon — test 4h and 1d both years
  const r4h_2y = sweepRibbon(k4h, 'BTCUSDT 4h 2y')
  const r1d_2y = sweepRibbon(k1d, 'BTCUSDT 1d 2y')
  const r4h_1y = sweepRibbon(k4h_1y, 'BTCUSDT 4h 1y')
  const r1d_1y = sweepRibbon(k1d_1y, 'BTCUSDT 1d 1y')

  // Crypto Pulse
  const p4h_2y = sweepPulse(k4h, 'BTCUSDT 4h 2y')
  const p1h_2y = sweepPulse(k1h, 'BTCUSDT 1h 2y')
  const p4h_1y = sweepPulse(k4h_1y, 'BTCUSDT 4h 1y')
  const p1h_1y = sweepPulse(k1h_1y, 'BTCUSDT 1h 1y')

  // SuperTrend
  const st4h_2y = sweepST(k4h, 'BTCUSDT 4h 2y')
  const st1d_2y = sweepST(k1d, 'BTCUSDT 1d 2y')
  const st4h_1y = sweepST(k4h_1y, 'BTCUSDT 4h 1y')
  const st1d_1y = sweepST(k1d_1y, 'BTCUSDT 1d 1y')

  // ── Final summary ──
  const all = [
    { name:'EMA Ribbon 4h 2y', r:r4h_2y.r, p:r4h_2y.p, tf:'4h', window:'2年' },
    { name:'EMA Ribbon 1d 2y', r:r1d_2y.r, p:r1d_2y.p, tf:'1d', window:'2年' },
    { name:'EMA Ribbon 4h 1y', r:r4h_1y.r, p:r4h_1y.p, tf:'4h', window:'1年' },
    { name:'EMA Ribbon 1d 1y', r:r1d_1y.r, p:r1d_1y.p, tf:'1d', window:'1年' },
    { name:'Crypto Pulse 4h 2y', r:p4h_2y.r, p:p4h_2y.p, tf:'4h', window:'2年' },
    { name:'Crypto Pulse 1h 2y', r:p1h_2y.r, p:p1h_2y.p, tf:'1h', window:'2年' },
    { name:'Crypto Pulse 4h 1y', r:p4h_1y.r, p:p4h_1y.p, tf:'4h', window:'1年' },
    { name:'Crypto Pulse 1h 1y', r:p1h_1y.r, p:p1h_1y.p, tf:'1h', window:'1年' },
    { name:'SuperTrend 4h 2y', r:st4h_2y.r, p:st4h_2y.p, tf:'4h', window:'2年' },
    { name:'SuperTrend 1d 2y', r:st1d_2y.r, p:st1d_2y.p, tf:'1d', window:'2年' },
    { name:'SuperTrend 4h 1y', r:st4h_1y.r, p:st4h_1y.p, tf:'4h', window:'1年' },
    { name:'SuperTrend 1d 1y', r:st1d_1y.r, p:st1d_1y.p, tf:'1d', window:'1年' },
  ].sort((a,b) => b.r.totalReturn - a.r.totalReturn)

  console.log('\n\n══════════════════════════════════════════════════════════════')
  console.log('  OVERALL RANKING — sorted by total return')
  console.log('══════════════════════════════════════════════════════════════')
  for (const {name, r} of all)
    console.log(`  ${name.padEnd(26)} ret=${r.totalReturn.toFixed(1).padStart(6)}%  wr=${r.winRate.toFixed(0).padStart(4)}%  dd=${r.maxDrawdown.toFixed(1).padStart(5)}%  sharpe=${r.sharpeRatio.toFixed(2).padStart(5)}  n=${r.totalTrades}`)

  console.log('\n── TOP PICK PER STRATEGY ──')
  const topRibbon = [r4h_2y,r1d_2y,r4h_1y,r1d_1y].sort((a,b)=>b.ret-a.ret)[0]
  const topPulse  = [p4h_2y,p1h_2y,p4h_1y,p1h_1y].sort((a,b)=>b.ret-a.ret)[0]
  const topST     = [st4h_2y,st1d_2y,st4h_1y,st1d_1y].sort((a,b)=>b.ret-a.ret)[0]

  const rp = topRibbon.p as EmaRibbonStParams
  console.log(`\nEMA Ribbon best:  ret=${topRibbon.ret.toFixed(1)}%`)
  console.log(`  ema(${rp.fastEma},${rp.midEma},${rp.slowEma})  atrPeriod=${rp.atrPeriod}  multiplier=${rp.multiplier}  trailAtr=${rp.atrSlMultiplier}`)

  const pp = topPulse.p as VwapBbRsiParams
  console.log(`\nCrypto Pulse best: ret=${topPulse.ret.toFixed(1)}%`)
  console.log(`  vwap=${pp.vwapWindow}  rsi(${pp.rsiOversold}/${pp.rsiOverbought})  atrSl=${pp.atrSlMultiplier}`)

  const sp = topST.p as SupertrendParams
  console.log(`\nSuperTrend best:   ret=${topST.ret.toFixed(1)}%`)
  console.log(`  atrPeriod=${sp.atrPeriod}  multiplier=${sp.multiplier}  ema200=${sp.ema200Filter}`)
}

main().catch(console.error)
