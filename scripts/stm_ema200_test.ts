// 結構性檢驗：EMA200 過濾 與 MACD 過濾 是否真的有貢獻
// 用「整個參數網格的中位數 / 正報酬比例」判斷，而非單點
import { backtestSupertrendMacd, backtestSupertrend } from '../lib/backtest'
interface Kline { time:number; open:number; high:number; low:number; close:number; volume:number }
const BASE='https://data-api.binance.vision', CAPITAL=10000
const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT']
const ATRS=[7,10,14,20,28]
const MULTS=[2.0,2.25,2.5,2.75,3.0,3.25,3.5,4.0]
const PERIODS=[
  {label:'2021',start:'2021-01-01',end:'2021-12-31'},
  {label:'2022',start:'2022-01-01',end:'2022-12-31'},
  {label:'2023',start:'2023-01-01',end:'2023-12-31'},
  {label:'2024',start:'2024-01-01',end:'2024-12-31'},
  {label:'2025',start:'2025-01-01',end:'2025-12-31'},
  {label:'2026YTD',start:'2026-01-01',end:'2026-09-01'},
]
async function fetchKlines(sym:string,s:number,e:number):Promise<Kline[]>{
  const all:Kline[]=[]; let from=s
  while(from<e){
    const res=await fetch(`${BASE}/api/v3/klines?symbol=${sym}&interval=4h&startTime=${from}&limit=1000`)
    const d=await res.json() as unknown[][]; if(!d.length)break
    for(const k of d){ if((k[0] as number)>e)break; all.push({time:Math.floor((k[0] as number)/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}) }
    from=(d[d.length-1][0] as number)+1; if(d.length<1000)break
  }
  return all
}
const pnlOf=(r:{trades:{side:string;pnl?:number}[]})=>r.trades.filter(t=>t.side==='sell').reduce((s,t)=>s+(t.pnl??0),0)
const med=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)]}

const VARIANTS=[
  {key:'stm+e200', run:backtestSupertrendMacd, extra:{ema200Filter:true,  macdFast:12,macdSlow:26,macdSignal:9}},
  {key:'stm-e200', run:backtestSupertrendMacd, extra:{ema200Filter:false, macdFast:12,macdSlow:26,macdSignal:9}},
  {key:'st +e200', run:backtestSupertrend,     extra:{ema200Filter:true}},
  {key:'st -e200', run:backtestSupertrend,     extra:{ema200Filter:false}},
]

async function main(){
  console.log('每格 = 該變體在 40 組 (atr×mult) 網格上的統計；每筆 1000 USDT\n')
  for(const sym of SYMBOLS){
    const data:Record<string,Kline[]>={}
    for(const p of PERIODS){
      const warm=new Date(p.start).getTime()-90*86400_000
      const endMs=new Date(p.end+'T23:59:59Z').getTime()
      const kl=await fetchKlines(sym,warm,endMs)
      const ss=new Date(p.start).getTime()/1000
      const wi=kl.findIndex(k=>k.time>=ss)
      data[p.label]=kl.slice(Math.max(0,wi-250))
    }
    console.log(`=== ${sym} ===`)
    console.log('變體        ex2021中位  ex2021最佳  合計中位   正報酬率  平均筆數  平均最大回撤   2022中位')
    for(const v of VARIANTS){
      const exs:number[]=[],tots:number[]=[],trds:number[]=[],mdds:number[]=[],y22:number[]=[]
      for(const a of ATRS)for(const m of MULTS){
        const p={atrPeriod:a,multiplier:m,tradeSize:1000,...v.extra}
        let e=0,t=0,c=0,mx=0,b22=0
        for(const per of PERIODS){
          const r=v.run(data[per.label] as never,p as never,CAPITAL)
          const x=pnlOf(r); t+=x; c+=r.totalTrades; if(r.maxDrawdown>mx)mx=r.maxDrawdown
          if(per.label!=='2021')e+=x
          if(per.label==='2022')b22=x
        }
        exs.push(e);tots.push(t);trds.push(c);mdds.push(mx);y22.push(b22)
      }
      const pos=exs.filter(x=>x>0).length/exs.length*100
      console.log(`${v.key}  ${med(exs).toFixed(0).padStart(10)} ${Math.max(...exs).toFixed(0).padStart(11)} ${med(tots).toFixed(0).padStart(9)} ${pos.toFixed(0).padStart(8)}% ${(trds.reduce((s,x)=>s+x,0)/trds.length).toFixed(0).padStart(9)} ${(mdds.reduce((s,x)=>s+x,0)/mdds.length).toFixed(1).padStart(12)}% ${med(y22).toFixed(0).padStart(10)}`)
    }
    console.log('')
  }
}
main()
