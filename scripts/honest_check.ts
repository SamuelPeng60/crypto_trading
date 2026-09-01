// 誠實回測 vs 實盤對照 —— 只跑目前 server 上實際在運行的策略與參數
// 回測已對齊引擎（棒內止損 / 動態止盈 / Fresh Buy Guard / st_macd 下一棒開盤成交）
// 陣容（2026-09-02 起）：BTC/ETH/SOL/BNB 全部 supertrend_macd，全 live
import { backtestSupertrendMacd } from '../lib/backtest'

interface Kline { time: number; open: number; high: number; low: number; close: number; volume: number }

const BASE = 'https://data-api.binance.vision'
const CAPITAL = 10000   // tradeSize 1000 → 每筆下單 1000 USDT，與實盤一致

// server 上 strategies id=17(BTC)/16(SOL) 的實際參數
const STM_30 = {
  atrPeriod: 14, multiplier: 3.0, ema200Filter: true,
  macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: 1000,
}
// id=15(BNB)：mult=2.5（低波動幣用較緊的翻轉閾值）
const STM_25 = { ...STM_30, multiplier: 2.5 }
// id=14(ETH)：mult=2.0（ETH 4h 波動較小，需更緊的翻轉閾值）
const STM_20 = { ...STM_30, multiplier: 2.0 }

const RUNNING = [
  { symbol: 'BTCUSDT', label: 'BTC st_macd 3.0', run: backtestSupertrendMacd, params: STM_30 },
  { symbol: 'SOLUSDT', label: 'SOL st_macd 3.0', run: backtestSupertrendMacd, params: STM_30 },
  { symbol: 'BNBUSDT', label: 'BNB st_macd 2.5', run: backtestSupertrendMacd, params: STM_25 },
  { symbol: 'ETHUSDT', label: 'ETH st_macd 2.0', run: backtestSupertrendMacd, params: STM_20 },
]

const PERIODS = [
  { label: '2021', start: '2021-01-01', end: '2021-12-31' },
  { label: '2022', start: '2022-01-01', end: '2022-12-31' },
  { label: '2023', start: '2023-01-01', end: '2023-12-31' },
  { label: '2024', start: '2024-01-01', end: '2024-12-31' },
  { label: '2025', start: '2025-01-01', end: '2025-12-31' },
  { label: '2026H1', start: '2026-01-01', end: '2026-07-13' },
]

// 實盤對照（僅列與當前策略相同配置的歷史數據；四幣 st_macd 皆尚無足夠實盤記錄）
const LIVE: Record<string, { pnl: number; trades: number; wins: number; note: string }> = {}

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
      total += p

      console.log(
        `${per.label.padEnd(11)} ${p.toFixed(0).padStart(6)} USDT ${String(r.totalTrades).padStart(4)}筆 ${r.winRate.toFixed(0).padStart(3)}%`,
      )
    }
    console.log('-'.repeat(46))
    console.log(`2021–2026H1 合計 ${total.toFixed(0).padStart(6)} USDT`)
    const lv = LIVE[s.symbol]
    if (lv) {
      const wr = lv.trades ? (lv.wins / lv.trades) * 100 : 0
      console.log(`實盤對照（${lv.note}）：${lv.pnl.toFixed(0)} USDT ${lv.trades}筆 勝${wr.toFixed(0)}%`)
    }
  }
}

main()
