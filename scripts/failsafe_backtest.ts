// failsafe 重新進場回測
// A. 對策略本身的影響：failsafeBars 掃描 × 四幣 × 逐期
// B. 一鍵平倉救援模擬：對每一筆真實交易，窮舉所有可能的「手動平倉時點」，
//    比較「平掉後沒有 failsafe」vs「平掉後有 failsafe」vs「根本沒平（基準）」
import { backtestSupertrendMacd } from '../lib/backtest'
import { supertrend, ema } from '../lib/indicators'

interface K { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const FEE = 0.001
const SIZE = 1000
const CFG = [
  { s: 'BTCUSDT', m: 3.0 }, { s: 'ETHUSDT', m: 2.0 },
  { s: 'SOLUSDT', m: 3.0 }, { s: 'BNBUSDT', m: 2.5 },
]
const P = (m: number, failsafeBars = 0) => ({
  atrPeriod: 14, multiplier: m, ema200Filter: true,
  macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: SIZE, failsafeBars,
})
const NS = [0, 6, 12, 18, 24, 36, 48, 72, 96, 144]
// 2021/2023/2024 是明確的牛市年，2022 熊市、2025 震盪、2026YTD 盤整
const BULL = new Set(['2021', '2023', '2024'])
const PERIODS = [
  ['2021', '2021-01-01', '2021-12-31'], ['2022', '2022-01-01', '2022-12-31'],
  ['2023', '2023-01-01', '2023-12-31'], ['2024', '2024-01-01', '2024-12-31'],
  ['2025', '2025-01-01', '2025-12-31'], ['26YTD', '2026-01-01', '2026-09-12'],
]

async function fetchKlines(sym: string, a: number, b: number): Promise<K[]> {
  const all: K[] = []
  let from = a
  while (from < b) {
    const r = await fetch(`${BASE}/api/v3/klines?symbol=${sym}&interval=4h&startTime=${from}&limit=1000`)
    const d = await r.json() as unknown[][]
    if (!d.length) break
    for (const k of d) {
      if ((k[0] as number) > b) break
      all.push({ time: Math.floor((k[0] as number) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })
    }
    from = (d[d.length - 1][0] as number) + 1
    if (d.length < 1000) break
  }
  return all
}

const pnlOf = (r: { trades: { side: string; pnl?: number }[] }) =>
  r.trades.filter(t => t.side === 'sell').reduce((s, t) => s + (t.pnl ?? 0), 0)
const nTrades = (r: { trades: { side: string }[] }) => r.trades.filter(t => t.side === 'sell').length
const pnl = (entry: number, exit: number) => (SIZE / entry) * (exit * (1 - FEE) - entry * (1 + FEE))
const breakout = (kl: K[], i: number, n: number) => {
  if (n <= 0 || i - n < 0) return false
  let hi = -Infinity
  for (let j = i - n; j < i; j++) if (kl[j].high > hi) hi = kl[j].high
  return kl[i].close > hi
}

async function main() {
  const full: Record<string, K[]> = {}
  for (const c of CFG) full[c.s] = await fetchKlines(c.s, new Date('2021-01-01T00:00:00Z').getTime() - 120 * 86400_000, Date.now())

  // ================= A. 對策略本身的影響 =================
  console.log('\n========== A. failsafe 對策略本身的影響（4h，每筆 1000 USDT，含手續費）==========')
  const totals: Record<number, number> = {}, totalsEx21: Record<number, number> = {}
  const bullT: Record<number, number> = {}, bearT: Record<number, number> = {}, ytdT: Record<number, number> = {}
  const perCoinEx21: Record<string, Record<number, number>> = {}
  for (const c of CFG) {
    console.log(`\n=== ${c.s} mult=${c.m} ===`)
    console.log('N'.padEnd(6) + PERIODS.map(p => p[0].padStart(9)).join('') + '     合計   ex-2021   筆數')
    for (const N of NS) {
      const row: number[] = []
      for (const [, s, e] of PERIODS) {
        const startSec = new Date(s).getTime() / 1000
        const endSec = new Date(e + 'T23:59:59Z').getTime() / 1000
        const wi = full[c.s].findIndex(k => k.time >= startSec)
        const sliced = full[c.s].slice(Math.max(0, wi - 250)).filter(k => k.time <= endSec)
        row.push(pnlOf(backtestSupertrendMacd(sliced as never, P(c.m, N) as never, 100000)))
      }
      const sum = row.reduce((a, b) => a + b, 0)
      const ex21 = sum - row[0]
      totals[N] = (totals[N] ?? 0) + sum
      totalsEx21[N] = (totalsEx21[N] ?? 0) + ex21
      perCoinEx21[c.s] = perCoinEx21[c.s] ?? {}
      perCoinEx21[c.s][N] = ex21
      PERIODS.forEach(([lbl], k) => {
        if (BULL.has(lbl)) bullT[N] = (bullT[N] ?? 0) + row[k]
        else if (lbl === '26YTD') ytdT[N] = (ytdT[N] ?? 0) + row[k]
        else bearT[N] = (bearT[N] ?? 0) + row[k]
      })
      const all = backtestSupertrendMacd(full[c.s] as never, P(c.m, N) as never, 100000)
      console.log(
        (N === 0 ? '關閉' : String(N)).padEnd(6) +
        row.map(v => (v >= 0 ? '+' : '') + v.toFixed(0)).map(s => s.padStart(9)).join('') +
        (sum >= 0 ? '+' : '') + sum.toFixed(0).padStart(8) +
        (ex21 >= 0 ? '+' : '') + ex21.toFixed(0).padStart(9) +
        String(nTrades(all)).padStart(7),
      )
    }
  }
  console.log('\n--- 四幣合計：N 的形狀（是高原還是尖峰？）---')
  const f = (v: number) => ((v >= 0 ? '+' : '') + v.toFixed(0))
  console.log('N'.padEnd(7) + '全期'.padStart(9) + 'ex-2021'.padStart(11) +
    '牛市21/23/24'.padStart(14) + '熊+震盪22/25'.padStart(14) + '26YTD盤整'.padStart(12) + '   鄰域均(ex21)')
  for (let k = 0; k < NS.length; k++) {
    const N = NS[k]
    const nb = [NS[k - 1], N, NS[k + 1]].filter(x => x !== undefined && x !== 0) as number[]
    const nbAvg = nb.reduce((a, x) => a + totalsEx21[x], 0) / nb.length
    console.log((N === 0 ? '關閉' : String(N)).padEnd(7) +
      f(totals[N]).padStart(9) + f(totalsEx21[N]).padStart(11) +
      f(bullT[N]).padStart(14) + f(bearT[N]).padStart(14) + f(ytdT[N]).padStart(12) +
      (N === 0 ? '' : f(nbAvg).padStart(15)))
  }
  console.log('\n--- 各幣 ex-2021（要確認四幣是否同號改善）---')
  console.log('N'.padEnd(7) + CFG.map(c => c.s.replace('USDT', '').padStart(9)).join(''))
  for (const N of NS) {
    console.log((N === 0 ? '關閉' : String(N)).padEnd(7) +
      CFG.map(c => f(perCoinEx21[c.s][N]).padStart(9)).join(''))
  }

  // ================= B. 一鍵平倉救援模擬 =================
  console.log('\n\n========== B. 一鍵平倉救援模擬 ==========')
  console.log('對每一筆真實交易，窮舉所有可能的手動平倉時點 m，比較三種結果：')
  console.log('  基準 = 完全不手動平倉（策略自己走完）')
  console.log('  無救援 = 在 m 平掉後再也沒進場（= 目前的行為）')
  console.log('  有救援 = 在 m 平掉後，ST 仍多頭時收盤創 N 棒新高就重新進場\n')

  // profitOnly=true：只模擬「持倉正在獲利時才手動平倉」的情境（比較貼近真人行為：
  // 2026-08-25 那次就是三筆都在賺的時候按下去的）
  const runB = (N: number, profitOnly: boolean) => {
    let base = 0, noFs = 0, withFs = 0, cases = 0, recovered = 0
    let hurt = 0, hurtSum = 0
    const perCoin: Record<string, { b: number; n: number; w: number }> = {}
    for (const c of CFG) {
      const kl = full[c.s]
      const { direction } = supertrend(kl as never, 14, c.m)
      const e200 = ema(kl.map(k => k.close), 200)
      const r = backtestSupertrendMacd(kl as never, P(c.m, 0) as never, 100000)
      const idx = (t: number) => kl.findIndex(k => k.time === t)
      perCoin[c.s] = { b: 0, n: 0, w: 0 }
      for (let t = 0; t + 1 < r.trades.length; t += 2) {
        const a = idx(r.trades[t].time), b = idx(r.trades[t + 1].time)
        if (a < 0 || b < 0 || b <= a) continue
        const entry = kl[a].open, exit = kl[b].open
        for (let m = a + 1; m < b; m++) {          // 手動平倉於 bar m 開盤
          const basePnl = pnl(entry, exit)
          const noPnl = pnl(entry, kl[m].open)
          if (profitOnly && noPnl <= 0) continue
          cases++
          // 找 m 之後第一個 failsafe 進場點（必須在策略出場前）
          let re = -1
          for (let j = m + 1; j < b; j++) {
            const flipUp = direction[j - 2] === -1 && direction[j - 1] === 1
            if (flipUp || direction[j - 1] !== 1) continue
            if (!breakout(kl, j - 1, N)) continue
            if (!isNaN(e200[j - 1]) && kl[j - 1].close <= e200[j - 1]) continue
            re = j; break
          }
          const reP = re > 0 ? pnl(kl[re].open, exit) : 0
          const wPnl = noPnl + reP
          if (re > 0) { recovered++; if (reP < 0) { hurt++; hurtSum += reP } }
          base += basePnl; noFs += noPnl; withFs += wPnl
          perCoin[c.s].b += basePnl; perCoin[c.s].n += noPnl; perCoin[c.s].w += wPnl
        }
      }
    }
    const missed = base - noFs
    const got = withFs - noFs
    console.log(`--- N=${N}${profitOnly ? '（只在獲利時平倉）' : '（所有時點）'} ---  情境 ${cases}，其中 ${recovered} 個 (${(recovered / cases * 100).toFixed(0)}%) 成功重新進場`)
    console.log(`  基準(不平倉) ${(base / cases).toFixed(1)} / 無救援 ${(noFs / cases).toFixed(1)} / 有救援 ${(withFs / cases).toFixed(1)}` +
      `  → 回收率 ${(got / missed * 100).toFixed(0)}%（平倉損失 ${(missed / cases).toFixed(1)}，救回 ${(got / cases).toFixed(1)}）`)
    console.log(`  重新進場後虧錢的比例 ${(hurt / Math.max(1, recovered) * 100).toFixed(0)}%，平均虧 ${(hurtSum / Math.max(1, hurt)).toFixed(1)}`)
    console.log('  各幣回收率: ' + CFG.map(c => {
      const p = perCoin[c.s]
      return `${c.s.replace('USDT', '')} ${((p.w - p.n) / (p.b - p.n) * 100).toFixed(0)}%`
    }).join('  '))
  }
  for (const N of [12, 24, 48, 96]) runB(N, false)
  console.log('')
  for (const N of [12, 24, 48, 96]) runB(N, true)
}
main()
