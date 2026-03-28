'use client'
import { cn } from '@/lib/utils'

interface Props {
  symbol: string
  price: number
  change: number
  volume: number
  selected?: boolean
  onClick?: () => void
}

const COIN_COLOR: Record<string, string> = {
  BTCUSDT: 'text-yellow-400',
  ETHUSDT: 'text-blue-400',
  SOLUSDT: 'text-purple-400',
  BNBUSDT: 'text-amber-400',
}

const COIN_LABEL: Record<string, string> = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
  SOLUSDT: 'SOL',
  BNBUSDT: 'BNB',
}

export default function TickerCard({ symbol, price, change, volume, selected, onClick }: Props) {
  const positive = change >= 0
  return (
    <button
      onClick={onClick}
      className={cn(
        'text-left p-4 rounded-xl border transition-all',
        selected
          ? 'border-yellow-500/60 bg-yellow-500/5'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-600'
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className={cn('font-bold text-base', COIN_COLOR[symbol])}>{COIN_LABEL[symbol]}/USDT</span>
        <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded', positive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400')}>
          {positive ? '+' : ''}{change.toFixed(2)}%
        </span>
      </div>
      <p className="text-xl font-mono font-semibold">
        ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <p className="text-xs text-zinc-500 mt-1">
        Vol: ${(volume / 1e6).toFixed(1)}M
      </p>
    </button>
  )
}
