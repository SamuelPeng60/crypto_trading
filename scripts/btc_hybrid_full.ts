// 全年比較 + Hybrid D（MACD 只過濾進場，出場純靠 ST）
// 解釋 2022 問題：Hybrid A 的 MACD 出場條件在 2022 熊市反彈中造成過早出場
import { closes, supertrend, atr as calcAtr, macd as calcMacd, ema } from '../lib/indicators'
import { backtestSupertrend } from '../lib/backtest'

interface Kline { time:number; open:number; high:number; low:number; close:number; volume:number }
const BASE='https://data-api.binance.vision'; const CAPITAL=1000; const FEE=0.001

const PERIODS=[
  {label:'2021',  start:'2021-01-01',end:'2021-12-31'},
  {label:'2022',  start:'2022-01-01',end:'2022-12-31'},
  {label:'2023',  start:'2023-01-01',end:'2023-12-31'},
  {label:'2024',  start:'2024-01-01',end:'2024-12-31'},
  {label:'2025',  start:'2025-01-01',end:'2025-12-31'},
  {label:'2026Q1',start:'2026-01-01',end:'2026-03-31'},
  {label:'2026Q2',start:'2026-04-01',end:'2026-05-24'},
]

async function fetchKlines(interval:string,startMs:number,endMs:number):Promise<Kline[]>{
  const all:Kline[]=[];let from=startMs
  while(from<endMs){
    const res=await fetch(`${BASE}/api/v3/klines?symbol=BTCUSDT&interval=${interval}&startTime=${from}&limit=1000`)
    const data=await res.json() as unknown[][]
    if(!data.length)break
    for(const k of data){
      if((k[0] as number)>endMs)break
      all.push({time:Math.floor((k[0] as number)/1000),open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]})
    }
    from=(data[data.length-1][0] as number)+1; if(data.length<1000)break
  }
  return all
}

function stats(trades:{pnl?:number}[],equity:{value:number}[]){
  const fin=equity.at(-1)?.value??CAPITAL
  const ret=(fin-CAPITAL)/CAPITAL*100
  let peak=CAPITAL,dd=0; for(const e of equity){if(e.value>peak)peak=e.value; dd=Math.max(dd,(peak-e.value)/peak*100)}
  const closed=trades.filter(t=>t.pnl!==undefined)
  const wr=closed.length?closed.filter(t=>(t.pnl??0)>0).length/closed.length*100:0
  return {ret,dd,wr,n:closed.length}
}

// ── Hybrid A：ST flip 進場 + MACD 確認  出場 = ST翻空 OR MACD轉負 ──────────
function hybridA(klines:Kline[],mult:number){
  const c=closes(klines),{direction}=supertrend(klines,14,mult)
  const e200=ema(c,200),atrV=calcAtr(klines,14),macdV=calcMacd(c,12,26,9)
  let cap=CAPITAL,pos:{price:number;qty:number}|null=null
  const tr:{pnl?:number}[]=[],eq:{value:number}[]=[]
  for(let i=1;i<klines.length;i++){
    if(isNaN(direction[i])||isNaN(macdV.histogram[i])||isNaN(atrV[i])){eq.push({value:cap+(pos?pos.qty*klines[i].close:0)});continue}
    const p=klines[i].close
    const flipUp=direction[i-1]===-1&&direction[i]===1
    const flipDn=direction[i-1]===1 &&direction[i]===-1
    const macdDn=macdV.histogram[i]<0&&macdV.histogram[i-1]>=0
    const macdPos=macdV.histogram[i]>0
    const abv=isNaN(e200[i])||p>e200[i]
    // 出場：ST 翻空 OR MACD 轉負
    if(pos&&(flipDn||macdDn)){cap+=pos.qty*p*(1-FEE);tr.push({pnl:(p-pos.price)*pos.qty});pos=null}
    // 進場：ST 翻多 AND MACD 正值
    if(!pos&&flipUp&&macdPos&&abv&&cap>0){const qty=Math.min(CAPITAL,cap*.999)/p;cap-=qty*p*(1+FEE);pos={price:p,qty};tr.push({})}
    eq.push({value:cap+(pos?pos.qty*p:0)})
  }
  if(pos){const p=klines.at(-1)!.close;tr.push({pnl:(p-pos.price)*pos.qty})}
  return stats(tr,eq)
}

