'use client'
import { useEffect, useState, useCallback } from 'react'
import TickerCard from '@/components/ticker-card'
import PriceChart from '@/components/price-chart'
import { RefreshCw, Bot, TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import Link from 'next/link'

interface Ticker { symbol: string; price: number; change: number; volume: number }
interface Overall { totalPnl: number; todayPnl: number; totalTrades: number; winRate: number; openPositions: number; unrealizedPnl: number }

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']

export default function DashboardPage() {
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [selected, setSelected] = useState('BTCUSDT')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [overall, setOverall] = useState<Overall | null>(null)
  const [engineStatus, setEngineStatus] = useState<{ activeStrategies: number; openPositions: number } | null>(null)

  const fetchTickers = useCallback(async () => {
    const res = await fetch('/api/tickers')
    if (res.ok) {
      setTickers(await res.json())
      setLastUpdate(new Date())
    }
  }, [])

  const fetchStats = useCallback(async () => {
    const [sRes, eRes] = await Promise.all([fetch('/api/stats'), fetch('/api/engine')])
    if (sRes.ok) { const d = await sRes.json(); setOverall(d.overall) }
    if (eRes.ok) setEngineStatus(await eRes.json())
  }, [])

  useEffect(() => {
    fetchTickers()
    fetchStats()
    const id = setInterval(fetchTickers, 10000)
    return () => clearInterval(id)
  }, [fetchTickers, fetchStats])

  // Live price via WebSocket
  useEffect(() => {
    const streams = SYMBOLS.map(s => `${s.toLowerCase()}@ticker`).join('/')
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`)
    ws.onmessage = (e) => {
      const { data } = JSON.parse(e.data)
      setTickers(prev => prev.map(t =>
        t.symbol === data.s ? { ...t, price: Number(data.c), change: Number(data.P) } : t
      ))
    }
    return () => ws.close()
  }, [])

  const pnlColor = (v: number) => v >= 0 ? 'text-green-400' : 'text-red-400'
  const pnlSign = (v: number) => v >= 0 ? '+' : ''

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">市場總覽</h1>
          <p className="text-zinc-500 text-sm mt-1">
            {lastUpdate ? `更新時間：${lastUpdate.toLocaleTimeString('zh-TW')}` : '載入中…'}
          </p>
        </div>
        <button onClick={() => { fetchTickers(); fetchStats() }} className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors">
          <RefreshCw className="w-4 h-4" />
          刷新
        </button>
      </div>

      {/* Account summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Wallet className="w-3.5 h-3.5 text-zinc-500" />
            <p className="text-xs text-zinc-500">累積損益</p>
          </div>
          <p className={`text-xl font-bold ${overall ? pnlColor(overall.totalPnl) : 'text-zinc-100'}`}>
            {overall ? `${pnlSign(overall.totalPnl)}$${overall.totalPnl.toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            {(overall?.todayPnl ?? 0) >= 0
              ? <TrendingUp className="w-3.5 h-3.5 text-green-500" />
              : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
            <p className="text-xs text-zinc-500">今日損益</p>
          </div>
          <p className={`text-xl font-bold ${overall ? pnlColor(overall.todayPnl) : 'text-zinc-100'}`}>
            {overall ? `${pnlSign(overall.todayPnl)}$${overall.todayPnl.toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Bot className="w-3.5 h-3.5 text-yellow-500" />
            <p className="text-xs text-zinc-500">活躍策略</p>
          </div>
          <p className="text-xl font-bold">{engineStatus?.activeStrategies ?? '—'}</p>
          {(engineStatus?.openPositions ?? 0) > 0 && (
            <p className="text-xs text-zinc-500 mt-1">{engineStatus!.openPositions} 個持倉</p>
          )}
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-2">浮動盈虧</p>
          <p className={`text-xl font-bold ${overall ? pnlColor(overall.unrealizedPnl) : 'text-zinc-100'}`}>
            {overall ? `${pnlSign(overall.unrealizedPnl)}$${overall.unrealizedPnl.toFixed(2)}` : '—'}
          </p>
          {overall && overall.totalTrades > 0 && (
            <p className="text-xs text-zinc-500 mt-1">勝率 {overall.winRate}% · {overall.totalTrades} 筆</p>
          )}
        </div>
      </div>

      {overall && overall.totalTrades > 0 && (
        <div className="flex justify-end">
          <Link href="/performance" className="text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
            查看詳細績效 →
          </Link>
        </div>
      )}

      {/* Tickers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {SYMBOLS.map(sym => {
          const t = tickers.find(t => t.symbol === sym)
          return (
            <TickerCard
              key={sym}
              symbol={sym}
              price={t?.price ?? 0}
              change={t?.change ?? 0}
              volume={t?.volume ?? 0}
              selected={selected === sym}
              onClick={() => setSelected(sym)}
            />
          )
        })}
      </div>

      <PriceChart symbol={selected} symbols={SYMBOLS} onSymbolChange={setSelected} />
    </div>
  )
}
