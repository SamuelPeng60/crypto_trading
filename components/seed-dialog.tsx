'use client'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

interface Props { open: boolean; onClose: () => void; initialMode?: 'paper' | 'live' }

const STRATEGY_TYPES = [
  { value: 'vwap_bb_rsi',    label: 'Crypto Pulse（VWAP + BB + RSI）' },
  { value: 'ma_cross',       label: 'MA 交叉' },
  { value: 'rsi',            label: 'RSI 超買超賣' },
  { value: 'supertrend',     label: 'SuperTrend（ATR）' },
  { value: 'ema_ribbon_st',  label: 'EMA Ribbon + SuperTrend（趨勢追蹤）' },
  { value: 'macd_bb_squeeze',label: 'MACD + BB Squeeze（突破）' },
  { value: 'adaptive_combo', label: '自適應組合（趨勢+均值回歸）' },
]

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']
const SYMBOL_LABEL: Record<string, string> = { BTCUSDT: 'BTC', ETHUSDT: 'ETH', BNBUSDT: 'BNB', SOLUSDT: 'SOL' }
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']

const STRATEGY_DEFAULT_INTERVAL: Record<string, string> = {
  ma_cross:        '4h',
  rsi:             '4h',
  grid:            '4h',
  supertrend:      '4h',
  vwap_bb_rsi:     '4h',
  ema_ribbon_st:   '4h',
  macd_bb_squeeze: '1h',
  adaptive_combo:  '4h',
}

const STRATEGY_BEST_RETURN_INTERVAL: Record<string, string> = {
  ma_cross:        '1d',
  rsi:             '4h',
  grid:            '4h',
  supertrend:      '4h',
  vwap_bb_rsi:     '4h',
  ema_ribbon_st:   '4h',
  macd_bb_squeeze: '1d',
  adaptive_combo:  '4h',
}

function defaultParams(type: string, interval: string, tradeSize: number) {
  if (type === 'vwap_bb_rsi') return {
    interval, rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
    bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
    atrPeriod: 14, atrSlMultiplier: 1.5,
    volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35,
    tradeSize,
  }
  if (type === 'ma_cross') return {
    interval, fastPeriod: 10, slowPeriod: 30, maType: 'ema',
    tradeSize, stopLoss: 3, takeProfit: 6,
  }
  if (type === 'rsi') return {
    interval, period: 14, oversold: 30, overbought: 70,
    tradeSize, stopLoss: 3, takeProfit: 6,
  }
  if (type === 'supertrend') return {
    interval, atrPeriod: 10, multiplier: 3, ema200Filter: true, tradeSize,
  }
  if (type === 'ema_ribbon_st') return {
    interval, fastEma: 5, midEma: 8, slowEma: 21,
    atrPeriod: 14, multiplier: 3.5, ema200Filter: true,
    atrSlMultiplier: 2.0, tradeSize,
  }
  if (type === 'macd_bb_squeeze') return {
    interval, macdFast: 12, macdSlow: 26, macdSignal: 9,
    bbPeriod: 15, rsiPeriod: 14, atrPeriod: 14,
    atrSlMultiplier: 2, atrTpMultiplier: 5, ema200Filter: true, tradeSize,
  }
  if (type === 'adaptive_combo') return {
    interval, fastEma: 5, midEma: 13, slowEma: 34,
    atrPeriod: 14, multiplier: 2.5, ema200Filter: true, atrSlMultiplier: 1.5,
    rsiPeriod: 14, rsiOversold: 35, rsiOverbought: 65,
    bbPeriod: 20, bbStdDev: 2, vwapWindow: 24,
    volRegimeShort: 20, volRegimeLong: 60, volRegimeThreshold: 1.35,
    tradeSize,
  }
  return { interval, tradeSize }
}

