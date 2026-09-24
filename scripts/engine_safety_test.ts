// 高風險修正回歸測試（2026-09-24）：mock 幣安 + Telegram，在暫存目錄建全新 DB。
// 執行：npx tsx scripts/engine_safety_test.ts
// ⚠️ 先 chdir 到暫存目錄再 import lib/db，絕不會碰到真正的 data/trading.db
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
const R = path.resolve(__dirname, '../lib') + '/'
process.chdir(mkdtempSync(path.join(tmpdir(), 'ct-engine-test-')))
process.env.ENCRYPTION_SECRET = 'x'.repeat(40)
let pass = 0, fail = 0
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('  ✅', m) } else { fail++; console.log('  ❌', m) } }

// ── synthetic klines ──
let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd())
const K: any[] = []; let p = 100
for (let i = 0; i < 3000; i++) { const drift = Math.sin(i / 60) * 0.006; const o = p; p = p * Math.exp(drift + 0.01 * g())
  K.push({ time: 1700000000 + i * 14400, open: o, high: Math.max(o, p) * 1.003, low: Math.min(o, p) * 0.997, close: p, volume: 1 }) }

// ── mock Binance + Telegram ──
let cut = 0
let mode504 = false, reject = false, queryDown = false
const orders = new Map<string, any>(); let posts = 0; const tg: any[] = []
let tgFailMarkdownOnce = false
const SLIP = 1.002  // mock 成交均價 = tick 價 × 1.002
;(globalThis as any).fetch = async (url: string, init?: any) => {
  const u = new URL(url)
  const J = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s })
  if (u.host === 'api.telegram.org') {
    const body = JSON.parse(init.body); tg.push(body)
    if (tgFailMarkdownOnce && body.parse_mode) return J({ ok: false, description: "Bad Request: can't parse entities: x" }, 400)
    return J({ ok: true })
  }
  if (u.pathname === '/api/v3/klines') { const lim = Number(u.searchParams.get('limit')); const arr = K.slice(Math.max(0, cut - lim), cut)
    return J(arr.map(k => [k.time * 1000, k.open, k.high, k.low, k.close, k.volume])) }
  if (u.pathname === '/api/v3/ticker/24hr') return J({ lastPrice: K[cut - 1].close, priceChangePercent: 0, quoteVolume: 0 })
  if (u.pathname === '/api/v3/exchangeInfo') return J({ symbols: [{ filters: [{ filterType: 'LOT_SIZE', stepSize: '0.00001' }] }] })
  if (u.pathname === '/api/v3/account') return J({ balances: [{ asset: 'USDT', free: '100000' }, { asset: 'SOL', free: '1000' }] })
  if (u.pathname === '/api/v3/order' && init?.method === 'GET' || (u.pathname === '/api/v3/order' && !init?.method)) {
    if (queryDown) throw new TypeError('fetch failed')
    const o = orders.get(u.searchParams.get('origClientOrderId')!)
    return o ? J(o) : J({ code: -2013, msg: 'Order does not exist.' }, 400)
  }
  if (u.pathname === '/api/v3/order' && init?.method === 'POST') {
    posts++
    if (reject) return J({ code: -1013, msg: 'Filter failure: LOT_SIZE' }, 400)
    const id = u.searchParams.get('newClientOrderId')!
    const q = Number(u.searchParams.get('quantity'))
    const o = { orderId: 1000 + posts, status: 'FILLED', price: '0', executedQty: String(q), cummulativeQuoteQty: String(q * K[cut - 1].close * SLIP), fills: [] }
    orders.set(id, o)
    await new Promise(r => setTimeout(r, 30))
    if (mode504) return new Response('<html>504 Gateway Time-out</html>', { status: 504 })
    return J(o)
  }
  throw new Error('unmocked ' + url)
}

