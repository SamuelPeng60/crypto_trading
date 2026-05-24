// BTC SuperTrend multiplier 完整比較 + MACD 元素整合測試
// 測三個 MACD Squeeze 元素如何加強 SuperTrend：
//   Hybrid A: ST + MACD histogram 確認（過濾假翻多）
//   Hybrid B: ST + ATR TP（快速止盈，不等到翻空）
//   Hybrid C: ST + MACD確認 + ATR TP（A+B 組合）

import { closes, supertrend, atr as calcAtr, macd as calcMacd, ema, bollingerBands } from '../lib/indicators'
import { backtestSupertrend } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const BASE    = 'https://data-api.binance.vision'
const CAPITAL = 1000
const BINANCE_FEE = 0.001

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

// ── 共用統計 ─────────────────────────────────────────────────────────────────

function calcStats(initialCapital: number, trades: { pnl?: number }[], equity: { value: number }[]) {
  const finalCapital = equity.at(-1)?.value ?? initialCapital
  const totalReturn = (finalCapital - initialCapital) / initialCapital * 100
  let peak = initialCapital, maxDrawdown = 0
  for (const e of equity) {
    if (e.value > peak) peak = e.value
    const dd = (peak - e.value) / peak * 100
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  const closed = trades.filter(t => t.pnl !== undefined)
  const wins   = closed.filter(t => (t.pnl ?? 0) > 0)
  const winRate = closed.length ? wins.length / closed.length * 100 : 0
  const returns: number[] = []
  for (let i = 1; i < equity.length; i++) returns.push((equity[i].value - equity[i-1].value) / equity[i-1].value)
  const meanR = returns.reduce((a,b)=>a+b,0) / (returns.length||1)
  const stdR  = Math.sqrt(returns.reduce((a,b)=>a+(b-meanR)**2,0) / (returns.length||1))
  const sharpe = stdR ? (meanR / stdR) * Math.sqrt(365) : 0
  return { totalReturn, maxDrawdown, winRate, trades: closed.length, sharpe }
}

// ── Hybrid A: ST flip + MACD histogram > 0 雙重確認 ─────────────────────────
// 買入：ST 翻多 AND macd histogram 由負轉正（動能確認）
// 賣出：ST 翻空 OR macd histogram 由正轉負
function backtestStMacd(klines: Kline[], mult: number) {
  const c = closes(klines)
  const { direction } = supertrend(klines, 14, mult)
  const ema200    = ema(c, 200)
  const atrVals   = calcAtr(klines, 14)
  const macdVals  = calcMacd(c, 12, 26, 9)

  let capital = CAPITAL
  let position: { price: number; qty: number } | null = null
  const trades: { pnl?: number }[] = []
  const equity: { value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(direction[i]) || isNaN(macdVals.histogram[i]) || isNaN(atrVals[i])) {
      equity.push({ value: capital + (position ? position.qty * klines[i].close : 0) }); continue
    }
    const price      = klines[i].close
    const stFlipUp   = direction[i-1] === -1 && direction[i] === 1
    const stFlipDown = direction[i-1] === 1  && direction[i] === -1
    const macdUp     = macdVals.histogram[i] > 0 && macdVals.histogram[i-1] <= 0  // macd 由負轉正
    const macdDown   = macdVals.histogram[i] < 0 && macdVals.histogram[i-1] >= 0  // macd 由正轉負
    const macdPos    = macdVals.histogram[i] > 0                                   // macd 正值中
    const aboveEma   = isNaN(ema200[i]) || price > ema200[i]

    // 出場：ST 翻空 OR macd 由正轉負
    if (position && (stFlipDown || macdDown)) {
      const pnl = (price - position.price) * position.qty
      capital += position.qty * price * (1 - BINANCE_FEE)
      trades.push({ pnl }); position = null
    }
    // 進場：ST 翻多 AND macd 正值（動能確認）AND EMA200
    if (!position && stFlipUp && macdPos && aboveEma && capital > 0) {
      const qty = Math.min(CAPITAL, capital * 0.999) / price
      capital -= qty * price * (1 + BINANCE_FEE)
      position = { price, qty }; trades.push({})
    }
    equity.push({ value: capital + (position ? position.qty * price : 0) })
  }
  if (position) {
    const price = klines.at(-1)!.close
    trades.push({ pnl: (price - position.price) * position.qty })
  }
  return calcStats(CAPITAL, trades, equity)
}

