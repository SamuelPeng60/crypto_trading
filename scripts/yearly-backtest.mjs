/**
 * Run vwap_bb_rsi yearly backtests (2021–2026 Q1) for BTC/ETH/SOL/BNB
 * Usage: node scripts/yearly-backtest.mjs [port]
 */

const PORT   = process.argv[2] || 3333
const BASE   = `http://localhost:${PORT}`
const USER   = process.env.BT_USER || 'admin'
const PASS   = process.env.BT_PASS || 'admin123'
const SYMBOL = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
const YEARS  = [
  { label: '2021 🐂', start: '2021-01-01', end: '2021-12-31' },
  { label: '2022 🐻', start: '2022-01-01', end: '2022-12-31' },
  { label: '2023 🐂', start: '2023-01-01', end: '2023-12-31' },
  { label: '2024 🐂', start: '2024-01-01', end: '2024-12-31' },
  { label: '2025 🐂', start: '2025-01-01', end: '2025-12-31' },
  { label: '2026 Q1', start: '2026-01-01', end: '2026-03-31' },
]

const INTERVAL = '4h'
// Best params from CLAUDE.md (trail=2.0, sl=1.0)
const PARAMS = {
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2,
  vwapWindow: 24,
  atrPeriod: 14, atrSlMultiplier: 1.0,
  trailAtrMult: 2.0,
  volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.3,
  tradeSize: 1000,
}

// Login and return cookie string
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (!res.ok) throw new Error(`Login failed: ${res.status}`)
  const setCookie = res.headers.get('set-cookie') || ''
  const match = setCookie.match(/ct_session=([^;]+)/)
  if (!match) throw new Error('No session cookie returned')
  return `ct_session=${match[1]}`
}

async function runOne(symbol, start, end, cookie) {
  const res = await fetch(`${BASE}/api/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ type: 'vwap_bb_rsi', symbol, interval: INTERVAL, params: PARAMS, startDate: start, endDate: end, initialCapital: 10000 }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

function pct(v) { return (v >= 0 ? '+' : '') + v.toFixed(1) + '%' }

const results = {}   // results[year][symbol] = returnPct

process.stdout.write('\nLogging in...')
const cookie = await login()
process.stdout.write(' OK\n\nRunning backtests (this may take ~2-3 minutes)...\n\n')

for (const yr of YEARS) {
  results[yr.label] = {}
  const rowVals = []
  for (const sym of SYMBOL) {
    process.stdout.write(`  ${yr.label}  ${sym}...`)
    try {
      const r = await runOne(sym, yr.start, yr.end, cookie)
      const ret = r.totalReturn ?? 0
      results[yr.label][sym] = { ret, trades: r.totalTrades, wr: r.winRate, sharpe: r.sharpeRatio }
      rowVals.push(ret)
      process.stdout.write(` ${pct(ret)} (${r.totalTrades}T wr=${(r.winRate*100).toFixed(0)}% sh=${(r.sharpeRatio??0).toFixed(2)})\n`)
    } catch (e) {
      process.stdout.write(` ERROR: ${e.message}\n`)
      results[yr.label][sym] = null
    }
  }
  const validVals = rowVals.filter(v => v !== null)
  results[yr.label]['_avg'] = validVals.length ? validVals.reduce((a,b)=>a+b,0)/validVals.length : null
}

// Print summary table
const COL = 10
const pad = (s, n) => String(s).padStart(n)

console.log('\n' + '='.repeat(72))
console.log('  Crypto Pulse 4h — 修正後回測 (trail=2.0, sl=1.0, volThresh=1.3)')
console.log('='.repeat(72))
console.log('年度'.padEnd(12) + SYMBOL.map(s => pad(s.replace('USDT',''), COL)).join('') + pad('平均', COL))
console.log('-'.repeat(72))

for (const yr of YEARS) {
  const row = results[yr.label]
  const avg = row['_avg']
  console.log(
    yr.label.padEnd(12) +
    SYMBOL.map(s => pad(row[s] !== null ? pct(row[s].ret) : 'N/A', COL)).join('') +
    pad(avg !== null ? pct(avg) : 'N/A', COL)
  )
}

// Print year averages
const symAvg = {}
for (const sym of SYMBOL) {
  const vals = YEARS.map(yr => results[yr.label][sym]).filter(v => v !== null).map(v => v.ret)
  symAvg[sym] = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null
}
const allVals = YEARS.flatMap(yr => SYMBOL.map(s => results[yr.label][s])).filter(v => v !== null).map(v => v.ret)
const grandAvg = allVals.reduce((a,b)=>a+b,0)/allVals.length

console.log('-'.repeat(72))
console.log('幣種平均'.padEnd(12) + SYMBOL.map(s => pad(symAvg[s] !== null ? pct(symAvg[s]) : 'N/A', COL)).join('') + pad(pct(grandAvg), COL))
console.log('='.repeat(72))

// Trades count table
console.log('\n=== 交易次數 (修正後) ===')
console.log('年度'.padEnd(12) + SYMBOL.map(s => pad(s.replace('USDT',''), COL)).join(''))
console.log('-'.repeat(52))
for (const yr of YEARS) {
  const row = results[yr.label]
  console.log(yr.label.padEnd(12) + SYMBOL.map(s => pad(row[s] !== null ? row[s].trades+'T' : 'N/A', COL)).join(''))
}
console.log()
