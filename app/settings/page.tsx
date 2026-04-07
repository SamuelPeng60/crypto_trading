'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Shield, Eye, EyeOff, CheckCircle, AlertTriangle, Bell, Zap, FlaskConical } from 'lucide-react'
import { useAuth } from '@/components/auth-provider'

interface Settings {
  apiKey: string; apiSecret: string; mode: string
  maxDailyLoss: number; maxPositionSize: number
  telegramBotToken: string; telegramChatId: string
  hasCredentials: boolean; hasTelegram: boolean
}

export default function SettingsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  useEffect(() => { if (!loading && user?.role !== 'admin') router.replace('/') }, [loading, user, router])

  const [settings, setSettings] = useState<Settings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [mode, setMode] = useState('paper')
  const [maxDailyLoss, setMaxDailyLoss] = useState('500')
  const [maxPositionSize, setMaxPositionSize] = useState('0')
  const [telegramBotToken, setTelegramBotToken] = useState('')
  const [telegramChatId, setTelegramChatId] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<'binance' | 'telegram' | null>(null)
  const [maxStratTradeSize, setMaxStratTradeSize] = useState(0)
  const [stratCount, setStratCount] = useState(0)

  const loadSettings = () =>
    fetch('/api/settings').then(r => r.json()).then((s: Settings) => {
      setSettings(s)
      setApiKey(s.apiKey)
      setMode(s.mode)
      setMaxDailyLoss(String(s.maxDailyLoss))
      setMaxPositionSize(String(s.maxPositionSize))
      setTelegramChatId(s.telegramChatId)
    })

  useEffect(() => {
    loadSettings()
    fetch('/api/strategies').then(r => r.json()).then((strats: { params: string; is_active: number }[]) => {
      const active = strats.filter(s => s.is_active)
      setStratCount(active.length)
      const sizes = active.map(s => { try { return Number(JSON.parse(s.params).tradeSize) || 0 } catch { return 0 } })
      setMaxStratTradeSize(sizes.length ? Math.max(...sizes) : 0)
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, string | number> = {
        mode,
        maxDailyLoss: Number(maxDailyLoss),
        maxPositionSize: Number(maxPositionSize),
        telegramChatId,
      }
      if (apiKey && !apiKey.startsWith('****')) body.apiKey = apiKey
      if (apiSecret) body.apiSecret = apiSecret
      if (telegramBotToken) body.telegramBotToken = telegramBotToken
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      toast.success('設定已儲存')
      setApiSecret('')
      setTelegramBotToken('')
      await loadSettings()
    } catch {
      toast.error('儲存失敗')
    } finally {
      setSaving(false)
    }
  }

  const test = async (action: 'binance' | 'telegram') => {
    setTesting(action)
    try {
      // Pass current form values directly so test works even before saving
      const body: Record<string, string> = { action }
      if (action === 'binance') {
        if (apiKey && !apiKey.startsWith('****')) body.apiKey = apiKey
        if (apiSecret) body.apiSecret = apiSecret
      }
      if (action === 'telegram') {
        if (telegramBotToken) body.telegramBotToken = telegramBotToken
        body.telegramChatId = telegramChatId
      }
      const res = await fetch('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) toast.success(data.message)
      else toast.error(data.error)
    } catch {
      toast.error('測試失敗')
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">系統設定</h1>
        <p className="text-zinc-500 text-sm mt-1">配置交易所 API、風控參數與通知</p>
      </div>

      {/* Trading Mode */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          {mode === 'live'
            ? <Zap className="w-4 h-4 text-red-400" />
            : <FlaskConical className="w-4 h-4 text-yellow-400" />}
          交易模式
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {(['paper', 'live'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`p-4 rounded-xl border text-left transition-all ${
                mode === m
                  ? m === 'live' ? 'border-red-500 bg-red-500/5' : 'border-yellow-500 bg-yellow-500/5'
                  : 'border-zinc-700 hover:border-zinc-600'
              }`}
            >
              <p className="font-medium flex items-center gap-2">
                {m === 'live' && <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />}
                {m === 'paper' ? '模擬交易' : '實盤交易'}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {m === 'paper' ? '不執行真實訂單，適合測試策略' : '使用真實資金，需填寫 API Key'}
              </p>
            </button>
          ))}
        </div>
        {mode === 'live' && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">實盤模式將使用真實資金執行交易，請確認風控設定後再啟用。</p>
          </div>
        )}
      </div>

      {/* API Credentials */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-yellow-400" />
          <h2 className="font-semibold">Binance API 金鑰</h2>
          {settings?.hasCredentials && (
            <span className="flex items-center gap-1 text-xs text-green-400 ml-auto">
              <CheckCircle className="w-3.5 h-3.5" /> 已設定
            </span>
          )}
        </div>
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200">建議只開放現貨交易權限，禁用提款。API Secret 加密儲存在本地。</p>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <Input value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="貼上你的 Binance API Key"
              className="bg-zinc-800 border-zinc-700 font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label>API Secret</Label>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={apiSecret}
                onChange={e => setApiSecret(e.target.value)}
                placeholder={settings?.hasCredentials ? '留空保留原有 Secret' : '貼上你的 API Secret'}
                className="bg-zinc-800 border-zinc-700 font-mono text-sm pr-10"
              />
              <button type="button" onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
        <Button variant="outline" size="sm"
          className="border-zinc-700 hover:bg-zinc-800 text-zinc-300"
          onClick={() => test('binance')}
          disabled={testing === 'binance'}>
          {testing === 'binance' ? '測試中…' : '測試 API 連線'}
        </Button>
      </div>

      {/* Risk Management */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-400" />
          風控設定
        </h2>
        {/* Position size warning */}
        {maxStratTradeSize > 0 && Number(maxPositionSize) > 0 && Number(maxPositionSize) < maxStratTradeSize && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200">
              單筆最大倉位 ({maxPositionSize} USDT) 低於目前策略最高 tradeSize ({maxStratTradeSize} USDT)，
              下單金額會被靜默截斷，實際持倉小於預期。建議設為 <strong>{maxStratTradeSize}</strong> 以上或 0（不限制）。
            </p>
          </div>
        )}
        {/* Daily loss warning */}
        {maxStratTradeSize > 0 && stratCount > 0 && Number(maxDailyLoss) > 0 && Number(maxDailyLoss) < maxStratTradeSize && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200">
              每日最大虧損 ({maxDailyLoss} USDT) 低於單筆 tradeSize ({maxStratTradeSize} USDT)，
              一次止損就可能觸發全體停止。目前有 {stratCount} 個策略運行中，
              建議至少設為 <strong>{maxStratTradeSize}</strong> USDT 以上。
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>每日最大虧損 (USDT)</Label>
            <Input value={maxDailyLoss} onChange={e => setMaxDailyLoss(e.target.value)}
              className={`bg-zinc-800 border-zinc-700 ${maxStratTradeSize > 0 && Number(maxDailyLoss) > 0 && Number(maxDailyLoss) < maxStratTradeSize ? 'border-amber-500/60' : ''}`} />
            <p className="text-xs text-zinc-500">模擬 & 實盤均適用 · 達到後自動停止所有策略</p>
          </div>
          <div className="space-y-1.5">
            <Label>單筆最大倉位 (USDT)</Label>
            <Input value={maxPositionSize} onChange={e => setMaxPositionSize(e.target.value)}
              className={`bg-zinc-800 border-zinc-700 ${maxStratTradeSize > 0 && Number(maxPositionSize) > 0 && Number(maxPositionSize) < maxStratTradeSize ? 'border-red-500/60' : ''}`} />
            <p className="text-xs text-zinc-500">模擬 & 實盤均適用 · 0 = 不限制</p>
          </div>
        </div>
        {maxStratTradeSize > 0 && (
          <p className="text-xs text-zinc-500 border-t border-zinc-800 pt-3">
            目前 {stratCount} 個運行中策略 · 最高單筆 tradeSize：{maxStratTradeSize} USDT
          </p>
        )}
      </div>

      {/* Telegram Notifications */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-blue-400" />
          <h2 className="font-semibold">Telegram 通知</h2>
          {settings?.hasTelegram && (
            <span className="flex items-center gap-1 text-xs text-green-400 ml-auto">
              <CheckCircle className="w-3.5 h-3.5" /> 已設定
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500">交易訊號、止損/止盈、風控停止時自動推播通知</p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Bot Token</Label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={telegramBotToken}
                onChange={e => setTelegramBotToken(e.target.value)}
                placeholder={settings?.hasTelegram ? '留空保留原有 Token' : '從 @BotFather 取得'}
                className="bg-zinc-800 border-zinc-700 font-mono text-sm pr-10"
              />
              <button type="button" onClick={() => setShowToken(!showToken)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Chat ID</Label>
            <Input value={telegramChatId} onChange={e => setTelegramChatId(e.target.value)}
              placeholder="你的 Telegram User ID 或群組 ID"
              className="bg-zinc-800 border-zinc-700 font-mono text-sm" />
            <p className="text-xs text-zinc-500">傳訊息給 @userinfobot 可取得你的 Chat ID</p>
          </div>
        </div>
        <Button variant="outline" size="sm"
          className="border-zinc-700 hover:bg-zinc-800 text-zinc-300"
          onClick={() => test('telegram')}
          disabled={testing === 'telegram'}>
          {testing === 'telegram' ? '傳送中…' : '傳送測試通知'}
        </Button>
      </div>

      <Button onClick={save} disabled={saving}
        className="bg-yellow-500 text-zinc-900 hover:bg-yellow-400 font-semibold px-8">
        {saving ? '儲存中…' : '儲存設定'}
      </Button>
    </div>
  )
}
