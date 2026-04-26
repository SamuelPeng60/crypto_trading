'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth-provider'
import { ShieldCheck, Plus, Trash2, KeyRound, Check, X } from 'lucide-react'
import { toast } from 'sonner'

interface UserRow {
  id: number
  username: string
  role: 'admin' | 'user'
  created_at: string
}

export default function AdminUsersPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserRow[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user')
  const [adding, setAdding] = useState(false)
  const [resetId, setResetId] = useState<number | null>(null)
  const [resetPw, setResetPw] = useState('')

  useEffect(() => {
    if (!loading && user?.role !== 'admin') router.replace('/')
  }, [loading, user, router])

  const load = async () => {
    const res = await fetch('/api/auth/users')
    if (res.ok) setUsers(await res.json())
  }

  useEffect(() => { load() }, [])

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    const res = await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
    })
    setAdding(false)
    if (res.ok) {
      toast.success(`已新增使用者 ${newUsername}`)
      setNewUsername(''); setNewPassword(''); setShowAdd(false)
      load()
    } else {
      const d = await res.json(); toast.error(d.error ?? '新增失敗')
    }
  }

  const deleteUser = async (u: UserRow) => {
    if (!confirm(`確定要刪除「${u.username}」？`)) return
    const res = await fetch('/api/auth/users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: u.id }),
    })
    if (res.ok) { toast.success('已刪除'); load() }
    else { const d = await res.json(); toast.error(d.error ?? '刪除失敗') }
  }

  const resetPassword = async (id: number) => {
    if (!resetPw || resetPw.length < 12) { toast.error('密碼至少 12 個字元'); return }
    const res = await fetch('/api/auth/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password: resetPw }),
    })
    if (res.ok) { toast.success('密碼已重設'); setResetId(null); setResetPw('') }
    else { const d = await res.json(); toast.error(d.error ?? '重設失敗') }
  }

  if (loading || user?.role !== 'admin') return null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-yellow-400" />
          <div>
            <h1 className="text-2xl font-bold">使用者管理</h1>
            <p className="text-zinc-500 text-sm mt-0.5">管理系統帳號與權限</p>
          </div>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-yellow-500 text-zinc-900 font-semibold text-sm hover:bg-yellow-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
          新增使用者
        </button>
      </div>

      {/* Add user form */}
      {showAdd && (
        <form onSubmit={addUser} className="bg-zinc-900 border border-yellow-500/30 rounded-xl p-5">
          <p className="text-sm font-semibold mb-4 text-yellow-400">新增使用者</p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">帳號</label>
              <input value={newUsername} onChange={e => setNewUsername(e.target.value)}
                placeholder="請輸入帳號"
                className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500/50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">密碼（至少 12 碼）</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="請輸入密碼"
                className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500/50" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">角色</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'user')}
                className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none">
                <option value="user">使用者（觀看）</option>
                <option value="admin">管理員（全權）</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={adding || !newUsername || !newPassword}
                className="flex-1 h-9 rounded-lg bg-yellow-500 text-zinc-900 font-semibold text-sm hover:bg-yellow-400 transition-colors disabled:opacity-50">
                {adding ? '新增中…' : '確認新增'}
              </button>
              <button type="button" onClick={() => setShowAdd(false)}
                className="h-9 px-3 rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm transition-colors">
                取消
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Users table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-xs text-zinc-500">
              <th className="text-left px-4 py-3">帳號</th>
              <th className="text-left px-4 py-3">角色</th>
              <th className="text-left px-4 py-3">建立時間</th>
              <th className="text-center px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="px-4 py-3 font-medium">
                  {u.username}
                  {u.id === user?.id && <span className="ml-2 text-xs text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">自己</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    u.role === 'admin'
                      ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                      : 'bg-zinc-700 text-zinc-300'
                  }`}>
                    {u.role === 'admin' ? '管理員' : '使用者'}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-500 text-xs">
                  {new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-2">
                    {resetId === u.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="password"
                          placeholder="新密碼"
                          value={resetPw}
                          onChange={e => setResetPw(e.target.value)}
                          className="h-7 px-2 w-28 rounded bg-zinc-800 border border-zinc-700 text-xs focus:outline-none focus:ring-1 focus:ring-yellow-500/50"
                        />
                        <button onClick={() => resetPassword(u.id)}
                          className="h-7 px-2 rounded bg-green-600 hover:bg-green-500 text-white">
                          <Check className="w-3 h-3" />
                        </button>
                        <button onClick={() => { setResetId(null); setResetPw('') }}
                          className="h-7 px-2 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button onClick={() => { setResetId(u.id); setResetPw('') }}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-yellow-400 hover:bg-zinc-800 transition-colors">
                          <KeyRound className="w-3 h-3" />
                          重設密碼
                        </button>
                        {u.id !== user?.id && (
                          <button onClick={() => deleteUser(u)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-500 hover:text-red-400 hover:bg-red-500/5 transition-colors">
                            <Trash2 className="w-3 h-3" />
                            刪除
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4">
        <p className="text-xs text-zinc-500 leading-relaxed">
          <span className="text-yellow-400 font-medium">管理員</span>：可存取所有功能，包含策略設定、參數調整、Settings、使用者管理。<br />
          <span className="text-zinc-300 font-medium">使用者</span>：唯讀權限，可查看總覽、策略運行狀況（不顯示參數）、績效、回測結果、交易記錄、參與者。
        </p>
      </div>
    </div>
  )
}
