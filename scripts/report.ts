/**
 * 1-year and 2-year backtest report for all 7 strategies
 * Run: npx tsx scripts/report.ts
 */
import { fetchKlinesFull } from '../lib/binance'
import {
  backtestMaCross, backtestRsi, backtestGrid,
  backtestSupertrend, backtestVwapBbRsi,
  backtestEmaRibbonSt, backtestMacdBbSqueeze,
} from '../lib/backtest'

const INITIAL = 10_000
const TRADE   = 1_000
const SYMBOL  = 'BTCUSDT'

function row(label: string, r: { totalReturn: number; winRate: number; maxDrawdown: number; sharpeRatio: number; totalTrades: number }) {
  const ret  = r.totalReturn.toFixed(1).padStart(7)
  const wr   = r.winRate.toFixed(0).padStart(5)
  const dd   = r.maxDrawdown.toFixed(1).padStart(6)
  const sh   = r.sharpeRatio.toFixed(2).padStart(6)
  const n    = String(r.totalTrades).padStart(4)
  const ok   = r.totalReturn >= 5 && r.winRate >= 60 ? ' ✓' : ''
  console.log(`  ${label.padEnd(36)} ret=${ret}%  wr=${wr}%  dd=${dd}%  sharpe=${sh}  n=${n}${ok}`)
}

async function main() {
  const now = Date.now()
  const ONE_YEAR_MS  = 365 * 24 * 3600 * 1000
  const TWO_YEAR_MS  = 730 * 24 * 3600 * 1000

  console.log('Fetching data...')
  // fetch enough bars for each timeframe to cover 2 years
  const [k1h_2y, k4h_2y, k1d_2y] = await Promise.all([
    fetchKlinesFull(SYMBOL, '1h',  17520, now),   // 730 days × 24h
    fetchKlinesFull(SYMBOL, '4h',  4380,  now),   // 730 days × 6
    fetchKlinesFull(SYMBOL, '1d',  730,   now),
  ])
  console.log(`  1h=${k1h_2y.length}  4h=${k4h_2y.length}  1d=${k1d_2y.length}`)

  // Slice to 1-year and 2-year windows
  const cutoff1y = (now - ONE_YEAR_MS) / 1000
  const k1h_1y = k1h_2y.filter(k => k.time >= cutoff1y)
  const k4h_1y = k4h_2y.filter(k => k.time >= cutoff1y)
  const k1d_1y = k1d_2y.filter(k => k.time >= cutoff1y)

  console.log(`\n  1y bars: 1h=${k1h_1y.length}  4h=${k4h_1y.length}  1d=${k1d_1y.length}`)

  // ── helpers ──
  const ribbon = (klines: typeof k1d_2y) => backtestEmaRibbonSt(klines, {
    fastEma: 5, midEma: 13, slowEma: 34,
    atrPeriod: 14, multiplier: 2.5, ema200Filter: true,
    atrSlMultiplier: 1.5, tradeSize: TRADE,
  }, INITIAL)

  const macdSq = (klines: typeof k1h_2y) => backtestMacdBbSqueeze(klines, {
    macdFast: 12, macdSlow: 26, macdSignal: 9,
    bbPeriod: 15, rsiPeriod: 14, atrPeriod: 14,
    atrSlMultiplier: 2, atrTpMultiplier: 5,
    ema200Filter: true, tradeSize: TRADE,
  }, INITIAL)

  const maCross = (klines: typeof k1d_2y) => backtestMaCross(klines, {
    fastPeriod: 10, slowPeriod: 30, maType: 'ema', tradeSize: TRADE,
  }, INITIAL)

  const rsiStrat = (klines: typeof k1h_2y) => backtestRsi(klines, {
    period: 14, oversold: 30, overbought: 70, tradeSize: TRADE,
  }, INITIAL)

  const st = (klines: typeof k4h_2y) => backtestSupertrend(klines, {
    atrPeriod: 10, multiplier: 3, ema200Filter: true, tradeSize: TRADE,
  }, INITIAL)

  const pulse = (klines: typeof k4h_2y) => backtestVwapBbRsi(klines, {
    rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
    bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
    atrPeriod: 14, atrSlMultiplier: 1.5, tradeSize: TRADE,
  }, INITIAL)

  // ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  BTCUSDT  1-YEAR backtest  (ret≥5% AND wr≥60% = ✓)')
  console.log('══════════════════════════════════════════════════════')
  row('MA Cross    (EMA 10/30, 4h)',    maCross(k4h_1y))
  row('RSI         (14, 30/70, 1h)',    rsiStrat(k1h_1y))
  row('SuperTrend  (ATR10, ×3, 4h)',    st(k4h_1y))
  row('Crypto Pulse(VWAP+BB+RSI, 4h)', pulse(k4h_1y))
  row('EMA Ribbon  (5/13/34, 4h)',      ribbon(k4h_1y))
  row('EMA Ribbon  (5/13/34, 1d)',      ribbon(k1d_1y))
  row('MACD Squeeze(12/26/9, 1h)',      macdSq(k1h_1y))
  row('MACD Squeeze(12/26/9, 4h)',      macdSq(k4h_1y))

  console.log('\n══════════════════════════════════════════════════════')
  console.log('  BTCUSDT  2-YEAR backtest  (ret≥5% AND wr≥60% = ✓)')
  console.log('══════════════════════════════════════════════════════')
  row('MA Cross    (EMA 10/30, 4h)',    maCross(k4h_2y))
  row('RSI         (14, 30/70, 1h)',    rsiStrat(k1h_2y))
  row('SuperTrend  (ATR10, ×3, 4h)',    st(k4h_2y))
  row('Crypto Pulse(VWAP+BB+RSI, 4h)', pulse(k4h_2y))
  row('EMA Ribbon  (5/13/34, 4h)',      ribbon(k4h_2y))
  row('EMA Ribbon  (5/13/34, 1d)',      ribbon(k1d_2y))
  row('MACD Squeeze(12/26/9, 1h)',      macdSq(k1h_2y))
  row('MACD Squeeze(12/26/9, 4h)',      macdSq(k4h_2y))

  console.log('\n  ✓ = 回報率 ≥5%  AND  勝率 ≥60%')
}

main().catch(console.error)
