// 誠實回測 vs 實盤對照 —— 只跑目前 server 上實際在運行的策略與參數
// 回測已對齊引擎（棒內止損 / 動態止盈 / Fresh Buy Guard），數字應與實盤同號同量級
import { backtestVwapBbRsi, backtestAdaptiveCombo } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const BASE = 'https://data-api.binance.vision'
const CAPITAL = 10000   // tradeSize 1000 → 每筆下單 1000 USDT，與實盤一致

// server 上 strategies id=15/16 的實際參數
const VWAP_PARAMS = {
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  atrPeriod: 14, atrSlMultiplier: 1, trailAtrMult: 2,
  volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.3,
  tradeSize: 1000,
}
// server 上 strategy id=14 的實際參數
const ADAPTIVE_PARAMS = {
  fastEma: 5, midEma: 13, slowEma: 34,
  atrPeriod: 14, multiplier: 2.5, ema200Filter: true, atrSlMultiplier: 1.5,
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  tradeSize: 1000,
}

const RUNNING = [
  { symbol: 'SOLUSDT', label: 'SOL vwap_bb_rsi', run: backtestVwapBbRsi, params: VWAP_PARAMS },
  { symbol: 'BNBUSDT', label: 'BNB vwap_bb_rsi', run: backtestVwapBbRsi, params: VWAP_PARAMS },
  { symbol: 'ETHUSDT', label: 'ETH adaptive   ', run: backtestAdaptiveCombo, params: ADAPTIVE_PARAMS },
]

const PERIODS = [
  { label: '2022', start: '2022-01-01', end: '2022-12-31' },
  { label: '2023', start: '2023-01-01', end: '2023-12-31' },
  { label: '2024', start: '2024-01-01', end: '2024-12-31' },
  { label: '2025', start: '2025-01-01', end: '2025-12-31' },
  { label: '2026H1', start: '2026-01-01', end: '2026-07-13' },
  { label: '實盤這25天', start: '2026-06-18', end: '2026-07-13' },
]

// 實盤真實結果（server DB orders 表，2026-06-18 ~ 07-13）
const LIVE: Record<string, { pnl: number; trades: number; wins: number }> = {
  SOLUSDT: { pnl: -70.77, trades: 7, wins: 1 },
  BNBUSDT: { pnl: -73.95, trades: 6, wins: 0 },
  ETHUSDT: { pnl: -35.22, trades: 3, wins: 1 },
}

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
  console.log('誠實回測（已對齊引擎）—— server 上實際在跑的策略與參數，每筆下單 1000 USDT\n')

  for (const s of RUNNING) {
    console.log(`\n=== ${s.label} (${s.symbol}) ===`)
    console.log('期間            損益   筆數  勝率')
    console.log('-'.repeat(46))
    let total = 0
    for (const per of PERIODS) {
      const warm = new Date(per.start).getTime() - 90 * 86400_000
      const endMs = new Date(per.end + 'T23:59:59Z').getTime()
      const kl = await fetchKlines(s.symbol, warm, endMs)
      const startSec = new Date(per.start).getTime() / 1000
      const wi = kl.findIndex(k => k.time >= startSec)
      const sliced = kl.slice(Math.max(0, wi - 250))

      const r = s.run(sliced as never, s.params as never, CAPITAL)
      const p = pnlOf(r)
      if (per.label !== '實盤這25天') total += p   // 25天窗口與年度重疊，不計入合計

      console.log(
        `${per.label.padEnd(11)} ${p.toFixed(0).padStart(6)} USDT ${String(r.totalTrades).padStart(4)}筆 ${r.winRate.toFixed(0).padStart(3)}%`,
      )
      if (per.label === '實盤這25天') {
        const lv = LIVE[s.symbol]
        const wr = lv.trades ? (lv.wins / lv.trades) * 100 : 0
        console.log(
          `└ 實盤實際  ${lv.pnl.toFixed(0).padStart(6)} USDT ${String(lv.trades).padStart(4)}筆 ${wr.toFixed(0).padStart(3)}%   ← 對照`,
        )
      }
    }
    console.log('-'.repeat(46))
    console.log(`2022–2026H1 合計 ${total.toFixed(0).padStart(6)} USDT`)
  }
}

main()
