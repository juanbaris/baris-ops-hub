import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInvoicedActuals } from "@/hooks/use-invoiced-actuals";
import { supabase } from "@/integrations/supabase/client";
import { useSalesForecast } from "@/hooks/use-sales-forecast";

// ─── Data (values in $K) ──────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
const PERIODS = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12'];

const D = {
  gross_sales:  [138.56,203.76,196.70,112.42,278.11,163.93,183.46,168.81,147.77,195.14,183.16,145.82],
  net_sales:    [108.07,168.45,138.69, 73.22,232.70,115.91,127.43,133.36,101.91,160.82,141.57,113.01],
  cogs:         [ 91.30,125.11,119.84, 63.59,151.73, 89.37, 99.86, 91.49, 80.16,106.07, 99.39, 79.16],
  storage:      [  1.73,  1.22,  1.18,  1.25,  2.14,  2.69,  4.92,  4.42,  3.91,  3.29,  2.69,  2.21],
  freight_out:  [ 11.82, 15.44, 13.72, 12.17, 15.29, 13.53, 14.97, 13.34, 12.11, 15.95, 14.90, 11.80],
  gross_margin: [ 33.71, 61.99, 61.95, 35.41,108.95, 58.35, 63.71, 59.56, 51.59, 69.83, 66.18, 52.65],
  gm_pct:       [0.243, 0.304, 0.315, 0.315, 0.392, 0.356, 0.347, 0.353, 0.349, 0.358, 0.361, 0.361],
  ebitda:       [-43.96,-155.91,-78.37,-60.14,-6.78,-46.66,-45.99,-18.87,-42.11,-15.07,-18.39,-22.76],
  cash_eop:     [381.22,369.23,588.97,636.60,413.18,463.45,184.48,201.84,269.85,205.14,290.68,380.44],
  ar:           [150.07,195.47,180.81,107.89,251.00,174.08,156.40,165.21,135.25,186.30,181.77,148.40],
  inventory:    [458.75,369.44,435.99,401.13,474.67,454.65,705.31,660.27,580.11,578.71,479.32,400.16],
  total_assets: [990.04,934.13,1205.76,1145.62,1138.84,1092.18,1046.19,1027.32,985.21,970.15,951.76,929.00],
  total_equity: [955.04,899.13,1170.76,1110.62,1103.84,1057.18,1011.19,992.32,950.21,935.15,916.76,894.00],
  total_liab:   [35,35,35,35,35,35,35,35,35,35,35,35],
  cash_from_ops:[-228.78,-111.99,-130.26,47.63,-223.42,50.27,-278.97,17.37,68.01,-64.71,85.53,89.77],
  capital_contrib:[460,100,350,0,0,0,0,0,0,0,0,0],
  cash_bop:     [150,381.22,369.23,588.97,636.60,413.18,463.45,184.48,201.84,269.85,205.14,290.68],
  chg_cash:     [231.22,-11.99,219.74,47.63,-223.42,50.27,-278.97,17.37,68.01,-64.71,85.53,89.77],
  chg_wc:       [-184.82,43.92,-51.89,107.77,-216.64,96.94,-232.98,36.23,110.12,-49.64,103.92,112.53],
  chg_ar:       [-92.07,-45.40,14.66,72.92,-143.11,76.92,17.68,-8.81,29.96,-51.04,4.53,33.37],
  chg_inventory:[-38.75,89.31,-66.55,34.85,-73.53,20.02,-250.66,45.04,80.16,1.40,99.39,79.16],
  chg_ap:       [-54,0,0,0,0,0,0,0,0,0,0,0],
  business_contribution:[3.22,26.68,3.95,-3.79,63.54,10.32,7.68,24.11,5.73,35.51,24.58,19.84],
  trade_spend:  [-19.87,-17.07,-37.13,-28.41,-20.35,-33.96,-40.02,-20.15,-32.91,-17.36,-25.52,-20.00],
  distr_fees:   [-6.47,-8.20,-6.28,-4.16,-11.10,-6.90,-7.59,-6.69,-6.09,-8.10,-7.53,-5.99],
  selling_exp:  [-17.66,-141.66,-23.0,-14.66,-30.45,-15.79,-14.28,-14.28,-14.65,-14.28,-14.28,-13.91],
  mkt_trade:    [-5.0,-13.6,-24.5,-5.0,-9.5,-13.0,-9.5,-5.0,-5.0,-9.0,-5.0,-5.0],
  team:         [-18.84,-18.84,-18.84,-18.84,-18.84,-18.84,-18.84,-18.84,-18.84,-18.84,-18.84,-18.84],
  gen_exp:      [-5.68,-8.48,-15.98,-17.85,-10.85,-9.35,-11.05,-4.85,-9.35,-8.45,-4.85,-4.85],
  ap:           [0,0,0,0,0,0,0,0,0,0,0,0],
  commercial_debt:[35,35,35,35,35,35,35,35,35,35,35,35],
};

// Budget (from Best Estimate 2026, $K)
const BUDGET = {
  gross_sales: [138.56,203.76,196.70,112.42,278.11,163.93,183.46,168.81,147.77,195.14,183.16,145.82],
  net_sales:   [110.87,148.39,147.42,81.28,219.08,109.85,147.30,120.59,117.47,152.65,147.09,117.01],
  ebitda:      [-44,-156,-78,-60,-7,-47,-46,-19,-42,-15,-18,-23],
};

const sum = (arr: number[], from=0, to=12) => arr.slice(from,to).reduce((a,b)=>a+(b||0),0);
const fmt = (n: number, dec=0) => {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', {maximumFractionDigits: dec});
};
const fmtK = (n: number) => n === null ? '—' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(0) + 'K';
const fmtPct = (n: number) => (n*100).toFixed(1) + '%';

type Period = 'mtd'|'qtd'|'ytd'|'fy';
type FinTab = 'dashboard'|'pnl'|'cashflow'|'balance'|'runway'|'ebitda';

function periodSlice(arr: number[], period: Period, refMonth: number) {
  if (period === 'fy') return sum(arr,0,12);
  if (period === 'mtd') return arr[refMonth]||0;
  if (period === 'qtd') { const q=Math.floor(refMonth/3); return sum(arr,q*3,Math.min(q*3+3,refMonth+1)); }
  if (period === 'ytd') return sum(arr,0,refMonth+1);
  return sum(arr);
}

// ─── Top-line revenue comes from Sales (actuals + committed/active forecast) ──
function useFinanceRevenue() {
  const { byLabel, loading } = useInvoicedActuals();
  const { effectiveForecast, isCommitted, scenario } = useSalesForecast();
  return useMemo(() => {
    const fcByKey: Record<string, number> = {};
    for (const f of effectiveForecast) fcByKey[`${f.year}-${f.month}`] = f.revenue;
    const isReal: boolean[] = [];
    const netSales = MONTHS.map((m, i) => {
      const real = byLabel[`${m} 2026`]?.revenue ?? 0;
      if (real > 0) { isReal.push(true); return real / 1000; }
      isReal.push(false);
      const fc = fcByKey[`2026-${i + 1}`];
      return fc != null ? fc / 1000 : D.net_sales[i];
    });
    return {
      netSales, isReal, loading,
      source: isCommitted ? "Committed" : `${scenario} scenario`,
    };
  }, [byLabel, effectiveForecast, isCommitted, scenario, loading]);
}

// ─── Chart wrapper using Chart.js via CDN ─────────────────────────────────────
declare global { interface Window { Chart: any } }

