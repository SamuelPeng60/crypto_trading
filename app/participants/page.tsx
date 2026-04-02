'use client'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2, Calculator, Check, X } from 'lucide-react'

interface Participant {
  id: number
  name: string
  investment: number
  start_date: string
  current_pnl: number
  note: string | null
}

interface CalcResult {
  id: number
  name: string
  investment: number
  durationDays: number
  currentPnl: number
  returnPct: number
  fee: number         // 5% 抽成（僅正收益時）
  withdrawable: number
}

function calcDays(start: string): number {
  const s = new Date(start).getTime()
  const now = Date.now()
  return Math.max(0, Math.floor((now - s) / (1000 * 60 * 60 * 24)))
}

function formatDuration(days: number): string {
  if (days === 0) return '不到 1 天'
  if (days < 30) return `${days} 天`
  const months = Math.floor(days / 30)
  const rem = days % 30
  return rem > 0 ? `${months} 個月 ${rem} 天` : `${months} 個月`
}

export default function ParticipantsPage() {
  const [rows, setRows] = useState<Participant[]>([])
  const [editing, setEditing] = useState<Record<number, Participant>>({})
  const [calcResult, setCalcResult] = useState<CalcResult | null>(null)
  const [saving, setSaving] = useState<Record<number, boolean>>({})

  useEffect(() => { load() }, [])

  const load = async () => {
    const res = await fetch('/api/participants')
    const data = await res.json()
    setRows(data)
  }

  const startEdit = (p: Participant) => {
    setEditing(prev => ({ ...prev, [p.id]: { ...p } }))
  }

  const cancelEdit = (id: number) => {
    setEditing(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const saveEdit = async (id: number) => {
    const e = editing[id]
    if (!e) return
    setSaving(prev => ({ ...prev, [id]: true }))
    await fetch('/api/participants', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(e),
    })
    await load()
    cancelEdit(id)
    setSaving(prev => ({ ...prev, [id]: false }))
  }

  const addRow = async () => {
    const today = new Date().toISOString().split('T')[0]
    const res = await fetch('/api/participants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '新參與者', investment: 0, start_date: today, current_pnl: 0 }),
    })
    const { id } = await res.json()
    await load()
    const fresh = await fetch('/api/participants').then(r => r.json())
    const newRow = fresh.find((p: Participant) => p.id === id)
    if (newRow) startEdit(newRow)
  }

  const deleteRow = async (id: number) => {
    if (!confirm('確定要刪除此參與者？')) return
    await fetch('/api/participants', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (calcResult?.id === id) setCalcResult(null)
    await load()
    toast.success('已刪除')
  }

  const calculate = (p: Participant) => {
    const pnl = p.current_pnl
    const fee = pnl > 0 ? pnl * 0.05 : 0
    const withdrawable = pnl > 0
      ? p.investment + pnl * 0.95
      : p.investment + pnl
    setCalcResult({
      id: p.id,
      name: p.name,
      investment: p.investment,
      durationDays: calcDays(p.start_date),
      currentPnl: pnl,
      returnPct: p.investment > 0 ? (pnl / p.investment) * 100 : 0,
      fee,
      withdrawable,
    })
  }

  const updateField = (id: number, field: keyof Participant, value: string | number) => {
    setEditing(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }))
  }

  const pnlColor = (v: number) => v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-zinc-400'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">參與者</h1>
          <p className="text-zinc-500 text-sm mt-1">管理投資人資訊與結算試算</p>
        </div>
        <Button
          onClick={addRow}
          className="bg-yellow-500 text-zinc-900 hover:bg-yellow-400 font-semibold"
        >
          <Plus className="w-4 h-4 mr-1" />
          新增參與者
        </Button>
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                <th className="text-left px-4 py-3">姓名</th>
                <th className="text-right px-4 py-3">投入金額 (USDT)</th>
                <th className="text-center px-4 py-3">投入時間點</th>
                <th className="text-right px-4 py-3">目前收益 (USDT)</th>
                <th className="text-right px-4 py-3">收益率</th>
                <th className="text-center px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-600">
                    尚無參與者，點擊「新增參與者」開始
                  </td>
                </tr>
              )}
              {rows.map(p => {
                const e = editing[p.id]
                const isEditing = !!e
                const cur = isEditing ? e : p
                const returnPct = cur.investment > 0
                  ? (cur.current_pnl / cur.investment) * 100
                  : 0

                return (
                  <tr
                    key={p.id}
                    className={`border-b border-zinc-800/50 transition-colors ${
                      calcResult?.id === p.id ? 'bg-yellow-500/5' : 'hover:bg-zinc-800/30'
                    }`}
                  >
                    {/* 姓名 */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <Input
                          value={e.name}
                          onChange={ev => updateField(p.id, 'name', ev.target.value)}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-28"
                        />
                      ) : (
                        <span
                          className="font-medium cursor-pointer hover:text-yellow-400 transition-colors"
                          onClick={() => startEdit(p)}
                        >
                          {p.name}
                        </span>
                      )}
                    </td>

                    {/* 投入金額 */}
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={e.investment}
                          onChange={ev => updateField(p.id, 'investment', Number(ev.target.value))}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-28 text-right"
                        />
                      ) : (
                        <span
                          className="font-mono cursor-pointer hover:text-yellow-400 transition-colors"
                          onClick={() => startEdit(p)}
                        >
                          {p.investment.toLocaleString()} U
                        </span>
                      )}
                    </td>

                    {/* 投入時間點 */}
                    <td className="px-4 py-3 text-center">
                      {isEditing ? (
                        <Input
                          type="date"
                          value={e.start_date}
                          onChange={ev => updateField(p.id, 'start_date', ev.target.value)}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-36"
                        />
                      ) : (
                        <span
                          className="text-zinc-300 cursor-pointer hover:text-yellow-400 transition-colors"
                          onClick={() => startEdit(p)}
                        >
                          {p.start_date}
                          <span className="text-zinc-600 ml-1 text-xs">（{formatDuration(calcDays(p.start_date))}）</span>
                        </span>
                      )}
                    </td>

                    {/* 目前收益 */}
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={e.current_pnl}
                          onChange={ev => updateField(p.id, 'current_pnl', Number(ev.target.value))}
                          className="bg-zinc-800 border-zinc-700 h-8 text-sm w-28 text-right"
                        />
                      ) : (
                        <span
                          className={`font-mono cursor-pointer hover:opacity-80 transition-opacity ${pnlColor(p.current_pnl)}`}
                          onClick={() => startEdit(p)}
                        >
                          {p.current_pnl >= 0 ? '+' : ''}{p.current_pnl.toLocaleString()} U
                        </span>
                      )}
                    </td>

                    {/* 收益率 */}
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-bold ${pnlColor(returnPct)}`}>
                        {returnPct >= 0 ? '+' : ''}{returnPct.toFixed(2)}%
                      </span>
                    </td>

                    {/* 操作 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              className="h-7 px-2 bg-green-600 hover:bg-green-500 text-white"
                              onClick={() => saveEdit(p.id)}
                              disabled={saving[p.id]}
                            >
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 border-zinc-700 text-zinc-400"
                              onClick={() => cancelEdit(p.id)}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              className="h-7 px-2.5 bg-yellow-500 text-zinc-900 hover:bg-yellow-400 font-semibold text-xs"
                              onClick={() => calculate(p)}
                            >
                              <Calculator className="w-3 h-3 mr-1" />
                              試算
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-500/50"
                              onClick={() => deleteRow(p.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
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
                結算試算 —
                <span className="text-yellow-400 ml-1">{calcResult.name}</span>
              </p>
            </div>
            <button
              onClick={() => setCalcResult(null)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {/* 投入金額 */}
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">投入金額</p>
              <p className="text-lg font-bold font-mono">
                {calcResult.investment.toLocaleString()}
                <span className="text-xs text-zinc-500 ml-1">U</span>
              </p>
            </div>

            {/* 投資時間 */}
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">投資時間</p>
              <p className="text-lg font-bold">
                {formatDuration(calcResult.durationDays)}
              </p>
            </div>

            {/* 收益 */}
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">目前收益</p>
              <p className={`text-lg font-bold font-mono ${pnlColor(calcResult.currentPnl)}`}>
                {calcResult.currentPnl >= 0 ? '+' : ''}{calcResult.currentPnl.toLocaleString()}
                <span className="text-xs ml-1">U</span>
              </p>
            </div>

            {/* 收益率 */}
            <div className="bg-zinc-800/60 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">收益率</p>
              <p className={`text-lg font-bold font-mono ${pnlColor(calcResult.returnPct)}`}>
                {calcResult.returnPct >= 0 ? '+' : ''}{calcResult.returnPct.toFixed(2)}%
              </p>
            </div>

            {/* 抽成 */}
            <div className={`rounded-lg p-3.5 space-y-1 ${calcResult.fee > 0 ? 'bg-red-500/10 border border-red-500/20' : 'bg-zinc-800/60'}`}>
              <p className="text-xs text-zinc-500">
                {calcResult.fee > 0 ? '我的抽成 (5%)' : '抽成'}
              </p>
              <p className={`text-lg font-bold font-mono ${calcResult.fee > 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                {calcResult.fee > 0 ? `−${calcResult.fee.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                {calcResult.fee > 0 && <span className="text-xs ml-1">U</span>}
              </p>
            </div>

            {/* 可提領 */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3.5 space-y-1">
              <p className="text-xs text-zinc-500">
                可提領金額
                {calcResult.currentPnl > 0 && (
                  <span className="ml-1 text-zinc-600">（本金 + 收益×95%）</span>
                )}
              </p>
              <p className="text-lg font-bold font-mono text-green-400">
                {calcResult.withdrawable.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                <span className="text-xs ml-1">U</span>
              </p>
              {calcResult.currentPnl > 0 && (
                <p className="text-xs text-zinc-600">
                  {calcResult.investment.toLocaleString()} + {(calcResult.currentPnl * 0.95).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </p>
              )}
            </div>
          </div>

          {/* Note about fee */}
          {calcResult.currentPnl > 0 && (
            <div className="px-5 pb-4">
              <p className="text-xs text-zinc-600">
                收益正報酬時，收益的 5% 為管理費（
                {calcResult.currentPnl.toLocaleString()} × 5% = {calcResult.fee.toLocaleString(undefined, { maximumFractionDigits: 2 })} U）；
                可提領 = {calcResult.investment.toLocaleString()} + {calcResult.currentPnl.toLocaleString()} × 95% = {calcResult.withdrawable.toLocaleString(undefined, { maximumFractionDigits: 2 })} U
              </p>
            </div>
          )}
          {calcResult.currentPnl <= 0 && (
            <div className="px-5 pb-4">
              <p className="text-xs text-zinc-600">
                收益為負時，無管理費；
                可提領 = {calcResult.investment.toLocaleString()} + ({calcResult.currentPnl.toLocaleString()}) = {calcResult.withdrawable.toLocaleString(undefined, { maximumFractionDigits: 2 })} U
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
