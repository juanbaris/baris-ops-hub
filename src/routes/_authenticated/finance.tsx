import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";

// ─── Financial data — Jan-Jun REAL, Jul-Dec FORECAST ─────────────────────────
// Source: Baris_Financials_2026.xlsx + PatagoniaBitesFinancials June 2026 (Accountfully)
const PERIODS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;
const REAL_MONTHS = 6; // Jan-Jun confirmed by Accountfully

const PNL: Record<string, Record<string, number>> = {
  "Gross Sales":        { Jan:138653, Feb:203792, Mar:196697, Apr:112420, May:298656, Jun:209692, Jul:183459, Aug:168815, Sep:147768, Oct:195136, Nov:183164, Dec:145819 },
  "Total Deductions":   { Jan:-12313, Feb:-24811, Mar:-12845, Apr:-73638, May:-58241, Jun:-47511, Jul:-36157, Aug:-48220, Sep:-30301, Oct:-42488, Nov:-36074, Dec:-28807 },
  "Net Sales":          { Jan:126251, Feb:178951, Mar:183851, Apr:38782,  May:240414, Jun:162181, Jul:147302, Aug:120595, Sep:117467, Oct:152648, Nov:147090, Dec:117012 },
  "Product COGS":       { Jan:91183,  Feb:131486, Mar:114742, Apr:65453,  May:172350, Jun:116832, Jul:99747,  Aug:89250,  Sep:76182,  Oct:105311, Nov:96981,  Dec:73173  },
  "Logistics":          { Jan:2735,   Feb:29598,  Mar:23375,  Apr:11197,  May:16489,  Jun:30255,  Jul:20000,  Aug:20000,  Sep:20000,  Oct:20000,  Nov:20000,  Dec:20000  },
  "Total COGS":         { Jan:93918,  Feb:161084, Mar:138117, Apr:76650,  May:188839, Jun:147087, Jul:119747, Aug:109250, Sep:96182,  Oct:125311, Nov:116981, Dec:93173  },
  "Gross Profit":       { Jan:32333,  Feb:17868,  Mar:45735,  Apr:-37869, May:51576,  Jun:15094,  Jul:27555,  Aug:11345,  Sep:21285,  Oct:27337,  Nov:30109,  Dec:23839  },
  "Selling Expenses":   { Jan:10896,  Feb:12089,  Mar:156367, Apr:18732,  May:10557,  Jun:11640,  Jul:14281,  Aug:14281,  Sep:14652,  Oct:14281,  Nov:14281,  Dec:13910  },
  "Marketing & Trade":  { Jan:10338,  Feb:13283,  Mar:25654,  Apr:14567,  May:23041,  Jun:14857,  Jul:9500,   Aug:5000,   Sep:5000,   Oct:9000,   Nov:5000,   Dec:5000   },
  "G&A":                { Jan:27238,  Feb:33722,  Mar:31523,  Apr:24633,  May:27412,  Jun:32362,  Jul:11047,  Aug:4847,   Sep:9347,   Oct:8447,   Nov:4847,   Dec:4847   },
  "Total Expenses":     { Jan:48472,  Feb:59094,  Mar:213544, Apr:57932,  May:61010,  Jun:58860,  Jul:53672,  Aug:42972,  Sep:47843,  Oct:50572,  Nov:42972,  Dec:42601  },
  "Net Op. Income":     { Jan:-16139, Feb:-41226, Mar:-167810,Apr:-95801, May:-9435,  Jun:-43766, Jul:-26117, Aug:-31627, Sep:-26558, Oct:-23235, Nov:-12863, Dec:-18762 },
  "Net Income":         { Jan:-16131, Feb:-41213, Mar:-167771,Apr:-95763, May:-6608,  Jun:-38802, Jul:-26117, Aug:-31627, Sep:-26558, Oct:-23235, Nov:-12863, Dec:-18762 },
};

const BUDGET_FY: Record<string, number> = {
  "Gross Sales": 2117644, "Net Sales": 1618995, "Total COGS": 1393765,
  "Gross Profit": 225229, "Total Expenses": 775686, "Net Income": -550457,
};

