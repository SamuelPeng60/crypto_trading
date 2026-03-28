import { NextRequest, NextResponse } from 'next/server'
import { fetchKlines, Interval } from '@/lib/binance'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const symbol = searchParams.get('symbol') || 'BTCUSDT'
  const interval = (searchParams.get('interval') || '1h') as Interval
  const limit = Math.min(Number(searchParams.get('limit') || 200), 1000)
  try {
    const klines = await fetchKlines(symbol, interval, limit)
    return NextResponse.json(klines)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