// ── Hybrid B: ST flip + ATR Take Profit ──────────────────────────────────────
// 買入：ST 翻多
// 賣出：ST 翻空 OR 達到 atrTpMult × ATR 止盈（先到先得）
function backtestStAtrTp(klines: Kline[], mult: number, atrTpMult: number) {
  const c = closes(klines)
  const { direction } = supertrend(klines, 14, mult)
  const ema200  = ema(c, 200)
  const atrVals = calcAtr(klines, 14)

  let capital = CAPITAL
  let position: { price: number; qty: number; tp: number } | null = null
  const trades: { pnl?: number }[] = []
  const equity: { value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(direction[i]) || isNaN(atrVals[i])) {
      equity.push({ value: capital + (position ? position.qty * klines[i].close : 0) }); continue
    }
    const price      = klines[i].close
    const stFlipUp   = direction[i-1] === -1 && direction[i] === 1
    const stFlipDown = direction[i-1] === 1  && direction[i] === -1
    const aboveEma   = isNaN(ema200[i]) || price > ema200[i]

    // 出場：達 TP 或 ST 翻空
    if (position) {
      if (price >= position.tp) {
        const pnl = (position.tp - position.price) * position.qty
        capital += position.qty * position.tp * (1 - BINANCE_FEE)
        trades.push({ pnl }); position = null
        equity.push({ value: capital }); continue
      }
      if (stFlipDown) {
        const pnl = (price - position.price) * position.qty
        capital += position.qty * price * (1 - BINANCE_FEE)
        trades.push({ pnl }); position = null
      }
    }
    // 進場：ST 翻多
    if (!position && stFlipUp && aboveEma && capital > 0) {
      const qty = Math.min(CAPITAL, capital * 0.999) / price
      const tp  = price + atrTpMult * atrVals[i]
      capital -= qty * price * (1 + BINANCE_FEE)
      position = { price, qty, tp }; trades.push({})
    }
    equity.push({ value: capital + (position ? position.qty * price : 0) })
  }
  if (position) {
    const price = klines.at(-1)!.close
    trades.push({ pnl: (price - position.price) * position.qty })
  }
  return calcStats(CAPITAL, trades, equity)
}