async function main() {
  const { getDb } = await import(R + 'db')
  const { saveSettings } = await import(R + 'settings')
  const E = await import(R + 'engine')
  const { supertrend, macd } = await import(R + 'indicators')
  const db = getDb()
  saveSettings({ apiKey: 'k', apiSecret: 's', telegramBotToken: 't', telegramChatId: '1' })
  const params = { atrPeriod: 14, multiplier: 3, ema200Filter: false, macdFast: 12, macdSlow: 26, macdSignal: 9, tradeSize: 1000, interval: '4h' }
  const mk = () => db.prepare(`INSERT INTO strategies (name,type,symbol,params,mode,is_active) VALUES ('t','supertrend_macd','SOLUSDT',?, 'live',1)`).run(JSON.stringify(params)).lastInsertRowid as number
  const conf = (c: number) => K.slice(c - 300, c - 1)
  const find = (pred: (d: number[], h: number[]) => boolean, from = 600) => {
    for (let c = from; c < K.length; c++) { const ck = conf(c); const d = supertrend(ck, 14, 3).direction; const h = macd(ck.map(k => k.close)).histogram; if (pred(d, h)) return c }
    throw new Error('no cut') }
  const reset = () => { db.exec('DELETE FROM positions; DELETE FROM orders; UPDATE strategies SET is_active=0'); orders.clear(); posts = 0; mode504 = false; reject = false }

  console.log('\n[2] 狀態出場：翻空已過（非翻空棒），有持倉 → 賣出')
  reset(); let id = mk()
  cut = find(d => d.at(-1) === -1 && d.at(-2) === -1 && d.at(-3) === -1 && d.at(-6) === 1)
  db.prepare(`INSERT INTO positions (strategy_id,symbol,side,entry_price,quantity,current_price,mode) VALUES (?, 'SOLUSDT','long',100,10,100,'live')`).run(id)
  let r = await E.runStrategyTick(id)
  ok(r.signal === 'sell' && !db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), `賣出並刪持倉（${r.message}）`)
  ok(posts === 1 && orders.has(`ct-s-${(db.prepare('SELECT MAX(id) m FROM positions').get() as any).m ?? 1}`) || posts === 1, '恰好送出 1 張 SELL')
  const logs = (db.prepare('SELECT message FROM strategy_logs WHERE strategy_id=?').all(id) as any[]).map(x => x.message).join('|')
  ok(logs.includes('補出場'), 'log 標記「ST 已空頭，補出場」')

  console.log('\n[2b] 狀態出場不影響空倉：空頭且無持倉 → hold，不下單')
  reset(); id = mk(); r = await E.runStrategyTick(id)
  ok(r.signal === 'hold' && posts === 0, 'hold 且 0 張單')

  console.log('\n[1] 風控超限 + 有持倉 → 仍執行出場，不停策略；空倉 → 停策略')
  reset(); id = mk()
  db.prepare(`INSERT INTO orders (strategy_id,symbol,side,order_type,price,quantity,filled_price,status,pnl,mode,closed_at) VALUES (?, 'SOLUSDT','sell','market',1,1,1,'filled',-600,'live',?)`).run(id, new Date().toISOString())
  db.prepare(`INSERT INTO positions (strategy_id,symbol,side,entry_price,quantity,current_price,mode) VALUES (?, 'SOLUSDT','long',100,10,100,'live')`).run(id)
  r = await E.runStrategyTick(id)
  ok(r.signal === 'sell', `有持倉時照常出場（${r.message}）`)
  ok((db.prepare('SELECT is_active FROM strategies WHERE id=?').get(id) as any).is_active === 1, '出場當下策略未被停止')
  r = await E.runStrategyTick(id)
  ok(r.message.startsWith('風控停止') && (db.prepare('SELECT is_active FROM strategies WHERE id=?').get(id) as any).is_active === 0, '空倉後下一個 tick 才停止策略')

  console.log('\n[3] 買單回 504 但實際已成交 → 下個 tick 找回，不重複買')
  reset(); id = mk()
  cut = find((d, h) => d.at(-2) === -1 && d.at(-1) === 1 && h.at(-1)! > 0)
  mode504 = true
  r = await E.runStrategyTick(id)
  ok(posts === 1, `第 1 個 tick 送出 1 張 BUY（${r.message.slice(0, 60)}）`)
  mode504 = false
  r = await E.runStrategyTick(id)
  ok(posts === 1, `第 2 個 tick 沒有再送 BUY（posts=${posts}）`)
  ok(!!db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), '持倉已寫入 DB')
  // 同一次呼叫中的 504 → 立刻查單找回
  reset(); id = mk(); mode504 = true
  r = await E.runStrategyTick(id)
  // first tick: pre-query none → POST 504 → post-query finds → success
  ok(posts === 1 && !!db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), '同一次呼叫 504 → 立刻查單找回並建立持倉')

  console.log('\n[3b] 504 且查單也失敗 → 本 tick 失敗；下個 tick 下單前查到 → 不重複買')
  reset(); id = mk(); mode504 = true
  let calls = 0
  const origFetch = (globalThis as any).fetch
  ;(globalThis as any).fetch = async (url: string, init?: any) => {
    if (url.includes('/api/v3/order') && init?.method === 'GET') { calls++; if (calls === 2) throw new TypeError('fetch failed') }
    return origFetch(url, init)
  }
  r = await E.runStrategyTick(id)
  ok(posts === 1 && !db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), `第 1 tick 失敗、無持倉（${r.message.slice(0, 50)}）`)
  mode504 = false
  r = await E.runStrategyTick(id)
  ok(posts === 1 && !!db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), `第 2 tick 查到既有單 → 建持倉且沒再送 BUY（posts=${posts}）`)
  ;(globalThis as any).fetch = origFetch

  console.log('\n[5] 併發：平倉連點兩下 / tick 同時手動平倉')
  reset(); id = mk(); cut = find(d => d.at(-1) === 1 && d.at(-2) === 1 && d.at(-3) === 1)
  const pid = db.prepare(`INSERT INTO positions (strategy_id,symbol,side,entry_price,quantity,current_price,mode) VALUES (?, 'SOLUSDT','long',100,10,100,'live')`).run(id).lastInsertRowid as number
  const [a, b] = await Promise.all([E.manualClosePosition(pid), E.manualClosePosition(pid)])
  ok([a.ok, b.ok].filter(Boolean).length === 1 && posts === 1, `只有一個成功、只送 1 張 SELL（posts=${posts}）`)
  ok((db.prepare(`SELECT COUNT(*) c FROM orders WHERE side='sell'`).get() as any).c === 1, 'DB 只有 1 筆賣單')
  // tick 進行中 → 另一個 tick TICK_BUSY；手動操作排隊
  reset(); id = mk(); db.prepare('UPDATE strategies SET is_active=1 WHERE id=?').run(id)
  const t1 = E.runAllActiveTick()
  let busy = false; try { await E.runAllActiveTick() } catch (e: any) { busy = e.message === E.TICK_BUSY }
  ok(busy, 'tick 進行中第二個 tick → TICK_BUSY')
  const mb = E.manualBuy(id)
  ok(E.isTickInFlight(), '手動買入排隊中 isTickInFlight=true')
  await t1; const mr = await mb
  ok(!E.isTickInFlight(), `全部完成後鎖釋放（manualBuy: ${mr.message.slice(0, 40)}）`)

  console.log('\n[4] 強制結清失敗 → 持倉保留並回傳錯誤')
  reset(); id = mk()
  db.prepare(`INSERT INTO positions (strategy_id,symbol,side,entry_price,quantity,current_price,mode) VALUES (?, 'SOLUSDT','long',100,10,100,'live')`).run(id)
  reject = true
  const errs = await E.forceCloseSessionPositions([id])
  ok(errs.length === 1 && !!db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), `持倉保留、回傳錯誤：${errs[0]}`)
  ok((db.prepare(`SELECT COUNT(*) c FROM orders WHERE side='sell'`).get() as any).c === 0, '沒有寫假賣單')
  reject = false
  const errs2 = await E.forceCloseSessionPositions([id])
  ok(errs2.length === 0 && !db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), '正常時成功結清')

  console.log('\n[6] Telegram Markdown 解析失敗 → 純文字重送')
  const { sendTelegramMessage } = await import(R + 'notify')
  tg.length = 0; tgFailMarkdownOnce = true
  await sendTelegramMessage('t', '1', '❌ 賣單失敗: Filter failure: LOT_SIZE')
  ok(tg.length === 2 && tg[0].parse_mode === 'Markdown' && tg[1].parse_mode === undefined, '第二次以純文字送出')
  tgFailMarkdownOnce = false

  // ════════════════ 中風險修正（2026-09-24 第二批）════════════════
  const { getSettings } = await import(R + 'settings')

  console.log('\n[M8] 每日最大虧損設 0 = 不限制')
  saveSettings({ maxDailyLoss: 0 } as any)
  ok(getSettings().maxDailyLoss === 0, `設 0 讀回 0（舊版會變 500）`)
  db.prepare("DELETE FROM settings WHERE key='maxDailyLoss'").run()
  ok(getSettings().maxDailyLoss === 500, '沒設定過才用預設 500')

  console.log('\n[M9] 實盤記帳用實際成交均價')
  reset(); id = mk()
  cut = find((d, h) => d.at(-2) === -1 && d.at(-1) === 1 && h.at(-1)! > 0)
  r = await E.runStrategyTick(id)
  const pos9 = db.prepare('SELECT * FROM positions WHERE strategy_id=?').get(id) as any
  const tick = K[cut - 1].close
  ok(pos9 && Math.abs(pos9.entry_price / (tick * SLIP) - 1) < 1e-9, `進場價 ${pos9?.entry_price.toFixed(4)} = 成交均價（tick ${tick.toFixed(4)} × ${SLIP}）`)
  const m9 = await E.manualClosePosition(pos9.id)
  ok(m9.ok && Math.abs(m9.price! / (tick * SLIP) - 1) < 1e-9, `手動平倉價 = 成交均價（舊版市價單 price=0 會退回 tick 價）`)

  console.log('\n[M7] ma_consolidation_breakout 移動止損：實盤要真的下賣單')
  reset()
  const mcId = db.prepare(`INSERT INTO strategies (name,type,symbol,params,mode,is_active) VALUES ('mc','ma_consolidation_breakout','SOLUSDT',?, 'live',1)`)
    .run(JSON.stringify({ trailAtrMult: 2, atrPeriod: 14, tradeSize: 1000 })).lastInsertRowid as number
  db.prepare(`INSERT INTO positions (strategy_id,symbol,side,entry_price,quantity,current_price,trail_high,mode) VALUES (?, 'SOLUSDT','long',100,10,100,1e9,'live')`).run(mcId)
  r = await E.runStrategyTick(mcId)
  ok(r.signal === 'sell' && posts === 1, `觸發止損並送出 1 張 SELL（posts=${posts}，舊版 0）`)
  ok(!db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(mcId), '持倉已關閉')

  console.log('\n[M11b] tradeSize=0 → 不下單（舊版 0 || 1000 會下 1000）')
  reset(); id = mk()
  db.prepare('UPDATE strategies SET params=? WHERE id=?').run(JSON.stringify({ ...params, tradeSize: 0 }), id)
  cut = find((d, h) => d.at(-2) === -1 && d.at(-1) === 1 && h.at(-1)! > 0)
  r = await E.runStrategyTick(id)
  ok(posts === 0 && !db.prepare('SELECT 1 FROM positions WHERE strategy_id=?').get(id), `不下單（${r.message}）`)
  ok(E.orderSize({ amountPerGrid: 50 }, 0) === 50 && E.orderSize({}, 0) === 1000 && E.orderSize({ tradeSize: 2000 }, 500) === 500, 'orderSize：未設 tradeSize 走後備值、maxPositionSize 上限照舊')

  // ── route handlers（真的呼叫 API route）──
  const { NextRequest } = await import('next/server')
  const { hashPassword, createSession } = await import(R + 'auth')
  const uid = db.prepare(`INSERT INTO users (username,password_hash,role) VALUES ('adm',?, 'admin')`).run(hashPassword('x')).lastInsertRowid as number
  const cookie = `ct_session=${createSession(uid)}`
  const req = (method: string, body?: unknown) => new NextRequest('http://x/api', { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })

  console.log('\n[M12] 封存時平倉失敗 → 中止封存、不停策略、持倉不被標記')
  const archivesRoute = await import(path.resolve(__dirname, '../app/api/archives/route'))
  reset(); id = mk(); db.prepare('UPDATE strategies SET is_active=1 WHERE id=?').run(id)
  db.prepare(`INSERT INTO positions (strategy_id,symbol,side,entry_price,quantity,current_price,mode) VALUES (?, 'SOLUSDT','long',100,10,100,'live')`).run(id)
  db.prepare(`INSERT INTO orders (strategy_id,symbol,side,order_type,price,quantity,filled_price,status,mode) VALUES (?, 'SOLUSDT','buy','market',100,10,100,'filled','live')`).run(id)
  reject = true
  let res = await archivesRoute.POST(req('POST', { name: 't' }))
  ok(res.status === 409, `回 409（${(await res.json()).closeErrors?.[0]}）`)
  ok((db.prepare('SELECT COUNT(*) c FROM archives').get() as any).c === 0, '沒有建立封存')
  ok((db.prepare('SELECT archive_id a FROM positions WHERE strategy_id=?').get(id) as any).a === null, '持倉未被標 archive_id')
  ok((db.prepare('SELECT is_active a FROM strategies WHERE id=?').get(id) as any).a === 1, '策略未被停止')
  reject = false
  res = await archivesRoute.POST(req('POST', { name: 't' }))
  ok(res.status === 200 && !db.prepare('SELECT 1 FROM positions').get(), '平倉成功時正常封存')

  console.log('\n[M11] 參與者配置：只分給啟用中策略、照紀錄退還與結算')
  const partRoute = await import(path.resolve(__dirname, '../app/api/participants/route'))
  const settleRoute = await import(path.resolve(__dirname, '../app/api/participants/settle/route'))
  reset()
  const mkS = (sym: string, active: number) => db.prepare(`INSERT INTO strategies (name,type,symbol,params,mode,is_active,session_id) VALUES ('p','supertrend_macd',?,?, 'paper',?, 'sessA')`)
    .run(sym, JSON.stringify({ ...params, tradeSize: 1000 }), active).lastInsertRowid as number
  const sA = mkS('SOLUSDT', 1), sB = mkS('BNBUSDT', 1), sDead = mkS('BTCUSDT', 0)
  const ts = (sid: number) => JSON.parse((db.prepare('SELECT params FROM strategies WHERE id=?').get(sid) as any).params).tradeSize
  const partId = db.prepare(`INSERT INTO participants (name,investment,start_date) VALUES ('alice',400,'2026-09-01')`).run().lastInsertRowid as number
  const put = (extra: object) => partRoute.PUT(req('PUT', { id: partId, name: 'alice', investment: 400, start_date: '2026-09-01', current_pnl: 0, ...extra }))
  await put({ bound_session_id: 'sessA' })
  ok(ts(sA) === 1200 && ts(sB) === 1200 && ts(sDead) === 1000, `只分給啟用中的 2 個策略（${ts(sA)}/${ts(sB)}/${ts(sDead)}，舊版 3 個各 +133）`)
  await put({ bound_session_id: 'sessA', name: 'alice2' })
  ok(ts(sA) === 1200 && ts(sB) === 1200, '只改名字不重新分配')
  db.prepare('UPDATE strategies SET is_active=1 WHERE id=?').run(sDead)
  await put({ bound_session_id: 'sessA', investment: 600 })
  ok(ts(sA) === 1200 && ts(sB) === 1200 && ts(sDead) === 1200, `改金額：照紀錄退還後依目前啟用策略重分（${ts(sA)}/${ts(sB)}/${ts(sDead)}）`)
  // 結算：sA 有持倉 12 顆 → 參與者份額 200/1200
  db.prepare(`INSERT INTO positions (strategy_id,symbol,side,entry_price,quantity,current_price,mode) VALUES (?, 'SOLUSDT','long',100,12,100,'paper')`).run(sA)
  const sr = await settleRoute.POST(req('POST', { id: partId, final_pnl: 5 }))
  ok(sr.status === 200, '結算成功')
  const left = (db.prepare('SELECT quantity q FROM positions WHERE strategy_id=?').get(sA) as any).q
  ok(Math.abs(left - 10) < 1e-6, `賣出份額 = 200/1200 × 12 = 2 顆，剩 ${left}`)
  ok(ts(sA) === 1000 && ts(sB) === 1000 && ts(sDead) === 1000, `tradeSize 全部退回 1000（${ts(sA)}/${ts(sB)}/${ts(sDead)}）`)
  const sr2 = await settleRoute.POST(req('POST', { id: partId, final_pnl: 5 }))
  ok(sr2.status === 400, '重複結算被擋')
  // 舊資料（allocations NULL）：刪除時照舊算法（全部策略平分 allocated）退還
  const legacy = db.prepare(`INSERT INTO participants (name,investment,start_date,bound_session_id,allocated) VALUES ('bob',300,'2026-09-01','sessA',300)`).run().lastInsertRowid as number
  for (const sid of [sA, sB, sDead]) db.prepare('UPDATE strategies SET params=? WHERE id=?').run(JSON.stringify({ ...params, tradeSize: 1100 }), sid)
  await partRoute.DELETE(req('DELETE', { id: legacy }))
  ok(ts(sA) === 1000 && ts(sB) === 1000 && ts(sDead) === 1000, '舊資料刪除：照當時的平分算法退還')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
main()
