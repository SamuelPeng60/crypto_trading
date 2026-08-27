'use client'
import { useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Candidate {
  strategyId: number
  name: string
  type: string
  symbol: string
  mode: string
  tradeSize: number
  price: number | null
  isTrend: boolean
  stDirection: 'long' | 'short' | null
  stLine: number | null
  barsInDir: number | null
  allowed: boolean
  reason: string
}

interface Props { open: boolean; onClose: () => void; onDone: () => void }

export default function ManualBuyDialog({ open, onClose, onDone }: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(false)
  const [buying, setBuying] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/positions/buyable')
      const data = await res.json()
      setCandidates(data.candidates ?? [])
    } catch {
      toast.error('讀取可買入清單失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) load() }, [open, load])

  const buy = async (c: Candidate) => {
    if (!confirm(`確定以現價買入 ${c.symbol} $${c.tradeSize} USDT？（${c.mode === 'live' ? '🔴 實盤' : '🟡 模擬'}）`)) return
    setBuying(c.strategyId)
    try {
      const res = await fetch('/api/positions/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategyId: c.strategyId }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success(`${c.symbol} ${data.message}`)
        onDone()
        load()
      } else {
        toast.error(data.message ?? '買入失敗')
      }
    } catch {
      toast.error('買入失敗')
    } finally {
      setBuying(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>手動買入</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            手動進場不在回測模型內。趨勢策略的績效建立在「只在方向翻轉點進場」，
            在趨勢中段接手的風險報酬分布與回測不同。出場仍由策略決定。
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" /> 讀取中…
          </div>
        ) : candidates.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">沒有可買入的策略（啟用中的策略都已有持倉）</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {candidates.map(c => {
              const dropPct = c.stLine && c.price ? ((c.stLine - c.price) / c.price) * 100 : null
              return (
                <div key={c.strategyId} className="border border-zinc-800 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.symbol.replace('USDT', '/USDT')}</span>
                    <span className="text-xs text-zinc-500">{c.name}</span>
                    <span className="text-xs">{c.mode === 'live' ? '🔴' : '🟡'}</span>
                  </div>
                  <p className="text-xs text-zinc-400">
                    現價 ${c.price?.toLocaleString() ?? '–'} · 下單 ${c.tradeSize.toLocaleString()} USDT
                  </p>
                  {c.isTrend && c.stLine != null && (
                    <p className="text-xs text-zinc-400">
                      ST {c.stDirection === 'long' ? '多頭' : '空頭'}（已 {c.barsInDir} 棒）· 翻空線 ${c.stLine.toFixed(2)}
                      {dropPct != null && (
                        <span className={dropPct < -8 ? 'text-red-400' : 'text-zinc-400'}> （{dropPct.toFixed(1)}%）</span>
                      )}
                    </p>
                  )}
                  {!c.allowed && (
                    <p className="text-xs text-red-400">⛔ {c.reason}</p>
                  )}
                  <Button
                    size="sm"
                    disabled={!c.allowed || buying !== null}
                    onClick={() => buy(c)}
                    className="w-full mt-1"
                  >
                    {buying === c.strategyId ? '買入中…' : '買入'}
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
