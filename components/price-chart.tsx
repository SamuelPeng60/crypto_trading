'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart, CandlestickSeries, LineSeries, createSeriesMarkers,
  IChartApi, ISeriesApi, CandlestickData, Time, LineStyle,
} from 'lightweight-charts'
import { Interval } from '@/lib/binance'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d']

// Local timezone offset in seconds (positive = east of UTC, e.g. UTC+8 → 28800)
const TZ_OFFSET_S = -new Date().getTimezoneOffset() * 60

const INTERVAL_SECONDS: Record<Interval, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400,
}

const STRATEGY_LABELS: Record<string, string> = {
  vwap_bb_rsi:     'Crypto Pulse',
  ma_cross:        'MA 交叉',
  rsi:             'RSI 策略',
  grid:            '網格交易',
  supertrend:      'SuperTrend',
  ema_ribbon_st:   'EMA Ribbon',
  macd_bb_squeeze: 'MACD Squeeze',
}

// ─── start time per interval ─────────────────────────────────────────────────
function getStartTime(iv: Interval): number {
  const now = Date.now()
  switch (iv) {
    case '1m':  return now - 350 *  1 * 60 * 1000   // 350 min
    case '5m':  return now - 350 *  5 * 60 * 1000   // ~29 hours
    case '15m': return now - 350 * 15 * 60 * 1000   // ~87 hours
    case '1h':  return now - 30  * 24 * 60 * 60 * 1000           // 1 month
    case '4h':  return now - 90  * 24 * 60 * 60 * 1000           // 3 months
    case '1d':  return now - 730 * 24 * 60 * 60 * 1000           // 2 years
    default:    return now - 7   * 24 * 60 * 60 * 1000
  }
}

// ─── inline indicator math ────────────────────────────────────────────────────
function calcEma(data: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const out: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { out.push(NaN); continue }
    if (i === period - 1) { out.push(data.slice(0, period).reduce((a, b) => a + b, 0) / period); continue }
    out.push(data[i] * k + out[i - 1] * (1 - k))
  }
  return out
}

function calcBb(data: number[], period = 20, mult = 2) {
  const mid: number[] = [], upper: number[] = [], lower: number[] = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { mid.push(NaN); upper.push(NaN); lower.push(NaN); continue }
    const slice = data.slice(i - period + 1, i + 1)
    const avg = slice.reduce((a, b) => a + b, 0) / period
    const std = Math.sqrt(slice.reduce((s, v) => s + (v - avg) ** 2, 0) / period)
    mid.push(avg); upper.push(avg + mult * std); lower.push(avg - mult * std)
  }
  return { mid, upper, lower }
}

