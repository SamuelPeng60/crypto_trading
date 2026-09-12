// 手動買入護欄比較：「距翻空線 > X%」 vs 「ST 已多頭 > N 棒」
//
// 方法：窮舉「所有可以手動買入的時點」。對每根 4h 棒 i，若引擎當下看到的已收盤棒
// direction[i-1] === 1（多頭 = manualBuy 目前唯一的放行條件），就模擬在 open[i]
// 投入 1000 USDT，持有到 ST 翻空（與引擎一致：翻空棒收盤後的下一棒開盤成交），
// 記錄 (已多頭棒數, 距翻空線%, PnL)。
//
// 注意 manualBuy 不套 MACD / EMA200 過濾（那是策略自己的進場條件），所以這裡也不套。
// 每個候選進場點獨立評估，不是一條連續的資金曲線。
import { supertrend } from '../lib/indicators'

interface K { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const FEE = 0.001
const SIZE = 1000

const CFG = [
  { s: 'BTCUSDT', mult: 3.0 },
  { s: 'ETHUSDT', mult: 2.0 },
  { s: 'SOLUSDT', mult: 3.0 },
  { s: 'BNBUSDT', mult: 2.5 },
]

async function fetchKlines(symbol: string, startMs: number, endMs: number): Promise<K[]> {
  const all: K[] = []
  let from = startMs
  while (from < endMs) {
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${from}&limit=1000`)
    const d = await res.json() as unknown[][]
    if (!d.length) break
    for (const k of d) {
      if ((k[0] as number) > endMs) break
      all.push({ time: Math.floor((k[0] as number) / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] })
    }
    from = (d[d.length - 1][0] as number) + 1
    if (d.length < 1000) break
  }
  return all
}

interface Entry { symbol: string; bars: number; drop: number; pnl: number; year: number; trendId: number }

function simulate(kl: K[], mult: number, symbol: string, fromSec: number): Entry[] {
  const { direction, trend } = supertrend(kl, 14, mult)
  const n = kl.length
  // flipDownAt[k] = 第一個 j >= k 使 direction[j] === -1（翻空已被確認的那根已收盤棒）
  const flipDownAt = new Int32Array(n).fill(-1)
  let next = -1
  for (let k = n - 1; k >= 0; k--) {
    if (direction[k] === -1) next = k
    flipDownAt[k] = next
  }

  const out: Entry[] = []
  for (let i = 1; i < n; i++) {
    if (kl[i].time < fromSec) continue
    if (direction[i - 1] !== 1) continue          // manualBuy 的放行條件
    const exitSig = flipDownAt[i - 1]
    if (exitSig < 0 || exitSig + 1 >= n) continue // 尚未翻空 → 結果未知，剔除
    const entry = kl[i].open
    const exit = kl[exitSig + 1].open             // 翻空棒收盤後的下一棒開盤
    const qty = SIZE / entry
    const pnl = qty * (exit * (1 - FEE) - entry * (1 + FEE))
    let bars = 1
    for (let j = i - 2; j >= 0 && direction[j] === 1; j--) bars++
    out.push({
      symbol, bars, drop: (entry - trend[i - 1]) / entry, pnl,
      year: new Date(kl[i].time * 1000).getUTCFullYear(),
      trendId: exitSig,   // 同一段趨勢的候選點共用同一個出場 → 用來算有效樣本數
    })
  }
  return out
}

const stat = (e: Entry[]) => {
  if (!e.length) return { n: 0, mean: 0, wr: 0, med: 0 }
  const p = e.map(x => x.pnl).sort((a, b) => a - b)
  return {
    n: e.length,
    mean: p.reduce((a, b) => a + b, 0) / p.length,
    med: p[Math.floor(p.length / 2)],
    wr: (e.filter(x => x.pnl > 0).length / e.length) * 100,
  }
}
const row = (label: string, e: Entry[]) => {
  const s = stat(e)
  return `${label.padEnd(22)} n=${String(s.n).padStart(5)}  平均 ${s.mean >= 0 ? '+' : ''}${s.mean.toFixed(1).padStart(7)}  中位 ${s.med >= 0 ? '+' : ''}${s.med.toFixed(1).padStart(7)}  勝率 ${s.wr.toFixed(1).padStart(5)}%`
}

async function main() {
  const start = new Date('2021-01-01T00:00:00Z').getTime()
  const end = Date.now()
  const all: Entry[] = []

  for (const c of CFG) {
    const kl = await fetchKlines(c.s, start - 120 * 86400_000, end)
    const e = simulate(kl, c.mult, c.s, start / 1000)
    all.push(...e)
    console.log(`${c.s} mult=${c.mult}: ${e.length} 個候選進場點`)
  }

  console.log(`\n總計 ${all.length} 個「ST 多頭、可手動買入」的時點（2021-01 ~ 今，4h，每筆 1000 USDT，含手續費）`)

  console.log('\n=== 按「已多頭棒數」分組 ===')
  const barBuckets: [string, (b: number) => boolean][] = [
    ['1 棒（翻多當下）', b => b === 1],
    ['2–3 棒', b => b >= 2 && b <= 3],
    ['4–6 棒（≤1天）', b => b >= 4 && b <= 6],
    ['7–12 棒（≤2天）', b => b >= 7 && b <= 12],
    ['13–24 棒（≤4天）', b => b >= 13 && b <= 24],
    ['25–48 棒（≤8天）', b => b >= 25 && b <= 48],
    ['49+ 棒（>8天）', b => b >= 49],
  ]
  for (const [label, f] of barBuckets) console.log(row(label, all.filter(x => f(x.bars))))

  console.log('\n=== 按「距翻空線%」分組 ===')
  const dropBuckets: [string, (d: number) => boolean][] = [
    ['< 2%', d => d < 0.02],
    ['2–4%', d => d >= 0.02 && d < 0.04],
    ['4–6%', d => d >= 0.04 && d < 0.06],
    ['6–8%', d => d >= 0.06 && d < 0.08],
    ['8–10%', d => d >= 0.08 && d < 0.10],
    ['> 10%', d => d >= 0.10],
  ]
  for (const [label, f] of dropBuckets) console.log(row(label, all.filter(x => f(x.drop))))

  const ex21 = all.filter(e => e.year !== 2021)
  const tail = (title: string, buckets: [string, (e: Entry) => boolean][]) => {
    console.log(`\n=== 下檔風險：${title}（ex-2021）===`)
    console.log('分組'.padEnd(20) + '  最差    P5     P10   平均虧損單')
    for (const [label, f] of buckets) {
      const p = ex21.filter(f).map(x => x.pnl).sort((a, b) => a - b)
      if (!p.length) continue
      const losses = p.filter(v => v < 0)
      const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0
      console.log(
        label.padEnd(20) +
        `${p[0].toFixed(0).padStart(7)} ${p[Math.floor(p.length * 0.05)].toFixed(0).padStart(7)} ` +
        `${p[Math.floor(p.length * 0.10)].toFixed(0).padStart(7)} ${avgLoss.toFixed(0).padStart(8)}`,
      )
    }
  }
  tail('按距翻空線%', dropBuckets.map(([l, f]) => [l, (e: Entry) => f(e.drop)] as [string, (e: Entry) => boolean]))
  tail('按已多頭棒數', barBuckets.map(([l, f]) => [l, (e: Entry) => f(e.bars)] as [string, (e: Entry) => boolean]))

  console.log('\n=== 護欄效果：擋下的 vs 放行的 ===')
  console.log('（護欄要有用 → 「擋下」那組的平均 PnL 要明顯比「放行」那組差）\n')
  const gates: [string, (e: Entry) => boolean][] = [
    ['距翻空線 > 8%（現行）', e => e.drop > 0.08],
    ['距翻空線 > 5%', e => e.drop > 0.05],
    ['距翻空線 > 4%', e => e.drop > 0.04],
    ['距翻空線 > 3%', e => e.drop > 0.03],
    ['已多頭 > 1 棒', e => e.bars > 1],
    ['已多頭 > 3 棒', e => e.bars > 3],
    ['已多頭 > 6 棒（1天）', e => e.bars > 6],
    ['已多頭 > 12 棒（2天）', e => e.bars > 12],
    ['已多頭 > 24 棒（4天）', e => e.bars > 24],
  ]
  const gateTable = (label: string, pool: Entry[]) => {
    console.log(`\n--- ${label}（n=${pool.length}，獨立趨勢段 ${new Set(pool.map(e => e.symbol + ':' + e.trendId)).size}）---`)
    console.log('護欄'.padEnd(24) + '擋下組平均   放行組平均    差距   擋掉比例')
    console.log('-'.repeat(72))
    for (const [g, blocks] of gates) {
      const bad = pool.filter(blocks)
      const ok = pool.filter(e => !blocks(e))
      const sb = stat(bad), so = stat(ok)
      const diff = so.mean - sb.mean
      console.log(
        g.padEnd(24) +
        `${sb.mean >= 0 ? '+' : ''}${sb.mean.toFixed(1).padStart(7)}   ` +
        `${so.mean >= 0 ? '+' : ''}${so.mean.toFixed(1).padStart(7)}   ` +
        `${diff >= 0 ? '+' : ''}${diff.toFixed(1).padStart(7)}   ` +
        `${((bad.length / pool.length) * 100).toFixed(0).padStart(3)}%`,
      )
    }
  }

  gateTable('全期 2021–2026', all)
  gateTable('ex-2021（排除大牛市）', all.filter(e => e.year !== 2021))
  for (const c of CFG) gateTable(c.s, all.filter(e => e.symbol === c.s))
}
main()
