'use client'
import React, { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { toast } from 'sonner'
import { createChart, AreaSeries, IChartApi, ISeriesApi, Time } from 'lightweight-charts'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { FlaskConical, TrendingUp, TrendingDown, BarChart2, Percent, Info } from 'lucide-react'
import type { BacktestResult, TradeRecord } from '@/lib/backtest'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']
type StratType = 'grid' | 'supertrend' | 'vwap_bb_rsi' | 'ema_ribbon_st' | 'macd_bb_squeeze' | 'adaptive_combo'

// Best interval per strategy — derived from annual backtest (highest win rate with sufficient trades)
const STRATEGY_DEFAULT_INTERVAL: Record<StratType, string> = {
  grid:            '4h',
  supertrend:      '4h',   // 50% wr 2025, 41% wr 2024
  vwap_bb_rsi:     '4h',   // best after fees: 4h avg 8.1% return (SOL 13.5%, BNB 10% in 2024)
  ema_ribbon_st:   '4h',   // 64% wr 2024
  macd_bb_squeeze: '1h',   // 39% wr 2025, meaningful sample (108 trades)
  adaptive_combo:  '4h',
}

// Best return interval — derived from annual2.ts (avg return across BTC/SOL/BNB × 2024+2025)
const STRATEGY_BEST_RETURN_INTERVAL: Record<StratType, string> = {
  grid:            '4h',
  supertrend:      '4h',   // avg return=3.2%
  vwap_bb_rsi:     '4h',   // avg return=8.1%
  ema_ribbon_st:   '4h',   // avg return=2.9%
  macd_bb_squeeze: '1d',   // avg return=2.1%
  adaptive_combo:  '4h',
}

// Best win-rate preset per strategy
const BEST_WR_PRESET: Record<StratType, { interval: string; params: Record<string, unknown> }> = {
  grid:            { interval: '4h', params: {} },
  supertrend:      { interval: '4h', params: { atrPeriod: 7, multiplier: 3, ema200Filter: 'true' } },
  vwap_bb_rsi:     { interval: '4h', params: { vwapWindow: 24, rsiOversold: 35, rsiOverbought: 65, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, atrSlMultiplier: 1.5, trailAtrMult: 0, volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35 } },
  ema_ribbon_st:   { interval: '4h', params: { fastEma: 5, midEma: 8, slowEma: 21, atrPeriod: 14, multiplier: 3.5, atrSlMultiplier: 2.0 } },
  macd_bb_squeeze: { interval: '1h', params: { macdFast: 12, macdSlow: 26, macdSignal: 9, bbPeriod: 15, rsiPeriod: 14, atrPeriod: 14, atrSlMultiplier: 2, atrTpMultiplier: 5 } },
  adaptive_combo:  { interval: '4h', params: { fastEma: 5, midEma: 13, slowEma: 34, atrPeriod: 14, multiplier: 2.5, ema200Filter: 'true', atrSlMultiplier: 1.5, rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65, bbPeriod: 20, bbStdDev: 2, vwapWindow: 24, volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35 } },
}

// Best return preset per strategy
const BEST_RETURN_PRESET: Record<StratType, { interval: string; params: Record<string, unknown> }> = {
  grid:             { interval: '4h', params: {} },
  supertrend:       { interval: '4h', params: { atrPeriod: 14, multiplier: 1.5, ema200Filter: 'true' } },
  vwap_bb_rsi:      { interval: '4h', params: { vwapWindow: 24, rsiOversold: 35, rsiOverbought: 65, bbPeriod: 20, bbStdDev: 2, atrPeriod: 14, atrSlMultiplier: 1.5, trailAtrMult: 2.5, volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35 } },
  ema_ribbon_st:    { interval: '4h', params: { fastEma: 5, midEma: 8, slowEma: 21, atrPeriod: 14, multiplier: 3.5, atrSlMultiplier: 2.0 } },
  macd_bb_squeeze:  { interval: '4h', params: { macdFast: 12, macdSlow: 26, macdSignal: 9, bbPeriod: 15, rsiPeriod: 14, atrPeriod: 14, atrSlMultiplier: 2, atrTpMultiplier: 5 } },
  adaptive_combo:   { interval: '4h', params: { fastEma: 5, midEma: 13, slowEma: 34, atrPeriod: 14, multiplier: 2.5, ema200Filter: 'true', atrSlMultiplier: 1.5, rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65, bbPeriod: 20, bbStdDev: 2, vwapWindow: 24, volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35 } },
}

export default function BacktestPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [type, setType] = useState<StratType>('vwap_bb_rsi')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState(STRATEGY_DEFAULT_INTERVAL['vwap_bb_rsi'])
  const [startDate, setStartDate] = useState('2024-01-01')
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [capital, setCapital] = useState('10000')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<(BacktestResult & { id: number }) | null>(null)

  // strategy params
  const [tradeSize, setTradeSize] = useState('1000')
  const [upperPrice, setUpperPrice] = useState('')
  const [lowerPrice, setLowerPrice] = useState('')
  const [gridCount, setGridCount] = useState('10')
  const [amountPerGrid, setAmountPerGrid] = useState('100')
  // SuperTrend params
  const [atrPeriod, setAtrPeriod] = useState('10')
  const [multiplier, setMultiplier] = useState('3')
  const [ema200Filter, setEma200Filter] = useState('true')
  // VWAP+BB+RSI params
  const [vwapWindow, setVwapWindow] = useState('24')
  const [bbPeriod, setBbPeriod] = useState('20')
  const [bbStdDev, setBbStdDev] = useState('2')
  const [vwapRsiPeriod, setVwapRsiPeriod] = useState('14')
  const [vwapOversold, setVwapOversold] = useState('35')
  const [vwapOverbought, setVwapOverbought] = useState('65')
  const [vwapAtrPeriod, setVwapAtrPeriod] = useState('14')
  const [atrSlMultiplier, setAtrSlMultiplier] = useState('1.5')
  const [trailAtrMult, setTrailAtrMult] = useState('2.5')
  // EMA Ribbon + SuperTrend params
  const [fastEma, setFastEma] = useState('5')
  const [midEma, setMidEma] = useState('8')
  const [slowEma, setSlowEma] = useState('21')
  const [ribbonAtrPeriod, setRibbonAtrPeriod] = useState('14')
  const [ribbonMultiplier, setRibbonMultiplier] = useState('3.5')
  const [ribbonEma200, setRibbonEma200] = useState('true')
  const [ribbonAtrSl, setRibbonAtrSl] = useState('2.0')
  // MACD+BB Squeeze params
  const [macdFast, setMacdFast] = useState('12')
  const [macdSlow, setMacdSlow] = useState('26')
  const [macdSignalP, setMacdSignalP] = useState('9')
  const [squeezeBbPeriod, setSqueezeBbPeriod] = useState('15')
  const [squeezeRsiPeriod, setSqueezeRsiPeriod] = useState('14')
  const [squeezeAtrPeriod, setSqueezeAtrPeriod] = useState('14')
  const [squeezeAtrSl, setSqueezeAtrSl] = useState('2')
  const [squeezeAtrTp, setSqueezeAtrTp] = useState('5')
  const [squeezeEma200, setSqueezeEma200] = useState('true')
  // Regime filter params (Crypto Pulse only)
  const [volRegimeShort, setVolRegimeShort] = useState('20')
  const [volRegimeLong, setVolRegimeLong] = useState('60')
  const [volRegimeThreshold, setVolRegimeThreshold] = useState('1.3')
  // Entry filter params (Crypto Pulse only)
  const [vwapEma200Filter, setVwapEma200Filter] = useState('false')
  const [minVwapDevPct, setMinVwapDevPct] = useState('0')
  const [rsiDivFilter, setRsiDivFilter] = useState('false')
  const [rsiDivLookback, setRsiDivLookback] = useState('5')
  const [bbWidthFilter, setBbWidthFilter] = useState('false')
  const [bbWidthPeriod, setBbWidthPeriod] = useState('20')
  const [obvFilter, setObvFilter] = useState('false')
  const [obvPeriod, setObvPeriod] = useState('20')

  const [showRunModal, setShowRunModal] = useState(false)
  const [runSymbols, setRunSymbols] = useState<string[]>(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'])

  type YearRow = { year: number; symbol: string; totalReturn: number; winRate: number; totalTrades: number; maxDrawdown: number; sharpeRatio: number; error?: string }
  const [yearResults, setYearResults] = useState<YearRow[]>([])
  const [yearRunning, setYearRunning] = useState(false)

  const equityRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null)

  useEffect(() => {
    if (!equityRef.current) return
    const chart = createChart(equityRef.current, {
      layout: { background: { color: '#09090b' }, textColor: '#a1a1aa' },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: true },
      width: equityRef.current.clientWidth,
      height: 260,
    })
    chartRef.current = chart
    const series = chart.addSeries(AreaSeries, {
      lineColor: '#eab308',
      topColor: 'rgba(234, 179, 8, 0.3)',
      bottomColor: 'rgba(234, 179, 8, 0)',
      lineWidth: 2,
    })
    seriesRef.current = series
    const ro = new ResizeObserver(() => {
      if (equityRef.current) chart.resize(equityRef.current.clientWidth, 260)
    })
    ro.observe(equityRef.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [])

  const handleTypeChange = (v: StratType) => {
    setType(v)
    setInterval(STRATEGY_DEFAULT_INTERVAL[v])
  }

  const applyPreset = (preset: { interval: string; params: Record<string, unknown> }) => {
    setInterval(preset.interval)
    const p = preset.params
    if (p.atrPeriod !== undefined) {
      setAtrPeriod(String(p.atrPeriod))
      setRibbonAtrPeriod(String(p.atrPeriod))
      setVwapAtrPeriod(String(p.atrPeriod))
      setSqueezeAtrPeriod(String(p.atrPeriod))
    }
    if (p.multiplier !== undefined) {
      setMultiplier(String(p.multiplier))
      setRibbonMultiplier(String(p.multiplier))
    }
    if (p.ema200Filter !== undefined) {
      setEma200Filter(String(p.ema200Filter))
      setRibbonEma200(String(p.ema200Filter))
    }
    if (p.vwapWindow !== undefined) setVwapWindow(String(p.vwapWindow))
    if (p.rsiOversold !== undefined) setVwapOversold(String(p.rsiOversold))
    if (p.rsiOverbought !== undefined) setVwapOverbought(String(p.rsiOverbought))
    if (p.bbPeriod !== undefined) { setBbPeriod(String(p.bbPeriod)); setSqueezeBbPeriod(String(p.bbPeriod)) }
    if (p.bbStdDev !== undefined) setBbStdDev(String(p.bbStdDev))
    if (p.atrSlMultiplier !== undefined) { setAtrSlMultiplier(String(p.atrSlMultiplier)); setRibbonAtrSl(String(p.atrSlMultiplier)); setSqueezeAtrSl(String(p.atrSlMultiplier)) }
    if (p.fastEma !== undefined) setFastEma(String(p.fastEma))
    if (p.midEma !== undefined) setMidEma(String(p.midEma))
    if (p.slowEma !== undefined) setSlowEma(String(p.slowEma))
    if (p.macdFast !== undefined) setMacdFast(String(p.macdFast))
    if (p.macdSlow !== undefined) setMacdSlow(String(p.macdSlow))
    if (p.macdSignal !== undefined) setMacdSignalP(String(p.macdSignal))
    if (p.rsiPeriod !== undefined) setSqueezeRsiPeriod(String(p.rsiPeriod))
    if (p.atrTpMultiplier !== undefined) setSqueezeAtrTp(String(p.atrTpMultiplier))
    if (p.volRegimeShort !== undefined) setVolRegimeShort(String(p.volRegimeShort))
    if (p.volRegimeLong !== undefined) setVolRegimeLong(String(p.volRegimeLong))
    if (p.volRegimeThreshold !== undefined) setVolRegimeThreshold(String(p.volRegimeThreshold))
    if (p.trailAtrMult !== undefined) setTrailAtrMult(String(p.trailAtrMult))
    if (p.ema200Filter !== undefined) setVwapEma200Filter(String(p.ema200Filter))
    if (p.minVwapDevPct !== undefined) setMinVwapDevPct(String(p.minVwapDevPct))
    if (p.rsiDivFilter !== undefined) setRsiDivFilter(String(p.rsiDivFilter))
    if (p.rsiDivLookback !== undefined) setRsiDivLookback(String(p.rsiDivLookback))
    if (p.bbWidthFilter !== undefined) setBbWidthFilter(String(p.bbWidthFilter))
    if (p.bbWidthPeriod !== undefined) setBbWidthPeriod(String(p.bbWidthPeriod))
    if (p.obvFilter !== undefined) setObvFilter(String(p.obvFilter))
    if (p.obvPeriod !== undefined) setObvPeriod(String(p.obvPeriod))
  }

  const handleRunPerf = async () => {
    const params = getParams()
    let created = 0
    for (const sym of runSymbols) {
      try {
        const res = await fetch('/api/strategies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${type} ${sym}`, type, symbol: sym, params, interval }),
        })
        if (!res.ok) continue
        const data = await res.json()
        const id = data.id ?? data.strategy?.id
        if (id) {
          await fetch(`/api/strategies/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: 1 }),
          })
        }
        created++
      } catch { /* skip */ }
    }
    setShowRunModal(false)
    toast.success(`已建立並啟動 ${created} 個策略`)
    localStorage.setItem('dashboard_strategy', type)
    router.push('/strategies')
  }

  const getParams = () => {
    if (type === 'supertrend') return {
      atrPeriod: Number(atrPeriod), multiplier: Number(multiplier),
      ema200Filter: ema200Filter === 'true', tradeSize: Number(tradeSize),
    }
    if (type === 'vwap_bb_rsi') return {
      rsiPeriod: Number(vwapRsiPeriod), rsiOversold: Number(vwapOversold),
      rsiOverbought: Number(vwapOverbought), bbPeriod: Number(bbPeriod),
      bbStdDev: Number(bbStdDev), vwapWindow: Number(vwapWindow),
      atrPeriod: Number(vwapAtrPeriod), atrSlMultiplier: Number(atrSlMultiplier),
      trailAtrMult: Number(trailAtrMult),
      tradeSize: Number(tradeSize),
      volRegimeShort: Number(volRegimeShort),
      volRegimeLong: Number(volRegimeLong),
      volRegimeThreshold: Number(volRegimeThreshold),
      ema200Filter: vwapEma200Filter === 'true',
      minVwapDevPct: Number(minVwapDevPct),
      rsiDivFilter: rsiDivFilter === 'true',
      rsiDivLookback: Number(rsiDivLookback),
      bbWidthFilter: bbWidthFilter === 'true',
      bbWidthPeriod: Number(bbWidthPeriod),
      obvFilter: obvFilter === 'true',
      obvPeriod: Number(obvPeriod),
    }
    if (type === 'ema_ribbon_st') return {
      fastEma: Number(fastEma), midEma: Number(midEma), slowEma: Number(slowEma),
      atrPeriod: Number(ribbonAtrPeriod), multiplier: Number(ribbonMultiplier),
      ema200Filter: ribbonEma200 === 'true',
      atrSlMultiplier: Number(ribbonAtrSl), tradeSize: Number(tradeSize),
    }
    if (type === 'macd_bb_squeeze') return {
      macdFast: Number(macdFast), macdSlow: Number(macdSlow), macdSignal: Number(macdSignalP),
      bbPeriod: Number(squeezeBbPeriod), rsiPeriod: Number(squeezeRsiPeriod),
      atrPeriod: Number(squeezeAtrPeriod), atrSlMultiplier: Number(squeezeAtrSl),
      atrTpMultiplier: Number(squeezeAtrTp), ema200Filter: squeezeEma200 === 'true',
      tradeSize: Number(tradeSize),
    }
    if (type === 'adaptive_combo') return {
      fastEma: Number(fastEma), midEma: Number(midEma), slowEma: Number(slowEma),
      atrPeriod: Number(ribbonAtrPeriod), multiplier: Number(ribbonMultiplier),
      ema200Filter: ribbonEma200 === 'true', atrSlMultiplier: Number(ribbonAtrSl),
      rsiPeriod: Number(vwapRsiPeriod), rsiOversold: Number(vwapOversold),
      rsiOverbought: Number(vwapOverbought), bbPeriod: Number(bbPeriod),
      bbStdDev: Number(bbStdDev), vwapWindow: Number(vwapWindow),
      volRegimeShort: Number(volRegimeShort), volRegimeLong: Number(volRegimeLong),
      volRegimeThreshold: Number(volRegimeThreshold),
      tradeSize: Number(tradeSize),
    }
    return {
      upperPrice: Number(upperPrice), lowerPrice: Number(lowerPrice),
      gridCount: Number(gridCount), amountPerGrid: Number(amountPerGrid),
    }
  }

  const run = async () => {
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, symbol, interval, startDate, endDate,
          initialCapital: Number(capital), params: getParams(),
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '回測失敗'); return }
      setResult(data)
      if (seriesRef.current && data.equity?.length) {
        seriesRef.current.setData(
          data.equity.map((e: { time: number; value: number }) => ({
            time: e.time as Time,
            value: e.value,
          }))
        )
        chartRef.current?.timeScale().fitContent()
      }
      toast.success('回測完成')
    } catch {
      toast.error('回測失敗')
    } finally {
      setRunning(false)
    }
  }

  const runYearlyBacktest = async () => {
    setYearRunning(true)
    setYearResults([])
    const periods = [
      { year: 2022, start: '2022-01-01', end: '2022-12-31' },
      { year: 2023, start: '2023-01-01', end: '2023-12-31' },
      { year: 2024, start: '2024-01-01', end: '2024-12-31' },
      { year: 2025, start: '2025-01-01', end: '2025-12-31' },
      { year: 2026, start: '2026-01-01', end: '2026-03-31' },
    ]
    const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
    const params = getParams()
    const tasks = periods.flatMap(p => syms.map(sym => ({ ...p, sym })))

    const runOne = async ({ year, start, end, sym }: { year: number; start: string; end: string; sym: string }) => {
      try {
        const res = await fetch('/api/backtest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type, symbol: sym, interval: '4h',
            startDate: start, endDate: end,
            initialCapital: Number(capital), params,
          }),
        })
        const data = await res.json()
        if (!res.ok) return { year, symbol: sym, error: data.error || 'err', totalReturn: 0, winRate: 0, totalTrades: 0, maxDrawdown: 0, sharpeRatio: 0 }
        return { year, symbol: sym, totalReturn: data.totalReturn, winRate: data.winRate, totalTrades: data.totalTrades, maxDrawdown: data.maxDrawdown, sharpeRatio: data.sharpeRatio }
      } catch {
        return { year, symbol: sym, error: 'failed', totalReturn: 0, winRate: 0, totalTrades: 0, maxDrawdown: 0, sharpeRatio: 0 }
      }
    }

    const results = await Promise.all(tasks.map(runOne))
    setYearResults(results)
    setYearRunning(false)
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">策略回測</h1>
        <p className="text-zinc-500 text-sm mt-1">用歷史數據驗證策略表現</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Config panel */}
        <div className="lg:col-span-1 space-y-4 bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm text-zinc-300">回測設定</h2>
            <div className="relative flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2 border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                onClick={() => applyPreset(BEST_WR_PRESET[type])}
              >
                勝率最高
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2 border-yellow-600/50 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400"
                onClick={() => applyPreset(BEST_RETURN_PRESET[type])}
              >
                回報最高
              </Button>
              {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7 px-2 border-green-600/50 bg-green-500/10 hover:bg-green-500/20 text-green-400"
                onClick={() => setShowRunModal(v => !v)}
              >
                跑績效 ▶
              </Button>
              )}

              {isAdmin && showRunModal && (
                <div className="absolute top-full right-0 mt-2 z-50 bg-zinc-900 border border-zinc-700 rounded-xl p-4 shadow-xl w-56">
                  <p className="text-sm font-semibold mb-3">選擇幣種跑績效</p>
                  <div className="space-y-2 mb-4">
                    {['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'].map(sym => (
                      <label key={sym} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={runSymbols.includes(sym)}
                          onChange={e => setRunSymbols(prev =>
                            e.target.checked ? [...prev, sym] : prev.filter(s => s !== sym)
                          )}
                          className="accent-yellow-500"
                        />
                        <span className="text-sm text-zinc-300">{sym.replace('USDT', '/USDT')}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1 bg-yellow-500 text-zinc-900 hover:bg-yellow-400 text-xs font-semibold"
                      onClick={handleRunPerf}
                      disabled={runSymbols.length === 0}
                    >
                      確認
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs border-zinc-700 text-zinc-400"
                      onClick={() => setShowRunModal(false)}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">策略類型</Label>
            <Select value={type} onValueChange={v => handleTypeChange(v as StratType)}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="vwap_bb_rsi">Crypto Pulse（VWAP+BB+RSI）</SelectItem>
                <SelectItem value="adaptive_combo">自適應組合（趨勢+均值回歸）</SelectItem>
                <SelectItem value="supertrend">SuperTrend（ATR 趨勢）</SelectItem>
                <SelectItem value="ema_ribbon_st">EMA Ribbon + SuperTrend（趨勢追蹤）</SelectItem>
                <SelectItem value="macd_bb_squeeze">MACD + BB Squeeze（突破）</SelectItem>
                <SelectItem value="grid">網格交易</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">交易對</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {SYMBOLS.map(s => <SelectItem key={s} value={s}>{s.replace('USDT', '/USDT')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">K線週期</Label>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {INTERVALS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {interval === STRATEGY_BEST_RETURN_INTERVAL[type] && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 font-medium border border-yellow-500/30">
                回報率最高
              </span>
              <span className="text-xs text-zinc-500">此週期在多幣種回測中平均報酬最佳</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">開始日期</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">結束日期</Label>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="bg-zinc-800 border-zinc-700 text-sm" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">初始資金 (USDT)</Label>
            <Input value={capital} onChange={e => setCapital(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-sm" />
          </div>

          {/* Strategy params — admin only */}
          {isAdmin && <div className="border-t border-zinc-800 pt-3 space-y-3">
            <p className="text-xs text-zinc-400 font-medium">策略參數</p>

            {type === 'grid' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">上限 (USDT)</Label>
                    <Input value={upperPrice} onChange={e => setUpperPrice(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" placeholder="e.g. 110000" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">下限 (USDT)</Label>
                    <Input value={lowerPrice} onChange={e => setLowerPrice(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" placeholder="e.g. 90000" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">格數</Label>
                    <Input value={gridCount} onChange={e => setGridCount(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">每格 (USDT)</Label>
                    <Input value={amountPerGrid} onChange={e => setAmountPerGrid(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
              </>
            )}

            {type === 'supertrend' && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">ATR 週期</Label>
                    <Input value={atrPeriod} onChange={e => setAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">乘數</Label>
                    <Input value={multiplier} onChange={e => setMultiplier(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">EMA200 過濾</Label>
                    <Select value={ema200Filter} onValueChange={setEma200Filter}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="true">開啟</SelectItem>
                        <SelectItem value="false">關閉</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">每筆金額 (USDT)</Label>
                  <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                </div>
              </>
            )}

            {type === 'vwap_bb_rsi' && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">VWAP 視窗</Label>
                    <Input value={vwapWindow} onChange={e => setVwapWindow(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">BB 週期</Label>
                    <Input value={bbPeriod} onChange={e => setBbPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">BB 倍數</Label>
                    <Input value={bbStdDev} onChange={e => setBbStdDev(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">RSI 週期</Label>
                    <Input value={vwapRsiPeriod} onChange={e => setVwapRsiPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">RSI 超賣</Label>
                    <Input value={vwapOversold} onChange={e => setVwapOversold(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">RSI 超買</Label>
                    <Input value={vwapOverbought} onChange={e => setVwapOverbought(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">每筆 (USDT)</Label>
                    <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">ATR 週期</Label>
                    <Input value={vwapAtrPeriod} onChange={e => setVwapAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">止損 ATR 倍數</Label>
                    <Input value={atrSlMultiplier} onChange={e => setAtrSlMultiplier(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
                <div className="border-t border-zinc-700 pt-2">
                  <p className="text-xs text-blue-400 font-medium mb-2">Regime Filter（趨勢過濾）</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">短期波動窗口</Label>
                      <Input value={volRegimeShort} onChange={e => setVolRegimeShort(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">長期波動窗口</Label>
                      <Input value={volRegimeLong} onChange={e => setVolRegimeLong(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">觸發比率</Label>
                      <Input value={volRegimeThreshold} onChange={e => setVolRegimeThreshold(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1.5">短期/長期波動率 &gt; 比率時暫停進場（趨勢行情保護）</p>
                </div>
                <div className="border-t border-zinc-700 pt-2">
                  <p className="text-xs text-amber-400 font-medium mb-2">Trailing Stop（追蹤止損）</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">追蹤 ATR 倍數（0=停用）</Label>
                      <Input value={trailAtrMult} onChange={e => setTrailAtrMult(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5 flex items-end">
                      <p className="text-xs text-zinc-500 pb-2">
                        {Number(trailAtrMult) > 0
                          ? `啟用：SL 追蹤最高收盤 - ${trailAtrMult}×ATR，停用 RSI 超買出場`
                          : '停用：使用 RSI 超買出場（原版）'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="border-t border-zinc-700 pt-2">
                  <p className="text-xs text-blue-400 font-medium mb-2">進場過濾器（Entry Filters）</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5 col-span-2">
                      <Label className="text-xs">EMA200 過濾（只在長期上升趨勢進場）</Label>
                      <Select value={vwapEma200Filter} onValueChange={setVwapEma200Filter}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          <SelectItem value="false">關閉</SelectItem>
                          <SelectItem value="true">開啟（price &gt; EMA200 才進場）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">VWAP 最小偏離度 %（0=停用）</Label>
                      <Input value={minVwapDevPct} onChange={e => setMinVwapDevPct(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5 flex items-end">
                      <p className="text-xs text-zinc-500 pb-2">
                        {Number(minVwapDevPct) > 0
                          ? `進場需低於 VWAP ${minVwapDevPct}% 以上（跌得夠深才進）`
                          : '停用：跌破 VWAP 即可進場（原版）'}
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">RSI 看漲背離過濾</Label>
                      <Select value={rsiDivFilter} onValueChange={setRsiDivFilter}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          <SelectItem value="false">關閉</SelectItem>
                          <SelectItem value="true">開啟（RSI 高於近期價格低點的 RSI）</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">背離回看週期</Label>
                      <Input value={rsiDivLookback} onChange={e => setRsiDivLookback(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" disabled={rsiDivFilter !== 'true'} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">BB 帶寬收縮過濾</Label>
                      <Select value={bbWidthFilter} onValueChange={setBbWidthFilter}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          <SelectItem value="false">關閉</SelectItem>
                          <SelectItem value="true">開啟</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">帶寬 SMA 週期</Label>
                      <Input value={bbWidthPeriod} onChange={e => setBbWidthPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" disabled={bbWidthFilter !== 'true'} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">爆量投降過濾（1.5×均量）</Label>
                      <Select value={obvFilter} onValueChange={setObvFilter}>
                        <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-zinc-800 border-zinc-700">
                          <SelectItem value="false">關閉</SelectItem>
                          <SelectItem value="true">開啟</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">均量回看週期</Label>
                      <Input value={obvPeriod} onChange={e => setObvPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" disabled={obvFilter !== 'true'} />
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1.5">BB帶寬：帶寬縮窄時才進場；爆量投降：進場棒量 &gt; N 棒均量×1.5（賣盤耗盡才進，過濾死貓彈）</p>
                </div>
              </>
            )}

            {type === 'ema_ribbon_st' && (
              <>
                <p className="text-xs text-zinc-500">EMA 多頭排列 + SuperTrend 翻多進場，無固定止盈讓趨勢走完</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">快線 EMA</Label>
                    <Input value={fastEma} onChange={e => setFastEma(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">中線 EMA</Label>
                    <Input value={midEma} onChange={e => setMidEma(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">慢線 EMA</Label>
                    <Input value={slowEma} onChange={e => setSlowEma(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">ATR 週期</Label>
                    <Input value={ribbonAtrPeriod} onChange={e => setRibbonAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">ST 乘數</Label>
                    <Input value={ribbonMultiplier} onChange={e => setRibbonMultiplier(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">止損 ATR 倍</Label>
                    <Input value={ribbonAtrSl} onChange={e => setRibbonAtrSl(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">每筆金額 (USDT)</Label>
                    <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">EMA200 過濾</Label>
                    <Select value={ribbonEma200} onValueChange={setRibbonEma200}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="true">開啟</SelectItem>
                        <SelectItem value="false">關閉</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {type === 'adaptive_combo' && (
              <>
                <p className="text-xs text-zinc-500">趨勢市用 EMA Ribbon + ST 進場，盤整市自動切換 Crypto Pulse 均值回歸</p>
                <div className="border border-zinc-700 rounded-lg p-3 space-y-3">
                  <p className="text-xs text-cyan-400 font-medium">趨勢模式（EMA Ribbon + SuperTrend）</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">快線 EMA</Label>
                      <Input value={fastEma} onChange={e => setFastEma(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">中線 EMA</Label>
                      <Input value={midEma} onChange={e => setMidEma(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">慢線 EMA</Label>
                      <Input value={slowEma} onChange={e => setSlowEma(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">ATR 週期</Label>
                      <Input value={ribbonAtrPeriod} onChange={e => setRibbonAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">ST 乘數</Label>
                      <Input value={ribbonMultiplier} onChange={e => setRibbonMultiplier(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">止損 ATR 倍</Label>
                      <Input value={ribbonAtrSl} onChange={e => setRibbonAtrSl(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">EMA200 過濾</Label>
                    <Select value={ribbonEma200} onValueChange={setRibbonEma200}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="true">開啟</SelectItem>
                        <SelectItem value="false">關閉</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="border border-zinc-700 rounded-lg p-3 space-y-3">
                  <p className="text-xs text-pink-400 font-medium">盤整模式（Crypto Pulse）</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">VWAP 視窗</Label>
                      <Input value={vwapWindow} onChange={e => setVwapWindow(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">BB 週期</Label>
                      <Input value={bbPeriod} onChange={e => setBbPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">BB 倍數</Label>
                      <Input value={bbStdDev} onChange={e => setBbStdDev(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">RSI 週期</Label>
                      <Input value={vwapRsiPeriod} onChange={e => setVwapRsiPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">RSI 超賣</Label>
                      <Input value={vwapOversold} onChange={e => setVwapOversold(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">RSI 超買</Label>
                      <Input value={vwapOverbought} onChange={e => setVwapOverbought(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">每筆金額 (USDT)</Label>
                  <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                </div>
              </>
            )}

            {type === 'macd_bb_squeeze' && (
              <>
                <p className="text-xs text-zinc-500">BB 擠壓突破 + MACD 翻正 + RSI 過濾，ATR 止損/止盈 R:R 2:1</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">MACD 快線</Label>
                    <Input value={macdFast} onChange={e => setMacdFast(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">MACD 慢線</Label>
                    <Input value={macdSlow} onChange={e => setMacdSlow(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">訊號線</Label>
                    <Input value={macdSignalP} onChange={e => setMacdSignalP(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">BB 週期</Label>
                    <Input value={squeezeBbPeriod} onChange={e => setSqueezeBbPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">RSI 週期</Label>
                    <Input value={squeezeRsiPeriod} onChange={e => setSqueezeRsiPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">ATR 週期</Label>
                    <Input value={squeezeAtrPeriod} onChange={e => setSqueezeAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">每筆金額 (USDT)</Label>
                    <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">EMA200 過濾</Label>
                    <Select value={squeezeEma200} onValueChange={setSqueezeEma200}>
                      <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        <SelectItem value="true">開啟</SelectItem>
                        <SelectItem value="false">關閉</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">止損 ATR 倍數</Label>
                    <Input value={squeezeAtrSl} onChange={e => setSqueezeAtrSl(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">止盈 ATR 倍數</Label>
                    <Input value={squeezeAtrTp} onChange={e => setSqueezeAtrTp(e.target.value)} className="bg-zinc-800 border-zinc-700 text-sm" />
                  </div>
                </div>
              </>
            )}
          </div>}

          <Button
            onClick={run}
            disabled={running}
            className="w-full bg-yellow-500 text-zinc-900 hover:bg-yellow-400 font-semibold"
          >
            {running ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-zinc-900 border-t-transparent rounded-full animate-spin" />
                回測中…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <FlaskConical className="w-4 h-4" />
                開始回測
              </span>
            )}
          </Button>

          {(type === 'vwap_bb_rsi' || type === 'adaptive_combo') && (
            <Button
              onClick={runYearlyBacktest}
              disabled={yearRunning}
              variant="outline"
              className="w-full border-blue-600/50 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 font-semibold"
            >
              {yearRunning ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  各年度回測中（2022–2026 Q1）…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" />
                  各年度回測 2022–2026 Q1 ▶
                </span>
              )}
            </Button>
          )}
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {result ? (
            <>
              {/* Stats grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  {
                    label: '總回報率',
                    value: `${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn.toFixed(2)}%`,
                    icon: result.totalReturn >= 0 ? TrendingUp : TrendingDown,
                    color: result.totalReturn >= 0 ? 'text-green-400' : 'text-red-400',
                  },
                  {
                    label: '最大回撤',
                    value: `-${result.maxDrawdown.toFixed(2)}%`,
                    icon: TrendingDown,
                    color: 'text-red-400',
                  },
                  {
                    label: '勝率',
                    value: `${result.winRate.toFixed(1)}%`,
                    icon: Percent,
                    color: result.winRate >= 50 ? 'text-green-400' : 'text-amber-400',
                  },
                  {
                    label: '夏普比率',
                    value: result.sharpeRatio.toFixed(2),
                    icon: BarChart2,
                    color: result.sharpeRatio >= 1 ? 'text-green-400' : 'text-zinc-400',
                    info: '每承擔 1 單位風險所獲得的超額報酬。\n≥ 2 優秀　≥ 1 良好　< 0 虧損\n數值越高代表風險調整後報酬越佳。',
                  },
                ].map(({ label, value, icon: Icon, color, info }: { label: string; value: string; icon: React.ElementType; color: string; info?: string }) => (
                  <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-zinc-500">{label}</span>
                        {info && (
                          <div className="relative group">
                            <Info className="w-3 h-3 text-zinc-600 cursor-help" />
                            <div className="absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover:block w-48 bg-zinc-800 border border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-300 leading-relaxed shadow-xl whitespace-pre-line">
                              {info}
                            </div>
                          </div>
                        )}
                      </div>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                    <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                {[
                  ['初始資金', `$${result.initialCapital.toLocaleString()}`],
                  ['最終資金', `$${result.finalCapital.toFixed(2)}`],
                  ['總交易次數', `${result.totalTrades} 次`],
                  ['盈利次數', `${result.winTrades} 次`],
                  ['虧損次數', `${result.lossTrades} 次`],
                  ['淨損益', `${result.finalCapital - result.initialCapital >= 0 ? '+' : ''}$${(result.finalCapital - result.initialCapital).toFixed(2)}`],
                ].map(([label, value]) => (
                  <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                    <p className="text-xs text-zinc-500">{label}</p>
                    <p className="font-semibold mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* Equity curve */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800">
                  <p className="text-sm font-medium">資金曲線</p>
                </div>
                <div ref={equityRef} />
              </div>

              {/* Trade list */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <p className="text-sm font-medium">交易記錄</p>
                  <span className="text-xs text-zinc-500">{result.trades.length} 筆（最近 50）</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                        <th className="text-left px-4 py-2">時間</th>
                        <th className="text-left px-4 py-2">方向</th>
                        <th className="text-right px-4 py-2">價格</th>
                        <th className="text-right px-4 py-2">數量</th>
                        <th className="text-right px-4 py-2">損益</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(-50).reverse().map((t: TradeRecord, i: number) => (
                        <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-2 text-zinc-400 font-mono text-xs">
                            {new Date(t.time * 1000).toLocaleString('zh-TW')}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${t.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                              {t.side === 'buy' ? '買入' : '賣出'}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-mono">${t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="px-4 py-2 text-right font-mono text-zinc-400">{t.quantity.toFixed(6)}</td>
                          <td className={`px-4 py-2 text-right font-mono ${t.pnl == null ? 'text-zinc-600' : t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {t.pnl == null ? '—' : `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-80 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <FlaskConical className="w-12 h-12 mb-4" />
              <p className="text-lg font-medium">尚無回測結果</p>
              <p className="text-sm mt-1">設定參數後點擊「開始回測」</p>
              <div ref={equityRef} className="hidden" />
            </div>
          )}

          {/* Year-by-year results matrix */}
          {yearResults.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
                <p className="text-sm font-medium">
                  各年度回測 — {type === 'adaptive_combo' ? '自適應組合' : 'Crypto Pulse'} 4h（含手續費 0.1%/單邊）
                </p>
                <span className="text-xs text-zinc-500">報酬率 / 勝率 / 交易次數</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                      <th className="text-left px-4 py-2.5">年份</th>
                      {['BTC', 'ETH', 'SOL', 'BNB'].map(s => (
                        <th key={s} className="text-center px-3 py-2.5">{s}</th>
                      ))}
                      <th className="text-center px-3 py-2.5 text-zinc-400">平均</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { year: 2021, label: '2021 🐂' },
                      { year: 2022, label: '2022 🐻' },
                      { year: 2023, label: '2023 🐂' },
                      { year: 2024, label: '2024 🐂' },
                      { year: 2025, label: '2025 🐂' },
                      { year: 2026, label: '2026 Q1' },
                    ].map(({ year, label }) => {
                      const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
                      const rows = syms.map(sym => yearResults.find(x => x.year === year && x.symbol === sym))
                      const validRows = rows.filter(r => r && !r.error) as typeof rows[0][]
                      const avg = validRows.length > 0
                        ? validRows.reduce((s, r) => s + r!.totalReturn, 0) / validRows.length
                        : null
                      return (
                        <tr key={year} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-3 font-medium text-zinc-300 text-xs whitespace-nowrap">
                            {label}
                          </td>
                          {syms.map(sym => {
                            const r = yearResults.find(x => x.year === year && x.symbol === sym)
                            if (!r) return <td key={sym} className="px-3 py-3 text-center text-zinc-600">—</td>
                            if (r.error) return <td key={sym} className="px-3 py-3 text-center text-red-500 text-xs">err</td>
                            const retColor = r.totalReturn > 5 ? 'text-green-400' : r.totalReturn > 0 ? 'text-green-300' : r.totalReturn > -5 ? 'text-amber-400' : 'text-red-400'
                            return (
                              <td key={sym} className="px-3 py-3 text-center">
                                <div className={`font-mono font-bold text-sm ${retColor}`}>
                                  {r.totalReturn >= 0 ? '+' : ''}{r.totalReturn.toFixed(1)}%
                                </div>
                                <div className="text-xs text-zinc-500 mt-0.5">
                                  WR {r.winRate.toFixed(0)}% · {r.totalTrades}筆
                                </div>
                                <div className="text-xs text-zinc-600">
                                  MDD -{r.maxDrawdown.toFixed(1)}%
                                </div>
                              </td>
                            )
                          })}
                          <td className="px-3 py-3 text-center">
                            {avg !== null ? (
                              <div className={`font-mono font-bold text-sm ${avg > 5 ? 'text-green-400' : avg > 0 ? 'text-green-300' : avg > -5 ? 'text-amber-400' : 'text-red-400'}`}>
                                {avg >= 0 ? '+' : ''}{avg.toFixed(1)}%
                              </div>
                            ) : <span className="text-zinc-600">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
