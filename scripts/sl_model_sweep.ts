// 兩種止損檢查模型 × 參數掃描
//   close  = 只在 4h 收盤檢查 SL（現行回測的假設）
//   intra  = 棒內即時檢查 SL（現行引擎的真實行為）
import { rsi, bollingerBands, vwap, atr } from '../lib/indicators'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const BASE = 'https://data-api.binance.vision'
const TRADE_SIZE = 1000
const FEE = 0.001
const SYMBOLS = ['SOLUSDT', 'BNBUSDT', 'ETHUSDT', 'BTCUSDT']

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

function realizedVol(c: number[], i: number, w: number): number {
  if (i < w) return NaN
  const rets: number[] = []
  for (let j = i - w + 1; j <= i; j++) rets.push(Math.log(c[j] / c[j - 1]))
  const m = rets.reduce((a, b) => a + b, 0) / rets.length
  return Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length)
}

interface Cfg { slMult: number; trailMult: number; model: 'close' | 'intra'; hardStopPct?: number }

function run(klines: Kline[], cfg: Cfg, fromTime: number) {
  const c = klines.map(k => k.close)
  const rsiVals = rsi(c, 14)
  const bb = bollingerBands(c, 20, 2)
  const vwapVals = vwap(klines, 24)
  const atrVals = atr(klines, 14)

  let pos: { price: number; qty: number; sl: number; high: number } | null = null
  const trades: { pnl: number; t: number }[] = []

  for (let i = 1; i < klines.length; i++) {
    if (isNaN(rsiVals[i]) || isNaN(bb.lower[i]) || isNaN(vwapVals[i]) || isNaN(atrVals[i])) continue
    const k = klines[i]
    const price = k.close
    const prevClose = klines[i - 1].close
    let slFired = false

    if (pos) {
      if (price > pos.high) pos.high = price
      const freshInit = pos.price - cfg.slMult * atrVals[i]
      const freshTrail = pos.high - cfg.trailMult * atrVals[i]
      pos.sl = Math.max(pos.sl, freshInit, freshTrail)

      // 災難性硬止損（僅 close 模型使用，棒內即時觸發，作為尾部風險保護）
      const hardSl = cfg.hardStopPct ? pos.price * (1 - cfg.hardStopPct / 100) : -Infinity
      if (cfg.model === 'close' && cfg.hardStopPct && k.low <= hardSl) {
        trades.push({ pnl: (hardSl - pos.price) * pos.qty - pos.qty * hardSl * FEE, t: k.time })
        pos = null; slFired = true
      } else if (cfg.model === 'intra' && k.low <= pos.sl) {
        trades.push({ pnl: (pos.sl - pos.price) * pos.qty - pos.qty * pos.sl * FEE, t: k.time })
        pos = null; slFired = true
      } else if (cfg.model === 'close' && price <= pos.sl) {
        trades.push({ pnl: (price - pos.price) * pos.qty - pos.qty * price * FEE, t: k.time })
        pos = null; slFired = true
      }
    }

    const oversold = rsiVals[i] < 35 || (prevClose > bb.lower[i - 1] && price <= bb.lower[i])
    const sv = realizedVol(c, i, 20)
    const lv = realizedVol(c, i, 60)
    const inTrend = !isNaN(sv) && !isNaN(lv) && lv > 0 && sv / lv > 1.3

    if (oversold && !pos && !slFired && price < vwapVals[i] && !inTrend && k.time >= fromTime) {
      const qty = TRADE_SIZE / price
      pos = { price, qty, sl: price - cfg.slMult * atrVals[i], high: price }
      trades.push({ pnl: -TRADE_SIZE * FEE, t: k.time })  // 買入手續費
    }
  }
  if (pos) {
    const price = klines.at(-1)!.close
    trades.push({ pnl: (price - pos.price) * pos.qty - pos.qty * price * FEE, t: klines.at(-1)!.time })
  }
  return trades.filter(t => t.t >= fromTime)
}

const YEARS = [
  { label: '2022', start: '2022-01-01', end: '2023-01-01' },
  { label: '2023', start: '2023-01-01', end: '2024-01-01' },
  { label: '2024', start: '2024-01-01', end: '2025-01-01' },
  { label: '2025', start: '2025-01-01', end: '2026-01-01' },
  { label: '2026H1', start: '2026-01-01', end: '2026-07-13' },
]

async function main() {
  const data: Record<string, Kline[]> = {}
  for (const s of SYMBOLS) {
    data[s] = await fetchKlines(s, new Date('2021-10-01').getTime(), new Date('2026-07-13T23:59:59Z').getTime())
  }

  const combos: Cfg[] = []
  for (const model of ['close', 'intra'] as const)
    for (const slMult of [1, 1.5, 2, 2.5, 3])
      for (const trailMult of [2, 2.5, 3, 4])
        combos.push({ model, slMult, trailMult })
  // close 模型 + 災難硬止損 8%（可實作的安全網）
  for (const slMult of [1, 1.5, 2, 2.5])
    for (const trailMult of [2, 3])
      combos.push({ model: 'close', slMult, trailMult, hardStopPct: 8 })

  const rows: { cfg: Cfg; byYear: Record<string, number>; total: number; wr: number; n: number }[] = []

  for (const cfg of combos) {
    const byYear: Record<string, number> = {}
    let all: { pnl: number; t: number }[] = []
    for (const y of YEARS) {
      const from = new Date(y.start).getTime() / 1000
      const to = new Date(y.end).getTime() / 1000
      let sum = 0
      for (const s of SYMBOLS) {
        const kl = data[s].filter(k => k.time < to)
        const tr = run(kl, cfg, from)
        sum += tr.reduce((a, b) => a + b.pnl, 0)
        all = all.concat(tr)
      }
      byYear[y.label] = sum / SYMBOLS.length  // 每幣平均 USDT
    }
    const total = Object.values(byYear).reduce((a, b) => a + b, 0)
    // 勝率以「有出場的交易」計
    const exits = all.filter(t => Math.abs(t.pnl) > TRADE_SIZE * FEE + 0.001)
    const wr = exits.length ? (exits.filter(t => t.pnl > 0).length / exits.length) * 100 : 0
    rows.push({ cfg, byYear, total, wr, n: exits.length })
  }

  const fmt = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(0)
  const header = ['模型', 'sl', 'trail', 'hard', ...YEARS.map(y => y.label), '合計', '勝率']
  console.log('每幣平均 PnL (USDT，每筆下單 1000)\n')
  console.log(header.map((h, i) => h.padStart(i < 4 ? 6 : 8)).join(' '))
  console.log('-'.repeat(90))
  for (const r of rows.sort((a, b) => b.total - a.total)) {
    console.log([
      r.cfg.model.padStart(6),
      String(r.cfg.slMult).padStart(6),
      String(r.cfg.trailMult).padStart(6),
      (r.cfg.hardStopPct ? r.cfg.hardStopPct + '%' : '-').padStart(6),
      ...YEARS.map(y => fmt(r.byYear[y.label]).padStart(8)),
      fmt(r.total).padStart(8),
      (r.wr.toFixed(0) + '%').padStart(8),
    ].join(' '))
  }
}

main()
