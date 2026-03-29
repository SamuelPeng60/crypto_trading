'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, CandlestickSeries, createSeriesMarkers, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts'
import { Interval } from '@/lib/binance'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const INTERVALS: Interval[] = ['1m', '5m', '15m', '1h', '4h', '1d']

const INTERVAL_SECONDS: Record<Interval, number> = {
  '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '1d': 86400,
}

interface Order {
  id: number
  symbol: string
  side: 'buy' | 'sell'
  filled_price: number | null
  created_at: string
  status: string
}

interface Props {
  symbol: string
  symbols?: string[]
  onSymbolChange?: (sym: string) => void
}

export default function PriceChart({ symbol, symbols, onSymbolChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any>(null)
  const [interval, setInterval] = useState<Interval>('1h')
  const [loading, setLoading] = useState(false)

  const loadMarkers = useCallback(async (sym: string, iv: Interval) => {
    if (!seriesRef.current) return
    try {
      const res = await fetch(`/api/orders?symbol=${sym}&limit=500`)
      if (!res.ok) return
      const orders: Order[] = await res.json()
      const secPerInterval = INTERVAL_SECONDS[iv]
      const markers = orders
        .filter(o => o.filled_price && o.status !== 'pending')
        .map(o => {
          const ts = Math.floor(new Date(o.created_at.replace(' ', 'T') + 'Z').getTime() / 1000)
          const floored = Math.floor(ts / secPerInterval) * secPerInterval
          const price = o.filled_price!
          const label = price >= 1000 ? `$${Math.round(price)}` : `$${price.toFixed(2)}`
          return {
            time: floored as Time,
            position: o.side === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
            color: o.side === 'buy' ? '#22c55e' : '#ef4444',
            shape: o.side === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
            text: o.side === 'buy' ? `B ${label}` : `S ${label}`,
          }
        })
        .sort((a, b) => (a.time as number) - (b.time as number))

      if (markersRef.current) {
        markersRef.current.setMarkers(markers)
      } else if (seriesRef.current) {
        markersRef.current = createSeriesMarkers(seriesRef.current, markers)
      }
    } catch {}
  }, [])

  const loadData = useCallback(async (sym: string, iv: Interval) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/klines?symbol=${sym}&interval=${iv}&limit=300`)
      const data = await res.json()
      if (seriesRef.current && Array.isArray(data)) {
        seriesRef.current.setData(
          data.map((k: { time: number; open: number; high: number; low: number; close: number }) => ({
            time: k.time as Time,
            open: k.open,
            high: k.high,
            low: k.low,
            close: k.close,
          } as CandlestickData))
        )
        chartRef.current?.timeScale().fitContent()
      }
    } finally {
      setLoading(false)
    }
    await loadMarkers(sym, iv)
  }, [loadMarkers])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#09090b' }, textColor: '#a1a1aa' },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 400,
    })
    chartRef.current = chart
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, 400)
    })
    ro.observe(containerRef.current)
    return () => {
      markersRef.current = null
      ro.disconnect()
      chart.remove()
    }
  }, [])

  useEffect(() => { loadData(symbol, interval) }, [symbol, interval, loadData])

  // WebSocket live tick
  useEffect(() => {
    const sym = symbol.toLowerCase()
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@kline_${interval}`)
    ws.onmessage = (e) => {
      const { k } = JSON.parse(e.data)
      if (!seriesRef.current) return
      seriesRef.current.update({
        time: Math.floor(k.t / 1000) as Time,
        open: Number(k.o),
        high: Number(k.h),
        low: Number(k.l),
        close: Number(k.c),
      })
    }
    return () => ws.close()
  }, [symbol, interval])

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-base font-bold">K線圖</span>
        <div className="flex items-center gap-4">
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
              <button
                key={iv}
                onClick={() => setInterval(iv)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  interval === iv
                    ? 'bg-yellow-500 text-zinc-900 font-bold'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/70 z-10">
            <div className="w-6 h-6 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        <div ref={containerRef} />
      </div>
    </div>
  )
}
