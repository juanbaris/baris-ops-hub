import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

// ─── Data (values in $K) ──────────────────────────────────────────────────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
const REAL_MONTHS = 6; // Jan–Jun confirmed

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
function DashboardTab({ period, refMonth }: { period: Period; refMonth: number }) {
  const rev = periodSlice(D.gross_sales, period, refMonth);
  const budgetRev = periodSlice(BUDGET.gross_sales, period, refMonth);
  const netRev = periodSlice(D.net_sales, period, refMonth);
  const gp = periodSlice(D.gross_margin, period, refMonth);
  const gmPct = netRev ? gp/netRev : 0;
  const bc = periodSlice(D.business_contribution, period, refMonth);
  const ebitda = periodSlice(D.ebitda, period, refMonth);
  const cash = D.cash_eop[refMonth];
  const avgBurn = (D.ebitda[Math.max(0,refMonth-2)] + D.ebitda[Math.max(0,refMonth-1)] + D.ebitda[refMonth]) / 3;
  const runway = avgBurn < 0 ? cash / Math.abs(avgBurn) : 99;
  const wc = D.ar[refMonth] + D.inventory[refMonth] - D.ap[refMonth];
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
        { label: 'Budget', data: D.gross_sales, backgroundColor: 'rgba(180,180,180,0.4)', borderRadius: 3, order: 3 },
        { label: 'Real', data: D.gross_sales.map((v,i) => i < REAL_MONTHS ? v : null), type: 'line', borderColor: '#10B981', backgroundColor: 'transparent', tension: 0.3, pointRadius: 4, order: 1 },
        { label: 'Forecast', data: D.gross_sales.map((v,i) => i >= REAL_MONTHS-1 ? v : null), type: 'line', borderColor: '#A3224A', backgroundColor: 'transparent', tension: 0.3, pointRadius: 4, borderDash: [4,3], order: 2 },
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
        data: D.gm_pct.map(v => +(v*100).toFixed(1)),
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
        data: D.cash_eop,
        borderColor: '#1C2340',
        backgroundColor: 'rgba(28,35,64,0.1)',
        tension: 0.3, fill: true, pointRadius: 4,
      }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ callback:(v:number) => '$'+v+'K' } } } }
  }), []);

  // Waterfall FY totals
  const wfLabels = ['Gross Sales','Ded.','Net Sales','COGS','Fulfillment','GM','SG&A','EBITDA'];
  const gs = sum(D.gross_sales); const ded = sum(D.trade_spend)+sum(D.distr_fees); const ns = sum(D.net_sales);
  const cogs = -sum(D.cogs); const ful = -(sum(D.storage)+sum(D.freight_out)); const gm = sum(D.gross_margin);
  const sga = sum(D.selling_exp)+sum(D.mkt_trade)+sum(D.team)+sum(D.gen_exp); const eb = sum(D.ebitda);
  const wfData = [gs, ded, ns, cogs, ful, gm, sga, eb];
  const wfColors = wfData.map(v => v >= 0 ? '#1C2340' : '#A3224A');

  useChart(waterfallCanvas, () => ({
    type: 'bar',
    data: { labels: wfLabels, datasets: [{ data: wfData, backgroundColor: wfColors, borderRadius: 4 }] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } }, scales:{ y:{ ticks:{ callback:(v:number) => '$'+v+'K' } } } }
  }), []);

  return (
    <div className="space-y-5">
      {runway < 6 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          ⚠️ Critical runway: {runway.toFixed(1)} months of cash at current burn rate. Consider accelerating collections or cutting expenses.
        </div>
      )}

      {/* 7 KPIs */}
      <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
        <KPI icon="💰" label="Revenue" value={fmtK(rev)}
          sub={`Budget vs Forecast ${vsBpct>=0?'+':''}${(vsBpct*100).toFixed(1)}%`}
          subColor={vsBpct>=0?"text-emerald-600":"text-red-500"} />
        <KPI icon="📊" label="Gross Margin %" value={fmtPct(gmPct)}
          sub={`${fmt(gp,0)} abs`} />
        <KPI icon="🎯" label="Business Contribution" value={fmtK(bc)}
          sub={`${netRev ? (bc/netRev*100).toFixed(1) : 0}% of Gross`} />
        <KPI icon="📉" label="EBITDA" value={fmt(ebitda,0)}
          sub="burn del período" subColor={ebitda < 0 ? "text-red-500" : "text-emerald-600"} />
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
            <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Revenue mensual · Budget vs Real vs Forecast</h3>
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

