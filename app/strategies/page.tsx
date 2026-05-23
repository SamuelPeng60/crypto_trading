'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Plus, Play, Pause, Trash2, TrendingUp, Activity, Grid, Zap, BarChart2, RefreshCw, Bot, Clock, Sparkles, Square, X, AlertCircle, Pencil, Check, FileText, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import StrategyDialog from '@/components/strategy-dialog'
import SeedDialog from '@/components/seed-dialog'
import { useAuth } from '@/components/auth-provider'

interface Strategy {
  id: number
  name: string
  type: string
  symbol: string
  params: string
  is_active: number
  session_id: string | null
  created_at: string
  updated_at: string
  mode: string  // 'paper' | 'live'
}

interface Position {
  id: number
  strategy_id: number
  symbol: string
  entry_price: number
  quantity: number
  current_price: number
  unrealized_pnl: number
  strategy_name: string
}

interface EngineStatus {
  activeStrategies: number
  openPositions: number
  lastTick: string | null
  lastMessage: string | null
}

const TYPE_LABEL: Record<string, string> = {
  ma_cross: 'MA 交叉', rsi: 'RSI 超買超賣', grid: '網格交易',
  supertrend: 'SuperTrend', vwap_bb_rsi: 'Crypto Pulse',
  ema_ribbon_st: 'EMA Ribbon + ST', macd_bb_squeeze: 'MACD Squeeze',
  adaptive_combo: '自適應組合', ma_consolidation_breakout: '均線盤整反彈',
}
const TYPE_ICON: Record<string, React.ElementType> = {
  ma_cross: TrendingUp, rsi: Activity, grid: Grid, supertrend: Zap, vwap_bb_rsi: BarChart2,
  ema_ribbon_st: TrendingUp, macd_bb_squeeze: BarChart2, adaptive_combo: BarChart2,
  ma_consolidation_breakout: TrendingUp,
}
const TYPE_COLOR: Record<string, string> = {
  ma_cross: 'text-blue-400 bg-blue-400/10', rsi: 'text-purple-400 bg-purple-400/10',
  grid: 'text-amber-400 bg-amber-400/10', supertrend: 'text-green-400 bg-green-400/10',
  vwap_bb_rsi: 'text-pink-400 bg-pink-400/10',
  ema_ribbon_st: 'text-emerald-400 bg-emerald-400/10',
  macd_bb_squeeze: 'text-orange-400 bg-orange-400/10',
  adaptive_combo: 'text-cyan-400 bg-cyan-400/10',
  ma_consolidation_breakout: 'text-violet-400 bg-violet-400/10',
}
const SYMBOL_COLOR: Record<string, string> = {
  BTCUSDT: 'text-yellow-400', ETHUSDT: 'text-blue-400',
  SOLUSDT: 'text-purple-400', BNBUSDT: 'text-amber-400',
}
const SYMBOL_BG: Record<string, string> = {
  BTCUSDT: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  ETHUSDT: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  SOLUSDT: 'border-purple-500/40 bg-purple-500/10 text-purple-300',
  BNBUSDT: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
}

