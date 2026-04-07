const BINANCE_ENDPOINTS = [
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
]

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const allowedPaths = ['/api/v3/account', '/api/v3/order', '/api/v3/openOrders', '/api/v3/myTrades']
    if (!allowedPaths.some(p => url.pathname.startsWith(p))) {
      return new Response('Not found', { status: 404 })
    }

    const headers = new Headers(request.headers)
    headers.delete('host')

    // Try each endpoint until one works
    for (const base of BINANCE_ENDPOINTS) {
      const binanceUrl = `${base}${url.pathname}${url.search}`
      const res = await fetch(binanceUrl, {
        method: request.method,
        headers,
        body: request.method === 'POST' ? request.body : undefined,
      })
      const text = await res.text()
      // If geo-blocked, the response contains "restricted location"
      if (res.status === 451 || text.includes('restricted location') || text.includes('<html')) {
        continue
      }
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ code: -1, msg: 'All Binance endpoints are geo-blocked from this location' }), {
      status: 451,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