// ── Hybrid D：ST flip 進場 + MACD 確認  出場 = 只靠 ST 翻空（不用 MACD 出場）──
function hybridD(klines:Kline[],mult:number){
  const c=closes(klines),{direction}=supertrend(klines,14,mult)
  const e200=ema(c,200),atrV=calcAtr(klines,14),macdV=calcMacd(c,12,26,9)
  let cap=CAPITAL,pos:{price:number;qty:number}|null=null
  const tr:{pnl?:number}[]=[],eq:{value:number}[]=[]
  for(let i=1;i<klines.length;i++){
    if(isNaN(direction[i])||isNaN(macdV.histogram[i])||isNaN(atrV[i])){eq.push({value:cap+(pos?pos.qty*klines[i].close:0)});continue}
    const p=klines[i].close
    const flipUp=direction[i-1]===-1&&direction[i]===1
    const flipDn=direction[i-1]===1 &&direction[i]===-1
    const macdPos=macdV.histogram[i]>0
    const abv=isNaN(e200[i])||p>e200[i]
    // 出場：只靠 ST 翻空（MACD 不控制出場）
    if(pos&&flipDn){cap+=pos.qty*p*(1-FEE);tr.push({pnl:(p-pos.price)*pos.qty});pos=null}
    // 進場：ST 翻多 AND MACD 正值（比純 ST 多了一個動能過濾）
    if(!pos&&flipUp&&macdPos&&abv&&cap>0){const qty=Math.min(CAPITAL,cap*.999)/p;cap-=qty*p*(1+FEE);pos={price:p,qty};tr.push({})}
    eq.push({value:cap+(pos?pos.qty*p:0)})
  }
  if(pos){const p=klines.at(-1)!.close;tr.push({pnl:(p-pos.price)*pos.qty})}
  return stats(tr,eq)
}

// ── 取逐筆交易細節（用於 2022 比較）────────────────────────────────────────
function hybridADetail(klines:Kline[],mult:number){
  const c=closes(klines),{direction}=supertrend(klines,14,mult)
  const e200=ema(c,200),atrV=calcAtr(klines,14),macdV=calcMacd(c,12,26,9)
  let cap=CAPITAL,pos:{price:number;qty:number;entryDate:string}|null=null
  const trades:{date:string;side:string;price:number;pnl?:number;reason?:string}[]=[]
  for(let i=1;i<klines.length;i++){
    if(isNaN(direction[i])||isNaN(macdV.histogram[i])||isNaN(atrV[i]))continue
    const p=klines[i].close,dt=new Date(klines[i].time*1000).toISOString().slice(0,10)
    const flipUp=direction[i-1]===-1&&direction[i]===1
    const flipDn=direction[i-1]===1 &&direction[i]===-1
    const macdDn=macdV.histogram[i]<0&&macdV.histogram[i-1]>=0
    const macdPos=macdV.histogram[i]>0
    const abv=isNaN(e200[i])||p>e200[i]
    if(pos&&(flipDn||macdDn)){
      const reason=flipDn?'ST翻空':'MACD轉負'
      trades.push({date:dt,side:'sell',price:p,pnl:(p-pos.price)*pos.qty,reason})
      cap+=pos.qty*p*(1-FEE);pos=null
    }
    if(!pos&&flipUp&&macdPos&&abv&&cap>0){
      const qty=Math.min(CAPITAL,cap*.999)/p
      trades.push({date:dt,side:'buy',price:p})
      cap-=qty*p*(1+FEE);pos={price:p,qty,entryDate:dt}
    }
  }
  if(pos){const p=klines.at(-1)!.close;trades.push({date:'end',side:'sell',price:p,pnl:(p-pos.price)*pos.qty,reason:'EOD'})}
  return trades
}

function hybridDDetail(klines:Kline[],mult:number){
  const c=closes(klines),{direction}=supertrend(klines,14,mult)
  const e200=ema(c,200),atrV=calcAtr(klines,14),macdV=calcMacd(c,12,26,9)
  let cap=CAPITAL,pos:{price:number;qty:number}|null=null
  const trades:{date:string;side:string;price:number;pnl?:number;reason?:string}[]=[]
  for(let i=1;i<klines.length;i++){
    if(isNaN(direction[i])||isNaN(macdV.histogram[i])||isNaN(atrV[i]))continue
    const p=klines[i].close,dt=new Date(klines[i].time*1000).toISOString().slice(0,10)
    const flipUp=direction[i-1]===-1&&direction[i]===1
    const flipDn=direction[i-1]===1 &&direction[i]===-1
    const macdPos=macdV.histogram[i]>0
    const abv=isNaN(e200[i])||p>e200[i]
    if(pos&&flipDn){trades.push({date:dt,side:'sell',price:p,pnl:(p-pos.price)*pos.qty,reason:'ST翻空'});cap+=pos.qty*p*(1-FEE);pos=null}
    if(!pos&&flipUp&&macdPos&&abv&&cap>0){
      const qty=Math.min(CAPITAL,cap*.999)/p
      trades.push({date:dt,side:'buy',price:p})
      cap-=qty*p*(1+FEE);pos={price:p,qty}
    }
  }
  if(pos){const p=klines.at(-1)!.close;trades.push({date:'end',side:'sell',price:p,pnl:(p-pos.price)*pos.qty,reason:'EOD'})}
  return trades
}

