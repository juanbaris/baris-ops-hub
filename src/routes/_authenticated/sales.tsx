import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useRef, useState, useMemo, type ReactNode } from "react";
import { useInvoicedActuals, type MonthActual } from "@/hooks/use-invoiced-actuals";
import { useInvoicedBreakdown } from "@/hooks/use-invoiced-breakdown";
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
  aggregateByAccountMonth, aggregateAnnualByAccount, aggregateAnnualUnitsByAccount,
  fetchAccountActuals, shiftPromoOneMonthEarlier,
  fetchAssumptions, updateAssumption, deliveredCostOf, distPctOf, cogsOf, fulfillmentPerUnit,
  accountPnLInputs,
  breakdownByRetail, breakdownByDistributor, breakdownBySku, sumOverMonths, monthKeysForPeriod,
  type SalesAccount, type PromoCalendarRow, type DbMonthAgg, type AccountActual, type BreakdownRow,
  type AccountPnLInputs,
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

type SalesTab = "real"|"resumen"|"detalle"|"sku"|"estacionalidad"|"accounts"|"promocal"|"breakdown";
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
              <th className="px-4 py-2.5 text-right font-bold">CASES</th>
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
                <td colSpan={8} className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider border-y-2" style={{color:"#A3224A",borderColor:"#A3224A"}}>
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
              <td className="px-4 py-2 text-xs font-semibold" colSpan={1}>TOTAL · {activeOpt.label} ({monthCount} months)</td>
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

  const grandTotal = forecast.reduce((s,f)=>s+f.totalCases,0);
  const mixSlices = SKUS.map(sku=>({key:sku,color:SKU_COLORS[sku],cases:skuData.find(d=>d.sku===sku)?.total??0}));
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-1" style={{color:"#1C2340"}}>Mix de SKUs — 2026 (fórmula) · 2027–2028 (Promo Calendar)</h3>
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
            <tr className="border-t-2 border-border font-bold" style={{backgroundColor:"#1C2340",color:"#fff"}}>
              <td className="px-4 py-2">TOTAL</td>
              <td className="px-4 py-2 text-center">100%</td>
              {forecast.map(f=><td key={f.label} className="px-3 py-2 text-right font-mono">{f.totalCases.toLocaleString()}</td>)}
              <td className="px-4 py-2 text-right font-mono">{forecast.reduce((s,f)=>s+f.totalCases,0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>
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
            <p className="text-xs text-muted-foreground mb-5">Solo afecta el forecast <strong>2026</strong> (fórmula). Para 2027-2028 los números salen del Promo Calendar y la estacionalidad no aplica. Suma = 12.0 · editable.</p>
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
type AcctCtx = {
  year: number;
  assumptions: Record<string, number>;
  pnl: Map<string, AccountPnLInputs>;   // per-account inputs from Promo Calendar
};
type AcctRow = AcctField
  | { kind: "separator"; label: string; danger?: boolean }
  | { kind: "formula"; label: string; danger?: boolean; fn: (a: SalesAccount, ctx: AcctCtx) => string };

// helpers reused across formulas
function _pnl(a: SalesAccount, ctx: AcctCtx) { return ctx.pnl.get(a.account_name) ?? { totalUnits:0, regUnits:0, promoUnits:0, promoCost:0, unitsBySku:{} }; }
function _dc(a: SalesAccount, ctx: AcctCtx) { return deliveredCostOf(ctx.assumptions, a.distributor); }
function _grossSales(a: SalesAccount, ctx: AcctCtx) { return _pnl(a,ctx).totalUnits * _dc(a,ctx); }
function _edlpTotal(a: SalesAccount, ctx: AcctCtx) { return _pnl(a,ctx).totalUnits * (a.edlp_allowance ?? 0); }
function _distFee(a: SalesAccount, ctx: AcctCtx) { return _grossSales(a,ctx) * distPctOf(ctx.assumptions,"dist_fees",a.distributor); }
function _distAllow(a: SalesAccount, ctx: AcctCtx) { return _grossSales(a,ctx) * distPctOf(ctx.assumptions,"dist_allowance",a.distributor); }
function _payTerms(a: SalesAccount, ctx: AcctCtx) { return _grossSales(a,ctx) * distPctOf(ctx.assumptions,"payment_terms",a.distributor); }
function _promoCost(a: SalesAccount, ctx: AcctCtx) { return _pnl(a,ctx).promoCost; }
function _totalDiscounts(a: SalesAccount, ctx: AcctCtx) { return _edlpTotal(a,ctx) + _promoCost(a,ctx) + _distFee(a,ctx) + _distAllow(a,ctx) + _payTerms(a,ctx); }
function _netSales(a: SalesAccount, ctx: AcctCtx) { return _grossSales(a,ctx) - _totalDiscounts(a,ctx); }
function _cogs(a: SalesAccount, ctx: AcctCtx) { const p=_pnl(a,ctx); return Object.entries(p.unitsBySku).reduce((s,[sku,u])=>s+u*cogsOf(ctx.assumptions,sku),0); }
function _fulfillment(a: SalesAccount, ctx: AcctCtx) { return _pnl(a,ctx).totalUnits * fulfillmentPerUnit(ctx.assumptions); }
function _grossProfit(a: SalesAccount, ctx: AcctCtx) { return _netSales(a,ctx) - _cogs(a,ctx) - _fulfillment(a,ctx); }
const _money = (v:number) => "$"+Math.round(v).toLocaleString();

const ACCT_ROWS: AcctRow[] = [
  // ── Pricing ──
  { key: "distributor", label: "Distributor" },
  { kind: "formula", label: "Delivered Cost", fn: (a,ctx) => "$"+_dc(a,ctx).toFixed(4) },   // from assumptions
  { key: "dist_markup_pct", label: "Dist. Markup", pct: true },
  { key: "edlp_allowance", label: "EDLP", money: true },
  { key: "srp", label: "SRP", money: true },
  { kind: "formula", label: "Account Cost", fn: (a,ctx) => "$"+(_dc(a,ctx)*(1+(a.dist_markup_pct??0))).toFixed(4) },
  { kind: "formula", label: "Account GM", fn: (a,ctx) => { const srp=a.srp??0; if(!srp) return "—"; const ac=_dc(a,ctx)*(1+(a.dist_markup_pct??0)); return ((srp-ac)/srp*100).toFixed(1)+"%"; }},

  // ── 52W P&L (todo fórmula) ──
  { kind: "separator", label: "52W P&L" },
  { kind: "formula", label: "Total units", fn: (a,ctx) => Math.round(_pnl(a,ctx).totalUnits).toLocaleString() },
  { kind: "formula", label: "Regular sales", fn: (a,ctx) => { const p=_pnl(a,ctx); if(!p.totalUnits) return "—"; return (p.regUnits/p.totalUnits*100).toFixed(0)+"%"; }},
  { kind: "formula", label: "Promo", fn: (a,ctx) => { const p=_pnl(a,ctx); if(!p.totalUnits) return "—"; return (p.promoUnits/p.totalUnits*100).toFixed(0)+"%"; }},
  { kind: "formula", label: "Gross Sales", fn: (a,ctx) => _money(_grossSales(a,ctx)) },

  { kind: "separator", label: "Total Discounts", danger: true },
  { kind: "formula", label: "   % discount", fn: (a,ctx) => { const gs=_grossSales(a,ctx); if(!gs) return "—"; return (_totalDiscounts(a,ctx)/gs*100).toFixed(1)+"%"; }},
  { kind: "formula", label: "   EDLP", fn: (a,ctx) => _money(_edlpTotal(a,ctx)) },
  { kind: "formula", label: "   Promo", fn: (a,ctx) => _money(_promoCost(a,ctx)) },
  { kind: "formula", label: "   Dist Fee", fn: (a,ctx) => _money(_distFee(a,ctx)) },
  { kind: "formula", label: "   Dist Allow", fn: (a,ctx) => _money(_distAllow(a,ctx)) },
  { kind: "formula", label: "   Paym Terms", fn: (a,ctx) => _money(_payTerms(a,ctx)) },

  { kind: "separator", label: "Net Sales", danger: true },
  { kind: "formula", label: "Net Sales", danger: true, fn: (a,ctx) => _money(_netSales(a,ctx)) },
  { kind: "formula", label: "COGS", fn: (a,ctx) => _money(_cogs(a,ctx)) },
  { kind: "formula", label: "Fulfillment", fn: (a,ctx) => _money(_fulfillment(a,ctx)) },
  { kind: "formula", label: "Gross Profit", danger: true, fn: (a,ctx) => _money(_grossProfit(a,ctx)) },
  { kind: "formula", label: "Gross Margin", danger: true, fn: (a,ctx) => { const gs=_grossSales(a,ctx); if(!gs) return "—"; return (_grossProfit(a,ctx)/gs*100).toFixed(0)+"%"; }},
];

function AccountsTab({accounts,promoRows,assumptions,onAssumptionChange,loading,onUpdated,onInserted,onDeleted}:{
  accounts:SalesAccount[];promoRows:PromoCalendarRow[];assumptions:Record<string,number>;
  onAssumptionChange:(key:string,value:number)=>void;loading:boolean;
  onUpdated:(a:SalesAccount)=>void;onInserted:(rows:SalesAccount[])=>void;onDeleted:(ids:string[])=>void;
}) {
  const [year,setYear] = useState<number>(2027);
  const [saving,setSaving] = useState<string|null>(null);
  const [adding,setAdding] = useState(false);
  const [showAssumptions,setShowAssumptions] = useState(false);
  const years = Array.from(new Set(accounts.map(a=>a.year))).sort();
  const cols = accounts.filter(a=>a.year===year).sort((a,b)=>a.account_name.localeCompare(b.account_name));
  const ctx: AcctCtx = useMemo(()=>({ year, assumptions, pnl: accountPnLInputs(promoRows, year) }),[year,assumptions,promoRows]);

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
        <button onClick={()=>setShowAssumptions(s=>!s)}
          className="rounded-full border border-violet-400 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 flex items-center gap-1">
          <span className="transition-transform" style={{transform:showAssumptions?"rotate(90deg)":"none"}}>▶</span> ⚙️ Assumptions
        </button>
        <button onClick={addAccount} disabled={adding}
          className="ml-auto rounded-full border border-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
          {adding?"Agregando…":"+ Agregar cuenta"}
        </button>
      </div>

      {showAssumptions && <AssumptionsPanel assumptions={assumptions} onChange={onAssumptionChange}/>}

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
              {ACCT_ROWS.map((row,ri)=>{
                if("kind" in row && row.kind==="separator"){
                  const dngr=(row as any).danger;
                  return (
                    <tr key={`sep-${ri}`} className="border-t-2 border-border">
                      <td colSpan={cols.length+1} className={`px-3 py-1.5 text-[10px] uppercase tracking-wider font-bold sticky left-0 z-10 ${dngr?"":"bg-muted/30"}`} style={dngr?{color:"#DC2626",backgroundColor:"#FEF2F2"}:{color:"#A3224A"}}>{row.label}</td>
                    </tr>
                  );
                }
                if("kind" in row && row.kind==="formula"){
                  const dngr=(row as any).danger;
                  return (
                    <tr key={`f-${ri}`} className={`border-t border-border/60 ${dngr?"":"bg-muted/5"}`} style={dngr?{backgroundColor:"#FEF2F2"}:{}}>
                      <td className={`px-3 py-1.5 font-semibold sticky left-0 z-10 ${dngr?"":"bg-muted/5 text-muted-foreground italic"}`} style={dngr?{color:"#DC2626",backgroundColor:"#FEF2F2"}:{fontSize:11}}>{row.label}</td>
                      {cols.map(a=>(
                        <td key={a.id} className={`px-2 py-1.5 text-right font-mono text-xs ${dngr?"font-bold":"text-muted-foreground"}`} style={dngr?{color:"#DC2626"}:{}}>{row.fn(a,ctx)}</td>
                      ))}
                    </tr>
                  );
                }
                const field=row as AcctField;
                return (
                  <tr key={field.key as string} className={`border-t border-border/60 ${field.key==="distributor"?"bg-muted/10":""}`}>
                    <td className="px-3 py-1.5 font-semibold sticky left-0 bg-card z-10" style={{color:"#1C2340"}}>{field.label}</td>
                    {cols.map(a=>{
                      const v=(a as any)[field.key];
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
                );
              })}
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

  function computeUnits(r:PromoCalendarRow, patch:Partial<PromoCalendarRow>){
    const s=patch.stores??r.stores??0, v=patch.reg_avg_vel??r.reg_avg_vel??0, w=patch.weeks??r.weeks??0;
    const pw=patch.promo_weeks??r.promo_weeks??0, lift=patch.lift_pct??r.lift_pct??0;
    const hasPromo=pw>0;
    const reg=hasPromo?s*v*(w-pw):s*v*w;
    const promo=hasPromo?s*v*(1+lift)*pw:0;
    return {reg_units:Math.round(reg*1000)/1000, promo_units:Math.round(promo*1000)/1000, total_units:Math.round((reg+promo)*1000)/1000};
  }
  async function commit(row:PromoCalendarRow, patch:Partial<PromoCalendarRow>){
    const recompute=("stores" in patch||"reg_avg_vel" in patch||"weeks" in patch||"promo_weeks" in patch||"lift_pct" in patch);
    const units=recompute?computeUnits(row,patch):{};
    const fullPatch={...patch,...units};
    const updated={...row,...fullPatch};
    onUpdated(updated); setSaving(row.id);
    try{ const {supabase:sb}=await import("@/integrations/supabase/client"); await updatePromoCalendarRow(sb,row.id,fullPatch); }catch(e){console.error(e);}
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
                            <th className="px-3 py-1.5 text-right">Weeks</th>
                            <th className="px-3 py-1.5 text-right">Stores</th>
                            <th className="px-3 py-1.5 text-right">Reg Vel.</th>
                            <th className="px-3 py-1.5 text-right font-bold">Total Units</th>
                            <th className="px-3 py-1.5 text-right">Reg Units</th>
                            <th className="px-3 py-1.5 text-right">Promo Units</th>
                            <th className="px-3 py-1.5 text-right">Promo</th>
                            <th className="px-3 py-1.5 text-right">P.Weeks</th>
                            <th className="px-3 py-1.5 text-right">Lift</th>
                            <th className="px-3 py-1.5 text-right">Unit Cost</th>
                            <th className="px-3 py-1.5 text-right">AD $</th>
                            <th className="px-3 py-1.5 text-right">Total Cost</th>
                            <th className="px-3 py-1.5 text-right">EDLP Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skuRows.map(row=>{
                            const hasPromo=!!((row.promo_weeks??0)>0||(row.promo_label));
                            const s=row.stores??0, v=row.reg_avg_vel??0, w=row.weeks??0;
                            const pw=row.promo_weeks??0, lift=row.lift_pct??0;
                            const regU=hasPromo&&pw>0?s*v*(w-pw):s*v*w;
                            const promoU=hasPromo&&pw>0?s*v*(1+lift)*pw:0;
                            return (
                            <tr key={row.id} className={`border-t border-border/40 ${saving===row.id?"bg-amber-50/40":""} ${hasPromo?"bg-amber-50/20":""}`}>
                              <td className="px-3 py-1 font-semibold" style={{color:"#1C2340"}}>{MONTHS_SHORT[row.month-1]}</td>
                              <td className="px-3 py-1 text-right font-mono text-muted-foreground">{row.weeks??""}</td>
                              <td className="px-3 py-1 text-right"><input type="number" step="1" defaultValue={row.stores??""} className={inp} onBlur={e=>commit(row,{stores:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right"><input type="number" step="0.01" defaultValue={row.reg_avg_vel??""} className={inp} onBlur={e=>commit(row,{reg_avg_vel:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right font-mono font-bold" style={{color:"#1C2340"}}>{(regU+promoU).toLocaleString(undefined,{maximumFractionDigits:1})}</td>
                              <td className="px-3 py-1 text-right font-mono text-muted-foreground">{regU>0?regU.toLocaleString(undefined,{maximumFractionDigits:1}):"—"}</td>
                              <td className={`px-3 py-1 text-right font-mono ${promoU>0?"font-semibold text-amber-700":"text-muted-foreground"}`}>{promoU>0?promoU.toLocaleString(undefined,{maximumFractionDigits:1}):"—"}</td>
                              <td className="px-3 py-1 text-right"><input type="text" defaultValue={row.promo_label??""} className="rounded border border-border bg-background px-1.5 py-0.5 text-xs w-16 focus:outline-none" onBlur={e=>commit(row,{promo_label:e.target.value===""?null:e.target.value})}/></td>
                              <td className="px-3 py-1 text-right"><input type="number" step="1" defaultValue={row.promo_weeks??""} className={`${inp} w-12`} onBlur={e=>commit(row,{promo_weeks:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right"><input type="number" step="0.01" defaultValue={row.lift_pct??""} className={`${inp} w-12`} onBlur={e=>commit(row,{lift_pct:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right"><input type="number" step="0.01" defaultValue={row.unit_cost??""} className={`${inp} w-16`} onBlur={e=>commit(row,{unit_cost:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right"><input type="number" step="1" defaultValue={row.ad_dollars??""} className={`${inp} w-16`} onBlur={e=>commit(row,{ad_dollars:e.target.value===""?null:parseFloat(e.target.value)})}/></td>
                              <td className="px-3 py-1 text-right font-mono text-muted-foreground">{(row.total_cost??0)>0?(row.total_cost!).toLocaleString(undefined,{maximumFractionDigits:0}):"—"}</td>
                              <td className="px-3 py-1 text-right font-mono text-muted-foreground">{(row.edlp_cost??0)>0?(row.edlp_cost!).toLocaleString(undefined,{maximumFractionDigits:0}):"—"}</td>
                            </tr>
                            );
                          })}
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

// ─── Sales Breakdown Tab (mes a mes · units/$ · forecast vs real) ─────────────
const UNITS_PER_CASE_LOCAL = 8;
function SalesBreakdownTab({rows,accounts,assumptions,actualBySku,actualByDist,loading}:{
  rows:PromoCalendarRow[];accounts:SalesAccount[];assumptions:Record<string,number>;
  actualBySku:Record<string,Record<string,number>>;actualByDist:Record<string,Record<string,number>>;loading:boolean;
}) {
  const years = Array.from(new Set(rows.map(r=>r.year))).sort();
  const [year,setYear] = useState<number>(years[0]??2027);
  const [metric,setMetric] = useState<"units"|"value">("value");
  const [gran,setGran] = useState<"month"|"quarter">("month");
  const [open,setOpen] = useState<Record<string,boolean>>({retail:true,dc:true,sku:false});

  const byRetail = useMemo(()=>breakdownByRetail(rows,accounts,assumptions),[rows,accounts,assumptions]);
  const byDC = useMemo(()=>breakdownByDistributor(rows,accounts,assumptions),[rows,accounts,assumptions]);
  const bySku = useMemo(()=>breakdownBySku(rows,accounts,assumptions),[rows,accounts,assumptions]);

  // Column set: 12 months or 4 quarters
  const periods = gran==="month"
    ? MONTHS_SHORT.map((m,i)=>({label:m,keys:[`${year}-${String(i+1).padStart(2,"0")}`]}))
    : [1,2,3,4].map(q=>({label:`Q${q}`,keys:[0,1,2].map(o=>`${year}-${String((q-1)*3+o+1).padStart(2,"0")}`)}));

  const fmt=(v:number)=> metric==="value" ? `$${Math.round(v).toLocaleString()}` : Math.round(v).toLocaleString();
  const cellVal=(row:BreakdownRow,keys:string[])=>{
    const s=sumOverMonths(row,keys);
    return metric==="value"?s.revenue:s.units;
  };
  // real (pipeline) lookups — cases. For "value" we approximate cases→$ via delivered cost of that DC.
  const distCost=(d:string)=>deliveredCostOf(assumptions,d);
  const realDistVal=(dist:string,keys:string[])=>{
    const m=actualByDist[dist]??{};
    const cases=keys.reduce((s,k)=>s+(m[k]??0),0);
    return metric==="value"? cases*UNITS_PER_CASE_LOCAL*distCost(dist) : cases*UNITS_PER_CASE_LOCAL;
  };
  const realSkuVal=(sku:string,keys:string[])=>{
    const m=actualBySku[sku]??{};
    const cases=keys.reduce((s,k)=>s+(m[k]??0),0);
    // SKU real in $ has no single DC price; use a blended avg delivered cost
    const avg=(distCost("UNFI")+distCost("KEHE")+distCost("Rainforest"))/3;
    return metric==="value"? cases*UNITS_PER_CASE_LOCAL*avg : cases*UNITS_PER_CASE_LOCAL;
  };

  function Section({id,title,data,compareReal}:{id:string;title:string;data:BreakdownRow[];compareReal:null|((key:string,keys:string[])=>number)}){
    const isOpen=open[id];
    const rowsSorted=[...data].sort((a,b)=>{
      const ta=sumOverMonths(a,periods.flatMap(p=>p.keys)); const tb=sumOverMonths(b,periods.flatMap(p=>p.keys));
      return (metric==="value"?tb.revenue-ta.revenue:tb.units-ta.units);
    });
    const grandByPeriod=periods.map(p=>rowsSorted.reduce((s,r)=>s+cellVal(r,p.keys),0));
    const grandTotal=grandByPeriod.reduce((a,b)=>a+b,0);

    return (
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <button onClick={()=>setOpen(o=>({...o,[id]:!o[id]}))} className="w-full px-5 py-3 flex items-center gap-3 bg-muted/30 hover:bg-muted/50 text-left">
          <span className="text-xs text-muted-foreground transition-transform" style={{transform:isOpen?"rotate(90deg)":"none"}}>▶</span>
          <span className="font-bold text-sm" style={{color:"#1C2340"}}>{title}</span>
          {compareReal && <span className="text-[10px] rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 font-semibold">forecast vs real</span>}
          <span className="ml-auto font-mono font-semibold text-sm" style={{color:"#A3224A"}}>{fmt(grandTotal)}</span>
        </button>
        {isOpen && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-max">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/20">
                  <th className="px-3 py-2 text-left sticky left-0 bg-muted/20 z-10">{title.split(" ").pop()}</th>
                  {periods.map(p=><th key={p.label} className="px-3 py-2 text-right">{p.label}</th>)}
                  <th className="px-3 py-2 text-right font-bold border-l border-border">Total</th>
                </tr>
              </thead>
              <tbody>
                {rowsSorted.map(r=>{
                  const vals=periods.map(p=>cellVal(r,p.keys));
                  const tot=vals.reduce((a,b)=>a+b,0);
                  if(tot===0) return null;
                  const realVals=compareReal?periods.map(p=>compareReal(r.key,p.keys)):null;
                  const realTot=realVals?realVals.reduce((a,b)=>a+b,0):0;
                  return (
                    <Fragment key={r.key}>
                      <tr className="border-t border-border/60 hover:bg-muted/10">
                        <td className="px-3 py-1.5 font-semibold sticky left-0 bg-card z-10" style={{color:"#1C2340"}}>{r.key}<span className="text-[9px] text-muted-foreground ml-1">fcst</span></td>
                        {vals.map((v,i)=><td key={i} className="px-3 py-1.5 text-right font-mono">{v?fmt(v):"—"}</td>)}
                        <td className="px-3 py-1.5 text-right font-mono font-bold border-l border-border" style={{color:"#A3224A"}}>{fmt(tot)}</td>
                      </tr>
                      {realVals && (
                        <>
                          <tr className="bg-emerald-50/30">
                            <td className="px-3 py-1 sticky left-0 bg-emerald-50/30 z-10 text-[11px] text-emerald-700 pl-6">real</td>
                            {realVals.map((v,i)=><td key={i} className="px-3 py-1 text-right font-mono text-emerald-700">{v?fmt(v):"—"}</td>)}
                            <td className="px-3 py-1 text-right font-mono font-semibold text-emerald-700 border-l border-border">{fmt(realTot)}</td>
                          </tr>
                          <tr className="border-b border-border/60">
                            <td className="px-3 py-1 sticky left-0 bg-card z-10 text-[11px] text-muted-foreground pl-6">Δ</td>
                            {periods.map((p,i)=>{const d=realVals[i]-vals[i];return <td key={i} className={`px-3 py-1 text-right font-mono text-[11px] ${d>=0?"text-emerald-600":"text-red-500"}`}>{realVals[i]===0?"—":(d>=0?"+":"")+fmt(d)}</td>;})}
                            <td className={`px-3 py-1 text-right font-mono text-[11px] font-semibold border-l border-border ${realTot-tot>=0?"text-emerald-600":"text-red-500"}`}>{realTot===0?"—":(realTot-tot>=0?"+":"")+fmt(realTot-tot)}</td>
                          </tr>
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-3 py-2 font-semibold sticky left-0 z-10" style={{backgroundColor:"#1C2340"}}>TOTAL</td>
                  {grandByPeriod.map((v,i)=><td key={i} className="px-3 py-2 text-right font-mono font-bold text-emerald-400">{fmt(v)}</td>)}
                  <td className="px-3 py-2 text-right font-mono font-bold border-l border-slate-600">{fmt(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        📊 Facturación mes a mes por <strong>Retail</strong>, <strong>Distribuidor</strong> y <strong>SKU</strong>. En DC y SKU se compara <strong>forecast vs real</strong> (el real sale del pipeline de Fulfillment invoiced, a medida que se cargan órdenes). Retail queda solo forecast. Toggle Units/$ y vista Mensual/Quarter.
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex gap-1">
          {years.map(y=>(
            <button key={y} onClick={()=>setYear(y)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${year===y?"text-white":"border border-border text-muted-foreground"}`}
              style={year===y?{backgroundColor:"#1C2340"}:{}}>{y}</button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {([["value","$ Value"],["units","Units"]] as const).map(([id,lbl])=>(
            <button key={id} onClick={()=>setMetric(id)}
              className={`rounded px-3 py-1 text-xs font-semibold ${metric===id?"text-white":"text-muted-foreground"}`}
              style={metric===id?{backgroundColor:"#A3224A"}:{}}>{lbl}</button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {([["month","Mensual"],["quarter","Quarter"]] as const).map(([id,lbl])=>(
            <button key={id} onClick={()=>setGran(id)}
              className={`rounded px-3 py-1 text-xs font-semibold ${gran===id?"text-white":"text-muted-foreground"}`}
              style={gran===id?{backgroundColor:"#1C2340"}:{}}>{lbl}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-xs text-muted-foreground">Cargando…</div>
      ) : (
        <div className="space-y-3">
          <Section id="retail" title="Por Retail" data={byRetail} compareReal={null}/>
          <Section id="dc" title="Por Distribuidor" data={byDC} compareReal={realDistVal}/>
          <Section id="sku" title="Por SKU" data={bySku} compareReal={realSkuVal}/>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
// ─── Assumptions Panel (central, persisted in Supabase) ───────────────────────
function AssumptionsPanel({assumptions,onChange}:{assumptions:Record<string,number>;onChange:(key:string,value:number)=>void}){
  const inp="rounded border border-border bg-background px-1.5 py-0.5 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-violet-400 w-20";
  const DIST=["UNFI","KEHE","Rainforest"] as const;
  const num=(k:string,def=0)=>assumptions[k]??def;

  return (
    <div className="rounded-2xl border-2 border-violet-300 bg-violet-50/40 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-violet-200 bg-violet-50">
        <p className="text-sm font-bold" style={{color:"#6D28D9"}}>⚙️ Assumptions — parámetros centrales del modelo</p>
        <p className="text-xs text-violet-700">Todo editable. Al cambiar un valor acá, se recalculan las fórmulas de todas las cuentas y del Sales Breakdown. Se guarda automáticamente.</p>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Delivered Cost + Distributor % */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2 border-b border-border bg-muted/30"><p className="text-xs font-bold" style={{color:"#1C2340"}}>Por distribuidor</p></div>
          <table className="w-full text-xs">
            <thead><tr className="text-[9px] uppercase text-muted-foreground border-b border-border">
              <th className="px-3 py-1.5 text-left">Concepto</th>{DIST.map(d=><th key={d} className="px-2 py-1.5 text-right">{d}</th>)}
            </tr></thead>
            <tbody>
              {[
                {label:"Delivered Cost ($)",prefix:"delivered_cost",pct:false},
                {label:"Dist. Fees (%)",prefix:"dist_fees",pct:true},
                {label:"Dist. Allowance (%)",prefix:"dist_allowance",pct:true},
                {label:"Payment Terms (%)",prefix:"payment_terms",pct:true},
              ].map(r=>(
                <tr key={r.prefix} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-semibold">{r.label}</td>
                  {DIST.map(d=>{
                    const key=`${r.prefix}.${d}`;
                    const val=r.pct?(num(key)*100).toFixed(1):num(key);
                    return (
                      <td key={d} className="px-2 py-1">
                        <input type="number" step="0.01" defaultValue={val} className={inp}
                          onBlur={e=>{const raw=parseFloat(e.target.value)||0; onChange(key, r.pct?raw/100:raw);}}/>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Fulfillment + COGS by SKU */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-muted/30"><p className="text-xs font-bold" style={{color:"#1C2340"}}>Fulfillment estimado</p></div>
            <div className="px-4 py-3 flex items-center gap-2">
              <span className="text-xs font-semibold flex-1">Fulfillment by unit ($)</span>
              <input type="number" step="0.01" defaultValue={num("fulfillment_per_unit",0.5)} className={inp}
                onBlur={e=>onChange("fulfillment_per_unit",parseFloat(e.target.value)||0)}/>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-muted/30"><p className="text-xs font-bold" style={{color:"#1C2340"}}>COGS por SKU ($/unidad)</p></div>
            <div className="p-3 grid grid-cols-2 md:grid-cols-5 gap-2">
              {EXTENDED_SKUS.map(sku=>(
                <div key={sku} className="flex items-center gap-1">
                  <span className="text-[11px] font-semibold w-12">{sku}</span>
                  <input type="number" step="0.01" defaultValue={num(`cogs.${sku}`)} className="rounded border border-border bg-background px-1 py-0.5 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-violet-400 w-16"
                    onBlur={e=>onChange(`cogs.${sku}`,parseFloat(e.target.value)||0)}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function SalesPage() {
  const [tab,setTab] = useState<SalesTab>("real");
  const [scenario,setScenario] = useState<"Pessimistic"|"Normal"|"Optimistic">("Normal");
  const [reals,setReals] = useState<Record<string,number>>({});
  const {byLabel, casesByLabel, loading:loadingActuals} = useInvoicedActuals();
  const {bySkuMonth:actualBySku, byDistMonth:actualByDist} = useInvoicedBreakdown();
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
  const [assumptions,setAssumptions] = useState<Record<string,number>>({});
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      try {
        const { supabase: sb } = await import("@/integrations/supabase/client");
        const [accs,rows,ass] = await Promise.all([fetchSalesAccounts(sb), fetchPromoCalendar(sb), fetchAssumptions(sb)]);
        if(!cancelled){ setDbAccounts(accs); setDbPromo(rows); setAssumptions(ass); }
      } catch(e) { console.error("Sales DB load error:", e); }
      if(!cancelled) setDbLoading(false);
    })();
    return ()=>{ cancelled=true; };
  },[]);
  async function changeAssumption(key:string,value:number){
    setAssumptions(prev=>({...prev,[key]:value}));  // optimistic
    try{ const {supabase:sb}=await import("@/integrations/supabase/client"); await updateAssumption(sb,key,value); }
    catch(e){ console.error("assumption save error:",e); }
  }
  // Distributor timing: forecast views show retailer sales shifted back one month
  // (2027+). Promo Calendar / Accounts editing tabs keep raw retailer data.
  const displayPromo = useMemo(()=>shiftPromoOneMonthEarlier(dbPromo),[dbPromo]);
  const dbAgg = useMemo(()=>aggregatePromoCalendar(displayPromo,dbAccounts,assumptions),[displayPromo,dbAccounts,assumptions]);
  const dbSkuByMonth = useMemo(()=>dbSkuByMonthFromAgg(dbAgg),[dbAgg]);
  const byAccountMonth = useMemo(()=>aggregateByAccountMonth(displayPromo,dbAccounts,assumptions),[displayPromo,dbAccounts,assumptions]);
  const annualByAccount = useMemo(()=>aggregateAnnualByAccount(displayPromo,dbAccounts,assumptions),[displayPromo,dbAccounts,assumptions]);
  const annualUnitsByAccount = useMemo(()=>aggregateAnnualUnitsByAccount(displayPromo),[displayPromo]);
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
    {id:"estacionalidad",label:"Seasonality"},
  ];
  const TABS_REFERENCE: {id:SalesTab;label:string}[] = [
    {id:"accounts",label:"Accounts"},
    {id:"promocal",label:"Promo Calendar"},
    {id:"breakdown",label:"Sales Breakdown"},
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
      {tab==="estacionalidad"&& <SeasonalityTab seasonIdx={seasonIdx} onSeasonIdxChange={setSeasonIdx}
                                  velChains={velChains} onVelChainsChange={setVelChains}
                                  promoMultipliers={promoMultipliers} onPromoMultipliersChange={setPromoMultipliers}/>}
      {tab==="accounts"      && <AccountsTab accounts={dbAccounts} promoRows={dbPromo} assumptions={assumptions} onAssumptionChange={changeAssumption} loading={dbLoading} onUpdated={refreshAccount} onInserted={addAccounts} onDeleted={removeAccounts}/>}
      {tab==="promocal"      && <PromoCalendarTab rows={dbPromo} accounts={dbAccounts} byAccountMonth={byAccountMonth} loading={dbLoading} onUpdated={refreshPromoRow} onInserted={addPromoRows} onDeleted={removePromoRows}/>}
      {tab==="breakdown"     && <SalesBreakdownTab rows={displayPromo} accounts={dbAccounts} assumptions={assumptions} actualBySku={actualBySku} actualByDist={actualByDist} loading={dbLoading}/>}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales · BARIS" }] }),
});
