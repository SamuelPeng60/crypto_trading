'use client'
import { useEffect, useState } from 'react'
import { Archive, ChevronDown, ChevronUp, PackagePlus, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useAuth } from '@/components/auth-provider'
import { toast } from 'sonner'

interface ArchiveRecord {
  id: number
  name: string
  notes: string | null
  period_start: string | null
  period_end: string | null
  total_pnl: number
  total_trades: number
  win_rate: number
  created_at: string
}

interface Order {
  id: number
  symbol: string
  side: string
  filled_price: number | null
  quantity: number
  pnl: number | null
  mode: string
  strategy_name: string | null
  created_at: string
  closed_at: string | null
}

function PnlBadge({ pnl }: { pnl: number }) {
  if (pnl > 0) return <span className="text-green-400 font-mono">+{pnl.toFixed(2)}</span>
  if (pnl < 0) return <span className="text-red-400 font-mono">{pnl.toFixed(2)}</span>
  return <span className="text-zinc-400 font-mono">0.00</span>
}

function ArchiveCard({ archive, isAdmin }: { archive: ArchiveRecord; isAdmin: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)

  async function loadOrders() {
    if (orders.length > 0) { setExpanded(e => !e); return }
    setLoadingOrders(true)
    setExpanded(true)
    const res = await fetch(`/api/orders?archiveId=${archive.id}&limit=500`)
    if (res.ok) setOrders(await res.json())
    setLoadingOrders(false)
  }

  const pnlColor = archive.total_pnl > 0 ? 'text-green-400' : archive.total_pnl < 0 ? 'text-red-400' : 'text-zinc-400'
  const PnlIcon = archive.total_pnl > 0 ? TrendingUp : archive.total_pnl < 0 ? TrendingDown : Minus

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center gap-4 cursor-pointer hover:bg-zinc-800/50 transition-colors" onClick={loadOrders}>
        <Archive className="w-5 h-5 text-zinc-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-zinc-100 truncate">{archive.name}</span>
            {archive.notes && <span className="text-xs text-zinc-500 truncate">— {archive.notes}</span>}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {archive.period_start && archive.period_end
              ? `${archive.period_start} ～ ${archive.period_end}`
              : archive.created_at.slice(0, 10)}
            　封存於 {archive.created_at.slice(0, 16).replace('T', ' ')}
          </div>
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-6 text-sm shrink-0">
          <div className="text-center">
            <div className="text-zinc-500 text-xs">已結清</div>
            <div className="text-zinc-200">{archive.total_trades} 筆</div>
          </div>
          <div className="text-center">
            <div className="text-zinc-500 text-xs">勝率</div>
            <div className="text-zinc-200">{archive.win_rate.toFixed(1)}%</div>
          </div>
          <div className="text-center">
            <div className="text-zinc-500 text-xs">總損益</div>
            <div className={`flex items-center gap-1 font-mono font-medium ${pnlColor}`}>
              <PnlIcon className="w-3.5 h-3.5" />
              {archive.total_pnl >= 0 ? '+' : ''}{archive.total_pnl.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Mobile PnL */}
        <div className={`sm:hidden font-mono font-medium text-sm ${pnlColor}`}>
          {archive.total_pnl >= 0 ? '+' : ''}{archive.total_pnl.toFixed(2)}
        </div>

        <div className="text-zinc-500 shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Expanded: Orders Table */}
      {expanded && (
        <div className="border-t border-zinc-800">
          {loadingOrders ? (
            <div className="p-6 text-center text-zinc-500 text-sm">載入中...</div>
          ) : orders.length === 0 ? (
            <div className="p-6 text-center text-zinc-500 text-sm">此封存沒有交易記錄</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500 border-b border-zinc-800">
                    <th className="text-left px-4 py-2">時間</th>
                    <th className="text-left px-4 py-2">幣種</th>
                    <th className="text-left px-4 py-2">方向</th>
                    <th className="text-right px-4 py-2">成交價</th>
                    <th className="text-right px-4 py-2">數量</th>
                    <th className="text-right px-4 py-2">損益</th>
                    <th className="text-left px-4 py-2">策略</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={o.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-2 text-zinc-400 text-xs whitespace-nowrap">
                        {(o.closed_at ?? o.created_at).slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="px-4 py-2 text-zinc-200 font-medium">{o.symbol.replace('USDT', '')}</td>
                      <td className="px-4 py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${o.side === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                          {o.side === 'buy' ? '買入' : '賣出'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-200 font-mono">
                        {(o.filled_price ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right text-zinc-400 font-mono text-xs">
                        {o.quantity.toFixed(4)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">
                        {o.pnl != null ? <PnlBadge pnl={o.pnl} /> : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-2 text-zinc-500 text-xs truncate max-w-[140px]">
                        {o.strategy_name ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-zinc-700 bg-zinc-800/30">
                    <td colSpan={5} className="px-4 py-2 text-xs text-zinc-500">
                      共 {orders.length} 筆　已結清 {orders.filter(o => o.pnl != null).length} 筆
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-medium">
                      <PnlBadge pnl={orders.filter(o => o.pnl != null).reduce((s, o) => s + (o.pnl ?? 0), 0)} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ArchivesPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [archives, setArchives] = useState<ArchiveRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [archiving, setArchiving] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [archiveName, setArchiveName] = useState('')
  const [archiveNotes, setArchiveNotes] = useState('')

  async function loadArchives() {
    const res = await fetch('/api/archives')
    if (res.ok) setArchives(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadArchives() }, [])

  async function handleArchive() {
    if (archiving) return
    setArchiving(true)
    const res = await fetch('/api/archives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: archiveName, notes: archiveNotes }),
    })
    const data = await res.json()
    if (!res.ok) {
      toast.error(data.error ?? '封存失敗')
    } else {
      toast.success(`封存完成　${data.totalTrades} 筆交易　損益 ${data.totalPnl >= 0 ? '+' : ''}${data.totalPnl.toFixed(2)}`)
      setShowDialog(false)
      setArchiveName('')
      setArchiveNotes('')
      loadArchives()
    }
    setArchiving(false)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Archive className="w-6 h-6 text-zinc-400" />
          <h1 className="text-xl font-semibold text-zinc-100">歷史封存</h1>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowDialog(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded-lg transition-colors"
          >
            <PackagePlus className="w-4 h-4" />
            封存目前紀錄
          </button>
        )}
      </div>

      {/* Archive Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md mx-4 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <PackagePlus className="w-5 h-5 text-amber-400" />
              封存目前紀錄
            </h2>
            <p className="text-sm text-zinc-400">
              將目前所有交易記錄存入歷史，並停止所有執行中的策略。封存後頁面將顯示空白，等待新策略產生資料。
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">封存名稱</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                  placeholder={`封存 ${new Date().toLocaleDateString('zh-TW')}`}
                  value={archiveName}
                  onChange={e => setArchiveName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">備註（選填）</label>
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                  placeholder="例：deploy 前的舊版本紀錄"
                  value={archiveNotes}
                  onChange={e => setArchiveNotes(e.target.value)}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => { setShowDialog(false); setArchiveName(''); setArchiveNotes('') }}
                className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {archiving ? '封存中...' : '確認封存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archives List */}
      {loading ? (
        <div className="text-center py-16 text-zinc-500">載入中...</div>
      ) : archives.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <Archive className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>尚無封存紀錄</p>
          {isAdmin && <p className="text-xs mt-1">點擊右上角「封存目前紀錄」開始</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {archives.map(a => (
            <ArchiveCard key={a.id} archive={a} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  )
}
