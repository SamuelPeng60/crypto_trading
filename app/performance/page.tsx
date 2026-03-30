'use client'
import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, TrendingUp, Trophy, ChevronDown, ChevronUp, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import EquityChart from '@/components/equity-chart'

interface EquityPoint { time: number; value: number }

interface DailyRow { date: string; symbol: string; pnl: number; trades: number; win_trades: number }
interface SymbolRow { symbol: string; pnl: number; trades: number; win_trades: number; worst_trade: number; best_trade: number }

interface StratStat {
  id: number
  name: string
  type: string
  symbol: string
  totalPnl: number
  todayPnl: number
  totalTrades: number
  winTrades: number
  winRate: number
  maxDrawdown: number
  sharpeRatio: number
  avgWin: number
  avgLoss: number
  profitFactor: number
  bestTrade: number
  worstTrade: number
  equity: EquityPoint[]
}

interface Overall {
  totalPnl: number
  todayPnl: number
  totalTrades: number
  winTrades: number
  winRate: number
  openPositions: number
  unrealizedPnl: number
}

interface BacktestRow {
  id: number
  strategy_name: string | null
  strategy_type: string | null
  symbol: string
  interval: string
  start_date: string
  end_date: string
  initial_capital: number
  final_capital: number
  total_return: number
  max_drawdown: number
  win_rate: number
  total_trades: number
  sharpe_ratio: number | null
  created_at: string
}

interface TradeRow {
  id: number
  symbol: string
  side: string
  filled_price: number | null
  quantity: number
  pnl: number | null
  closed_at: string | null
  created_at: string
  strategy_name: string | null
}

interface StatsData {
  overall: Overall
  equity: EquityPoint[]
  strategies: StratStat[]
  backtestHistory: BacktestRow[]
  dailyBreakdown: DailyRow[]
  symbolBreakdown: SymbolRow[]
}

const TYPE_LABEL: Record<string, string> = {
  ma_cross:        'MA 交叉',
  rsi:             'RSI',
  grid:            '網格',
  supertrend:      'SuperTrend',
  vwap_bb_rsi:     'Crypto Pulse',
  ema_ribbon_st:   'EMA Ribbon',
  macd_bb_squeeze: 'MACD Squeeze',
}

const CHART_COLORS = ['#eab308', '#3b82f6', '#a855f7', '#10b981', '#f97316', '#ec4899']

function pnlColor(v: number) { return v >= 0 ? 'text-green-400' : 'text-red-400' }
function pnlSign(v: number)  { return v >= 0 ? '+' : '' }
function fmt(v: number)      { return `${pnlSign(v)}$${Math.abs(v).toFixed(2)}` }

