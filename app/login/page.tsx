'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Bitcoin, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')

  // Redirect if already logged in
  useEffect(() => {
    fetch('/api/auth/me').then(r => { if (r.ok) router.replace('/') }).catch(() => {})
  }, [router])
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '登入失敗'); return }
      // Full reload so AuthProvider re-fetches user role from scratch
      window.location.href = '/'
    } catch {
      setError('網路錯誤，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 rounded-2xl bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
            <Bitcoin className="w-8 h-8 text-yellow-400" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold tracking-wide">Crypto Trader</h1>
            <p className="text-sm text-zinc-500 mt-0.5">請登入以繼續</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm text-zinc-400">帳號</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              placeholder="請輸入帳號"
              className="w-full h-10 px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-yellow-500/50 focus:border-yellow-500/50 transition-colors"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm text-zinc-400">密碼</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="請輸入密碼"
                className="w-full h-10 px-3 pr-10 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-yellow-500/50 focus:border-yellow-500/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full h-10 rounded-lg bg-yellow-500 text-zinc-900 font-semibold text-sm hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '登入中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  )
}
