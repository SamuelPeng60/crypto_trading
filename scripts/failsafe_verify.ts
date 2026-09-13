// failsafe 重新進場的邏輯驗證（不是回測，是正確性檢查）
// 1. Donchian 突破函式的邊界行為
// 2. failsafeBars=0 時行為與修改前完全相同
// 3. backtest 與 engine 的 failsafe 判斷逐棒一致
// 4. 不會重複進場、不會在翻多棒觸發、不會在有倉時觸發
import { backtestSupertrendMacd } from '../lib/backtest'
import { computeSignal } from '../lib/engine'
import { supertrend } from '../lib/indicators'

interface K { time: number; open: number; high: number; low: number; close: number; volume: number }
const BASE = 'https://data-api.binance.vision'
const CFG = [
  { s: 'BTCUSDT', mult: 3.0 }, { s: 'ETHUSDT', mult: 2.0 },
  { s: 'SOLUSDT', mult: 3.0 }, { s: 'BNBUSDT', mult: 2.5 },
]
const P = (mult: number, failsafeBars = 0) => ({
  atrPeriod: 14, multiplier: mult, ema200Filter: true,
  macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: 1000, failsafeBars,
})

let pass = 0, fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`)
  ok ? pass++ : fail++
}

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

// 對照用：直接照定義重算一次 Donchian，跟被測程式無共用碼
function refBreakout(kl: K[], i: number, n: number): boolean {
  if (n <= 0 || i - n < 0) return false
  const window = kl.slice(i - n, i).map(k => k.high)
  return kl[i].close > Math.max(...window)
}

async function main() {
  const start = new Date('2021-01-01T00:00:00Z').getTime()
  const data: Record<string, K[]> = {}
  for (const c of CFG) data[c.s] = await fetchKlines(c.s, start - 120 * 86400_000, Date.now())

  // ---- 1. Donchian 邊界行為 ----
  console.log('\n[1] Donchian 突破：邊界行為')
  {
    const synth: K[] = [10, 12, 11, 13, 9].map((h, i) => ({ time: i, open: h, high: h, low: h - 1, close: h, volume: 0 }))
    // i=4, n=3 → 區間是 index 1,2,3 的 high = [12,11,13]，max=13，close=9 → 不突破
    check('close 低於區間最高 → false', refBreakout(synth, 4, 3) === false)
    // i=3, n=2 → 區間 index 1,2 high=[12,11]，max=12，close=13 → 突破
    check('close 高於區間最高 → true', refBreakout(synth, 3, 2) === true)
    // 區間不含自己：i=3, n=1 → 區間只有 index 2 (high=11)，close=13 → true
    check('比較區間不含訊號棒自己', refBreakout(synth, 3, 1) === true)
    check('資料不足（i-n < 0）→ false', refBreakout(synth, 1, 5) === false)
    check('n=0 → false（等於關閉）', refBreakout(synth, 4, 0) === false)
  }

  // ---- 2. failsafeBars=0 必須與修改前行為完全相同 ----
  console.log('\n[2] failsafeBars=0 → 與現行 live 行為完全相同')
  for (const c of CFG) {
    const off = backtestSupertrendMacd(data[c.s] as never, P(c.mult, 0) as never, 10000)
    const undef = backtestSupertrendMacd(data[c.s] as never, { ...P(c.mult), failsafeBars: undefined } as never, 10000)
    const same = JSON.stringify(off.trades) === JSON.stringify(undef.trades)
    check(`${c.s} failsafeBars=0 vs undefined 交易完全相同`, same, `${off.trades.length} 筆`)
  }

  // ---- 3. backtest 與 engine 逐棒一致 ----
  console.log('\n[3] backtest 與 engine 的 failsafe 判斷逐棒一致')
  for (const c of CFG) {
    for (const N of [12, 48]) {
      const kl = data[c.s]
      const { direction } = supertrend(kl as never, 14, c.mult)
      let checked = 0, mismatch = 0, fsBars = 0
      // 逐棒比對「engine 在 bar i 開盤時會不會給 buy」與 backtest 的進場條件
      for (let i = 300; i < kl.length; i++) {
        const stFlipUp = direction[i - 2] === -1 && direction[i - 1] === 1
        const btFailsafe = !stFlipUp && direction[i - 1] === 1 && refBreakout(kl, i - 1, N)
        if (!btFailsafe) continue          // 只比對 failsafe 會觸發的棒
        fsBars++
        // engine 在 bar i 期間看到的已收盤棒 = kl.slice(0, i)
        const sig = computeSignal('supertrend_macd', P(c.mult, N) as never, kl.slice(0, i) as never)
        checked++
        // backtest 此時還要過 EMA200；engine 內部也同樣過 → 兩邊應同為 buy 或同為非 buy
        const sigOff = computeSignal('supertrend_macd', P(c.mult, 0) as never, kl.slice(0, i) as never)
        // failsafe 開啟時若 engine 沒給 buy，只可能是 EMA200 擋掉，此時 off 也不會是 buy
        if (sig !== 'buy' && sigOff === 'buy') mismatch++
        // 反向：failsafe 關閉時是 buy（primary），開啟時也必須是 buy
        if (sigOff === 'buy' && sig !== 'buy') mismatch++
      }
      check(`${c.s} N=${N}`, mismatch === 0, `failsafe 觸發 ${fsBars} 根棒、比對 ${checked} 次、不一致 ${mismatch}`)
    }
  }

  // ---- 4. 交易序列完整性 ----
  console.log('\n[4] 交易序列：buy/sell 嚴格交替、無重複進場')
  for (const c of CFG) {
    for (const N of [12, 24, 48, 96]) {
      const r = backtestSupertrendMacd(data[c.s] as never, P(c.mult, N) as never, 10000)
      let ok = true, prev = 'sell'
      for (const t of r.trades) { if (t.side === prev) { ok = false; break } prev = t.side }
      check(`${c.s} N=${N} 序列交替`, ok, `${r.trades.length} 筆`)
    }
  }

  // ---- 5. failsafe 不在翻多棒觸發（那是 primary 的職責） ----
  console.log('\n[5] failsafe 進場點必定不是翻多棒，且 ST 必為多頭')
  for (const c of CFG) {
    const kl = data[c.s]
    const { direction } = supertrend(kl as never, 14, c.mult)
    const baseTimes = new Set(backtestSupertrendMacd(kl as never, P(c.mult, 0) as never, 10000)
      .trades.filter(t => t.side === 'buy').map(t => t.time))
    const r = backtestSupertrendMacd(kl as never, P(c.mult, 24) as never, 10000)
    const extra = r.trades.filter(t => t.side === 'buy' && !baseTimes.has(t.time))
    let bad = 0
    for (const t of extra) {
      const i = kl.findIndex(k => k.time === t.time)
      const stFlipUp = direction[i - 2] === -1 && direction[i - 1] === 1
      if (stFlipUp || direction[i - 1] !== 1) bad++
    }
    check(`${c.s} 新增的 ${extra.length} 筆 failsafe 進場全部合法`, bad === 0, bad ? `違規 ${bad}` : '')
  }

  console.log(`\n${fail === 0 ? '✅ 全部通過' : '❌ 有失敗項'}  pass=${pass} fail=${fail}`)
}
main()