function formatDuration(startMs: number, endMs: number): string {
  const diff = Math.max(0, endMs - startMs)
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export default function StrategiesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  interface LogRow { id: number; strategy_id: number; strategy_name: string; level: string; message: string; created_at: string }
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [logs, setLogs] = useState<LogRow[]>([])
  const [open, setOpen] = useState(false)
  const [seedOpen, setSeedOpen] = useState(false)
  const [seedMode, setSeedMode] = useState<'paper' | 'live'>('paper')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTradeSize, setEditTradeSize] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editSessionTradeSize, setEditSessionTradeSize] = useState('')
  const [engineMode, setEngineMode] = useState<'paper' | 'live' | 'all'>('all')
  const [ticking, setTicking] = useState(false)
  const [closingAll, setClosingAll] = useState(false)
  const [autoTick, setAutoTick] = useState(false)
  const autoTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Auto-refresh positions every 30s to keep unrealized_pnl fresh
  useEffect(() => {
    const t = setInterval(async () => {
      const res = await fetch(`/api/positions?mode=${engineMode}`)
      if (res.ok) setPositions(await res.json())
    }, 30_000)
    return () => clearInterval(t)
  }, [engineMode])

  const load = useCallback(async (mode?: 'paper' | 'live' | 'all') => {
    const m = mode ?? engineMode
    const [sRes, pRes, eRes, lRes] = await Promise.all([
      fetch('/api/strategies'),
      fetch(`/api/positions?mode=${m}`),
      fetch('/api/engine'),
      fetch('/api/logs?limit=50'),
    ])
    if (sRes.ok) setStrategies(await sRes.json())
    if (pRes.ok) setPositions(await pRes.json())
    if (eRes.ok) setStatus(await eRes.json())
    if (lRes.ok) setLogs(await lRes.json())
  }, [engineMode])

  useEffect(() => { load(engineMode) }, [engineMode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoTick) {
      autoTickRef.current = setInterval(() => tick(true), 60_000)
    } else {
      if (autoTickRef.current) clearInterval(autoTickRef.current)
    }
    return () => { if (autoTickRef.current) clearInterval(autoTickRef.current) }
  }, [autoTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const tick = async (silent = false) => {
    if (ticking) return
    setTicking(true)
    try {
      const res = await fetch('/api/engine', { method: 'POST' })
      const data = await res.json()
      if (!silent) {
        const acted = data.results?.filter((r: { signal: string }) => r.signal !== 'hold') ?? []
        if (acted.length > 0) toast.success(`執行完成：${acted.map((r: { name: string; message: string }) => `${r.name} ${r.message}`).join(', ')}`)
        else toast.info('所有策略：HOLD，無動作')
      }
      await load()
    } catch {
      if (!silent) toast.error('引擎執行失敗')
    } finally {
      setTicking(false)
    }
  }

  const toggle = async (id: number, active: number) => {
    await fetch(`/api/strategies/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active ? 0 : 1 }),
    })
    toast.success(active ? '策略已停止' : '策略已啟動')
    load()
  }

  const remove = async (id: number) => {
    if (!confirm('確定要刪除此策略？')) return
    const res = await fetch(`/api/strategies/${id}`, { method: 'DELETE' })
    if (res.ok) toast.success('策略已刪除')
    else toast.error('刪除失敗')
    load()
  }

  const saveTradeSize = async (id: number) => {
    const val = Number(editTradeSize)
    if (!val || val <= 0) { toast.error('請輸入有效金額'); return }
    await fetch(`/api/strategies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params: { tradeSize: val } }),
    })
    toast.success(`每筆金額已更新為 ${val} USDT（下次交易生效）`)
    setEditingId(null)
    load()
  }

  const saveSessionTradeSize = async (items: Strategy[]) => {
    const val = Number(editSessionTradeSize)
    if (!val || val <= 0) { toast.error('請輸入有效金額'); return }
    await Promise.all(items.map(s =>
      fetch(`/api/strategies/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: { tradeSize: val } }),
      })
    ))
    toast.success(`全組 ${items.length} 個策略每筆金額已更新為 ${val} USDT（下次交易生效）`)
    setEditingSessionId(null)
    load()
  }

  const forceCloseAll = async () => {
    if (!confirm(`確定要以現價強制平倉所有 ${positions.length} 個持倉？策略仍會繼續運行。`)) return
    setClosingAll(true)
    try {
      const res = await fetch('/api/positions/close-all', { method: 'POST' })
      const data = await res.json()
      if (data.closed?.length > 0) {
        const total = data.closed.reduce((s: number, c: { pnl: number }) => s + c.pnl, 0)
        toast.success(`已平倉 ${data.closed.length} 個部位，總 PnL: ${total >= 0 ? '+' : ''}${total.toFixed(2)} USDT`)
      }
      if (data.errors?.length > 0) toast.error(data.errors.join('\n'))
      load()
    } catch {
      toast.error('平倉失敗')
    } finally {
      setClosingAll(false)
    }
  }

  // Session actions
  const stopSession = async (sessionId: string) => {
    await fetch(`/api/strategies/session/${sessionId}`, { method: 'PATCH' })
    toast.success('已停止此組所有策略')
    load()
  }

  const deleteSession = async (sessionId: string) => {
    if (!confirm('確定要刪除此組所有策略（含交易記錄）？')) return
    await fetch(`/api/strategies/session/${sessionId}`, { method: 'DELETE' })
    toast.success('已刪除此組')
    load()
  }

  // Group strategies by session
  const sessions: { sessionId: string; items: Strategy[] }[] = []
  const standalone: Strategy[] = []
  const sessionMap = new Map<string, Strategy[]>()

  for (const s of strategies) {
    if (s.session_id) {
      if (!sessionMap.has(s.session_id)) sessionMap.set(s.session_id, [])
      sessionMap.get(s.session_id)!.push(s)
    } else {
      standalone.push(s)
    }
  }
  for (const [sessionId, items] of sessionMap) {
    sessions.push({ sessionId, items })
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">策略管理</h1>
          <p className="text-zinc-500 text-sm mt-1">交易策略與引擎控制（模擬 & 實盤）</p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <button onClick={() => { setSeedMode('paper'); setSeedOpen(true) }}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg font-medium text-sm transition-colors">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              一鍵模擬盤
            </button>
            <button onClick={() => { setSeedMode('live'); setSeedOpen(true) }}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg font-medium text-sm transition-colors">
              <Sparkles className="w-4 h-4 text-red-400" />
              一鍵實盤
            </button>
            <button onClick={() => setOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-zinc-900 rounded-lg font-medium text-sm hover:bg-yellow-400 transition-colors">
              <Plus className="w-4 h-4" />
              新增策略
            </button>
          </div>
        )}
      </div>

      {/* No active strategies banner */}
      {strategies.length > 0 && strategies.every(s => !s.is_active) && (
        <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800/80 border border-zinc-700 rounded-xl text-sm text-zinc-300">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>目前沒有任何策略在運行，引擎不會自動下單。請啟動至少一個策略。</span>
        </div>
      )}

      {/* Engine Panel */}
      <div className={`bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4 ${!isAdmin ? 'pointer-events-none' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-yellow-400" />
            <span className="font-semibold">交易引擎</span>
            <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">模擬 & 實盤</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Mode filter */}
            <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-xs">
              {([['all', '全部'], ['paper', '🟡 虛擬'], ['live', '🔴 實盤']] as const).map(([m, label]) => (
                <button key={m} onClick={() => setEngineMode(m)}
                  className={`px-3 py-1.5 transition-colors ${
                    engineMode === m
                      ? m === 'live' ? 'bg-red-500/20 text-red-400' : m === 'paper' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            {isAdmin && (<>
            <button onClick={() => setAutoTick(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                autoTick ? 'border-green-500 text-green-400 bg-green-500/10' : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
              }`}>
              <Clock className="w-3.5 h-3.5" />
              {autoTick ? '自動 60s' : '自動關閉'}
            </button>
            <button onClick={() => tick(false)} disabled={ticking}
              className="flex items-center gap-2 px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${ticking ? 'animate-spin' : ''}`} />
              {ticking ? '執行中…' : '立即觸發'}
            </button>
            </>)}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <p className="text-zinc-500 text-xs mb-1">活躍策略</p>
            <p className="font-bold text-lg">
              {strategies.filter(s => s.is_active && (engineMode === 'all' || s.mode === engineMode)).length}
            </p>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <p className="text-zinc-500 text-xs mb-1">持倉數量</p>
            <p className="font-bold text-lg">{positions.length}</p>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3 col-span-2">
            <p className="text-zinc-500 text-xs mb-1">最後觸發</p>
            <p className="text-zinc-300 text-xs truncate">
              {status?.lastTick ? new Date(status.lastTick.replace(' ', 'T') + 'Z').toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '尚未觸發'}
            </p>
            {status?.lastMessage && <p className="text-zinc-500 text-xs truncate mt-0.5">{status.lastMessage}</p>}
          </div>
        </div>
      </div>

      {/* Open positions */}
      {positions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-400">持倉中</h2>
            {isAdmin && (
              <button
                onClick={forceCloseAll}
                disabled={closingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                {closingAll ? '平倉中…' : '一鍵平倉'}
              </button>
            )}
          </div>
          <div className="grid gap-3">
            {positions.map(p => (
              <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{p.strategy_name}</span>
                    <span className={`text-xs font-medium ${SYMBOL_COLOR[p.symbol]}`}>{p.symbol.replace('USDT', '/USDT')}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-400">LONG</span>
                  </div>
                  <p className="text-xs text-zinc-500">
                    進場 {p.entry_price.toFixed(2)} · 現價 {p.current_price.toFixed(2)} · 數量 {p.quantity.toFixed(6)}
                  </p>
                </div>
                <div className={`text-right font-bold ${p.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {p.unrealized_pnl >= 0 ? '+' : ''}{p.unrealized_pnl.toFixed(2)}
                  <p className="text-xs font-normal text-zinc-500">USDT</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session groups */}
      {sessions.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-400">策略組別</h2>
          {sessions.map(({ sessionId, items }) => {
            const anyActive = items.some(s => s.is_active)
            const allStopped = items.every(s => !s.is_active)
            const firstItem = items[0]
            const params = JSON.parse(firstItem.params)
            const sessionDate = new Date(Number(sessionId.replace('sess_', ''))).toLocaleString('zh-TW', {
              month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            })
            const Icon = TYPE_ICON[firstItem.type] || TrendingUp
            // Extract session name: "20260402111000 BTC" → "20260402111000"; fallback to type label
            const sessionName = /^\d{14}\s/.test(firstItem.name)
              ? firstItem.name.split(' ')[0]
              : /^策略/.test(firstItem.name)
                ? firstItem.name.replace(/\s+\S+$/, '')
                : TYPE_LABEL[firstItem.type]

            return (
              <div key={sessionId} className={`bg-zinc-900 border rounded-xl overflow-hidden transition-colors ${
                anyActive ? 'border-zinc-700' : 'border-zinc-800'
              }`}>
                {/* Session header */}
                <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-lg ${TYPE_COLOR[firstItem.type]}`}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{sessionName}</span>
                        <span className="text-xs text-zinc-500">{TYPE_LABEL[firstItem.type]}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                          firstItem.mode === 'live'
                            ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                            : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                        }`}>
                          {firstItem.mode === 'live' ? '🔴 實盤' : '🟡 模擬'}
                        </span>
                      </div>
                      <span className="text-xs text-zinc-500">{params.interval} · 建立於 {sessionDate}</span>
                    </div>
                    {anyActive && (
                      <span className="flex items-center gap-1 text-xs text-green-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        運行中 · {formatDuration(Number(sessionId.replace('sess_', '')), now)}
                      </span>
                    )}
                    {allStopped && (
                      <span className="flex items-center gap-1 text-xs text-zinc-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                        已停止 · 共運行 {formatDuration(
                          Number(sessionId.replace('sess_', '')),
                          Math.max(...items.map(s => new Date(s.updated_at).getTime()))
                        )}
                      </span>
                    )}
                  </div>
                  {isAdmin && <div className="flex items-center gap-2">
                    {/* 全組調整金額 */}
                    {editingSessionId === sessionId ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus
                          type="number"
                          value={editSessionTradeSize}
                          onChange={e => setEditSessionTradeSize(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveSessionTradeSize(items); if (e.key === 'Escape') setEditingSessionId(null) }}
                          className="w-24 px-2 py-1 text-sm bg-zinc-800 border border-zinc-600 rounded-lg text-zinc-100 focus:outline-none focus:border-yellow-500"
                          placeholder="USDT"
                        />
                        <button onClick={() => saveSessionTradeSize(items)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors">
                          <Check className="w-3 h-3" /> 全組套用
                        </button>
                        <button onClick={() => setEditingSessionId(null)}
                          className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 transition-colors">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingSessionId(sessionId); setEditSessionTradeSize(String(params.tradeSize ?? params.amountPerGrid ?? '')) }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-600 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
                      >
                        <Pencil className="w-3 h-3" />
                        全組調整金額
                      </button>
                    )}
                    {anyActive && (
                      <button
                        onClick={() => stopSession(sessionId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-zinc-600 text-zinc-300 hover:bg-zinc-800 transition-colors"
                      >
                        <Square className="w-3 h-3" />
                        停止本組
                      </button>
                    )}
                    {allStopped && (
                      <button
                        onClick={() => deleteSession(sessionId)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <X className="w-3 h-3" />
                        刪除本組
                      </button>
                    )}
                  </div>}
                </div>

                {/* Symbol chips */}
                <div className="px-5 py-4 flex flex-wrap gap-3">
                  {(() => {
                    const allSameType = items.every(s => s.type === items[0].type)
                    return items.map(s => {
                    const pos = positions.find(p => p.strategy_id === s.id)
                    const sParams = JSON.parse(s.params)
                    const isEditing = editingId === s.id
                    return (
                      <div key={s.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${
                        SYMBOL_BG[s.symbol] || 'border-zinc-700 bg-zinc-800 text-zinc-300'
                      }`}>
                        <span className="font-semibold">{s.symbol.replace('USDT', '')}</span>
                        {!allSameType && (
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${TYPE_COLOR[s.type]}`}>
                            {TYPE_LABEL[s.type]}
                          </span>
                        )}
                        {isAdmin && <span className="text-xs opacity-60">{sParams.tradeSize ?? sParams.amountPerGrid}U</span>}
                        <span className={`w-1.5 h-1.5 rounded-full ${s.is_active ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'}`} />
                        {pos && (
                          <span className={`text-xs font-mono ${pos.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {pos.unrealized_pnl >= 0 ? '+' : ''}{pos.unrealized_pnl.toFixed(1)}
                          </span>
                        )}
                        {isAdmin && (isEditing ? (
                          <>
                            <input
                              autoFocus
                              type="number"
                              value={editTradeSize}
                              onChange={e => setEditTradeSize(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveTradeSize(s.id); if (e.key === 'Escape') setEditingId(null) }}
                              className="w-20 px-1.5 py-0.5 text-xs bg-zinc-900 border border-zinc-500 rounded text-zinc-100 focus:outline-none focus:border-yellow-500"
                              placeholder="USDT"
                            />
                            <button onClick={() => saveTradeSize(s.id)} className="text-yellow-400 hover:text-yellow-300">
                              <Check className="w-3 h-3" />
                            </button>
                            <button onClick={() => setEditingId(null)} className="text-zinc-500 hover:text-zinc-300">
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => { setEditingId(s.id); setEditTradeSize(String(sParams.tradeSize ?? sParams.amountPerGrid ?? '')) }}
                            className="text-zinc-500 hover:text-zinc-200 transition-colors"
                            title="調整每筆金額">
                            <Pencil className="w-3 h-3" />
                          </button>
                        ))}
                        {isAdmin && <button onClick={() => toggle(s.id, s.is_active)}
                          className="text-zinc-500 hover:text-zinc-200 transition-colors"
                          title={s.is_active ? '停止' : '啟動'}>
                          {s.is_active ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>}
                      </div>
                    )
                  })
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Standalone strategies */}
      {standalone.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-400">獨立策略</h2>
          {standalone.map(s => {
            const Icon = TYPE_ICON[s.type] || TrendingUp
            const params = JSON.parse(s.params)
            const pos = positions.find(p => p.strategy_id === s.id)
            return (
              <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex items-center gap-4">
                <div className={`p-2.5 rounded-lg ${TYPE_COLOR[s.type]}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{s.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{TYPE_LABEL[s.type]}</span>
                    <span className={`text-xs font-medium ${SYMBOL_COLOR[s.symbol]}`}>{s.symbol.replace('USDT', '/USDT')}</span>
                    {params.interval && <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">{params.interval}</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      s.mode === 'live'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                    }`}>
                      {s.mode === 'live' ? '🔴 實盤' : '🟡 模擬'}
                    </span>
                  </div>
                  {isAdmin && (
                    <p className="text-xs text-zinc-500 truncate">
                      {Object.entries(params).filter(([k]) => k !== 'interval').map(([k, v]) => `${k}: ${v}`).join(' · ')}
                    </p>
                  )}
                  {pos && (
                    <p className={`text-xs mt-1 ${pos.unrealized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      持倉中 · {pos.unrealized_pnl >= 0 ? '+' : ''}{pos.unrealized_pnl.toFixed(2)} USDT
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className={`flex items-center gap-1.5 text-xs ${s.is_active ? 'text-green-400' : 'text-zinc-600'}`}>
                    <div className={`w-2 h-2 rounded-full ${s.is_active ? 'bg-green-400 animate-pulse' : 'bg-zinc-600'}`} />
                    {s.is_active ? '運行中' : '停止'}
                  </div>
                  {/* Trade size inline edit — admin only */}
                  {isAdmin && (editingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="number"
                        value={editTradeSize}
                        onChange={e => setEditTradeSize(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveTradeSize(s.id); if (e.key === 'Escape') setEditingId(null) }}
                        className="w-24 px-2 py-1 text-sm bg-zinc-800 border border-zinc-600 rounded-lg text-zinc-100 focus:outline-none focus:border-yellow-500"
                        placeholder="USDT"
                      />
                      <button onClick={() => saveTradeSize(s.id)}
                        className="p-1.5 rounded-lg bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditingId(null)}
                        className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-500">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(s.id); setEditTradeSize(String(params.tradeSize ?? params.amountPerGrid ?? '')) }}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 transition-colors"
                      title="調整每筆金額">
                      <Pencil className="w-3 h-3" />
                      {params.tradeSize ?? params.amountPerGrid} USDT
                    </button>
                  ))}
                  {isAdmin && <>
                  <button onClick={() => toggle(s.id, s.is_active)}
                    className="p-2 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-zinc-100"
                    title={s.is_active ? '停止' : '啟動'}>
                    {s.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button onClick={() => remove(s.id)}
                    className="p-2 rounded-lg hover:bg-red-500/10 transition-colors text-zinc-600 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  </>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {strategies.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-600">
          <TrendingUp className="w-12 h-12 mb-4" />
          <p className="text-lg font-medium mb-1">尚無策略</p>
          <p className="text-sm">點擊「一鍵模擬盤」或「一鍵實盤」快速建立，或「新增策略」自訂設定</p>
        </div>
      )}

      {/* Engine Logs */}
      {logs.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-zinc-400" />
            <h2 className="text-sm font-semibold text-zinc-300">引擎日誌</h2>
            <span className="text-xs text-zinc-600">（最近 50 筆）</span>
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {logs.map(log => (
              <div key={log.id} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-mono ${
                log.level === 'error' ? 'bg-red-500/10 border border-red-500/20' :
                log.level === 'warn'  ? 'bg-amber-500/10 border border-amber-500/20' :
                'bg-zinc-800/60 border border-zinc-700/40'
              }`}>
                <span className={`shrink-0 font-semibold mt-0.5 ${
                  log.level === 'error' ? 'text-red-400' :
                  log.level === 'warn'  ? 'text-amber-400' :
                  'text-zinc-500'
                }`}>{log.level.toUpperCase()}</span>
                <span className="text-zinc-400 shrink-0">[{log.strategy_name ?? `#${log.strategy_id}`}]</span>
                <span className={`flex-1 break-all ${
                  log.level === 'error' ? 'text-red-300' :
                  log.level === 'warn'  ? 'text-amber-300' :
                  'text-zinc-400'
                }`}>{log.message}</span>
                <span className="shrink-0 text-zinc-600">{new Date(log.created_at.replace(' ', 'T') + 'Z').toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <StrategyDialog open={open} onClose={() => { setOpen(false); load() }} />
      <SeedDialog open={seedOpen} onClose={() => { setSeedOpen(false); load() }} initialMode={seedMode} />
    </div>
  )
}
