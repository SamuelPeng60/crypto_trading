'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { BarChart2, TrendingUp, FlaskConical, History, Settings, Bitcoin, Trophy, Users, LogOut, KeyRound, ShieldCheck, X, Eye, EyeOff, Archive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from './auth-provider'
import { useState } from 'react'
import { toast } from 'sonner'

const COMMON_LINKS = [
  { href: '/',             label: '總覽',    icon: BarChart2 },
  { href: '/strategies',   label: '策略',    icon: TrendingUp },
  { href: '/performance',  label: '績效',    icon: Trophy },
  { href: '/backtest',     label: '回測',    icon: FlaskConical },
  { href: '/participants', label: '參與者',  icon: Users },
  { href: '/trades',       label: '交易記錄', icon: History },
  { href: '/archives',     label: '歷史封存', icon: Archive },
]

const ADMIN_ONLY_LINKS = [
  { href: '/settings',     label: '設定',    icon: Settings },
  { href: '/admin/users',  label: '使用者管理', icon: ShieldCheck },
]

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [showOld, setShowOld] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPw !== confirmPw) { toast.error('新密碼與確認密碼不符'); return }
    if (newPw.length < 6) { toast.error('新密碼至少 6 個字元'); return }
    setLoading(true)
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
    })
    setLoading(false)
    if (res.ok) { toast.success('密碼已更新'); onClose() }
    else { const d = await res.json(); toast.error(d.error ?? '更新失敗') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-yellow-400" />
            <span className="font-semibold text-sm">變更密碼</span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">目前密碼</label>
            <div className="relative">
              <input type={showOld ? 'text' : 'password'} value={oldPw} onChange={e => setOldPw(e.target.value)}
                className="w-full h-9 px-3 pr-9 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500/50" />
              <button type="button" onClick={() => setShowOld(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500">
                {showOld ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">新密碼</label>
            <div className="relative">
              <input type={showNew ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                className="w-full h-9 px-3 pr-9 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500/50" />
              <button type="button" onClick={() => setShowNew(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500">
                {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">確認新密碼</label>
            <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-zinc-800 border border-zinc-700 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500/50" />
          </div>
          <button type="submit" disabled={loading || !oldPw || !newPw || !confirmPw}
            className="w-full h-9 rounded-lg bg-yellow-500 text-zinc-900 font-semibold text-sm hover:bg-yellow-400 transition-colors disabled:opacity-50">
            {loading ? '更新中…' : '確認變更'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const [showChangePw, setShowChangePw] = useState(false)

  // Don't render sidebar on login page
  if (pathname === '/login') return null
  if (loading) return <aside className="w-56 shrink-0 bg-zinc-900 border-r border-zinc-800" />

  const isAdmin = user?.role === 'admin'

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <>
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
      <aside className="w-56 shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-5 flex items-center gap-2 border-b border-zinc-800">
          <Bitcoin className="text-yellow-400 w-6 h-6" />
          <span className="font-bold text-sm tracking-wide">Crypto Trader</span>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {COMMON_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                pathname === href
                  ? 'bg-yellow-500/10 text-yellow-400 font-medium'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          ))}

          {isAdmin && (
            <>
              <div className="pt-2 pb-1 px-3">
                <div className="border-t border-zinc-800" />
                <p className="text-xs text-zinc-600 mt-2">管理員</p>
              </div>
              {ADMIN_ONLY_LINKS.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                    pathname === href
                      ? 'bg-yellow-500/10 text-yellow-400 font-medium'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="px-3 py-3 border-t border-zinc-800 space-y-1">
          {/* User info */}
          <div className="px-3 py-2 rounded-lg bg-zinc-800/50 flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-full bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-yellow-400">{user?.username?.[0]?.toUpperCase()}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-200 truncate">{user?.username}</p>
              <p className="text-xs text-zinc-500">{user?.role === 'admin' ? '管理員' : '使用者'}</p>
            </div>
          </div>
          <button onClick={() => setShowChangePw(true)}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors">
            <KeyRound className="w-3.5 h-3.5" />
            變更密碼
          </button>
          <button onClick={logout}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs text-zinc-500 hover:text-red-400 hover:bg-red-500/5 transition-colors">
            <LogOut className="w-3.5 h-3.5" />
            登出
          </button>
        </div>
      </aside>
    </>
  )
}
