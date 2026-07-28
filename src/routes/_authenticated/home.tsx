import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Order = Database["public"]["Tables"]["customer_orders"]["Row"];
type FPMovement = Database["public"]["Tables"]["fp_movements"]["Row"];
type BudgetLine = Database["public"]["Tables"]["budget_lines"]["Row"];

// Fallback budget (2026 Best Estimate) — used if DB table not yet populated
const BUDGET_FALLBACK: Record<number, number> = {
  1: 110868, 2: 148391, 3: 147417, 4: 81279,  5: 219076, 6: 109849,
  7: 147302, 8: 120595, 9: 117467, 10: 152648, 11: 147090, 12: 117012,
};

const DISTRIBUTORS = ["UNFI", "KeHe", "Rainforest", "RFD", "Direct", "Other"] as const;
const DIST_COLORS: Record<string, string> = {
  UNFI: "#10B981", KeHe: "#A3224A", Rainforest: "#3B82F6", RFD: "#F59E0B", Direct: "#8B5CF6", Other: "#6B7280",
};
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const QUOTES = [
  { text: "Discipline is choosing between what you want now and what you want most.", author: "Abraham Lincoln" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
];

function fmt$(n: number) { return n >= 1000000 ? `$${(n/1000000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n/1000)}k` : `$${Math.round(n)}`; }
function fmtFull$(n: number) { return `$${Math.round(n).toLocaleString()}`; }

// ─── Dual bar chart: actual vs budget ────────────────────────────────────────
function DualBarChart({ data, height = 150 }: {
  data: { label: string; actual: number; budget: number }[]; height?: number;
}) {
  const max = Math.max(...data.flatMap(d => [d.actual, d.budget]), 1);
  const colW = 52;
  const barW = 18;
  const gap = 4;
  const totalW = data.length * colW;
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${totalW} ${height + 28}`} className="w-full" style={{ height: height + 28 }}>
        {data.map((d, i) => {
          const x = i * colW + 4;
          const actualH = (d.actual / max) * height;
          const budgetH = (d.budget / max) * height;
          const isCurrentMonth = i === new Date().getMonth();
          return (
            <g key={d.label}>
              {/* Budget bar (light gray) */}
              {d.budget > 0 && <rect x={x + barW + gap} y={height - budgetH} width={barW} height={budgetH} rx={2}
                fill="#CBD5E1" opacity={0.8} />}
              {/* Actual bar (burgundy) */}
              {d.actual > 0 && <rect x={x} y={height - actualH} width={barW} height={actualH} rx={2}
                fill={isCurrentMonth ? "#A3224A" : "#C4526A"} opacity={0.9} />}
              {/* Variance dot — red if actual < budget by >10% */}
              {d.actual > 0 && d.budget > 0 && d.actual < d.budget * 0.9 && (
                <circle cx={x + barW / 2} cy={height - actualH - 6} r={3} fill="#EF4444" />
              )}
              <text x={x + barW + 2} y={height + 14} textAnchor="middle" fontSize={8} fill={isCurrentMonth ? "#A3224A" : "#9CA3AF"}
                fontWeight={isCurrentMonth ? "bold" : "normal"}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#A3224A" }} />Actual</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-300" />Budget</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />Below target</span>
      </div>
    </div>
  );
}

// ─── Stacked horizontal bar ───────────────────────────────────────────────────
function StackedBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, sg) => s + sg.value, 0);
  if (total === 0) return null;
  let x = 0;
  return (
    <div>
      <div className="flex rounded-full overflow-hidden h-7">
        {segments.filter(sg => sg.value > 0).map(sg => {
          const pct = (sg.value / total) * 100;
          const el = (
            <div key={sg.label} style={{ width: `${pct}%`, backgroundColor: sg.color }}
              title={`${sg.label}: ${fmt$(sg.value)} (${Math.round(pct)}%)`} />
          );
          return el;
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.filter(sg => sg.value > 0).map(sg => (
          <div key={sg.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: sg.color }} />
            <span className="font-medium">{sg.label}</span>
            <span className="font-mono">{fmt$(sg.value)} · {Math.round((sg.value/total)*100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KPICard({ icon, label, value, sub, subColor }: {
  icon: string; label: string; value: string; sub?: string; subColor?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">{label}</span>
      </div>
      <div className="text-2xl font-bold font-mono" style={{ color: "#1C2340" }}>{value}</div>
      {sub && <div className={`text-xs mt-1 ${subColor ?? "text-muted-foreground"}`}>{sub}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function HomePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stock, setStock] = useState<FPMovement[]>([]);
  const [budget, setBudget] = useState<Record<number, number>>(BUDGET_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [quoteIdx] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [revUnit, setRevUnit] = useState<"usd" | "cases">("usd");

  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const yearStart = `${today.getFullYear()}-01-01`;

  useEffect(() => {
    (async () => {
      const [ordersRes, stockRes, budgetRes] = await Promise.all([
        supabase.from("customer_orders").select("*"),
        supabase.from("fp_movements").select("*"),
        supabase.from("budget_lines").select("*").eq("year", 2026),
      ]);
      setOrders(ordersRes.data ?? []);
      setStock(stockRes.data ?? []);
      if (budgetRes.data && budgetRes.data.length > 0) {
        const b: Record<number, number> = {};
        for (const row of budgetRes.data) b[row.month_num] = Number(row.budget_net) || 0;
        setBudget(b);
      }
      setLoading(false);
    })();
  }, []);

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const invoiced = useMemo(() => orders.filter(o => o.status === "Invoiced"), [orders]);

  const revenueMTD = useMemo(() =>
    invoiced.filter(o => o.invoice_date && o.invoice_date >= monthStart && o.invoice_date <= monthEnd)
      .reduce((s, o) => s + (Number(o.net_sales) || 0), 0), [invoiced, monthStart, monthEnd]);

  const CASE_KEYS = ["wd_cases","pw_cases","hm_cases","matcha_cases","xd_cases","wm_cases"] as const;
  const casesMTD = useMemo(() =>
    invoiced.filter(o => o.invoice_date && o.invoice_date >= monthStart && o.invoice_date <= monthEnd)
      .reduce((s, o) => s + CASE_KEYS.reduce((cs, k) => cs + (Number(o[k]) || 0), 0), 0),
  [invoiced, monthStart, monthEnd]);

  const pendingToCollect = useMemo(() => {
    // Per distributor terms: UNFI/KeHe/RFD = 30d, Rainforest = 60d
    const terms: Record<string, number> = { UNFI: 30, KeHe: 30, RFD: 30, Rainforest: 60, Direct: 30, Other: 30 };
    return invoiced.filter(o => {
      if (!o.invoice_date) return false;
      const t = terms[o.distributor] ?? 30;
      const cutoff = new Date(today.getTime() - t * 86400000).toISOString().slice(0, 10);
      return o.invoice_date >= cutoff;
    }).reduce((s, o) => s + (Number(o.net_sales) || 0), 0);
  }, [invoiced, today]);

  const avgFillRate = useMemo(() => {
    const withFR = invoiced.filter(o => o.fill_rate != null);
    if (withFR.length === 0) return null;
    return withFR.reduce((s, o) => s + Number(o.fill_rate), 0) / withFR.length;
  }, [invoiced]);

  const openOrders = useMemo(() =>
    orders.filter(o => ["Open", "Acknowledged", "Shipment"].includes(o.status)).length, [orders]);

  // ── Current stock ────────────────────────────────────────────────────────────
  const currentStock = useMemo(() => {
    const s: Record<string, number> = {};
    for (const m of stock) {
      const sku = m.sku;
      if (!sku) continue;
      s[sku] = (s[sku] ?? 0) + (m.type === "In" ? Number(m.cases) : -Number(m.cases));
    }
    return s;
  }, [stock]);

  // ── Monthly actual + budget chart ───────────────────────────────────────────
  const monthlySales = useMemo(() => {
    const byMonth: Record<number, number> = {};
    for (const o of invoiced) {
      if (!o.invoice_date || !o.invoice_date.startsWith("2026")) continue;
      const m = parseInt(o.invoice_date.slice(5, 7));
      byMonth[m] = (byMonth[m] ?? 0) + (Number(o.net_sales) || 0);
    }
    return MONTHS.map((label, i) => ({
      label,
      actual: Math.round(byMonth[i + 1] ?? 0),
      budget: Math.round(budget[i + 1] ?? 0),
    }));
  }, [invoiced, budget]);

  // ── YTD by distributor ───────────────────────────────────────────────────────
  const ytdByDist = useMemo(() => {
    const byDist: Record<string, number> = {};
    for (const o of invoiced) {
      if (!o.invoice_date || !o.invoice_date.startsWith("2026")) continue;
      byDist[o.distributor] = (byDist[o.distributor] ?? 0) + (Number(o.net_sales) || 0);
    }
    return DISTRIBUTORS.map(d => ({ label: d, value: Math.round(byDist[d] ?? 0), color: DIST_COLORS[d] }))
      .filter(d => d.value > 0);
  }, [invoiced]);

  const ytdTotal = ytdByDist.reduce((s, d) => s + d.value, 0);

  // ── Current month by distributor ─────────────────────────────────────────────
  const monthByDist = useMemo(() => {
    const byDist: Record<string, number> = {};
    // Invoiced this month
    for (const o of invoiced) {
      if (!o.invoice_date || o.invoice_date < monthStart || o.invoice_date > monthEnd) continue;
      byDist[o.distributor] = (byDist[o.distributor] ?? 0) + (Number(o.net_sales) || 0);
    }
    // Open orders (pending ship) for current month
    const openNet = orders
      .filter(o => ["Open","Acknowledged","Shipment"].includes(o.status))
      .reduce((s, o) => s + (Number(o.net_sales) || 0), 0);

    const segs = DISTRIBUTORS.map(d => ({ label: d, value: Math.round(byDist[d] ?? 0), color: DIST_COLORS[d] }))
      .filter(d => d.value > 0);
    if (openNet > 0) segs.push({ label: "Open (pending ship)", value: Math.round(openNet), color: "#F59E0B" });
    return segs;
  }, [invoiced, orders, monthStart, monthEnd]);

  const monthTotal = monthByDist.reduce((s, d) => s + d.value, 0);

  const quote = QUOTES[quoteIdx];

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-muted-foreground">Loading…</div>
  );

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "#1C2340" }}>Welcome back, Juan</h1>
        <p className="text-sm text-muted-foreground">{today.toLocaleDateString("en-US", { month: "long", year: "numeric" })} overview</p>
      </div>

      {/* Quote */}
      <div className="rounded-2xl border-l-4 border-l-[#A3224A] bg-card px-5 py-4 shadow-sm flex items-start justify-between gap-4">
        <div>
          <p className="text-sm italic text-foreground">"{quote.text}"</p>
          <p className="text-xs text-muted-foreground mt-1">— {quote.author}</p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Revenue with $ / Units toggle */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">💰</span>
              <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Revenue MTD</span>
            </div>
            <div className="flex rounded-full border border-border overflow-hidden text-[10px] font-semibold">
              <button onClick={() => setRevUnit("usd")}
                className={`px-2 py-0.5 ${revUnit === "usd" ? "text-white" : "text-muted-foreground"}`}
                style={revUnit === "usd" ? { backgroundColor: "#1C2340" } : {}}>$</button>
              <button onClick={() => setRevUnit("cases")}
                className={`px-2 py-0.5 ${revUnit === "cases" ? "text-white" : "text-muted-foreground"}`}
                style={revUnit === "cases" ? { backgroundColor: "#1C2340" } : {}}>Units</button>
            </div>
          </div>
          <div className="text-2xl font-bold font-mono" style={{ color: "#1C2340" }}>
            {revUnit === "usd" ? fmtFull$(revenueMTD) : casesMTD.toLocaleString()}
          </div>
          <div className="text-xs mt-1 text-muted-foreground">
            {revUnit === "usd" ? `${MONTHS[today.getMonth()]} ${today.getFullYear()} · net sales` : "cases invoiced this month"}
          </div>
        </div>

        <KPICard icon="⏳" label="Pending to Collect"
          value={fmtFull$(pendingToCollect)}
          sub="Invoiced · within payment terms"
          subColor="text-orange-500" />
        <KPICard icon="✅" label="Fill Rate"
          value={avgFillRate != null ? `${avgFillRate.toFixed(1)}%` : "—"}
          sub={avgFillRate != null ? (avgFillRate >= 97 ? "On target" : avgFillRate >= 90 ? "Below target" : "⚠️ Action needed") : "No BOLs confirmed yet"}
          subColor={avgFillRate == null ? "text-muted-foreground" : avgFillRate >= 97 ? "text-emerald-600" : avgFillRate >= 90 ? "text-orange-500" : "text-red-600"} />
        <KPICard icon="📦" label="Open Orders"
          value={String(openOrders)}
          sub="Open + Acknowledged + Shipment" />
      </div>

      {/* Weekly Meeting section */}
      <div className="rounded-2xl overflow-hidden border border-border shadow-sm">
        <div className="flex items-center justify-between px-6 py-4" style={{ backgroundColor: "#1C2340" }}>
          <div>
            <h2 className="text-base font-bold text-white">Weekly Meeting · {MONTHS[today.getMonth()]} {today.getFullYear()}</h2>
            <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>Actual sales · updated to today</p>
          </div>
        </div>

        <div className="bg-card p-6 grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Monthly sales chart actual vs budget */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "#1C2340" }}>Monthly Sales · Actual vs Budget 2026</h3>
              <span className="text-xs text-muted-foreground">$ USD · net sales</span>
            </div>
            <DualBarChart data={monthlySales} height={140} />
          </div>

          {/* YTD by distributor */}
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "#1C2340" }}>YTD Sales Breakdown · by distributor</h3>
              <span className="text-xs font-mono font-semibold" style={{ color: "#A3224A" }}>
                Total {fmt$(ytdTotal)}
              </span>
            </div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">2026 YTD Sales</div>
            <StackedBar segments={ytdByDist} />
          </div>

          {/* Current month by distributor */}
          <div className="rounded-xl border border-border p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "#1C2340" }}>
                {MONTHS[today.getMonth()]} {today.getFullYear()} · by distributor
              </h3>
              <span className="text-xs font-mono font-semibold" style={{ color: "#A3224A" }}>
                Actual + Open · Total {fmt$(monthTotal)}
              </span>
            </div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{MONTHS[today.getMonth()]} {today.getFullYear()}</div>
            <StackedBar segments={monthByDist} />
          </div>

        </div>
      </div>

      {/* Stock summary (simple) */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-semibold mb-4" style={{ color: "#1C2340" }}>Current Stock · Lineage Newark</h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {["XD","PW","HM","Matcha","WM","WD"].map(sku => {
            const qty = Math.round(currentStock[sku] ?? 0);
            const isLow = qty < 500;
            const isCrit = qty < 200;
            return (
              <div key={sku} className={`rounded-xl border p-3 text-center ${isCrit ? "border-red-200 bg-red-50" : isLow ? "border-orange-200 bg-orange-50" : "border-border"}`}>
                <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">{sku}</div>
                <div className={`text-lg font-bold font-mono ${isCrit ? "text-red-600" : isLow ? "text-orange-500" : "text-foreground"}`}>
                  {qty.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">cases</div>
                {isCrit && <div className="text-[9px] font-bold text-red-600 mt-1">CRITICAL</div>}
                {!isCrit && isLow && <div className="text-[9px] font-bold text-orange-500 mt-1">LOW</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget CSV uploader */}
      <details className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <summary className="px-5 py-3 text-sm font-semibold cursor-pointer text-muted-foreground hover:text-foreground select-none">
          ⚙️ Update Budget · <span className="font-normal text-xs">upload CSV to replace budget targets</span>
        </summary>
        <div className="px-5 pb-5 pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground mb-3">
            CSV format: <code className="bg-muted px-1 rounded text-xs">year, month_num, month, budget_gross, budget_net</code>.
            Replaces all budget rows for the uploaded year. Current budget: 2026 Best Estimate.
          </p>
          <BudgetUploader onUploaded={() => window.location.reload()} />
        </div>
      </details>
    </div>
  );
}

// ─── Budget CSV Uploader ──────────────────────────────────────────────────────
function BudgetUploader({ onUploaded }: { onUploaded: () => void }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function handleFile(file: File) {
    setStatus("loading");
    try {
      const text = await file.text();
      const lines = text.trim().split("\n");
      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(line => {
        const vals = line.split(",").map(v => v.trim());
        const row: Record<string, string | number> = {};
        headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
        return {
          year: parseInt(String(row.year)),
          month_num: parseInt(String(row.month_num)),
          month: String(row.month),
          budget_gross: parseFloat(String(row.budget_gross)) || 0,
          budget_net: parseFloat(String(row.budget_net)) || 0,
        };
      }).filter(r => r.year > 0 && r.month_num > 0);

      if (rows.length === 0) throw new Error("No valid rows found");

      // Upsert all rows
      const { error } = await supabase.from("budget_lines").upsert(rows, { onConflict: "year,month_num" });
      if (error) throw new Error(error.message);

      setStatus("done");
      setMsg(`✅ ${rows.length} budget rows uploaded for ${rows[0].year}`);
      setTimeout(onUploaded, 1500);
    } catch (e) {
      setStatus("error");
      setMsg(`❌ ${e instanceof Error ? e.message : "Upload failed"}`);
    }
  }

  return (
    <div>
      <label className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold cursor-pointer text-white ${status === "loading" ? "opacity-50 cursor-wait" : ""}`}
        style={{ backgroundColor: "#1C2340" }}>
        {status === "loading" ? "Uploading…" : "📂 Upload budget CSV"}
        <input type="file" accept=".csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </label>
      {msg && <p className="mt-2 text-xs">{msg}</p>}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
  head: () => ({ meta: [{ title: "Home · BARIS Operations Hub" }] }),
});