function useChart(canvasRef: React.RefObject<HTMLCanvasElement | null>, builder: () => any, deps: any[]) {
  const chartRef = useRef<any>(null);
  useEffect(() => {
    if (!canvasRef.current || !window.Chart) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new window.Chart(canvasRef.current, builder());
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, deps);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KPI({ icon, label, value, sub, subColor, onClick }: {
  icon: string; label: string; value: string; sub?: string; subColor?: string; onClick?: () => void;
}) {
  return (
    <div onClick={onClick} className={`rounded-2xl border border-border bg-card p-4 shadow-sm ${onClick ? "cursor-pointer hover:shadow-md" : ""}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-sm">{icon}</span>
        <span className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>{value}</div>
      {sub && <div className={`text-[10px] mt-0.5 ${subColor ?? "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────────
function DashboardTab({ period, refMonth, m, realMonths }: { period: Period; refMonth: number; m: typeof D; realMonths: number }) {
  const revenue = useFinanceRevenue();
  const rev = periodSlice(m.gross_sales, period, refMonth);
  const budgetRev = periodSlice(BUDGET.gross_sales, period, refMonth);
  const netRev = periodSlice(revenue.netSales, period, refMonth);
  const gp = periodSlice(m.gross_margin, period, refMonth);
  const gmPct = netRev ? gp/netRev : 0;
  const bc = periodSlice(m.business_contribution, period, refMonth);
  const ebitda = periodSlice(m.ebitda, period, refMonth);
  const cash = m.cash_eop[refMonth];
  const avgBurn = (m.ebitda[Math.max(0,refMonth-2)] + m.ebitda[Math.max(0,refMonth-1)] + m.ebitda[refMonth]) / 3;
  const runway = avgBurn < 0 ? cash / Math.abs(avgBurn) : 99;
  const wc = m.ar[refMonth] + m.inventory[refMonth] - m.ap[refMonth];
  const vsB = rev - budgetRev;
  const vsBpct = budgetRev ? vsB/budgetRev : 0;

  // Charts
  const revCanvas = useRef<HTMLCanvasElement>(null);
  const gmCanvas = useRef<HTMLCanvasElement>(null);
  const cashCanvas = useRef<HTMLCanvasElement>(null);
  const waterfallCanvas = useRef<HTMLCanvasElement>(null);

  useChart(revCanvas, () => ({
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Budget', data: m.gross_sales, backgroundColor: 'rgba(180,180,180,0.4)', borderRadius: 3, order: 3 },
        { label: 'Real', data: m.gross_sales.map((v,i) => i < realMonths ? v : null), type: 'line', borderColor: '#10B981', backgroundColor: 'transparent', tension: 0.3, pointRadius: 4, order: 1 },
        { label: 'Forecast', data: m.gross_sales.map((v,i) => i >= realMonths-1 ? v : null), type: 'line', borderColor: '#A3224A', backgroundColor: 'transparent', tension: 0.3, pointRadius: 4, borderDash: [4,3], order: 2 },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } }, scales:{ y:{ ticks:{ callback:(v:number) => '$'+v+'K' } } } }
  }), []);

  useChart(gmCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [{
        label: 'GM %',
        data: m.gm_pct.map(v => +(v*100).toFixed(1)),
        borderColor: '#A3224A',
        backgroundColor: 'rgba(163,34,74,0.08)',
        tension: 0.4, fill: true, pointRadius: 4,
      }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ callback:(v:number) => v+'%' }, min:20, max:45 } } }
  }), []);

  useChart(cashCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [{
        label: 'Cash EOP',
        data: m.cash_eop,
        borderColor: '#1C2340',
        backgroundColor: 'rgba(28,35,64,0.1)',
        tension: 0.3, fill: true, pointRadius: 4,
      }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ callback:(v:number) => '$'+v+'K' } } } }
  }), []);

  // Waterfall FY totals
  const wfLabels = ['Gross Sales','Ded.','Net Sales','COGS','Fulfillment','GM','SG&A','EBITDA'];
  const gs = sum(m.gross_sales); const ded = sum(m.trade_spend)+sum(m.distr_fees); const ns = sum(revenue.netSales);
  const cogs = -sum(m.cogs); const ful = -(sum(m.storage)+sum(m.freight_out)); const gm = sum(m.gross_margin);
  const sga = sum(m.selling_exp)+sum(m.mkt_trade)+sum(m.team)+sum(m.gen_exp); const eb = sum(m.ebitda);
  const wfData = [gs, ded, ns, cogs, ful, gm, sga, eb];
  const wfColors = wfData.map(v => v >= 0 ? '#1C2340' : '#A3224A');

  useChart(waterfallCanvas, () => ({
    type: 'bar',
    data: { labels: wfLabels, datasets: [{ data: wfData, backgroundColor: wfColors, borderRadius: 4 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ callback:(v:number) => '$'+v+'K' } } } }
  }), [ns]);

  return (
    <div className="space-y-5">
      {runway < 6 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          ⚠️ Critical runway: {runway.toFixed(1)} months of cash at current burn rate. Consider accelerating collections or cutting expenses.
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-8 gap-3">
        <KPI icon="💰" label="Revenue" value={fmtK(rev)}
          sub={`Budget vs Forecast ${vsBpct>=0?'+':''}${(vsBpct*100).toFixed(1)}%`}
          subColor={vsBpct>=0?"text-emerald-600":"text-red-500"} />
        <KPI icon="🧾" label="Net Sales" value={revenue.loading ? "—" : fmtK(netRev)}
          sub={`Source: Sales · ${revenue.source}`} />
        <KPI icon="📊" label="Gross Margin %" value={fmtPct(gmPct)}
          sub={`${fmt(gp,0)} abs`} />
        <KPI icon="🎯" label="Business Contribution" value={fmtK(bc)}
          sub={`${netRev ? (bc/netRev*100).toFixed(1) : 0}% of Gross`} />
        <KPI icon="📉" label="EBITDA" value={fmt(ebitda,0)}
          sub="period burn" subColor={ebitda < 0 ? "text-red-500" : "text-emerald-600"} />
        <KPI icon="🏦" label="Cash on Hand" value={fmtK(cash)}
          sub="end of period"
          subColor={cash < 200 ? "text-red-600 font-bold" : cash < 400 ? "text-orange-500" : "text-emerald-600"} />
        <KPI icon="⏱️" label="Runway" value={runway > 36 ? "36+ mo" : runway.toFixed(1)+" mo"}
          sub="burn rate 3M avg"
          subColor={runway < 6 ? "text-red-600 font-bold" : runway < 12 ? "text-orange-500" : "text-emerald-600"} />
        <KPI icon="⚖️" label="Working Capital" value={fmtK(wc)}
          sub="AR + Inv − AP" />
      </div>

      {/* Charts 2×2 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Monthly revenue · Budget vs Real vs Forecast</h3>
            <span className="text-[10px] text-muted-foreground">values in $K</span>
          </div>
          <div style={{height:220}}><canvas ref={revCanvas} /></div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Gross Margin %</h3>
            <span className="text-[10px] text-muted-foreground">FY trend</span>
          </div>
          <div style={{height:220}}><canvas ref={gmCanvas} /></div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Cash trend</h3>
            <span className="text-[10px] text-muted-foreground">cash on hand evolution · $K</span>
          </div>
          <div style={{height:220}}><canvas ref={cashCanvas} /></div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Waterfall: Gross Sales → EBITDA</h3>
            <span className="text-[10px] text-muted-foreground">FY 2026 total</span>
          </div>
          <div style={{height:220}}><canvas ref={waterfallCanvas} /></div>
        </div>
      </div>
    </div>
  );
}

// ─── P&L helpers (expandable tree) ──────────────────────────────────────────
// Each PLRow is either: section (dark header), group (expandable), item (leaf), total, pct
type PLRowKind = "section"|"group"|"item"|"total"|"pct";
interface PLRow {
  id: string; parentId?: string; label: string; kind: PLRowKind;
  actualKey?: string;           // key in pnl_detail JSONB
  forecastFn?: (m: typeof D, i: number) => number;  // for forecast months
  indent: 0|1|2|3;
  bold?: boolean; italic?: boolean; isNeg?: boolean;
}

// Full P&L tree matching Accountfully exactly
const PL_ROWS: PLRow[] = [
  {id:"s-income",label:"INCOME",kind:"section",indent:0},
  {id:"g-4000",label:"4000 · Sales",kind:"group",indent:0},
    {id:"sales_product",parentId:"g-4000",label:"Sales of Product Income",kind:"item",indent:1,actualKey:"sales_product",forecastFn:(m,i)=>m.gross_sales[i]},
    {id:"shipping_income",parentId:"g-4000",label:"Shipping Income",kind:"item",indent:1,actualKey:"shipping_income",forecastFn:()=>0},
    {id:"t-4000",parentId:"g-4000",label:"Total 4000 Sales",kind:"total",indent:1,forecastFn:(m,i)=>m.gross_sales[i]},
  {id:"g-4500",label:"4500 · Deductions to Income",kind:"group",indent:0},
    {id:"g-disc",parentId:"g-4500",label:"Discounts",kind:"group",indent:1},
      {id:"consumer_returns",parentId:"g-disc",label:"Consumer Returns",kind:"item",indent:2,actualKey:"consumer_returns",forecastFn:()=>0},
      {id:"distributor_fees",parentId:"g-disc",label:"Distributor Fees",kind:"item",indent:2,actualKey:"distributor_fees",forecastFn:(m,i)=>m.distr_fees[i]*0.28},
      {id:"dsd_programs",parentId:"g-disc",label:"DSD Programs",kind:"item",indent:2,actualKey:"dsd_programs",forecastFn:(m,i)=>m.trade_spend[i]*0.35},
      {id:"kehe_allowance",parentId:"g-disc",label:"KeHE Allowance",kind:"item",indent:2,actualKey:"kehe_allowance",forecastFn:(m,i)=>m.distr_fees[i]*0.42},
      {id:"payment_terms",parentId:"g-disc",label:"Payment Terms",kind:"item",indent:2,actualKey:"payment_terms",forecastFn:(m,i)=>m.distr_fees[i]*0.30},
      {id:"promos",parentId:"g-disc",label:"Promos",kind:"item",indent:2,actualKey:"promos",forecastFn:(m,i)=>m.trade_spend[i]*0.65},
      {id:"unfi_allowance",parentId:"g-disc",label:"UNFI Allowance",kind:"item",indent:2,actualKey:"unfi_allowance",forecastFn:()=>0},
      {id:"t-disc",parentId:"g-disc",label:"Total Discounts",kind:"total",indent:2},
    {id:"returns_refunds",parentId:"g-4500",label:"Returns / Refunds",kind:"item",indent:1,actualKey:"returns_refunds",forecastFn:()=>0},
    {id:"t-4500",parentId:"g-4500",label:"Total Deductions to Income",kind:"total",indent:1,forecastFn:(m,i)=>m.trade_spend[i]+m.distr_fees[i]},
  {id:"t-income",label:"Total Income",kind:"total",indent:0,bold:true,forecastFn:(m,i)=>m.net_sales[i]},

  {id:"s-cogs",label:"COST OF GOODS SOLD",kind:"section",indent:0},
  {id:"g-5000",label:"5000 · Cost of goods sold",kind:"group",indent:0},
    {id:"product_costs",parentId:"g-5000",label:"Product Costs",kind:"item",indent:1,actualKey:"product_costs",forecastFn:(m,i)=>-m.cogs[i]},
    {id:"t-5000",parentId:"g-5000",label:"Total 5000",kind:"total",indent:1,forecastFn:(m,i)=>-m.cogs[i]},
  {id:"g-6000",label:"6000 · Logistics & Fulfillment",kind:"group",indent:0},
    {id:"freight_in",parentId:"g-6000",label:"Freight In",kind:"item",indent:1,actualKey:"freight_in",forecastFn:()=>0},
    {id:"freight_out_actual",parentId:"g-6000",label:"Freight Out",kind:"item",indent:1,actualKey:"freight_out_actual",forecastFn:(m,i)=>-m.freight_out[i]},
    {id:"merchant_fees",parentId:"g-6000",label:"Merchant Account Fees",kind:"item",indent:1,actualKey:"merchant_fees",forecastFn:()=>0},
    {id:"warehouse_fulfillment",parentId:"g-6000",label:"Warehouse / Fulfillment",kind:"item",indent:1,actualKey:"warehouse_fulfillment",forecastFn:(m,i)=>-m.storage[i]},
    {id:"t-6000",parentId:"g-6000",label:"Total 6000 Logistics",kind:"total",indent:1,forecastFn:(m,i)=>-(m.storage[i]+m.freight_out[i])},
  {id:"t-cogs",label:"Total Cost of Goods Sold",kind:"total",indent:0,bold:true},

  {id:"t-gp",label:"GROSS PROFIT",kind:"total",indent:0,bold:true,forecastFn:(m,i)=>m.gross_margin[i]},
  {id:"t-gp-pct",label:"Gross Margin %",kind:"pct",indent:0,forecastFn:(m,i)=>m.gm_pct[i]},

  {id:"s-exp",label:"EXPENSES",kind:"section",indent:0},
  {id:"g-6500",label:"6500 · Selling Expenses",kind:"group",indent:0},
    {id:"broker_commissions",parentId:"g-6500",label:"Broker Commissions & Fees",kind:"item",indent:1,actualKey:"broker_commissions",forecastFn:(m,i)=>m.selling_exp[i]*0.6},
    {id:"slotting_fees",parentId:"g-6500",label:"Slotting Fees",kind:"item",indent:1,actualKey:"slotting_fees",forecastFn:(m,i)=>m.selling_exp[i]*0.4},
    {id:"t-6500",parentId:"g-6500",label:"Total 6500 Selling Expenses",kind:"total",indent:1,forecastFn:(m,i)=>m.selling_exp[i]},
  {id:"g-7000",label:"7000 · Marketing & Trade",kind:"group",indent:0},
    {id:"demos_merchandising",parentId:"g-7000",label:"Demos & Merchandising",kind:"item",indent:1,actualKey:"demos_merchandising",forecastFn:(m,i)=>m.mkt_trade[i]*0.35},
    {id:"digital_social",parentId:"g-7000",label:"Digital & Social Media",kind:"item",indent:1,actualKey:"digital_social",forecastFn:(m,i)=>m.mkt_trade[i]*0.35},
    {id:"events_tradeshows",parentId:"g-7000",label:"Events / Trade Shows",kind:"item",indent:1,actualKey:"events_tradeshows",forecastFn:(m,i)=>m.mkt_trade[i]*0.15},
    {id:"printing_promotional",parentId:"g-7000",label:"Printing & Promotional",kind:"item",indent:1,actualKey:"printing_promotional",forecastFn:()=>0},
    {id:"product_samples",parentId:"g-7000",label:"Product Samples",kind:"item",indent:1,actualKey:"product_samples",forecastFn:(m,i)=>m.mkt_trade[i]*0.15},
    {id:"t-7000",parentId:"g-7000",label:"Total 7000 Marketing",kind:"total",indent:1,forecastFn:(m,i)=>m.mkt_trade[i]},
  {id:"g-8000",label:"8000 · General & Administrative",kind:"group",indent:0},
    {id:"bank_charges",parentId:"g-8000",label:"Bank Charges & Fees",kind:"item",indent:1,actualKey:"bank_charges",forecastFn:()=>0},
    {id:"dues_subscriptions",parentId:"g-8000",label:"Dues & Subscriptions",kind:"item",indent:1,actualKey:"dues_subscriptions",forecastFn:(m,i)=>m.gen_exp[i]*0.1},
    {id:"g-facility",parentId:"g-8000",label:"Facility Costs",kind:"group",indent:1},
      {id:"rent",parentId:"g-facility",label:"Rent",kind:"item",indent:2,actualKey:"rent",forecastFn:()=>-0.558},
      {id:"utilities",parentId:"g-facility",label:"Utilities",kind:"item",indent:2,actualKey:"utilities",forecastFn:()=>-0.32},
      {id:"t-facility",parentId:"g-facility",label:"Total Facility Costs",kind:"total",indent:2},
    {id:"insurance",parentId:"g-8000",label:"Insurance",kind:"item",indent:1,actualKey:"insurance",forecastFn:()=>-0.97},
    {id:"meals_entertainment",parentId:"g-8000",label:"Meals & Entertainment",kind:"item",indent:1,actualKey:"meals_entertainment",forecastFn:()=>0},
    {id:"office_supplies",parentId:"g-8000",label:"Office Supplies",kind:"item",indent:1,actualKey:"office_supplies",forecastFn:()=>0},
    {id:"g-payroll",parentId:"g-8000",label:"Payroll & Employee Related",kind:"group",indent:1},
      {id:"contractors",parentId:"g-payroll",label:"Contractors",kind:"item",indent:2,actualKey:"contractors",forecastFn:()=>-2.56},
      {id:"payroll_processing",parentId:"g-payroll",label:"Payroll Processing Fees",kind:"item",indent:2,actualKey:"payroll_processing",forecastFn:()=>-0.061},
      {id:"payroll_taxes",parentId:"g-payroll",label:"Payroll Taxes",kind:"item",indent:2,actualKey:"payroll_taxes",forecastFn:()=>-1.15285},
      {id:"salaries_operations",parentId:"g-payroll",label:"Salaries & Wages - Operations",kind:"item",indent:2,actualKey:"salaries_operations",forecastFn:()=>-15.07},
      {id:"t-payroll",parentId:"g-payroll",label:"Total Payroll & Employee Related",kind:"total",indent:2,forecastFn:(m,i)=>m.team[i]},
    {id:"g-profsvcs",parentId:"g-8000",label:"Professional Services",kind:"group",indent:1},
      {id:"accounting_finance",parentId:"g-profsvcs",label:"Accounting & Finance",kind:"item",indent:2,actualKey:"accounting_finance",forecastFn:()=>-1.3},
      {id:"business_consultation",parentId:"g-profsvcs",label:"Business Consultation",kind:"item",indent:2,actualKey:"business_consultation",forecastFn:()=>0},
      {id:"legal_fees",parentId:"g-profsvcs",label:"Legal Fees",kind:"item",indent:2,actualKey:"legal_fees",forecastFn:()=>0},
      {id:"t-profsvcs",parentId:"g-profsvcs",label:"Total Professional Services",kind:"total",indent:2},
    {id:"quality_rd",parentId:"g-8000",label:"Quality and R&D",kind:"item",indent:1,actualKey:"quality_rd",forecastFn:(m,i)=>m.gen_exp[i]*0.15},
    {id:"taxes_licenses",parentId:"g-8000",label:"Taxes & Licenses",kind:"item",indent:1,actualKey:"taxes_licenses",forecastFn:()=>0},
    {id:"g-travel",parentId:"g-8000",label:"Travel",kind:"group",indent:1},
      {id:"car_rental_uber",parentId:"g-travel",label:"Car Rental / Uber",kind:"item",indent:2,actualKey:"car_rental_uber",forecastFn:()=>0},
      {id:"flights",parentId:"g-travel",label:"Flights",kind:"item",indent:2,actualKey:"flights",forecastFn:()=>0},
      {id:"hotel",parentId:"g-travel",label:"Hotel",kind:"item",indent:2,actualKey:"hotel",forecastFn:()=>0},
      {id:"t-travel",parentId:"g-travel",label:"Total Travel",kind:"total",indent:2},
    {id:"uncategorized",parentId:"g-8000",label:"Uncategorized Expense",kind:"item",indent:1,actualKey:"uncategorized",forecastFn:()=>0},
    {id:"vehicle_expenses",parentId:"g-8000",label:"Vehicle Expenses",kind:"item",indent:1,actualKey:"vehicle_expenses",forecastFn:()=>0},
    {id:"t-8000",parentId:"g-8000",label:"Total 8000 General & Administrative",kind:"total",indent:1,forecastFn:(m,i)=>m.gen_exp[i]+m.team[i]},
  {id:"t-expenses",label:"Total Expenses",kind:"total",indent:0,bold:true,forecastFn:(m,i)=>m.selling_exp[i]+m.mkt_trade[i]+m.team[i]+m.gen_exp[i]},

  {id:"t-noi",label:"NET OPERATING INCOME",kind:"total",indent:0,bold:true,forecastFn:(m,i)=>m.ebitda[i]},

  {id:"s-other",label:"OTHER INCOME",kind:"section",indent:0},
  {id:"g-9000",label:"9000 · Other Income",kind:"group",indent:0},
    {id:"other_income",parentId:"g-9000",label:"9000 Other Income",kind:"item",indent:1,actualKey:"other_income",forecastFn:()=>0},
    {id:"t-9000",parentId:"g-9000",label:"Total Other Income",kind:"total",indent:1,forecastFn:()=>0},

  {id:"t-netincome",label:"NET INCOME",kind:"total",indent:0,bold:true,forecastFn:(m,i)=>m.ebitda[i]},
];

function buildChildMap(rows: PLRow[]): Record<string,string[]> {
  const map: Record<string,string[]> = {};
  for (const r of rows) {
    if (!r.parentId) continue;
    if (!map[r.parentId]) map[r.parentId] = [];
    map[r.parentId].push(r.id);
  }
  return map;
}

// ─── P&L Table ────────────────────────────────────────────────────────────────
function PNLTab({ m, realMonths, actuals, fyActualOnly }: { m: typeof D; realMonths: number; actuals: Record<string, any>; fyActualOnly: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(["g-disc","g-facility","g-payroll","g-profsvcs","g-travel"])
  );
  const childMap = useMemo(() => buildChildMap(PL_ROWS), []);

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function isVisible(row: PLRow): boolean {
    if (!row.parentId) return true;
    if (collapsed.has(row.parentId)) return false;
    const parent = PL_ROWS.find(r => r.id === row.parentId);
    if (!parent) return true;
    return isVisible(parent);
  }

  // Get value for a cell (month idx)
  function getValue(row: PLRow, idx: number): number | null {
    if (row.kind === "section") return null;
    const period = PERIODS[idx];
    const isActual = !!actuals[period]?.pnl_detail;

    // Special case: NET INCOME = NOI + Other Income
    if (row.id === "t-netincome") {
      const noi = getValue(PL_ROWS.find(r => r.id === "t-noi")!, idx) ?? 0;
      // Read other_income directly from pnl_detail for actual months
      const period = PERIODS[idx];
      const otherInc = actuals[period]?.pnl_detail?.other_income != null
        ? Number(actuals[period].pnl_detail.other_income) / 1000
        : 0;
      return noi + otherInc;
    }

    if (row.kind === "total" || row.kind === "pct") {
      // Only sum ITEM and GROUP children (skip other totals to avoid double-counting)
      const children = (childMap[row.id] || [])
        .map(cid => PL_ROWS.find(r => r.id === cid)!)
        .filter(Boolean)
        .filter(c => c.kind !== "total");  // exclude sub-totals
      if (children.length > 0) {
        const childSum = children.reduce((s, c) => {
          const cv = getValue(c, idx);
          return s + (cv ?? 0);
        }, 0);
        if (row.kind === "pct") {
          // Special case: GP / Net Sales
          if (row.id === "t-gp-pct") {
            const ns = getValue(PL_ROWS.find(r => r.id === "t-income")!, idx) ?? 1;
            const gp = getValue(PL_ROWS.find(r => r.id === "t-gp")!, idx) ?? 0;
            return ns !== 0 ? gp / ns : 0;
          }
          return childSum;
        }
        return childSum;
      }
      // No children or total with forecastFn
      if (row.forecastFn) return row.forecastFn(m, idx);
      return null;
    }

    if (row.kind === "group") {
      // Group shows the sum of its direct item/group children (not totals)
      const children = (childMap[row.id] || [])
        .map(cid => PL_ROWS.find(r => r.id === cid)!)
        .filter(Boolean)
        .filter(c => c.kind !== "total");
      if (children.length > 0) {
        return children.reduce((s, c) => s + (getValue(c, idx) ?? 0), 0);
      }
      if (row.forecastFn) return row.forecastFn(m, idx);
      return null;
    }

    if (row.kind === "item") {
      if (isActual && row.actualKey) {
        const val = actuals[period].pnl_detail[row.actualKey];
        return val != null ? Number(val) / 1000 : 0; // convert to $K
      }
      if (row.forecastFn) return row.forecastFn(m, idx);
      return 0;
    }
    return null;
  }

  // Compute P&L values as gp% from actual income/gp
  function getGPPct(idx: number): number {
    const income = getValue(PL_ROWS.find(r => r.id === "t-income")!, idx) ?? 1;
    const gp = getValue(PL_ROWS.find(r => r.id === "t-gp")!, idx) ?? 0;
    return income !== 0 ? gp / income : 0;
  }

  const gs_fy = sum(m.gross_sales);
  const indentPx = [0,16,28,40];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"/>
          Actual = Accountfully
        </span>
        <span className="opacity-60">F = Best Estimate forecast</span>
        <button onClick={() => setCollapsed(new Set())} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Expand all</button>
        <button onClick={() => setCollapsed(new Set(PL_ROWS.filter(r=>r.kind==="group").map(r=>r.id)))} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Collapse all</button>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-52 min-w-[200px]">Line</th>
              {MONTHS.map((mo,i) => (
                <th key={mo} className="text-right px-2 py-2.5 text-[10px] uppercase tracking-wide w-12"
                  style={{color: i < realMonths ? "#1C2340" : fyActualOnly ? "#D1D5DB" : "#9CA3AF"}}>
                  {mo}
                  <div className="text-[8px] flex items-center justify-end gap-0.5">
                    {i < realMonths && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block"/>}
                    {i < realMonths ? "A" : fyActualOnly ? "—" : "F"}
                  </div>
                </th>
              ))}
              <th className="text-right px-2 py-2.5 text-[10px] uppercase text-muted-foreground w-14">
                {fyActualOnly ? `H1'26` : "FY"}
              </th>
              <th className="text-right px-2 py-2.5 text-[10px] uppercase text-muted-foreground w-12">% GS</th>
            </tr>
          </thead>
          <tbody>
            {PL_ROWS.filter(r => isVisible(r)).map(row => {
              if (row.kind === "section") return (
                <tr key={row.id} className="bg-muted/20 border-t border-border">
                  <td colSpan={16} className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{row.label}</td>
                </tr>
              );
              const hasChildren = (childMap[row.id] || []).length > 0;
              const isExp = hasChildren && row.kind === "group";
              const isOpen = !collapsed.has(row.id);
              const isTotal = row.kind === "total" || row.kind === "pct";
              const vals = MONTHS.map((_, i) => row.kind === "pct" ? getGPPct(i) : getValue(row, i));
              const fySlice = fyActualOnly ? vals.slice(0, realMonths) : vals;
              const fy = row.kind === "pct" ? (fySlice.reduce((s,v)=>(s??0)+(v??0),0)!/(fyActualOnly ? realMonths : 12)) : fySlice.reduce((s,v)=>(s??0)+(v??0),0)!;
              const pctGS = gs_fy ? `${(Math.abs(fy!/1000 > 1 ? fy! : fy!*1000)/gs_fy*100).toFixed(1)}%` : "—";

                // Clicking a total row toggles its parent group
                const parentGroupId = (row.kind === "total" && row.parentId) ? row.parentId : null;
                const parentIsGroup = parentGroupId ? PL_ROWS.find(r => r.id === parentGroupId)?.kind === "group" : false;
                const parentIsOpen = parentGroupId ? !collapsed.has(parentGroupId) : false;

                return (
                <tr key={row.id}
                  className={`border-t border-border/40 hover:bg-muted/20
                    ${row.bold || isTotal ? "font-semibold" : ""}
                    ${row.kind==="total" && row.indent===0 ? "bg-muted/10" : ""}
                    ${row.id==="t-netincome" ? "border-t-2 border-border" : ""}
                    ${parentIsGroup ? "cursor-pointer select-none" : ""}
                  `}
                  onClick={parentIsGroup ? () => toggle(parentGroupId!) : undefined}
                >
                  <td className="px-4 py-1.5" style={{paddingLeft: `${16+indentPx[row.indent]}px`, color:"#1C2340"}}>
                    <span className="flex items-center gap-1.5">
                      {isExp && (
                        <button onClick={(e) => { e.stopPropagation(); toggle(row.id); }}
                          className="text-muted-foreground hover:text-foreground flex-shrink-0 w-4 text-center font-mono text-[10px]">
                          {isOpen ? "▾" : "▸"}
                        </button>
                      )}
                      {!isExp && parentIsGroup && (
                        <span className="text-muted-foreground w-4 text-center font-mono text-[10px] flex-shrink-0">
                          {parentIsOpen ? "▾" : "▸"}
                        </span>
                      )}
                      {!isExp && !parentIsGroup && <span className="w-4 flex-shrink-0"/>}
                      <span className={`${isTotal ? "" : row.indent > 0 ? "text-muted-foreground" : ""}`}>{row.label}</span>
                    </span>
                  </td>
                  {vals.map((v, i) => (
                    <td key={i} className={`text-right px-2 py-1.5 font-mono tabular-nums`}
                      style={{
                        color: (fyActualOnly && i >= realMonths) ? "#E5E7EB"
                          : row.kind==="pct" ? "#1C2340"
                          : (v??0)<0 ? "#EF4444"
                          : isTotal && (v??0)>0 ? "#10B981"
                          : i >= realMonths ? "#9CA3AF"
                          : "#1C2340"
                      }}>
                      {(fyActualOnly && i >= realMonths) ? "—"
                        : row.kind==="pct" ? fmtPct(v??0)
                        : (!v || v===0) ? "—"
                        : fmt(v,0)}
                    </td>
                  ))}
                  <td className="text-right px-2 py-1.5 font-mono font-semibold tabular-nums"
                    style={{color: row.kind==="pct" ? "#1C2340" : (fy??0)<0 ? "#EF4444" : "#10B981"}}>
                    {row.kind==="pct" ? fmtPct((fy??0)/12) : (!fy || fy===0) ? "—" : fmt(fy,0)}
                  </td>
                  <td className="text-right px-2 py-1.5 font-mono text-muted-foreground tabular-nums text-[10px]">
                    {row.kind==="pct" ? "—" : pctGS}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Cash Flow Tab ────────────────────────────────────────────────────────────
function CashFlowTab({ refMonth, m, realMonths }: { refMonth: number; m: typeof D; realMonths: number }) {
  const cashCanvas = useRef<HTMLCanvasElement>(null);
  const avgBurn = (m.ebitda[Math.max(0,refMonth-2)] + m.ebitda[Math.max(0,refMonth-1)] + m.ebitda[refMonth]) / 3;
  const runway = avgBurn < 0 ? m.cash_eop[refMonth] / Math.abs(avgBurn) : 99;

  useChart(cashCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Cash EOP', data: m.cash_eop, borderColor:'#1C2340', backgroundColor:'rgba(28,35,64,0.1)', tension:0.3, fill:true, pointRadius:5 },
        { label: 'Runway = 0', data: MONTHS.map(()=>0), borderColor:'#DC2626', borderDash:[5,5], pointRadius:0, fill:false }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } }, scales:{ y:{ ticks:{ callback:(v:number)=>'$'+v+'K' } } } }
  }), []);

  type CFRow = { name: string; type?: string; data: (number|null)[] };
  const cfRows: CFRow[] = [
    { name: 'EBITDA',                      data: m.ebitda },
    { name: 'Changes in Working Capital',  data: m.chg_wc },
    { name: '  · AR',                      data: m.chg_ar },
    { name: '  · Inventory',               data: m.chg_inventory },
    { name: '  · AP',                      data: m.chg_ap },
    { name: 'Cash from Operations',        type: 'total', data: m.cash_from_ops },
    { name: 'Capital contributions',       data: m.capital_contrib },
    { name: 'Investing Cash Flow',         type: 'total', data: m.capital_contrib },
    { name: 'Cash BOP',                    data: m.cash_bop },
    { name: 'Change in cash',              data: m.chg_cash },
    { name: 'Cash EOP',                    type: 'total', data: m.cash_eop },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm flex items-center gap-4 flex-wrap">
        <span>💰 <strong>Cash on hand (Jul 2026):</strong> {fmtK(m.cash_eop[refMonth])}</span>
        <span>· <strong>Runway:</strong> {runway > 36 ? "36+ mo" : runway.toFixed(1)+" mo"}</span>
        <span>· <strong>Cash EOP (Dec 26):</strong> {fmtK(m.cash_eop[11])}</span>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="text-sm font-semibold mb-3" style={{color:"#1C2340"}}>
          Cash trend month by month <span className="text-[10px] font-normal text-muted-foreground">red line = runway = 0 (projected)</span>
        </div>
        <div style={{height:280}}><canvas ref={cashCanvas} /></div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground w-44">Line</th>
              {MONTHS.map((m,i) => (
                <th key={m} className="text-right px-2 py-2.5 text-[10px] uppercase w-12"
                  style={{color: i < realMonths ? "#1C2340" : "#9CA3AF"}}>{m}</th>
              ))}
              <th className="text-right px-2 py-2.5 text-[10px] uppercase text-muted-foreground w-14">FY</th>
            </tr>
          </thead>
          <tbody>
            {cfRows.map((row, ri) => {
              const isTotal = row.type === 'total';
              const fy = sum(row.data.map(v => v ?? 0));
              return (
                <tr key={ri} className={`border-t border-border/40 hover:bg-muted/20 ${isTotal ? "font-bold bg-muted/10" : ""}`}>
                  <td className={`px-4 py-1.5 ${isTotal ? "font-bold" : "text-muted-foreground"} ${row.name.startsWith('  ') ? "pl-8" : ""}`}
                    style={{color:"#1C2340"}}>{row.name.trim()}</td>
                  {row.data.map((v,i) => (
                    <td key={i} className={`text-right px-2 py-1.5 font-mono tabular-nums ${i >= realMonths ? "opacity-60" : ""}`}
                      style={{color: v === null ? "#9CA3AF" : (v??0) < 0 ? "#EF4444" : (v??0) > 0 ? "#10B981" : "#9CA3AF"}}>
                      {v === null || v === 0 ? "—" : fmt(v,0)}
                    </td>
                  ))}
                  <td className="text-right px-2 py-1.5 font-mono font-semibold tabular-nums"
                    style={{color: fy < 0 ? "#EF4444" : fy > 0 ? "#10B981" : "#9CA3AF"}}>
                    {fy === 0 ? "—" : fmt(fy,0)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Balance Sheet Tab ────────────────────────────────────────────────────────
// BS section definition – flat, with explicit parent IDs
type BSNode = {
  id: string; parentId?: string; label: string;
  kind: "section"|"group"|"item"|"total";
  actualKey?: string;
  forecastFn?: (m: typeof D, i: number) => number;
  indent: 0|1|2|3;
};

const BS_ROWS: BSNode[] = [
  // ── ASSETS ──────────────────────────────────────────────────────────────────
  {id:"s-assets",label:"ASSETS",kind:"section",indent:0},
  {id:"g-bank",label:"Bank Accounts",kind:"group",indent:0},
    {id:"bofa",parentId:"g-bank",label:"1001 BOFA x6854",kind:"item",indent:1,actualKey:"bofa_x6854",forecastFn:()=>0},
    {id:"citi_b",parentId:"g-bank",label:"Citi Bank",kind:"item",indent:1,actualKey:"citi_bank",forecastFn:()=>0},
    {id:"merc_chk",parentId:"g-bank",label:"Mercury Checking",kind:"item",indent:1,actualKey:"mercury_checking",forecastFn:()=>0},
    {id:"merc_trs",parentId:"g-bank",label:"Mercury Treasury",kind:"item",indent:1,actualKey:"mercury_treasury",forecastFn:()=>0},
  {id:"t-bank",label:"Total Bank Accounts",kind:"total",indent:0,forecastFn:(m,i)=>m.cash_eop[i]},
  {id:"g-ar",label:"Accounts Receivable",kind:"group",indent:0},
    {id:"ar_item",parentId:"g-ar",label:"1100 Accounts receivable (A/R)",kind:"item",indent:1,actualKey:"accounts_receivable",forecastFn:(m,i)=>m.ar[i]},
  {id:"t-ar",label:"Total Accounts Receivable",kind:"total",indent:0,forecastFn:(m,i)=>m.ar[i]},
  {id:"g-inv",label:"1400 Inventory",kind:"group",indent:0},
    {id:"fin_goods",parentId:"g-inv",label:"1401 Finished Goods",kind:"item",indent:1,actualKey:"finished_goods",forecastFn:()=>0},
    {id:"raw_mat",parentId:"g-inv",label:"1410 Raw Materials & Packaging",kind:"item",indent:1,actualKey:"raw_materials_packaging",forecastFn:()=>0},
  {id:"t-inv",label:"Total Inventory",kind:"total",indent:0,forecastFn:(m,i)=>m.inventory[i]},
  {id:"loans_sh",label:"Loans to Shareholders",kind:"item",indent:0,actualKey:"loans_to_shareholders",forecastFn:()=>12.96},
  {id:"t-curr-assets",label:"Total Current Assets",kind:"total",indent:0,forecastFn:(m,i)=>m.cash_eop[i]+m.ar[i]+m.inventory[i]+12.96},
  {id:"g-fixed",label:"1200 Fixed Assets",kind:"group",indent:0},
    {id:"equip",parentId:"g-fixed",label:"1201 Equipment",kind:"item",indent:1,actualKey:"equipment",forecastFn:()=>11.19},
    {id:"accum_dep",parentId:"g-fixed",label:"1220 Accumulated Depreciation",kind:"item",indent:1,actualKey:"accumulated_depreciation",forecastFn:()=>-4.93},
  {id:"t-fixed",label:"Total Fixed Assets",kind:"total",indent:0,forecastFn:()=>6.26},
  {id:"due_sh",label:"Due from Shareholders",kind:"item",indent:0,actualKey:"due_from_shareholders",forecastFn:()=>1.0},
  {id:"t-assets",label:"TOTAL ASSETS",kind:"total",indent:0,forecastFn:(m,i)=>m.total_assets[i]},

  // ── LIABILITIES ─────────────────────────────────────────────────────────────
  {id:"s-liab",label:"LIABILITIES AND EQUITY",kind:"section",indent:0},
  {id:"s-liab2",label:"Liabilities",kind:"section",indent:0},
  {id:"g-cc",label:"Credit Cards",kind:"group",indent:0},
    {id:"boa3724",parentId:"g-cc",label:"BoA 3724",kind:"item",indent:1,actualKey:"boa_3724",forecastFn:()=>0},
    {id:"boa7830",parentId:"g-cc",label:"BoA 7830",kind:"item",indent:1,actualKey:"boa_7830",forecastFn:()=>0},
    {id:"boa8781",parentId:"g-cc",label:"BoA 8781 (2253)",kind:"item",indent:1,actualKey:"boa_8781",forecastFn:()=>0},
    {id:"citi_cc",parentId:"g-cc",label:"Citi Credit Card -5413",kind:"item",indent:1,actualKey:"citi_credit",forecastFn:()=>0},
    {id:"merc_cc",parentId:"g-cc",label:"Mercury Credit",kind:"item",indent:1,actualKey:"mercury_credit",forecastFn:()=>0},
  {id:"t-cc",label:"Total Credit Cards",kind:"total",indent:0,forecastFn:()=>0},
  {id:"g-other-liab",label:"Other Current Liabilities",kind:"group",indent:0},
    {id:"accrued",parentId:"g-other-liab",label:"2010 Accrued Liabilities",kind:"item",indent:1,actualKey:"accrued_liabilities",forecastFn:()=>10.34},
  {id:"t-other-liab",label:"Total Other Current Liabilities",kind:"total",indent:0,forecastFn:()=>10.34},
  {id:"t-liab",label:"Total Liabilities",kind:"total",indent:0,forecastFn:(m,i)=>m.total_liab[i]},

  // ── EQUITY ──────────────────────────────────────────────────────────────────
  {id:"s-equity",label:"Equity",kind:"section",indent:0},
  {id:"g-capital",label:"3100 Capital Contributions",kind:"group",indent:0},
    {id:"cap1",parentId:"g-capital",label:"1st Investment Round",kind:"item",indent:1,actualKey:"capital_1st_round",forecastFn:()=>225},
    {id:"cap2",parentId:"g-capital",label:"2nd Investment Round",kind:"item",indent:1,actualKey:"capital_2nd_round",forecastFn:()=>399.87},
    {id:"cap3",parentId:"g-capital",label:"3rd Investment Round",kind:"item",indent:1,actualKey:"capital_3rd_round",forecastFn:()=>685.97},
    {id:"cap4",parentId:"g-capital",label:"4th Investment Round",kind:"item",indent:1,actualKey:"capital_4th_round",forecastFn:()=>2146.73},
  {id:"t-capital",label:"Total Capital Contributions",kind:"total",indent:0,forecastFn:()=>3457.57},
  {id:"common_stock",label:"Common Stock",kind:"item",indent:0,actualKey:"common_stock",forecastFn:()=>1.10},
  {id:"open_bal_eq",label:"Opening Balance Equity",kind:"item",indent:0,actualKey:"opening_balance_equity",forecastFn:()=>-1.87},
  {id:"ret_earn",label:"Retained Earnings",kind:"item",indent:0,actualKey:"retained_earnings",forecastFn:()=>-1548.94},
  {id:"net_inc_eq",label:"Net Income",kind:"item",indent:0,actualKey:"net_income_equity",forecastFn:(m,i)=>sum(m.ebitda,0,i+1)},
  {id:"t-equity",label:"Total Equity",kind:"total",indent:0,forecastFn:(m,i)=>m.total_equity[i]},
  {id:"t-liab-equity",label:"TOTAL LIABILITIES AND EQUITY",kind:"total",indent:0,forecastFn:(m,i)=>m.total_assets[i]},
];

function BalanceTab({ m, realMonths, actuals }: { m: typeof D; realMonths: number; actuals: Record<string,any> }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(["g-bank","g-ar","g-inv","g-fixed","g-cc","g-other-liab","g-capital"])
  );

  // Latest month with bs_detail
  const { latestBsDetail, latestBsIdx } = useMemo(() => {
    const sorted = Object.keys(actuals)
      .filter(p => actuals[p] && actuals[p].bs_detail)
      .sort();
    if (!sorted.length) return { latestBsDetail: null, latestBsIdx: -1 };
    const last = sorted[sorted.length - 1];
    return {
      latestBsDetail: actuals[last].bs_detail as Record<string, number>,
      latestBsIdx: PERIODS.indexOf(last),
    };
  }, [actuals]);

  // Child IDs per parent (only items — groups handle themselves)
  const childMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const r of BS_ROWS) {
      if (!r.parentId) continue;
      if (!map[r.parentId]) map[r.parentId] = [];
      map[r.parentId].push(r.id);
    }
    return map;
  }, []);

  function toggle(id: string) {
    setCollapsed(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function isVisible(row: BSNode): boolean {
    if (!row.parentId) return true;
    const pid = row.parentId as string;
    if (collapsed.has(pid)) return false;
    // Check grandparent too
    const parent = BS_ROWS.find(r => r.id === pid);
    if (!parent) return true;
    if (!parent.parentId) return true;
    return !collapsed.has(parent.parentId);
  }

  function getValue(row: BSNode, idx: number): number | null {
    if (row.kind === "section") return null;

    // Group: sum its item children
    if (row.kind === "group") {
      const items = (childMap[row.id] || [])
        .map(cid => BS_ROWS.find(r => r.id === cid))
        .filter((r): r is BSNode => r != null);
      const s = items.reduce((acc, r) => acc + (getValue(r, idx) ?? 0), 0);
      return s;
    }

    // Total: use forecastFn (pre-computed)
    if (row.kind === "total") {
      return row.forecastFn ? row.forecastFn(m, idx) : null;
    }

    // Item
    const isActualIdx = latestBsDetail && idx === latestBsIdx;
    if (isActualIdx && row.actualKey) {
      const raw = latestBsDetail![row.actualKey];
      if (raw != null) return Number(raw) / 1000;
    }
    return row.forecastFn ? row.forecastFn(m, idx) : null;
  }

  const indentPx = [0, 16, 28, 40];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button onClick={() => setCollapsed(new Set())} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Expand all</button>
        <button onClick={() => setCollapsed(new Set(BS_ROWS.filter(r=>r.kind==="group").map(r=>r.id)))} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Collapse all</button>
        {latestBsIdx >= 0 && (
          <span>Accountfully detail: <strong>{MONTHS[latestBsIdx]} 2026</strong> · Other months = Best Estimate</span>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground min-w-[240px]">Line</th>
              {MONTHS.map((mo, i) => (
                <th key={mo} className="text-right px-2 py-2.5 text-[10px] uppercase tracking-wide w-12"
                  style={{color: i < realMonths ? "#1C2340" : "#9CA3AF"}}>
                  {mo}
                  <div className="text-[8px]">{i < realMonths ? "A" : "F"}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BS_ROWS.filter(r => isVisible(r)).map(row => {
              if (row.kind === "section") return (
                <tr key={row.id}>
                  <td colSpan={13} className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white" style={{backgroundColor:"#1C2340"}}>{row.label}</td>
                </tr>
              );
              const isGroup = row.kind === "group";
              const isTotal = row.kind === "total";
              const isOpen = !collapsed.has(row.id);
              const vals = MONTHS.map((_, i) => getValue(row, i));

              return (
                <tr key={row.id} className={`border-t border-border/40 hover:bg-muted/20 ${isTotal && row.indent === 0 ? "bg-muted/10 font-semibold" : ""}`}>
                  <td className="px-4 py-1.5" style={{paddingLeft: `${16+indentPx[row.indent]}px`, color:"#1C2340"}}>
                    <span className="flex items-center gap-1.5">
                      {isGroup && (
                        <button onClick={() => toggle(row.id)}
                          className="text-muted-foreground hover:text-foreground w-4 text-center font-mono text-[10px]">
                          {isOpen ? "▾" : "▸"}
                        </button>
                      )}
                      {!isGroup && <span className="w-4 inline-block"/>}
                      <span className={`${isTotal ? "font-semibold" : row.indent > 0 ? "text-muted-foreground" : ""}`}>
                        {row.label}
                      </span>
                    </span>
                  </td>
                  {vals.map((v, i) => (
                    <td key={i} className={`text-right px-2 py-1.5 font-mono tabular-nums ${i >= realMonths ? "opacity-60" : ""}`}
                      style={{color: "#1C2340"}}>
                      {v == null || v === 0 ? "—" : fmt(v, 0)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Runway Tab ───────────────────────────────────────────────────────────────
function RunwayTab() {
  const [minCash, setMinCash] = useState(50000);
  const runwayCanvas = useRef<HTMLCanvasElement>(null);

  // Weekly collections from our real data (Aug-Oct 2026)
  const WEEKS = [
    { week:'Jul 28–Aug 3',  collections:13839,  payments:19000, suppliers:0 },
    { week:'Aug 4–Aug 10',  collections:8870,   payments:19000, suppliers:12500 },
    { week:'Aug 11–Aug 17', collections:18220,  payments:19000, suppliers:0 },
    { week:'Aug 18–Aug 24', collections:6898,   payments:19000, suppliers:8750 },
    { week:'Aug 25–Aug 31', collections:22400,  payments:19000, suppliers:0 },
    { week:'Sep 1–Sep 7',   collections:15600,  payments:19000, suppliers:14000 },
    { week:'Sep 8–Sep 14',  collections:12000,  payments:19000, suppliers:0 },
    { week:'Sep 15–Sep 21', collections:30000,  payments:19000, suppliers:0 },
    { week:'Sep 22–Sep 28', collections:8000,   payments:19000, suppliers:8750 },
    { week:'Sep 29–Oct 5',  collections:10000,  payments:19000, suppliers:0 },
    { week:'Oct 6–Oct 12',  collections:18000,  payments:19000, suppliers:12500 },
    { week:'Oct 13–Oct 19', collections:14000,  payments:19000, suppliers:0 },
  ];

  const cashStart = 184500; // Jul 27 actual
  let balance = cashStart;
  const weekData = WEEKS.map(w => {
    const startBal = balance;
    balance = balance + w.collections - w.payments - w.suppliers;
    return { ...w, startBal, endBal: balance };
  });

  const labels = weekData.map(w => w.week);
  const balances = weekData.map(w => w.endBal);
  const collections = weekData.map(w => w.collections);
  const payments = weekData.map(w => -(w.payments + w.suppliers));

  useChart(runwayCanvas, () => ({
    data: {
      labels,
      datasets: [
        { type:'line', label:'Projected balance', data:balances, borderColor:'#3B82F6', backgroundColor:'rgba(59,130,246,0.1)', tension:0.3, fill:true, pointRadius:5, yAxisID:'y' },
        { type:'bar', label:'Collections', data:collections, backgroundColor:'rgba(16,185,129,0.7)', yAxisID:'y2' },
        { type:'bar', label:'Payments', data:payments, backgroundColor:'rgba(239,68,68,0.5)', yAxisID:'y2' },
        { type:'line', label:'Minimum cash', data:labels.map(()=>minCash/1000), borderColor:'#DC2626', borderDash:[5,5], pointRadius:0, fill:false, yAxisID:'y' },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } },
      scales:{
        y:{ position:'left', ticks:{ callback:(v:number)=>'$'+v+'K' } },
        y2:{ position:'right', grid:{ drawOnChartArea:false }, ticks:{ callback:(v:number)=>'$'+Math.abs(v)+'K' } }
      }
    }
  }), [minCash]);

  const pendingCollect = 163023;
  const paymentsNext30 = 19000 * 4 + 12500 + 8750;
  const runwayWeeks = weekData.filter(w => w.endBal >= minCash).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <label className="text-sm font-semibold text-muted-foreground">Minimum cash $</label>
        <input type="number" value={minCash} step={5000}
          onChange={e => setMinCash(Number(e.target.value))}
          className="w-32 rounded-lg border border-border px-3 py-1.5 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <button onClick={() => setMinCash(50000)} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted">↺ Reset</button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI icon="🏦" label="Cash Today" value={`$${(cashStart/1000).toFixed(0)}k`} sub="estimated Jul 27" />
        <KPI icon="📥" label="Collections Next 30d" value={`$${Math.round(pendingCollect/1000)}k`} sub="invoices to collect" subColor="text-emerald-600" />
        <KPI icon="📤" label="Payments Next 30d" value={`$${Math.round(paymentsNext30/1000)}k`} sub="fixed + suppliers" subColor="text-orange-500" />
        <KPI icon="⏱️" label="Runway" value={runwayWeeks >= WEEKS.length ? "12+ wks" : `${runwayWeeks} wks`}
          sub={runwayWeeks >= WEEKS.length ? "cash above minimum full period" : `until dropping below $${(minCash/1000).toFixed(0)}k`}
          subColor={runwayWeeks >= WEEKS.length ? "text-emerald-600" : "text-orange-500"} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Projected balance week by week</h3>
          <span className="text-[10px] text-muted-foreground">12 weeks · red line = minimum cash</span>
        </div>
        <div style={{height:300}}><canvas ref={runwayCanvas} /></div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-2.5 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Weekly detail</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2 text-left">Week</th>
              <th className="px-4 py-2 text-right">Opening balance</th>
              <th className="px-4 py-2 text-right text-emerald-600">Collections</th>
              <th className="px-4 py-2 text-right text-orange-500">Fixed payments</th>
              <th className="px-4 py-2 text-right text-red-500">Suppliers</th>
              <th className="px-4 py-2 text-right">Closing balance</th>
              <th className="px-4 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {weekData.map((w, i) => {
              const ok = w.endBal >= minCash;
              return (
                <tr key={i} className={`border-t border-border/60 hover:bg-muted/20 ${!ok ? "bg-red-50/30" : ""}`}>
                  <td className="px-4 py-1.5 font-medium">{w.week}</td>
                  <td className="px-4 py-1.5 text-right font-mono">${w.startBal.toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-emerald-600">+${w.collections.toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-orange-500">-${w.payments.toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-red-500">{w.suppliers > 0 ? `-$${w.suppliers.toLocaleString()}` : "—"}</td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold"
                    style={{color: ok ? "#10B981" : "#EF4444"}}>
                    ${w.endBal.toLocaleString()}
                  </td>
                  <td className="px-4 py-1.5 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {ok ? "✓ OK" : "⚠️ Below min"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── EBITDA Simulator ─────────────────────────────────────────────────────────
function EBITDATab() {
  const [cases, setCases] = useState(1500);
  const [price, setPrice] = useState(36.96);
  const [cogs, setCogs] = useState(22);
  const [dedPct, setDedPct] = useState(18);
  const [fixed, setFixed] = useState(55000);

  const grossRev = cases * price;
  const ded = grossRev * dedPct / 100;
  const netRev = grossRev - ded;
  const totalCogs = cases * cogs;
  const grossProfit = netRev - totalCogs;
  const ebitda = grossProfit - fixed;
  const gm = netRev > 0 ? (grossProfit / netRev) * 100 : 0;
  const contribPerCase = price * (1 - dedPct/100) - cogs;
  const breakeven = contribPerCase > 0 ? Math.ceil(fixed / contribPerCase) : null;
  const cash = 184480;
  const monthlyBurn = Math.abs(Math.min(ebitda, 0));
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : 99;

  const Slider = ({ label, value, min, max, step, onChange, display }: {
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; display: string;
  }) => (
    <div className="mb-4">
      <div className="flex justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-mono font-semibold" style={{color:"#1C2340"}}>{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{accentColor:"#A3224A"}} />
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>EBITDA Simulator</h3>
        <Slider label="Cases / month" value={cases} min={500} max={5000} step={50} onChange={setCases} display={cases.toLocaleString()} />
        <Slider label="Avg price / case ($)" value={price} min={30} max={45} step={0.5} onChange={setPrice} display={`$${price.toFixed(2)}`} />
        <Slider label="COGS / case ($)" value={cogs} min={10} max={35} step={0.5} onChange={setCogs} display={`$${cogs.toFixed(2)}`} />
        <Slider label="Deductions %" value={dedPct} min={5} max={35} step={0.5} onChange={setDedPct} display={`${dedPct}%`} />
        <Slider label="Fixed costs / month ($)" value={fixed} min={20000} max={120000} step={1000} onChange={setFixed} display={`$${(fixed/1000).toFixed(0)}k`} />
        <div className="flex flex-wrap gap-2 mt-4">
          {[
            { label:"Current Jul", cases:1500, price:36.96, cogs:22, ded:18, fixed:55000 },
            { label:"Q4 Target",   cases:2200, price:36.96, cogs:21, ded:17, fixed:55000 },
            { label:"OOE COGS",    cases:1500, price:36.96, cogs:18, ded:18, fixed:55000 },
          ].map(s => (
            <button key={s.label} onClick={() => { setCases(s.cases); setPrice(s.price); setCogs(s.cogs); setDedPct(s.ded); setFixed(s.fixed); }}
              className="rounded-full px-3 py-1 text-xs font-semibold border border-border hover:bg-muted">
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className={`rounded-2xl border p-5 ${ebitda >= 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-1 text-muted-foreground">Monthly EBITDA</p>
          <div className={`text-3xl font-bold font-mono ${ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {ebitda >= 0 ? "$" : "-$"}{Math.abs(Math.round(ebitda)).toLocaleString()}
          </div>
          <p className="text-xs mt-1 text-muted-foreground">GM: {gm.toFixed(1)}% · Contrib/case: ${contribPerCase.toFixed(2)}</p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          {[
            { label:"Gross Revenue", v:grossRev, color:"#3B82F6" },
            { label:`Deductions (${dedPct}%)`, v:-ded, color:"#F59E0B" },
            { label:"Net Revenue", v:netRev, color:"#1C2340" },
            { label:`COGS ($${cogs}/case)`, v:-totalCogs, color:"#EF4444" },
            { label:"Gross Profit", v:grossProfit, color:grossProfit>=0?"#10B981":"#EF4444" },
            { label:"Fixed Costs", v:-fixed, color:"#6B7280" },
            { label:"EBITDA", v:ebitda, color:ebitda>=0?"#10B981":"#EF4444" },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
              <span className="text-xs text-muted-foreground">{row.label}</span>
              <span className="text-xs font-mono font-semibold" style={{color:row.color}}>
                {row.v >= 0 ? "$" : "-$"}{Math.abs(Math.round(row.v)).toLocaleString()}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Breakeven</p>
            <p className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>{breakeven ? breakeven.toLocaleString() : "∞"}</p>
            <p className="text-[10px] text-muted-foreground">cases/month</p>
            {breakeven && cases < breakeven && <p className="text-[10px] text-red-500 font-semibold mt-1">Need +{(breakeven-cases).toLocaleString()} cases</p>}
            {breakeven && cases >= breakeven && <p className="text-[10px] text-emerald-600 font-semibold mt-1">✓ Above breakeven</p>}
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Cash Runway</p>
            <p className={`text-xl font-bold font-mono ${runwayMonths < 6 ? "text-red-600" : runwayMonths < 12 ? "text-orange-500" : "text-emerald-600"}`}>
              {runwayMonths > 36 ? "36+" : runwayMonths.toFixed(1)}
            </p>
            <p className="text-[10px] text-muted-foreground">months · cash: ${(cash/1000).toFixed(0)}k</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function FinancePage() {
  const [tab, setTab] = useState<FinTab>("dashboard");
  const [period, setPeriod] = useState<Period>("fy");
  const [refMonth, setRefMonth] = useState(6); // Jul
  const [scenario, setScenario] = useState<"Forecast"|"Actual">("Actual");

  // ── Actuals from Supabase ──
  const [actuals, setActuals] = useState<Record<string, any>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<any[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function loadActuals() {
    const { data } = await supabase.from("finance_actuals").select("*").order("period");
    if (data) {
      const map: Record<string, any> = {};
      data.forEach((row: any) => { map[row.period] = row; });
      setActuals(map);
    }
  }

  useEffect(() => { loadActuals(); }, []);

  // ── Merged data: actual overrides D for months that have been uploaded ──
  const M = useMemo(() => {
    const result: any = {};
    for (const key of Object.keys(D) as (keyof typeof D)[]) {
      result[key] = [...D[key]];
    }
    if (scenario !== "Actual") return result as typeof D;
    PERIODS.forEach((period, idx) => {
      const actual = actuals[period];
      if (!actual) return;
      const fieldMap: Record<string, keyof typeof D> = {
        gross_sales: 'gross_sales', trade_spend: 'trade_spend', distr_fees: 'distr_fees',
        net_sales: 'net_sales', cogs: 'cogs', storage: 'storage', freight_out: 'freight_out',
        gross_margin: 'gross_margin', gm_pct: 'gm_pct',
        business_contribution: 'business_contribution',
        selling_exp: 'selling_exp', mkt_trade: 'mkt_trade', team: 'team',
        gen_exp: 'gen_exp', ebitda: 'ebitda',
        cash: 'cash_eop', ar: 'ar', inventory: 'inventory',
        total_assets: 'total_assets', total_liab: 'total_liab', total_equity: 'total_equity',
        cash_from_ops: 'cash_from_ops',
      };
      for (const [actualField, dField] of Object.entries(fieldMap)) {
        if (actual[actualField] != null) result[dField][idx] = Number(actual[actualField]);
      }
    });
    return result as typeof D;
  }, [actuals]);

  const realMonths = useMemo(() => scenario === "Actual" ? PERIODS.filter(p => actuals[p] != null).length : 0, [actuals, scenario]);

  const latestActualLabel = useMemo(() => {
    const keys = Object.keys(actuals).filter(p => actuals[p]).sort();
    if (!keys.length) return 'none';
    const last = keys[keys.length - 1];
    const idx = parseInt(last.split('-')[1]) - 1;
    return MONTHS[idx] + ' ' + last.split('-')[0];
  }, [actuals]);

  // ── PDF upload → Claude API ──
  async function handlePdfUpload(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadPreview(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: `Extract monthly P&L data from this Accountfully management report. Return ONLY a JSON array (no markdown, no explanation) where each item is one month:
[
  {
    "period": "2026-01",
    "period_label": "Jan 2026",
    "gross_sales": <Sales of Product Income in $K>,
    "trade_spend": <negative: DSD Programs + Promos + Consumer Returns in $K>,
    "distr_fees": <negative: Distributor Fees + KeHE + UNFI Allowance + Payment Terms in $K>,
    "net_sales": <Total Income after all deductions in $K>,
    "cogs": <Product Costs in $K>,
    "storage": <Warehouse/Fulfillment + Freight In combined in $K>,
    "freight_out": <Freight Out in $K>,
    "gross_margin": <Gross Profit in $K>,
    "gm_pct": <gross_margin / net_sales as decimal e.g. 0.256>,
    "selling_exp": <negative: 6500 Selling Expenses in $K>,
    "mkt_trade": <negative: 7000 Marketing & Trade in $K>,
    "team": <negative: Payroll & Employee Related Costs in $K>,
    "gen_exp": <negative: G&A minus payroll in $K>,
    "ebitda": <Net Operating Income in $K>,
    "business_contribution": <gross_margin + selling_exp + mkt_trade in $K>,
    "cash": <Bank Accounts total in $K if Balance Sheet available, else null>,
    "ar": <Accounts Receivable in $K if available, else null>,
    "inventory": <Total Inventory in $K if available, else null>,
    "total_assets": <Total Assets in $K if available, else null>,
    "total_liab": <Total Liabilities in $K if available, else null>,
    "total_equity": <Total Equity in $K if available, else null>
  }
]
All monetary values in $K (divide by 1000). Use null for unavailable fields.` }
            ]
          }]
        })
      });
      const data = await response.json();
      const text = data.content?.find((c: any) => c.type === 'text')?.text ?? '';
      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      setUploadPreview(parsed);
    } catch (e: any) {
      setUploadError(e.message ?? 'Failed to parse PDF');
    } finally {
      setUploading(false);
    }
  }

  async function saveActuals() {
    if (!uploadPreview) return;
    setUploading(true);
    for (const row of uploadPreview) {
      await supabase.from("finance_actuals").upsert(
        { ...row, source: 'Accountfully', uploaded_at: new Date().toISOString() },
        { onConflict: 'period' }
      );
    }
    setUploading(false);
    setUploadOpen(false);
    setUploadPreview(null);
    loadActuals();
  }

  // Load Chart.js if not already loaded
  useEffect(() => {
    if (window.Chart) return;
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.async = true;
    document.head.appendChild(script);
  }, []);

  const tabs: { id: FinTab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "pnl",       label: "P&L Full" },
    { id: "cashflow",  label: "Cash Flow" },
    { id: "balance",   label: "Balance Sheet" },
    { id: "runway",    label: "Cashflow · Runway" },
    { id: "ebitda",    label: "EBITDA Simulator" },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{color:"#1C2340"}}>Finance</h1>
          <p className="text-sm text-muted-foreground">
            P&L, cashflow, budget, forecast · Actuals: Accountfully {latestActualLabel} · Forecast: Best Estimate 2026
          </p>
        </div>
        <button onClick={() => setUploadOpen(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted flex items-center gap-1.5 mt-1">
          ↑ Upload Accountfully PDF
        </button>
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-bold text-sm" style={{color:"#1C2340"}}>Upload Accountfully Management Report</h2>
                <p className="text-xs text-muted-foreground mt-0.5">AI will extract P&L data and update actuals in the Finance module</p>
              </div>
              <button onClick={() => { setUploadOpen(false); setUploadPreview(null); setUploadError(null); }}
                className="text-muted-foreground hover:text-foreground text-lg">✕</button>
            </div>
            {!uploadPreview && !uploading && (
              <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-8 cursor-pointer hover:bg-muted/30 transition-colors">
                <span className="text-2xl mb-2">📄</span>
                <span className="text-sm font-semibold">Drop PDF here or click to select</span>
                <span className="text-xs text-muted-foreground mt-1">Accountfully management report (PDF)</span>
                <input type="file" accept=".pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfUpload(f); }} />
              </label>
            )}
            {uploading && (
              <div className="rounded-xl bg-muted/40 p-6 text-center text-sm text-muted-foreground">
                <span className="animate-pulse">🤖 AI is reading the PDF and extracting financial data…</span>
              </div>
            )}
            {uploadError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">⚠ {uploadError}</div>
            )}
            {uploadPreview && (
              <>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 font-semibold">
                  ✓ Extracted {uploadPreview.length} month{uploadPreview.length !== 1 ? 's' : ''} of data — review before saving
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs min-w-max">
                    <thead className="bg-muted/30 border-b border-border">
                      <tr>
                        {['Period','Gross Sales','Net Sales','COGS','Storage','Selling','EBITDA'].map(h => (
                          <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadPreview.map((row: any, i: number) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="px-3 py-1.5 font-semibold" style={{color:"#1C2340"}}>{row.period_label}</td>
                          <td className="px-3 py-1.5 font-mono">{row.gross_sales != null ? `$${Number(row.gross_sales).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{row.net_sales != null ? `$${Number(row.net_sales).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{row.cogs != null ? `$${Number(row.cogs).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{row.storage != null ? `$${Number(row.storage).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{row.selling_exp != null ? `$${Number(row.selling_exp).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono font-semibold" style={{color: row.ebitda < 0 ? '#DC2626' : '#16A34A'}}>
                            {row.ebitda != null ? `$${Number(row.ebitda).toFixed(0)}K` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                  ⚠ This will overwrite existing actuals for these months. Review numbers above before confirming.
                </div>
                <div className="flex gap-2">
                  <button onClick={saveActuals} disabled={uploading}
                    className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    style={{backgroundColor:"#A3224A"}}>
                    {uploading ? "Saving…" : `Save ${uploadPreview.length} months of actuals`}
                  </button>
                  <button onClick={() => setUploadPreview(null)}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">Re-upload</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab === t.id ? {borderColor:"#A3224A", color:"#A3224A"} : {}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Period filter — shown on dashboard and pnl */}
      {(tab === "dashboard" || tab === "pnl") && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {(["mtd","qtd","ytd","fy"] as Period[]).map(p => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${period === p ? "text-white shadow-sm" : "text-muted-foreground"}`}
                style={period === p ? {backgroundColor:"#1C2340"} : {}}>
                {p === "fy" ? "FY 2026" : p.toUpperCase()}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Reference month
            <select value={refMonth} onChange={e => setRefMonth(Number(e.target.value))}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none">
              {MONTHS.map((m,i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </label>
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {(["Forecast","Actual"] as const).map(s => (
              <button key={s} onClick={() => setScenario(s)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${scenario===s ? "text-white shadow-sm" : "text-muted-foreground"}`}
                style={scenario===s ? {backgroundColor:"#1C2340"} : {}}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "dashboard" && <DashboardTab period={period} refMonth={refMonth} m={M} realMonths={realMonths} />}
      {tab === "pnl"       && <PNLTab m={M} realMonths={realMonths} actuals={actuals} fyActualOnly={scenario==="Actual"} />}
      {tab === "cashflow"  && <CashFlowTab refMonth={refMonth} m={M} realMonths={realMonths} />}
      {tab === "balance"   && <BalanceTab m={M} realMonths={realMonths} actuals={actuals} />}
      {tab === "runway"    && <RunwayTab />}
      {tab === "ebitda"    && <EBITDATab />}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/finance")({
  component: FinancePage,
  head: () => ({ meta: [{ title: "Finance · BARIS" }] }),
});
