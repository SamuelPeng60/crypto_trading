// 回測 vs 實盤：2026-08-17 ~ now，四幣 live 配置
import { backtestSupertrendMacd } from '../lib/backtest'
interface Kline { time:number; open:number; high:number; low:number; close:number; volume:number }
const BASE='https://data-api.binance.vision'
const P = (m:number)=>({ atrPeriod:14, multiplier:m, ema200Filter:true, macdFast:12, macdSlow:26, macdSignal:9, tradeSize:1000 })
const CFG = [
  { s:'BTCUSDT', p:P(3.0) },
  { s:'ETHUSDT', p:P(2.0) },
  { s:'SOLUSDT', p:P(3.0) },
  { s:'BNBUSDT', p:P(2.5) },
]
async function fetchKlines(symbol:string,startMs:number,endMs:number){
  const all:Kline[]=[]; let from=startMs
  while(from<endMs){
    const res=await fetch(`${BASE}/api/v3/klines?symbol=${symbol}&interval=4h&startTime=${from}&limit=1000`)
    const d=await res.json() as unknown[][]
    if(!d.length) break
    for(const k of d){ if((k[0] as number)>endMs) break; all.push({time:Math.floor((k[0] as number)/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}) }
    from=(d[d.length-1][0] as number)+1
    if(d.length<1000) break
  }
  return all
}
async function main(){
  const START='2026-08-17T00:00:00Z', END='2026-09-12T02:00:00Z'
  const s0=new Date(START).getTime(), e0=new Date(END).getTime()
  for(const c of CFG){
    const kl=await fetchKlines(c.s, s0-400*86400_000, e0)
    const startSec=s0/1000
    const wi=kl.findIndex(k=>k.time>=startSec)
    const sliced=kl.slice(Math.max(0,wi-250))
    const r=backtestSupertrendMacd(sliced as never, c.p as never, 10000)
    const sells=r.trades.filter((t)=>t.side==='sell')
    const pnl=sells.reduce((a,t)=>a+(t.pnl??0),0)
    console.log(`\n=== ${c.s} mult=${c.p.multiplier} ===`)
    for(const t of r.trades) console.log(`  ${new Date((t as any).time*1000).toISOString().slice(0,16)}  ${t.side}  @${(t as any).price.toFixed(2)}  ${t.pnl!=null?(t.pnl>=0?'+':'')+t.pnl.toFixed(2):''}`)
    console.log(`  回測損益: ${pnl.toFixed(2)}  (${sells.length} 筆)`)
  }
}
main()
