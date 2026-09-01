import { backtestSupertrendMacd } from '../lib/backtest'
interface Kline { time:number; open:number; high:number; low:number; close:number; volume:number }
const BASE='https://data-api.binance.vision', CAPITAL=10000
const LIVE:[string,number,number][]=[['BTCUSDT',14,3.0],['ETHUSDT',14,2.0],['SOLUSDT',14,3.0],['BNBUSDT',14,2.5]]
const PERIODS=[
  {label:'2021',start:'2021-01-01',end:'2021-12-31'},
  {label:'2022',start:'2022-01-01',end:'2022-12-31'},
  {label:'2023',start:'2023-01-01',end:'2023-12-31'},
  {label:'2024',start:'2024-01-01',end:'2024-12-31'},
  {label:'2025',start:'2025-01-01',end:'2025-12-31'},
  {label:'26YTD',start:'2026-01-01',end:'2026-09-01'},
]
async function fetchKlines(sym:string,s:number,e:number):Promise<Kline[]>{
  const all:Kline[]=[];let from=s
  while(from<e){
    const res=await fetch(`${BASE}/api/v3/klines?symbol=${sym}&interval=4h&startTime=${from}&limit=1000`)
    const d=await res.json() as unknown[][];if(!d.length)break
    for(const k of d){if((k[0] as number)>e)break;all.push({time:Math.floor((k[0] as number)/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]})}
    from=(d[d.length-1][0] as number)+1;if(d.length<1000)break
  }
  return all
}
const pnlOf=(r:{trades:{side:string;pnl?:number}[]})=>r.trades.filter(t=>t.side==='sell').reduce((s,t)=>s+(t.pnl??0),0)
async function main(){
  console.log('live 配置 EMA200 開/關 逐期損益（每筆 1000 USDT）\n')
  console.log('幣種   EMA200'+PERIODS.map(p=>p.label.padStart(9)).join('')+'    合計   ex2021  筆數  最大回撤')
  console.log('-'.repeat(105))
  const tot:Record<string,number[]>={on:[],off:[]}
  for(const [sym,a,m] of LIVE){
    const data:Record<string,Kline[]>={}
    for(const p of PERIODS){
      const warm=new Date(p.start).getTime()-90*86400_000
      const endMs=new Date(p.end+'T23:59:59Z').getTime()
      const kl=await fetchKlines(sym,warm,endMs)
      const ss=new Date(p.start).getTime()/1000
      const wi=kl.findIndex(k=>k.time>=ss)
      data[p.label]=kl.slice(Math.max(0,wi-250))
    }
    for(const flag of [true,false]){
      const p={atrPeriod:a,multiplier:m,ema200Filter:flag,macdFast:12,macdSlow:26,macdSignal:9,tradeSize:1000}
      const cells:string[]=[];let t=0,e=0,c=0,mx=0
      for(const per of PERIODS){
        const r=backtestSupertrendMacd(data[per.label] as never,p,CAPITAL)
        const v=pnlOf(r);t+=v;c+=r.totalTrades;if(r.maxDrawdown>mx)mx=r.maxDrawdown
        if(per.label!=='2021')e+=v
        cells.push(v.toFixed(0).padStart(9))
      }
      tot[flag?'on':'off'].push(t)
      console.log(`${sym.replace('USDT','').padEnd(6)} ${(flag?'開':'關').padEnd(6)}`+cells.join('')+`${t.toFixed(0).padStart(8)}${e.toFixed(0).padStart(9)}${String(c).padStart(6)}${mx.toFixed(1).padStart(9)}%`)
    }
    console.log('')
  }
  console.log(`四幣合計  EMA200開 ${tot.on.reduce((s,x)=>s+x,0).toFixed(0)} USDT   EMA200關 ${tot.off.reduce((s,x)=>s+x,0).toFixed(0)} USDT`)
}
main()
