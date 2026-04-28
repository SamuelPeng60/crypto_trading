'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useAuth } from '@/components/auth-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Trash2, Calculator, Check, X, Link2, ExternalLink, Zap, Rocket, Pencil, RefreshCw, Send, BotMessageSquare, History, BadgeCheck } from 'lucide-react'

interface Participant {
  id: number
  name: string
  investment: number
  start_date: string
  current_pnl: number
  note: string | null
  bound_session_id: string | null
  allocated: number
  telegram_chat_id: string | null
  settled_at: string | null
  final_pnl: number | null
}

interface StrategyRow {
  id: number
  name: string
  type: string
  session_id: string | null
  params: string
  mode: string
}

interface SessionOption {
  session_id: string
  label: string
}

interface SessionInfo {
  totalTradeSize: number
  totalPnl: number       // closed PnL
  unrealizedPnl: number  // open position floating PnL
  mode: string
}

interface CalcResult {
  id: number
  name: string
  investment: number
  durationDays: number
  currentPnl: number
  returnPct: number
  fee: number
  withdrawable: number
  isLive: boolean
}

function calcDays(start: string): number {
  const s = new Date(start).getTime()
  return Math.max(0, Math.floor((Date.now() - s) / 86400000))
}

function formatDuration(days: number): string {
  if (days === 0) return '不到 1 天'
  if (days < 30) return `${days} 天`
  const months = Math.floor(days / 30)
  const rem = days % 30
  return rem > 0 ? `${months} 個月 ${rem} 天` : `${months} 個月`
}

const TYPE_LABEL: Record<string, string> = {
  ma_cross: 'MA 交叉', rsi: 'RSI', grid: '網格交易',
  supertrend: 'SuperTrend', vwap_bb_rsi: 'Crypto Pulse',
  ema_ribbon_st: 'EMA Ribbon', macd_bb_squeeze: 'MACD Squeeze',
  adaptive_combo: '自適應組合', ma_consolidation_breakout: '均線盤整反彈',
}

// ─── SeedAndBind inline dialog ────────────────────────────────────────────────
const SEED_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']
const SYMBOL_LABEL: Record<string, string> = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', BNBUSDT: 'BNB', SOLUSDT: 'SOL' }
const STRATEGY_TYPES = [
  { value: 'vwap_bb_rsi',     label: 'Crypto Pulse（VWAP + BB + RSI）' },
  { value: 'ma_cross',        label: 'MA 交叉' },
  { value: 'rsi',             label: 'RSI 超買超賣' },
  { value: 'supertrend',      label: 'SuperTrend（ATR）' },
  { value: 'ema_ribbon_st',   label: 'EMA Ribbon + SuperTrend' },
  { value: 'macd_bb_squeeze', label: 'MACD + BB Squeeze' },
  { value: 'adaptive_combo',  label: '自適應組合' },
]
const DEFAULT_INTERVAL: Record<string, string> = {
  vwap_bb_rsi: '4h', ma_cross: '4h', rsi: '4h', supertrend: '4h',
  ema_ribbon_st: '4h', macd_bb_squeeze: '1h', adaptive_combo: '4h',
}
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']

function buildParams(type: string, interval: string, tradeSize: number) {
  const base = { interval, tradeSize }
  if (type === 'vwap_bb_rsi') return { ...base, rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65, bbPeriod: 20, bbStdDev: 2, vwapWindow: 24, atrPeriod: 14, atrSlMultiplier: 1.0, trailAtrMult: 2.0, volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.3 }
  if (type === 'ma_cross') return { ...base, fastPeriod: 10, slowPeriod: 30, maType: 'ema', stopLoss: 3, takeProfit: 6 }
  if (type === 'rsi') return { ...base, period: 14, oversold: 30, overbought: 70, stopLoss: 3, takeProfit: 6 }
  if (type === 'supertrend') return { ...base, atrPeriod: 10, multiplier: 3, ema200Filter: true }
  if (type === 'ema_ribbon_st') return { ...base, fastEma: 5, midEma: 8, slowEma: 21, atrPeriod: 14, multiplier: 3.5, ema200Filter: true, atrSlMultiplier: 2.0 }
  if (type === 'macd_bb_squeeze') return { ...base, macdFast: 12, macdSlow: 26, macdSignal: 9, bbPeriod: 15, rsiPeriod: 14, atrPeriod: 14, atrSlMultiplier: 2, atrTpMultiplier: 5, ema200Filter: true }
  if (type === 'adaptive_combo') return { ...base, fastEma: 5, midEma: 13, slowEma: 34, atrPeriod: 14, multiplier: 2.5, ema200Filter: true, atrSlMultiplier: 1.5, rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65, bbPeriod: 20, bbStdDev: 2, vwapWindow: 24, volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35 }
  return base
}

