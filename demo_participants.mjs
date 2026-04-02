const BASE = 'http://localhost:3333'
import Database from 'better-sqlite3'
const db = new Database('C:/Users/ASUS/Desktop/比特幣交易/crypto-trading/data/trading.db')

const pad = n => String(n).padStart(2, '0')
const now = new Date()
const sessionName = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes()), pad(now.getSeconds())].join('')
const sessId = `demo_pnl_${Date.now()}`
const today = new Date().toISOString().split('T')[0]

// Create 2 strategies in the session (BTC + ETH, tradeSize=500 each → total 1000U)
for (const sym of ['BTCUSDT', 'ETHUSDT']) {
  await fetch(`${BASE}/api/strategies`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      name: `${sessionName} ${sym.replace('USDT','')}`,
      type: 'vwap_bb_rsi', symbol: sym,
      params: { interval:'4h', tradeSize:500, rsiPeriod:14, rsiOversold:35, rsiOverbought:65,
        bbPeriod:20, bbStdDev:2, vwapWindow:24, atrPeriod:14, atrSlMultiplier:1.5 },
      session_id: sessId, mode: 'paper'
    })
  })
}

// Get strategy IDs
const strats = db.prepare("SELECT id FROM strategies WHERE session_id=?").all(sessId)
console.log(`Created ${strats.length} strategies, IDs: ${strats.map(s=>s.id).join(',')}`)

// Insert fake sell orders: BTC +80U, ETH +20U = total +100U PnL
const nowISO = new Date().toISOString()
db.prepare('INSERT INTO orders (strategy_id,symbol,side,order_type,price,quantity,filled_price,status,pnl,mode,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(strats[0].id, 'BTCUSDT','sell','market',85000,0.001,85000,'filled',80.00,'paper',nowISO)
db.prepare('INSERT INTO orders (strategy_id,symbol,side,order_type,price,quantity,filled_price,status,pnl,mode,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run(strats[1].id, 'ETHUSDT','sell','market',2000,0.01,2000,'filled',20.00,'paper',nowISO)

console.log('Inserted fake orders: BTC +80U, ETH +20U = total +100U')

// Create Participant A: 小明, 500U → ratio=500/1000=50% → PnL=+50U
const resA = await fetch(`${BASE}/api/participants`, {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ name:'小明', investment:500, start_date:today, current_pnl:0 })
})
const { id: pidA } = await resA.json()

// Bind 小明 to session
await fetch(`${BASE}/api/participants`, {
  method: 'PUT', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ id:pidA, name:'小明', investment:500, start_date:today,
    current_pnl:0, note:'示範用投資人', bound_session_id:sessId, allocated:0 })
})
console.log(`Created 小明 (id=${pidA}), investment=500U, bound to ${sessId}`)

// Create Participant B: 小花, 250U → ratio=250/1250=20% → PnL=+20U (after 小明 adds 500→strats become 750 each)
// Wait — after 小明 binds, each strat tradeSize becomes 500 + 500/2 = 750
// totalTradeSize = 1500, 小花 250 → ratio 250/1750 ≈ 14.3% → PnL≈14.3U
// Let's just create 小花 with 250U too
const resB = await fetch(`${BASE}/api/participants`, {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ name:'小花', investment:250, start_date:today, current_pnl:0 })
})
const { id: pidB } = await resB.json()

// Bind 小花 to same session
await fetch(`${BASE}/api/participants`, {
  method: 'PUT', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({ id:pidB, name:'小花', investment:250, start_date:today,
    current_pnl:0, note:'示範用投資人', bound_session_id:sessId, allocated:0 })
})
console.log(`Created 小花 (id=${pidB}), investment=250U, bound to ${sessId}`)

// Check final tradeSize state
const finalStrats = db.prepare("SELECT name,params FROM strategies WHERE session_id=?").all(sessId)
for (const s of finalStrats) {
  const p = JSON.parse(s.params)
  console.log(`${s.name}: tradeSize=${p.tradeSize}`)
}

// Verify via /api/stats
const stats = await fetch(`${BASE}/api/stats?mode=paper&session_id=${sessId}`).then(r=>r.json())
const totalPnl = stats.overall?.totalPnl ?? 0
console.log(`\n/api/stats session totalPnl = ${totalPnl}`)
console.log(`總 tradeSize (策略 params 合計) = ${finalStrats.reduce((sum,s) => sum + JSON.parse(s.params).tradeSize, 0)}U`)

db.close()
console.log('\n✅ 示範資料已建立，請前往「參與者」頁面查看效果！')
console.log(`   Session: ${sessId} (${sessionName})`)
console.log(`   小明: 投資 500U → 應顯示 ~${(500 / finalStrats.reduce((s,st)=>s+JSON.parse(st.params).tradeSize,0) * totalPnl).toFixed(1)}U 收益`)
console.log(`   小花: 投資 250U → 應顯示 ~${(250 / finalStrats.reduce((s,st)=>s+JSON.parse(st.params).tradeSize,0) * totalPnl).toFixed(1)}U 收益`)
