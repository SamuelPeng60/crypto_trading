const BASE       = 'https://data-api.binance.vision' // public market data (not geo-restricted)
const TRADE_BASE = process.env.BINANCE_TRADE_BASE ?? 'https://api-gcp.binance.com' // authenticated endpoints; override via env on geo-blocked servers

export type Interval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'

export interface Kline {
  time: number   // unix seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Ticker {
  symbol: string
  price: number
  change: number   // 24h %
  volume: number
}

export async function fetchKlines(
  symbol: string,
  interval: Interval,
  limit = 500,
  startTime?: number,
  endTime?: number,
): Promise<Kline[]> {
  const params = new URLSearchParams({
    symbol: symbol.replace('/', ''),
    interval,
    limit: String(Math.min(limit, 1000)),
  })
  if (startTime) params.set('startTime', String(startTime))
  if (endTime) params.set('endTime', String(endTime))

  const res = await fetch(`${BASE}/api/v3/klines?${params}`, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`Binance klines error: ${res.status}`)
  const raw: unknown[][] = await res.json()
  return raw.map((k) => ({
    time: Math.floor(Number(k[0]) / 1000),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

// Fetch up to `totalLimit` candles, auto-paginating
export async function fetchKlinesFull(
  symbol: string,
  interval: Interval,
  totalLimit: number,
  endTime?: number,
): Promise<Kline[]> {
  const all: Kline[] = []
  let et = endTime
  const batchSize = 1000
  while (all.length < totalLimit) {
    const need = Math.min(batchSize, totalLimit - all.length)
    const batch = await fetchKlines(symbol, interval, need, undefined, et)
    if (!batch.length) break
    all.unshift(...batch)
    et = batch[0].time * 1000 - 1
    if (batch.length < need) break
  }
  return all.slice(-totalLimit)
}

export async function fetchTicker(symbol: string): Promise<Ticker> {
  const sym = symbol.replace('/', '')
  const res = await fetch(`${BASE}/api/v3/ticker/24hr?symbol=${sym}`, { next: { revalidate: 0 } })
  if (!res.ok) throw new Error(`Binance ticker error: ${res.status}`)
  const d = await res.json()
  return {
    symbol,
    price: Number(d.lastPrice),
    change: Number(d.priceChangePercent),
    volume: Number(d.quoteVolume),
  }
}

export async function fetchAllTickers(symbols: string[]): Promise<Ticker[]> {
  return Promise.all(symbols.map(fetchTicker))
}

async function fetchAccountBalances(apiKey: string, apiSecret: string): Promise<{ asset: string; free: string }[]> {
  const { createHmac } = await import('crypto')
  const ts = Date.now()
  const qs = `timestamp=${ts}&recvWindow=5000`
  const sig = createHmac('sha256', apiSecret).update(qs).digest('hex')
  const res = await fetch(`${TRADE_BASE}/api/v3/account?${qs}&signature=${sig}`, {
    headers: { 'X-MBX-APIKEY': apiKey },
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.msg || 'Account fetch failed')
  }
  const data = await res.json()
  return data.balances as { asset: string; free: string }[]
}

// Fetch free USDT balance from Binance account
export async function fetchUsdtBalance(apiKey: string, apiSecret: string): Promise<number> {
  const balances = await fetchAccountBalances(apiKey, apiSecret)
  const usdt = balances.find(b => b.asset === 'USDT')
  return usdt ? Number(usdt.free) : 0
}

// Fetch free balance of any asset (e.g. 'SOL', 'BTC', 'ETH')
export async function fetchAssetBalance(apiKey: string, apiSecret: string, asset: string): Promise<number> {
  const balances = await fetchAccountBalances(apiKey, apiSecret)
  const b = balances.find(b => b.asset === asset)
  return b ? Number(b.free) : 0
}

// ── LOT_SIZE helpers ──────────────────────────────────────────────────────────

const lotStepCache = new Map<string, number>()

/** Fetch the LOT_SIZE stepSize for a symbol from Binance exchangeInfo (cached). */
export async function fetchLotStepSize(symbol: string): Promise<number> {
  const sym = symbol.replace('/', '')
  if (lotStepCache.has(sym)) return lotStepCache.get(sym)!
  try {
    const res = await fetch(`${BASE}/api/v3/exchangeInfo?symbol=${sym}`, { next: { revalidate: 0 } })
    if (!res.ok) return 0.00001
    const data = await res.json()
    const filters: { filterType: string; stepSize?: string }[] = data.symbols?.[0]?.filters ?? []
    const lot = filters.find(f => f.filterType === 'LOT_SIZE')
    const step = Number(lot?.stepSize ?? '0.00001')
    lotStepCache.set(sym, step)
    return step
  } catch {
    return 0.00001 // safe fallback
  }
}

/**
 * Round qty down to the nearest stepSize and return as a string with correct
 * decimal precision.  Binance rejects quantities that don't align to stepSize.
 */
export function roundQty(qty: number, stepSize: number): string {
  const precision = Math.max(0, Math.round(-Math.log10(stepSize)))
  // qty / stepSize 的浮點誤差會讓 Math.floor 少算一整步
  // （0.29 / 0.01 = 28.999999999999996 → "0.28"，賣出時每次留下一步的殘渣）。
  // 加上與商數等比例的容差再取整；真正需要無條件捨去的情況不受影響。
  const steps = qty / stepSize
  const rounded = Math.floor(steps + steps * 1e-9 + 1e-9) * stepSize
  return rounded.toFixed(precision)
}

export interface OrderResult {
  orderId: string
  status: string
  price: string
  executedQty: string
  fills?: { commission: string; commissionAsset: string }[]
  /** true = 這張單是查詢既有訂單「找回」的，不是本次呼叫送出的（沒有 fills，手續費未知） */
  recovered?: boolean
}

// 幣安明確回覆的拒單（HTTP 4xx + JSON code）→ 訂單確定沒有成立。
// 其他錯誤（網路中斷、逾時、proxy 502/504 回 HTML）都是「不確定」：幣安可能已經成交。
class BinanceRejectError extends Error {
  constructor(message: string, public code: number) { super(message) }
}

async function signedRequest(apiKey: string, apiSecret: string, method: 'GET' | 'POST', path: string, params: Record<string, string>) {
  const { createHmac } = await import('crypto')
  const qs = new URLSearchParams({ ...params, timestamp: String(Date.now()), recvWindow: '5000' }).toString()
  const sig = createHmac('sha256', apiSecret).update(qs).digest('hex')
  const res = await fetch(`${TRADE_BASE}${path}?${qs}&signature=${sig}`, {
    method,
    headers: { 'X-MBX-APIKEY': apiKey },
  })
  const text = await res.text()
  let body: { code?: number; msg?: string } & Record<string, unknown>
  try { body = JSON.parse(text) } catch {
    throw new Error(`HTTP ${res.status} 非 JSON 回應: ${text.slice(0, 120)}`)
  }
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500 && typeof body.code === 'number') {
      throw new BinanceRejectError(body.msg || `Binance error ${body.code}`, body.code)
    }
    throw new Error(body.msg || `HTTP ${res.status}`)
  }
  return body
}

/** 以 clientOrderId 查訂單；不存在回 null（幣安 code -2013）。 */
async function queryOrderByClientId(apiKey: string, apiSecret: string, symbol: string, clientOrderId: string): Promise<OrderResult | null> {
  try {
    const o = await signedRequest(apiKey, apiSecret, 'GET', '/api/v3/order', {
      symbol: symbol.replace('/', ''),
      origClientOrderId: clientOrderId,
    })
    return { ...(o as unknown as OrderResult), orderId: String(o.orderId), recovered: true }
  } catch (e) {
    if (e instanceof BinanceRejectError && e.code === -2013) return null
    throw e
  }
}

// Signed order (requires API key/secret) — used by trading engine
export async function placeOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  price?: string,
  clientOrderId?: string,
): Promise<OrderResult> {
  const params: Record<string, string> = {
    symbol: symbol.replace('/', ''),
    side,
    type: price ? 'LIMIT' : 'MARKET',
    quantity,
  }
  if (price) {
    params.price = price
    params.timeInForce = 'GTC'
  }
  if (clientOrderId) params.newClientOrderId = clientOrderId
  const r = await signedRequest(apiKey, apiSecret, 'POST', '/api/v3/order', params)
  return { ...(r as unknown as OrderResult), orderId: String(r.orderId) }
}

/**
 * 冪等下單：同一個 clientOrderId 只會成交一次。
 *
 * 問題：下單經 Oracle proxy 轉發，502/504/逾時時幣安可能已經成交，但引擎當成失敗、
 * 下一個 tick 又下一張 → 重複買進，第一筆的幣 DB 不知道、永遠不會賣。
 * 幣安只在「未成交掛單」之間檢查 newClientOrderId 重複，市價單立即成交後就不擋了，
 * 所以要自己查：
 *   1. 下單前先查這個 clientOrderId 是否已存在（上一次的不確定失敗其實成交了）→ 直接沿用
 *   2. 下單遇到「不確定」錯誤 → 再查一次，查到就當成功
 *   3. 幣安明確拒單（4xx + code）→ 直接拋錯，訂單確定沒成立
 * clientOrderId 必須對同一筆「意圖」固定（例如同策略同訊號棒），重試時才能對上。
 * 限制：幣安規則 ^[.A-Za-z0-9:/_-]{1,36}$
 */
export async function placeOrderIdempotent(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  clientOrderId: string,
): Promise<OrderResult> {
  const existing = await queryOrderByClientId(apiKey, apiSecret, symbol, clientOrderId)
  if (existing && Number(existing.executedQty) > 0) return existing
  try {
    return await placeOrder(apiKey, apiSecret, symbol, side, quantity, undefined, clientOrderId)
  } catch (e) {
    if (e instanceof BinanceRejectError) throw e
    const found = await queryOrderByClientId(apiKey, apiSecret, symbol, clientOrderId).catch(() => null)
    if (found && Number(found.executedQty) > 0) return found
    throw e
  }
}