function toTimestamp() {
  const n = new Date()
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}${String(n.getSeconds()).padStart(2,'0')}`
}

interface SeedDialogProps {
  investment: number
  onClose: () => void
  onCreated: (session_id: string) => void
}

function SeedAndBindDialog({ investment, onClose, onCreated }: SeedDialogProps) {
  const [type, setType] = useState('vwap_bb_rsi')
  const [iv, setIv] = useState(DEFAULT_INTERVAL['vwap_bb_rsi'])
  const [symbols, setSymbols] = useState<string[]>([...SEED_SYMBOLS])
  const [mode, setMode] = useState<'paper' | 'live'>('paper')
  const [saving, setSaving] = useState(false)

  const perCoin = symbols.length > 0 ? Math.floor(investment / symbols.length) : 0

  const toggleSym = (s: string) => setSymbols(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  const create = async () => {
    if (!symbols.length) { toast.error('請至少選一個幣種'); return }
    setSaving(true)
    try {
      const session_id = `sess_${Date.now()}`
      const name = toTimestamp()
      const params = buildParams(type, iv, perCoin)
      await Promise.all(symbols.map(sym =>
        fetch('/api/strategies', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${name} ${SYMBOL_LABEL[sym]}`, type, symbol: sym, params, session_id, mode }),
        })
      ))
      toast.success(`已建立 ${symbols.length} 個策略，每幣 ${perCoin} USDT`)
      onCreated(session_id)
    } catch { toast.error('建立失敗') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md mx-4 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-100 flex items-center gap-2">
            <Rocket className="w-4 h-4 text-yellow-400" />
            新增策略並綁定
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>

        {/* Mode */}
        <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-sm">
          {(['paper', 'live'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2 font-medium transition-colors ${mode === m ? m === 'live' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {m === 'paper' ? '🟡 模擬' : '🔴 實盤'}
            </button>
          ))}
        </div>

        {/* Strategy type */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">策略類型</label>
          <Select value={type} onValueChange={v => { setType(v); setIv(DEFAULT_INTERVAL[v] ?? '4h') }}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700 h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              {STRATEGY_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* Interval */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">K線週期</label>
          <div className="flex gap-1.5 flex-wrap">
            {INTERVALS.map(i => (
              <button key={i} onClick={() => setIv(i)}
                className={`px-3 py-1 text-xs rounded transition-colors ${iv === i ? 'bg-yellow-500 text-zinc-900 font-bold' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {i}
              </button>
            ))}
          </div>
        </div>

        {/* Coins */}
        <div className="space-y-1.5">
          <label className="text-xs text-zinc-400">幣種</label>
          <div className="flex gap-2">
            {SEED_SYMBOLS.map(s => (
              <button key={s} onClick={() => toggleSym(s)}
                className={`flex-1 py-1.5 text-xs rounded border transition-colors font-medium ${symbols.includes(s) ? 'bg-yellow-500/20 border-yellow-500/60 text-yellow-300' : 'bg-zinc-800 border-zinc-700 text-zinc-500'}`}>
                {SYMBOL_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Trade size breakdown */}
        <div className="bg-zinc-800/60 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
          <span className="text-zinc-400">每幣倉位（{investment.toLocaleString()} ÷ {symbols.length || 1}）</span>
          <span className="font-mono font-bold text-yellow-400">{perCoin.toLocaleString()} USDT</span>
        </div>

        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg">取消</button>
          <button onClick={create} disabled={saving || !symbols.length}
            className={`flex-1 px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-50 transition-colors ${mode === 'live' ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-yellow-500 hover:bg-yellow-400 text-zinc-900'}`}>
            {saving ? '建立中...' : `建立並綁定（${symbols.length} 個幣）`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ParticipantsPage() {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [rows, setRows] = useState<Participant[]>([])
  const [editing, setEditing] = useState<Record<number, Participant>>({})
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [saving, setSaving] = useState<Record<number, boolean>>({})
  const [testingSend, setTestingSend] = useState<Record<number, boolean>>({})
  const [testingEngine, setTestingEngine] = useState<Record<number, boolean>>({})
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [sessionInfo, setSessionInfo] = useState<Record<string, SessionInfo>>({})
  const [seedFor, setSeedFor] = useState<{ id: number; investment: number } | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [settling, setSettling] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const rowsRef = useRef<Participant[]>([])
  const stratsRef = useRef<StrategyRow[]>([])

  const load = async () => {
    const res = await fetch('/api/participants')
    const data: Participant[] = await res.json()
    setRows(data)
    rowsRef.current = data
    return data
  }

  const loadSessions = async () => {
    const res = await fetch('/api/strategies')
    const strats: StrategyRow[] = await res.json()
    stratsRef.current = strats
    const seen = new Map<string, SessionOption>()
    for (const s of strats) {
      if (!s.session_id || seen.has(s.session_id)) continue
      const sessionName = /^\d{14}\s/.test(s.name)
        ? s.name.split(' ')[0]
        : /^策略/.test(s.name)
          ? s.name.replace(/\s+\S+$/, '')
          : s.name.replace(/\s+\S+$/, '') || s.name
      seen.set(s.session_id, {
        session_id: s.session_id,
        label: `${sessionName}（${TYPE_LABEL[s.type] ?? s.type}）`,
      })
    }
    setSessions([...seen.values()])
    return strats
  }

  const loadSessionInfo = useCallback(async (participants: Participant[], strats: StrategyRow[]) => {
    const boundParticipants = participants.filter(p => p.bound_session_id)
    if (!boundParticipants.length) return

    // Build per-participant session info keyed by participantId
    // Each participant may have a different start_date, so we fetch per participant
    const info: Record<string, SessionInfo> = {}
    const sessStratsCache = new Map<string, StrategyRow[]>()

    for (const p of boundParticipants) {
      const sessId = p.bound_session_id!
      if (!sessStratsCache.has(sessId)) {
        sessStratsCache.set(sessId, strats.filter(s => s.session_id === sessId))
      }
      const sessStrats = sessStratsCache.get(sessId)!
      if (!sessStrats.length) continue
      const totalTradeSize = sessStrats.reduce((sum, s) => {
        try { return sum + (JSON.parse(s.params).tradeSize ?? 0) } catch { return sum }
      }, 0)
      const mode = sessStrats[0]?.mode ?? 'paper'
      const key = `${sessId}__${p.start_date}`
      if (!info[key]) {
        try {
          const params = new URLSearchParams({ mode, session_id: sessId, start_date: p.start_date })
          const statsRes = await fetch(`/api/stats?${params}`)
          const stats = await statsRes.json()
          info[key] = {
            totalTradeSize,
            totalPnl: stats.overall?.totalPnl ?? 0,
            unrealizedPnl: stats.overall?.unrealizedPnl ?? 0,
            mode,
          }
        } catch {
          info[key] = { totalTradeSize, totalPnl: 0, unrealizedPnl: 0, mode }
        }
      } else {
        info[key] = { ...info[key], totalTradeSize }
      }
    }
    setSessionInfo(info)
  }, [])

  // Only refresh stats (PnL/unrealized), skip full participant/session reload
  const refreshStats = useCallback(async () => {
    setRefreshing(true)
    try {
      await loadSessionInfo(rowsRef.current, stratsRef.current)
      setLastUpdated(new Date())
    } finally {
      setRefreshing(false)
    }
  }, [loadSessionInfo])

  const refreshAll = useCallback(async () => {
    const [participants, strats] = await Promise.all([load(), loadSessions()])
    await loadSessionInfo(participants, strats)
    setLastUpdated(new Date())
  }, [loadSessionInfo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshAll() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh stats every 30 seconds
  useEffect(() => {
    const timer = setInterval(refreshStats, 30000)
    return () => clearInterval(timer)
  }, [refreshStats])

  // Compute auto PnL for bound participants (closed PnL + unrealized floating PnL)
  const getComputedPnl = (p: Participant): number | null => {
    if (!p.bound_session_id) return null
    const key = `${p.bound_session_id}__${p.start_date}`
    const info = sessionInfo[key]
    if (!info || info.totalTradeSize <= 0) return null
    const ratio = p.investment / info.totalTradeSize
    return (info.totalPnl + info.unrealizedPnl) * ratio
  }

  const startEdit = (p: Participant) => setEditing(prev => ({ ...prev, [p.id]: { ...p } }))
  const cancelEdit = (id: number) => setEditing(prev => { const n = { ...prev }; delete n[id]; return n })

  const saveEdit = async (id: number) => {
    const e = editing[id]
    if (!e) return
    setSaving(prev => ({ ...prev, [id]: true }))
    await fetch('/api/participants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(e),
    })
    await refreshAll()
    cancelEdit(id)
    setSaving(prev => ({ ...prev, [id]: false }))
    toast.success('已儲存' + (e.bound_session_id ? '，策略開單金額已更新' : ''))
  }

  const addRow = async () => {
    const today = new Date().toISOString().split('T')[0]
    const res = await fetch('/api/participants', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新參與者', investment: 0, start_date: today, current_pnl: 0 }),
    })
    const { id } = await res.json()
    await refreshAll()
    const fresh = await fetch('/api/participants').then(r => r.json())
    const newRow = fresh.find((p: Participant) => p.id === id)
    if (newRow) startEdit(newRow)
  }

  const deleteRow = async (id: number) => {
    if (!confirm('確定要刪除此參與者？')) return
    await fetch('/api/participants', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (calcResult?.id === id) setCalcResult(null)
    await refreshAll()
    toast.success('已刪除')
  }

  const testNotify = async (p: Participant) => {
    setTestingSend(prev => ({ ...prev, [p.id]: true }))
    try {
      const res = await fetch('/api/participants/notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      })
      const data = await res.json()
      if (res.ok) toast.success(`測試訊息已發送給 ${p.name}`)
      else toast.error(data.error || '發送失敗')
    } finally {
      setTestingSend(prev => ({ ...prev, [p.id]: false }))
    }
  }

  const testEngineNotify = async (p: Participant) => {
    if (!p.bound_session_id) { toast.error('該參與者尚未綁定策略 session'); return }
    setTestingEngine(prev => ({ ...prev, [p.id]: true }))
    try {
      const res = await fetch('/api/participants/notify-engine-test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: p.bound_session_id }),
      })
      const data = await res.json()
      if (res.ok) toast.success(`引擎通知測試：已送出給 ${data.names?.join(', ')}`)
      else toast.error(data.error || '發送失敗')
    } finally {
      setTestingEngine(prev => ({ ...prev, [p.id]: false }))
    }
  }

  const settleParticipant = async () => {
    if (!calcResult) return
    if (!confirm(`確認結算「${calcResult.name}」？\n此操作將賣出其持倉比例並調整策略資金，無法復原。`)) return
    setSettling(true)
    try {
      const res = await fetch('/api/participants/settle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: calcResult.id, final_pnl: calcResult.currentPnl }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || '結算失敗'); return }
      if (data.closeErrors?.length) {
        toast.warning(`結算完成，但部分持倉賣出失敗：${data.closeErrors.join('；')}`)
      } else {
        toast.success(`${data.name} 已結算，最終損益 ${data.final_pnl >= 0 ? '+' : ''}${data.final_pnl.toFixed(2)} USDT`)
      }
      setCalcResult(null)
      setShowHistory(true)
      await refreshAll()
    } finally {
      setSettling(false)
    }
  }

  const calculate = (p: Participant) => {
    const pnl = getComputedPnl(p) ?? p.current_pnl
    const fee = pnl > 0 ? pnl * 0.10 : 0
    const withdrawable = pnl > 0 ? p.investment + pnl * 0.90 : p.investment + pnl
    setCalcResult({
      id: p.id, name: p.name, investment: p.investment,
      durationDays: calcDays(p.start_date),
      currentPnl: pnl,
      returnPct: p.investment > 0 ? (pnl / p.investment) * 100 : 0,
      fee, withdrawable,
      isLive: !!p.bound_session_id && (sessionInfo[`${p.bound_session_id}__${p.start_date}`]?.mode === 'live'),
    })
  }

  const updateField = (id: number, field: keyof Participant, value: string | number | null) => {
    setEditing(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  const pnlColor = (v: number) => v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-zinc-400'
  const activeRows = rows.filter(p => !p.settled_at)
  const settledRows = rows.filter(p => p.settled_at)

  const sessionLabel = (session_id: string | null) => {
    if (!session_id) return '—'
    return sessions.find(s => s.session_id === session_id)?.label ?? session_id
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">參與者</h1>
          <p className="text-zinc-500 text-sm mt-1">管理投資人資訊與結算試算</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <button
              onClick={refreshStats}
              disabled={refreshing}
              className="flex items-center gap-1 hover:text-zinc-300 transition-colors disabled:opacity-50"
              title="手動刷新收益">
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {lastUpdated && (
              <span>
                更新於 {lastUpdated.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </div>
          {settledRows.length > 0 && (
            <Button variant="outline" onClick={() => setShowHistory(v => !v)}
              className="border-zinc-700 text-zinc-400 hover:text-zinc-200 gap-2">
              <History className="w-4 h-4" />
              歷史參與者 ({settledRows.length})
            </Button>
          )}
          {isAdmin && (
            <Button onClick={addRow} className="bg-yellow-500 text-zinc-900 hover:bg-yellow-400 font-semibold">
              <Plus className="w-4 h-4 mr-1" />
              新增參與者
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                <th className="text-left px-4 py-3">姓名</th>
                <th className="text-right px-4 py-3">投入金額</th>
                <th className="text-center px-4 py-3">投入時間點</th>
                <th className="text-right px-4 py-3">目前收益</th>
                <th className="text-right px-4 py-3">收益率</th>
                <th className="text-center px-4 py-3">綁定策略</th>
                <th className="text-center px-4 py-3">Telegram</th>
                <th className="text-center px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-zinc-600">
                    {isAdmin ? '尚無參與者，點擊「新增參與者」開始' : '尚無資料'}
                  </td>
                </tr>
              )}
              {activeRows.map(p => {
                const e = editing[p.id]
                const isEditing = isAdmin && !!e
                const computedPnl = getComputedPnl(p)
                const displayPnl = computedPnl !== null ? computedPnl : p.current_pnl
                const displayInvestment = isEditing ? e.investment : p.investment
                const returnPct = displayInvestment > 0 ? (displayPnl / displayInvestment) * 100 : 0

                return (
                  <tr key={p.id} className={`border-b border-zinc-800/50 transition-colors ${
                    calcResult?.id === p.id ? 'bg-yellow-500/5' : 'hover:bg-zinc-800/30'
                  }`}>
                    {/* 姓名 */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input value={e.name} onChange={ev => updateField(p.id, 'name', ev.target.value)}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-28" />
                      ) : (
                        <span className={`font-medium ${isAdmin ? 'cursor-pointer hover:text-yellow-400 transition-colors' : ''}`}
                          onClick={() => isAdmin && startEdit(p)}>{p.name}</span>
                      )}
                    </td>

                    {/* 投入金額 */}
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <Input type="number" value={e.investment}
                          onChange={ev => updateField(p.id, 'investment', Number(ev.target.value))}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-28 text-right" />
                      ) : (
                        <span className={`font-mono ${isAdmin ? 'cursor-pointer hover:text-yellow-400 transition-colors' : ''}`}
                          onClick={() => isAdmin && startEdit(p)}>{p.investment.toLocaleString()} USDT</span>
                      )}
                    </td>

                    {/* 投入時間點 */}
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <Input type="date" value={e.start_date}
                          onChange={ev => updateField(p.id, 'start_date', ev.target.value)}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-36" />
                      ) : (
                        <span className={`text-zinc-300 ${isAdmin ? 'cursor-pointer hover:text-yellow-400 transition-colors' : ''}`}
                          onClick={() => isAdmin && startEdit(p)}>
                          {p.start_date}
                          <span className="text-zinc-600 ml-1 text-xs">（{formatDuration(calcDays(p.start_date))}）</span>
                        </span>
                      )}
                    </td>

                    {/* 目前收益 */}
                    <td className="px-4 py-3 text-right">
                      {isEditing && !p.bound_session_id ? (
                        <Input type="number" value={e.current_pnl}
                          onChange={ev => updateField(p.id, 'current_pnl', Number(ev.target.value))}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-28 text-right" />
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          {computedPnl !== null && (
                            <span title="⚡ 依綁定策略自動計算（已結清 + 浮動盈虧，每 30 秒更新）" className="flex items-center cursor-help">
                              <Zap className="w-3 h-3 text-yellow-500" />
                            </span>
                          )}
                          <span className={`font-mono ${isAdmin ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${pnlColor(displayPnl)}`}
                            onClick={() => isAdmin && startEdit(p)}>
                            {displayPnl >= 0 ? '+' : ''}{displayPnl.toFixed(2)} USDT
                          </span>
                        </div>
                      )}
                    </td>

                    {/* 收益率 */}
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-bold ${pnlColor(returnPct)}`}>
                        {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
                      </span>
                    </td>

                    {/* 綁定策略 */}
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <div className="flex flex-col items-center gap-1.5">
                          <select value={e.bound_session_id ?? ''}
                            onChange={ev => updateField(p.id, 'bound_session_id', ev.target.value || null)}
                            className="bg-zinc-800 border border-zinc-700 rounded-md h-8 text-sm px-2 text-zinc-200 w-44">
                            <option value="">不綁定</option>
                            {sessions.map(s => (
                              <option key={s.session_id} value={s.session_id}>{s.label}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => setSeedFor({ id: p.id, investment: e.investment })}
                            className="flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 transition-colors">
                            <Rocket className="w-3 h-3" />
                            新增策略並綁定
                          </button>
                        </div>
                      ) : p.bound_session_id ? (
                        <button onClick={() => router.push('/strategies')}
                          className="text-xs flex items-center justify-center gap-1 text-yellow-400 hover:text-yellow-300 transition-colors group"
                          title="前往策略頁面">
                          <Link2 className="w-3 h-3" />
                          {sessionLabel(p.bound_session_id)}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </td>

                    {/* Telegram Chat ID */}
                    <td className="px-4 py-3 text-center">
                      {isAdmin && isEditing ? (
                        <Input
                          value={e.telegram_chat_id ?? ''}
                          onChange={ev => updateField(p.id, 'telegram_chat_id', ev.target.value || null)}
                          placeholder="Chat ID"
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-28 text-center"
                        />
                      ) : p.telegram_chat_id ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-xs font-mono text-emerald-400" title="已設定 Telegram 通知">✓ 已設定</span>
                          {isAdmin && (
                            <>
                              <button
                                onClick={() => testNotify(p)}
                                disabled={testingSend[p.id]}
                                title="測試：直接送 Telegram"
                                className="text-zinc-500 hover:text-sky-400 transition-colors disabled:opacity-40">
                                <Send className="w-3 h-3" />
                              </button>
                              {p.bound_session_id && (
                                <button
                                  onClick={() => testEngineNotify(p)}
                                  disabled={testingEngine[p.id]}
                                  title="測試：模擬引擎通知路徑"
                                  className="text-zinc-500 hover:text-violet-400 transition-colors disabled:opacity-40">
                                  <BotMessageSquare className="w-3 h-3" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      ) : isAdmin ? (
                        <span className="text-xs text-zinc-600">— 尚未設定</span>
                      ) : (
                        <span className="text-xs text-zinc-500">
                          傳送 /register 到 Bot
                        </span>
                      )}
                    </td>

                    {/* 操作 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {isEditing ? (
                          <>
                            <Button size="sm" className="h-7 px-2 bg-green-600 hover:bg-green-500 text-white"
                              onClick={() => saveEdit(p.id)} disabled={saving[p.id]}>
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2 border-zinc-700 text-zinc-400"
                              onClick={() => cancelEdit(p.id)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm"
                              className="h-7 px-2.5 bg-yellow-500 text-zinc-900 hover:bg-yellow-400 font-semibold text-xs"
                              onClick={() => calculate(p)}>
                              <Calculator className="w-3 h-3 mr-1" />
                              試算
                            </Button>
                            {isAdmin && (
                              <Button size="sm" variant="outline"
                                className="h-7 px-2 border-zinc-700 text-zinc-400 hover:text-yellow-400 hover:border-yellow-500/50"
                                onClick={() => startEdit(p)}>
                                <Pencil className="w-3 h-3" />
                              </Button>
                            )}
                            {isAdmin && (
                              <Button size="sm" variant="outline"
                                className="h-7 px-2 border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-500/50"
                                onClick={() => deleteRow(p.id)}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Calculation Result Panel */}
      {calcResult && (
        <div className="bg-zinc-900 border border-yellow-500/30 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-yellow-400" />
              <p className="font-semibold text-sm">
                結算試算 — <span className="text-yellow-400">{calcResult.name}</span>
              </p>
              {calcResult.isLive && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">🔴 實盤</span>
              )}
              {!calcResult.isLive && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">🟡 模擬</span>
              )}
            </div>
            <button onClick={() => setCalcResult(null)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">投入金額</p>
              <p className="text-lg font-bold font-mono">{calcResult.investment.toLocaleString()}<span className="text-xs text-zinc-500 ml-1">USDT</span></p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">投資時間</p>
              <p className="text-lg font-bold">{formatDuration(calcResult.durationDays)}</p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs flex items-center gap-1 text-zinc-500">
                目前收益
                <Zap className="w-3 h-3 text-yellow-500" />
              </p>
              <p className={`text-lg font-bold font-mono ${pnlColor(calcResult.currentPnl)}`}>
                {calcResult.currentPnl >= 0 ? '+' : ''}{calcResult.currentPnl.toFixed(2)}<span className="text-xs ml-1">USDT</span>
              </p>
            </div>
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">收益率</p>
              <p className={`text-lg font-bold font-mono ${pnlColor(calcResult.returnPct)}`}>
                {calcResult.returnPct >= 0 ? '+' : ''}{calcResult.returnPct.toFixed(2)}%
              </p>
            </div>
            <div className={`rounded-lg p-3.5 space-y-1 ${calcResult.fee > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-zinc-800/60'}`}>
              <p className="text-xs text-zinc-500">{calcResult.fee > 0 ? '管理費（收益的 10%）' : '管理費'}</p>
              <p className={`text-lg font-bold font-mono ${calcResult.fee > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                {calcResult.fee > 0 ? `−${calcResult.fee.toFixed(2)}` : '—'}
                {calcResult.fee > 0 && <span className="text-xs ml-1">USDT</span>}
              </p>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">可提領金額{calcResult.currentPnl > 0 && <span className="ml-1 text-zinc-600">（本金＋收益×90%）</span>}</p>
              <p className="text-lg font-bold font-mono text-green-400">
                {calcResult.withdrawable.toFixed(2)}<span className="text-xs ml-1">USDT</span>
              </p>
            </div>
          </div>
          {calcResult.currentPnl > 0 && (
            <div className="px-5 pb-4">
              <p className="text-xs text-zinc-600">
                收益正報酬：管理費從收益中扣 10% = {calcResult.fee.toFixed(2)} USDT；
                可提領 = 本金 {calcResult.investment.toLocaleString()} + 收益 {(calcResult.currentPnl * 0.90).toFixed(2)} = {calcResult.withdrawable.toFixed(2)} USDT
              </p>
            </div>
          )}
          {calcResult.currentPnl <= 0 && (
            <div className="px-5 pb-4">
              <p className="text-xs text-zinc-600">
                收益為負，無管理費；可提領 = {calcResult.investment.toLocaleString()} + ({calcResult.currentPnl.toFixed(2)}) = {calcResult.withdrawable.toFixed(2)} USDT
              </p>
            </div>
          )}
          {isAdmin && (
            <div className="px-5 pb-5 flex justify-end">
              <Button
                onClick={settleParticipant}
                disabled={settling}
                className="bg-red-600 hover:bg-red-500 text-white font-semibold gap-2">
                <BadgeCheck className="w-4 h-4" />
                {settling ? '結算中...' : '正式結算'}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Historical Participants */}
      {showHistory && settledRows.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-zinc-400" />
              <p className="font-semibold text-sm text-zinc-300">歷史參與者</p>
              <span className="text-xs text-zinc-600">（已結算，僅供紀錄）</span>
            </div>
            <button onClick={() => setShowHistory(false)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                  <th className="text-left px-4 py-3">姓名</th>
                  <th className="text-right px-4 py-3">投入金額</th>
                  <th className="text-center px-4 py-3">開始投入日期</th>
                  <th className="text-right px-4 py-3">最終損益</th>
                  <th className="text-right px-4 py-3">收益率</th>
                  <th className="text-right px-4 py-3">可提領金額</th>
                  <th className="text-center px-4 py-3">結算日期</th>
                </tr>
              </thead>
              <tbody>
                {settledRows.map(p => {
                  const pnl = p.final_pnl ?? 0
                  const fee = pnl > 0 ? pnl * 0.10 : 0
                  const withdrawable = pnl > 0 ? p.investment + pnl * 0.90 : p.investment + pnl
                  const returnPct = p.investment > 0 ? (pnl / p.investment) * 100 : 0
                  const settledDate = p.settled_at ? new Date(p.settled_at).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' }) : '—'
                  return (
                    <tr key={p.id} className="border-b border-zinc-800/50 text-zinc-400">
                      <td className="px-4 py-3 font-medium text-zinc-300">{p.name}</td>
                      <td className="px-4 py-3 text-right font-mono">{p.investment.toLocaleString()} USDT</td>
                      <td className="px-4 py-3 text-center">{p.start_date}</td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${pnlColor(pnl)}`}>
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)} USDT
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-bold ${pnlColor(returnPct)}`}>
                        {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-green-400 font-bold">
                        {withdrawable.toFixed(2)} USDT
                        {fee > 0 && <span className="text-xs text-zinc-600 ml-1">（含管理費 {fee.toFixed(2)}）</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-500 text-xs">{settledDate}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Seed & Bind dialog */}
      {seedFor && (
        <SeedAndBindDialog
          investment={seedFor.investment}
          onClose={() => setSeedFor(null)}
          onCreated={(session_id) => {
            updateField(seedFor.id, 'bound_session_id', session_id)
            setSeedFor(null)
            // Refresh sessions list after creation
            refreshAll()
          }}
        />
      )}
    </div>
  )
}
