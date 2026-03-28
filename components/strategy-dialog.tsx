'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d']

type StratType = 'ma_cross' | 'rsi' | 'grid' | 'supertrend' | 'vwap_bb_rsi' | 'ema_ribbon_st' | 'macd_bb_squeeze'

const STRATEGY_DEFAULT_INTERVAL: Record<StratType, string> = {
  ma_cross:        '4h',
  rsi:             '4h',
  grid:            '4h',
  supertrend:      '4h',
  vwap_bb_rsi:     '4h',
  ema_ribbon_st:   '4h',
  macd_bb_squeeze: '1h',
}

interface Props { open: boolean; onClose: () => void }

export default function StrategyDialog({ open, onClose }: Props) {
  const [type, setType] = useState<StratType>('ma_cross')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState(STRATEGY_DEFAULT_INTERVAL['ma_cross'])
  const [saving, setSaving] = useState(false)

  // MA Cross params
  const [fastPeriod, setFastPeriod] = useState('10')
  const [slowPeriod, setSlowPeriod] = useState('30')
  const [maType, setMaType] = useState('ema')
  const [tradeSize, setTradeSize] = useState('1000')
  const [stopLoss, setStopLoss] = useState('3')
  const [takeProfit, setTakeProfit] = useState('6')

  // RSI params
  const [rsiPeriod, setRsiPeriod] = useState('14')
  const [oversold, setOversold] = useState('30')
  const [overbought, setOverbought] = useState('70')

  // Grid params
  const [upperPrice, setUpperPrice] = useState('')
  const [lowerPrice, setLowerPrice] = useState('')
  const [gridCount, setGridCount] = useState('10')
  const [amountPerGrid, setAmountPerGrid] = useState('100')
  // SuperTrend params
  const [atrPeriod, setAtrPeriod] = useState('10')
  const [multiplier, setMultiplier] = useState('3')
  const [ema200Filter, setEma200Filter] = useState('true')
  // VWAP+BB+RSI params
  const [vwapWindow, setVwapWindow] = useState('48')
  const [bbPeriod, setBbPeriod] = useState('20')
  const [bbStdDev, setBbStdDev] = useState('2')
  const [vwapRsiPeriod, setVwapRsiPeriod] = useState('14')
  const [vwapOversold, setVwapOversold] = useState('35')
  const [vwapOverbought, setVwapOverbought] = useState('65')
  const [vwapAtrPeriod, setVwapAtrPeriod] = useState('14')
  const [atrSlMultiplier, setAtrSlMultiplier] = useState('1.0')
  // EMA Ribbon + SuperTrend params
  const [fastEma, setFastEma] = useState('5')
  const [midEma, setMidEma] = useState('8')
  const [slowEma, setSlowEma] = useState('21')
  const [ribbonAtrPeriod, setRibbonAtrPeriod] = useState('14')
  const [ribbonMultiplier, setRibbonMultiplier] = useState('3.5')
  const [ribbonEma200, setRibbonEma200] = useState('true')
  const [ribbonAtrSl, setRibbonAtrSl] = useState('2.0')
  // MACD+BB Squeeze params
  const [macdFast, setMacdFast] = useState('12')
  const [macdSlow, setMacdSlow] = useState('26')
  const [macdSignalP, setMacdSignalP] = useState('9')
  const [squeezeBbPeriod, setSqueezeBbPeriod] = useState('15')
  const [squeezeRsiPeriod, setSqueezeRsiPeriod] = useState('14')
  const [squeezeAtrPeriod, setSqueezeAtrPeriod] = useState('14')
  const [squeezeAtrSl, setSqueezeAtrSl] = useState('2')
  const [squeezeAtrTp, setSqueezeAtrTp] = useState('5')
  const [squeezeEma200, setSqueezeEma200] = useState('true')

  const handleTypeChange = (v: StratType) => {
    setType(v)
    setInterval(STRATEGY_DEFAULT_INTERVAL[v])
  }

  const getParams = () => {
    if (type === 'ma_cross') return {
      interval,
      fastPeriod: Number(fastPeriod), slowPeriod: Number(slowPeriod),
      maType, tradeSize: Number(tradeSize),
      stopLoss: Number(stopLoss), takeProfit: Number(takeProfit),
    }
    if (type === 'rsi') return {
      interval,
      period: Number(rsiPeriod), oversold: Number(oversold),
      overbought: Number(overbought), tradeSize: Number(tradeSize),
      stopLoss: Number(stopLoss), takeProfit: Number(takeProfit),
    }
    if (type === 'supertrend') return {
      interval,
      atrPeriod: Number(atrPeriod), multiplier: Number(multiplier),
      ema200Filter: ema200Filter === 'true', tradeSize: Number(tradeSize),
    }
    if (type === 'vwap_bb_rsi') return {
      interval,
      rsiPeriod: Number(vwapRsiPeriod), rsiOversold: Number(vwapOversold),
      rsiOverbought: Number(vwapOverbought), bbPeriod: Number(bbPeriod),
      bbStdDev: Number(bbStdDev), vwapWindow: Number(vwapWindow),
      atrPeriod: Number(vwapAtrPeriod), atrSlMultiplier: Number(atrSlMultiplier),
      tradeSize: Number(tradeSize),
    }
    if (type === 'ema_ribbon_st') return {
      interval,
      fastEma: Number(fastEma), midEma: Number(midEma), slowEma: Number(slowEma),
      atrPeriod: Number(ribbonAtrPeriod), multiplier: Number(ribbonMultiplier),
      ema200Filter: ribbonEma200 === 'true',
      atrSlMultiplier: Number(ribbonAtrSl), tradeSize: Number(tradeSize),
    }
    if (type === 'macd_bb_squeeze') return {
      interval,
      macdFast: Number(macdFast), macdSlow: Number(macdSlow), macdSignal: Number(macdSignalP),
      bbPeriod: Number(squeezeBbPeriod), rsiPeriod: Number(squeezeRsiPeriod),
      atrPeriod: Number(squeezeAtrPeriod), atrSlMultiplier: Number(squeezeAtrSl),
      atrTpMultiplier: Number(squeezeAtrTp), ema200Filter: squeezeEma200 === 'true',
      tradeSize: Number(tradeSize),
    }
    return {
      interval,
      upperPrice: Number(upperPrice), lowerPrice: Number(lowerPrice),
      gridCount: Number(gridCount), amountPerGrid: Number(amountPerGrid),
    }
  }

  const save = async () => {
    if (!name.trim()) { toast.error('請填寫策略名稱'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/strategies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, symbol, params: getParams() }),
      })
      if (!res.ok) throw new Error()
      toast.success('策略已建立')
      onClose()
      setName('')
    } catch {
      toast.error('建立失敗')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-lg">
        <DialogHeader>
          <DialogTitle>新增策略</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Basic */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>策略名稱</Label>
              <Input value={name} onChange={e => setName(e.target.value)}
                placeholder="我的MA策略" className="bg-zinc-800 border-zinc-700" />
            </div>
            <div className="space-y-1.5">
              <Label>交易對</Label>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-800 border-zinc-700">
                  {SYMBOLS.map(s => <SelectItem key={s} value={s}>{s.replace('USDT', '/USDT')}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>時間框架</Label>
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
            <Label>策略類型</Label>
            <Select value={type} onValueChange={v => handleTypeChange(v as StratType)}>
              <SelectTrigger className="bg-zinc-800 border-zinc-700 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                <SelectItem value="ma_cross">MA 交叉（移動平均交叉）</SelectItem>
                <SelectItem value="rsi">RSI 超買超賣</SelectItem>
                <SelectItem value="grid">網格交易</SelectItem>
                <SelectItem value="supertrend">SuperTrend（ATR 動態止損）</SelectItem>
                <SelectItem value="vwap_bb_rsi">Crypto Pulse（VWAP+BB+RSI）</SelectItem>
                <SelectItem value="ema_ribbon_st">EMA Ribbon + SuperTrend（趨勢追蹤）</SelectItem>
                <SelectItem value="macd_bb_squeeze">MACD + BB Squeeze（突破）</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* MA Cross */}
          {type === 'ma_cross' && (
            <div className="space-y-3 p-3 bg-zinc-800/50 rounded-lg">
              <p className="text-xs text-zinc-400">快線週期 &lt; 慢線週期時出現交叉訊號</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">快線週期</Label>
                  <Input value={fastPeriod} onChange={e => setFastPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">慢線週期</Label>
                  <Input value={slowPeriod} onChange={e => setSlowPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">MA 類型</Label>
                  <Select value={maType} onValueChange={setMaType}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="ema">EMA</SelectItem>
                      <SelectItem value="sma">SMA</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">每筆金額 (USDT)</Label>
                  <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止損 %</Label>
                  <Input value={stopLoss} onChange={e => setStopLoss(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止盈 %</Label>
                  <Input value={takeProfit} onChange={e => setTakeProfit(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
            </div>
          )}

          {/* RSI */}
          {type === 'rsi' && (
            <div className="space-y-3 p-3 bg-zinc-800/50 rounded-lg">
              <p className="text-xs text-zinc-400">RSI ≤ 超賣閾值買入，RSI ≥ 超買閾值賣出</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">RSI 週期</Label>
                  <Input value={rsiPeriod} onChange={e => setRsiPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">超賣 (買入)</Label>
                  <Input value={oversold} onChange={e => setOversold(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">超買 (賣出)</Label>
                  <Input value={overbought} onChange={e => setOverbought(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">每筆金額 (USDT)</Label>
                  <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止損 %</Label>
                  <Input value={stopLoss} onChange={e => setStopLoss(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止盈 %</Label>
                  <Input value={takeProfit} onChange={e => setTakeProfit(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
            </div>
          )}

          {/* Grid */}
          {type === 'grid' && (
            <div className="space-y-3 p-3 bg-zinc-800/50 rounded-lg">
              <p className="text-xs text-zinc-400">在上下界範圍內等間距掛單，震盪行情效果最佳</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">價格上限 (USDT)</Label>
                  <Input value={upperPrice} onChange={e => setUpperPrice(e.target.value)} className="bg-zinc-800 border-zinc-700" placeholder="e.g. 110000" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">價格下限 (USDT)</Label>
                  <Input value={lowerPrice} onChange={e => setLowerPrice(e.target.value)} className="bg-zinc-800 border-zinc-700" placeholder="e.g. 90000" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">格數</Label>
                  <Input value={gridCount} onChange={e => setGridCount(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">每格金額 (USDT)</Label>
                  <Input value={amountPerGrid} onChange={e => setAmountPerGrid(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
            </div>
          )}

          {/* SuperTrend */}
          {type === 'supertrend' && (
            <div className="space-y-3 p-3 bg-zinc-800/50 rounded-lg">
              <p className="text-xs text-zinc-400">ATR 動態追蹤止損，趨勢反轉時自動切換方向</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">ATR 週期</Label>
                  <Input value={atrPeriod} onChange={e => setAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">乘數</Label>
                  <Input value={multiplier} onChange={e => setMultiplier(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">EMA200 過濾</Label>
                  <Select value={ema200Filter} onValueChange={setEma200Filter}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="true">開啟</SelectItem>
                      <SelectItem value="false">關閉</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">每筆金額 (USDT)</Label>
                <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700" />
              </div>
            </div>
          )}

          {/* VWAP+BB+RSI */}
          {type === 'vwap_bb_rsi' && (
            <div className="space-y-3 p-3 bg-zinc-800/50 rounded-lg">
              <p className="text-xs text-zinc-400">均值回歸策略：價格跌破 BB 下軌且 RSI 超賣，在 VWAP 上方買入</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">VWAP 視窗</Label>
                  <Input value={vwapWindow} onChange={e => setVwapWindow(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">BB 週期</Label>
                  <Input value={bbPeriod} onChange={e => setBbPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">BB 倍數</Label>
                  <Input value={bbStdDev} onChange={e => setBbStdDev(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">RSI 週期</Label>
                  <Input value={vwapRsiPeriod} onChange={e => setVwapRsiPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">RSI 超賣</Label>
                  <Input value={vwapOversold} onChange={e => setVwapOversold(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">RSI 超買</Label>
                  <Input value={vwapOverbought} onChange={e => setVwapOverbought(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">每筆 (USDT)</Label>
                  <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">ATR 週期</Label>
                  <Input value={vwapAtrPeriod} onChange={e => setVwapAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止損 ATR 倍數</Label>
                  <Input value={atrSlMultiplier} onChange={e => setAtrSlMultiplier(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
            </div>
          )}
          {/* EMA Ribbon + SuperTrend */}
          {type === 'ema_ribbon_st' && (
            <div className="space-y-3 p-3 bg-zinc-800/50 rounded-lg">
              <p className="text-xs text-zinc-400">EMA 9/21/55 多頭排列 + SuperTrend 翻多時買入，趨勢破壞時出場</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">快線 EMA</Label>
                  <Input value={fastEma} onChange={e => setFastEma(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">中線 EMA</Label>
                  <Input value={midEma} onChange={e => setMidEma(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">慢線 EMA</Label>
                  <Input value={slowEma} onChange={e => setSlowEma(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">ATR 週期</Label>
                  <Input value={ribbonAtrPeriod} onChange={e => setRibbonAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">ST 乘數</Label>
                  <Input value={ribbonMultiplier} onChange={e => setRibbonMultiplier(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止損 ATR 倍</Label>
                  <Input value={ribbonAtrSl} onChange={e => setRibbonAtrSl(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">每筆金額 (USDT)</Label>
                  <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">EMA200 過濾</Label>
                  <Select value={ribbonEma200} onValueChange={setRibbonEma200}>
                    <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-zinc-800 border-zinc-700">
                      <SelectItem value="true">開啟</SelectItem>
                      <SelectItem value="false">關閉</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* MACD + BB Squeeze */}
          {type === 'macd_bb_squeeze' && (
            <div className="space-y-3 p-3 bg-zinc-800/50 rounded-lg">
              <p className="text-xs text-zinc-400">BB 擠壓後突破 + MACD 直方圖翻正 + RSI 40-65，ATR 止損/止盈 R:R 2:1</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">MACD 快線</Label>
                  <Input value={macdFast} onChange={e => setMacdFast(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">MACD 慢線</Label>
                  <Input value={macdSlow} onChange={e => setMacdSlow(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">訊號線</Label>
                  <Input value={macdSignalP} onChange={e => setMacdSignalP(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">BB 週期</Label>
                  <Input value={squeezeBbPeriod} onChange={e => setSqueezeBbPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">RSI 週期</Label>
                  <Input value={squeezeRsiPeriod} onChange={e => setSqueezeRsiPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">ATR 週期</Label>
                  <Input value={squeezeAtrPeriod} onChange={e => setSqueezeAtrPeriod(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">每筆 (USDT)</Label>
                  <Input value={tradeSize} onChange={e => setTradeSize(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止損 ATR 倍</Label>
                  <Input value={squeezeAtrSl} onChange={e => setSqueezeAtrSl(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">止盈 ATR 倍</Label>
                  <Input value={squeezeAtrTp} onChange={e => setSqueezeAtrTp(e.target.value)} className="bg-zinc-800 border-zinc-700" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">EMA200 過濾</Label>
                <Select value={squeezeEma200} onValueChange={setSqueezeEma200}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="true">開啟</SelectItem>
                    <SelectItem value="false">關閉</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1 border-zinc-700 hover:bg-zinc-800" onClick={onClose}>取消</Button>
          <Button className="flex-1 bg-yellow-500 text-zinc-900 hover:bg-yellow-400" onClick={save} disabled={saving}>
            {saving ? '建立中…' : '建立策略'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
