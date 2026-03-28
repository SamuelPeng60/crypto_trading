import { NextResponse } from 'next/server'
import { fetchAllTickers } from '@/lib/binance'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']

export async function GET() {
  try {
    const tickers = await fetchAllTickers(SYMBOLS)
    return NextResponse.json(tickers)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
