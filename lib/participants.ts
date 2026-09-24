import { getDb } from './db'

type Db = ReturnType<typeof getDb>

/** strategyId → 加到該策略 tradeSize 的金額 */
export type AllocMap = Record<string, number>

interface ParticipantAllocRow {
  bound_session_id: string | null
  allocated: number | null
  allocations: string | null
}

/**
 * 讀出參與者實際配置到各策略的金額。
 * 舊資料（Migration 18 之前綁定，allocations 為 NULL）照當時 PUT 的算法還原：
 * session 內所有策略（不分啟停）平分 allocated。
 */
export function readAllocations(db: Db, p: ParticipantAllocRow): AllocMap {
  if (p.allocations) {
    try { return JSON.parse(p.allocations) as AllocMap } catch { /* fall through */ }
  }
  const amount = p.allocated ?? 0
  if (!p.bound_session_id || amount <= 0) return {}
  const ids = (db.prepare('SELECT id FROM strategies WHERE session_id=?').all(p.bound_session_id) as { id: number }[]).map(r => r.id)
  if (!ids.length) return {}
  return Object.fromEntries(ids.map(id => [String(id), amount / ids.length]))
}

function addTradeSize(db: Db, strategyId: number, delta: number) {
  const row = db.prepare('SELECT params FROM strategies WHERE id=?').get(strategyId) as { params: string } | undefined
  if (!row) return  // 策略已被刪除
  const p = JSON.parse(row.params)
  p.tradeSize = Math.max(0, (p.tradeSize ?? 0) + delta)
  db.prepare("UPDATE strategies SET params=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(p), strategyId)
}

/**
 * 把 amount 平分加到 session 內「啟用中」的策略。已停止的策略不會交易，
 * 分給它的那一份等於閒置 —— 以前會被算進去。session 內沒有任何啟用中策略時才退回全部策略。
 */
export function applyAllocation(db: Db, sessionId: string, amount: number): AllocMap {
  if (amount <= 0) return {}
  let ids = (db.prepare('SELECT id FROM strategies WHERE session_id=? AND is_active=1').all(sessionId) as { id: number }[]).map(r => r.id)
  if (!ids.length) ids = (db.prepare('SELECT id FROM strategies WHERE session_id=?').all(sessionId) as { id: number }[]).map(r => r.id)
  if (!ids.length) return {}
  const per = amount / ids.length
  for (const id of ids) addTradeSize(db, id, per)
  return Object.fromEntries(ids.map(id => [String(id), per]))
}

export function revertAllocation(db: Db, map: AllocMap) {
  for (const [id, amount] of Object.entries(map)) addTradeSize(db, Number(id), -amount)
}
