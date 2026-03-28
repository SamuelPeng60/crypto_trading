'use client'
import { useEffect, useRef } from 'react'
import { createChart, AreaSeries, IChartApi, Time } from 'lightweight-charts'

interface Point { time: number; value: number }

interface Props {
  data: Point[]
  height?: number
  color?: string
}

export default function EquityChart({ data, height = 200, color = '#eab308' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: { background: { color: 'transparent' }, textColor: '#a1a1aa' },
      grid: { vertLines: { color: '#18181b' }, horzLines: { color: '#18181b' } },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: false },
      width: containerRef.current.clientWidth,
      height,
      crosshair: { mode: 1 },
    })
    chartRef.current = chart
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}40`,
      bottomColor: `${color}00`,
      lineWidth: 2,
    })
    if (data.length) {
      series.setData(data.map(d => ({ time: d.time as Time, value: d.value })))
      chart.timeScale().fitContent()
    }
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.resize(containerRef.current.clientWidth, height)
    })
    ro.observe(containerRef.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [data, height, color])

  return <div ref={containerRef} />
}
