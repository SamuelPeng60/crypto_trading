'use client'
import { useEffect, useState, useCallback } from 'react'
import { History, RefreshCw, FileText } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface Order {
  id: number; symbol: string; side: string; price: number | null
  filled_price: number | null; quantity: number; pnl: number | null
  status: string; mode: string; strategy_name: string | null; created_at: string
}

interface Log {
  id: number; strategy_id: number; level: string; message: string
  created_at: string; strategy_name: string | null
}

const SYMBOLS = ['ALL', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']

export default function TradesPage() {
  const [tab, setTab] = useState<'orders' | 'logs'>('orders')
  const [orders, setOrders] = useState<Order[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [symbol, setSymbol] = useState('ALL')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ limit: '200' })
    if (symbol !== 'ALL') params.set('symbol', symbol)
    if (date) params.set('date', date)
    const [oRes, lRes] = await Promise.all([
      fetch(`/api/orders?${params}`),
      fetch('/api/logs?limit=100'),
    ])
    if (oRes.ok) setOrders(await oRes.json())
    if (lRes.ok) setLogs(await lRes.json())
    setLoading(false)
  }, [symbol])

  useEffect(() => { load() }, [load, date])

  const totalPnl = orders.reduce((s, o) => s + (o.pnl ?? 0), 0)
  const closedOrders = orders.filter(o => o.pnl != null)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">交易記錄</h1>
          <p className="text-zinc-500 text-sm mt-1">模擬交易歷史與策略日誌</p>
        </div>
        <div className="flex items-center gap-3">
          {tab === 'orders' && (
            <>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700 w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {SYMBOLS.map(s => <SelectItem key={s} value={s}>{s === 'ALL' ? '全部幣種' : s.replace('USDT', '/USDT')}</SelectItem>)}
                </SelectContent>
              </Select>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="h-9 px-3 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              {date && (
                <button onClick={() => setDate('')} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                  清除
                </button>
              )}
            </>
          )}
          <button onClick={load} className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit">
        {([['orders', '交易單', History], ['logs', '執行日誌', FileText]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            {[
              ['總交易', `${orders.length} 筆`],
              ['總損益', `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`],
              ['勝率', closedOrders.length
                ? `${(orders.filter(o => (o.pnl ?? 0) > 0).length / closedOrders.length * 100).toFixed(1)}%`
                : '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="text-xl font-bold mt-1">{value}</p>
              </div>
            ))}
          </div>

          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <History className="w-12 h-12 mb-4" />
              <p className="text-lg font-medium">尚無交易記錄</p>
              <p className="text-sm mt-1">啟動策略後觸發引擎將顯示交易歷史</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 border-b border-zinc-800 bg-zinc-800/50">
                      {['時間', '幣對', '方向', '成交價', '數量', '損益', '模式', '策略'].map(h => (
                        <th key={h} className="text-left px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(o => (
                      <tr key={o.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-400 text-xs font-mono">
                          {new Date(o.created_at).toLocaleString('zh-TW')}
                        </td>
                        <td className="px-4 py-3 font-medium text-xs">{o.symbol.replace('USDT', '/USDT')}</td>
                        <td className="px-4 py-3">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${o.side === 'buy' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                            {o.side === 'buy' ? '買入' : '賣出'}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {o.filled_price ? `$${o.filled_price.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-zinc-400">{o.quantity.toFixed(6)}</td>
                        <td className={`px-4 py-3 font-mono font-medium ${o.pnl == null ? 'text-zinc-600' : o.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {o.pnl == null ? '—' : `${o.pnl >= 0 ? '+' : ''}$${o.pnl.toFixed(2)}`}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-1.5 py-0.5 rounded text-xs ${o.mode === 'live' ? 'bg-green-500/10 text-green-400' : 'bg-zinc-700 text-zinc-400'}`}>
                            {o.mode === 'live' ? '實盤' : '模擬'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-xs">{o.strategy_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'logs' && (
        <>
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <FileText className="w-12 h-12 mb-4" />
              <p className="text-lg font-medium">尚無執行日誌</p>
              <p className="text-sm mt-1">觸發引擎後將顯示策略執行記錄</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 border-b border-zinc-800 bg-zinc-800/50">
                      {['時間', '策略', '等級', '訊息'].map(h => (
                        <th key={h} className="text-left px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map(l => (
                      <tr key={l.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-400 text-xs font-mono whitespace-nowrap">
                          {new Date(l.created_at).toLocaleString('zh-TW')}
                        </td>
                        <td className="px-4 py-3 text-zinc-400 text-xs">{l.strategy_name || `#${l.strategy_id}`}</td>
                        <td className="px-4 py-3">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            l.level === 'error' ? 'bg-red-500/10 text-red-400'
                            : l.level === 'warn' ? 'bg-amber-500/10 text-amber-400'
                            : 'bg-zinc-800 text-zinc-400'
                          }`}>
                            {l.level}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-300 text-xs">{l.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