// Balance Sheet — Jun 30 Real | Dec 31 Forecast
const BALANCE_SHEET = {
  assets: {
    "Total Cash": { real: 660533, forecast: 577036 },
    "Accounts Receivable": { real: 298315, forecast: 270000 },
    "Inventory (FG + RM)": { real: 588708, forecast: 520000 },
    "Fixed Assets (net)": { real: 6265, forecast: 5500 },
    "Other Assets": { real: 13958, forecast: 13958 },
    "TOTAL ASSETS": { real: 1567779, forecast: 1386494 },
  },
  liabilities: {
    "Credit Cards": { real: 15871, forecast: 20000 },
    "Accrued Liabilities": { real: 10340, forecast: 10340 },
    "TOTAL LIABILITIES": { real: 26211, forecast: 30340 },
  },
  equity: {
    "Capital Contributions": { real: 3457565, forecast: 3457565 },
    "Retained Earnings": { real: -1548940, forecast: -1548940 },
    "Net Income (YTD)": { real: -366288, forecast: -505450 },
    "TOTAL EQUITY": { real: 1541568, forecast: 1036118 },
  },
};

// Cash flow data
const CASHFLOW = {
  "Net Income":         { Jan:-16131, Feb:-41213, Mar:-167771, Apr:-95763, May:-6608,  Jun:-38802, Jul:-26117, Aug:-31627, Sep:-26558, Oct:-23235, Nov:-12863, Dec:-18762 },
  "Depreciation":       { Jan:113,    Feb:113,    Mar:113,     Apr:113,    May:113,    Jun:113,    Jul:113,    Aug:113,    Sep:113,    Oct:113,    Nov:113,    Dec:113    },
  "Working Capital Δ":  { Jan:-150000,Feb:50000,  Mar:-75000,  Apr:100000, May:-200000,Jun:100000, Jul:-30000, Aug:20000,  Sep:10000,  Oct:-15000, Nov:15000,  Dec:20000  },
  "Capital Received":   { Jan:460000, Feb:100000, Mar:350000,  Apr:0,      May:0,      Jun:0,      Jul:0,      Aug:0,      Sep:0,      Oct:0,      Nov:0,      Dec:0      },
  "Net Cash Flow":      { Jan:293982, Feb:108900, Mar:107342,  Apr:4350,   May:-206495,Jun:61311,  Jul:-55004, Aug:-11514, Sep:-16445, Oct:-38122, Nov:2250,   Dec:1351   },
  "Cash Balance":       { Jan:501982, Feb:610883, Mar:718224,  Apr:722575, May:516079, Jun:577390, Jul:522386, Aug:510872, Sep:494427, Oct:456305, Nov:458555, Dec:459906 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(n: number, short = false) {
  if (short) return n >= 1000000 ? `$${(n/1000000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n/1000)}k` : `$${Math.round(n)}`;
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}
function fmtSigned(n: number) {
  return n < 0 ? `-$${Math.round(Math.abs(n)).toLocaleString()}` : `$${Math.round(n).toLocaleString()}`;
}
function isReal(idx: number) { return idx < REAL_MONTHS; }

type Tab = "pnl" | "cashflow" | "balance" | "runway";

// ─── P&L Table ────────────────────────────────────────────────────────────────
function PNLTable({ view }: { view: "monthly" | "ytd" }) {
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);

  const sections = [
    {
      title: "INCOME", rows: ["Gross Sales","Total Deductions","Net Sales"],
      subtotal: "Net Sales", highlight: false,
    },
    {
      title: "COST OF GOODS SOLD", rows: ["Product COGS","Logistics","Total COGS"],
      subtotal: "Total COGS", highlight: false,
    },
    {
      title: "GROSS PROFIT", rows: ["Gross Profit"],
      subtotal: "Gross Profit", highlight: true,
    },
    {
      title: "OPERATING EXPENSES", rows: ["Selling Expenses","Marketing & Trade","G&A","Total Expenses"],
      subtotal: "Total Expenses", highlight: false,
    },
    {
      title: "BOTTOM LINE", rows: ["Net Op. Income","Net Income"],
      subtotal: "Net Income", highlight: true,
    },
  ];

  function getValue(line: string, monthIdx: number) {
    if (view === "ytd") {
      let sum = 0;
      for (let i = 0; i <= monthIdx; i++) sum += PNL[line]?.[PERIODS[i]] ?? 0;
      return sum;
    }
    return PNL[line]?.[PERIODS[monthIdx]] ?? 0;
  }

  function gmPct(monthIdx: number) {
    const ns = getValue("Net Sales", monthIdx);
    const gp = getValue("Gross Profit", monthIdx);
    if (!ns) return "—";
    return `${Math.round((gp / ns) * 100)}%`;
  }

  const colW = selectedPeriod !== null ? "w-16" : "w-12";

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-48">Line Item</th>
            {PERIODS.map((p, i) => (
              <th key={p} onClick={() => setSelectedPeriod(selectedPeriod === i ? null : i)}
                className={`text-right px-2 py-2.5 font-semibold text-[10px] uppercase tracking-wide cursor-pointer hover:bg-muted transition-colors ${colW} ${selectedPeriod === i ? "bg-muted" : ""}`}
                style={{ color: isReal(i) ? "#1C2340" : "#9CA3AF" }}>
                {p}
                <div className="text-[8px] mt-0.5">{isReal(i) ? "Real" : "Fcst"}</div>
              </th>
            ))}
            <th className="text-right px-2 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-16">FY Total</th>
            <th className="text-right px-2 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-16">Budget</th>
            <th className="text-right px-2 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-16">vs Bgt</th>
          </tr>
        </thead>
        <tbody>
          {sections.map(section => (
            <>
              <tr key={section.title} className="bg-muted/20 border-t border-border">
                <td colSpan={PERIODS.length + 4} className="px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  {section.title}
                </td>
              </tr>
              {section.rows.map(line => {
                const isSubtotal = line === section.subtotal || line.startsWith("Total") || line === "Gross Profit" || line === "Net Income" || line === "Net Op. Income";
                const fyTotal = Object.values(PNL[line] ?? {}).reduce((s, v) => s + v, 0);
                const budget = BUDGET_FY[line] ?? 0;
                const variance = budget !== 0 ? fyTotal - budget : 0;
                return (
                  <tr key={line} className={`border-t border-border/40 hover:bg-muted/20 ${isSubtotal ? "font-semibold bg-muted/10" : ""}`}>
                    <td className={`px-4 py-1.5 ${isSubtotal ? "font-semibold" : "text-muted-foreground pl-6"}`} style={{ color: "#1C2340" }}>
                      {line}
                    </td>
                    {PERIODS.map((p, i) => {
                      const v = getValue(line, i);
                      const isNeg = v < 0;
                      const isGP = line === "Gross Profit";
                      const isNI = line === "Net Income" || line === "Net Op. Income";
                      return (
                        <td key={p} className={`text-right px-2 py-1.5 font-mono tabular-nums ${selectedPeriod === i ? "bg-muted/40" : ""} ${!isReal(i) ? "opacity-60" : ""}`}
                          style={{ color: isGP ? (v < 0 ? "#EF4444" : "#10B981") : isNI ? (v < 0 ? "#EF4444" : "#10B981") : isNeg ? "#6B7280" : "#1C2340" }}>
                          {v === 0 ? "—" : fmtSigned(v).replace("-$", "-").replace("$", "$")}
                        </td>
                      );
                    })}
                    <td className="text-right px-2 py-1.5 font-mono font-semibold tabular-nums" style={{ color: fyTotal < 0 ? "#EF4444" : "#10B981" }}>
                      {fmtSigned(fyTotal)}
                    </td>
                    <td className="text-right px-2 py-1.5 font-mono tabular-nums text-muted-foreground">
                      {budget !== 0 ? fmtSigned(budget) : "—"}
                    </td>
                    <td className={`text-right px-2 py-1.5 font-mono tabular-nums text-xs ${variance > 0 ? "text-emerald-600" : variance < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {budget !== 0 ? (variance >= 0 ? "+" : "") + fmtSigned(variance) : "—"}
                    </td>
                  </tr>
                );
              })}
              {/* Gross Margin % after Net Sales */}
              {section.title === "INCOME" && (
                <tr className="border-t border-border/40 bg-muted/5">
                  <td className="px-4 py-1 pl-6 text-muted-foreground text-[10px]">Gross Margin %</td>
                  {PERIODS.map((_, i) => (
                    <td key={i} className={`text-right px-2 py-1 font-mono text-[10px] ${!isReal(i) ? "opacity-60" : ""}`}>
                      {(() => { const ns = getValue("Net Sales", i); const gp = getValue("Gross Profit", i); return ns ? `${Math.round((gp/ns)*100)}%` : "—"; })()}
                    </td>
                  ))}
                  <td className="text-right px-2 py-1 font-mono text-[10px] text-muted-foreground">
                    {(() => { const ns = Object.values(PNL["Net Sales"] ?? {}).reduce((s,v)=>s+v,0); const gp = Object.values(PNL["Gross Profit"] ?? {}).reduce((s,v)=>s+v,0); return ns ? `${Math.round((gp/ns)*100)}%` : "—"; })()}
                  </td>
                  <td /><td />
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Cash Flow Table ──────────────────────────────────────────────────────────
function CashflowTable() {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="text-left px-4 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-muted-foreground w-48">Line Item</th>
            {PERIODS.map((p, i) => (
              <th key={p} className="text-right px-2 py-2.5 font-semibold text-[10px] w-14"
                style={{ color: isReal(i) ? "#1C2340" : "#9CA3AF" }}>
                {p}<div className="text-[8px] mt-0.5">{isReal(i) ? "Real" : "Fcst"}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(CASHFLOW).map(([line, vals]) => {
            const isBalance = line === "Cash Balance";
            const isNetFlow = line === "Net Cash Flow";
            return (
              <tr key={line} className={`border-t border-border/40 hover:bg-muted/20 ${isBalance ? "font-bold bg-muted/20" : ""}`}>
                <td className={`px-4 py-1.5 ${isBalance || isNetFlow ? "font-semibold" : "pl-6 text-muted-foreground"}`} style={{ color: "#1C2340" }}>
                  {line}
                </td>
                {PERIODS.map((p, i) => {
                  const v = vals[p as keyof typeof vals] ?? 0;
                  return (
                    <td key={p} className={`text-right px-2 py-1.5 font-mono tabular-nums ${!isReal(i) ? "opacity-60" : ""}`}
                      style={{ color: isBalance ? (v < 400000 ? "#EF4444" : "#10B981") : v < 0 ? "#EF4444" : "#10B981" }}>
                      {v === 0 ? "—" : fmt$(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────
function BalanceSheetView() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {[
        { title: "Assets", data: BALANCE_SHEET.assets, positive: true },
        { title: "Liabilities & Equity", data: { ...BALANCE_SHEET.liabilities, ...BALANCE_SHEET.equity }, positive: false },
      ].map(section => (
        <div key={section.title} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border" style={{ backgroundColor: "#1C2340" }}>
            <h3 className="text-sm font-bold text-white">{section.title}</h3>
            <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>Jun 30, 2026 (Real) · Dec 31, 2026 (Forecast)</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/30 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-2">Line</th>
                <th className="text-right px-4 py-2">Jun 30 (R)</th>
                <th className="text-right px-4 py-2">Dec 31 (F)</th>
                <th className="text-right px-4 py-2">Δ</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(section.data).map(([line, vals]) => {
                const isTotal = line.startsWith("TOTAL");
                const delta = (vals.forecast ?? 0) - vals.real;
                return (
                  <tr key={line} className={`border-t border-border/40 hover:bg-muted/20 ${isTotal ? "font-bold bg-muted/10" : ""}`}>
                    <td className={`px-4 py-1.5 ${isTotal ? "font-semibold" : "pl-6 text-muted-foreground"}`} style={{ color: "#1C2340" }}>
                      {line}
                    </td>
                    <td className="text-right px-4 py-1.5 font-mono tabular-nums" style={{ color: "#1C2340" }}>
                      {fmtSigned(vals.real)}
                    </td>
                    <td className="text-right px-4 py-1.5 font-mono tabular-nums opacity-70" style={{ color: "#1C2340" }}>
                      {vals.forecast != null ? fmtSigned(vals.forecast) : "—"}
                    </td>
                    <td className={`text-right px-4 py-1.5 font-mono tabular-nums text-xs ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"}`}>
                      {vals.forecast != null ? (delta >= 0 ? "+" : "") + fmtSigned(delta) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ─── Runway / EBITDA Simulator ────────────────────────────────────────────────
function RunwayView() {
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

  const cash = BALANCE_SHEET.assets["Total Cash"].real;
  const monthlyBurn = Math.abs(Math.min(ebitda, 0));
  const runwayMonths = monthlyBurn > 0 ? cash / monthlyBurn : 99;

  const SliderRow = ({ label, value, min, max, step, onChange, fmt }: {
    label: string; value: number; min: number; max: number; step: number;
    onChange: (v: number) => void; fmt: (v: number) => string;
  }) => (
    <div className="mb-4">
      <div className="flex justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="text-xs font-mono font-semibold" style={{ color: "#1C2340" }}>{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: "#A3224A" }} />
      <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
        <span>{fmt(min)}</span><span>{fmt(max)}</span>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Simulator */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-4" style={{ color: "#1C2340" }}>EBITDA Simulator</h3>
        <SliderRow label="Cases / month" value={cases} min={500} max={5000} step={50}
          onChange={setCases} fmt={v => v.toLocaleString()} />
        <SliderRow label="Avg price / case ($)" value={price} min={30} max={45} step={0.5}
          onChange={setPrice} fmt={v => `$${v.toFixed(2)}`} />
        <SliderRow label="COGS / case ($)" value={cogs} min={10} max={35} step={0.5}
          onChange={setCogs} fmt={v => `$${v.toFixed(2)}`} />
        <SliderRow label="Deductions %" value={dedPct} min={5} max={35} step={0.5}
          onChange={setDedPct} fmt={v => `${v}%`} />
        <SliderRow label="Fixed costs / month ($)" value={fixed} min={20000} max={120000} step={1000}
          onChange={setFixed} fmt={v => `$${(v/1000).toFixed(0)}k`} />

        {/* Preset scenarios */}
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Quick scenarios</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Current Jul", cases: 1500, price: 36.96, cogs: 22, ded: 18, fixed: 55000 },
              { label: "Q4 Target", cases: 2200, price: 36.96, cogs: 21, ded: 17, fixed: 55000 },
              { label: "Kroger +", cases: 3000, price: 36.96, cogs: 20.5, ded: 22, fixed: 60000 },
              { label: "OOE COGS", cases: 1500, price: 36.96, cogs: 18, ded: 18, fixed: 55000 },
            ].map(s => (
              <button key={s.label} onClick={() => { setCases(s.cases); setPrice(s.price); setCogs(s.cogs); setDedPct(s.ded); setFixed(s.fixed); }}
                className="rounded-full px-3 py-1 text-xs font-semibold border border-border hover:bg-muted transition-colors">
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-4">
        {/* EBITDA result */}
        <div className={`rounded-2xl border p-5 ${ebitda >= 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#1C2340" }}>Monthly EBITDA</p>
          <div className={`text-3xl font-bold font-mono ${ebitda >= 0 ? "text-emerald-600" : "text-red-600"}`}>
            {fmtSigned(ebitda)}
          </div>
          <p className="text-xs mt-1 text-muted-foreground">Gross margin: {gm.toFixed(1)}% · Contrib/case: ${contribPerCase.toFixed(2)}</p>
        </div>

        {/* Waterfall */}
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          {[
            { label: "Gross Revenue", v: grossRev, color: "#3B82F6" },
            { label: `Deductions (${dedPct}%)`, v: -ded, color: "#F59E0B" },
            { label: "Net Revenue", v: netRev, color: "#1C2340" },
            { label: `COGS ($${cogs}/case)`, v: -totalCogs, color: "#EF4444" },
            { label: "Gross Profit", v: grossProfit, color: grossProfit >= 0 ? "#10B981" : "#EF4444" },
            { label: "Fixed Costs", v: -fixed, color: "#6B7280" },
            { label: "EBITDA", v: ebitda, color: ebitda >= 0 ? "#10B981" : "#EF4444" },
          ].map(row => (
            <div key={row.label} className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
              <span className="text-xs text-muted-foreground">{row.label}</span>
              <span className="text-xs font-mono font-semibold" style={{ color: row.color }}>{fmtSigned(row.v)}</span>
            </div>
          ))}
        </div>

        {/* Breakeven + Runway */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Breakeven</p>
            <p className="text-xl font-bold font-mono" style={{ color: "#1C2340" }}>
              {breakeven != null ? breakeven.toLocaleString() : "∞"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">cases/month</p>
            {breakeven != null && cases < breakeven && (
              <p className="text-[10px] text-red-500 font-semibold mt-1">Need +{(breakeven - cases).toLocaleString()} cases</p>
            )}
            {breakeven != null && cases >= breakeven && (
              <p className="text-[10px] text-emerald-600 font-semibold mt-1">✓ Above breakeven</p>
            )}
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Cash Runway</p>
            <p className={`text-xl font-bold font-mono ${runwayMonths < 6 ? "text-red-600" : runwayMonths < 12 ? "text-orange-500" : "text-emerald-600"}`}>
              {runwayMonths > 36 ? "36+" : runwayMonths.toFixed(1)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">months</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Cash: {fmt$(cash, true)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Summary cards ────────────────────────────────────────────────────────
function FinanceKPIs() {
  const ytdNetSales = ['Jan','Feb','Mar','Apr','May','Jun'].reduce((s, p) => s + (PNL["Net Sales"][p] ?? 0), 0);
  const ytdGP = ['Jan','Feb','Mar','Apr','May','Jun'].reduce((s, p) => s + (PNL["Gross Profit"][p] ?? 0), 0);
  const ytdNetIncome = ['Jan','Feb','Mar','Apr','May','Jun'].reduce((s, p) => s + (PNL["Net Income"][p] ?? 0), 0);
  const ytdGM = ytdNetSales > 0 ? (ytdGP / ytdNetSales) * 100 : 0;
  const cash = BALANCE_SHEET.assets["Total Cash"].real;
  const budgetNetSales = BUDGET_FY["Net Sales"] ?? 0;
  const ytdBudget = budgetNetSales / 12 * 6;
  const vsbudget = ytdNetSales - ytdBudget;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {[
        { icon: "💰", label: "Net Sales YTD", value: fmt$(ytdNetSales, true), sub: `vs budget: ${vsbudget >= 0 ? "+" : ""}${fmt$(vsbudget, true)}`, subColor: vsbudget >= 0 ? "text-emerald-600" : "text-red-500" },
        { icon: "📊", label: "Gross Margin YTD", value: `${ytdGM.toFixed(1)}%`, sub: "Jan–Jun 2026 (Real)", subColor: ytdGM > 15 ? "text-emerald-600" : "text-orange-500" },
        { icon: "🏦", label: "Cash on Hand", value: fmt$(cash, true), sub: "Jun 30, 2026", subColor: cash > 400000 ? "text-emerald-600" : "text-orange-500" },
        { icon: "📉", label: "Net Income YTD", value: fmtSigned(ytdNetIncome), sub: "Jan–Jun 2026 (Real)", subColor: ytdNetIncome >= 0 ? "text-emerald-600" : "text-red-500" },
      ].map(kpi => (
        <div key={kpi.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span>{kpi.icon}</span>
            <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">{kpi.label}</span>
          </div>
          <div className="text-xl font-bold font-mono" style={{ color: "#1C2340" }}>{kpi.value}</div>
          <div className={`text-xs mt-1 ${kpi.subColor}`}>{kpi.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function FinancePage() {
  const [tab, setTab] = useState<Tab>("pnl");
  const [pnlView, setPnlView] = useState<"monthly" | "ytd">("monthly");

  const tabs: { id: Tab; label: string }[] = [
    { id: "pnl", label: "P&L" },
    { id: "cashflow", label: "Cash Flow" },
    { id: "balance", label: "Balance Sheet" },
    { id: "runway", label: "EBITDA Simulator" },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "#1C2340" }}>Finance</h1>
        <p className="text-sm text-muted-foreground">Jan–Jun 2026 Real (Accountfully) · Jul–Dec 2026 Forecast</p>
      </div>

      <FinanceKPIs />

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab === t.id ? { borderColor: "#A3224A", color: "#A3224A" } : {}}>
            {t.label}
          </button>
        ))}
        {tab === "pnl" && (
          <div className="ml-auto flex gap-1 items-center pb-1">
            {(["monthly", "ytd"] as const).map(v => (
              <button key={v} onClick={() => setPnlView(v)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${pnlView === v ? "text-white" : "bg-muted text-muted-foreground"}`}
                style={pnlView === v ? { backgroundColor: "#1C2340" } : {}}>
                {v === "monthly" ? "Monthly" : "YTD Cumulative"}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "pnl" && <PNLTable view={pnlView} />}
      {tab === "cashflow" && <CashflowTable />}
      {tab === "balance" && <BalanceSheetView />}
      {tab === "runway" && <RunwayView />}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/finance")({
  component: FinancePage,
  head: () => ({ meta: [{ title: "Finance · BARIS" }] }),
});
