// 回溯檢查：8% 硬擋規則套用在 2026-08-27/28 那三筆手動買入會怎樣
import { supertrend } from '../lib/indicators'
interface K { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CASES = [
  { s: 'BTCUSDT', mult: 3.0, at: '2026-08-27T19:38:47Z', px: 80029.04, pnl: -42.04 },
  { s: 'BNBUSDT', mult: 2.5, at: '2026-08-27T19:39:07Z', px: 711.19, pnl: -39.61 },
  { s: 'SOLUSDT', mult: 3.0, at: '2026-08-28T01:32:06Z', px: 109.49, pnl: -88.77 },
]
async function main() {
  for (const c of CASES) {
    const end = new Date(c.at).getTime()
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${c.s}&interval=4h&endTime=${end}&limit=500`)
    const d = await res.json() as unknown[][]
    const kl: K[] = d.map(k => ({ time: Math.floor((k[0] as number) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }))
    const conf = kl.slice(0, -1)   // 引擎買入當下看到的已收盤棒
    const { direction, trend } = supertrend(conf, 14, c.mult)
    const i = direction.length - 1
    const drop = (c.px - trend[i]) / c.px
    let bars = 1
    for (let j = i - 1; j >= 0 && direction[j] === direction[i]; j--) bars++
    const blocked = direction[i] !== 1 || drop > 0.08
    console.log(`${c.s} @${c.px}  ST=${direction[i] === 1 ? '多頭' : '空頭'}  翻空線=${trend[i].toFixed(2)}  距離=${(drop * 100).toFixed(1)}%  已多頭 ${bars} 棒(${(bars * 4 / 24).toFixed(1)}天)  → ${blocked ? '⛔ 擋下' : '✅ 放行'}  (實際 PnL ${c.pnl})`)
  }
}
main()
