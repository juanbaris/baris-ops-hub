import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { useInvoicedActuals, type MonthActual } from "@/hooks/use-invoiced-actuals";

// ─── Constants ────────────────────────────────────────────────────────────────
import {
  PRICE_PER_CASE, UNITS_PER_CASE, WEEKS_PER_MONTH, IMPLIED_ANNUAL_2026,
  DEFAULT_SEASON_IDX, GROWTH, SKU_MIX, FORECAST_MONTHS,
  DEFAULT_VEL_CHAINS, NEW_RETAILERS, calcForecast, skuForecast,
  saveForecastState, DEFAULT_NEW_SKUS, NEW_SKU_COLORS, newSkuCases,
  type VelChain, type ForecastState, type NewSku,
} from "@/lib/sales-forecast";

const DEFAULT_MIX_PCT: Record<string,number> = {XD:30,PW:25,HM:18,WM:12,WD:8,Matcha:7};
const MIX_SKUS = ["XD","PW","HM","WM","WD","Matcha"];

type HistRow = { label: string; cases: number; revenue: number };
const DIST_MIX = [
  {dist:"KeHE",pct:0.55,color:"#A3224A"},
  {dist:"UNFI",pct:0.28,color:"#1C2340"},
  {dist:"Rainforest",pct:0.10,color:"#3B82F6"},
  {dist:"RFD/Other",pct:0.07,color:"#9CA3AF"},
];
const ALL_MONTHS_REAL = [
  "Jan 2026","Feb 2026","Mar 2026","Apr 2026","May 2026","Jun 2026","Jul 2026",
  "Aug 2026","Sep 2026","Oct 2026","Nov 2026","Dec 2026",
  "Jan 2027","Feb 2027","Mar 2027","Apr 2027","May 2027","Jun 2027","Jul 2027",
];

type SalesTab = "real"|"resumen"|"detalle"|"sku"|"simulador"|"estacionalidad";
declare global { interface Window { Chart: any } }