export default function PerformancePage() {
  const [data, setData]               = useState<StatsData | null>(null)
  const [loading, setLoading]         = useState(false)
  const [expandedId, setExpandedId]   = useState<number | null>(null)
  const [tab, setTab]                 = useState<'strategies' | 'daily' | 'symbol' | 'backtest'>('strategies')
  const [trades, setTrades]           = useState<TradeRow[]>([])
  const [tradesLoading, setTradesLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/stats')
    if (res.ok) setData(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const loadTrades = useCallback(async (strategyId: number) => {
    setTradesLoading(true)
    setTrades([])
    const res = await fetch(`/api/orders?strategyId=${strategyId}&side=sell&limit=50`)
    if (res.ok) setTrades(await res.json())
    setTradesLoading(false)
  }, [])

  const toggleExpand = (id: number) => {
    if (expandedId === id) {
      setExpandedId(null)
    } else {
      setExpandedId(id)
      loadTrades(id)
    }
  }

  const overall = data?.overall

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">績效分析</h1>
          <p className="text-zinc-500 text-sm mt-1">模擬交易累積績效與策略比較</p>
        </div>
        <button onClick={load} className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: '累積損益',   value: overall ? fmt(overall.totalPnl)       : '—', color: overall ? pnlColor(overall.totalPnl)       : '' },
          { label: '今日損益',   value: overall ? fmt(overall.todayPnl)        : '—', color: overall ? pnlColor(overall.todayPnl)        : '' },
          { label: '整體勝率',   value: overall ? `${overall.winRate}%`        : '—', color: 'text-zinc-100' },
          { label: '浮動盈虧',   value: overall ? fmt(overall.unrealizedPnl)   : '—', color: overall ? pnlColor(overall.unrealizedPnl)   : '' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        {[
          ['總交易次數', overall?.totalTrades ?? '—'],
          ['獲利次數',   overall?.winTrades   ?? '—'],
          ['持倉數',     overall?.openPositions ?? '—'],
        ].map(([label, value]) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className="text-lg font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Overall equity curve */}
      {data?.equity && data.equity.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
          <h2 className="font-semibold text-sm mb-4 text-zinc-300">累積資金曲線（所有策略合計）</h2>
          <EquityChart data={data.equity} height={220} color="#eab308" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1 w-fit flex-wrap">
        {([['strategies', '策略排行'], ['daily', '每日分析'], ['symbol', '幣種分析'], ['backtest', '回測歷史']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Strategy ranking ─────────────────────────────────────────────── */}
      {tab === 'strategies' && (
        <div className="space-y-3">
          {!data?.strategies.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <Trophy className="w-10 h-10 mb-3" />
              <p className="font-medium">尚無交易記錄</p>
              <p className="text-sm mt-1">啟動策略並觸發引擎後將顯示績效</p>
            </div>
          ) : (
            data.strategies.map((s, idx) => (
              <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                {/* Row */}
                <button
                  className="w-full p-4 flex items-center gap-4 hover:bg-zinc-800/30 transition-colors text-left"
                  onClick={() => toggleExpand(s.id)}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    idx === 0 ? 'bg-yellow-500 text-zinc-900' :
                    idx === 1 ? 'bg-zinc-400 text-zinc-900'  :
                    idx === 2 ? 'bg-amber-700 text-zinc-100' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{TYPE_LABEL[s.type] || s.type}</span>
                      <span className="text-xs text-zinc-500">{s.symbol.replace('USDT', '/USDT')}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>{s.totalTrades} 筆</span>
                      <span>勝率 {s.winRate}%</span>
                      <span>MDD ${s.maxDrawdown.toFixed(2)}</span>
                      <span>Sharpe {s.sharpeRatio.toFixed(2)}</span>
                      <span>PF {s.profitFactor === 999 ? '∞' : s.profitFactor.toFixed(2)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold text-lg ${pnlColor(s.totalPnl)}`}>{fmt(s.totalPnl)}</p>
                    {s.todayPnl !== 0 && (
                      <p className={`text-xs ${pnlColor(s.todayPnl)}`}>今日 {fmt(s.todayPnl)}</p>
                    )}
                  </div>
                  <div className="text-zinc-500 shrink-0">
                    {expandedId === s.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {/* Expanded detail */}
                {expandedId === s.id && (
                  <div className="border-t border-zinc-800 p-4 space-y-5">
                    {/* Metrics grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-sm">
                      {[
                        { label: '累積損益',   value: fmt(s.totalPnl),                              color: pnlColor(s.totalPnl) },
                        { label: '勝率',       value: `${s.winRate}%`,                              color: '' },
                        { label: '最大回撤',   value: `$${s.maxDrawdown.toFixed(2)}`,               color: 'text-red-400' },
                        { label: 'Sharpe',    value: s.sharpeRatio.toFixed(2),                     color: s.sharpeRatio >= 1 ? 'text-green-400' : 'text-zinc-300' },
                        { label: 'Profit Factor', value: s.profitFactor === 999 ? '∞' : s.profitFactor.toFixed(2), color: s.profitFactor >= 1.5 ? 'text-green-400' : 'text-zinc-300' },
                        { label: '平均獲利',   value: `+$${s.avgWin.toFixed(2)}`,                   color: 'text-green-400' },
                        { label: '平均虧損',   value: `$${s.avgLoss.toFixed(2)}`,                   color: 'text-red-400' },
                        { label: '最佳 / 最差', value: `${fmt(s.bestTrade)} / ${fmt(s.worstTrade)}`, color: '' },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-zinc-800/50 rounded-lg p-2.5">
                          <p className="text-zinc-500 text-[10px] mb-1">{label}</p>
                          <p className={`font-bold text-xs ${color}`}>{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Equity chart */}
                    {s.equity.length > 0 ? (
                      <div>
                        <p className="text-xs text-zinc-500 mb-2">資金曲線</p>
                        <EquityChart data={s.equity} height={160} color={CHART_COLORS[idx % CHART_COLORS.length]} />
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600 text-center py-4">尚無足夠資料繪製曲線</p>
                    )}

                    {/* Recent trades */}
                    <div>
                      <p className="text-xs text-zinc-500 mb-2">最近成交（最多 50 筆）</p>
                      {tradesLoading ? (
                        <div className="flex justify-center py-6">
                          <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : trades.length === 0 ? (
                        <p className="text-xs text-zinc-600 text-center py-4">無已結算交易</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-zinc-800">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-zinc-500 bg-zinc-800/50 border-b border-zinc-800">
                                {['#', '時間', '幣種', '出場價', '數量', '損益'].map(h => (
                                  <th key={h} className="text-left px-3 py-2 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {trades.map((t, i) => (
                                <tr key={t.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                                  <td className="px-3 py-2 text-zinc-600">{i + 1}</td>
                                  <td className="px-3 py-2 font-mono text-zinc-400 whitespace-nowrap">
                                    {new Date((t.closed_at ?? t.created_at).replace(' ', 'T') + 'Z').toLocaleString('zh-TW', {
                                      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                                    })}
                                  </td>
                                  <td className="px-3 py-2 text-zinc-300">{t.symbol.replace('USDT', '')}</td>
                                  <td className="px-3 py-2 font-mono text-zinc-300">
                                    ${t.filled_price != null ? (t.filled_price >= 1000 ? Math.round(t.filled_price).toLocaleString() : t.filled_price.toFixed(3)) : '—'}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-zinc-500">{t.quantity.toFixed(4)}</td>
                                  <td className={`px-3 py-2 font-mono font-bold flex items-center gap-0.5 ${(t.pnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {(t.pnl ?? 0) >= 0
                                      ? <ArrowUpRight className="w-3 h-3" />
                                      : <ArrowDownRight className="w-3 h-3" />}
                                    {fmt(t.pnl ?? 0)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Daily breakdown ───────────────────────────────────────────────── */}
      {tab === 'daily' && (
        <>
          {!data?.dailyBreakdown.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <TrendingUp className="w-10 h-10 mb-3" />
              <p className="font-medium">尚無每日記錄</p>
              <p className="text-sm mt-1">模擬盤執行後將顯示每日績效</p>
            </div>
          ) : (() => {
            const byDate: Record<string, DailyRow[]> = {}
            for (const row of data.dailyBreakdown) {
              if (!byDate[row.date]) byDate[row.date] = []
              byDate[row.date].push(row)
            }
            return (
              <div className="space-y-4">
                {Object.entries(byDate).map(([date, rows]) => {
                  const dayPnl    = rows.reduce((s, r) => s + r.pnl, 0)
                  const dayTrades = rows.reduce((s, r) => s + r.trades, 0)
                  const dayWins   = rows.reduce((s, r) => s + r.win_trades, 0)
                  return (
                    <div key={date} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                      <div className={`px-5 py-3 flex items-center justify-between border-b border-zinc-800 ${dayPnl >= 0 ? 'bg-green-500/5' : 'bg-red-500/5'}`}>
                        <div className="flex items-center gap-3">
                          <span className="font-semibold">{date}</span>
                          <span className="text-xs text-zinc-500">{dayTrades} 筆 · 勝率 {dayTrades ? Math.round(dayWins / dayTrades * 100) : 0}%</span>
                        </div>
                        <span className={`font-bold text-lg ${dayPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {fmt(dayPnl)}
                        </span>
                      </div>
                      <div className="divide-y divide-zinc-800/50">
                        {rows.map(r => (
                          <div key={r.symbol} className="px-5 py-2.5 flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="text-zinc-300 w-16">{r.symbol.replace('USDT', '')}</span>
                              <span className="text-xs text-zinc-600">{r.trades} 筆 · {r.trades ? Math.round(r.win_trades / r.trades * 100) : 0}% 勝</span>
                            </div>
                            <span className={`font-mono font-medium ${r.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {fmt(r.pnl)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </>
      )}

      {/* ── Symbol breakdown ─────────────────────────────────────────────── */}
      {tab === 'symbol' && (
        <>
          {!data?.symbolBreakdown.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <TrendingUp className="w-10 h-10 mb-3" />
              <p className="font-medium">尚無幣種記錄</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 border-b border-zinc-800 bg-zinc-800/50">
                      {['幣種', '累積損益', '交易次數', '勝率', '最佳單筆', '最差單筆'].map(h => (
                        <th key={h} className="text-left px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.symbolBreakdown.map(r => (
                      <tr key={r.symbol} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-5 py-3 font-semibold">{r.symbol.replace('USDT', '/USDT')}</td>
                        <td className={`px-5 py-3 font-mono font-bold ${r.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {fmt(r.pnl)}
                        </td>
                        <td className="px-5 py-3 text-zinc-400">{r.trades} 筆</td>
                        <td className="px-5 py-3 font-mono">
                          {r.trades ? Math.round(r.win_trades / r.trades * 100) : 0}%
                        </td>
                        <td className="px-5 py-3 font-mono text-green-400">+${r.best_trade.toFixed(2)}</td>
                        <td className="px-5 py-3 font-mono text-red-400">${r.worst_trade.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Backtest history ─────────────────────────────────────────────── */}
      {tab === 'backtest' && (
        <>
          {!data?.backtestHistory.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-xl">
              <TrendingUp className="w-10 h-10 mb-3" />
              <p className="font-medium">尚無回測記錄</p>
              <p className="text-sm mt-1">前往回測頁執行回測</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 border-b border-zinc-800 bg-zinc-800/50">
                      {['時間', '策略', '幣對', '時框', '初始資金', '報酬率', '最大回撤', '勝率', '交易數', 'Sharpe'].map(h => (
                        <th key={h} className="text-left px-4 py-3 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(data.backtestHistory as BacktestRow[]).map(b => (
                      <tr key={b.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-500 text-xs whitespace-nowrap font-mono">
                          {new Date(b.created_at).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="font-medium">{b.strategy_name || '—'}</span>
                          {b.strategy_type && <span className="ml-1 text-zinc-500">({TYPE_LABEL[b.strategy_type] || b.strategy_type})</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-300">{b.symbol.replace('USDT', '/USDT')}</td>
                        <td className="px-4 py-3 text-xs text-zinc-400">{b.interval}</td>
                        <td className="px-4 py-3 text-xs font-mono">${b.initial_capital.toLocaleString()}</td>
                        <td className={`px-4 py-3 text-xs font-mono font-bold ${b.total_return >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {b.total_return >= 0 ? '+' : ''}{b.total_return.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-xs font-mono text-red-400">{b.max_drawdown.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-xs font-mono">{b.win_rate.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-xs font-mono text-zinc-400">{b.total_trades}</td>
                        <td className={`px-4 py-3 text-xs font-mono ${(b.sharpe_ratio ?? 0) >= 1 ? 'text-green-400' : 'text-zinc-400'}`}>
                          {b.sharpe_ratio?.toFixed(2) ?? '—'}
                        </td>
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
