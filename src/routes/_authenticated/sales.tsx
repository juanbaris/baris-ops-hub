import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { useInvoicedActuals, type MonthActual } from "@/hooks/use-invoiced-actuals";
import { supabase } from "@/integrations/supabase/client";

// ─── Constants ────────────────────────────────────────────────────────────────
import {
  PRICE_PER_CASE, UNITS_PER_CASE, WEEKS_PER_MONTH, IMPLIED_ANNUAL_2026,
  DEFAULT_SEASON_IDX, GROWTH, SKU_MIX, FORECAST_MONTHS,
  DEFAULT_VEL_CHAINS, NEW_RETAILERS, calcForecast, skuForecast,
  saveForecastState, DEFAULT_NEW_SKUS, NEW_SKU_COLORS, newSkuCases,
  type VelChain, type ForecastState, type NewSku,
} from "@/lib/sales-forecast";
import {
  EXTENDED_SKUS, SKU_FULL_NAMES, fetchSalesAccounts, fetchPromoCalendar,
  updateSalesAccount, updatePromoCalendarRow, aggregatePromoCalendar,
  mergeForecastWithDb, dbSkuByMonthFromAgg,
  insertSalesAccount, deleteSalesAccount, insertPromoRows, deletePromoRows,
  aggregateByAccountMonth, aggregateAnnualByAccount,
  fetchAccountActuals, upsertAccountActual,
  applySimPlays, playsToPromoRows, computePlayImpact,
  type SalesAccount, type PromoCalendarRow, type DbMonthAgg, type AccountActual, type SimPlay,
} from "@/lib/sales-database";

const DEFAULT_MIX_PCT: Record<string,number> = {XD:30,PW:25,HM:18,WM:12,WD:8,Matcha:7};
const MIX_SKUS = ["XD","PW","HM","WM","WD","Matcha"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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
  "Aug 2027","Sep 2027","Oct 2027","Nov 2027","Dec 2027",
  "Jan 2028","Feb 2028","Mar 2028","Apr 2028","May 2028","Jun 2028",
  "Jul 2028","Aug 2028","Sep 2028","Oct 2028","Nov 2028","Dec 2028",
];