// ─── interfaces ───────────────────────────────────────────────────────────────
interface Order {
  id: number; symbol: string; side: 'buy' | 'sell'
  filled_price: number | null; created_at: string; status: string
}
interface CondItem { label: string; threshold: string; current: string; met: boolean }
interface IndicatorData {
  price: number; signal: 'buy' | 'sell' | 'hold'
  conditions: CondItem[]; vwapLevel?: number
}
interface Props {
  symbol: string; symbols?: string[]; onSymbolChange?: (sym: string) => void
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function fmtPrice(n: number): string {
  if (!n || isNaN(n)) return '–'
  if (n >= 10000) return n.toFixed(0)
  if (n >= 1000) return n.toFixed(1)
  if (n >= 100) return n.toFixed(2)
  return n.toFixed(3)
}
function CondBadge({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold ml-1 shrink-0 ${ok ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-500'}`}>
      {ok ? '✓' : '✗'}
    </span>
  )
}

// ─── component ────────────────────────────────────────────────────────────────
export default function PriceChart({ symbol, symbols, onSymbolChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priceLineRefs = useRef<any[]>([])

  // overlay series refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ema7Ref  = useRef<ISeriesApi<any> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ema30Ref = useRef<ISeriesApi<any> | null>(null)
  const bbRef    = useRef<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upper: ISeriesApi<any>; mid: ISeriesApi<any>; lower: ISeriesApi<any>
  } | null>(null)

  // kline data cache for overlay recalculation
  const closesRef = useRef<number[]>([])
  const timesRef  = useRef<number[]>([])
  const [klinesVersion, setKlinesVersion] = useState(0)

  const [interval, setInterval] = useState<Interval>('1h')
  const [loading, setLoading] = useState(false)
  const [hoveredBar, setHoveredBar] = useState<{
    open: number; high: number; low: number; close: number
    ema7?: number; ema30?: number
    bbUpper?: number; bbMid?: number; bbLower?: number
  } | null>(null)
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null)
  const [indicatorData, setIndicatorData] = useState<IndicatorData | null>(null)
  const [hasPosition, setHasPosition] = useState(false)
  const strategyRef = useRef(selectedStrategy)

  // overlay toggles
  const [showEma7,  setShowEma7]  = useState(false)
  const [showEma30, setShowEma30] = useState(false)
  const [showBb,    setShowBb]    = useState(false)

  // ── markers ────────────────────────────────────────────────────────────────
  const loadMarkers = useCallback(async (sym: string, iv: Interval, strategy: string | null) => {
    if (!seriesRef.current) return
    if (!strategy) {
      if (markersRef.current) markersRef.current.setMarkers([])
      return
    }
    try {
      const res = await fetch(`/api/orders?symbol=${sym}&limit=500&strategyType=${strategy}`)
      if (!res.ok) return
      const orders: Order[] = await res.json()
      const sec = INTERVAL_SECONDS[iv]

      // Sort by actual execution time first, then assign sequential B/S numbers
      const sorted = orders
        .filter(o => o.filled_price && o.status !== 'pending')
        .sort((a, b) =>
          new Date(a.created_at.replace(' ', 'T') + 'Z').getTime() -
          new Date(b.created_at.replace(' ', 'T') + 'Z').getTime()
        )

      let buyCount = 0, sellCount = 0
      const raw = sorted.map(o => {
        const ts      = Math.floor(new Date(o.created_at.replace(' ', 'T') + 'Z').getTime() / 1000)
        const floored = Math.floor(ts / sec) * sec + TZ_OFFSET_S
        const price   = o.filled_price!
        const label   = price >= 1000 ? `$${Math.round(price)}` : `$${price.toFixed(2)}`
        const num     = o.side === 'buy' ? ++buyCount : ++sellCount
        return {
          baseTime: floored,
          position: o.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
          color:    o.side === 'buy' ? '#22c55e' : '#ef4444',
          shape:    o.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
          text:     o.side === 'buy' ? `B${num} ${label}` : `S${num} ${label}`,
        }
      })

      // Offset markers that land on the same bar so labels don't overlap
      const usedTimes = new Map<number, number>()
      const markers = raw.map(m => {
        const slot  = usedTimes.get(m.baseTime) ?? 0
        usedTimes.set(m.baseTime, slot + 1)
        return {
          time:     (m.baseTime + slot * sec) as Time,
          position: m.position,
          color:    m.color,
          shape:    m.shape,
          text:     m.text,
        }
      })

      if (markersRef.current) markersRef.current.setMarkers(markers)
      else if (seriesRef.current) markersRef.current = createSeriesMarkers(seriesRef.current, markers)
    } catch {}
  }, [])

  // ── klines ─────────────────────────────────────────────────────────────────
  const loadData = useCallback(async (sym: string, iv: Interval) => {
    setLoading(true)
    let total = 0
    try {
      const startTime = getStartTime(iv)
      const res  = await fetch(`/api/klines?symbol=${sym}&interval=${iv}&limit=1000&startTime=${startTime}`)
      const data = await res.json()
      if (seriesRef.current && Array.isArray(data)) {
        seriesRef.current.setData(
          data.map((k: { time: number; open: number; high: number; low: number; close: number }) => ({
            time: (k.time + TZ_OFFSET_S) as Time, open: k.open, high: k.high, low: k.low, close: k.close,
          } as CandlestickData))
        )
        total = data.length
        closesRef.current = data.map((k: { close: number }) => k.close)
        timesRef.current  = data.map((k: { time: number }) => k.time + TZ_OFFSET_S)
        setKlinesVersion(v => v + 1)
      }
    } finally { setLoading(false) }
    await loadMarkers(sym, iv, strategyRef.current)
    // Scroll to latest after markers are set (markers can reset the view)
    if (chartRef.current && total > 0) {
      chartRef.current.timeScale().setVisibleLogicalRange({
        from: Math.max(0, total - 300),
        to: total - 1,
      })
    }
  }, [loadMarkers])

  // ── positions / indicators ─────────────────────────────────────────────────
  const loadPosition = useCallback(async (sym: string) => {
    try {
      const res = await fetch('/api/positions')
      if (!res.ok) return
      const rows: { symbol: string }[] = await res.json()
      setHasPosition(rows.some(p => p.symbol === sym))
    } catch {}
  }, [])

  const loadIndicators = useCallback(async (sym: string, iv: Interval, strategy: string, inPos: boolean) => {
    try {
      const res = await fetch(`/api/indicators?symbol=${sym}&interval=${iv}&strategy=${strategy}&inPosition=${inPos}`)
      if (!res.ok) return
      setIndicatorData(await res.json())
    } catch {}
  }, [])

  // ── VWAP price line ────────────────────────────────────────────────────────
  useEffect(() => {
    priceLineRefs.current.forEach(l => { try { seriesRef.current?.removePriceLine(l) } catch {} })
    priceLineRefs.current = []
    if (!indicatorData?.vwapLevel || !seriesRef.current || !selectedStrategy) return
    const line = seriesRef.current.createPriceLine({
      price: indicatorData.vwapLevel, color: '#facc15', lineWidth: 1,
      lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'VWAP',
    })
    priceLineRefs.current.push(line)
  }, [indicatorData, selectedStrategy])

  // ── EMA7 overlay ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return
    if (showEma7) {
      if (!ema7Ref.current)
        ema7Ref.current = chartRef.current.addSeries(LineSeries, {
          color: '#22d3ee', lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, title: 'EMA7',
        })
      const vals = calcEma(closesRef.current, 7)
      ema7Ref.current.setData(
        timesRef.current.map((t, i) => ({ time: t as Time, value: vals[i] })).filter(d => !isNaN(d.value))
      )
    } else if (ema7Ref.current) {
      chartRef.current.removeSeries(ema7Ref.current)
      ema7Ref.current = null
    }
  }, [showEma7, klinesVersion])

  // ── EMA30 overlay ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return
    if (showEma30) {
      if (!ema30Ref.current)
        ema30Ref.current = chartRef.current.addSeries(LineSeries, {
          color: '#f97316', lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, title: 'EMA30',
        })
      const vals = calcEma(closesRef.current, 30)
      ema30Ref.current.setData(
        timesRef.current.map((t, i) => ({ time: t as Time, value: vals[i] })).filter(d => !isNaN(d.value))
      )
    } else if (ema30Ref.current) {
      chartRef.current.removeSeries(ema30Ref.current)
      ema30Ref.current = null
    }
  }, [showEma30, klinesVersion])

  // ── BB overlay ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return
    if (showBb) {
      if (!bbRef.current) {
        const opts = { color: '#a855f7', lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false }
        bbRef.current = {
          upper: chartRef.current.addSeries(LineSeries, { ...opts, lineStyle: LineStyle.Dashed, title: 'BB上' }),
          mid:   chartRef.current.addSeries(LineSeries, { ...opts, lineStyle: LineStyle.Solid,  title: 'BB中' }),
          lower: chartRef.current.addSeries(LineSeries, { ...opts, lineStyle: LineStyle.Dashed, title: 'BB下' }),
        }
      }
      const { upper, mid, lower } = calcBb(closesRef.current, 20, 2)
      const toData = (vals: number[]) =>
        timesRef.current.map((t, i) => ({ time: t as Time, value: vals[i] })).filter(d => !isNaN(d.value))
      bbRef.current.upper.setData(toData(upper))
      bbRef.current.mid.setData(toData(mid))
      bbRef.current.lower.setData(toData(lower))
    } else if (bbRef.current && chartRef.current) {
      chartRef.current.removeSeries(bbRef.current.upper)
      chartRef.current.removeSeries(bbRef.current.mid)
      chartRef.current.removeSeries(bbRef.current.lower)
      bbRef.current = null
    }
  }, [showBb, klinesVersion])

  // ── chart init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#09090b' }, textColor: '#a1a1aa' },
      grid:   { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: true, fixLeftEdge: true },
      width: containerRef.current.clientWidth,
      height: 400,
    })
    chartRef.current = chart
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    seriesRef.current = series

    // Block scrolling past the first bar
    const blockLeft = (range: { from: number; to: number } | null) => {
      if (range && range.from < 0) {
        chart.timeScale().setVisibleLogicalRange({ from: 0, to: range.to })
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(blockLeft)

    let isDisposed = false
    const crosshairHandler = (param: Parameters<Parameters<typeof chart.subscribeCrosshairMove>[0]>[0]) => {
      if (isDisposed) return
      if (!param.point || !param.seriesData.size) { setHoveredBar(null); return }
      const d = param.seriesData.get(series) as CandlestickData | undefined
      if (!d) { setHoveredBar(null); return }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lineVal = (s: ISeriesApi<any> | null | undefined) =>
        s ? (param.seriesData.get(s) as { value: number } | undefined)?.value : undefined
      setHoveredBar({
        open: d.open, high: d.high, low: d.low, close: d.close,
        ema7:    lineVal(ema7Ref.current),
        ema30:   lineVal(ema30Ref.current),
        bbUpper: lineVal(bbRef.current?.upper),
        bbMid:   lineVal(bbRef.current?.mid),
        bbLower: lineVal(bbRef.current?.lower),
      })
    }
    chart.subscribeCrosshairMove(crosshairHandler)

    const ro = new ResizeObserver(() => {
      if (isDisposed || !containerRef.current) return
      chart.resize(containerRef.current.clientWidth, 400)
    })
    ro.observe(containerRef.current)
    return () => {
      isDisposed = true
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(blockLeft)
      chart.unsubscribeCrosshairMove(crosshairHandler)
      ema7Ref.current = null; ema30Ref.current = null; bbRef.current = null
      priceLineRefs.current = []; markersRef.current = null
      ro.disconnect(); chart.remove()
    }
  }, [])

  // ── data loading effects ───────────────────────────────────────────────────
  // Read localStorage after mount to avoid SSR/client hydration mismatch
  useEffect(() => {
    const saved = localStorage.getItem('dashboard_strategy')
    if (saved) setSelectedStrategy(saved)
  }, [])

  useEffect(() => { strategyRef.current = selectedStrategy }, [selectedStrategy])

  useEffect(() => {
    loadData(symbol, interval)
    loadPosition(symbol)
  }, [symbol, interval, loadData, loadPosition])

  useEffect(() => {
    loadMarkers(symbol, interval, selectedStrategy)
  }, [selectedStrategy, symbol, interval, loadMarkers])

  useEffect(() => {
    if (!selectedStrategy) { setIndicatorData(null); return }
    loadIndicators(symbol, interval, selectedStrategy, hasPosition)
  }, [selectedStrategy, symbol, interval, hasPosition, loadIndicators])

  // ── WebSocket live tick ────────────────────────────────────────────────────
  useEffect(() => {
    const sym = symbol.toLowerCase()
    const ws  = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@kline_${interval}`)
    ws.onmessage = (e) => {
      const { k } = JSON.parse(e.data)
      if (!seriesRef.current) return
      seriesRef.current.update({
        time: (Math.floor(k.t / 1000) + TZ_OFFSET_S) as Time,
        open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c),
      })
    }
    return () => ws.close()
  }, [symbol, interval])

  const ind = indicatorData

  const overlays = [
    { key: 'ema7',  label: 'EMA7',  color: '#22d3ee', active: showEma7,  toggle: () => setShowEma7(v => !v)  },
    { key: 'ema30', label: 'EMA30', color: '#f97316', active: showEma30, toggle: () => setShowEma30(v => !v) },
    { key: 'bb',    label: 'BB',    color: '#a855f7', active: showBb,    toggle: () => setShowBb(v => !v)    },
  ]

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 gap-4">
        {/* Left: title + strategy selector + conditions */}
        <div className="flex items-center gap-3 min-w-0 flex-1 overflow-x-auto">
          <span className="text-base font-bold shrink-0">K線圖</span>

          <Select
            value={selectedStrategy ?? '__none__'}
            onValueChange={v => {
              const s = v === '__none__' ? null : v
              strategyRef.current = s
              setSelectedStrategy(s)
              if (s) localStorage.setItem('dashboard_strategy', s)
              else localStorage.removeItem('dashboard_strategy')
              loadMarkers(symbol, interval, s)
            }}
          >
            <SelectTrigger className="bg-zinc-800 border-zinc-700 h-7 text-xs w-36 shrink-0">
              <SelectValue placeholder="選策略" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              <SelectItem value="__none__">不選策略</SelectItem>
              {Object.entries(STRATEGY_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {ind && selectedStrategy && (
            <div className="flex items-center gap-3 text-[11px] text-zinc-400">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${hasPosition ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                {hasPosition ? '賣出條件' : '買入條件'}
              </span>
              {ind.conditions.map((cond, i) => (
                <div key={i} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <span className="text-zinc-700 mr-2">|</span>}
                  <span className="text-zinc-500">{cond.label}</span>
                  <span className="text-zinc-600">{cond.threshold}</span>
                  <span className="text-zinc-300">{cond.current}</span>
                  <CondBadge ok={cond.met} />
                </div>
              ))}
              {ind.signal !== 'hold' && (
                <>
                  <span className="text-zinc-700">|</span>
                  <span className={`font-bold shrink-0 ${ind.signal === 'buy' ? 'text-green-400' : 'text-red-400'}`}>
                    {ind.signal === 'buy' ? '▲ 買入訊號' : '▼ 賣出訊號'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Right: symbol selector + interval buttons */}
        <div className="flex items-center gap-4 shrink-0">
          {symbols && onSymbolChange && (
            <Select value={symbol} onValueChange={onSymbolChange}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 h-7 text-sm font-medium w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {symbols.map(s => (
                  <SelectItem key={s} value={s}>{s.replace('USDT', '/USDT')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-1">
            {INTERVALS.map((iv) => (
              <button key={iv} onClick={() => setInterval(iv)}
                className={`px-2 py-1 text-xs rounded transition-colors ${interval === iv ? 'bg-yellow-500 text-zinc-900 font-bold' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}>
                {iv}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/70 z-10">
            <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* OHLC + indicator tooltip — top left */}
        {hoveredBar && (
          <div className="absolute top-2 left-2 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-2 py-1.5 text-[11px] font-mono pointer-events-none flex flex-col gap-1">
            {/* OHLC row */}
            <div className="flex gap-3">
              <span className="text-zinc-500">H <span className="text-zinc-200">${fmtPrice(hoveredBar.high)}</span></span>
              <span className="text-zinc-500">L <span className="text-zinc-200">${fmtPrice(hoveredBar.low)}</span></span>
              <span className="text-zinc-500">C <span className={hoveredBar.close >= hoveredBar.open ? 'text-green-400' : 'text-red-400'}>${fmtPrice(hoveredBar.close)}</span></span>
            </div>
            {/* Indicator row — only when at least one is active */}
            {(hoveredBar.ema7 !== undefined || hoveredBar.ema30 !== undefined || hoveredBar.bbUpper !== undefined) && (
              <div className="flex gap-3 border-t border-zinc-700/50 pt-1">
                {hoveredBar.ema7 !== undefined && (
                  <span style={{ color: '#22d3ee' }}>EMA7 ${fmtPrice(hoveredBar.ema7)}</span>
                )}
                {hoveredBar.ema30 !== undefined && (
                  <span style={{ color: '#f97316' }}>EMA30 ${fmtPrice(hoveredBar.ema30)}</span>
                )}
                {hoveredBar.bbUpper !== undefined && (
                  <span style={{ color: '#a855f7' }}>
                    BB↑{fmtPrice(hoveredBar.bbUpper)} / {fmtPrice(hoveredBar.bbMid!)} / ↓{fmtPrice(hoveredBar.bbLower!)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Overlay toggles — top right */}
        <div className="absolute top-2 right-24 z-10 flex gap-1.5">
          {overlays.map(({ key, label, color, active, toggle }) => (
            <button key={key} onClick={toggle}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all border ${
                active
                  ? 'bg-zinc-800 border-zinc-600 text-white'
                  : 'bg-zinc-900/80 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              }`}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: active ? color : '#52525b' }} />
              {label}
            </button>
          ))}
        </div>

        <div ref={containerRef} />
      </div>
    </div>
  )
}
