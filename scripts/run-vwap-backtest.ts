/**
 * Quick backtest script: Crypto Pulse (VWAP+BB+RSI) for SOL & BNB, 2024 & 2025
 */
import { backtestVwapBbRsi } from '../lib/backtest'

const BASE = 'https://data-api.binance.vision'

async function fetchKlines(symbol: string, interval: string, startMs: number, endMs: number) {
  const allKlines: number[][] = []
  let start = startMs
  while (start < endMs) {
    const url = `${BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&endTime=${endMs}&limit=1000`
    const res = await fetch(url)
    const data = await res.json() as number[][]
    if (!data.length) break
    allKlines.push(...data)
    start = data[data.length - 1][0] + 1
    if (data.length < 1000) break
  }
  return allKlines.map(k => ({
    time: k[0],
    open: parseFloat(String(k[1])),
    high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])),
    close: parseFloat(String(k[4])),
    volume: parseFloat(String(k[5])),
  }))
}

const SYMBOLS = ['SOLUSDT', 'BNBUSDT']
const YEARS = [
  { label: '2024', start: new Date('2024-01-01').getTime(), end: new Date('2024-12-31T23:59:59').getTime() },
  { label: '2025', start: new Date('2025-01-01').getTime(), end: new Date('2025-12-31T23:59:59').getTime() },
]

const PARAMS = {
  rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
  bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
  atrPeriod: 14, atrSlMultiplier: 1.5,
  tradeSize: 1000,
}

async function main() {
  for (const sym of SYMBOLS) {
    for (const yr of YEARS) {
      process.stdout.write(`Fetching ${sym} ${yr.label} 4h...`)
      const klines = await fetchKlines(sym, '4h', yr.start, yr.end)
      process.stdout.write(` ${klines.length} candles\n`)
      const result = backtestVwapBbRsi(klines, PARAMS, 10000)
      const ret = result.totalReturn.toFixed(2)
      const wr = result.winRate.toFixed(1)
      console.log(`  ${sym} ${yr.label}: 回報 ${ret}%  勝率 ${wr}%  交易次數 ${result.totalTrades}`)
    }
  }
}

main().catch(console.error)