export default function SeedDialog({ open, onClose, initialMode = 'paper' }: Props) {
  const [type, setType] = useState('vwap_bb_rsi')
  const [interval, setInterval] = useState(STRATEGY_DEFAULT_INTERVAL['vwap_bb_rsi'])
  const [tradeSize, setTradeSize] = useState('1000')
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([...SYMBOLS])
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<'paper' | 'live'>(initialMode)

  useEffect(() => { if (open) setMode(initialMode) }, [open, initialMode])

  const handleTypeChange = (v: string) => {
    setType(v)
    setInterval(STRATEGY_DEFAULT_INTERVAL[v] ?? '4h')
  }

  const toggleSymbol = (sym: string) => {
    setSelectedSymbols(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    )
  }

  const typeLabel: Record<string, string> = {
    vwap_bb_rsi: 'Crypto Pulse', ma_cross: 'MA Cross',
    rsi: 'RSI', supertrend: 'SuperTrend',
    ema_ribbon_st: 'EMA Ribbon', macd_bb_squeeze: 'MACD Squeeze',
    adaptive_combo: '自適應組合',
  }

  const create = async () => {
    if (!selectedSymbols.length) { toast.error('請至少選一個幣種'); return }
    setSaving(true)
    try {
      const params = defaultParams(type, interval, Number(tradeSize))
      const session_id = `sess_${Date.now()}`
      await Promise.all(selectedSymbols.map(symbol =>
        fetch('/api/strategies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${typeLabel[type]} ${SYMBOL_LABEL[symbol]}`,
            type, symbol, params, session_id, mode,
          }),
        })
      ))
      // Activate all in this session
      const res = await fetch('/api/strategies')
      const all = await res.json()
      await Promise.all(
        all
          .filter((s: { session_id: string; is_active: number }) =>
            s.session_id === session_id && !s.is_active
          )
          .map((s: { id: number }) =>
            fetch(`/api/strategies/${s.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ is_active: 1 }),
            })
          )
      )
      const modeLabel = mode === 'live' ? '實盤' : '模擬'
      toast.success(`已建立並啟動 ${selectedSymbols.length} 個 ${typeLabel[type]} ${modeLabel}策略`)
      onClose()
    } catch {
      toast.error('建立失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            一鍵建立策略
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              mode === 'live'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
            }`}>
              {mode === 'live' ? '🔴 實盤' : '🟡 模擬'}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Mode toggle */}
          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            <button
              onClick={() => setMode('paper')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === 'paper'
                  ? 'bg-yellow-500/20 text-yellow-400'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              🟡 模擬盤
            </button>
            <button
              onClick={() => setMode('live')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === 'live'
                  ? 'bg-red-500/20 text-red-400'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              🔴 實盤
            </button>
          </div>
          {mode === 'live' && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              實盤模式將使用 Binance API 真實下單，請確認 Settings 已設定 API Key 且帳戶有足夠資金。
            </p>
          )}
          {/* Strategy type */}
          <div className="space-y-1.5">
            <Label>策略類型</Label>
            <Select value={type} onValueChange={handleTypeChange}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {STRATEGY_TYPES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Interval + trade size */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label>時間框架</Label>
                {interval === STRATEGY_BEST_RETURN_INTERVAL[type] && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 leading-none">
                    回報最高
                  </span>
                )}
              </div>
              <Select value={interval} onValueChange={setInterval}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {INTERVALS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>每筆金額 (USDT)</Label>
              <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)}
                className="bg-zinc-800 border-zinc-700" />
            </div>
          </div>

          {/* Symbol selection */}
          <div className="space-y-2">
            <Label>交易對</Label>
            <div className="grid grid-cols-4 gap-2">
              {SYMBOLS.map(sym => {
                const active = selectedSymbols.includes(sym)
                const colors: Record<string, string> = {
                  BTCUSDT: 'border-yellow-500 bg-yellow-500/10 text-yellow-400',
                  ETHUSDT: 'border-blue-500 bg-blue-500/10 text-blue-400',
                  BNBUSDT: 'border-amber-500 bg-amber-500/10 text-amber-400',
                  SOLUSDT: 'border-purple-500 bg-purple-500/10 text-purple-400',
                }
                return (
                  <button
                    key={sym}
                    onClick={() => toggleSymbol(sym)}
                    className={`py-2 rounded-lg border text-sm font-medium transition-all ${
                      active ? colors[sym] : 'border-zinc-700 text-zinc-500 hover:border-zinc-600'
                    }`}
                  >
                    {SYMBOL_LABEL[sym]}
                  </button>
                )
              })}
            </div>
          </div>

          <p className="text-xs text-zinc-500">
            將建立 {selectedSymbols.length} 個策略，使用預設參數並自動啟動
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1 border-zinc-700 hover:bg-zinc-800" onClick={onClose}>
            取消
          </Button>
          <Button
            className={`flex-1 ${mode === 'live'
              ? 'bg-red-500 text-white hover:bg-red-400'
              : 'bg-yellow-500 text-zinc-900 hover:bg-yellow-400'
            }`}
            onClick={create}
            disabled={saving || !selectedSymbols.length}
          >
            {saving ? '建立中…' : `建立 ${selectedSymbols.length} 個${mode === 'live' ? '實盤' : '模擬'}策略`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