// ── Hybrid C: ST + MACD確認 + ATR TP ─────────────────────────────────────────
function backtestStMacdTp(klines: Kline[], mult: number, atrTpMult: number) {
  const c = closes(klines)
  const { direction } = supertrend(klines, 14, mult)
  const ema200   = ema(c, 200)
  const atrVals  = calcAtr(klines, 14)
  const macdVals = calcMacd(c, 12, 26, 9)

  let capital = CAPITAL
  let position: { price: number; qty: number; tp: number } | null = null
  const trades: { pnl?: number }[] = []
  const equity: { value: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(direction[i]) || isNaN(macdVals.histogram[i]) || isNaN(atrVals[i])) {
      equity.push({ value: capital + (position ? position.qty * klines[i].close : 0) }); continue
    }
    const price      = klines[i].close
    const stFlipUp   = direction[i-1] === -1 && direction[i] === 1
    const stFlipDown = direction[i-1] === 1  && direction[i] === -1
    const macdDown   = macdVals.histogram[i] < 0 && macdVals.histogram[i-1] >= 0
    const macdPos    = macdVals.histogram[i] > 0
    const aboveEma   = isNaN(ema200[i]) || price > ema200[i]

    // 出場：達 TP 或 ST 翻空 或 MACD 轉負
    if (position) {
      if (price >= position.tp) {
        const pnl = (position.tp - position.price) * position.qty
        capital += position.qty * position.tp * (1 - BINANCE_FEE)
        trades.push({ pnl }); position = null
        equity.push({ value: capital }); continue
      }
      if (stFlipDown || macdDown) {
        const pnl = (price - position.price) * position.qty
        capital += position.qty * price * (1 - BINANCE_FEE)
        trades.push({ pnl }); position = null
      }
    }
    // 進場：ST 翻多 AND macd 正值
    if (!position && stFlipUp && macdPos && aboveEma && capital > 0) {
      const qty = Math.min(CAPITAL, capital * 0.999) / price
      const tp  = price + atrTpMult * atrVals[i]
      capital -= qty * price * (1 + BINANCE_FEE)
      position = { price, qty, tp }; trades.push({})
    }
    equity.push({ value: capital + (position ? position.qty * price : 0) })
  }
  if (position) {
    const price = klines.at(-1)!.close
    trades.push({ pnl: (price - position.price) * position.qty })
  }
  return calcStats(CAPITAL, trades, equity)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const allKlines: Kline[][] = []
  for (const p of PERIODS) {
    process.stdout.write(`Fetching ${p.label}... `)
    const k = await fetchKlines('4h', new Date(p.start).getTime(), new Date(p.end + 'T23:59:59Z').getTime())
    allKlines.push(k); console.log(`${k.length} bars`)
  }

  const fmt  = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const fmtS = (v: number) => v.toFixed(2)
  const avg  = (a: number[]) => a.reduce((s,x)=>s+x,0)/a.length

  type Config = { label: string; fn: (k: Kline[]) => ReturnType<typeof calcStats> }

  const configs: Config[] = [
    // Plain SuperTrend（三個 multiplier）
    { label: 'ST  mult=2.0', fn: k => backtestSupertrend(k as any, { atrPeriod:14, multiplier:2.0, ema200Filter:true, tradeSize:CAPITAL }, CAPITAL) },
    { label: 'ST  mult=2.5', fn: k => backtestSupertrend(k as any, { atrPeriod:14, multiplier:2.5, ema200Filter:true, tradeSize:CAPITAL }, CAPITAL) },
    { label: 'ST  mult=3.0', fn: k => backtestSupertrend(k as any, { atrPeriod:14, multiplier:3.0, ema200Filter:true, tradeSize:CAPITAL }, CAPITAL) },
    // Hybrid A：ST + MACD 確認（mult=2.0 / 2.5 / 3.0）
    { label: 'A   mult=2.0', fn: k => backtestStMacd(k, 2.0) },
    { label: 'A   mult=2.5', fn: k => backtestStMacd(k, 2.5) },
    { label: 'A   mult=3.0', fn: k => backtestStMacd(k, 3.0) },
    // Hybrid B：ST + ATR TP=4（mult=2.0 / 3.0）
    { label: 'B   mult=2.0 TP=4', fn: k => backtestStAtrTp(k, 2.0, 4) },
    { label: 'B   mult=3.0 TP=4', fn: k => backtestStAtrTp(k, 3.0, 4) },
    // Hybrid C：ST + MACD + TP（最佳組合搜尋）
    { label: 'C   mult=2.0 TP=4', fn: k => backtestStMacdTp(k, 2.0, 4) },
    { label: 'C   mult=3.0 TP=4', fn: k => backtestStMacdTp(k, 3.0, 4) },
  ]

  // ── 報酬率表 ──────────────────────────────────────────────────────────────
  const COL = 8
  const pad = (s: string) => s.padStart(COL)
  const hdr = '策略                ' + PERIODS.map(p=>p.label.padStart(COL)).join('') + pad('平均') + pad('Sharpe') + pad('maxDD') + pad('筆數')
  console.log('\n=== BTC SuperTrend × MACD 混合策略比較（4h, CAPITAL=1000）===')
  console.log(hdr)
  console.log('─'.repeat(hdr.length))

  const rows: { label: string; returns: number[]; sharpes: number[]; dds: number[]; counts: number[] }[] = []

  for (const cfg of configs) {
    const returns: number[] = [], sharpes: number[] = [], dds: number[] = [], counts: number[] = []
    for (const kl of allKlines) {
      const r = cfg.fn(kl)
      returns.push(r.totalReturn); sharpes.push(r.sharpe); dds.push(r.maxDrawdown); counts.push(r.trades)
    }
    rows.push({ label: cfg.label, returns, sharpes, dds, counts })
    console.log(
      cfg.label.padEnd(20) +
      returns.map(r => pad(fmt(r))).join('') +
      pad(fmt(avg(returns))) +
      pad(fmtS(avg(sharpes))) +
      pad(fmt(avg(dds))) +
      pad(avg(counts).toFixed(1))
    )
  }

  // ── 聚焦 2026Q1 / Q2 ─────────────────────────────────────────────────────
  const q1i = 5, q2i = 6
  console.log('\n=== 聚焦 2026Q1 / Q2（最差時段）===')
  console.log('策略                  2026Q1    2026Q2    合計')
  console.log('─'.repeat(50))
  for (const r of rows) {
    const q1 = r.returns[q1i], q2 = r.returns[q2i], sum = q1 + q2
    console.log(
      r.label.padEnd(22) +
      fmt(q1).padStart(8) + '  ' +
      fmt(q2).padStart(8) + '  ' +
      fmt(sum).padStart(8) + (sum > 0 ? '  ✅' : '')
    )
  }

  // ── 綜合排名 ──────────────────────────────────────────────────────────────
  console.log('\n=== 綜合評分排名（平均報酬 × 0.5 + Sharpe × 10 × 0.3 - maxDD × 0.2）===')
  const scored = rows.map(r => {
    const a = avg(r.returns), s = avg(r.sharpes), d = avg(r.dds)
    const score = a * 0.5 + s * 10 * 0.3 - d * 0.2
    return { label: r.label, avg: a, sharpe: s, dd: d, score }
  }).sort((a,b) => b.score - a.score)
  scored.forEach((r, i) => {
    const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`
    console.log(`${medal} ${r.label.padEnd(22)} 平均:${fmt(r.avg).padStart(7)}  Sharpe:${fmtS(r.sharpe)}  maxDD:${fmt(r.dd).padStart(7)}  score:${r.score.toFixed(2)}`)
  })
}

main().catch(console.error)