async function main(){
  const allK:Kline[][]=[]
  for(const p of PERIODS){
    process.stdout.write(`Fetching ${p.label}... `)
    const k=await fetchKlines('4h',new Date(p.start).getTime(),new Date(p.end+'T23:59:59Z').getTime())
    allK.push(k);console.log(`${k.length} bars`)
  }

  const fmt=(v:number)=>(v>=0?'+':'')+v.toFixed(1)+'%'
  const fmtP=(v:number)=>(v>=0?'+':'')+v.toFixed(2)
  const avgArr=(a:number[])=>a.reduce((s,x)=>s+x,0)/a.length

  type Cfg={label:string;fn:(k:Kline[])=>{ret:number;dd:number;wr:number;n:number}}
  const configs:Cfg[]=[
    {label:'ST       mult=2.0', fn:k=>{ const r=backtestSupertrend(k as any,{atrPeriod:14,multiplier:2.0,ema200Filter:true,tradeSize:CAPITAL},CAPITAL); return {ret:r.totalReturn,dd:r.maxDrawdown,wr:r.winRate,n:r.totalTrades} }},
    {label:'ST       mult=3.0', fn:k=>{ const r=backtestSupertrend(k as any,{atrPeriod:14,multiplier:3.0,ema200Filter:true,tradeSize:CAPITAL},CAPITAL); return {ret:r.totalReturn,dd:r.maxDrawdown,wr:r.winRate,n:r.totalTrades} }},
    {label:'A(+MACD出) m=2.0', fn:k=>hybridA(k,2.0)},
    {label:'A(+MACD出) m=3.0', fn:k=>hybridA(k,3.0)},
    {label:'D(MACD進只) m=2.0', fn:k=>hybridD(k,2.0)},
    {label:'D(MACD進只) m=3.0', fn:k=>hybridD(k,3.0)},
  ]

  // ── 全年報酬表 ────────────────────────────────────────────────────────────
  const COL=8, pad=(s:string)=>s.padStart(COL)
  const hdr='策略                   '+PERIODS.map(p=>p.label.padStart(COL)).join('')+pad('平均')+pad('maxDD')+pad('筆數')
  console.log('\n=== BTC 全年比較（2021-2026Q2）===')
  console.log(hdr);console.log('─'.repeat(hdr.length))

  type Row={label:string;rets:number[];dds:number[];ns:number[]}
  const rows:Row[]=[]
  for(const cfg of configs){
    const rets:number[]=[],dds:number[]=[],ns:number[]=[]
    for(const kl of allK){const r=cfg.fn(kl);rets.push(r.ret);dds.push(r.dd);ns.push(r.n)}
    rows.push({label:cfg.label,rets,dds,ns})
    console.log(cfg.label.padEnd(23)+rets.map(r=>pad(fmt(r))).join('')+pad(fmt(avgArr(rets)))+pad(fmt(avgArr(dds)))+pad(avgArr(ns).toFixed(1)))
  }

  // ── 2022 逐筆比較（解釋 A vs D 差異）────────────────────────────────────
  const k2022=allK[1]
  console.log('\n=== 2022 逐筆交易對比（mult=2.0，解釋 MACD出場的代價）===')
  console.log('\n── Hybrid A（MACD 控制出場）──')
  const trA=hybridADetail(k2022,2.0)
  let capA=CAPITAL
  for(const t of trA){
    if(t.side==='buy'){console.log(`  買入 ${t.date}  $${t.price.toFixed(0)}`)}
    else{
      const pct=(t.pnl??0)/CAPITAL*100
      capA+=(t.pnl??0)-(t.price*(trA.find(x=>x.side==='buy'&&x.date<t.date)?.price??0)*FEE||0)
      console.log(`  賣出 ${t.date}  $${t.price.toFixed(0)}  pnl ${fmtP(t.pnl??0)} (${(pct>=0?'+':'')+pct.toFixed(2)}%)  原因:${t.reason}`)
    }
  }

  console.log('\n── Hybrid D（只靠 ST 出場）──')
  const trD=hybridDDetail(k2022,2.0)
  for(const t of trD){
    if(t.side==='buy'){console.log(`  買入 ${t.date}  $${t.price.toFixed(0)}`)}
    else{
      const pct=(t.pnl??0)/CAPITAL*100
      console.log(`  賣出 ${t.date}  $${t.price.toFixed(0)}  pnl ${fmtP(t.pnl??0)} (${(pct>=0?'+':'')+pct.toFixed(2)}%)  原因:${t.reason}`)
    }
  }

  // ── 2026 聚焦 ─────────────────────────────────────────────────────────────
  console.log('\n=== 2026Q1/Q2 聚焦（關鍵時段）===')
  console.log('策略                     2026Q1    2026Q2    合計')
  console.log('─'.repeat(55))
  for(const r of rows){
    const q1=r.rets[5],q2=r.rets[6],sum=q1+q2
    console.log(r.label.padEnd(25)+fmt(q1).padStart(8)+'  '+fmt(q2).padStart(8)+'  '+fmt(sum).padStart(8)+(sum>0?'  ✅':''))
  }

  // ── 最終建議 ──────────────────────────────────────────────────────────────
  console.log('\n=== 各策略特性總結 ===')
  for(const r of rows){
    const a=avgArr(r.rets),worst=Math.min(...r.rets),best=Math.max(...r.rets)
    console.log(`${r.label.padEnd(23)} avg:${fmt(a).padStart(7)}  best:${fmt(best).padStart(7)}  worst:${fmt(worst).padStart(8)}  avgDD:${fmt(avgArr(r.dds)).padStart(7)}`)
  }
}

main().catch(console.error)