type SalesTab = "real"|"resumen"|"detalle"|"sku"|"simulador"|"estacionalidad"|"accounts"|"promocal"|"pnl";
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
              <th className="px-3 py-2.5 text-right">Gross sales ($)</th>
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
    // Exclude history months that overlap with forecast (avoids Aug 2026 duplication)
    const forecastLabels = new Set(forecast.map((f:any)=>f.label));
    const pureHist = history.filter(h=>!forecastLabels.has(h.label));
    const allMonths = [...pureHist.map(h=>h.label), ...forecast.map((f:any)=>f.label)];
    // Green = real confirmed; Pink = forecast remaining
    const actualVals = allMonths.map(label=>{
      const h = pureHist.find(x=>x.label===label);
      if(h) return h.cases;
      return reals[label]??0;
    });
    const remainingVals = allMonths.map(label=>{
      const fcst = forecast.find((f:any)=>f.label===label);
      if(!fcst) return 0;
      const actual = reals[label]??0;
      return Math.max(0, fcst.totalCases - actual);
    });
    const budgetVals = allMonths.map(label=>{
      const fcst = forecast.find((f:any)=>f.label===label);
      return fcst ? fcst.budgetCases : null;
    });
    const chart = new window.Chart(mainCanvas.current,{
      type:"bar",
      data:{labels:allMonths,datasets:[
        {label:"Real",   data:actualVals,   backgroundColor:"#10B981",              stack:"cases",borderRadius:3},
        {label:"Forecast",data:remainingVals,backgroundColor:"rgba(163,34,74,0.45)",stack:"cases",borderRadius:3},
        {type:"line",label:"Budget",data:budgetVals,borderColor:"#9CA3AF",borderDash:[4,3],pointRadius:3,fill:false,tension:0.3},
      ]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},
        scales:{
          x:{stacked:true},
          y:{stacked:true,ticks:{callback:(v:number)=>v.toLocaleString()}}
        }
      }
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
          {label:"Revenue forecast 12m",value:`$${Math.round(totalRev/1000)}K`,sub:`@$${totalFcst>0?(totalRev/totalFcst).toFixed(2):PRICE_PER_CASE}/case`,color:"#1C2340"},
          {label:"vs Budget",value:`${((totalFcst/totalBudget-1)*100).toFixed(1)}%`,sub:"Pessimistic baseline",color:totalFcst>=totalBudget?"#10B981":"#EF4444"},
          {label:"Months with actuals",value:`${coveredMonths}/${forecast.length}`,sub:"Update monthly",color:"#6B7280"},
        ].map((k,i)=>(
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">{k.label}</p>
            <p className="text-2xl font-bold font-mono" style={{color:k.color}}>{k.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-1" style={{color:"#1C2340"}}>Real · Forecast · Budget — Jan 2026 → Dec 2028</h3>
        <div className="flex items-center gap-4 mb-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{backgroundColor:"#10B981"}}/>Real</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{backgroundColor:"rgba(163,34,74,0.45)"}}/>Forecast remaining</span>
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
type DetalleRange = "all"|"ytd"|"next3"|"rest2026"|"y2026"|"y2027"|"y2028";
const RANGE_OPTIONS: {id:DetalleRange;label:string;sub:string}[] = [
  {id:"all",    label:"All",           sub:"Jan 2026 – Dec 2028"},
  {id:"ytd",    label:"Actuals (YTD)", sub:"Jan–Jul 2026"},
  {id:"next3",  label:"Next 3 months", sub:"Aug–Oct 2026"},
  {id:"rest2026",label:"Rest of 2026", sub:"Aug–Dec 2026"},
  {id:"y2026",  label:"Full 2026",     sub:"Jan–Dec 2026"},
  {id:"y2027",  label:"Full 2027",     sub:"Jan–Dec 2027"},
  {id:"y2028",  label:"Full 2028",     sub:"Jan–Dec 2028"},
];
const NEXT3_LABELS = ["Aug 2026","Sep 2026","Oct 2026"];
const REST2026_LABELS = ["Aug 2026","Sep 2026","Oct 2026","Nov 2026","Dec 2026"];

function DetalleTab({forecast,reals,onRealUpdate,history,committedCount=0,scenario,scenarioPct,onScenarioPctChange}:{forecast:any[];reals:Record<string,number>;onRealUpdate:(l:string,v:number)=>void;history:HistRow[];committedCount?:number;scenario?:string;scenarioPct?:number;onScenarioPctChange?:(v:number)=>void}) {
  const [editing,setEditing]=useState<string|null>(null);
  const [editVal,setEditVal]=useState("");
  const [range,setRange]=useState<DetalleRange>("all");

  // History rows: Jan-Jul 2026 only — exclude any month that's also in forecast (prevents Aug duplication)
  const forecastLabels = new Set(forecast.map(f=>f.label));
  const showHist = range==="all"||range==="ytd"||range==="y2026";
  const histRows: HistRow[] = showHist ? history.filter(h=>!forecastLabels.has(h.label)) : [];
  const fcstRows = forecast.filter(f=>{
    if(range==="all") return true;
    if(range==="ytd") return false;
    if(range==="next3") return NEXT3_LABELS.includes(f.label);
    if(range==="rest2026") return REST2026_LABELS.includes(f.label);
    if(range==="y2026") return f.year===2026;
    if(range==="y2027") return f.year===2027;
    return f.year===2028;
  });

  const histCases = histRows.reduce((s,h)=>s+h.cases,0);
  const histRev   = histRows.reduce((s,h)=>s+h.revenue,0);
  const fcstCases = fcstRows.reduce((s,f)=>s+(reals[f.label]??f.totalCases),0);
  // Use each month's own revenue (real $/case from Promo Calendar); if the user
  // typed an actual case count, scale that month's real price by it.
  const fcstRev   = fcstRows.reduce((s,f)=>{
    const real=reals[f.label];
    if(real==null) return s+(f.revenue??f.totalCases*PRICE_PER_CASE);
    const perCase = f.totalCases>0 ? (f.revenue??f.totalCases*PRICE_PER_CASE)/f.totalCases : PRICE_PER_CASE;
    return s+real*perCase;
  },0);
  const visCases  = histCases+fcstCases;
  const visRev    = histRev+fcstRev;
  const monthCount= histRows.length+fcstRows.length;
  const totalBudget = fcstRows.reduce((s,f)=>s+f.budgetCases,0);
  const activeOpt = RANGE_OPTIONS.find(o=>o.id===range)!;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        💡 Click <strong>Actual cases</strong> to enter actuals at month close.
      </div>

      {onScenarioPctChange && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/60 p-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold" style={{color:"#92400E"}}>⚙️ Assumption — Sensibilidad de escenario</p>
              <p className="text-xs text-amber-800 mt-1 max-w-2xl leading-relaxed">
                El escenario <strong>Normal</strong> es exactamente lo que carga el Promo Calendar (unidades × precio por cuenta), que es tu forecast base 2027-2028.
                Los botones <strong>Pesimista / Optimista</strong> escalan esas unidades ±%: Pesimista = Normal −{scenarioPct}%, Optimista = Normal +{scenarioPct}%.
                La línea punteada del gráfico (Summary) siempre marca el Normal, para que veas cuánto te movés respecto de la base.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="text-xs font-semibold text-amber-900">± %</label>
              <input type="number" min={0} max={100} step={1} value={scenarioPct ?? 25}
                onChange={e=>onScenarioPctChange(parseFloat(e.target.value)||0)}
                className="w-20 rounded border border-amber-300 bg-white px-2 py-1 text-sm font-mono text-right focus:outline-none focus:ring-1 focus:ring-amber-400"/>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-amber-700">Escenario activo:</span>
            <span className="rounded-full px-2 py-0.5 font-bold text-white" style={{backgroundColor:scenario==="Pessimistic"?"#EF4444":scenario==="Optimistic"?"#10B981":"#1C2340"}}>
              {scenario==="Pessimistic"?`Pesimista (−${scenarioPct}%)`:scenario==="Optimistic"?`Optimista (+${scenarioPct}%)`:"Normal (base)"}
            </span>
            <span className="text-amber-600">— cambialo con los botones de arriba de todo.</span>
          </div>
        </div>
      )}

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
function SKUTab({forecast,newSkus,mixOverrides,mixOverrideActive,committedCount,dbSkuByMonth}:{
  forecast:any[];newSkus:NewSku[];mixOverrides:Record<string,Record<string,number>>;
  mixOverrideActive:boolean;committedCount:number;dbSkuByMonth?:Record<string,Record<string,number>>;
}) {
  const SKU_COLORS: Record<string,string> = {
    XD:"#1C2340",PW:"#A3224A",HM:"#3B82F6",WM:"#10B981",WD:"#F59E0B",Matcha:"#8B5CF6",
    VS:"#EC4899",CS:"#F97316",GR:"#14B8A6",GS:"#A855F7",
  };
  const SKUS = [...EXTENDED_SKUS];
  const LEGACY_SKUS = new Set(["XD","PW","HM","WM","WD","Matcha"]);
  const baseByMonth = useMemo(()=>forecast.map(f=>f.totalCases-(f.newSkuDelta??0)),[forecast]);
  const defaultMonths = useMemo(()=>skuForecast(forecast.map((f,i)=>({...f,totalCases:baseByMonth[i]})) as any),[forecast,baseByMonth]);
  const skuData = useMemo(()=>SKUS.map(sku=>{
    const months = forecast.map((f,i)=>{
      const dbRow = dbSkuByMonth?.[f.label];
      if (dbRow) return Math.round(dbRow[sku] ?? 0);
      if (!LEGACY_SKUS.has(sku)) return 0;
      return mixOverrideActive
        ? Math.round(baseByMonth[i]*((mixOverrides[f.label]?.[sku] ?? DEFAULT_MIX_PCT[sku])/100))
        : (defaultMonths[sku]?.[i] ?? 0);
    });
    return {sku,pct:SKU_MIX[sku]??0,months,total:months.reduce((a:number,b:number)=>a+b,0)};
  }),[forecast,defaultMonths,baseByMonth,mixOverrideActive,mixOverrides,dbSkuByMonth]);

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
              {forecast.map(f=><th key={f.label} className="px-3 py-2.5 text-right w-16">{f.label.slice(0,3).toUpperCase()} {f.label.slice(-2)}</th>)}
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

// ─── Simulador Tab (overlay sobre Promo Calendar · temporal hasta aplicar) ────
type NewStoresDraft = { account:string; distributor:string; skus:string; stores:number; vel:number; weeks:number; fromLabel:string };
type VelBumpDraft   = { account:string; sku:string; pct:number; fromLabel:string };

function labelToYM(label:string){ // "Jul 2027" → {year, month}
  const [mon,yr]=label.split(" ");
  const mi=MONTHS_SHORT.indexOf(mon)+1;
  return { year:parseInt(yr), month:mi };
}

function SimuladorTab({plays,setPlays,accountNames,forecastMonths,onApplyNewStores,playImpacts,totalImpact,detailView,skuView}:{
  plays:SimPlay[]; setPlays:(p:SimPlay[])=>void; accountNames:string[]; forecastMonths:{label:string}[];
  onApplyNewStores:(p:SimPlay)=>void;
  playImpacts:Map<string,{cases:number;revenue:number}>; totalImpact:{cases:number;revenue:number};
  detailView?:ReactNode; skuView?:ReactNode;
}) {
  const monthOptions = forecastMonths.filter(m=>{const y=labelToYM(m.label).year; return y>=2027;}).map(m=>m.label);
  const defaultFrom = monthOptions[0] ?? "Jan 2027";

  const [ns,setNs] = useState<NewStoresDraft>({account:accountNames[0]??"",distributor:"UNFI",skus:"XD, PW, HM",stores:100,vel:2,weeks:4.345,fromLabel:defaultFrom});
  const [vb,setVb] = useState<VelBumpDraft>({account:accountNames[0]??"",sku:"XD",pct:10,fromLabel:defaultFrom});

  const inp="rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30";

  function addNewStores(){
    const {year,month}=labelToYM(ns.fromLabel);
    const skus=ns.skus.split(",").map(s=>s.trim()).filter(Boolean);
    if(!ns.account||!skus.length){ window.alert("Completá cuenta y al menos un SKU."); return; }
    const play:SimPlay={id:`ns-${Date.now()}`,kind:"new_stores",active:true,
      label:`+${ns.stores} tiendas ${ns.account} (${skus.join("/")}) desde ${ns.fromLabel}`,
      account:ns.account,distributor:ns.distributor as any,skus,stores:ns.stores,vel:ns.vel,weeks:ns.weeks,fromYear:year,fromMonth:month};
    setPlays([...plays,play]);
  }
  function addVelBump(){
    const {year,month}=labelToYM(vb.fromLabel);
    if(!vb.account||!vb.sku){ window.alert("Completá cuenta y SKU."); return; }
    const play:SimPlay={id:`vb-${Date.now()}`,kind:"vel_bump",active:true,
      label:`${vb.pct>0?"+":""}${vb.pct}% velocity ${vb.sku} en ${vb.account} desde ${vb.fromLabel}`,
      account:vb.account,sku:vb.sku,pct:vb.pct,fromYear:year,fromMonth:month};
    setPlays([...plays,play]);
  }
  function toggle(id:string){ setPlays(plays.map(p=>p.id===id?{...p,active:!p.active}:p)); }
  function remove(id:string){ setPlays(plays.filter(p=>p.id!==id)); }

  const activeCount = plays.filter(p=>p.active).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        🧪 <strong>Modo simulación.</strong> Las jugadas viven <strong>solo acá dentro</strong> — mueven las cards de impacto y las vistas embebidas de Monthly Detail / By SKU de abajo, pero <strong>no tocan el Monthly Detail real</strong> de la solapa. Cuando una jugada te convence, tocás <strong>"Aplicar al Promo Calendar"</strong> y ahí sí pasa a ser data real.
      </div>

      {activeCount>0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Δ Cases incremental</p>
            <p className="text-2xl font-bold font-mono" style={{color:"#10B981"}}>+{totalImpact.cases.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{activeCount} jugada{activeCount===1?"":"s"} activa{activeCount===1?"":"s"}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Δ Revenue incremental</p>
            <p className="text-2xl font-bold font-mono" style={{color:"#A3224A"}}>+${Math.round(totalImpact.revenue/1000).toLocaleString()}K</p>
            <p className="text-xs text-muted-foreground mt-0.5">Sobre el forecast base</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Δ Revenue exacto</p>
            <p className="text-2xl font-bold font-mono" style={{color:"#1C2340"}}>+${totalImpact.revenue.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-0.5">2027 + 2028 acumulado</p>
          </div>
        </div>
      )}

      {/* Jugada 1 — abrir tiendas nuevas */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Abrir tiendas nuevas</p>
          <p className="text-xs text-muted-foreground">Suma unidades desde el mes elegido en adelante. Ej: 100 tiendas de Whole Foods, 3 SKUs, velocity 2, desde Jul 2027.</p>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
          <label className="text-xs">Cuenta<select value={ns.account} onChange={e=>setNs({...ns,account:e.target.value})} className={`${inp} w-full mt-1`}>{accountNames.map(a=><option key={a}>{a}</option>)}</select></label>
          <label className="text-xs">Distribuidor<select value={ns.distributor} onChange={e=>setNs({...ns,distributor:e.target.value})} className={`${inp} w-full mt-1`}><option>UNFI</option><option>KEHE</option><option>Rainforest</option></select></label>
          <label className="text-xs">SKUs (coma)<input value={ns.skus} onChange={e=>setNs({...ns,skus:e.target.value})} className={`${inp} w-full mt-1`}/></label>
          <label className="text-xs">Stores<input type="number" value={ns.stores} onChange={e=>setNs({...ns,stores:parseFloat(e.target.value)||0})} className={`${inp} w-full mt-1 font-mono`}/></label>
          <label className="text-xs">Velocity<input type="number" step="0.1" value={ns.vel} onChange={e=>setNs({...ns,vel:parseFloat(e.target.value)||0})} className={`${inp} w-full mt-1 font-mono`}/></label>
          <label className="text-xs">Desde<select value={ns.fromLabel} onChange={e=>setNs({...ns,fromLabel:e.target.value})} className={`${inp} w-full mt-1`}>{monthOptions.map(m=><option key={m}>{m}</option>)}</select></label>
          <button onClick={addNewStores} className="rounded-full px-4 py-2 text-xs font-semibold text-white" style={{backgroundColor:"#10B981"}}>+ Simular</button>
        </div>
      </div>

      {/* Jugada 2 — subir velocity puntual */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Subir velocity puntual</p>
          <p className="text-xs text-muted-foreground">Multiplica las unidades de una cuenta/SKU desde el mes elegido. Ej: +10% velocity de XD en Sprouts desde Jul 2027.</p>
        </div>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <label className="text-xs">Cuenta<select value={vb.account} onChange={e=>setVb({...vb,account:e.target.value})} className={`${inp} w-full mt-1`}>{accountNames.map(a=><option key={a}>{a}</option>)}</select></label>
          <label className="text-xs">SKU<select value={vb.sku} onChange={e=>setVb({...vb,sku:e.target.value})} className={`${inp} w-full mt-1`}>{[...EXTENDED_SKUS].map(s=><option key={s}>{s}</option>)}</select></label>
          <label className="text-xs">% cambio<input type="number" value={vb.pct} onChange={e=>setVb({...vb,pct:parseFloat(e.target.value)||0})} className={`${inp} w-full mt-1 font-mono`}/></label>
          <div className="flex gap-2 items-end">
            <label className="text-xs flex-1">Desde<select value={vb.fromLabel} onChange={e=>setVb({...vb,fromLabel:e.target.value})} className={`${inp} w-full mt-1`}>{monthOptions.map(m=><option key={m}>{m}</option>)}</select></label>
            <button onClick={addVelBump} className="rounded-full px-4 py-2 text-xs font-semibold text-white" style={{backgroundColor:"#10B981"}}>+ Simular</button>
          </div>
        </div>
      </div>

      {/* Jugadas activas */}
      {plays.length>0 && (
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30"><p className="text-sm font-bold" style={{color:"#1C2340"}}>Jugadas</p></div>
          <div className="divide-y divide-border">
            {plays.map(p=>{
              const im=playImpacts.get(p.id);
              return (
              <div key={p.id} className={`px-5 py-3 flex items-center gap-3 ${p.active?"":"opacity-40"}`}>
                <button onClick={()=>toggle(p.id)} className={`rounded-full px-3 py-0.5 text-xs font-bold ${p.active?"text-white":"border border-border text-muted-foreground"}`} style={p.active?{backgroundColor:"#10B981"}:{}}>{p.active?"ON":"OFF"}</button>
                <span className="text-sm flex-1">{p.label}</span>
                {im && (
                  <span className="text-xs font-mono whitespace-nowrap">
                    <span style={{color:"#10B981"}}>+{im.cases.toLocaleString()} cs</span>
                    <span className="text-muted-foreground mx-1">·</span>
                    <span style={{color:"#A3224A"}}>+${Math.round(im.revenue/1000).toLocaleString()}K</span>
                  </span>
                )}
                {p.kind==="new_stores" && (
                  <button onClick={()=>{ if(window.confirm("¿Escribir esta jugada en el Promo Calendar de forma permanente? Pasa a ser data real y aparece en el Monthly Detail de la solapa.")) onApplyNewStores(p); }}
                    className="rounded-full border border-[#1C2340] px-3 py-0.5 text-xs font-semibold text-[#1C2340] hover:bg-[#1C2340]/5">Aplicar al Promo Calendar</button>
                )}
                <button onClick={()=>remove(p.id)} className="text-muted-foreground hover:text-red-500 text-lg leading-none">×</button>
              </div>
              );
            })}
          </div>
          <p className="px-5 py-3 text-xs text-muted-foreground border-t border-border">
            Los <strong>vel. bumps</strong> son solo simulación (no se persisten). Las <strong>tiendas nuevas</strong> se pueden aplicar al Promo Calendar y ahí pasan a ser data real.
          </p>
        </div>
      )}

      {detailView && (
        <Collapsible title="Live impact — Monthly Detail" defaultOpen={true}
          subtitle="Vista de Monthly Detail recalculada con las jugadas activas.">
          <div className="p-4">{detailView}</div>
        </Collapsible>
      )}
      {skuView && (
        <Collapsible title="Live impact — By SKU" defaultOpen={false}
          subtitle="Split por SKU con las jugadas activas.">
          <div className="p-4">{skuView}</div>
        </Collapsible>
      )}
    </div>
  );
}


// ─── Seasonality Tab ──────────────────────────────────────────────────────────
function SeasonalityTab({seasonIdx,onSeasonIdxChange,velChains,onVelChainsChange,promoMultipliers,onPromoMultipliersChange}:{
  seasonIdx:Record<number,number>;
  onSeasonIdxChange:(idx:Record<number,number>)=>void;
  velChains:VelChain[];
  onVelChainsChange:(chains:VelChain[])=>void;
  promoMultipliers:number[];
  onPromoMultipliersChange:(v:number[])=>void;
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
            <h3 className="text-sm font-bold mb-1" style={{color:"#1C2340"}}>Seasonality indices — derived from budget model</h3>
            <p className="text-xs text-muted-foreground mb-5">Derived from Excel Normal scenario monthly pattern · sum = 12.0 · editable (affects all 3 scenarios)</p>
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
      {/* Promo multipliers per month */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-sm font-bold" style={{color:"#1C2340"}}>Promo multipliers — por mes</h3>
            <p className="text-xs text-muted-foreground">1.0 = sin cambio · 1.5 = +50% demanda · Aplica a los 3 escenarios</p>
          </div>
          <button onClick={()=>onPromoMultipliersChange(Array(FORECAST_MONTHS.length).fill(1))}
            className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground flex-shrink-0">
            Reset × 1.0
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs min-w-max w-full">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                {FORECAST_MONTHS.map(m=>(
                  <th key={m.label} className="px-3 py-2 text-center font-semibold">{m.label.slice(0,6)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {promoMultipliers.map((v,i)=>(
                  <td key={i} className="px-2 py-2 text-center">
                    <input
                      type="number" step="0.05" min="0.1" max="5" value={v}
                      onChange={e=>{
                        const next=[...promoMultipliers];
                        next[i]=parseFloat(e.target.value)||1;
                        onPromoMultipliersChange(next);
                      }}
                      className={`rounded border px-1.5 py-0.5 text-xs font-mono text-center w-16 focus:outline-none focus:ring-1 focus:ring-amber-400 ${v!==1?"border-amber-300 bg-amber-50 font-semibold text-amber-800":"border-border bg-background"}`}
                    />
                    {v!==1&&(
                      <p className={`text-[9px] font-semibold mt-0.5 ${v>1?"text-emerald-600":"text-red-500"}`}>
                        {v>1?`+${Math.round((v-1)*100)}%`:`${Math.round((v-1)*100)}%`}
                      </p>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Accounts Tab (transposed like the Excel — accounts as columns) ──────────
type AcctField = { key: keyof SalesAccount; label: string; pct?: boolean; money?: boolean };
const ACCT_FIELDS: AcctField[] = [
  { key: "distributor", label: "Distributor" },
  { key: "delivered_cost", label: "Delivered Cost", money: true },
  { key: "dist_markup_pct", label: "Dist. Markup", pct: true },
  { key: "srp", label: "SRP", money: true },
  { key: "edlp_allowance", label: "EDLP Allowance", money: true },
  { key: "discounts_pct", label: "Discounts %", pct: true },
  { key: "edlp_pct", label: "EDLP %", pct: true },
  { key: "promos_pct", label: "Promos %", pct: true },
  { key: "dist_fees_pct", label: "Dist. Fees %", pct: true },
  { key: "dist_allowance_pct", label: "Dist. Allowance %", pct: true },
  { key: "payment_terms_pct", label: "Payment Terms %", pct: true },
  { key: "fulfillment_cost", label: "Fulfillment", money: true },
];

function AccountsTab({accounts,annualByAccount,loading,onUpdated,onInserted,onDeleted}:{
  accounts:SalesAccount[];annualByAccount:Map<string,number>;loading:boolean;
  onUpdated:(a:SalesAccount)=>void;onInserted:(rows:SalesAccount[])=>void;onDeleted:(ids:string[])=>void;
}) {
  const [year,setYear] = useState<number>(2027);
  const [saving,setSaving] = useState<string|null>(null);
  const [adding,setAdding] = useState(false);
  const years = Array.from(new Set(accounts.map(a=>a.year))).sort();
  const cols = accounts.filter(a=>a.year===year).sort((a,b)=>a.account_name.localeCompare(b.account_name));

  async function commitCell(acc:SalesAccount, field:AcctField, rawInput:string){
    let val:any;
    if(field.key==="distributor"){
      if(rawInput!=="UNFI"&&rawInput!=="KEHE"&&rawInput!=="Rainforest") return;
      val=rawInput;
    } else {
      const num=parseFloat(rawInput);
      val=isNaN(num)?null:(field.pct?num/100:num);
    }
    const updated={...acc,[field.key]:val} as SalesAccount;
    onUpdated(updated); setSaving(acc.id);
    try{ const {supabase:sb}=await import("@/integrations/supabase/client"); await updateSalesAccount(sb,acc.id,{[field.key]:val}); }catch(e){console.error(e);}
    setSaving(null);
  }

  async function addAccount(){
    const name=window.prompt("Nombre de la cuenta nueva:");
    if(!name||!name.trim()) return;
    const dist=window.prompt("Distribuidor (UNFI / KEHE / Rainforest):","UNFI");
    if(dist!=="UNFI"&&dist!=="KEHE"&&dist!=="Rainforest"){ window.alert("Distribuidor inválido."); return; }
    const dc=dist==="Rainforest"?4.8125:4.62;
    setAdding(true);
    try{
      const {supabase:sb}=await import("@/integrations/supabase/client");
      const created:SalesAccount[]=[];
      for(const y of (years.length?years:[2027,2028])){
        const row=await insertSalesAccount(sb,{year:y,account_name:name.trim(),distributor:dist as any,delivered_cost:dc});
        if(row) created.push(row);
      }
      onInserted(created);
    }catch(e){console.error(e);window.alert("No se pudo crear la cuenta.");}
    setAdding(false);
  }

  async function removeAccount(name:string){
    if(!window.confirm(`¿Eliminar la cuenta "${name}" (todos los años)? También borra sus filas de Promo Calendar.`)) return;
    const ids=accounts.filter(a=>a.account_name===name).map(a=>a.id);
    try{
      const {supabase:sb}=await import("@/integrations/supabase/client");
      for(const id of ids) await deleteSalesAccount(sb,id);
      onDeleted(ids);
    }catch(e){console.error(e);window.alert("No se pudo eliminar.");}
  }

  const fmtMoney=(v:number)=>`$${Math.round(v).toLocaleString()}`;
  const inp="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary/30 w-full";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        🔗 Master de cuentas — fijo pero editable, igual que tu Excel (cuentas en columnas). El <strong>Delivered Cost</strong> alimenta el revenue de Promo Calendar / Sales. La fila <strong>Total $ sales</strong> muestra la facturación anual proyectada de cada cuenta.
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        {years.map(y=>(
          <button key={y} onClick={()=>setYear(y)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${year===y?"text-white":"border border-border text-muted-foreground"}`}
            style={year===y?{backgroundColor:"#1C2340"}:{}}>{y}</button>
        ))}
        <button onClick={addAccount} disabled={adding}
          className="ml-auto rounded-full border border-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
          {adding?"Agregando…":"+ Agregar cuenta"}
        </button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="text-xs min-w-max border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="px-3 py-2.5 text-left sticky left-0 bg-muted/40 z-10 min-w-[140px]">Input value</th>
              {cols.map(a=>(
                <th key={a.id} className="px-3 py-2.5 text-center whitespace-nowrap min-w-[90px] group">
                  <div className="flex items-center justify-center gap-1">
                    <span className="font-bold" style={{color:"#1C2340"}}>{a.account_name}</span>
                    <button onClick={()=>removeAccount(a.account_name)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity" title="Eliminar cuenta">×</button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length+1} className="px-3 py-6 text-center text-muted-foreground">Cargando cuentas…</td></tr>
            ) : (<>
              {ACCT_FIELDS.map(field=>(
                <tr key={field.key as string} className={`border-t border-border/60 ${field.key==="distributor"?"bg-muted/10":""}`}>
                  <td className="px-3 py-1.5 font-semibold sticky left-0 bg-card z-10" style={{color:"#1C2340"}}>{field.label}</td>
                  {cols.map(a=>{
                    const v=a[field.key];
                    if(field.key==="distributor"){
                      return (
                        <td key={a.id} className={`px-2 py-1.5 text-center ${saving===a.id?"bg-amber-50/40":""}`}>
                          <select defaultValue={String(v)} onChange={e=>commitCell(a,field,e.target.value)}
                            className="rounded border border-border bg-background px-1 py-0.5 text-xs focus:outline-none">
                            <option value="UNFI">UNFI</option><option value="KEHE">KEHE</option><option value="Rainforest">Rainforest</option>
                          </select>
                        </td>
                      );
                    }
                    const disp = field.pct && typeof v==="number" ? (v*100).toFixed(1) : (v==null?"":String(v));
                    return (
                      <td key={a.id} className={`px-2 py-1.5 ${saving===a.id?"bg-amber-50/40":""}`}>
                        <input type="number" step="0.01" defaultValue={disp}
                          onBlur={e=>commitCell(a,field,e.target.value)} className={inp}/>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2" style={{borderColor:"#A3224A",backgroundColor:"#F5F0E8"}}>
                <td className="px-3 py-2 font-bold sticky left-0 z-10" style={{color:"#A3224A",backgroundColor:"#F5F0E8"}}>Total $ sales {year}</td>
                {cols.map(a=>{
                  const rev=annualByAccount.get(`${year}|${a.account_name}`)??0;
                  return <td key={a.id} className="px-2 py-2 text-right font-mono font-bold" style={{color:"#A3224A"}}>{fmtMoney(rev)}</td>;
                })}
              </tr>
            </>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Promo Calendar Tab (collapsible per account, add rows) ───────────────────
function PromoCalendarTab({rows,accounts,byAccountMonth,loading,onUpdated,onInserted,onDeleted}:{
  rows:PromoCalendarRow[];accounts:SalesAccount[];byAccountMonth:Map<string,number>;loading:boolean;
  onUpdated:(r:PromoCalendarRow)=>void;onInserted:(rows:PromoCalendarRow[])=>void;onDeleted:(ids:string[])=>void;
}) {
  const years = Array.from(new Set(rows.map(r=>r.year))).sort();
  const [year,setYear] = useState<number>(2027);
  const [saving,setSaving] = useState<string|null>(null);
  const [expanded,setExpanded] = useState<Set<string>>(new Set());
  const accountNames = Array.from(new Set(rows.filter(r=>r.year===year).map(r=>r.account_name))).sort();

  function toggle(name:string){ setExpanded(s=>{const n=new Set(s);n.has(name)?n.delete(name):n.add(name);return n;}); }

  async function commit(row:PromoCalendarRow, patch:Partial<PromoCalendarRow>){
    const stores=patch.stores??row.stores??0, vel=patch.reg_avg_vel??row.reg_avg_vel??0, weeks=patch.weeks??row.weeks??0;
    const recompute=("stores" in patch||"reg_avg_vel" in patch||"weeks" in patch);
    const total_units=recompute?Math.round(stores*vel*weeks*1000)/1000:row.total_units;
    const updated={...row,...patch,total_units};
    onUpdated(updated); setSaving(row.id);
    try{ const {supabase:sb}=await import("@/integrations/supabase/client"); await updatePromoCalendarRow(sb,row.id,{...patch,total_units}); }catch(e){console.error(e);}
    setSaving(null);
  }

  async function addSku(accountName:string){
    const rowsForAcct=rows.filter(r=>r.year===year&&r.account_name===accountName);
    const dist=rowsForAcct[0]?.distributor ?? accounts.find(a=>a.account_name===accountName&&a.year===year)?.distributor ?? "UNFI";
    const sku=window.prompt("Código de SKU (XD, PW, HM, WM, WD, Matcha, VS, CS, GR, GS):");
    if(!sku||!sku.trim()) return;
    const stores=parseFloat(window.prompt("Stores:","0")||"0")||0;
    const vel=parseFloat(window.prompt("Reg AVG Vel. (u/tienda/semana):","0")||"0")||0;
    const weeks=parseFloat(window.prompt("Weeks por mes:","4.345")||"4.345")||4.345;
    const fromM=parseInt(window.prompt("Mes desde (1-12):","1")||"1")||1;
    const toM=parseInt(window.prompt("Mes hasta (1-12):","12")||"12")||12;
    const newRows:Partial<PromoCalendarRow>[]=[];
    for(let m=fromM;m<=toM;m++){
      newRows.push({year,month:m,account_name:accountName,sku_code:sku.trim(),distributor:dist,
        stores,reg_avg_vel:vel,weeks,total_units:Math.round(stores*vel*weeks*1000)/1000,reg_units:Math.round(stores*vel*weeks*1000)/1000,promo_units:0});
    }
    try{ const {supabase:sb}=await import("@/integrations/supabase/client"); const created=await insertPromoRows(sb,newRows); onInserted(created); setExpanded(s=>new Set(s).add(accountName)); }
    catch(e){console.error(e);window.alert("No se pudo agregar el SKU.");}
  }

  async function removeSku(accountName:string, sku:string){
    if(!window.confirm(`¿Eliminar ${sku} de ${accountName} para ${year}?`)) return;
    const ids=rows.filter(r=>r.year===year&&r.account_name===accountName&&r.sku_code===sku).map(r=>r.id);
    try{ const {supabase:sb}=await import("@/integrations/supabase/client"); await deletePromoRows(sb,ids); onDeleted(ids); }
    catch(e){console.error(e);window.alert("No se pudo eliminar.");}
  }

  const inp="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-primary/30 w-16";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        🔗 Fijo pero editable. Cada cuenta arranca colapsada — tocá la flechita para ver sus SKUs, stores y velocities. Stores / Reg Vel. / Weeks recalculan Total Units (Vel × Stores × Weeks) y eso alimenta Summary, Monthly Detail, By SKU y Sales P&L para {year}.
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        {years.map(y=>(
          <button key={y} onClick={()=>setYear(y)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${year===y?"text-white":"border border-border text-muted-foreground"}`}
            style={year===y?{backgroundColor:"#1C2340"}:{}}>{y}</button>
        ))}
        <button onClick={()=>setExpanded(new Set(accountNames))} className="text-xs text-muted-foreground hover:text-foreground underline">Expandir todo</button>
        <button onClick={()=>setExpanded(new Set())} className="text-xs text-muted-foreground hover:text-foreground underline">Colapsar todo</button>
      </div>
      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">Cargando promo calendar…</div>
      ) : accountNames.map(name=>{
        const acctRows=rows.filter(r=>r.year===year&&r.account_name===name);
        const dist=acctRows[0]?.distributor;
        const annual=Array.from({length:12},(_,i)=>byAccountMonth.get(`${year}|${i+1}|${name}`)??0).reduce((a,b)=>a+b,0);
        const skus=Array.from(new Set(acctRows.map(r=>r.sku_code)));
        const isOpen=expanded.has(name);
        return (
          <div key={name} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <button onClick={()=>toggle(name)} className="w-full px-4 py-3 flex items-center gap-3 bg-muted/30 hover:bg-muted/50 text-left">
              <span className="text-xs text-muted-foreground transition-transform" style={{transform:isOpen?"rotate(90deg)":"none"}}>▶</span>
              <span className="font-bold text-sm" style={{color:"#1C2340"}}>{name}</span>
              <span className="text-xs text-muted-foreground">{dist} · {skus.length} SKUs</span>
              <span className="ml-auto font-mono font-semibold text-sm" style={{color:"#A3224A"}}>${Math.round(annual).toLocaleString()}</span>
            </button>
            {isOpen && (
              <div className="p-3 space-y-3">
                {skus.map(sku=>{
                  const skuRows=acctRows.filter(r=>r.sku_code===sku).sort((a,b)=>a.month-b.month);
                  return (
                    <div key={sku} className="overflow-x-auto rounded-xl border border-border/60">
                      <div className="px-3 py-2 border-b border-border/60 bg-muted/20 flex items-center gap-2">
                        <span className="font-bold text-xs" style={{color:"#1C2340"}}>{sku}</span>
                        <span className="text-[11px] text-muted-foreground">{SKU_FULL_NAMES[sku]??""}</span>
                        <button onClick={()=>removeSku(name,sku)} className="ml-auto text-[11px] text-muted-foreground hover:text-red-500">Eliminar</button>
                      </div>
                      <table className="w-full text-xs min-w-max">
                        <thead>
                          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
                            <th className="px-3 py-1.5 text-left">Mes</th>
                            <th className="px-3 py-1.5 text-right">Stores</th>
                            <th className="px-3 py-1.5 text-right">Reg Vel.</th>
                            <th className="px-3 py-1.5 text-right">Weeks</th>
                            <th className="px-3 py-1.5 text-right font-bold">Total Units</th>
                            <th className="px-3 py-1.5 text-right">Promo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skuRows.map(row=>(
                            <tr key={row.id} className={`border-t border-border/40 ${saving===row.id?"bg-amber-50/40":""}`}>
                              <td className="px-3 py-1 font-semibold" style={{color:"#1C2340"}}>{MONTHS_SHORT[row.month-1]}</td>
                              <td className="px-3 py-1 text-right"><input type="number" step="1" defaultValue={row.stores??""} className={inp} onBlur={e=>commit(row,{stores:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right"><input type="number" step="0.01" defaultValue={row.reg_avg_vel??""} className={inp} onBlur={e=>commit(row,{reg_avg_vel:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right"><input type="number" step="0.25" defaultValue={row.weeks??""} className={inp} onBlur={e=>commit(row,{weeks:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right font-mono font-bold" style={{color:"#1C2340"}}>{row.total_units.toLocaleString(undefined,{maximumFractionDigits:1})}</td>
                              <td className="px-3 py-1 text-right"><input type="text" defaultValue={row.promo_label??""} className="rounded border border-border bg-background px-1.5 py-0.5 text-xs w-20 focus:outline-none" onBlur={e=>commit(row,{promo_label:e.target.value===""?null:e.target.value})}/></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                <button onClick={()=>addSku(name)} className="rounded-full border border-emerald-500 px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                  + Agregar SKU a {name}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Sales P&L Tab (month × account · forecast vs real) ───────────────────────
function SalesPnLTab({rows,accounts,byAccountMonth,actuals,loading,onActualSaved}:{
  rows:PromoCalendarRow[];accounts:SalesAccount[];byAccountMonth:Map<string,number>;
  actuals:AccountActual[];loading:boolean;onActualSaved:(a:AccountActual)=>void;
}) {
  const years = Array.from(new Set(rows.map(r=>r.year))).sort();
  const [year,setYear] = useState<number>(2027);
  const [mode,setMode] = useState<"forecast"|"actual"|"delta">("forecast");
  const [editing,setEditing] = useState<string|null>(null);
  const [editVal,setEditVal] = useState("");
  const accountNames = Array.from(new Set(rows.filter(r=>r.year===year).map(r=>r.account_name))).sort();

  const actualMap = useMemo(()=>{
    const m=new Map<string,number|null>();
    actuals.forEach(a=>m.set(`${a.year}|${a.month}|${a.account_name}`,a.actual_revenue));
    return m;
  },[actuals]);

  const fcst=(m:number,acc:string)=>byAccountMonth.get(`${year}|${m}|${acc}`)??0;
  const act =(m:number,acc:string)=>actualMap.get(`${year}|${m}|${acc}`);

  async function saveActual(month:number, acc:string, raw:string){
    const num=parseFloat(raw); const val=isNaN(num)?null:num;
    setEditing(null);
    try{
      const {supabase:sb}=await import("@/integrations/supabase/client");
      await upsertAccountActual(sb,year,month,acc,val);
      onActualSaved({id:`${year}-${month}-${acc}`,year,month,account_name:acc,actual_revenue:val});
    }catch(e){console.error(e);window.alert("No se pudo guardar el real.");}
  }

  const fmt=(v:number)=>`$${Math.round(v).toLocaleString()}`;
  const monthTotFcst=(m:number)=>accountNames.reduce((s,a)=>s+fcst(m,a),0);
  const monthTotAct =(m:number)=>accountNames.reduce((s,a)=>s+(act(m,a)??0),0);
  const acctTotFcst=(a:string)=>Array.from({length:12},(_,i)=>fcst(i+1,a)).reduce((x,y)=>x+y,0);
  const acctTotAct =(a:string)=>Array.from({length:12},(_,i)=>act(i+1,a)??0).reduce((x,y)=>x+y,0);
  const grandFcst=accountNames.reduce((s,a)=>s+acctTotFcst(a),0);
  const grandAct =accountNames.reduce((s,a)=>s+acctTotAct(a),0);

  function cell(m:number,acc:string){
    const f=fcst(m,acc); const a=act(m,acc);
    if(mode==="forecast") return <span className="font-mono text-muted-foreground">{f>0?fmt(f):"—"}</span>;
    if(mode==="delta"){
      if(a==null) return <span className="text-muted-foreground">—</span>;
      const d=a-f;
      return <span className={`font-mono ${d>=0?"text-emerald-600":"text-red-500"}`}>{d>=0?"+":""}{fmt(d)}</span>;
    }
    // actual mode → editable
    const key=`${m}|${acc}`;
    if(editing===key) return (
      <input type="number" autoFocus defaultValue={a??""} className="w-20 rounded border border-border px-1 py-0.5 text-xs font-mono text-right focus:outline-none"
        onBlur={e=>saveActual(m,acc,e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter")saveActual(m,acc,(e.target as HTMLInputElement).value);if(e.key==="Escape")setEditing(null);}}/>
    );
    return (
      <button onClick={()=>{setEditing(key);setEditVal(String(a??""));}}
        className={`rounded px-1.5 py-0.5 text-xs font-mono ${a!=null?"font-semibold text-emerald-600 hover:bg-emerald-50":"text-muted-foreground hover:bg-muted border border-dashed border-border"}`}>
        {a!=null?fmt(a):"cargar"}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        📊 Facturación mensual por cuenta. <strong>Forecast</strong> sale del Promo Calendar (Total Units × Delivered Cost). En <strong>Actual</strong> cargás lo real de cada mes y en <strong>Δ</strong> ves la diferencia contra lo que proyectabas.
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        {years.map(y=>(
          <button key={y} onClick={()=>setYear(y)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${year===y?"text-white":"border border-border text-muted-foreground"}`}
            style={year===y?{backgroundColor:"#1C2340"}:{}}>{y}</button>
        ))}
        <div className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
          {([["forecast","Forecast"],["actual","Actual"],["delta","Δ vs fcst"]] as const).map(([id,lbl])=>(
            <button key={id} onClick={()=>setMode(id)}
              className={`rounded px-3 py-1 text-xs font-semibold ${mode===id?"text-white":"text-muted-foreground"}`}
              style={mode===id?{backgroundColor:"#A3224A"}:{}}>{lbl}</button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="text-xs min-w-max border-collapse">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              <th className="px-3 py-2.5 text-left sticky left-0 bg-muted/40 z-10">Account</th>
              {MONTHS_SHORT.map(m=><th key={m} className="px-3 py-2.5 text-right whitespace-nowrap">{m}</th>)}
              <th className="px-3 py-2.5 text-right font-bold border-l border-border">Total {year}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={14} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>
            ) : accountNames.map(acc=>{
              const tf=acctTotFcst(acc), ta=acctTotAct(acc);
              return (
                <tr key={acc} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-semibold sticky left-0 bg-card z-10" style={{color:"#1C2340"}}>{acc}</td>
                  {Array.from({length:12},(_,i)=>(
                    <td key={i} className="px-3 py-1.5 text-right">{cell(i+1,acc)}</td>
                  ))}
                  <td className="px-3 py-1.5 text-right font-mono font-bold border-l border-border" style={{color:"#A3224A"}}>
                    {mode==="actual"?fmt(ta):mode==="delta"?((ta-tf>=0?"+":"")+fmt(ta-tf)):fmt(tf)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
              <td className="px-3 py-2 font-semibold sticky left-0 z-10" style={{backgroundColor:"#1C2340"}}>TOTAL</td>
              {Array.from({length:12},(_,i)=>{
                const f=monthTotFcst(i+1), a=monthTotAct(i+1);
                const val=mode==="actual"?a:mode==="delta"?(a-f):f;
                return <td key={i} className="px-3 py-2 text-right font-mono font-bold text-emerald-400">{mode==="delta"?((val>=0?"+":"")+fmt(val)):fmt(val)}</td>;
              })}
              <td className="px-3 py-2 text-right font-mono font-bold border-l border-slate-600">
                {mode==="actual"?fmt(grandAct):mode==="delta"?((grandAct-grandFcst>=0?"+":"")+fmt(grandAct-grandFcst)):fmt(grandFcst)}
              </td>
            </tr>
          </tfoot>
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
  const {byLabel, casesByLabel, loading:loadingActuals} = useInvoicedActuals();
  const history: HistRow[] = useMemo(()=>Object.values(byLabel)
    .sort((a,b)=>a.year-b.year||a.month-b.month)
    .filter(a=>a.year>=2026&&(a.cases>0||a.revenue>0))
    .map(a=>({label:a.label,cases:a.cases,revenue:Math.round(a.revenue)})),[byLabel]);
  const mergedReals = useMemo(()=>({...reals,...casesByLabel}),[reals,casesByLabel]);
  const [seasonIdx,setSeasonIdx] = useState<Record<number,number>>(DEFAULT_SEASON_IDX);
  const [velChains,setVelChains] = useState<VelChain[]>(DEFAULT_VEL_CHAINS);
  const [velActive,setVelActive] = useState<boolean[]>(DEFAULT_VEL_CHAINS.map(()=>false));
  const [velNew,setVelNew] = useState<number[]>(DEFAULT_VEL_CHAINS.map(c=>c.velCurrent));
  const [retActive,setRetActive] = useState<boolean[]>(NEW_RETAILERS.map(()=>false));
  const [retStores,setRetStores] = useState<number[]>(NEW_RETAILERS.map(r=>r.stores));
  const [retVel,setRetVel] = useState<number[]>(NEW_RETAILERS.map(r=>r.vel));
  const [retEntry,setRetEntry] = useState<number[]>(NEW_RETAILERS.map(r=>r.entry));
  const [retVelBySku,setRetVelBySku] = useState<(number[]|null)[]>(NEW_RETAILERS.map(()=>null));
  const [newSkus,setNewSkus] = useState<NewSku[]>(DEFAULT_NEW_SKUS);
  const [velCommitted,setVelCommitted] = useState<boolean[]>(DEFAULT_VEL_CHAINS.map(()=>false));
  const [retCommitted,setRetCommitted] = useState<boolean[]>(NEW_RETAILERS.map(()=>false));
  const [skuCommitted,setSkuCommitted] = useState<boolean[]>(DEFAULT_NEW_SKUS.map(()=>false));
  const [mixOverrides,setMixOverrides] = useState<Record<string,Record<string,number>>>({});
  const [mixOverrideActive,setMixOverrideActive] = useState(false);
  const [mixCommitted,setMixCommitted] = useState(false);
  const [promoMultipliers,setPromoMultipliers] = useState<number[]>(Array(FORECAST_MONTHS.length).fill(1));
  // Scenario ±% applied on top of the Promo Calendar (Normal) for 2027+.
  const [scenarioPct,setScenarioPct] = useState<number>(25);
  useEffect(()=>{ try{ const v=window.localStorage.getItem("baris.sales.scenarioPct"); if(v!=null) setScenarioPct(parseFloat(v)||25); }catch{} },[]);
  useEffect(()=>{ try{ window.localStorage.setItem("baris.sales.scenarioPct",String(scenarioPct)); }catch{} },[scenarioPct]);
  const scenarioFactor = scenario==="Pessimistic" ? 1-scenarioPct/100
    : scenario==="Optimistic" ? 1+scenarioPct/100 : 1;

  // ── Sales database: Accounts + Promo Calendar (2027+, replaces the scenario
  //    formula for any month present here; 2026 stays on Fulfillment) ────────
  const [dbAccounts,setDbAccounts] = useState<SalesAccount[]>([]);
  const [dbPromo,setDbPromo] = useState<PromoCalendarRow[]>([]);
  const [dbLoading,setDbLoading] = useState(true);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try {
        const { supabase: sb } = await import("@/integrations/supabase/client");
        const [accs,rows] = await Promise.all([fetchSalesAccounts(sb), fetchPromoCalendar(sb)]);
        if(!cancelled){ setDbAccounts(accs); setDbPromo(rows); }
      } catch(e) { console.error("Sales DB load error:", e); }
      if(!cancelled) setDbLoading(false);
    })();
    return ()=>{ cancelled=true; };
  },[]);
  const [simPlays,setSimPlays] = useState<SimPlay[]>([]);
  const effectivePromo = useMemo(()=>applySimPlays(dbPromo,simPlays),[dbPromo,simPlays]);
  const simAccountNames = useMemo(()=>Array.from(new Set(dbAccounts.map(a=>a.account_name))).sort(),[dbAccounts]);
  async function applyNewStoresPlay(play:SimPlay){
    if(play.kind!=="new_stores") return;
    try{
      const {supabase:sb}=await import("@/integrations/supabase/client");
      const rows=playsToPromoRows([play]);
      const created=await insertPromoRows(sb,rows);
      setDbPromo(prev=>[...prev,...created]);
      setSimPlays(prev=>prev.filter(p=>p.id!==play.id)); // ya es data real, sacamos el overlay
    }catch(e){ console.error(e); window.alert("No se pudo aplicar al Promo Calendar."); }
  }
  const dbAgg = useMemo(()=>aggregatePromoCalendar(dbPromo,dbAccounts),[dbPromo,dbAccounts]);
  const dbSkuByMonth = useMemo(()=>dbSkuByMonthFromAgg(dbAgg),[dbAgg]);
  const byAccountMonth = useMemo(()=>aggregateByAccountMonth(dbPromo,dbAccounts),[dbPromo,dbAccounts]);
  const annualByAccount = useMemo(()=>aggregateAnnualByAccount(dbPromo,dbAccounts),[dbPromo,dbAccounts]);
  // Simulator overlay: only feeds the simulator's own embedded views + impact cards.
  const dbAggSim = useMemo(()=>aggregatePromoCalendar(effectivePromo,dbAccounts),[effectivePromo,dbAccounts]);
  const dbSkuByMonthSim = useMemo(()=>dbSkuByMonthFromAgg(dbAggSim),[dbAggSim]);
  const [dbActuals,setDbActuals] = useState<AccountActual[]>([]);
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try{
        const { supabase: sb } = await import("@/integrations/supabase/client");
        const acts = await fetchAccountActuals(sb);
        if(!cancelled) setDbActuals(acts);
      }catch(e){ console.error("actuals load error:",e); }
    })();
    return ()=>{ cancelled=true; };
  },[]);
  function saveActualLocal(a:AccountActual){
    setDbActuals(prev=>{
      const i=prev.findIndex(x=>x.year===a.year&&x.month===a.month&&x.account_name===a.account_name);
      if(i>=0){ const n=[...prev]; n[i]={...n[i],actual_revenue:a.actual_revenue}; return n; }
      return [...prev,a];
    });
  }
  function refreshPromoRow(updated:PromoCalendarRow){
    setDbPromo(rows=>rows.map(r=>r.id===updated.id?updated:r));
  }
  function refreshAccount(updated:SalesAccount){
    setDbAccounts(accs=>accs.map(a=>a.id===updated.id?updated:a));
  }
  function addAccounts(rows:SalesAccount[]){ setDbAccounts(accs=>[...accs,...rows]); }
  function removeAccounts(ids:string[]){
    const idSet=new Set(ids);
    const names=new Set(dbAccounts.filter(a=>idSet.has(a.id)).map(a=>a.account_name));
    setDbAccounts(accs=>accs.filter(a=>!idSet.has(a.id)));
    setDbPromo(rows=>rows.filter(r=>!names.has(r.account_name)));
  }
  function addPromoRows(rows:PromoCalendarRow[]){ setDbPromo(prev=>[...prev,...rows]); }
  function removePromoRows(ids:string[]){ const s=new Set(ids); setDbPromo(prev=>prev.filter(r=>!s.has(r.id))); }

  // ── Load saved state on mount (localStorage + Supabase) ──
  const [stateLoaded, setStateLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try Supabase first (source of truth for SET state)
      let loaded: any = null;
      try {
        const { initForecastSupabase, loadForecastFromSupabase } = await import("@/lib/sales-forecast");
        const { supabase: sb } = await import("@/integrations/supabase/client");
        initForecastSupabase(sb);
        loaded = await loadForecastFromSupabase();
      } catch {}
      // Fallback to localStorage
      if (!loaded) {
        try {
          const raw = window.localStorage.getItem("baris.sales.forecast.v1");
          if (raw) loaded = JSON.parse(raw);
        } catch {}
      }
      if (cancelled || !loaded) { setStateLoaded(true); return; }
      // Apply loaded state to all individual states
      if (loaded.scenario) setScenario(loaded.scenario);
      if (loaded.seasonIdx) setSeasonIdx(loaded.seasonIdx);
      if (loaded.velChains) setVelChains(loaded.velChains);
      if (loaded.velActive) setVelActive(loaded.velActive);
      if (loaded.velNew) setVelNew(loaded.velNew);
      if (loaded.retActive) setRetActive(loaded.retActive);
      if (loaded.retStores) setRetStores(loaded.retStores);
      if (loaded.retVel) setRetVel(loaded.retVel);
      if (loaded.retEntry) setRetEntry(loaded.retEntry);
      if (loaded.retVelBySku) setRetVelBySku(loaded.retVelBySku);
      if (loaded.newSkus) setNewSkus(loaded.newSkus);
      if (loaded.velCommitted) setVelCommitted(loaded.velCommitted);
      if (loaded.retCommitted) setRetCommitted(loaded.retCommitted);
      if (loaded.skuCommitted) setSkuCommitted(loaded.skuCommitted);
      if (loaded.mixOverrides) setMixOverrides(loaded.mixOverrides);
      if (loaded.mixOverrideActive != null) setMixOverrideActive(loaded.mixOverrideActive);
      if (loaded.mixCommitted != null) setMixCommitted(loaded.mixCommitted);
      if (loaded.promoMultipliers) setPromoMultipliers(loaded.promoMultipliers);
      setStateLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(()=>{
    setVelNew(prev=>velChains.map((c,i)=>prev[i]??c.velCurrent));
  },[velChains]);

  const forecast = useMemo(()=>calcForecast(
    scenario, velActive,velNew, retActive,retStores,retVel,retEntry,
    velChains,seasonIdx,newSkus,promoMultipliers,retVelBySku,
  ),[scenario,velActive,velNew,retActive,retStores,retVel,retEntry,velChains,seasonIdx,newSkus,promoMultipliers,retVelBySku]);

  const committedCount = velCommitted.filter(Boolean).length
    + retCommitted.filter(Boolean).length
    + skuCommitted.filter((c,i)=>c&&!!newSkus[i]).length
    + (mixCommitted?1:0);

  const committedForecast = useMemo(()=>calcForecast(
    scenario,
    velActive.map((a,i)=>a&&velCommitted[i]), velNew,
    retActive.map((a,i)=>a&&retCommitted[i]), retStores,retVel,retEntry,
    velChains,seasonIdx,
    newSkus.map((s,i)=>({...s,active:s.active&&!!skuCommitted[i]})),
    promoMultipliers, retVelBySku,
  ),[scenario,velActive,velCommitted,velNew,retActive,retCommitted,retStores,retVel,retEntry,velChains,seasonIdx,newSkus,skuCommitted,promoMultipliers,retVelBySku]);

  const skuTabForecast = committedCount>0?committedForecast:forecast;
  const skuTabNewSkus = committedCount>0
    ? newSkus.map((s,i)=>({...s,active:s.active&&!!skuCommitted[i]}))
    : newSkus;

  // DB (Promo Calendar + Accounts) overrides the scenario formula for any month
  // it covers — currently 2027-2028. Used by Summary / Monthly Detail / By SKU.
  const dbMergedForecast = useMemo(()=>mergeForecastWithDb(forecast,dbAgg,scenarioFactor),[forecast,dbAgg,scenarioFactor]);
  const dbMergedSkuTabForecast = useMemo(()=>mergeForecastWithDb(skuTabForecast,dbAgg,scenarioFactor),[skuTabForecast,dbAgg,scenarioFactor]);
  // Simulator-only forecasts (with overlay) for the embedded views inside the Simulador tab.
  const simMergedForecast = useMemo(()=>mergeForecastWithDb(forecast,dbAggSim,scenarioFactor),[forecast,dbAggSim,scenarioFactor]);
  const simMergedSkuForecast = useMemo(()=>mergeForecastWithDb(skuTabForecast,dbAggSim,scenarioFactor),[skuTabForecast,dbAggSim,scenarioFactor]);
  const playImpacts = useMemo(()=>{
    const map=new Map<string,{cases:number;revenue:number}>();
    simPlays.forEach(p=>map.set(p.id,computePlayImpact(p,dbPromo,dbAccounts)));
    return map;
  },[simPlays,dbPromo,dbAccounts]);
  const totalImpact = useMemo(()=>{
    let cases=0,revenue=0;
    simPlays.forEach(p=>{ if(p.active){ const im=playImpacts.get(p.id); if(im){cases+=im.cases;revenue+=im.revenue;} }});
    return {cases,revenue};
  },[simPlays,playImpacts]);

  function clearCommitted(){
    setVelCommitted(velCommitted.map(()=>false));
    setRetCommitted(retCommitted.map(()=>false));
    setSkuCommitted(newSkus.map(()=>false));
    setMixCommitted(false);
  }

  useEffect(()=>{
    if (!stateLoaded) return; // Don't save until initial state is loaded
    const state: ForecastState = {
      scenario, seasonIdx, velChains,
      velActive, velNew, retActive, retStores, retVel, retEntry, newSkus,
      velCommitted, retCommitted, skuCommitted, mixCommitted,
      mixOverrides, mixOverrideActive,
      committedAt: committedCount>0 ? new Date().toISOString() : null,
      promoMultipliers, retVelBySku,
    };
    saveForecastState(state);
  },[stateLoaded,scenario,seasonIdx,velChains,velActive,velNew,retActive,retStores,retVel,retEntry,newSkus,
     velCommitted,retCommitted,skuCommitted,mixCommitted,mixOverrides,mixOverrideActive,committedCount]);

  useEffect(()=>{
    if(window.Chart) return;
    const s=document.createElement("script");
    s.src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
    s.async=true;
    document.head.appendChild(s);
  },[]);

  const TABS_OPERATIONAL: {id:SalesTab;label:string}[] = [
    {id:"real",label:"Real Monthly"},
    {id:"resumen",label:"Summary"},
    {id:"detalle",label:"Monthly Detail"},
    {id:"sku",label:"By SKU"},
    {id:"simulador",label:"Simulador"},
    {id:"estacionalidad",label:"Seasonality"},
  ];
  const TABS_REFERENCE: {id:SalesTab;label:string}[] = [
    {id:"accounts",label:"Accounts"},
    {id:"promocal",label:"Promo Calendar"},
    {id:"pnl",label:"Sales P&L"},
  ];

  // ── Updated scenario descriptions from Excel budget model (Aug 2026) ────────
  const SCENARIO_INFO = {
    Pessimistic: "Best Estimate · $2.17M 2026",
    Normal:      "+43% → $2.5M 2026",
    Optimistic:  "+80% → $2.8M 2026",
  };

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold" style={{color:"#1C2340"}}>Sales</h1>
        <p className="text-sm text-muted-foreground">Demand forecast Aug 2026 → Dec 2028 · update actuals monthly</p>
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
      <div className="flex gap-1 border-b border-border overflow-x-auto items-center">
        {TABS_OPERATIONAL.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${tab===t.id?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab===t.id?{borderColor:"#A3224A",color:"#A3224A"}:{}}>
            {t.label}
          </button>
        ))}
        <div className="mx-2 h-5 w-px bg-border self-center flex-shrink-0"/>
        {TABS_REFERENCE.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${tab===t.id?"border-primary text-primary":"border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab===t.id?{borderColor:"#6B7280",color:"#6B7280"}:{}}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==="real"          && <RealMonthlyTab actuals={byLabel} loading={loadingActuals}/>}
      {tab==="resumen"       && <SummaryTab forecast={dbMergedForecast} scenario={scenario} reals={mergedReals} history={history} committedCount={committedCount}/>}
      {tab==="detalle"       && <DetalleTab forecast={dbMergedForecast} reals={mergedReals} history={history} committedCount={committedCount} onRealUpdate={(l,v)=>setReals(r=>({...r,[l]:v}))} scenario={scenario} scenarioPct={scenarioPct} onScenarioPctChange={setScenarioPct}/>}
      {tab==="sku"           && <SKUTab forecast={dbMergedSkuTabForecast} newSkus={skuTabNewSkus}
                                  mixOverrides={mixOverrides} mixOverrideActive={mixOverrideActive&&(committedCount===0||mixCommitted)}
                                  committedCount={committedCount} dbSkuByMonth={dbSkuByMonth}/>}
      {tab==="simulador"     && <SimuladorTab plays={simPlays} setPlays={setSimPlays}
                                  accountNames={simAccountNames} forecastMonths={FORECAST_MONTHS}
                                  onApplyNewStores={applyNewStoresPlay}
                                  playImpacts={playImpacts} totalImpact={totalImpact}
                                  detailView={<DetalleTab forecast={simMergedForecast} reals={mergedReals} history={history} committedCount={committedCount} onRealUpdate={(l,v)=>setReals(r=>({...r,[l]:v}))}/>}
                                  skuView={<SKUTab forecast={simMergedSkuForecast} newSkus={skuTabNewSkus}
                                    mixOverrides={mixOverrides} mixOverrideActive={mixOverrideActive&&(committedCount===0||mixCommitted)}
                                    committedCount={committedCount} dbSkuByMonth={dbSkuByMonthSim}/>}/>}
      {tab==="estacionalidad"&& <SeasonalityTab seasonIdx={seasonIdx} onSeasonIdxChange={setSeasonIdx}
                                  velChains={velChains} onVelChainsChange={setVelChains}
                                  promoMultipliers={promoMultipliers} onPromoMultipliersChange={setPromoMultipliers}/>}
      {tab==="accounts"      && <AccountsTab accounts={dbAccounts} annualByAccount={annualByAccount} loading={dbLoading} onUpdated={refreshAccount} onInserted={addAccounts} onDeleted={removeAccounts}/>}
      {tab==="promocal"      && <PromoCalendarTab rows={dbPromo} accounts={dbAccounts} byAccountMonth={byAccountMonth} loading={dbLoading} onUpdated={refreshPromoRow} onInserted={addPromoRows} onDeleted={removePromoRows}/>}
      {tab==="pnl"           && <SalesPnLTab rows={dbPromo} accounts={dbAccounts} byAccountMonth={byAccountMonth} actuals={dbActuals} loading={dbLoading} onActualSaved={saveActualLocal}/>}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales · BARIS" }] }),
});