// ─── P&L Table ────────────────────────────────────────────────────────────────
function PNLTab() {
  type RowType = 'header'|'total'|'sub'|'pct';
  const rows: { name: string; type: RowType; data?: number[] }[] = [
    { name: 'GROSS SALES', type: 'header' },
    { name: 'Gross Sales', type: 'total', data: D.gross_sales },
    { name: 'SALES DEDUCTIONS', type: 'header' },
    { name: 'Trade spend', type: 'sub', data: D.trade_spend },
    { name: 'Distributor fees', type: 'sub', data: D.distr_fees },
    { name: 'Net Sales', type: 'total', data: D.net_sales },
    { name: 'COGS & FULFILLMENT', type: 'header' },
    { name: 'COGS', type: 'sub', data: D.cogs.map(v=>-v) },
    { name: 'Storage', type: 'sub', data: D.storage.map(v=>-v) },
    { name: 'Freight out', type: 'sub', data: D.freight_out.map(v=>-v) },
    { name: 'Gross Margin', type: 'total', data: D.gross_margin },
    { name: 'Gross Margin %', type: 'pct', data: D.gm_pct },
    { name: 'Business Contribution', type: 'total', data: D.business_contribution },
    { name: 'SG&A EXPENSES', type: 'header' },
    { name: 'Selling expenses', type: 'sub', data: D.selling_exp },
    { name: 'Marketing & Trade', type: 'sub', data: D.mkt_trade },
    { name: 'Team', type: 'sub', data: D.team },
    { name: 'General expenses', type: 'sub', data: D.gen_exp },
    { name: 'EBITDA', type: 'total', data: D.ebitda },
  ];

  const gs_fy = sum(D.gross_sales);

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full text-xs min-w-max">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-40">Line</th>
            {MONTHS.map((m,i) => (
              <th key={m} className="text-right px-2 py-2.5 text-[10px] uppercase tracking-wide w-12"
                style={{color: i < REAL_MONTHS ? "#1C2340" : "#9CA3AF"}}>
                {m}<div className="text-[8px]">{i<REAL_MONTHS?"R":"F"}</div>
              </th>
            ))}
            <th className="text-right px-2 py-2.5 text-[10px] uppercase text-muted-foreground w-14">FY</th>
            <th className="text-right px-2 py-2.5 text-[10px] uppercase text-muted-foreground w-12">% GS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            if (row.type === 'header') return (
              <tr key={ri} className="bg-muted/20 border-t border-border">
                <td colSpan={15} className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{row.name}</td>
              </tr>
            );
            const isTotal = row.type === 'total';
            const isPct = row.type === 'pct';
            const fy = sum(row.data!);
            const pctGS = gs_fy ? (Math.abs(fy)/gs_fy*100).toFixed(1) : '—';
            return (
              <tr key={ri} className={`border-t border-border/40 hover:bg-muted/20 ${isTotal ? "font-semibold bg-muted/10" : ""}`}>
                <td className={`px-4 py-1.5 ${isTotal ? "font-semibold" : "pl-6 text-muted-foreground"}`} style={{color:"#1C2340"}}>{row.name}</td>
                {row.data!.map((v,i) => (
                  <td key={i} className={`text-right px-2 py-1.5 font-mono tabular-nums ${i >= REAL_MONTHS ? "opacity-60" : ""}`}
                    style={{color: isPct ? "#1C2340" : v < 0 ? "#EF4444" : isTotal ? "#10B981" : "#1C2340"}}>
                    {isPct ? fmtPct(v) : v === 0 ? "—" : fmt(v,0)}
                  </td>
                ))}
                <td className="text-right px-2 py-1.5 font-mono font-semibold tabular-nums"
                  style={{color: isPct ? "#1C2340" : fy < 0 ? "#EF4444" : "#10B981"}}>
                  {isPct ? fmtPct(fy/12) : fmt(fy,0)}
                </td>
                <td className="text-right px-2 py-1.5 font-mono text-muted-foreground tabular-nums text-[10px]">
                  {isPct ? "—" : pctGS+"%"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Cash Flow Tab ────────────────────────────────────────────────────────────
function CashFlowTab({ refMonth }: { refMonth: number }) {
  const cashCanvas = useRef<HTMLCanvasElement>(null);
  const avgBurn = (D.ebitda[Math.max(0,refMonth-2)] + D.ebitda[Math.max(0,refMonth-1)] + D.ebitda[refMonth]) / 3;
  const runway = avgBurn < 0 ? D.cash_eop[refMonth] / Math.abs(avgBurn) : 99;

  useChart(cashCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [
        { label: 'Cash EOP', data: D.cash_eop, borderColor:'#1C2340', backgroundColor:'rgba(28,35,64,0.1)', tension:0.3, fill:true, pointRadius:5 },
        { label: 'Runway = 0', data: MONTHS.map(()=>0), borderColor:'#DC2626', borderDash:[5,5], pointRadius:0, fill:false }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } }, scales:{ y:{ ticks:{ callback:(v:number)=>'$'+v+'K' } } } }
  }), []);

  type CFRow = { name: string; type?: string; data: (number|null)[] };
  const cfRows: CFRow[] = [
    { name: 'EBITDA',                      data: D.ebitda },
    { name: 'Changes in Working Capital',  data: D.chg_wc },
    { name: '  · AR',                      data: D.chg_ar },
    { name: '  · Inventory',               data: D.chg_inventory },
    { name: '  · AP',                      data: D.chg_ap },
    { name: 'Cash from Operations',        type: 'total', data: D.cash_from_ops },
    { name: 'Capital contributions',       data: D.capital_contrib },
    { name: 'Investing Cash Flow',         type: 'total', data: D.capital_contrib },
    { name: 'Cash BOP',                    data: D.cash_bop },
    { name: 'Change in cash',              data: D.chg_cash },
    { name: 'Cash EOP',                    type: 'total', data: D.cash_eop },
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm flex items-center gap-4 flex-wrap">
        <span>💰 <strong>Cash on hand (Jul 2026):</strong> {fmtK(D.cash_eop[refMonth])}</span>
        <span>· <strong>Runway:</strong> {runway > 36 ? "36+ mo" : runway.toFixed(1)+" mo"}</span>
        <span>· <strong>Cash EOP (Dec 26):</strong> {fmtK(D.cash_eop[11])}</span>
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
                  style={{color: i < REAL_MONTHS ? "#1C2340" : "#9CA3AF"}}>{m}</th>
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
                    <td key={i} className={`text-right px-2 py-1.5 font-mono tabular-nums ${i >= REAL_MONTHS ? "opacity-60" : ""}`}
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
function BalanceTab() {
  const bsCanvas = useRef<HTMLCanvasElement>(null);
  const donutCanvas = useRef<HTMLCanvasElement>(null);

  useChart(bsCanvas, () => ({
    type: 'line',
    data: {
      labels: MONTHS,
      datasets: [
        { label:'Total Assets', data:D.total_assets, borderColor:'#A3224A', backgroundColor:'rgba(163,34,74,0.08)', tension:0.3, fill:true, pointRadius:4 },
        { label:'Total Equity', data:D.total_equity, borderColor:'#1C2340', tension:0.3, fill:false, pointRadius:4 }
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } }, scales:{ y:{ ticks:{ callback:(v:number)=>'$'+v+'K' } } } }
  }), []);

  useChart(donutCanvas, () => ({
    type: 'doughnut',
    data: {
      labels: ['Cash','AR','Inventory'],
      datasets: [{ data:[D.cash_eop[11],D.ar[11],D.inventory[11]], backgroundColor:['#1C2340','#A3224A','#C77A0A'] }]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ boxWidth:12, font:{ size:11 } } } } }
  }), []);

  type BSRow = { name: string; type?: 'header'|'total'; data?: number[] };
  const bsRows: BSRow[] = [
    { name: 'ASSETS', type: 'header' },
    { name: 'Cash', data: D.cash_eop },
    { name: 'Accounts receivable', data: D.ar },
    { name: 'Inventory', data: D.inventory },
    { name: 'Total Assets', type: 'total', data: D.total_assets },
    { name: 'LIABILITIES', type: 'header' },
    { name: 'Accounts payable', data: D.ap },
    { name: 'Commercial debt', data: D.commercial_debt },
    { name: 'Total Liabilities', type: 'total', data: D.total_liab },
    { name: 'EQUITY', type: 'header' },
    { name: 'Total Equity', type: 'total', data: D.total_equity },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="text-sm font-semibold mb-3" style={{color:"#1C2340"}}>Total Assets vs Total Equity <span className="text-[10px] font-normal text-muted-foreground">FY 2026</span></div>
          <div style={{height:220}}><canvas ref={bsCanvas} /></div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="text-sm font-semibold mb-3" style={{color:"#1C2340"}}>Assets breakdown · Dec 26</div>
          <div style={{height:220}}><canvas ref={donutCanvas} /></div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wide text-muted-foreground w-40">Line</th>
              {MONTHS.map((m,i) => (
                <th key={m} className="text-right px-2 py-2.5 text-[10px] uppercase w-12"
                  style={{color: i < REAL_MONTHS ? "#1C2340" : "#9CA3AF"}}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bsRows.map((row, ri) => {
              if (row.type === 'header') return (
                <tr key={ri}><td colSpan={13} className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white" style={{backgroundColor:"#1C2340"}}>{row.name}</td></tr>
              );
              const isTotal = row.type === 'total';
              return (
                <tr key={ri} className={`border-t border-border/40 hover:bg-muted/20 ${isTotal ? "font-bold bg-muted/10" : ""}`}>
                  <td className={`px-4 py-1.5 ${isTotal ? "font-bold" : "pl-6 text-muted-foreground"}`} style={{color:"#1C2340"}}>{row.name}</td>
                  {row.data!.map((v,i) => (
                    <td key={i} className={`text-right px-2 py-1.5 font-mono tabular-nums ${i >= REAL_MONTHS ? "opacity-60" : ""}`}
                      style={{color: "#1C2340"}}>
                      {v === 0 ? "—" : fmt(v,0)}
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
      <div>
        <h1 className="text-2xl font-bold" style={{color:"#1C2340"}}>Finance</h1>
        <p className="text-sm text-muted-foreground">P&L, cashflow, budget, forecast. Source: Best Estimate 2026 + Accountfully Jun 2026.</p>
      </div>

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
            <button className="rounded-lg px-3 py-1 text-xs font-semibold text-white shadow-sm" style={{backgroundColor:"#1C2340"}}>Forecast</button>
            <button className="rounded-lg px-3 py-1 text-xs font-semibold text-muted-foreground opacity-50" title="Actuals not fully loaded yet">Actual</button>
          </div>
        </div>
      )}

      {tab === "dashboard" && <DashboardTab period={period} refMonth={refMonth} />}
      {tab === "pnl"       && <PNLTab />}
      {tab === "cashflow"  && <CashFlowTab refMonth={refMonth} />}
      {tab === "balance"   && <BalanceTab />}
      {tab === "runway"    && <RunwayTab />}
      {tab === "ebitda"    && <EBITDATab />}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/finance")({
  component: FinancePage,
  head: () => ({ meta: [{ title: "Finance · BARIS" }] }),
});
