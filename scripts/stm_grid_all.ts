// 四幣 supertrend_macd 完整參數掃描（誠實回測，已對齊引擎）
// 判斷標準不只看單點最高，同時看「3×3 鄰域平均」避免過擬合到網格單點
import { backtestSupertrendMacd, backtestSupertrend } from '../lib/backtest'
interface Kline { time:number; open:number; high:number; low:number; close:number; volume:number }
const BASE='https://data-api.binance.vision', CAPITAL=10000
const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT']
const ATRS=[7,10,14,20,28]
const MULTS=[1.5,2.0,2.25,2.5,2.75,3.0,3.25,3.5,4.0]
const LIVE: Record<string,[number,number]> = { BTCUSDT:[14,3.0], ETHUSDT:[14,2.0], SOLUSDT:[14,3.0], BNBUSDT:[14,2.5] }
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

async function main(){
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
    // grid[ai][mi] = ex2021
    const ex:number[][]=[], tot:number[][]=[], neg:number[][]=[], mdd:number[][]=[], trd:number[][]=[]
    for(let ai=0;ai<ATRS.length;ai++){
      ex[ai]=[];tot[ai]=[];neg[ai]=[];mdd[ai]=[];trd[ai]=[]
      for(let mi=0;mi<MULTS.length;mi++){
        const p={atrPeriod:ATRS[ai],multiplier:MULTS[mi],ema200Filter:true,macdFast:12,macdSlow:26,macdSignal:9,tradeSize:1000}
        let e=0,t=0,n=0,m=0,c=0
        for(const per of PERIODS){
          const r=backtestSupertrendMacd(data[per.label] as never,p,CAPITAL)
          const v=pnlOf(r); t+=v; c+=r.totalTrades; if(r.maxDrawdown>m)m=r.maxDrawdown
          if(per.label!=='2021'){e+=v; if(v<0)n++}
        }
        ex[ai][mi]=e;tot[ai][mi]=t;neg[ai][mi]=n;mdd[ai][mi]=m;trd[ai][mi]=c
      }
    }
    // 3x3 鄰域平均（邊界只取存在的鄰居）
    const nb=(ai:number,mi:number)=>{
      let s=0,c=0
      for(let a=ai-1;a<=ai+1;a++)for(let m=mi-1;m<=mi+1;m++)
        if(a>=0&&a<ATRS.length&&m>=0&&m<MULTS.length){s+=ex[a][m];c++}
      return s/c
    }
    console.log(`\n${'='.repeat(96)}\n${sym} — supertrend_macd ex-2021 損益 USDT（每筆 1000）\n${'='.repeat(96)}`)
    console.log('atr\mult'+MULTS.map(m=>String(m).padStart(9)).join(''))
    for(let ai=0;ai<ATRS.length;ai++)
      console.log(String(ATRS[ai]).padEnd(8)+ex[ai].map((v,mi)=>{
        const live=LIVE[sym][0]===ATRS[ai]&&LIVE[sym][1]===MULTS[mi]
        return (v.toFixed(0)+(live?'*':'')).padStart(9)
      }).join(''))
    console.log('(* = 目前 live 配置)')
    const rows:{a:number;m:number;ex:number;tot:number;nb:number;neg:number;mdd:number;trd:number}[]=[]
    for(let ai=0;ai<ATRS.length;ai++)for(let mi=0;mi<MULTS.length;mi++)
      rows.push({a:ATRS[ai],m:MULTS[mi],ex:ex[ai][mi],tot:tot[ai][mi],nb:nb(ai,mi),neg:neg[ai][mi],mdd:mdd[ai][mi],trd:trd[ai][mi]})
    console.log('\n依「鄰域平均」排名前 6（穩健性優先）:')
    console.log(' atr mult   ex2021    鄰域平均     合計 虧損期 最大回撤  筆數')
    for(const r of [...rows].sort((x,y)=>y.nb-x.nb).slice(0,6))
      console.log(`${String(r.a).padStart(4)} ${String(r.m).padStart(4)} ${r.ex.toFixed(0).padStart(8)} ${r.nb.toFixed(0).padStart(9)} ${r.tot.toFixed(0).padStart(8)} ${String(r.neg).padStart(5)} ${r.mdd.toFixed(1).padStart(8)}% ${String(r.trd).padStart(5)}`)
    const lv=rows.find(r=>r.a===LIVE[sym][0]&&r.m===LIVE[sym][1])!
    const rank=[...rows].sort((x,y)=>y.nb-x.nb).findIndex(r=>r.a===lv.a&&r.m===lv.m)+1
    console.log(`live ${lv.a}/${lv.m}: ex2021=${lv.ex.toFixed(0)} 鄰域=${lv.nb.toFixed(0)} 合計=${lv.tot.toFixed(0)} → 鄰域排名 ${rank}/${rows.length}`)
    const pos=rows.filter(r=>r.ex>0).length
    console.log(`${rows.length} 組中 ex-2021 為正 ${pos} 組（${(pos/rows.length*100).toFixed(0)}%）`)

    // 結構變體：在 live mult 上比較 MACD 過濾 / EMA200 過濾 的開關
    const [la,lm]=LIVE[sym]
    const variants=[
      {label:'st_macd + EMA200（現行）',run:backtestSupertrendMacd,p:{atrPeriod:la,multiplier:lm,ema200Filter:true, macdFast:12,macdSlow:26,macdSignal:9,tradeSize:1000}},
      {label:'st_macd 無 EMA200      ',run:backtestSupertrendMacd,p:{atrPeriod:la,multiplier:lm,ema200Filter:false,macdFast:12,macdSlow:26,macdSignal:9,tradeSize:1000}},
      {label:'純 supertrend + EMA200 ',run:backtestSupertrend,    p:{atrPeriod:la,multiplier:lm,ema200Filter:true, tradeSize:1000}},
      {label:'純 supertrend 無 EMA200',run:backtestSupertrend,    p:{atrPeriod:la,multiplier:lm,ema200Filter:false,tradeSize:1000}},
    ]
    console.log(`\n結構變體（固定 atr=${la}, mult=${lm}）:`)
    for(const v of variants){
      let e=0,t=0,c=0
      for(const per of PERIODS){const r=v.run(data[per.label] as never,v.p as never,CAPITAL);const x=pnlOf(r);t+=x;c+=r.totalTrades;if(per.label!=='2021')e+=x}
      console.log(`  ${v.label}  ex2021=${e.toFixed(0).padStart(7)}  合計=${t.toFixed(0).padStart(7)}  ${String(c).padStart(4)}筆`)
    }
  }
}
main()
