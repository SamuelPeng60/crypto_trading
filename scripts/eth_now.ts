import { supertrend, ema } from '../lib/indicators'
interface Kline { time:number; open:number; high:number; low:number; close:number; volume:number }
const BASE='https://data-api.binance.vision'
async function main(){
  const res = await fetch(`${BASE}/api/v3/klines?symbol=ETHUSDT&interval=4h&limit=1000`)
  const d = await res.json() as unknown[][]
  const kl: Kline[] = d.map(k=>({time:Math.floor((k[0] as number)/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))
  const conf = kl.slice(0,-1)   // 已收盤棒 = 引擎看到的
  const c = conf.map(k=>k.close)
  const e200 = ema(c,200)
  const n = conf.length
  console.log(`最後已收盤棒 ${new Date(conf[n-1].time*1000).toISOString()}  close=${conf[n-1].close}  EMA200=${e200[n-1].toFixed(1)}`)
  for (const m of [2.0,2.5,3.0]) {
    const {trend,direction} = supertrend(conf,14,m)
    let bars=1; for(let i=n-2;i>=0 && direction[i]===direction[n-1];i--) bars++
    console.log(`mult=${m.toFixed(1)}  方向=${direction[n-1]===1?'多頭':'空頭'}  已持續 ${bars} 棒(${(bars*4/24).toFixed(1)}天)  ST線=${trend[n-1].toFixed(1)} (距現價 ${((trend[n-1]/conf[n-1].close-1)*100).toFixed(1)}%)`)
  }
}
main()
