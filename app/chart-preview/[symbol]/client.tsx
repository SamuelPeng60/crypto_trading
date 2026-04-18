'use client'
import { useEffect, useRef, useCallback, useState } from 'react'
import { createChart, CandlestickSeries, createSeriesMarkers, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts'

const INTERVAL = '4h'
const INTERVAL_SECONDS = 14400

interface Order {
  side: 'buy' | 'sell'
  filled_price: number | null
  created_at: string
  status: string
}

interface CondItem { label: string; threshold: string; current: string; met: boolean }
interface IndicatorData { price: number; signal: 'buy' | 'sell' | 'hold'; conditions: CondItem[] }

export default function ChartPreviewClient({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<ISeriesApi<any> | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any>(null)
  const [indData, setIndData] = useState<IndicatorData | null>(null)
  const [inPosition, setInPosition] = useState(false)

  const loadAll = useCallback(async () => {
    if (!seriesRef.current || !wrapperRef.current) return

    try {
      // Check if there's an active position for this symbol
      const posRes = await fetch(`/api/positions?symbol=${symbol}`)
      if (posRes.ok) {
        const positions = await posRes.json()
        const hasPos = Array.isArray(positions) && positions.some(
          (p: { symbol: string; quantity: number }) => p.symbol === symbol && p.quantity > 0
        )
        setInPosition(hasPos)

        // Fetch indicator conditions
        const indRes = await fetch(`/api/indicators?symbol=${symbol}&interval=${INTERVAL}&strategy=vwap_bb_rsi&inPosition=${hasPos}`)
        if (indRes.ok) setIndData(await indRes.json())
      }
    } catch { /* non-critical */ }

    try {
      const [klinesRes, ordersRes] = await Promise.all([
        fetch(`/api/klines?symbol=${symbol}&interval=${INTERVAL}&limit=200`),
        fetch(`/api/orders?symbol=${symbol}&limit=500`),
      ])

      if (klinesRes.ok && seriesRef.current) {
        const data = await klinesRes.json()
        if (Array.isArray(data) && seriesRef.current) {
          seriesRef.current.setData(
            data.map((k: { time: number; open: number; high: number; low: number; close: number }) => ({
              time: k.time as Time,
              open: k.open, high: k.high, low: k.low, close: k.close,
            } as CandlestickData))
          )
          chartRef.current?.timeScale().fitContent()
        }
      }

      if (ordersRes.ok && seriesRef.current) {
        const orders: Order[] = await ordersRes.json()
        const markers = orders
          .filter(o => o.filled_price && o.status !== 'pending')
          .map(o => {
            const ts = Math.floor(new Date(o.created_at.replace(' ', 'T') + 'Z').getTime() / 1000)
            const floored = Math.floor(ts / INTERVAL_SECONDS) * INTERVAL_SECONDS
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

        if (markers.length > 0) {
          if (markersRef.current) {
            markersRef.current.setMarkers(markers)
          } else if (seriesRef.current) {
            markersRef.current = createSeriesMarkers(seriesRef.current, markers)
          }
        }
      }
    } catch {
      // fetch errors (e.g. unauthenticated) — still mark as loaded so Puppeteer gets the K-line chart
    }

    // Signal Puppeteer that the chart is ready
    if (wrapperRef.current) {
      wrapperRef.current.setAttribute('data-loaded', 'true')
    }
  }, [symbol])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#09090b' }, textColor: '#a1a1aa' },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: true },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    })
    chartRef.current = chart
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#22c55e', wickDownColor: '#ef4444',
    })
    seriesRef.current = series

    loadAll()

    return () => { markersRef.current = null; seriesRef.current = null; chart.remove() }
  }, [loadAll])

  const signalColor = indData?.signal === 'buy' ? '#22c55e' : indData?.signal === 'sell' ? '#ef4444' : '#71717a'
  const signalText = indData?.signal === 'buy' ? '▲ 買入訊號' : indData?.signal === 'sell' ? '▼ 賣出訊號' : '— 觀望'

  return (
    <div
      ref={wrapperRef}
      id="chart-preview"
      className="bg-zinc-950 flex flex-col"
      style={{ width: '100%', height: '100%' }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900 gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-bold text-zinc-100">{symbol.replace('USDT', '/USDT')}</span>
          <span className="text-xs text-zinc-500">{INTERVAL}</span>
          {indData && (
            <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ color: signalColor, background: `${signalColor}22` }}>
              {signalText}
            </span>
          )}
        </div>

        {indData && (
          <div className="flex items-center gap-1 text-[11px] overflow-hidden">
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded mr-1 shrink-0"
              style={{ background: inPosition ? '#ef444422' : '#22c55e22', color: inPosition ? '#f87171' : '#4ade80' }}
            >
              {inPosition ? '賣出條件' : '買入條件'}
            </span>
            {indData.conditions.map((cond, i) => (
              <span key={i} className="flex items-center gap-1 shrink-0">
                {i > 0 && <span style={{ color: '#3f3f46', margin: '0 4px' }}>|</span>}
                <span style={{ color: '#71717a' }}>{cond.label}</span>
                <span style={{ color: '#52525b' }}>{cond.threshold}</span>
                <span style={{ color: '#d4d4d8' }}>{cond.current}</span>
                <span style={{ color: cond.met ? '#4ade80' : '#f87171', fontWeight: 700 }}>
                  {cond.met ? '✓' : '✗'}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div ref={containerRef} className="flex-1" />
    </div>
  )
}