// ─── Real Monthly Tab (derived from invoiced pipeline) ───────────────────────
function RealMonthlyTab({actuals,loading}:{actuals:Record<string,MonthActual>;loading:boolean}) {
  const SKU_FIELDS = ["xd","pw","hm","wm","wd","matcha"] as const;
  const YTD_MONTHS = ["Jan 2026","Feb 2026","Mar 2026","Apr 2026","May 2026","Jun 2026","Jul 2026"];

  const ytdCases = YTD_MONTHS.reduce((s,m)=>s+(actuals[m]?.cases??0),0);
  const ytdRev = YTD_MONTHS.reduce((s,m)=>s+(actuals[m]?.revenue??0),0);
  const ytdBySku: Record<string,number> = {};
  for(const f of SKU_FIELDS) ytdBySku[f]=YTD_MONTHS.reduce((s,m)=>s+(actuals[m]?.sku[f]??0),0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        {[
          {label:"YTD 2026 Revenue (Jan–Jul)",value:`$${Math.round(ytdRev/1000)}K`,color:"#A3224A"},
          {label:"YTD 2026 Cases (Jan–Jul)",value:ytdCases.toLocaleString(),color:"#1C2340"},
          {label:"Avg $/case YTD",value:`$${ytdCases>0?(ytdRev/ytdCases).toFixed(2):"—"}`,color:"#1C2340"},
        ].map((k,i)=>(
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">{k.label}</p>
            <p className="text-2xl font-bold font-mono" style={{color:k.color}}>{k.value}</p>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
        🔗 Derived view — every number comes from the Fulfillment pipeline, counting only POs with status <strong>Invoiced</strong>, bucketed by invoice month. Not editable here: to change a month, invoice or edit the PO in Fulfillment.
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <th className="px-3 py-2.5 text-left">Month</th>
              <th className="px-3 py-2.5 text-right">Net sales ($)</th>
              <th className="px-3 py-2.5 text-right">XD</th><th className="px-3 py-2.5 text-right">PW</th>
              <th className="px-3 py-2.5 text-right">HM</th><th className="px-3 py-2.5 text-right">WM</th>
              <th className="px-3 py-2.5 text-right">WD</th><th className="px-3 py-2.5 text-right">Matcha</th>
              <th className="px-3 py-2.5 text-right font-bold">TOTAL</th>
              <th className="px-3 py-2.5 text-right">$/case</th>
              <th className="px-3 py-2.5 text-right">Invoiced POs</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">Loading pipeline…</td></tr>
            ) : ALL_MONTHS_REAL.map(m=>{
              const a=actuals[m];
              const total=a?.cases??0;
              const rev=a?.revenue??0;
              const has=!!a&&(total>0||rev>0);
              return (
                <tr key={m} className={`border-t border-border/60 ${has?"bg-emerald-50/20":"bg-muted/10"}`}>
                  <td className="px-3 py-1.5 font-semibold" style={{color:"#1C2340"}}>{m}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{rev>0?`$${Math.round(rev).toLocaleString()}`:"—"}</td>
                  {SKU_FIELDS.map(f=>(
                    <td key={f} className="px-3 py-1.5 text-right font-mono">{a?.sku[f]?a.sku[f].toLocaleString():"—"}</td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-mono font-bold" style={total>0?{color:"#1C2340"}:{}}>{total>0?total.toLocaleString():"—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{total>0&&rev>0?`$${(rev/total).toFixed(2)}`:"—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{a?.orders??"—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
              <td className="px-3 py-2 font-semibold text-xs">TOTAL YTD</td>
              <td className="px-3 py-2 text-right font-mono">${Math.round(ytdRev).toLocaleString()}</td>
              {SKU_FIELDS.map(f=>(
                <td key={f} className="px-3 py-2 text-right font-mono font-bold text-emerald-400">{ytdBySku[f]?ytdBySku[f].toLocaleString():"—"}</td>
              ))}
              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">{ytdCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-300">{ytdCases>0?`$${(ytdRev/ytdCases).toFixed(2)}`:"—"}</td>
              <td/>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────────────────────
function SummaryTab({forecast,scenario,reals,history,committedCount=0}:{forecast:any[];scenario:string;reals:Record<string,number>;history:HistRow[];committedCount?:number}) {
  const mainCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(()=>{
    if(!mainCanvas.current||!window.Chart) return;
    const existing = (mainCanvas.current as any)._chart;
    if(existing) existing.destroy();
    const allMonths=[...history.map(h=>h.label),...forecast.map(f=>f.label)];
    const caseVals=[...history.map(h=>h.cases),...forecast.map(f=>reals[f.label]??f.totalCases)];
    const colors=[...history.map(()=>"#A3224A"),...forecast.map(()=>"rgba(163,34,74,0.45)")];
    const budgetVals=[...history.map(()=>null),...forecast.map(f=>f.budgetCases)];
    const chart = new window.Chart(mainCanvas.current,{
      type:"bar",
      data:{labels:allMonths,datasets:[
        {label:"Cases",data:caseVals,backgroundColor:colors,borderRadius:3},
        {type:"line",label:"Budget",data:budgetVals,borderColor:"#9CA3AF",borderDash:[4,3],pointRadius:3,fill:false,tension:0.3},
      ]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{y:{ticks:{callback:(v:number)=>v.toLocaleString()}}}}
    });
    (mainCanvas.current as any)._chart = chart;
  },[forecast,reals,history]);

  const totalFcst=forecast.reduce((s,f)=>s+f.totalCases,0);
  const totalRev=forecast.reduce((s,f)=>s+f.revenue,0);
  const totalBudget=forecast.reduce((s,f)=>s+f.budgetCases,0);
  const coveredMonths=forecast.filter(f=>reals[f.label]!=null).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {label:"Forecast 12m (cases)",value:totalFcst.toLocaleString(),sub:`Scenario ${scenario}`,color:"#A3224A"},
          {label:"Revenue forecast 12m",value:`$${Math.round(totalRev/1000)}K`,sub:`@$${PRICE_PER_CASE}/case`,color:"#1C2340"},
          {label:"vs Budget",value:`${((totalFcst/totalBudget-1)*100).toFixed(1)}%`,sub:"Normal baseline",color:totalFcst>=totalBudget?"#10B981":"#EF4444"},
          {label:"Months with actuals",value:`${coveredMonths}/12`,sub:"Update monthly",color:"#6B7280"},
        ].map((k,i)=>(
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">{k.label}</p>
            <p className="text-2xl font-bold font-mono" style={{color:k.color}}>{k.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-1" style={{color:"#1C2340"}}>Real · Forecast · Budget — Jan 2026 → Jul 2027</h3>
        <div className="flex items-center gap-4 mb-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{backgroundColor:"#A3224A"}}/>Real</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{backgroundColor:"rgba(163,34,74,0.45)"}}/>Forecast</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-0 border-t-2 border-dashed" style={{borderColor:"#9CA3AF"}}/>Budget</span>
        </div>
        <div style={{height:280}}><canvas ref={mainCanvas}/></div>
        {committedCount>0 && (
          <p className="mt-3 text-xs font-semibold" style={{color:"#B45309"}}>
            📌 Committed scenario: {committedCount} lever{committedCount===1?"":"s"} — this is the active production &amp; finance forecast.
          </p>
        )}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>Projected revenue by distributor</h3>
        <div className="space-y-3">
          {DIST_MIX.map(d=>{
            const rev=Math.round(totalRev*d.pct);
            return (
              <div key={d.dist}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{d.dist}</span>
                  <span className="font-mono font-semibold">${Math.round(rev/1000)}K · {Math.round(d.pct*100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{width:`${d.pct*100}%`,backgroundColor:d.color}}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Detalle Tab ──────────────────────────────────────────────────────────────
type DetalleRange = "all"|"ytd"|"next3"|"rest2026"|"y2026"|"y2027";
const RANGE_OPTIONS: {id:DetalleRange;label:string;sub:string}[] = [
  {id:"all",label:"All",sub:"Jan 2026 – Jul 2027"},
  {id:"ytd",label:"Actuals (YTD)",sub:"Jan–Jul 2026"},
  {id:"next3",label:"Next 3 months",sub:"Aug–Oct 2026"},
  {id:"rest2026",label:"Rest of 2026",sub:"Aug–Dec 2026"},
  {id:"y2026",label:"Full 2026",sub:"Jan–Dec 2026"},
  {id:"y2027",label:"Full 2027",sub:"Jan–Jul 2027"},
];
const NEXT3_LABELS = ["Aug 2026","Sep 2026","Oct 2026"];
const REST2026_LABELS = ["Aug 2026","Sep 2026","Oct 2026","Nov 2026","Dec 2026"];

function DetalleTab({forecast,reals,onRealUpdate,history,committedCount=0}:{forecast:any[];reals:Record<string,number>;onRealUpdate:(l:string,v:number)=>void;history:HistRow[];committedCount?:number}) {
  const [editing,setEditing]=useState<string|null>(null);
  const [editVal,setEditVal]=useState("");
  const [range,setRange]=useState<DetalleRange>("all");

  const showHist = range==="all"||range==="ytd"||range==="y2026";
  const histRows: HistRow[] = showHist?history:[];
  const fcstRows = forecast.filter(f=>{
    if(range==="all") return true;
    if(range==="ytd") return false;
    if(range==="next3") return NEXT3_LABELS.includes(f.label);
    if(range==="rest2026") return REST2026_LABELS.includes(f.label);
    if(range==="y2026") return f.year===2026;
    return f.year===2027;
  });

  const histCases = histRows.reduce((s,h)=>s+h.cases,0);
  const histRev = histRows.reduce((s,h)=>s+h.revenue,0);
  const fcstCases = fcstRows.reduce((s,f)=>s+(reals[f.label]??f.totalCases),0);
  const fcstRev = fcstRows.reduce((s,f)=>s+(reals[f.label]??f.totalCases)*PRICE_PER_CASE,0);
  const visCases = histCases+fcstCases;
  const visRev = histRev+fcstRev;
  const monthCount = histRows.length+fcstRows.length;
  const totalBudget = fcstRows.reduce((s,f)=>s+f.budgetCases,0);
  const activeOpt = RANGE_OPTIONS.find(o=>o.id===range)!;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        💡 Click <strong>Actual cases</strong> to enter actuals at month close.
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGE_OPTIONS.map(o=>(
          <button key={o.id} onClick={()=>setRange(o.id)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${range===o.id?"text-white":"border border-border text-muted-foreground hover:text-foreground"}`}
            style={range===o.id?{backgroundColor:"#1C2340"}:{}}>
            {o.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
          Selected range: {activeOpt.label} · {activeOpt.sub}
        </p>
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Cases forecasted</p>
            <p className="text-xl font-bold font-mono" style={{color:"#A3224A"}}>{visCases.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Revenue</p>
            <p className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>${Math.round(visRev/1000).toLocaleString()}K</p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground">Avg $/month</p>
            <p className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>${monthCount>0?Math.round(visRev/monthCount/1000).toLocaleString():"0"}K</p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <th className="px-4 py-2.5 text-left">Month</th>
              <th className="px-4 py-2.5 text-right">Base</th>
              <th className="px-4 py-2.5 text-right">Δ Vel.</th>
              <th className="px-4 py-2.5 text-right">Δ Retailers</th>
              <th className="px-4 py-2.5 text-right font-bold">TOTAL</th>
              <th className="px-4 py-2.5 text-right">Revenue fcst</th>
              <th className="px-4 py-2.5 text-right">Budget</th>
              <th className="px-4 py-2.5 text-right">Δ vs Budget</th>
              <th className="px-4 py-2.5 text-right">ACTUAL cases</th>
              <th className="px-4 py-2.5 text-right">Δ actual vs fcst</th>
              <th className="px-4 py-2.5 text-right">YoY vs 2025</th>
            </tr>
          </thead>
          <tbody>
            {histRows.map((h,i)=>(
              <tr key={h.label} className={`border-t border-border/60 bg-muted/10 ${i===histRows.length-1?"border-b-2":""}`}>
                <td className="px-4 py-1.5 font-semibold" style={{color:"#1C2340"}}>{h.label}</td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">—</td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">—</td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">—</td>
                <td className="px-4 py-1.5 text-right font-mono font-bold" style={{color:"#1C2340"}}>{h.cases.toLocaleString()}</td>
                <td className="px-4 py-1.5 text-right font-mono">${Math.round(h.revenue/1000)}K</td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">—</td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">—</td>
                <td className="px-4 py-1.5 text-right">
                  <div className="inline-block rounded px-2 py-0.5" style={{backgroundColor:"#ecfdf5"}}>
                    <span className="block font-mono text-xs font-semibold text-emerald-700">{h.cases.toLocaleString()}</span>
                    <span className="block text-muted-foreground" style={{fontSize:9}}>actual</span>
                  </div>
                </td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">—</td>
                <td className="px-4 py-1.5 text-right text-muted-foreground">—</td>
              </tr>
            ))}
            {histRows.length>0&&fcstRows.length>0&&(
              <tr style={{backgroundColor:"#F5F0E8"}}>
                <td colSpan={11} className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider border-y-2" style={{color:"#A3224A",borderColor:"#A3224A"}}>
                  Forecast →
                </td>
              </tr>
            )}
            {fcstRows.map((f,i)=>{
              const real=reals[f.label];
              const deltaVsBudget=f.totalCases-f.budgetCases;
              const deltaReal=real!=null?real-f.totalCases:null;
              const yoy=f.yoy2025>0?((f.totalCases/f.yoy2025)-1)*100:null;
              return (
                <tr key={i} className={`border-t border-border/60 hover:bg-muted/20 ${real!=null?"bg-emerald-50/20":""}`}>
                  <td className="px-4 py-1.5 font-semibold" style={{color:"#1C2340"}}>{f.label}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{f.baseCases.toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{f.velDelta>0?`+${f.velDelta}`:"—"}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{f.acctDelta>0?`+${f.acctDelta}`:"—"}</td>
                  <td className="px-4 py-1.5 text-right font-mono font-bold" style={{color:"#1C2340"}}>{(real??f.totalCases).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono">${Math.round(f.revenue/1000)}K</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">${Math.round(f.budget/1000)}K</td>
                  <td className={`px-4 py-1.5 text-right font-mono text-xs ${deltaVsBudget>=0?"text-emerald-600":"text-red-500"}`}>
                    {deltaVsBudget>=0?"+":""}{deltaVsBudget.toLocaleString()}
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    {editing===f.label?(
                      <div className="flex items-center gap-1">
                        <input type="number" autoFocus value={editVal} onChange={e=>setEditVal(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter"){onRealUpdate(f.label,parseInt(editVal)||0);setEditing(null);}if(e.key==="Escape")setEditing(null);}}
                          className="w-20 rounded border border-border px-1.5 py-0.5 text-xs font-mono focus:outline-none"/>
                        <button onClick={()=>{onRealUpdate(f.label,parseInt(editVal)||0);setEditing(null);}}
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{backgroundColor:"#A3224A"}}>✓</button>
                      </div>
                    ):(
                      <button onClick={()=>{setEditing(f.label);setEditVal(String(real??""));}}
                        className={`rounded px-2 py-0.5 text-xs font-mono ${real!=null?"font-semibold text-emerald-600 hover:bg-emerald-50":"text-muted-foreground hover:bg-muted border border-dashed border-border"}`}>
                        {real!=null?real!.toLocaleString():"load"}
                      </button>
                    )}
                  </td>
                  <td className={`px-4 py-1.5 text-right font-mono text-xs ${deltaReal==null?"text-muted-foreground":deltaReal>=0?"text-emerald-600":"text-red-500"}`}>
                    {deltaReal==null?"—":`${deltaReal>=0?"+":""}${deltaReal.toLocaleString()}`}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">
                    {yoy!=null?`${yoy>=0?"+":""}${yoy.toFixed(0)}%`:"—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
              <td className="px-4 py-2 text-xs font-semibold" colSpan={4}>TOTAL · {activeOpt.label} ({monthCount} months)</td>
              <td className="px-4 py-2 text-right font-mono font-bold">{visCases.toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono">${Math.round(visRev/1000).toLocaleString()}K</td>
              <td className="px-4 py-2 text-right font-mono text-slate-300">{totalBudget>0?`$${Math.round(totalBudget*PRICE_PER_CASE/1000).toLocaleString()}K`:"—"}</td>
              <td className={`px-4 py-2 text-right font-mono text-xs ${fcstCases>=totalBudget?"text-emerald-400":"text-red-400"}`}>
                {totalBudget>0?`${fcstCases>=totalBudget?"+":""}${(fcstCases-totalBudget).toLocaleString()}`:"—"}
              </td>
              <td colSpan={3}/>
            </tr>
          </tfoot>
        </table>
      </div>
      {committedCount>0 && (
        <p className="text-xs font-semibold" style={{color:"#B45309"}}>
          📌 Committed scenario: {committedCount} lever{committedCount===1?"":"s"} — this is the active production &amp; finance forecast.
        </p>
      )}
    </div>
  );
}

// ─── SKU Tab ──────────────────────────────────────────────────────────────────
function SKUTab({forecast,newSkus,mixOverrides,mixOverrideActive,committedCount}:{
  forecast:any[];newSkus:NewSku[];mixOverrides:Record<string,Record<string,number>>;
  mixOverrideActive:boolean;committedCount:number;
}) {
  const SKU_COLORS: Record<string,string> = {XD:"#1C2340",PW:"#A3224A",HM:"#3B82F6",WM:"#10B981",WD:"#F59E0B",Matcha:"#8B5CF6"};
  const SKUS = ["XD","PW","HM","WM","WD","Matcha"];
  // Existing SKUs split the base demand; new-SKU volume is fully incremental
  // and is listed in its own rows so the TOTAL row still ties to the forecast.
  const baseByMonth = useMemo(()=>forecast.map(f=>f.totalCases-(f.newSkuDelta??0)),[forecast]);
  const defaultMonths = useMemo(()=>skuForecast(forecast.map((f,i)=>({...f,totalCases:baseByMonth[i]})) as any),[forecast,baseByMonth]);
  const skuData = useMemo(()=>SKUS.map(sku=>{
    const months = mixOverrideActive
      ? forecast.map((f,i)=>Math.round(baseByMonth[i]*((mixOverrides[f.label]?.[sku] ?? DEFAULT_MIX_PCT[sku])/100)))
      : (defaultMonths[sku]??[]);
    return {sku,pct:SKU_MIX[sku],months,total:months.reduce((a:number,b:number)=>a+b,0)};
  }),[forecast,defaultMonths,baseByMonth,mixOverrideActive,mixOverrides]);

  const activeNew = useMemo(()=>newSkus
    .map((s,i)=>({sku:s,color:NEW_SKU_COLORS[i%NEW_SKU_COLORS.length]}))
    .filter(x=>x.sku.active)
    .map(x=>{
      const months = forecast.map((_,i)=>newSkuCases(x.sku,i));
      return {...x,months,total:months.reduce((a,b)=>a+b,0)};
    }),[newSkus,forecast]);

  const grandTotal = forecast.reduce((s,f)=>s+f.totalCases,0);
  const mixSlices = [
    ...SKUS.map(sku=>({key:sku,color:SKU_COLORS[sku],cases:skuData.find(d=>d.sku===sku)?.total??0})),
    ...activeNew.map(n=>({key:n.sku.name,color:n.color,cases:n.total})),
  ];
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-1" style={{color:"#1C2340"}}>Mix de SKUs — Forecast 2026–2027</h3>
        {committedCount>0 && <p className="text-xs mb-3 font-semibold" style={{color:"#B45309"}}>Cases based on committed scenario</p>}
        {mixOverrideActive && <p className="text-xs mb-3 text-muted-foreground">Mix override ON — per-month percentages from Block 4</p>}
        <div className="flex gap-2 flex-wrap mb-3">
          {mixSlices.map(s=>(
            <div key={s.key} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2">
              <span className="w-3 h-3 rounded-sm" style={{backgroundColor:s.color}}/>
              <span className="text-xs font-semibold">{s.key}</span>
              <span className="text-xs text-muted-foreground">{grandTotal>0?Math.round(s.cases/grandTotal*100):0}%</span>
            </div>
          ))}
        </div>
        <div className="h-3 rounded-full overflow-hidden flex">
          {mixSlices.map(s=>(
            <div key={s.key} style={{width:`${grandTotal>0?s.cases/grandTotal*100:0}%`,backgroundColor:s.color}} title={`${s.key}: ${grandTotal>0?Math.round(s.cases/grandTotal*100):0}%`}/>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-center">Mix</th>
              {forecast.map(f=><th key={f.label} className="px-3 py-2.5 text-right w-16">{f.label.slice(0,3)}</th>)}
              <th className="px-4 py-2.5 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {skuData.map(s=>(
              <tr key={s.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-4 py-1.5 font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-sm" style={{backgroundColor:SKU_COLORS[s.sku]}}/>
                    {s.sku}
                  </div>
                </td>
                <td className="px-4 py-1.5 text-center text-muted-foreground">{grandTotal>0?Math.round(s.total/grandTotal*100):0}%</td>
                {s.months.map((v,i)=><td key={i} className="px-3 py-1.5 text-right font-mono">{v.toLocaleString()}</td>)}
                <td className="px-4 py-1.5 text-right font-mono font-bold">{s.total.toLocaleString()}</td>
              </tr>
            ))}
            {activeNew.map(n=>(
              <tr key={n.sku.name} className="border-t border-border/60 hover:bg-muted/20 bg-amber-50/30">
                <td className="px-4 py-1.5 font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-sm" style={{backgroundColor:n.color}}/>
                    {n.sku.name}
                    <span className="rounded-full border border-amber-400 px-1.5 text-[9px] font-semibold text-amber-700">NEW</span>
                  </div>
                </td>
                <td className="px-4 py-1.5 text-center text-muted-foreground">{grandTotal>0?Math.round(n.total/grandTotal*100):0}%</td>
                {n.months.map((v,i)=><td key={i} className="px-3 py-1.5 text-right font-mono">{v.toLocaleString()}</td>)}
                <td className="px-4 py-1.5 text-right font-mono font-bold">{n.total.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-bold" style={{backgroundColor:"#1C2340",color:"#fff"}}>
              <td className="px-4 py-2">TOTAL</td>
              <td className="px-4 py-2 text-center">100%</td>
              {forecast.map(f=><td key={f.label} className="px-3 py-2 text-right font-mono">{f.totalCases.toLocaleString()}</td>)}
              <td className="px-4 py-2 text-right font-mono">{forecast.reduce((s,f)=>s+f.totalCases,0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {activeNew.length>0 && (
        <p className="text-xs text-amber-700">⚠ New SKU cases are simulator projections. Lock them with SET to include in production planning.</p>
      )}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-3" style={{color:"#1C2340"}}>Historical SKU mix</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
              <th className="py-2 text-left">SKU</th>
              <th className="py-2 text-right">2023</th><th className="py-2 text-right">2024</th>
              <th className="py-2 text-right">2025</th><th className="py-2 text-right">2026 (7mo)</th>
              <th className="py-2 text-right">2027 fcst</th>
            </tr>
          </thead>
          <tbody>
            {[{sku:"XD",h:[0.33,0.22,0.27,0.30,0.30]},{sku:"PW",h:[0,0,0.03,0.22,0.25]},
              {sku:"HM",h:[0,0,0.02,0.19,0.18]},{sku:"WM",h:[0.35,0.41,0.37,0.11,0.12]},
              {sku:"WD",h:[0.32,0.37,0.31,0.09,0.08]},{sku:"Matcha",h:[0,0,0,0.09,0.07]}].map(s=>(
              <tr key={s.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="py-1.5 font-semibold">{s.sku}</td>
                {s.h.map((v,i)=><td key={i} className={`py-1.5 text-right font-mono text-sm ${v===0?"text-muted-foreground":""}`}>{v===0?"—":`${Math.round(v*100)}%`}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Simulador Tab ────────────────────────────────────────────────────────────
type SimProps = {
  velChains:VelChain[];
  velActive:boolean[]; setVelActive:(v:boolean[])=>void;
  velNew:number[]; setVelNew:(v:number[])=>void;
  velCommitted:boolean[]; setVelCommitted:(v:boolean[])=>void;
  retActive:boolean[]; setRetActive:(v:boolean[])=>void;
  retStores:number[]; setRetStores:(v:number[])=>void;
  retVel:number[]; setRetVel:(v:number[])=>void;
  retEntry:number[]; setRetEntry:(v:number[])=>void;
  retCommitted:boolean[]; setRetCommitted:(v:boolean[])=>void;
  newSkus:NewSku[]; setNewSkus:(v:NewSku[])=>void;
  skuCommitted:boolean[]; setSkuCommitted:(v:boolean[])=>void;
  mixOverrides:Record<string,Record<string,number>>; setMixOverrides:(v:Record<string,Record<string,number>>)=>void;
  mixOverrideActive:boolean; setMixOverrideActive:(v:boolean)=>void;
  mixCommitted:boolean; setMixCommitted:(v:boolean)=>void;
  onClearCommitted:()=>void;
  detailView?:ReactNode;
  skuView?:ReactNode;
};

function SetButton({active,committed,onToggle}:{active:boolean;committed:boolean;onToggle:()=>void}) {
  const base="rounded-full px-3 py-0.5 text-xs font-semibold";
  if(!active) return <button disabled className={`${base} border border-gray-300 text-gray-400 cursor-not-allowed`}>Set</button>;
  if(committed) return <button onClick={onToggle} className={`${base} border border-gray-400 text-gray-500`}>Unset</button>;
  return <button onClick={onToggle} className={`${base} border border-[#1C2340] text-[#1C2340] hover:bg-[#1C2340]/5`}>Set</button>;
}

function rowClass(active:boolean,committed:boolean,tint:string) {
  if(committed) return "bg-amber-50/40 border-l-2 border-amber-400";
  return active?tint:"";
}

/** Collapsible section used by the simulator blocks and the live impact panels. */
function Collapsible({title,subtitle,badge,defaultOpen=true,actions,children}:{
  title:string;subtitle?:string;badge?:ReactNode;defaultOpen?:boolean;
  actions?:ReactNode;children:ReactNode;
}) {
  const [open,setOpen]=useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-4 flex-wrap">
        <button type="button" onClick={()=>setOpen(o=>!o)} className="flex items-start gap-2 text-left flex-1 min-w-0">
          <span className="mt-0.5 text-xs text-muted-foreground transition-transform" style={{transform:open?"rotate(90deg)":"none"}}>▶</span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{color:"#1C2340"}}>{title}</span>
              {badge}
            </span>
            {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
          </span>
        </button>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {open && children}
    </div>
  );
}

function SimuladorTab(p:SimProps) {
  const {velChains,velActive,setVelActive,velNew,setVelNew,velCommitted,setVelCommitted,
    retActive,setRetActive,retStores,setRetStores,retVel,setRetVel,retEntry,setRetEntry,
    retCommitted,setRetCommitted,newSkus,setNewSkus,skuCommitted,setSkuCommitted,
    mixOverrides,setMixOverrides,mixOverrideActive,setMixOverrideActive,mixCommitted,setMixCommitted,
    onClearCommitted,detailView,skuView} = p;

  const velDeltaTotal = velChains.reduce((s,c,i)=>{
    if(!velActive[i]) return s;
    return s+Math.round((velNew[i]-c.velCurrent)*c.stores*WEEKS_PER_MONTH/UNITS_PER_CASE);
  },0);
  const retDeltaTotal = NEW_RETAILERS.reduce((s,_r,i)=>{
    if(!retActive[i]) return s;
    return s+Math.round(retStores[i]*retVel[i]*WEEKS_PER_MONTH/UNITS_PER_CASE);
  },0);
  const skuDeltaTotal = newSkus.reduce((s,sku)=>
    sku.active?s+Math.round(sku.stores*sku.vel*WEEKS_PER_MONTH/UNITS_PER_CASE):s,0);
  const totalDelta = velDeltaTotal+retDeltaTotal+skuDeltaTotal;

  const velLocked = velCommitted.filter(Boolean).length;
  const retLocked = retCommitted.filter(Boolean).length;
  const skuLocked = skuCommitted.filter((c,i)=>c&&newSkus[i]).length;
  const lockedCount = velLocked+retLocked+skuLocked+(mixCommitted?1:0);
  const committedSkuNames = newSkus.filter((_s,i)=>skuCommitted[i]).map(s=>s.name);

  const inp="rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30";
  const MONTH_LABELS=["Aug26","Sep26","Oct26","Nov26","Dec26","Jan27","Feb27","Mar27","Apr27","May27","Jun27","Jul27"];

  function toggleArr(arr:boolean[],i:number,set:(v:boolean[])=>void){const n=[...arr];n[i]=!n[i];set(n);}
  function patchSku(i:number,patch:Partial<NewSku>){const n=newSkus.map((s,j)=>j===i?{...s,...patch}:s);setNewSkus(n);}

  function mixFor(label:string){return mixOverrides[label]??DEFAULT_MIX_PCT;}
  function setMixCell(label:string,sku:string,v:number){
    setMixOverrides({...mixOverrides,[label]:{...mixFor(label),[sku]:v}});
  }
  function applyDefaultAll(){
    const next:Record<string,Record<string,number>>={};
    FORECAST_MONTHS.forEach(m=>{next[m.label]={...DEFAULT_MIX_PCT};});
    setMixOverrides(next);
  }

  return (
    <div className="space-y-5">
      {lockedCount>0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-amber-900">🔒 Committed scenario active · {lockedCount} lever{lockedCount===1?"":"s"} locked in</p>
            <p className="text-xs text-amber-800 mt-0.5">
              Velocity: {velLocked} · Retailers: {retLocked} · New SKUs: {skuLocked} · Mix override: {mixCommitted?"yes":"no"}
            </p>
          </div>
          <button onClick={()=>{
              if(window.confirm("Reset all committed levers to Testing? This will affect production planning inputs.")) onClearCommitted();
            }}
            className="shrink-0 rounded-full border border-amber-500 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">
            Clear all committed
          </button>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {label:"Δ Velocity (Bloque 1)",value:velDeltaTotal,color:velDeltaTotal>0?"#10B981":"#6B7280"},
          {label:"Δ New Retailers (Block 2)",value:retDeltaTotal,color:retDeltaTotal>0?"#A3224A":"#6B7280"},
          {label:"Δ NEW SKUs (Block 3)",value:skuDeltaTotal,color:skuDeltaTotal>0?"#EC4899":"#6B7280"},
          {label:"TOTAL Δ incremental",value:totalDelta,color:"#1C2340"},
        ].map(k=>(
          <div key={k.label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">{k.label}</p>
            <p className="text-xl font-bold font-mono" style={{color:k.color}}>
              {k.value>0?"+":""}{k.value.toLocaleString()} cases/month
            </p>
            <p className="text-xs text-muted-foreground">${(k.value*PRICE_PER_CASE*12/1000).toFixed(0)}K annual revenue</p>
          </div>
        ))}
      </div>

      {/* Bloque 1 — Velocity */}
      <div className={card}>
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Bloque 1 — Velocity por cadena</p>
          <p className="text-xs text-muted-foreground">Cambio de u/tienda/semana en cadenas activas. Activar con SI.</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Cadena</th>
              <th className="px-4 py-2.5 text-right">Stores</th>
              <th className="px-4 py-2.5 text-right">Vel. actual</th>
              <th className="px-4 py-2.5 text-right">Vel. nueva</th>
              <th className="px-4 py-2.5 text-right">Δ cases/month</th>
              <th className="px-4 py-2.5 text-center">Activar</th>
              <th className="px-4 py-2.5 text-center">Set</th>
            </tr>
          </thead>
          <tbody>
            {velChains.map((c,i)=>{
              const delta=velActive[i]?Math.round((velNew[i]-c.velCurrent)*c.stores*WEEKS_PER_MONTH/UNITS_PER_CASE):0;
              return (
                <tr key={i} className={`border-t border-border/60 ${rowClass(velActive[i],velCommitted[i],"bg-emerald-50/20")}`}>
                  <td className="px-4 py-2 font-semibold">{c.name}</td>
                  <td className="px-4 py-2 text-right font-mono">{c.stores}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{c.velCurrent}</td>
                  <td className="px-4 py-2 text-right">
                    <input type="number" step="0.1" min={0} value={velNew[i]}
                      onChange={e=>{const n=[...velNew];n[i]=parseFloat(e.target.value)||0;setVelNew(n);}}
                      className={`${inp} w-20 text-right font-mono`} disabled={!velActive[i]}/>
                  </td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${delta>0?"text-emerald-600":delta<0?"text-red-500":"text-muted-foreground"}`}>
                    {velActive[i]?(delta>0?"+":"")+delta.toLocaleString():"—"}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button onClick={()=>{
                        const n=[...velActive];n[i]=!n[i];setVelActive(n);
                        if(!n[i]&&velCommitted[i]){const c2=[...velCommitted];c2[i]=false;setVelCommitted(c2);}
                      }}
                      className={`rounded-full px-3 py-0.5 text-xs font-bold ${velActive[i]?"text-white":"border border-border text-muted-foreground"}`}
                      style={velActive[i]?{backgroundColor:velCommitted[i]?"#1C2340":"#10B981"}:{}}>
                      {velCommitted[i]?"ON":velActive[i]?"SI":"NO"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <SetButton active={velActive[i]} committed={velCommitted[i]}
                      onToggle={()=>toggleArr(velCommitted,i,setVelCommitted)}/>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bloque 2 — New retailers */}
      <div className={card}>
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Block 2 — New retailers</p>
          <p className="text-xs text-muted-foreground">Automatic ramp-up: month 1 = 40% · month 2 = 70% · month 3+ = 100%</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Retailer</th>
              <th className="px-4 py-2.5 text-right">Stores</th>
              <th className="px-4 py-2.5 text-right">Vel. (u/s/w)</th>
              <th className="px-4 py-2.5 text-right">Entry month</th>
              <th className="px-4 py-2.5 text-right">Δ estabilizado</th>
              <th className="px-4 py-2.5 text-left">Notas</th>
              <th className="px-4 py-2.5 text-center">Activar</th>
              <th className="px-4 py-2.5 text-center">Set</th>
            </tr>
          </thead>
          <tbody>
            {NEW_RETAILERS.map((r,i)=>{
              const delta=Math.round(retStores[i]*retVel[i]*WEEKS_PER_MONTH/UNITS_PER_CASE);
              return (
                <tr key={i} className={`border-t border-border/60 ${rowClass(retActive[i],retCommitted[i],"bg-orange-50/20")}`}>
                  <td className="px-4 py-1.5 font-semibold">{r.name}</td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" min={0} value={retStores[i]}
                      onChange={e=>{const n=[...retStores];n[i]=parseInt(e.target.value)||0;setRetStores(n);}}
                      className={`${inp} w-20 text-right font-mono`}/>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.1" min={0} value={retVel[i]}
                      onChange={e=>{const n=[...retVel];n[i]=parseFloat(e.target.value)||0;setRetVel(n);}}
                      className={`${inp} w-16 text-right font-mono`}/>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <select value={retEntry[i]} onChange={e=>{const n=[...retEntry];n[i]=parseInt(e.target.value);setRetEntry(n);}}
                      className={`${inp} w-24`}>
                      {MONTH_LABELS.map((m,j)=><option key={j} value={j+1}>{j+1} — {m}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold" style={{color:retActive[i]?"#A3224A":"#6B7280"}}>
                    {retActive[i]?`+${delta.toLocaleString()}`:"—"}
                  </td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.note}</td>
                  <td className="px-4 py-1.5 text-center">
                    <button onClick={()=>{
                        const n=[...retActive];n[i]=!n[i];setRetActive(n);
                        if(!n[i]&&retCommitted[i]){const c2=[...retCommitted];c2[i]=false;setRetCommitted(c2);}
                      }}
                      className={`rounded-full px-3 py-0.5 text-xs font-bold ${retActive[i]?"text-white":"border border-border text-muted-foreground"}`}
                      style={retActive[i]?{backgroundColor:retCommitted[i]?"#1C2340":"#10B981"}:{}}>
                      {retCommitted[i]?"ON":retActive[i]?"SI":"NO"}
                    </button>
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    <SetButton active={retActive[i]} committed={retCommitted[i]}
                      onToggle={()=>toggleArr(retCommitted,i,setRetCommitted)}/>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bloque 3 — New SKUs */}
      <div className={card}>
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Block 3 — New SKUs</p>
          <p className="text-xs text-muted-foreground">Fully incremental · 0% cannibalization · ramp-up: month 1=40% · month 2=70% · month 3+=100%</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">SKU name</th>
              <th className="px-4 py-2.5 text-right">Stores</th>
              <th className="px-4 py-2.5 text-right">Vel. (u/s/w)</th>
              <th className="px-4 py-2.5 text-right">Entry month</th>
              <th className="px-4 py-2.5 text-right">Δ stabilized</th>
              <th className="px-4 py-2.5 text-center">Activate</th>
              <th className="px-4 py-2.5 text-center">Set</th>
              <th className="px-2 py-2.5"/>
            </tr>
          </thead>
          <tbody>
            {newSkus.map((s,i)=>{
              const delta=Math.round(s.stores*s.vel*WEEKS_PER_MONTH/UNITS_PER_CASE);
              return (
                <tr key={i} className={`border-t border-border/60 ${rowClass(s.active,skuCommitted[i],"bg-pink-50/30")}`}>
                  <td className="px-4 py-1.5">
                    <input type="text" value={s.name} onChange={e=>patchSku(i,{name:e.target.value})}
                      className={`${inp} w-44 font-semibold`}/>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" min={0} value={s.stores} onChange={e=>patchSku(i,{stores:parseInt(e.target.value)||0})}
                      className={`${inp} w-20 text-right font-mono`}/>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <input type="number" step="0.1" min={0} value={s.vel} onChange={e=>patchSku(i,{vel:parseFloat(e.target.value)||0})}
                      className={`${inp} w-16 text-right font-mono`}/>
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <select value={s.entry} onChange={e=>patchSku(i,{entry:parseInt(e.target.value)})} className={`${inp} w-24`}>
                      {MONTH_LABELS.map((m,j)=><option key={j} value={j+1}>{j+1} — {m}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold" style={{color:s.active?"#A3224A":"#6B7280"}}>
                    {s.active?`+${delta.toLocaleString()}`:"—"}
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    <button onClick={()=>{
                        patchSku(i,{active:!s.active});
                        if(s.active&&skuCommitted[i]){const c2=[...skuCommitted];c2[i]=false;setSkuCommitted(c2);}
                      }}
                      className={`rounded-full px-3 py-0.5 text-xs font-bold ${s.active?"text-white":"border border-border text-muted-foreground"}`}
                      style={s.active?{backgroundColor:skuCommitted[i]?"#1C2340":"#10B981"}:{}}>
                      {skuCommitted[i]?"ON":s.active?"SI":"NO"}
                    </button>
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    <SetButton active={s.active} committed={!!skuCommitted[i]}
                      onToggle={()=>toggleArr(skuCommitted,i,setSkuCommitted)}/>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button disabled={newSkus.length<=1}
                      onClick={()=>{
                        setNewSkus(newSkus.filter((_x,j)=>j!==i));
                        setSkuCommitted(skuCommitted.filter((_x,j)=>j!==i));
                      }}
                      className={`text-xs ${newSkus.length<=1?"text-gray-300 cursor-not-allowed":"text-muted-foreground hover:text-red-500"}`}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-border">
          <button onClick={()=>{
              setNewSkus([...newSkus,{name:"New SKU",stores:50,vel:1.0,entry:1,active:false,committed:false}]);
              setSkuCommitted([...skuCommitted,false]);
            }}
            className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            + Add SKU
          </button>
        </div>
      </div>

      {/* Bloque 4 — SKU mix override */}
      <div className={card}>
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-bold" style={{color:"#1C2340"}}>Block 4 — SKU Mix override</p>
            <p className="text-xs text-muted-foreground">Override the default mix per month. Use for promos or seasonal launches.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>{
                const next=!mixOverrideActive;setMixOverrideActive(next);
                if(!next) setMixCommitted(false);
              }}
              className={`rounded-full px-3 py-0.5 text-xs font-bold ${mixOverrideActive?"text-white":"border border-border text-muted-foreground"}`}
              style={mixOverrideActive?{backgroundColor:mixCommitted?"#1C2340":"#10B981"}:{}}>
              {mixOverrideActive?"ON":"OFF"}
            </button>
            <button onClick={()=>setMixOverrides({})}
              className="rounded-full border border-border px-3 py-0.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Reset all to default
            </button>
            <button onClick={applyDefaultAll}
              className="rounded-full border border-border px-3 py-0.5 text-xs font-semibold text-muted-foreground hover:text-foreground">
              Apply default to all months
            </button>
            <SetButton active={mixOverrideActive} committed={mixCommitted} onToggle={()=>setMixCommitted(!mixCommitted)}/>
          </div>
        </div>
        {mixOverrideActive && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-max">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                    <th className="px-4 py-2.5 text-left">Month</th>
                    {MIX_SKUS.map(s=><th key={s} className="px-3 py-2.5 text-right">{s} %</th>)}
                    <th className="px-4 py-2.5 text-right">Sum</th>
                  </tr>
                </thead>
                <tbody>
                  {FORECAST_MONTHS.map(m=>{
                    const mix=mixFor(m.label);
                    const sum=MIX_SKUS.reduce((s,k)=>s+(mix[k]??0),0);
                    const ok=Math.round(sum)===100;
                    return (
                      <tr key={m.label} className="border-t border-border/60">
                        <td className="px-4 py-1.5 font-semibold">{m.label}</td>
                        {MIX_SKUS.map(k=>{
                          const v=mix[k]??0;
                          const changed=v!==DEFAULT_MIX_PCT[k];
                          return (
                            <td key={k} className={`px-3 py-1.5 text-right ${changed?"bg-amber-50":""}`}>
                              <input type="number" min={0} max={100} step={1} value={v}
                                onChange={e=>setMixCell(m.label,k,parseFloat(e.target.value)||0)}
                                className={`${inp} w-16 text-right font-mono`}/>
                            </td>
                          );
                        })}
                        <td className="px-4 py-1.5 text-right">
                          <span title={ok?"":"Must sum to 100%"}
                            className={`inline-block rounded-lg px-2 py-0.5 font-mono text-xs font-semibold ${ok?"text-emerald-600":"border border-red-500 text-red-600"}`}>
                            {ok?`✓ ${Math.round(sum)}%`:`${Math.round(sum)}%`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-xs text-muted-foreground border-t border-border">
              Tip: To model an August XD promo, increase XD% for Aug 2026 and reduce other SKUs proportionally to keep the row at 100%.
            </p>
          </>
        )}
      </div>

      {lockedCount>0 && (
        <div className="rounded-xl border border-border bg-muted/30 px-5 py-3">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>📦 Committed case requirements are now the input for Operations → Procurement Planning.</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            New SKUs flagged for production: {committedSkuNames.length?committedSkuNames.join(", "):"none"}.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Seasonality Tab ───────────────────────────────────────────────────────
function SeasonalityTab({seasonIdx,onSeasonIdxChange,velChains,onVelChainsChange}:{
  seasonIdx:Record<number,number>;
  onSeasonIdxChange:(idx:Record<number,number>)=>void;
  velChains:VelChain[];
  onVelChainsChange:(chains:VelChain[])=>void;
}) {
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const indices=months.map((_,i)=>seasonIdx[i+1]??0);
  const maxIdx=Math.max(...indices,0.01);
  const inp="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-1 focus:ring-primary/30";

  function setIdx(month:number,v:number){onSeasonIdxChange({...seasonIdx,[month]:v});}
  function setChain(i:number,patch:Partial<VelChain>){
    onVelChainsChange(velChains.map((c,j)=>j===i?{...c,...patch}:c));
  }
  function resetChain(i:number){
    onVelChainsChange(velChains.map((c,j)=>j===i?{...DEFAULT_VEL_CHAINS[i]}:c));
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold mb-1" style={{color:"#1C2340"}}>Seasonality indices — source: 2025 actual</h3>
            <p className="text-xs text-muted-foreground mb-5">Distributor PO cycles, not shopper consumption. 1.0 = average · editable</p>
          </div>
          <button onClick={()=>onSeasonIdxChange({...DEFAULT_SEASON_IDX})}
            className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Reset to default
          </button>
        </div>
        <div className="flex items-end gap-2 h-40">
          {indices.map((v,i)=>(
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <input type="number" step="0.01" min={0} value={v}
                onChange={e=>setIdx(i+1,parseFloat(e.target.value)||0)}
                className={inp} style={{width:60}}/>
              <div className="w-full rounded-t" style={{height:`${(v/maxIdx)*80}px`,backgroundColor:v>=1.3?"#A3224A":v<=0.4?"#E5E7EB":"#1C2340",minHeight:4}}/>
              <span className="text-[9px] text-muted-foreground">{months[i]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>Velocity by chain — editable</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Chain</th>
              <th className="px-4 py-2.5 text-right">Stores</th>
              <th className="px-4 py-2.5 text-right">T4W</th>
              <th className="px-4 py-2.5 text-right">Last week</th>
              <th className="px-4 py-2.5 text-right">Est. cases/month</th>
              <th className="px-4 py-2.5 text-center">Reset</th>
            </tr>
          </thead>
          <tbody>
            {velChains.map((c,i)=>(
              <tr key={i} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{c.name}</td>
                <td className="px-4 py-2 text-right">
                  <input type="number" min={0} value={c.stores}
                    onChange={e=>setChain(i,{stores:parseInt(e.target.value)||0})}
                    className={`${inp} w-20 text-right`}/>
                </td>
                <td className="px-4 py-2 text-right">
                  <input type="number" step="0.01" min={0} value={c.velCurrent}
                    onChange={e=>setChain(i,{velCurrent:parseFloat(e.target.value)||0})}
                    className={`${inp} w-20 text-right`}/>
                </td>
                <td className="px-4 py-2 text-right">
                  <input type="number" step="0.01" min={0} value={c.lastWeek}
                    onChange={e=>setChain(i,{lastWeek:parseFloat(e.target.value)||0})}
                    className={`${inp} w-20 text-right`}/>
                </td>
                <td className="px-4 py-2 text-right font-mono text-emerald-600 font-semibold">
                  {Math.round(c.stores*c.velCurrent*WEEKS_PER_MONTH/UNITS_PER_CASE).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-center">
                  <button onClick={()=>resetChain(i)}
                    className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground">
                    Reset
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function SalesPage() {
  const [tab,setTab] = useState<SalesTab>("real");
  const [scenario,setScenario] = useState<"Pessimistic"|"Normal"|"Optimistic">("Normal");
  const [reals,setReals] = useState<Record<string,number>>({});
  // Actuals are derived from the Fulfillment pipeline (status = Invoiced).
  const {byLabel, casesByLabel, loading:loadingActuals} = useInvoicedActuals();
  const history: HistRow[] = useMemo(()=>Object.values(byLabel)
    .sort((a,b)=>a.year-b.year||a.month-b.month)
    .filter(a=>a.year>=2026&&(a.cases>0||a.revenue>0))
    .map(a=>({label:a.label,cases:a.cases,revenue:Math.round(a.revenue)})),[byLabel]);
  // Pipeline actuals win; manual overrides only fill months with no invoices.
  const mergedReals = useMemo(()=>({...reals,...casesByLabel}),[reals,casesByLabel]);
  const [seasonIdx,setSeasonIdx] = useState<Record<number,number>>(DEFAULT_SEASON_IDX);
  const [velChains,setVelChains] = useState<VelChain[]>(DEFAULT_VEL_CHAINS);
  // Simulator levers live here so committed state survives tab switches.
  const [velActive,setVelActive] = useState<boolean[]>(DEFAULT_VEL_CHAINS.map(()=>false));
  const [velNew,setVelNew] = useState<number[]>(DEFAULT_VEL_CHAINS.map(c=>c.velCurrent));
  const [retActive,setRetActive] = useState<boolean[]>(NEW_RETAILERS.map(()=>false));
  const [retStores,setRetStores] = useState<number[]>(NEW_RETAILERS.map(r=>r.stores));
  const [retVel,setRetVel] = useState<number[]>(NEW_RETAILERS.map(r=>r.vel));
  const [retEntry,setRetEntry] = useState<number[]>(NEW_RETAILERS.map(r=>r.entry));
  const [newSkus,setNewSkus] = useState<NewSku[]>(DEFAULT_NEW_SKUS);
  const [velCommitted,setVelCommitted] = useState<boolean[]>(DEFAULT_VEL_CHAINS.map(()=>false));
  const [retCommitted,setRetCommitted] = useState<boolean[]>(NEW_RETAILERS.map(()=>false));
  const [skuCommitted,setSkuCommitted] = useState<boolean[]>(DEFAULT_NEW_SKUS.map(()=>false));
  const [mixOverrides,setMixOverrides] = useState<Record<string,Record<string,number>>>({});
  const [mixOverrideActive,setMixOverrideActive] = useState(false);
  const [mixCommitted,setMixCommitted] = useState(false);

  useEffect(()=>{
    setVelNew(prev=>velChains.map((c,i)=>prev[i]??c.velCurrent));
  },[velChains]);

  const forecast = useMemo(()=>calcForecast(
    scenario, velActive,velNew, retActive,retStores,retVel,retEntry,
    velChains,seasonIdx,newSkus,
  ),[scenario,velActive,velNew,retActive,retStores,retVel,retEntry,velChains,seasonIdx,newSkus]);

  const committedCount = velCommitted.filter(Boolean).length
    + retCommitted.filter(Boolean).length
    + skuCommitted.filter((c,i)=>c&&!!newSkus[i]).length
    + (mixCommitted?1:0);

  // When levers are locked in, downstream views use only the committed subset.
  const committedForecast = useMemo(()=>calcForecast(
    scenario,
    velActive.map((a,i)=>a&&velCommitted[i]), velNew,
    retActive.map((a,i)=>a&&retCommitted[i]), retStores,retVel,retEntry,
    velChains,seasonIdx,
    newSkus.map((s,i)=>({...s,active:s.active&&!!skuCommitted[i]})),
  ),[scenario,velActive,velCommitted,velNew,retActive,retCommitted,retStores,retVel,retEntry,velChains,seasonIdx,newSkus,skuCommitted]);

  const skuTabForecast = committedCount>0?committedForecast:forecast;
  const skuTabNewSkus = committedCount>0
    ? newSkus.map((s,i)=>({...s,active:s.active&&!!skuCommitted[i]}))
    : newSkus;

  function clearCommitted(){
    setVelCommitted(velCommitted.map(()=>false));
    setRetCommitted(retCommitted.map(()=>false));
    setSkuCommitted(newSkus.map(()=>false));
    setMixCommitted(false);
  }

  // Publish the forecast state so other modules (Operations → Procurement
  // Planning) plan production against the same numbers.
  useEffect(()=>{
    const state: ForecastState = {
      scenario, seasonIdx, velChains,
      velActive, velNew, retActive, retStores, retVel, retEntry, newSkus,
      velCommitted, retCommitted, skuCommitted, mixCommitted,
      mixOverrides, mixOverrideActive,
      committedAt: committedCount>0 ? new Date().toISOString() : null,
    };
    saveForecastState(state);
  },[scenario,seasonIdx,velChains,velActive,velNew,retActive,retStores,retVel,retEntry,newSkus,
     velCommitted,retCommitted,skuCommitted,mixCommitted,mixOverrides,mixOverrideActive,committedCount]);

  useEffect(()=>{
    if(window.Chart) return;
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
    s.async=true;
    document.head.appendChild(s);
  },[]);

  const tabs: {id:SalesTab;label:string}[] = [
    {id:"real",label:"Real Monthly"},
    {id:"resumen",label:"Summary"},
    {id:"detalle",label:"Monthly Detail"},
    {id:"sku",label:"By SKU"},
    {id:"simulador",label:"Simulador"},
    {id:"estacionalidad",label:"Seasonality"},
  ];
  const SCENARIO_INFO = {
    Pessimistic:"0% YoY · same volume · floor",
    Normal:"+15% YoY · organic · working base",
    Optimistic:"+25% YoY · strong organic volume",
  };

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold" style={{color:"#1C2340"}}>Sales</h1>
        <p className="text-sm text-muted-foreground">Demand forecast Aug 2026 → Jul 2027 · update actuals monthly</p>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(["Pessimistic","Normal","Optimistic"] as const).map(s=>(
            <button key={s} onClick={()=>setScenario(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${scenario===s?"text-white shadow-sm":"text-muted-foreground"}`}
              style={scenario===s?{backgroundColor:s==="Pessimistic"?"#EF4444":s==="Normal"?"#1C2340":"#10B981"}:{}}>
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{SCENARIO_INFO[scenario]}</span>
      </div>
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${tab===t.id?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab===t.id?{borderColor:"#A3224A",color:"#A3224A"}:{}}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==="real"          && <RealMonthlyTab actuals={byLabel} loading={loadingActuals}/>}
      {tab==="resumen"       && <SummaryTab forecast={forecast} scenario={scenario} reals={mergedReals} history={history} committedCount={committedCount}/>}
      {tab==="detalle"       && <DetalleTab forecast={forecast} reals={mergedReals} history={history} committedCount={committedCount} onRealUpdate={(l,v)=>setReals(r=>({...r,[l]:v}))}/>}
      {tab==="sku"           && <SKUTab forecast={skuTabForecast} newSkus={skuTabNewSkus}
                                  mixOverrides={mixOverrides} mixOverrideActive={mixOverrideActive&&(committedCount===0||mixCommitted)}
                                  committedCount={committedCount}/>}
      {tab==="simulador"     && <SimuladorTab velChains={velChains}
                                  velActive={velActive} setVelActive={setVelActive}
                                  velNew={velNew} setVelNew={setVelNew}
                                  velCommitted={velCommitted} setVelCommitted={setVelCommitted}
                                  retActive={retActive} setRetActive={setRetActive}
                                  retStores={retStores} setRetStores={setRetStores}
                                  retVel={retVel} setRetVel={setRetVel}
                                  retEntry={retEntry} setRetEntry={setRetEntry}
                                  retCommitted={retCommitted} setRetCommitted={setRetCommitted}
                                  newSkus={newSkus} setNewSkus={setNewSkus}
                                  skuCommitted={skuCommitted} setSkuCommitted={setSkuCommitted}
                                  mixOverrides={mixOverrides} setMixOverrides={setMixOverrides}
                                  mixOverrideActive={mixOverrideActive} setMixOverrideActive={setMixOverrideActive}
                                  mixCommitted={mixCommitted} setMixCommitted={setMixCommitted}
                                  onClearCommitted={clearCommitted}/>}
      {tab==="estacionalidad"&& <SeasonalityTab seasonIdx={seasonIdx} onSeasonIdxChange={setSeasonIdx}
                                  velChains={velChains} onVelChainsChange={setVelChains}/>}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales · BARIS" }] }),
});
