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

// Fetch free USDT balance from Binance account
export async function fetchUsdtBalance(apiKey: string, apiSecret: string): Promise<number> {
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
  const usdt = (data.balances as { asset: string; free: string }[]).find(b => b.asset === 'USDT')
  return usdt ? Number(usdt.free) : 0
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
  const rounded = Math.floor(qty / stepSize) * stepSize
  return rounded.toFixed(precision)
}

// Signed order (requires API key/secret) — used by trading engine
export async function placeOrder(
  apiKey: string,
  apiSecret: string,
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  price?: string,
): Promise<{ orderId: string; status: string; price: string }> {
  const { createHmac } = await import('crypto')
  const ts = Date.now()
  const params: Record<string, string> = {
    symbol: symbol.replace('/', ''),
    side,
    type: price ? 'LIMIT' : 'MARKET',
    quantity,
    timestamp: String(ts),
    recvWindow: '5000',
  }
  if (price) {
    params.price = price
    params.timeInForce = 'GTC'
  }
  const qs = new URLSearchParams(params).toString()
  const sig = createHmac('sha256', apiSecret).update(qs).digest('hex')
  const res = await fetch(`${TRADE_BASE}/api/v3/order?${qs}&signature=${sig}`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': apiKey },
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.msg || 'Order failed')
  }
  return res.json()
}
