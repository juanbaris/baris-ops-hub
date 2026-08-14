import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInvoicedActuals } from "@/hooks/use-invoiced-actuals";
import { supabase } from "@/integrations/supabase/client";
import { useSalesForecast } from "@/hooks/use-sales-forecast";
import { forecastFromState, type Scenario } from "@/lib/sales-forecast";

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
// Full-precision dollar display (value stored in $K -> shown as exact dollars with 2 decimals),
// used for REAL months in Actual mode so the P&L reads like a copy of the Accountfully PDF.
const fmtExact = (nK: number) => {
  if (nK === null || nK === undefined) return '—';
  const n = nK * 1000;
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
};
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

// ─── Finance-local scenario picker (Pessimistic/Normal/Optimistic) ────────────
// This does NOT touch the shared Sales forecast state/localStorage — it's a
// read-only "what if" lens purely for the Finance P&L, using the same levers
// (velocity, retailers, seasonality, promo) the Sales team already configured.
function useFinanceScenarioForecast(scenarioOverride: Scenario) {
  const { state } = useSalesForecast();
  return useMemo(() => {
    const rows = forecastFromState({ ...state, scenario: scenarioOverride });
    const byMonthKey: Record<string, number> = {}; // "2026-8" -> gross sales $ (not $K)
    for (const r of rows) byMonthKey[`${r.year}-${r.month}`] = r.revenue;
    return byMonthKey;
  }, [state, scenarioOverride]);
}

// ─── July real Gross Sales from Fulfillment (Invoiced pipeline) ──────────────
// Accountfully hasn't closed July yet, but we already know what was invoiced.
function useJulyRealFromFulfillment() {
  const { byLabel, loading } = useInvoicedActuals();
  return useMemo(() => {
    const row = byLabel['Jul 2026'];
    return { julyGrossSales: row ? row.revenue : null, loading };
  }, [byLabel, loading]);
}

// ─── Finance Assumptions (editable forecast drivers, persisted in Supabase) ──
type AssumptionKey =
  | 'cogs_per_unit' | 'logistics_pct_of_gross' | 'deduction_pct_overall'
  | 'deduction_pct_kehe' | 'deduction_pct_unfi' | 'deduction_pct_rainforest'
  | 'sales_mix_kehe' | 'sales_mix_unfi' | 'sales_mix_rainforest';

type Assumption = {
  key: AssumptionKey; label: string; value: number; auto_calculated_value: number | null;
  is_manual_override: boolean; unit: 'currency'|'percent'|'number'; notes: string | null;
};

function useFinanceAssumptions() {
  const [rows, setRows] = useState<Record<string, Assumption>>({});
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase.from("finance_assumptions").select("*");
    if (data) {
      const map: Record<string, Assumption> = {};
      for (const r of data as any[]) map[r.key] = r;
      setRows(map);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function saveOverride(key: AssumptionKey, value: number) {
    await supabase.from("finance_assumptions")
      .update({ value, is_manual_override: true, updated_at: new Date().toISOString() })
      .eq("key", key);
    await load();
  }

  async function resetToAuto(key: AssumptionKey) {
    const row = rows[key];
    if (!row || row.auto_calculated_value == null) return;
    await supabase.from("finance_assumptions")
      .update({ value: row.auto_calculated_value, is_manual_override: false, updated_at: new Date().toISOString() })
      .eq("key", key);
    await load();
  }

  function get(key: AssumptionKey, fallback = 0): number {
    return rows[key]?.value ?? fallback;
  }

  return { rows, loading, get, saveOverride, resetToAuto, reload: load };
}

// ─── Recalculate assumptions from real finance_actuals (call after a new month is loaded) ──
async function recalcAssumptionsFromActuals(actuals: Record<string, any>) {
  const periods = Object.keys(actuals).filter(p => actuals[p]?.pnl_detail).sort();
  if (!periods.length) return;

  let totalCogs = 0, totalUnits = 0, totalGross = 0, totalLogistics = 0, totalDeductions = 0;
  for (const p of periods) {
    const row = actuals[p];
    const d = row.pnl_detail ?? {};
    const gross = Number(d.sales_product ?? 0) + Number(d.shipping_income ?? 0);
    const units = Number(row.units_sold ?? 0);
    const cogs = Math.abs(Number(d.product_costs ?? 0));
    const logistics = Math.abs(Number(d.freight_in ?? 0)) + Math.abs(Number(d.freight_out_actual ?? 0))
      + Math.abs(Number(d.merchant_fees ?? 0)) + Math.abs(Number(d.warehouse_fulfillment ?? 0));
    const deductions = Math.abs(Number(d.consumer_returns ?? 0)) + Math.abs(Number(d.distributor_fees ?? 0))
      + Math.abs(Number(d.dsd_programs ?? 0)) + Math.abs(Number(d.kehe_allowance ?? 0))
      + Math.abs(Number(d.payment_terms ?? 0)) + Math.abs(Number(d.promos ?? 0))
      + Math.abs(Number(d.unfi_allowance ?? 0)) + Math.abs(Number(d.returns_refunds ?? 0));
    totalGross += gross; totalUnits += units; totalCogs += cogs;
    totalLogistics += logistics; totalDeductions += deductions;
  }
  if (totalUnits <= 0 || totalGross <= 0) return;

  const cogsPerUnit = totalCogs / totalUnits;
  const logisticsPct = (totalLogistics / totalGross) * 100;
  const deductionPct = (totalDeductions / totalGross) * 100;

  for (const [key, autoVal] of [
    ['cogs_per_unit', cogsPerUnit],
    ['logistics_pct_of_gross', logisticsPct],
    ['deduction_pct_overall', deductionPct],
  ] as [AssumptionKey, number][]) {
    const { data } = await supabase.from("finance_assumptions").select("is_manual_override").eq("key", key).maybeSingle();
    const patch: any = { auto_calculated_value: autoVal, updated_at: new Date().toISOString() };
    if (!data?.is_manual_override) patch.value = autoVal; // only overwrite the used value if not manually overridden
    await supabase.from("finance_assumptions").update(patch).eq("key", key);
  }
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
function DashboardTab({ period, refMonth, actuals, realMonths, actualOnly }: { period: Period; refMonth: number; actuals: Record<string,any>; realMonths: number; actualOnly: boolean }) {
  const { effectiveForecast } = useSalesForecast();
  const { julyGrossSales } = useJulyRealFromFulfillment();
  const assumptions = useFinanceAssumptions();

  const fcGrossByMonth: Record<number, number> = {};
  for (const f of effectiveForecast) if (f.year === 2026) fcGrossByMonth[f.month-1] = f.revenue/1000;
  if (julyGrossSales != null) fcGrossByMonth[6] = julyGrossSales/1000;

  // Single source of truth: same series as P&L / Balance Sheet / Cash Flow (all in $K).
  const S = useMemo(
    () => buildFinanceForecast(actuals, fcGrossByMonth, assumptions.get),
    [actuals, assumptions.rows, effectiveForecast, julyGrossSales]
  );

  // Month range: Actual = only real P&L months (Jan–Jun); Forecast = full year (Jan–Dec).
  const lastReal = realMonths - 1;
  const effRef = actualOnly ? Math.min(refMonth, Math.max(0,lastReal)) : refMonth;

  // Sum a P&L line ($K) over the active window (mtd/qtd/ytd/fy), only across months that have a P&L.
  function slice(sel: (mm: MonthFin) => number|null): number {
    const upto = actualOnly ? lastReal : 11;
    let from = 0, to = upto;
    if (period === 'mtd') { from = effRef; to = effRef; }
    else if (period === 'qtd') { const q = Math.floor(effRef/3); from = q*3; to = Math.min(q*3+2, upto); }
    else if (period === 'ytd') { to = Math.min(effRef, upto); }
    // fy → 0..upto
    let acc = 0;
    for (let i = from; i <= to; i++) { const v = sel(S[i]); if (v != null) acc += v; }
    return acc;
  }

  const rev = slice(mm => mm.grossSales);
  const budgetRev = actualOnly ? sum(BUDGET.gross_sales, 0, realMonths) : sum(BUDGET.gross_sales, 0, 12);
  const netRev = slice(mm => mm.netSales);
  const gp = slice(mm => mm.grossMargin);
  const gmPct = netRev ? gp / netRev : 0;
  const ebitda = slice(mm => mm.ebitda);
  const ni = slice(mm => mm.netIncome);
  const bc = gp; // business contribution ≈ gross margin (selling/mkt split not needed at KPI level)
  // Cash at the reference month (real if present, else forecast)
  const cash = S[effRef]?.cash ?? 0;
  const avgBurn = ([effRef-2,effRef-1,effRef].map(i=>S[Math.max(0,i)]?.netIncome ?? 0).reduce((a,b)=>a+b,0))/3;
  const runway = avgBurn < 0 ? cash / Math.abs(avgBurn) : 99;
  const wc = (S[effRef]?.ar ?? 0) + (S[effRef]?.inventory ?? 0) - ((S[effRef]?.creditCards ?? 0)+(S[effRef]?.accrued ?? 0));
  const vsB = rev - budgetRev;
  const vsBpct = budgetRev ? vsB / budgetRev : 0;

  // Charts
  const revCanvas = useRef<HTMLCanvasElement>(null);
  const gmCanvas = useRef<HTMLCanvasElement>(null);
  const cashCanvas = useRef<HTMLCanvasElement>(null);
  const waterfallCanvas = useRef<HTMLCanvasElement>(null);

  const grossArr = S.map(mm => mm.grossSales);
  const firstFc = S.findIndex(x=>x.isForecast);

  useChart(revCanvas, () => ({
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Budget', data: BUDGET.gross_sales, backgroundColor: 'rgba(180,180,180,0.4)', borderRadius: 3, order: 3 },
        { label: 'Real', data: grossArr.map((v,i) => S[i].isPnlReal ? v : null), type: 'line', borderColor: '#10B981', backgroundColor: 'transparent', tension: 0.3, pointRadius: 4, order: 1, spanGaps:true },
        { label: 'Forecast', data: grossArr.map((v,i) => (S[i].isForecast || (firstFc>0 && i===firstFc-1)) ? v : null), type: 'line', borderColor: '#A3224A', backgroundColor: 'transparent', tension: 0.3, order: 2, borderDash: [4,3], spanGaps:true, pointRadius: grossArr.map((_,i)=>S[i].isForecast?4:0) },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } }, scales:{ y:{ ticks:{ callback:(v:number) => '$'+v+'K' } } } }
  }), [S]);

  useChart(gmCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [{
        label: 'GM %',
        data: S.map(mm => mm.netSales && mm.grossMargin!=null ? +((mm.grossMargin/mm.netSales)*100).toFixed(1) : null),
        borderColor: '#A3224A', backgroundColor: 'rgba(163,34,74,0.08)',
        tension: 0.4, fill: true, pointRadius: 4, spanGaps:true,
      }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ callback:(v:number) => v+'%' } } } }
  }), [S]);

  useChart(cashCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Real', data: S.map((mm,i) => mm.isBsReal ? mm.cash : null),
          borderColor: '#1C2340', backgroundColor: 'rgba(28,35,64,0.1)',
          tension: 0.3, fill: true, pointRadius: 5, spanGaps: true },
        { label: 'Forecast', data: S.map((mm,i) => {
            if (mm.isForecast) return mm.cash;
            if (firstFc > 0 && i === firstFc - 1) return mm.cash; // bridge point
            return null;
          }),
          borderColor: '#A3224A', backgroundColor: 'rgba(163,34,74,0.08)',
          borderDash: [4,3], tension: 0.3, fill: true, spanGaps: true,
          pointRadius: S.map(mm => mm.isForecast ? 4 : 0) },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } }, scales:{ y:{ ticks:{ callback:(v:number) => '$'+v+'K' } } } }
  }), [S]);

  // Waterfall totals (respect Actual/Forecast range)
  const wfLabels = ['Gross Sales','Ded.','Net Sales','COGS','GM','SG&A','EBITDA'];
  const gs = slice(mm=>mm.grossSales); const ded = slice(mm=>mm.deductions); const ns = slice(mm=>mm.netSales);
  const cogs = slice(mm=>mm.cogsTotal); const gm = slice(mm=>mm.grossMargin);
  const sga = slice(mm=>mm.sga); const eb = slice(mm=>mm.ebitda);
  const wfData = [gs, ded, ns, cogs, gm, sga, eb];
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
        <KPI icon="🧾" label="Net Sales" value={fmtK(netRev)}
          sub={actualOnly ? `Jan–${MONTHS[realMonths-1]} actual` : `FY 2026 forecast`} />
        <KPI icon="📊" label="Gross Margin %" value={fmtPct(gmPct)}
          sub={`${fmtK(gp)} abs`} />
        <KPI icon="🎯" label="Business Contribution" value={fmtK(bc)}
          sub={`${rev ? (bc/rev*100).toFixed(1) : 0}% of Gross`} />
        <KPI icon="📉" label="EBITDA" value={fmtK(ebitda)}
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

