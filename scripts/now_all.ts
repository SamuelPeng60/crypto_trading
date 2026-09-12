import { supertrend, ema } from '../lib/indicators'
interface Kline { time:number; open:number; high:number; low:number; close:number; volume:number }
const BASE='https://data-api.binance.vision'
const CFG: [string, number][] = [['BTCUSDT',3.0],['ETHUSDT',2.0],['SOLUSDT',3.0],['BNBUSDT',2.5]]

function macd(c:number[],f=12,s=26,sig=9){
  const ef=ema(c,f), es=ema(c,s)
  const line=c.map((_,i)=> (isNaN(ef[i])||isNaN(es[i]))?NaN:ef[i]-es[i])
  const valid=line.filter(v=>!isNaN(v))
  const sigv=ema(valid,sig)
  const off=line.length-valid.length
  const signal=line.map((_,i)=> i<off?NaN:sigv[i-off])
  return { hist: line.map((v,i)=> (isNaN(v)||isNaN(signal[i]))?NaN:v-signal[i]) }
}

async function main(){
  for (const [sym,mult] of CFG) {
    const res = await fetch(`${BASE}/api/v3/klines?symbol=${sym}&interval=4h&limit=1000`)
    const d = await res.json() as unknown[][]
    const kl: Kline[] = d.map(k=>({time:Math.floor((k[0] as number)/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}))
    const live = kl[kl.length-1].close
    const conf = kl.slice(0,-1)
    const c = conf.map(k=>k.close)
    const n = conf.length
    const e200 = ema(c,200)
    const h = macd(c).hist
    const {trend,direction} = supertrend(conf,14,mult)
    let bars=1; for(let i=n-2;i>=0 && direction[i]===direction[n-1];i--) bars++
    const dir = direction[n-1]===1?'多頭':'空頭'
    console.log(`${sym}  mult=${mult}  現價=${live}`)
    console.log(`  ST=${dir} 已 ${bars} 棒 (${(bars*4/24).toFixed(1)}天)  ST線=${trend[n-1].toFixed(2)}  距現價 ${((trend[n-1]/live-1)*100).toFixed(1)}%`)
    console.log(`  MACD hist=${h[n-1].toFixed(2)}  EMA200=${e200[n-1].toFixed(2)}  價>EMA200: ${c[n-1]>e200[n-1]?'✅':'❌'}`)
    // 統計近 180 天翻轉次數
    let flips=0; const start=Math.max(1,n-180*6)
    for(let i=start;i<n;i++) if(direction[i]!==direction[i-1]) flips++
    console.log(`  近 ${((n-start)*4/24).toFixed(0)} 天 ST 翻轉 ${flips} 次`)
  }
}
main()