// Forecast context for months without a real Accountfully close: grossSales/unitsSold
// come from the Sales-forecast scenario (or, for July, from Fulfillment invoiced data),
// and cost lines are derived from the editable assumptions (COGS/unit, %logistics, %deductions).
type ForecastContext = {
  grossSales: number;     // $K for this month
  unitsSold: number;      // cases for this month
  cogsPerUnit: number;    // $/case
  logisticsPct: number;   // 0-1, of gross sales
  deductionPct: number;   // 0-1, of gross sales (blended)
  fixedCostsK: Record<string, number>; // $K, keyed by PLRow id, from Best Estimate
};

interface PLRow {
  id: string; parentId?: string; label: string; kind: PLRowKind;
  actualKey?: string;                                  // key in pnl_detail JSONB
  forecastFn?: (ctx: ForecastContext) => number;        // for forecast (non-actual) months, in $K
  indent: 0|1|2|3;
  bold?: boolean; italic?: boolean; isNeg?: boolean;
}

// Full P&L tree matching Accountfully exactly
const PL_ROWS: PLRow[] = [
  {id:"units_sold",label:"Units Sold (cases)",kind:"pct",indent:0,italic:true},
  {id:"s-income",label:"INCOME",kind:"section",indent:0},
  {id:"g-4000",label:"4000 · Sales",kind:"group",indent:0},
    {id:"sales_product",parentId:"g-4000",label:"Sales of Product Income",kind:"item",indent:1,actualKey:"sales_product",forecastFn:(c)=>c.grossSales},
    {id:"shipping_income",parentId:"g-4000",label:"Shipping Income",kind:"item",indent:1,actualKey:"shipping_income",forecastFn:()=>0},
    {id:"t-4000",parentId:"g-4000",label:"Total 4000 Sales",kind:"total",indent:1,forecastFn:(c)=>c.grossSales},
  {id:"g-4500",label:"4500 · Deductions to Income",kind:"group",indent:0},
    {id:"g-disc",parentId:"g-4500",label:"Discounts",kind:"group",indent:1},
      {id:"consumer_returns",parentId:"g-disc",label:"Consumer Returns",kind:"item",indent:2,actualKey:"consumer_returns",forecastFn:()=>0},
      {id:"distributor_fees",parentId:"g-disc",label:"Distributor Fees",kind:"item",indent:2,actualKey:"distributor_fees",forecastFn:(c)=>-c.grossSales*c.deductionPct*0.10},
      {id:"dsd_programs",parentId:"g-disc",label:"DSD Programs",kind:"item",indent:2,actualKey:"dsd_programs",forecastFn:(c)=>-c.grossSales*c.deductionPct*0.16},
      {id:"kehe_allowance",parentId:"g-disc",label:"KeHE Allowance",kind:"item",indent:2,actualKey:"kehe_allowance",forecastFn:(c)=>-c.grossSales*c.deductionPct*0.05},
      {id:"payment_terms",parentId:"g-disc",label:"Payment Terms",kind:"item",indent:2,actualKey:"payment_terms",forecastFn:(c)=>-c.grossSales*c.deductionPct*0.04},
      {id:"promos",parentId:"g-disc",label:"Promos",kind:"item",indent:2,actualKey:"promos",forecastFn:(c)=>-c.grossSales*c.deductionPct*0.60},
      {id:"unfi_allowance",parentId:"g-disc",label:"UNFI Allowance",kind:"item",indent:2,actualKey:"unfi_allowance",forecastFn:(c)=>-c.grossSales*c.deductionPct*0.05},
      {id:"t-disc",parentId:"g-disc",label:"Total Discounts",kind:"total",indent:2},
    {id:"returns_refunds",parentId:"g-4500",label:"Returns / Refunds",kind:"item",indent:1,actualKey:"returns_refunds",forecastFn:()=>0},
    {id:"t-4500",parentId:"g-4500",label:"Total Deductions to Income",kind:"total",indent:1,forecastFn:(c)=>-c.grossSales*c.deductionPct},
  {id:"t-income",label:"Total Income",kind:"total",indent:0,bold:true},

  {id:"s-cogs",label:"COST OF GOODS SOLD",kind:"section",indent:0},
  {id:"g-5000",label:"5000 · Cost of goods sold",kind:"group",indent:0},
    {id:"product_costs",parentId:"g-5000",label:"Product Costs",kind:"item",indent:1,actualKey:"product_costs",forecastFn:(c)=>-(c.unitsSold*c.cogsPerUnit)/1000},
    {id:"t-5000",parentId:"g-5000",label:"Total 5000",kind:"total",indent:1,forecastFn:(c)=>-(c.unitsSold*c.cogsPerUnit)/1000},
  {id:"g-6000",label:"6000 · Logistics & Fulfillment",kind:"group",indent:0},
    {id:"freight_in",parentId:"g-6000",label:"Freight In",kind:"item",indent:1,actualKey:"freight_in",forecastFn:(c)=>-c.grossSales*c.logisticsPct*0.22},
    {id:"freight_out_actual",parentId:"g-6000",label:"Freight Out",kind:"item",indent:1,actualKey:"freight_out_actual",forecastFn:(c)=>-c.grossSales*c.logisticsPct*0.06},
    {id:"merchant_fees",parentId:"g-6000",label:"Merchant Account Fees",kind:"item",indent:1,actualKey:"merchant_fees",forecastFn:()=>0},
    {id:"warehouse_fulfillment",parentId:"g-6000",label:"Warehouse / Fulfillment",kind:"item",indent:1,actualKey:"warehouse_fulfillment",forecastFn:(c)=>-c.grossSales*c.logisticsPct*0.72},
    {id:"t-6000",parentId:"g-6000",label:"Total 6000 Logistics",kind:"total",indent:1,forecastFn:(c)=>-c.grossSales*c.logisticsPct},
  {id:"t-cogs",label:"Total Cost of Goods Sold",kind:"total",indent:0,bold:true},

  {id:"t-gp",label:"GROSS PROFIT",kind:"total",indent:0,bold:true},
  {id:"t-gp-pct",label:"Gross Margin %",kind:"pct",indent:0},

  {id:"s-exp",label:"EXPENSES",kind:"section",indent:0},
  {id:"g-6500",label:"6500 · Selling Expenses",kind:"group",indent:0},
    {id:"broker_commissions",parentId:"g-6500",label:"Broker Commissions & Fees",kind:"item",indent:1,actualKey:"broker_commissions",forecastFn:(c)=>c.fixedCostsK.broker_commissions ?? 0},
    {id:"slotting_fees",parentId:"g-6500",label:"Slotting Fees",kind:"item",indent:1,actualKey:"slotting_fees",forecastFn:(c)=>c.fixedCostsK.slotting_fees ?? 0},
    {id:"t-6500",parentId:"g-6500",label:"Total 6500 Selling Expenses",kind:"total",indent:1},
  {id:"g-7000",label:"7000 · Marketing & Trade",kind:"group",indent:0},
    {id:"demos_merchandising",parentId:"g-7000",label:"Demos & Merchandising",kind:"item",indent:1,actualKey:"demos_merchandising",forecastFn:(c)=>c.fixedCostsK.demos_merchandising ?? 0},
    {id:"digital_social",parentId:"g-7000",label:"Digital & Social Media",kind:"item",indent:1,actualKey:"digital_social",forecastFn:(c)=>c.fixedCostsK.digital_social ?? 0},
    {id:"events_tradeshows",parentId:"g-7000",label:"Events / Trade Shows",kind:"item",indent:1,actualKey:"events_tradeshows",forecastFn:(c)=>c.fixedCostsK.events_tradeshows ?? 0},
    {id:"printing_promotional",parentId:"g-7000",label:"Printing & Promotional",kind:"item",indent:1,actualKey:"printing_promotional",forecastFn:()=>0},
    {id:"product_samples",parentId:"g-7000",label:"Product Samples",kind:"item",indent:1,actualKey:"product_samples",forecastFn:(c)=>c.fixedCostsK.product_samples ?? 0},
    {id:"t-7000",parentId:"g-7000",label:"Total 7000 Marketing",kind:"total",indent:1},
  {id:"g-8000",label:"8000 · General & Administrative",kind:"group",indent:0},
    {id:"bank_charges",parentId:"g-8000",label:"Bank Charges & Fees",kind:"item",indent:1,actualKey:"bank_charges",forecastFn:()=>0},
    {id:"dues_subscriptions",parentId:"g-8000",label:"Dues & Subscriptions",kind:"item",indent:1,actualKey:"dues_subscriptions",forecastFn:(c)=>c.fixedCostsK.dues_subscriptions ?? -1.37},
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
      {id:"t-payroll",parentId:"g-payroll",label:"Total Payroll & Employee Related",kind:"total",indent:2},
    {id:"g-profsvcs",parentId:"g-8000",label:"Professional Services",kind:"group",indent:1},
      {id:"accounting_finance",parentId:"g-profsvcs",label:"Accounting & Finance",kind:"item",indent:2,actualKey:"accounting_finance",forecastFn:()=>-1.3},
      {id:"business_consultation",parentId:"g-profsvcs",label:"Business Consultation",kind:"item",indent:2,actualKey:"business_consultation",forecastFn:()=>0},
      {id:"legal_fees",parentId:"g-profsvcs",label:"Legal Fees",kind:"item",indent:2,actualKey:"legal_fees",forecastFn:()=>0},
      {id:"t-profsvcs",parentId:"g-profsvcs",label:"Total Professional Services",kind:"total",indent:2},
    {id:"quality_rd",parentId:"g-8000",label:"Quality and R&D",kind:"item",indent:1,actualKey:"quality_rd",forecastFn:(c)=>c.fixedCostsK.quality_rd ?? -0.42},
    {id:"taxes_licenses",parentId:"g-8000",label:"Taxes & Licenses",kind:"item",indent:1,actualKey:"taxes_licenses",forecastFn:()=>0},
    {id:"g-travel",parentId:"g-8000",label:"Travel",kind:"group",indent:1},
      {id:"car_rental_uber",parentId:"g-travel",label:"Car Rental / Uber",kind:"item",indent:2,actualKey:"car_rental_uber",forecastFn:()=>0},
      {id:"flights",parentId:"g-travel",label:"Flights",kind:"item",indent:2,actualKey:"flights",forecastFn:()=>0},
      {id:"hotel",parentId:"g-travel",label:"Hotel",kind:"item",indent:2,actualKey:"hotel",forecastFn:()=>0},
      {id:"t-travel",parentId:"g-travel",label:"Total Travel",kind:"total",indent:2},
    {id:"uncategorized",parentId:"g-8000",label:"Uncategorized Expense",kind:"item",indent:1,actualKey:"uncategorized",forecastFn:()=>0},
    {id:"vehicle_expenses",parentId:"g-8000",label:"Vehicle Expenses",kind:"item",indent:1,actualKey:"vehicle_expenses",forecastFn:()=>0},
    {id:"t-8000",parentId:"g-8000",label:"Total 8000 General & Administrative",kind:"total",indent:1},
  {id:"t-expenses",label:"Total Expenses",kind:"total",indent:0,bold:true},

  {id:"t-noi",label:"NET OPERATING INCOME",kind:"total",indent:0,bold:true},

  {id:"s-other",label:"OTHER INCOME",kind:"section",indent:0},
  {id:"g-9000",label:"9000 · Other Income",kind:"group",indent:0},
    {id:"other_income",parentId:"g-9000",label:"9000 Other Income",kind:"item",indent:1,actualKey:"other_income",forecastFn:()=>0},
    {id:"t-9000",parentId:"g-9000",label:"Total Other Income",kind:"total",indent:1,forecastFn:()=>0},

  {id:"t-netincome",label:"NET INCOME",kind:"total",indent:0,bold:true},
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
function PNLTab({ realMonths, actuals, actualOnly }: { realMonths: number; actuals: Record<string, any>; actualOnly: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(["g-disc","g-facility","g-payroll","g-profsvcs","g-travel"])
  );
  const [scenario, setScenario] = useState<Scenario>("Normal");
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const childMap = useMemo(() => buildChildMap(PL_ROWS), []);

  const scenarioForecast = useFinanceScenarioForecast(scenario); // "2026-8" -> $ (not $K)
  const { julyGrossSales } = useJulyRealFromFulfillment();       // $ (not $K), or null
  const assumptions = useFinanceAssumptions();

  const isRealIdx = (idx: number) => actuals[PERIODS[idx]]?.pnl_detail != null;
  // In "Actual" mode show only real months; in "Forecast" mode show all 12.
  const visibleMonthIdx = MONTHS.map((_, i) => i).filter(i => actualOnly ? isRealIdx(i) : true);

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

  // ── Build the forecast context for a given month index (0=Jan..11=Dec) ──
  function buildContext(idx: number): ForecastContext {
    const monthNum = idx + 1;
    const cogsPerUnit = assumptions.get('cogs_per_unit', 22.27);
    const logisticsPct = assumptions.get('logistics_pct_of_gross', 9.8) / 100;
    const deductionPct = assumptions.get('deduction_pct_overall', 19.78) / 100;

    let grossSalesK: number;
    if (idx === 6) {
      // July: real invoiced $ from Fulfillment, if available; else fall back to scenario forecast (unlikely to hit, Aug+ only)
      grossSalesK = julyGrossSales != null ? julyGrossSales / 1000 : (scenarioForecast[`2026-7`] ?? 0) / 1000;
    } else {
      grossSalesK = (scenarioForecast[`2026-${monthNum}`] ?? 0) / 1000;
    }
    const unitsSold = grossSalesK > 0 ? Math.round((grossSalesK * 1000) / 37) : 0; // 37 = PRICE_PER_CASE

    return {
      grossSales: grossSalesK,
      unitsSold,
      cogsPerUnit,
      logisticsPct,
      deductionPct,
      fixedCostsK: FIXED_COSTS_BEST_ESTIMATE[monthNum] ?? {},
    };
  }

  // Get value for a cell (month idx), in $K
  function getValue(row: PLRow, idx: number): number | null {
    if (row.kind === "section") return null;
    if (row.id === "units_sold") {
      const period = PERIODS[idx];
      const actualUnits = actuals[period]?.units_sold;
      if (actualUnits != null) return Number(actualUnits);
      return buildContext(idx).unitsSold;
    }
    const period = PERIODS[idx];
    const isActual = !!actuals[period]?.pnl_detail;
    const ctx = isActual ? null : buildContext(idx);

    // Special case: NET INCOME = NOI + Other Income
    if (row.id === "t-netincome") {
      const noi = getValue(PL_ROWS.find(r => r.id === "t-noi")!, idx) ?? 0;
      const otherInc = isActual
        ? (actuals[period].pnl_detail.other_income != null ? Number(actuals[period].pnl_detail.other_income) / 1000 : 0)
        : 0;
      return noi + otherInc;
    }
    // Special case: NET OPERATING INCOME = GROSS PROFIT + Total Expenses
    if (row.id === "t-noi") {
      const gp = getValue(PL_ROWS.find(r => r.id === "t-gp")!, idx) ?? 0;
      const exp = getValue(PL_ROWS.find(r => r.id === "t-expenses")!, idx) ?? 0;
      return gp + exp;
    }
    // Special case: GROSS PROFIT = Total Income + Total COGS
    if (row.id === "t-gp") {
      const inc = getValue(PL_ROWS.find(r => r.id === "t-income")!, idx) ?? 0;
      const cogs = getValue(PL_ROWS.find(r => r.id === "t-cogs")!, idx) ?? 0;
      return inc + cogs;
    }
    // Special case: Total Income = Total 4000 Sales + Total 4500 Deductions
    if (row.id === "t-income") {
      const s4000 = getValue(PL_ROWS.find(r => r.id === "t-4000")!, idx) ?? 0;
      const s4500 = getValue(PL_ROWS.find(r => r.id === "t-4500")!, idx) ?? 0;
      return s4000 + s4500;
    }
    // Special case: Total COGS = Total 5000 + Total 6000
    if (row.id === "t-cogs") {
      const s5000 = getValue(PL_ROWS.find(r => r.id === "t-5000")!, idx) ?? 0;
      const s6000 = getValue(PL_ROWS.find(r => r.id === "t-6000")!, idx) ?? 0;
      return s5000 + s6000;
    }
    // Special case: Total Expenses = 6500 + 7000 + 8000
    if (row.id === "t-expenses") {
      const s6500 = getValue(PL_ROWS.find(r => r.id === "t-6500")!, idx) ?? 0;
      const s7000 = getValue(PL_ROWS.find(r => r.id === "t-7000")!, idx) ?? 0;
      const s8000 = getValue(PL_ROWS.find(r => r.id === "t-8000")!, idx) ?? 0;
      return s6500 + s7000 + s8000;
    }
    // Special case: Total 8000 = its item/group children (payroll/profsvcs/travel/facility totals + loose items)
    if (row.id === "t-8000") {
      const children = (childMap["g-8000"] || []).map(cid => PL_ROWS.find(r => r.id === cid)!).filter(Boolean).filter(c => c.id !== "t-8000");
      return children.reduce((s, c) => s + (getValue(c, idx) ?? 0), 0);
    }

    // Group-level subtotals: their siblings hang off the GROUP id, not the total id.
    // Sum the group's non-total children directly.
    const groupSubtotalMap: Record<string, string> = {
      "t-4000": "g-4000", "t-disc": "g-disc", "t-4500": "g-4500",
      "t-5000": "g-5000", "t-6000": "g-6000",
      "t-6500": "g-6500", "t-7000": "g-7000",
      "t-facility": "g-facility", "t-payroll": "g-payroll",
      "t-profsvcs": "g-profsvcs", "t-travel": "g-travel",
      "t-9000": "g-9000",
    };
    if (groupSubtotalMap[row.id]) {
      const gid = groupSubtotalMap[row.id];
      const children = (childMap[gid] || [])
        .map(cid => PL_ROWS.find(r => r.id === cid)!)
        .filter(Boolean)
        .filter(c => c.kind !== "total" && c.id !== row.id);
      return children.reduce((s, c) => s + (getValue(c, idx) ?? 0), 0);
    }

    if (row.kind === "pct") {
      if (row.id === "t-gp-pct") {
        const ns = getValue(PL_ROWS.find(r => r.id === "t-income")!, idx) ?? 1;
        const gp = getValue(PL_ROWS.find(r => r.id === "t-gp")!, idx) ?? 0;
        return ns !== 0 ? gp / ns : 0;
      }
      return null;
    }

    if (row.kind === "total") {
      const children = (childMap[row.id] || [])
        .map(cid => PL_ROWS.find(r => r.id === cid)!)
        .filter(Boolean)
        .filter(c => c.kind !== "total");
      if (children.length > 0) {
        return children.reduce((s, c) => s + (getValue(c, idx) ?? 0), 0);
      }
      if (!isActual && ctx && row.forecastFn) return row.forecastFn(ctx);
      return null;
    }

    if (row.kind === "group") {
      const children = (childMap[row.id] || [])
        .map(cid => PL_ROWS.find(r => r.id === cid)!)
        .filter(Boolean)
        .filter(c => c.kind !== "total");
      if (children.length > 0) {
        return children.reduce((s, c) => s + (getValue(c, idx) ?? 0), 0);
      }
      if (!isActual && ctx && row.forecastFn) return row.forecastFn(ctx);
      return null;
    }

    if (row.kind === "item") {
      if (isActual && row.actualKey) {
        const val = actuals[period].pnl_detail[row.actualKey];
        return val != null ? Number(val) / 1000 : 0; // convert to $K
      }
      if (ctx && row.forecastFn) return row.forecastFn(ctx);
      return 0;
    }
    return null;
  }

  // % this row represents of its parent group/total (shown small, inside the header cell)
  function pctOfParent(row: PLRow, idx: number): string | null {
    if (!row.parentId) return null;
    const parent = PL_ROWS.find(r => r.id === row.parentId);
    if (!parent) return null;
    const parentVal = getValue(parent, idx);
    const val = getValue(row, idx);
    if (!parentVal || val == null) return null;
    return `${(Math.abs(val) / Math.abs(parentVal) * 100).toFixed(0)}%`;
  }

  const gsRow = PL_ROWS.find(r => r.id === "t-4000")!;
  const gsFY = sum(visibleMonthIdx.map(i => getValue(gsRow, i) ?? 0));
  const indentPx = [0,16,28,40];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"/>
          Actual = Accountfully
        </span>
        <span className="opacity-60">F = forecast (scenario + assumptions below)</span>
        <div className="flex items-center gap-1 ml-2">
          <span className="text-[10px] uppercase tracking-wide">Scenario:</span>
          {(["Pessimistic","Normal","Optimistic"] as Scenario[]).map(s => (
            <button key={s} onClick={() => setScenario(s)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${scenario===s ? "border-[#1C2340] bg-[#1C2340] text-white" : "border-border hover:bg-muted"}`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => setAssumptionsOpen(true)}
          className="rounded-full border border-border px-2 py-0.5 hover:bg-muted flex items-center gap-1">
          ⚙️ Assumptions
        </button>
        <span className="flex-1" />
        <button onClick={() => setCollapsed(new Set())} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Expand all</button>
        <button onClick={() => setCollapsed(new Set(PL_ROWS.filter(r=>r.kind==="group").map(r=>r.id)))} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Collapse all</button>
      </div>

      {assumptionsOpen && (
        <AssumptionsModal assumptions={assumptions} onClose={() => setAssumptionsOpen(false)} />
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-52 min-w-[200px]">Line</th>
              {visibleMonthIdx.map((i) => (
                <th key={MONTHS[i]} className="text-right px-2 py-2.5 text-[10px] uppercase tracking-wide w-12"
                  style={{color: isRealIdx(i) ? "#1C2340" : "#9CA3AF"}}>
                  {MONTHS[i]}
                  <div className="text-[8px] flex items-center justify-end gap-0.5">
                    {isRealIdx(i) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 inline-block"/>}
                    {isRealIdx(i) ? "A" : i === 6 ? "Real GS" : "F"}
                  </div>
                </th>
              ))}
              <th className="text-right px-2 py-2.5 text-[10px] uppercase text-muted-foreground w-14">{actualOnly ? "YTD" : "FY"}</th>
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
              if (row.id === "units_sold") {
                const vals = visibleMonthIdx.map((i) => getValue(row, i));
                const fyUnits = vals.reduce((s,v)=>(s??0)+(v??0),0)!;
                return (
                  <tr key={row.id} className="border-t border-border/40 bg-muted/5 italic">
                    <td className="px-4 py-1.5 text-muted-foreground" style={{paddingLeft: 16}}>
                      <span className="flex items-center gap-1.5"><span className="w-4"/>{row.label}</span>
                    </td>
                    {vals.map((v, k) => (
                      <td key={k} className="text-right px-2 py-1.5 font-mono tabular-nums text-muted-foreground">
                        {v ? Math.round(v).toLocaleString() : "—"}
                      </td>
                    ))}
                    <td className="text-right px-2 py-1.5 font-mono font-semibold tabular-nums text-muted-foreground">
                      {fyUnits ? Math.round(fyUnits).toLocaleString() : "—"}
                    </td>
                    <td className="text-right px-2 py-1.5 text-muted-foreground text-[10px]">—</td>
                  </tr>
                );
              }

              const hasChildren = (childMap[row.id] || []).length > 0;
              const isExp = hasChildren && row.kind === "group";
              const isOpen = !collapsed.has(row.id);
              const isTotal = row.kind === "total" || row.kind === "pct";
              const vals = visibleMonthIdx.map((i) => getValue(row, i));
              const fy = row.kind === "pct" ? (vals.reduce((s,v)=>(s??0)+(v??0),0)!/(vals.length||1)) : vals.reduce((s,v)=>(s??0)+(v??0),0)!;
              // %GS: this row's YTD/FY ÷ Total Sales YTD/FY over the SAME visible months (same scale).
              const gsDenom = visibleMonthIdx.reduce((s,i) => s + (getValue(gsRow, i) ?? 0), 0);
              const pctGS = (gsDenom && row.kind !== "pct" && row.id !== "units_sold")
                ? `${(fy!/gsDenom*100).toFixed(1)}%` : "—";
              const pctParent = pctOfParent(row, visibleMonthIdx[visibleMonthIdx.length-1] ?? 11);

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
                      {row.indent > 0 && row.kind === "item" && pctParent && (
                        <span className="text-[8px] text-muted-foreground/70 font-mono">({pctParent})</span>
                      )}
                    </span>
                  </td>
                  {vals.map((v, k) => {
                    const i = visibleMonthIdx[k];
                    return (
                    <td key={k} className={`text-right px-2 py-1.5 font-mono tabular-nums`}
                      style={{
                        color: row.kind==="pct" ? "#1C2340"
                          : (v??0)<0 ? "#EF4444"
                          : isTotal && (v??0)>0 ? "#10B981"
                          : !isRealIdx(i) ? "#9CA3AF"
                          : "#1C2340"
                      }}>
                      {row.kind==="pct" ? fmtPct(v??0)
                        : (v==null || v===0) ? "—"
                        : (actualOnly && isRealIdx(i)) ? fmtExact(v)
                        : fmt(v,0)}
                    </td>
                    );
                  })}
                  <td className="text-right px-2 py-1.5 font-mono font-semibold tabular-nums"
                    style={{color: row.kind==="pct" ? "#1C2340" : (fy??0)<0 ? "#EF4444" : "#10B981"}}>
                    {row.kind==="pct" ? fmtPct(fy??0) : (!fy || fy===0) ? "—" : (actualOnly ? fmtExact(fy) : fmt(fy,0))}
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

// ─── Best Estimate fixed-cost lines that don't scale with sales (unchanged from budget) ──
// $K per month-number (1=Jan..12=Dec), used for forecast months only.
const FIXED_COSTS_BEST_ESTIMATE: Record<number, Record<string, number>> = {
  7:  { broker_commissions:-10, slotting_fees:-0.37, demos_merchandising:-4.5, digital_social:-5, events_tradeshows:0, product_samples:-1.16, dues_subscriptions:-1.37, quality_rd:-1.62 },
  8:  { broker_commissions:-10, slotting_fees:-0.37, demos_merchandising:0,   digital_social:-5, events_tradeshows:0, product_samples:-1.16, dues_subscriptions:-1.37, quality_rd:-0.42 },
  9:  { broker_commissions:-10, slotting_fees:-0.74, demos_merchandising:0,   digital_social:-5, events_tradeshows:0, product_samples:-1.16, dues_subscriptions:-1.37, quality_rd:-0.42 },
  10: { broker_commissions:-10, slotting_fees:-0.37, demos_merchandising:0,   digital_social:-5, events_tradeshows:-4, product_samples:-1.16, dues_subscriptions:-1.37, quality_rd:-1.62 },
  11: { broker_commissions:-10, slotting_fees:-0.37, demos_merchandising:0,   digital_social:-5, events_tradeshows:0, product_samples:-1.16, dues_subscriptions:-1.37, quality_rd:-0.42 },
  12: { broker_commissions:-10, slotting_fees:0,      demos_merchandising:0,   digital_social:-5, events_tradeshows:0, product_samples:-1.16, dues_subscriptions:-1.37, quality_rd:-0.42 },
};

// Total fixed SG&A (payroll, rent, insurance, travel, etc.) not covered by FIXED_COSTS_BEST_ESTIMATE
// overrides above — these are constant month to month per the Best Estimate.
const FIXED_SGA_CONSTANT_K = -0.558-0.32-0.97-2.56-0.061-1.15285-15.07-1.3; // rent+utilities+insurance+contractors+payroll_processing+payroll_taxes+salaries+accounting

// Pure function: given a forecast context, compute this month's Net Income in $K.
// Mirrors PNLTab's getValue logic exactly, so Balance Sheet cash roll-forward stays consistent with the P&L.
function computeMonthlyNetIncome(ctx: ForecastContext): number {
  const grossProfit = ctx.grossSales
    - ctx.grossSales * ctx.deductionPct
    - (ctx.unitsSold * ctx.cogsPerUnit) / 1000
    - ctx.grossSales * ctx.logisticsPct;
  const scalingSGA = (ctx.fixedCostsK.broker_commissions ?? -10) + (ctx.fixedCostsK.slotting_fees ?? 0)
    + (ctx.fixedCostsK.demos_merchandising ?? 0) + (ctx.fixedCostsK.digital_social ?? -5)
    + (ctx.fixedCostsK.events_tradeshows ?? 0) + (ctx.fixedCostsK.product_samples ?? -1.16)
    + (ctx.fixedCostsK.dues_subscriptions ?? -1.37) + (ctx.fixedCostsK.quality_rd ?? -0.42);
  const noi = grossProfit + scalingSGA + FIXED_SGA_CONSTANT_K;
  return noi; // other_income assumed 0 for forecast months (matches PNLTab default)
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE SOURCE OF TRUTH for the monthly financial series (Jan–Dec).
// Both the Balance Sheet and the Cash Flow read from this, so they can never diverge.
// For each month it returns: netIncome, AR, finishedGoods, rawMaterials, inventory,
// creditCards, accrued, cash, and the equity/asset components — REAL where Accountfully
// data exists, FORECAST (rolled forward from the last real close) otherwise.
// ═══════════════════════════════════════════════════════════════════════════════
type MonthFin = {
  isPnlReal: boolean; isBsReal: boolean; isForecast: boolean;
  netIncome: number|null;          // $K, from P&L (real) or modeled (forecast)
  ar: number|null; fg: number|null; rm: number|null; inventory: number|null;
  cash: number|null; creditCards: number|null; accrued: number|null;
  loansSh: number; fixed: number; dueSh: number;
  capital: number; common: number; openEq: number; retEarn: number; netIncEq: number|null;
  totalAssets: number|null; totalLiab: number|null; totalEquity: number|null;
  // P&L lines ($K) — real from pnl_detail, else forecast. null before there's any P&L for the month.
  grossSales: number|null; deductions: number|null; netSales: number|null;
  cogsTotal: number|null; grossMargin: number|null; sga: number|null; ebitda: number|null;
  hasPnl: boolean;
};

function buildFinanceForecast(
  actuals: Record<string, any>,
  fcGrossByMonth: Record<number, number>,
  get: (k: any, d?: number) => number,
): MonthFin[] {
  const bsAt = (i: number) => actuals[PERIODS[i]]?.bs_detail as Record<string,number> | undefined;
  const pnlAt = (i: number) => actuals[PERIODS[i]]?.pnl_detail as Record<string,number> | undefined;
  const bankKeys = ['bofa_x6854','citi_bank','mercury_checking','mercury_treasury'];
  const ccKeys = ['boa_3724','boa_7830','boa_8781','citi_credit','mercury_credit'];

  const dedPct = get('deduction_pct_overall', 19.78) / 100;
  const netOf = (gsK: number) => gsK * (1 - dedPct);
  const mixKU = (get('sales_mix_kehe', 50.5) + get('sales_mix_unfi', 27.1)) / 100;
  const mixRF = get('sales_mix_rainforest', 22.3) / 100;
  const cogsPerCaseK = get('cogs_per_unit', 22.27) / 1000;

  const latestBsIdx = (() => { let m=-1; for (let i=0;i<12;i++) if (bsAt(i)) m=i; return m; })();
  const latestPnlIdx = (() => { let m=-1; for (let i=0;i<12;i++) if (pnlAt(i)) m=i; return m; })();

  // Gross sales ($K) for a month: real P&L if present, else forecast.
  const grossK = (i: number) => {
    const d = pnlAt(i);
    if (d) return (Number(d.sales_product ?? 0) + Number(d.shipping_income ?? 0)) / 1000;
    return fcGrossByMonth[i] ?? 0;
  };
  const netIncomeReal = (i: number): number|null => {
    const d = pnlAt(i); if (!d) return null;
    const inc = ['sales_product','shipping_income','consumer_returns','distributor_fees','dsd_programs','kehe_allowance','payment_terms','promos','unfi_allowance','returns_refunds'].reduce((s,k)=>s+Number(d[k] ?? 0),0);
    const cogs = ['product_costs','freight_in','freight_out_actual','merchant_fees','warehouse_fulfillment'].reduce((s,k)=>s+Number(d[k] ?? 0),0);
    const exp = ['broker_commissions','slotting_fees','demos_merchandising','digital_social','events_tradeshows','printing_promotional','product_samples','bank_charges','dues_subscriptions','rent','utilities','insurance','meals_entertainment','office_supplies','contractors','payroll_processing','payroll_taxes','salaries_operations','accounting_finance','business_consultation','legal_fees','quality_rd','taxes_licenses','car_rental_uber','flights','hotel','uncategorized','vehicle_expenses'].reduce((s,k)=>s+Number(d[k] ?? 0),0);
    return (inc + cogs + exp + Number(d.other_income ?? 0)) / 1000;
  };
  const netIncomeFcst = (i: number): number => {
    const gsK = fcGrossByMonth[i] ?? 0;
    const ctx: ForecastContext = {
      grossSales: gsK, unitsSold: gsK>0 ? Math.round(gsK*1000/37) : 0,
      cogsPerUnit: get('cogs_per_unit',22.27), logisticsPct: get('logistics_pct_of_gross',9.8)/100,
      deductionPct: dedPct, fixedCostsK: FIXED_COSTS_BEST_ESTIMATE[i+1] ?? {},
    };
    return computeMonthlyNetIncome(ctx);
  };

  // Forward-carried balances from the last real balance sheet.
  const bsL = latestBsIdx>=0 ? bsAt(latestBsIdx)! : {};
  const fwd = {
    loansSh: Number(bsL['loans_to_shareholders'] ?? 0)/1000,
    dueSh: Number(bsL['due_from_shareholders'] ?? 0)/1000,
    fixed: (Number(bsL['equipment'] ?? 0)+Number(bsL['accumulated_depreciation'] ?? 0))/1000,
    capital: ['capital_1st_round','capital_2nd_round','capital_3rd_round','capital_4th_round'].reduce((s,k)=>s+Number(bsL[k] ?? 0)/1000,0),
    common: Number(bsL['common_stock'] ?? 0)/1000,
    openEq: Number(bsL['opening_balance_equity'] ?? 0)/1000,
    retEarn: Number(bsL['retained_earnings'] ?? 0)/1000,
    netIncEq: Number(bsL['net_income_equity'] ?? 0)/1000,
    fgBase: Number(bsL['finished_goods'] ?? 0)/1000,
    rmBase: Number(bsL['raw_materials_packaging'] ?? 0)/1000,
  };
  const avgCC = (() => {
    const xs:number[]=[]; for (let i=0;i<12;i++){const b=bsAt(i); if(b) xs.push(ccKeys.reduce((s,k)=>s+Number(b[k] ?? 0)/1000,0));}
    return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
  })();
  const accruedFwd = latestBsIdx>=0 ? Number(bsL['accrued_liabilities'] ?? 0)/1000 : 10.34;

  // ── Inventory model (forecast months only) ──
  // Finished Goods: falls with each month's sales; receives the December production run.
  // Raw Materials: built up over Oct–Nov ahead of the run, converts to FG in December.
  // Capped so total inventory never exceeds ~$800K (no over-stocking).
  const DEC_RUN_CASES = 30000;
  const decRunK = DEC_RUN_CASES * cogsPerCaseK;            // value produced in Dec (RM→FG)
  const FG_FLOOR = 60;
  const INV_CAP = 800;
  // RM ramp targets relative to base (build mostly in Nov).
  const rmTarget = (i: number) => {
    const base = fwd.rmBase;
    if (i <= 8) return base;                    // Jul–Sep: steady
    if (i === 9) return base + decRunK * 0.25;  // Oct: light buying
    if (i === 10) return base + decRunK * 0.75; // Nov: heavy build (fully stocked for the run)
    if (i === 11) return base * 0.6;            // Dec: most RM consumed by production, some left over
    return base;
  };
  const fgAt = (i: number) => {
    let fg = fwd.fgBase;
    for (let j = latestBsIdx + 1; j <= i; j++) {
      const cogsOut = (fcGrossByMonth[j] ?? 0) * 1000 / 37 * cogsPerCaseK;
      const produced = j === 11 ? decRunK : 0;
      fg = Math.max(FG_FLOOR, fg - cogsOut + produced);
    }
    return fg;
  };

  const out: MonthFin[] = [];
  for (let i = 0; i < 12; i++) {
    const bs = bsAt(i); const pnl = pnlAt(i);
    const isBsReal = !!bs; const isPnlReal = !!pnl;
    const isForecast = !isBsReal && latestBsIdx >= 0 && i > latestBsIdx;
    const blank = !isBsReal && !isForecast; // e.g. March: has no BS yet → leave BS lines blank

    // Net income: real from P&L wherever a P&L exists; else forecast (after last real P&L).
    let ni: number|null = null;
    if (isPnlReal) ni = netIncomeReal(i);
    else if (latestPnlIdx >= 0 && i > latestPnlIdx) ni = netIncomeFcst(i);

    // AR / FG / RM / Inventory
    let ar: number|null=null, fg: number|null=null, rm: number|null=null, inv: number|null=null;
    if (isBsReal) {
      ar = Number(bs!['accounts_receivable'] ?? 0)/1000;
      fg = Number(bs!['finished_goods'] ?? 0)/1000;
      rm = Number(bs!['raw_materials_packaging'] ?? 0)/1000;
      inv = fg + rm;
    } else if (isForecast) {
      const cur = netOf(fcGrossByMonth[i] ?? 0);
      const prev = netOf(grossK(i-1));
      ar = cur * mixKU + (cur + prev) * mixRF;
      fg = fgAt(i);
      let rmv = rmTarget(i);
      // Total inventory is capped at ~$800K (never over-stock). If FG + RM would exceed it,
      // trim raw materials so the split stays consistent with the shown total.
      if (fg + rmv > INV_CAP) rmv = Math.max(0, INV_CAP - fg);
      rm = rmv;
      inv = fg + rmv;
    }

    // Liabilities / equity
    let cc: number|null=null, accrued: number|null=null, netIncEq: number|null=null;
    let cash: number|null=null, totAssets: number|null=null, totLiab: number|null=null, totEquity: number|null=null;
    if (isBsReal) {
      cc = ccKeys.reduce((s,k)=>s+Number(bs![k] ?? 0)/1000,0);
      accrued = Number(bs!['accrued_liabilities'] ?? 0)/1000;
      cash = bankKeys.reduce((s,k)=>s+Number(bs![k] ?? 0)/1000,0);
      netIncEq = Number(bs!['net_income_equity'] ?? 0)/1000;
      const curAssets = cash + ar! + inv! + fwd.loansSh;
      totAssets = curAssets + fwd.fixed + fwd.dueSh;
      totLiab = cc + accrued;
      totEquity = totAssets - totLiab;
    } else if (isForecast) {
      cc = avgCC; accrued = accruedFwd;
      // cumulative NI from last real BS close
      let cumNI = 0; for (let j = latestBsIdx + 1; j <= i; j++) cumNI += (netIncomeReal(j) ?? netIncomeFcst(j));
      netIncEq = fwd.netIncEq + cumNI;
      totEquity = fwd.capital + fwd.common + fwd.openEq + fwd.retEarn + netIncEq;
      totLiab = cc + accrued;
      const nonCash = ar! + inv! + fwd.loansSh + fwd.fixed + fwd.dueSh;
      cash = totLiab + totEquity - nonCash;   // cash is the balancing figure
      totAssets = cash + nonCash;
    }

    // ── P&L lines ($K): real from pnl_detail, else forecast from assumptions ──
    let grossSales:number|null=null, deductions:number|null=null, netSales:number|null=null,
        cogsTotal:number|null=null, grossMargin:number|null=null, sgaTot:number|null=null, ebitda:number|null=null;
    const hasPnl = isPnlReal || (latestPnlIdx >= 0 && i > latestPnlIdx);
    if (isPnlReal) {
      const d = pnl!;
      grossSales = (Number(d.sales_product ?? 0) + Number(d.shipping_income ?? 0))/1000;
      deductions = ['consumer_returns','distributor_fees','dsd_programs','kehe_allowance','payment_terms','promos','unfi_allowance','returns_refunds'].reduce((s,k)=>s+Number(d[k] ?? 0),0)/1000;
      netSales = grossSales + deductions;
      cogsTotal = ['product_costs','freight_in','freight_out_actual','merchant_fees','warehouse_fulfillment'].reduce((s,k)=>s+Number(d[k] ?? 0),0)/1000;
      grossMargin = netSales + cogsTotal;
      sgaTot = ['broker_commissions','slotting_fees','demos_merchandising','digital_social','events_tradeshows','printing_promotional','product_samples','bank_charges','dues_subscriptions','rent','utilities','insurance','meals_entertainment','office_supplies','contractors','payroll_processing','payroll_taxes','salaries_operations','accounting_finance','business_consultation','legal_fees','quality_rd','taxes_licenses','car_rental_uber','flights','hotel','uncategorized','vehicle_expenses'].reduce((s,k)=>s+Number(d[k] ?? 0),0)/1000;
      ebitda = grossMargin + sgaTot; // NOI; other_income handled in netIncome
    } else if (hasPnl) {
      const gsK = fcGrossByMonth[i] ?? 0;
      const unitsSold = gsK>0 ? Math.round(gsK*1000/37) : 0;
      grossSales = gsK;
      deductions = -gsK * dedPct;
      netSales = grossSales + deductions;
      cogsTotal = -((unitsSold*get('cogs_per_unit',22.27))/1000) - gsK*get('logistics_pct_of_gross',9.8)/100;
      grossMargin = netSales + cogsTotal;
      ebitda = netIncomeFcst(i);           // NOI (other income ~0 in forecast)
      sgaTot = ebitda - grossMargin;
    }

    out.push({
      isPnlReal, isBsReal, isForecast,
      netIncome: ni, ar, fg, rm, inventory: inv,
      cash, creditCards: cc, accrued,
      loansSh: isBsReal||isForecast ? fwd.loansSh : 0,
      fixed: isBsReal ? (Number(bs!['equipment'] ?? 0)+Number(bs!['accumulated_depreciation'] ?? 0))/1000 : (isForecast ? fwd.fixed : 0),
      dueSh: isBsReal||isForecast ? fwd.dueSh : 0,
      capital: isBsReal ? ['capital_1st_round','capital_2nd_round','capital_3rd_round','capital_4th_round'].reduce((s,k)=>s+Number(bs![k] ?? 0)/1000,0) : (isForecast ? fwd.capital : 0),
      common: isBsReal ? Number(bs!['common_stock'] ?? 0)/1000 : (isForecast ? fwd.common : 0),
      openEq: isBsReal ? Number(bs!['opening_balance_equity'] ?? 0)/1000 : (isForecast ? fwd.openEq : 0),
      retEarn: isBsReal ? Number(bs!['retained_earnings'] ?? 0)/1000 : (isForecast ? fwd.retEarn : 0),
      netIncEq, totalAssets: totAssets, totalLiab: totLiab, totalEquity: totEquity,
      grossSales, deductions, netSales, cogsTotal, grossMargin, sga: sgaTot, ebitda, hasPnl,
    });
  }
  return out;
}


function AssumptionsModal({ assumptions, onClose }: { assumptions: ReturnType<typeof useFinanceAssumptions>; onClose: () => void }) {
  const keys: { key: AssumptionKey; hint: string }[] = [
    { key: "cogs_per_unit", hint: "$/case — used as Units Sold × this value = Product Costs forecast" },
    { key: "logistics_pct_of_gross", hint: "% of Gross Sales — splits into Freight In/Out + Warehouse" },
    { key: "deduction_pct_overall", hint: "% of Gross Sales — splits into Distributor Fees / DSD / KeHE / Payment Terms / Promos / UNFI" },
    { key: "deduction_pct_kehe", hint: "Reference only — KeHE-specific deduction rate from H1 real mix" },
    { key: "deduction_pct_unfi", hint: "Reference only — UNFI-specific deduction rate from H1 real mix" },
    { key: "deduction_pct_rainforest", hint: "Reference only — Rainforest-specific deduction rate (18% distribution fee + 60-day terms)" },
    { key: "sales_mix_kehe", hint: "Reference only — % of gross sales $ through KeHE (H1 2026 pipeline)" },
    { key: "sales_mix_unfi", hint: "Reference only — % of gross sales $ through UNFI (H1 2026 pipeline)" },
    { key: "sales_mix_rainforest", hint: "Reference only — % of gross sales $ through Rainforest (H1 2026 pipeline)" },
  ];
  const [edits, setEdits] = useState<Record<string, string>>({});

  async function handleSave(key: AssumptionKey) {
    const raw = edits[key];
    if (raw == null) return;
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    await assumptions.saveOverride(key, val);
    setEdits(prev => { const n = { ...prev }; delete n[key]; return n; });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm" style={{color:"#1C2340"}}>Forecast Assumptions</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
        </div>
        <p className="text-xs text-muted-foreground">
          These drive every forecast (non-Accountfully) month in the P&L. They auto-recalculate from real
          data whenever a new month is loaded via "Upload Accountfully PDF" — unless you override manually here.
        </p>
        <div className="space-y-3">
          {keys.map(({ key, hint }) => {
            const row = assumptions.rows[key];
            if (!row) return null;
            const displayVal = edits[key] ?? String(row.value);
            return (
              <div key={key} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold" style={{color:"#1C2340"}}>{row.label}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <input
                      type="number" step="0.01" value={displayVal}
                      onChange={e => setEdits(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-20 rounded-lg border border-border px-2 py-1 text-xs text-right font-mono"
                    />
                    <span className="text-[10px] text-muted-foreground w-4">{row.unit === "percent" ? "%" : row.unit === "currency" ? "$" : ""}</span>
                    <button onClick={() => handleSave(key)}
                      className="rounded-lg bg-[#1C2340] text-white px-2 py-1 text-[10px] font-semibold hover:opacity-90">
                      Save
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
                  <span>
                    {row.is_manual_override
                      ? <span className="text-amber-600">✎ Manual override</span>
                      : <span className="text-emerald-600">✓ Auto from real data</span>}
                    {row.auto_calculated_value != null && ` · Auto value: ${row.auto_calculated_value.toFixed(2)}`}
                  </span>
                  {row.is_manual_override && (
                    <button onClick={() => assumptions.resetToAuto(key)} className="underline hover:text-foreground">
                      Reset to auto
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


// ─── Cash Flow Tab ────────────────────────────────────────────────────────────
function CashFlowTab({ actuals, actualOnly, scenario }: { actuals: Record<string, any>; actualOnly: boolean; scenario: Scenario }) {
  const cashCanvas = useRef<HTMLCanvasElement>(null);
  const { julyGrossSales } = useJulyRealFromFulfillment();
  const scenarioForecast = useFinanceScenarioForecast(scenario); // "2026-8" -> $ (not $K)
  const assumptions = useFinanceAssumptions();

  const fcGrossByMonth: Record<number, number> = {};
  for (let mo = 1; mo <= 12; mo++) {
    const v = scenarioForecast[`2026-${mo}`];
    if (v != null) fcGrossByMonth[mo-1] = v/1000;
  }
  if (julyGrossSales != null) fcGrossByMonth[6] = julyGrossSales/1000;

  // Single source of truth — identical to what the Balance Sheet shows (same scenario).
  const S = useMemo(
    () => buildFinanceForecast(actuals, fcGrossByMonth, assumptions.get),
    [actuals, assumptions.rows, scenario, julyGrossSales]
  );

  const isReal = (i: number) => S[i].isBsReal || S[i].isPnlReal;
  const hasBS = (i: number) => S[i].ar != null && S[i].inventory != null && S[i].cash != null;

  // In Actual mode show only real months; in Forecast mode show all 12.
  const visIdx = MONTHS.map((_,i)=>i).filter(i => actualOnly ? isReal(i) : true);

  // Real Other Income ($K) per month, from the P&L — this is "Interest / Other Income".
  const otherIncomeK = (i: number): number|null => {
    const d = actuals[PERIODS[i]]?.pnl_detail;
    if (d) return Number(d.other_income ?? 0)/1000;
    return S[i].hasPnl ? 0 : null; // forecast: assume ~0 unless modeled
  };
  // Capital Contributions ($K) for a month, from the Balance Sheet.
  const capitalK = (i: number): number|null => (S[i].isBsReal || S[i].isForecast) ? S[i].capital : null;

  const N = 12;
  const netIncome: (number|null)[] = [], dAR: (number|null)[] = [], dInv: (number|null)[] = [],
        dAP: (number|null)[] = [], cfo: (number|null)[] = [], cfi: (number|null)[] = [],
        dCapital: (number|null)[] = [], interest: (number|null)[] = [],
        cashBop: (number|null)[] = [], cashEop: (number|null)[] = [];

  for (let i = 0; i < N; i++) {
    const m = S[i], prev = i > 0 ? S[i-1] : null;
    netIncome[i] = m.netIncome;
    cashEop[i] = m.cash;
    interest[i] = otherIncomeK(i);

    const canBridge = hasBS(i) && prev != null && prev.ar != null && prev.inventory != null && prev.cash != null;
    if (canBridge) {
      dAR[i]  = -((m.ar as number) - (prev!.ar as number));
      dInv[i] = -((m.inventory as number) - (prev!.inventory as number));
      const apNow = (m.creditCards ?? 0) + (m.accrued ?? 0);
      const apPrev = (prev!.creditCards ?? 0) + (prev!.accrued ?? 0);
      dAP[i]  = (apNow - apPrev);
      cashBop[i] = prev!.cash as number;
      cfo[i] = (m.cash as number) - (prev!.cash as number);
      // Investing: change in Capital Contributions month-over-month (new investment rounds).
      const capNow = capitalK(i), capPrev = capitalK(i-1);
      dCapital[i] = (capNow != null && capPrev != null) ? (capNow - capPrev) : null;
      cfi[i] = (dCapital[i] ?? 0) + (interest[i] ?? 0);
    } else {
      dAR[i] = null; dInv[i] = null; dAP[i] = null; cfo[i] = null; cashBop[i] = null;
      dCapital[i] = null; cfi[i] = null;
    }
  }

  const latestBsIdx = (() => { let x=-1; for (let i=0;i<N;i++) if (S[i].isBsReal) x=i; return x; })();
  const lastRealCash = latestBsIdx >= 0 ? (S[latestBsIdx].cash ?? 0) : 0;
  const decCash = S[11].cash ?? 0;
  const avgBurn = ([9,10,11].reduce((s,i)=>s+(S[i].netIncome ?? 0),0))/3;
  const runway = avgBurn < 0 ? decCash / Math.abs(avgBurn) : 99;

  useChart(cashCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Cash EOP (real)', data: cashEop.map((v,i)=>S[i].isBsReal?v:null), borderColor:'#1C2340', backgroundColor:'rgba(28,35,64,0.1)', tension:0.3, fill:true, pointRadius:5, spanGaps:true },
        { label: 'Cash EOP (forecast)', data: cashEop.map((v,i)=>{
            const firstForecast = S.findIndex(x=>x.isForecast);
            return (S[i].isForecast || (firstForecast>0 && i===firstForecast-1)) ? v : null;
          }),
          borderColor:'#A3224A', backgroundColor:'rgba(163,34,74,0.08)', borderDash:[4,3], tension:0.3, fill:true, spanGaps:true,
          pointRadius: cashEop.map((_,i)=>S[i].isForecast?4:0) },
        { label: 'Runway = 0', data: MONTHS.map(()=>0), borderColor:'#DC2626', borderDash:[5,5], pointRadius:0, fill:false }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } }, scales:{ y:{ ticks:{ callback:(v:number)=>'$'+v+'K' } } } }
  }), [S, actualOnly]);

  type CFRow = { name: string; type?: string; indent?: boolean; data: (number|null)[] };
  const cfRows: CFRow[] = [
    { name: 'Net Income',                        data: netIncome },
    { name: 'Changes in Working Capital', type:'sub', data: dAR.map((v,i)=> v==null?null:(v + (dInv[i] as number) + (dAP[i] as number))) },
    { name: 'AR', indent:true,                   data: dAR },
    { name: 'Inventory', indent:true,            data: dInv },
    { name: 'Accounts Payable & Accrued', indent:true, data: dAP },
    { name: 'Cash from Operations',       type:'total', data: cfo },
    { name: 'Cash from Investing',        type:'sub', data: cfi },
    { name: 'Capital Contributions', indent:true, data: dCapital },
    { name: 'Interest / Other Income', indent:true, data: interest },
    { name: 'Cash — Beginning of Month',         data: cashBop },
    { name: 'Cash — End of Month',        type:'total', data: cashEop },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm flex items-center gap-4 flex-wrap">
        <span>💰 <strong>Cash on hand (last real close):</strong> {fmtK(lastRealCash)}</span>
        <span>· <strong>Runway:</strong> {runway > 36 ? "36+ mo" : runway.toFixed(1)+" mo"}</span>
        <span>· <strong>Cash EOP (Dec 26 forecast):</strong> {fmtK(decCash)}</span>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="text-sm font-semibold mb-3" style={{color:"#1C2340"}}>
          Cash trend month by month <span className="text-[10px] font-normal text-muted-foreground">derived from P&L (Net Income) + Balance Sheet (working-capital changes) · dashed/pink = forecast</span>
        </div>
        <div style={{height:280}}><canvas ref={cashCanvas} /></div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground w-52">Line</th>
              {visIdx.map((i) => (
                <th key={MONTHS[i]} className="text-right px-2 py-2.5 text-[10px] uppercase w-12"
                  style={{color: isReal(i) ? "#1C2340" : "#C9A3B5"}}>{MONTHS[i]}</th>
              ))}
              <th className="text-right px-2 py-2.5 text-[10px] uppercase text-muted-foreground w-14">{actualOnly ? "YTD" : "FY"}</th>
            </tr>
          </thead>
          <tbody>
            {cfRows.map((row, ri) => {
              const isTotal = row.type === 'total';
              const isSub = row.type === 'sub';
              const visVals = visIdx.map(i => row.data[i]);
              const fyVals = visVals.filter((v): v is number => v != null);
              const fy = row.name.startsWith('Cash —')
                ? (row.data[visIdx[visIdx.length-1]] ?? null)
                : (fyVals.length ? fyVals.reduce((a,b)=>a+b,0) : null);
              return (
                <tr key={ri} className={`border-t border-border/40 hover:bg-muted/20 ${isTotal ? "font-bold bg-muted/10" : ""} ${isSub ? "font-semibold" : ""}`}>
                  <td className={`px-4 py-1.5 ${isTotal||isSub ? "" : "text-muted-foreground"} ${row.indent ? "pl-10" : ""}`}
                    style={{color:"#1C2340"}}>{row.name}</td>
                  {visIdx.map((i) => {
                    const v = row.data[i];
                    return (
                    <td key={i} className="text-right px-2 py-1.5 font-mono tabular-nums"
                      style={{
                        color: v == null ? "#D1D5DB"
                          : v === 0 ? "#9CA3AF"
                          : isReal(i)
                            ? (v < 0 ? "#EF4444" : "#10B981")
                            : (v < 0 ? "#F3B8C4" : "#8FD9BC"),
                        fontWeight: isReal(i) ? 700 : 400,
                      }}>
                      {v == null ? "—" : v === 0 ? "—" : fmt(v,0)}
                    </td>
                    );
                  })}
                  <td className="text-right px-2 py-1.5 font-mono font-semibold tabular-nums"
                    style={{color: fy == null ? "#D1D5DB" : fy < 0 ? "#EF4444" : fy > 0 ? "#10B981" : "#9CA3AF"}}>
                    {fy == null ? "—" : fy === 0 ? "—" : fmt(fy,0)}
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

function BalanceTab({ realMonths, actuals, actualOnly, scenario }: { realMonths: number; actuals: Record<string,any>; actualOnly: boolean; scenario: Scenario }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    new Set(["g-bank","g-ar","g-inv","g-fixed","g-cc","g-other-liab","g-capital"])
  );
  const { julyGrossSales } = useJulyRealFromFulfillment();
  const scenarioForecast = useFinanceScenarioForecast(scenario);
  const assumptions = useFinanceAssumptions();

  // Manual forecast adjustment: move $X from Bank into Inventory (or vice-versa) per forecast month.
  // Positive = extra inventory (cash goes down by the same amount). Keyed by month index.
  const [invAdjust, setInvAdjust] = useState<Record<number, number>>({});

  // bs_detail per period (real, wherever Accountfully sent a balance sheet snapshot)
  const bsByPeriod = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const p of PERIODS) if (actuals[p]?.bs_detail) map[p] = actuals[p].bs_detail;
    return map;
  }, [actuals]);
  const latestRealIdx = useMemo(() => {
    const withBs = PERIODS.map((p,i) => bsByPeriod[p] ? i : -1).filter(i => i >= 0);
    return withBs.length ? Math.max(...withBs) : -1;
  }, [bsByPeriod]);

  const fcGrossByMonth: Record<number, number> = {}; // month index 0-11 -> $K, Gross Sales
  for (let mo = 1; mo <= 12; mo++) { const v = scenarioForecast[`2026-${mo}`]; if (v != null) fcGrossByMonth[mo-1] = v/1000; }
  if (julyGrossSales != null) fcGrossByMonth[6] = julyGrossSales/1000;

  // ═══════════════════════════════════════════════════════════════════════════
  // All forecast values come from the SINGLE shared builder, so the Balance Sheet
  // and the Cash Flow are always identical. Nothing is computed twice.
  // ═══════════════════════════════════════════════════════════════════════════
  const S = useMemo(
    () => buildFinanceForecast(actuals, fcGrossByMonth, assumptions.get),
    [actuals, assumptions.rows, scenario, julyGrossSales]
  );
  // Apply the manual inventory/bank adjustment (inversely proportional) for forecast months.
  const adj = (idx: number) => (S[idx]?.isForecast ? (invAdjust[idx] ?? 0) : 0);
  const forecastAR = (idx: number) => S[idx].ar ?? 0;
  const forecastFinishedGoods = (idx: number) => (S[idx].fg ?? 0) + adj(idx); // adjustment lands on FG
  const forecastRawMaterials = (idx: number) => S[idx].rm ?? 0;
  const forecastInventory = (idx: number) => (S[idx].inventory ?? 0) + adj(idx);
  const forecastCash = (idx: number) => (S[idx].cash ?? 0) - adj(idx);         // inversely proportional
  const avgCreditCardsK = S.find(m => m.isForecast)?.creditCards ?? 0;
  const accruedK = S.find(m => m.isForecast)?.accrued ?? 10.34;
  const fwdLoansShK = S.find(m => m.isForecast)?.loansSh ?? 0;
  const fwdDueShK   = S.find(m => m.isForecast)?.dueSh ?? 0;
  const fwdFixedK   = S.find(m => m.isForecast)?.fixed ?? 6.26;
  const fwdCapitalK = S.find(m => m.isForecast)?.capital ?? 3457.57;
  const fwdCommonK  = S.find(m => m.isForecast)?.common ?? 1.10;
  const fwdOpenEqK  = S.find(m => m.isForecast)?.openEq ?? -1.87;
  const fwdRetEarnK = S.find(m => m.isForecast)?.retEarn ?? -1548.94;
  const forecastNetIncEq = (idx: number) => S[idx].netIncEq ?? 0;
  const forecastEquityK = (idx: number) => S[idx].totalEquity ?? 0;

  const isRealMonthFn = (idx: number) => !!bsByPeriod[PERIODS[idx]];
  const visIdx = MONTHS.map((_,i)=>i).filter(i => actualOnly ? isRealMonthFn(i) : true);

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
    const parent = BS_ROWS.find(r => r.id === pid);
    if (!parent) return true;
    if (!parent.parentId) return true;
    return !collapsed.has(parent.parentId);
  }

  function isRealMonth(idx: number): boolean {
    return !!bsByPeriod[PERIODS[idx]];
  }

  function getValue(row: BSNode, idx: number): number | null {
    if (row.kind === "section") return null;
    const real = bsByPeriod[PERIODS[idx]];
    const isForecast = !real && idx > latestRealIdx && latestRealIdx >= 0;
    const isBlank = !real && !isForecast; // months before the first real snapshot with no data

    // ── Groups: sum children ──
    if (row.kind === "group") {
      if (isBlank) return null;
      const items = (childMap[row.id] || [])
        .map(cid => BS_ROWS.find(r => r.id === cid))
        .filter((r): r is BSNode => r != null);
      const vals = items.map(r => getValue(r, idx)).filter((v): v is number => v != null);
      return vals.length ? vals.reduce((a,b)=>a+b,0) : null;
    }

    // ── Totals ──
    if (row.kind === "total") {
      if (isBlank) return null;
      if (real) {
        // Sum real children for this total's own group
        const gid = row.id === "t-bank" ? "g-bank" : row.id === "t-ar" ? "g-ar" : row.id === "t-inv" ? "g-inv"
          : row.id === "t-fixed" ? "g-fixed" : row.id === "t-cc" ? "g-cc" : row.id === "t-other-liab" ? "g-other-liab"
          : row.id === "t-capital" ? "g-capital" : null;
        if (gid) return getValue(BS_ROWS.find(r=>r.id===gid)!, idx);
      }
      if (row.id === "t-bank") return real ? getValue(BS_ROWS.find(r=>r.id==="g-bank")!, idx) : forecastCash(idx);
      if (row.id === "t-ar")   return real ? getValue(BS_ROWS.find(r=>r.id==="g-ar")!, idx)   : forecastAR(idx);
      if (row.id === "t-inv")  return real ? getValue(BS_ROWS.find(r=>r.id==="g-inv")!, idx)  : forecastInventory(idx);
      if (row.id === "t-fixed") return real ? getValue(BS_ROWS.find(r=>r.id==="g-fixed")!, idx) : fwdFixedK;
      if (row.id === "t-cc") return real ? getValue(BS_ROWS.find(r=>r.id==="g-cc")!, idx) : avgCreditCardsK;
      if (row.id === "t-other-liab") return accruedK;
      if (row.id === "t-capital") return real ? getValue(BS_ROWS.find(r=>r.id==="g-capital")!, idx) : fwdCapitalK;
      if (row.id === "t-curr-assets") {
        return (getValue(BS_ROWS.find(r=>r.id==="t-bank")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="t-ar")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="t-inv")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="loans_sh")!, idx) ?? 0);
      }
      if (row.id === "t-assets") {
        return (getValue(BS_ROWS.find(r=>r.id==="t-curr-assets")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="t-fixed")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="due_sh")!, idx) ?? 0);
      }
      if (row.id === "t-liab") return (getValue(BS_ROWS.find(r=>r.id==="t-cc")!, idx) ?? 0) + (getValue(BS_ROWS.find(r=>r.id==="t-other-liab")!, idx) ?? 0);
      if (row.id === "t-equity") {
        return (getValue(BS_ROWS.find(r=>r.id==="t-capital")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="common_stock")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="open_bal_eq")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="ret_earn")!, idx) ?? 0)
          + (getValue(BS_ROWS.find(r=>r.id==="net_inc_eq")!, idx) ?? 0);
      }
      if (row.id === "t-liab-equity") return (getValue(BS_ROWS.find(r=>r.id==="t-liab")!, idx) ?? 0) + (getValue(BS_ROWS.find(r=>r.id==="t-equity")!, idx) ?? 0);
      return null;
    }

    // ── Items ──
    if (isBlank) return null;
    if (real && row.actualKey && real[row.actualKey] != null) {
      return Number(real[row.actualKey]) / 1000;
    }
    // Forecast items (idx > last real): carry forward the last real balance-sheet values.
    if (isForecast) {
      if (row.id === "loans_sh") return fwdLoansShK;
      if (row.id === "equip") return latestRealIdx>=0 ? Number(bsByPeriod[PERIODS[latestRealIdx]]?.equipment ?? 0)/1000 : 11.19;
      if (row.id === "accum_dep") return latestRealIdx>=0 ? Number(bsByPeriod[PERIODS[latestRealIdx]]?.accumulated_depreciation ?? 0)/1000 : -4.93;
      if (row.id === "due_sh") return fwdDueShK;
      if (row.id === "accrued") return accruedK;
      if (row.id === "cap1") return latestRealIdx>=0 ? Number(bsByPeriod[PERIODS[latestRealIdx]]?.capital_1st_round ?? 0)/1000 : 225;
      if (row.id === "cap2") return latestRealIdx>=0 ? Number(bsByPeriod[PERIODS[latestRealIdx]]?.capital_2nd_round ?? 0)/1000 : 399.87;
      if (row.id === "cap3") return latestRealIdx>=0 ? Number(bsByPeriod[PERIODS[latestRealIdx]]?.capital_3rd_round ?? 0)/1000 : 685.97;
      if (row.id === "cap4") return latestRealIdx>=0 ? Number(bsByPeriod[PERIODS[latestRealIdx]]?.capital_4th_round ?? 0)/1000 : 2146.73;
      if (row.id === "common_stock") return fwdCommonK;
      if (row.id === "open_bal_eq") return fwdOpenEqK;
      if (row.id === "ret_earn") return fwdRetEarnK;
      if (row.id === "net_inc_eq") return forecastNetIncEq(idx);
      // Individual credit-card lines: show blended average on the primary line, 0 on the rest.
      if (row.id === "boa3724") return avgCreditCardsK;
      if (["boa7830","boa8781","citi_cc","merc_cc"].includes(row.id)) return 0;
      // Individual bank lines: show total cash on the primary line, 0 on the rest.
      if (row.id === "bofa") return forecastCash(idx);
      if (["citi_b","merc_chk","merc_trs"].includes(row.id)) return 0;
      // AR / inventory detail: AR total, plus finished goods & raw materials split out.
      if (row.id === "ar_item") return forecastAR(idx);
      if (row.id === "fin_goods") return forecastFinishedGoods(idx);
      if (row.id === "raw_mat") return forecastRawMaterials(idx);
      return 0;
    }
    return null;
  }

  const indentPx = [0, 16, 28, 40];
  const firstFcIdx = S.findIndex(x => x.isForecast);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <button onClick={() => setCollapsed(new Set())} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Expand all</button>
        <button onClick={() => setCollapsed(new Set(BS_ROWS.filter(r=>r.kind==="group").map(r=>r.id)))} className="rounded-full border border-border px-2 py-0.5 hover:bg-muted">Collapse all</button>
        {Object.keys(invAdjust).length > 0 && (
          <button onClick={() => setInvAdjust({})} className="rounded-full border border-amber-300 bg-amber-50 text-amber-700 px-2 py-0.5 hover:bg-amber-100">↺ Reset inventory edits</button>
        )}
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"/>
          <strong className="text-foreground">Bold</strong> = Accountfully real snapshot
        </span>
        <span className="opacity-60">Gray = forecast · edit forecast Inventory in the row below (Bank moves inversely, $-for-$) · Cash is the balancing figure so Assets = Liab + Equity every month</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground min-w-[240px]">Line</th>
              {visIdx.map((i) => (
                <th key={MONTHS[i]} className="text-right px-2 py-2.5 text-[10px] uppercase tracking-wide w-12"
                  style={{color: isRealMonth(i) ? "#1C2340" : "#9CA3AF"}}>
                  {MONTHS[i]}
                  <div className="text-[8px]">{isRealMonth(i) ? "A" : "F"}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BS_ROWS.filter(r => isVisible(r)).map(row => {
              if (row.kind === "section") return (
                <tr key={row.id}>
                  <td colSpan={visIdx.length+1} className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white" style={{backgroundColor:"#1C2340"}}>{row.label}</td>
                </tr>
              );
              const isGroup = row.kind === "group";
              const isTotal = row.kind === "total";
              const isOpen = !collapsed.has(row.id);
              const vals = visIdx.map((i) => getValue(row, i));

              const rows = [(
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
                  {vals.map((v, k) => {
                    const i = visIdx[k];
                    return (
                    <td key={i} className="text-right px-2 py-1.5 font-mono tabular-nums"
                      style={{color: isRealMonth(i) ? "#1C2340" : "#9CA3AF", fontWeight: isRealMonth(i) ? 700 : 400}}>
                      {v == null || v === 0 ? "—" : isRealMonth(i) ? fmtExact(v) : fmt(v, 0)}
                    </td>
                    );
                  })}
                </tr>
              )];

              // Editable adjustment row directly under Total Inventory (forecast months only).
              if (row.id === "t-inv" && !actualOnly && firstFcIdx >= 0) {
                rows.push(
                  <tr key="inv-edit" className="border-t border-dashed border-amber-200 bg-amber-50/40">
                    <td className="px-4 py-1.5 text-[10px] italic text-amber-700" style={{paddingLeft: 20}}>
                      ✎ Adjust forecast inventory (± $K) — Bank moves inversely
                    </td>
                    {visIdx.map((i) => (
                      <td key={i} className="text-right px-1 py-1">
                        {S[i]?.isForecast ? (
                          <input type="number" step={10} value={invAdjust[i] ?? 0}
                            onChange={e => setInvAdjust(prev => ({ ...prev, [i]: Number(e.target.value) }))}
                            className="w-12 rounded border border-amber-300 px-1 py-0.5 text-[10px] text-right font-mono bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
                        ) : <span className="text-muted-foreground text-[10px]">—</span>}
                      </td>
                    ))}
                  </tr>
                );
              }
              return rows;
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
  const [projScenario, setProjScenario] = useState<Scenario>("Normal");

  // ── Actuals from Supabase ──
  const [actuals, setActuals] = useState<Record<string, any>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<any[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── Balance Sheet March 2026 (from Accountfully PDF, raw dollars) ───────────
  const MAR26_BS: Record<string,number> = {
    bofa_x6854: 329215.39, citi_bank: 451416.69, mercury_checking: 0, mercury_treasury: 0,
    accounts_receivable: 233976.15, finished_goods: 130541.63, raw_materials_packaging: 300726.83,
    loans_to_shareholders: 12961.14, equipment: 11193.81, accumulated_depreciation: -4928.88,
    due_from_shareholders: 996.75,
    boa_3724: 393.08, boa_7830: 100.97, boa_8781: 471.55, citi_credit: 19075.61, mercury_credit: 0,
    accrued_liabilities: 10340.00,
    capital_1st_round: 225000.00, capital_2nd_round: 399865.00, capital_3rd_round: 685970.00, capital_4th_round: 1910760.00,
    common_stock: 1096.75, opening_balance_equity: -1866.32, retained_earnings: -1548940.01, net_income_equity: -224158.01,
  };

  async function loadActuals() {
    const { data } = await supabase.from("finance_actuals").select("*").order("period");
    if (data) {
      const map: Record<string, any> = {};
      data.forEach((row: any) => { map[row.period] = row; });

      // Seed bs_detail for March 2026 if missing (P&L already loaded)
      if (map["2026-03"] && !map["2026-03"].bs_detail) {
        const patch = { period: "2026-03", bs_detail: MAR26_BS, cash: 780.63, total_assets: 1478.11, total_liab: 30.38, total_equity: 1447.73 };
        await supabase.from("finance_actuals").upsert(patch, { onConflict: "period" });
        Object.assign(map["2026-03"], patch);
      }

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

  const realMonths = useMemo(() => PERIODS.filter(p => actuals[p]?.pnl_detail != null).length, [actuals]);
  const actualOnly = scenario === "Actual";

  const latestActualLabel = useMemo(() => {
    const keys = Object.keys(actuals).filter(p => actuals[p]).sort();
    if (!keys.length) return 'none';
    const last = keys[keys.length - 1];
    const idx = parseInt(last.split('-')[1]) - 1;
    return MONTHS[idx] + ' ' + last.split('-')[0];
  }, [actuals]);

  // ── PDF upload → Claude API (extracts P&L detail + Balance Sheet detail) ──
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
          max_tokens: 8000,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: `Extract ALL monthly financial data from this Accountfully management report.
Return ONLY a JSON array (no markdown, no backticks, no explanation) where each item is one month with this EXACT structure:

[
  {
    "period": "2026-03",
    "period_label": "Mar 2026",
    "units_sold": null,
    "gross_sales": 196.70,
    "trade_spend": -5.63,
    "distr_fees": -7.22,
    "net_sales": 183.85,
    "cogs": -114.74,
    "storage": -23.37,
    "freight_out": 0,
    "gross_margin": 45.73,
    "gm_pct": 0.249,
    "selling_exp": -156.37,
    "mkt_trade": -18.36,
    "team": -18.54,
    "gen_exp": -20.28,
    "ebitda": -167.81,
    "business_contribution": -128.99,
    "cash": 780.63,
    "ar": 233.98,
    "inventory": 431.27,
    "total_assets": 1478.11,
    "total_liab": 30.38,
    "total_equity": 1447.73,
    "pnl_detail": {
      "sales_product": 196696.50,
      "shipping_income": 0,
      "consumer_returns": 0,
      "distributor_fees": -1845.40,
      "dsd_programs": 0,
      "kehe_allowance": -1681.68,
      "payment_terms": -2597.39,
      "promos": -5625.86,
      "unfi_allowance": -1094.94,
      "returns_refunds": 0,
      "product_costs": -114742.00,
      "freight_in": -2825.00,
      "freight_out_actual": 0,
      "merchant_fees": 0,
      "warehouse_fulfillment": -20549.52,
      "broker_commissions": -10340.00,
      "slotting_fees": -146027.37,
      "demos_merchandising": -3500.00,
      "digital_social": -4912.30,
      "events_tradeshows": -6578.45,
      "printing_promotional": 0,
      "product_samples": -3368.42,
      "bank_charges": -567.90,
      "dues_subscriptions": -1011.03,
      "rent": 0,
      "utilities": -398.82,
      "insurance": -973.69,
      "meals_entertainment": -1892.39,
      "office_supplies": -23.68,
      "contractors": -2254.00,
      "payroll_processing": -61.00,
      "payroll_taxes": -1152.85,
      "salaries_operations": -15070.00,
      "accounting_finance": -5150.00,
      "business_consultation": 0,
      "legal_fees": 0,
      "quality_rd": 0,
      "taxes_licenses": -670.49,
      "car_rental_uber": -1523.33,
      "flights": -200.00,
      "hotel": -554.57,
      "uncategorized": -7295.00,
      "vehicle_expenses": -19.17,
      "other_income": 38.34
    },
    "bs_detail": {
      "bofa_x6854": 329215.39,
      "citi_bank": 451416.69,
      "mercury_checking": 0,
      "mercury_treasury": 0,
      "accounts_receivable": 233976.15,
      "finished_goods": 130541.63,
      "raw_materials_packaging": 300726.83,
      "loans_to_shareholders": 12961.14,
      "equipment": 11193.81,
      "accumulated_depreciation": -4928.88,
      "due_from_shareholders": 996.75,
      "boa_3724": 393.08,
      "boa_7830": 100.97,
      "boa_8781": 471.55,
      "citi_credit": 19075.61,
      "mercury_credit": 0,
      "accrued_liabilities": 10340.00,
      "capital_1st_round": 225000.00,
      "capital_2nd_round": 399865.00,
      "capital_3rd_round": 685970.00,
      "capital_4th_round": 1910760.00,
      "common_stock": 1096.75,
      "opening_balance_equity": -1866.32,
      "retained_earnings": -1548940.01,
      "net_income_equity": -224158.01
    }
  }
]

RULES:
- The top-level summary fields (gross_sales, net_sales, etc.) are in $K (divide raw dollars by 1000).
- pnl_detail values are in RAW DOLLARS (not $K). Expenses and costs are NEGATIVE.
- bs_detail values are in RAW DOLLARS (not $K). Liabilities are positive. Accumulated depreciation is negative.
- gm_pct = gross_margin / net_sales as a decimal.
- trade_spend = negative sum of DSD Programs + Promos + Consumer Returns.
- distr_fees = negative sum of Distributor Fees + KeHE Allowance + UNFI Allowance + Payment Terms.
- storage = Warehouse/Fulfillment + Freight In combined in $K.
- freight_out = Freight Out in $K.
- team = negative Payroll & Employee Related Costs total in $K.
- gen_exp = negative G&A total minus payroll in $K.
- ebitda = Net Operating Income in $K.
- business_contribution = gross_margin + selling_exp + mkt_trade in $K.
- For the Balance Sheet: extract the LATEST snapshot only (end of the report period). If the report covers Jan-Mar, the BS is as of Mar 31 — assign bs_detail to the LAST month only. Earlier months get bs_detail: null.
- If a line item is missing or zero, use 0 (not null) for pnl_detail/bs_detail.
- For "BoA 3724", sum all sub-accounts (BoA 3724 Corp + BoA 3724 (4641), etc.) into one value.
- Use null for unavailable top-level summary fields.
- units_sold: set to null (we calculate it separately).` }
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
    // Reload actuals and recalculate forecast assumptions from the fresh data
    const { data } = await supabase.from("finance_actuals").select("*").order("period");
    if (data) {
      const freshMap: Record<string, any> = {};
      data.forEach((r: any) => { freshMap[r.period] = r; });
      await recalcAssumptionsFromActuals(freshMap);
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
                <p className="text-xs text-muted-foreground mt-0.5">AI will extract P&L + Balance Sheet data and update actuals in the Finance module</p>
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
                <span className="animate-pulse">🤖 AI is reading the PDF and extracting P&L + Balance Sheet data…</span>
              </div>
            )}
            {uploadError && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">⚠ {uploadError}</div>
            )}
            {uploadPreview && (
              <>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 font-semibold">
                  ✓ Extracted {uploadPreview.length} month{uploadPreview.length !== 1 ? 's' : ''} of data
                  {uploadPreview.some((r: any) => r.pnl_detail) && ' · P&L ✓'}
                  {uploadPreview.some((r: any) => r.bs_detail) && ' · Balance Sheet ✓'}
                   — review before saving
                </div>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs min-w-max">
                    <thead className="bg-muted/30 border-b border-border">
                      <tr>
                        {['Period','Gross Sales','Net Sales','COGS','GP','Selling','EBITDA','Cash','BS'].map(h => (
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
                          <td className="px-3 py-1.5 font-mono">{row.gross_margin != null ? `$${Number(row.gross_margin).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono">{row.selling_exp != null ? `$${Number(row.selling_exp).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5 font-mono font-semibold" style={{color: row.ebitda < 0 ? '#DC2626' : '#16A34A'}}>
                            {row.ebitda != null ? `$${Number(row.ebitda).toFixed(0)}K` : '—'}
                          </td>
                          <td className="px-3 py-1.5 font-mono">{row.cash != null ? `$${Number(row.cash).toFixed(0)}K` : '—'}</td>
                          <td className="px-3 py-1.5">
                            {row.bs_detail ? <span className="text-emerald-600 font-semibold">✓</span> : <span className="text-muted-foreground">—</span>}
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

      {(tab === "cashflow" || tab === "balance") && (
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {(["Forecast","Actual"] as const).map(s => (
              <button key={s} onClick={() => setScenario(s)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${scenario===s ? "text-white shadow-sm" : "text-muted-foreground"}`}
                style={scenario===s ? {backgroundColor:"#1C2340"} : {}}>
                {s}
              </button>
            ))}
          </div>
          {scenario === "Forecast" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Scenario</span>
              <div className="flex gap-1 rounded-xl bg-muted p-1">
                {(["Pessimistic","Normal","Optimistic"] as Scenario[]).map(s => (
                  <button key={s} onClick={() => setProjScenario(s)}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${projScenario===s ? "text-white shadow-sm" : "text-muted-foreground"}`}
                    style={projScenario===s ? {backgroundColor:"#A3224A"} : {}}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "dashboard" && <DashboardTab period={period} refMonth={refMonth} actuals={actuals} realMonths={realMonths} actualOnly={actualOnly} />}
      {tab === "pnl"       && <PNLTab realMonths={realMonths} actuals={actuals} actualOnly={actualOnly} />}
      {tab === "cashflow"  && <CashFlowTab actuals={actuals} actualOnly={actualOnly} scenario={projScenario} />}
      {tab === "balance"   && <BalanceTab realMonths={realMonths} actuals={actuals} actualOnly={actualOnly} scenario={projScenario} />}
      {tab === "runway"    && <RunwayTab />}
      {tab === "ebitda"    && <EBITDATab />}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/finance")({
  component: FinancePage,
  head: () => ({ meta: [{ title: "Finance · BARIS" }] }),
});
