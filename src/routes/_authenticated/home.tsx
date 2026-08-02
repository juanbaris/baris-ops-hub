import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { generateWeeklyDeck } from "@/lib/weekly-deck";
import { toast } from "sonner";

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

// ─── Series colors ───────────────────────────────────────────────────────────
const C_ACTUAL = "#7EB53F";  // invoiced sales — green
const C_BUDGET = "#94A3B8";  // budget (uploaded forecast) — gray
const C_OPEN   = "#F5A623";  // open orders (not yet invoiced) — yellow

// ─── Grouped bar chart: actual / budget / open ───────────────────────────────
// Drawn in a large coordinate space (1000 wide) so labels stay crisp when scaled.
function GroupedBarChart({ data, height = 300, highlightIndex, actualLabel = "Invoiced sales" }: {
  data: { label: string; actual: number; budget: number; open?: number }[];
  height?: number;
  highlightIndex?: number;
  actualLabel?: string;
}) {
  const hasOpen = data.some(d => (d.open ?? 0) > 0);
  const rawMax = Math.max(...data.flatMap(d => [d.actual, d.budget, d.open ?? 0]), 1);
  // round axis max up to a nice number
  const step = Math.pow(10, Math.floor(Math.log10(rawMax))) / 2;
  const max = Math.ceil(rawMax / step) * step;

  const W = 1000;
  const axisW = 78;
  const top = 26;
  const bottom = 30;
  const plotW = W - axisW - 12;
  const colW = plotW / data.length;
  const series = hasOpen ? 3 : 2;
  const gap = colW * 0.05;
  const groupW = colW * 0.72;
  const barW = (groupW - gap * (series - 1)) / series;
  const H = height + top + bottom;
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: H }}>
        {ticks.map(f => {
          const y = top + height - f * height;
          return (
            <g key={f}>
              <line x1={axisW} x2={W - 12} y1={y} y2={y} stroke="#E5E7EB" strokeWidth={1} />
              <text x={axisW - 10} y={y + 4} textAnchor="end" fontSize={13} fill="#94A3B8" fontFamily="ui-monospace, monospace">
                {fmt$(max * f)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const gx = axisW + i * colW + (colW - groupW) / 2;
          const isHi = highlightIndex === i;
          const bars = [
            { v: d.actual, c: C_ACTUAL },
            { v: d.budget, c: C_BUDGET },
            ...(hasOpen ? [{ v: d.open ?? 0, c: C_OPEN }] : []),
          ];
          return (
            <g key={d.label}>
              {bars.map((b, bi) => {
                if (b.v <= 0) return null;
                const h = (b.v / max) * height;
                const x = gx + bi * (barW + gap);
                return (
                  <g key={bi}>
                    <rect x={x} y={top + height - h} width={barW} height={h} rx={2} fill={b.c} />
                    <text x={x + barW / 2} y={top + height - h - 7} textAnchor="middle" fontSize={12}
                      fill="#475569" fontFamily="ui-monospace, monospace">{fmt$(b.v)}</text>
                  </g>
                );
              })}
              <text x={gx + groupW / 2} y={top + height + 21} textAnchor="middle"
                fontSize={14} fill={isHi ? "#1C2340" : "#64748B"} fontWeight={isHi ? 700 : 400}>
                {d.label}
              </text>
            </g>
          );
        })}
        <line x1={axisW} x2={W - 12} y1={top + height} y2={top + height} stroke="#CBD5E1" strokeWidth={1.5} />
      </svg>
      <div className="flex items-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: C_ACTUAL }} />{actualLabel}</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: C_BUDGET }} />Budget</span>
        {hasOpen && <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: C_OPEN }} />Open orders</span>}
      </div>
    </div>
  );
}

// ─── Quarter comparison: grouped bars + attainment strip ─────────────────────
function QuarterCompare({ data }: { data: { label: string; actual: number; budget: number }[] }) {
  return (
    <div className="space-y-4">
      <GroupedBarChart data={data} height={260} actualLabel="Actual sales" />
      <div className="grid grid-cols-4 gap-3">
        {data.map(d => {
          const pct = d.budget > 0 ? (d.actual / d.budget) * 100 : null;
          const tone = pct == null ? "#94A3B8" : pct >= 100 ? "#15803D" : pct >= 90 ? "#B45309" : "#B91C1C";
          return (
            <div key={d.label} className="rounded-xl border border-border px-3 py-2 text-center">
              <div className="text-[11px] font-semibold" style={{ color: "#1C2340" }}>{d.label}</div>
              <div className="text-sm font-mono font-bold" style={{ color: tone }}>
                {pct == null ? "—" : `${Math.round(pct)}%`}
              </div>
              <div className="text-[10px] font-mono text-muted-foreground">
                {pct == null ? "no budget" : `${d.actual >= d.budget ? "+" : ""}${fmt$(d.actual - d.budget)}`}
              </div>
            </div>
          );
        })}
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


// ─── DC Inventory Alerts ──────────────────────────────────────────────────────
function DCAlerts() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshotDate, setSnapshotDate] = useState<string>("");

  useEffect(() => {
    (async () => {
      // Get latest snapshot date
      const { data: latest } = await supabase
        .from("dc_inventory")
        .select("snapshot_date")
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .single();

      if (!latest) { setLoading(false); return; }
      setSnapshotDate(latest.snapshot_date);

      // Get all at-risk rows from latest snapshot
      const { data } = await supabase
        .from("dc_inventory")
        .select("*")
        .eq("snapshot_date", latest.snapshot_date)
        .eq("at_risk", true)
        .order("cases_on_hand", { ascending: true });

      setAlerts(data ?? []);
      setLoading(false);
    })();
  }, []);

  if (loading) return null;
  if (alerts.length === 0) return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
      <p className="text-sm font-semibold text-emerald-700">✅ DC Inventory — No alerts as of {snapshotDate}</p>
    </div>
  );

  // Separate critical (OOS no PO) from warning
  const critical = alerts.filter(a => a.cases_on_hand === 0 && a.cases_on_po === 0);
  const warning = alerts.filter(a => a.weeks_on_hand > 0 && a.weeks_on_hand <= 4);
  const atRiskOther = alerts.filter(a => !critical.includes(a) && !warning.includes(a));

  const SKU_SHORT: Record<string, string> = {
    "Extra Dark Rasp 5oz": "XD", "Pistachio Rasp 5oz": "PW",
    "Hazelnut Rasp 5oz": "HM", "Milk & White Rasp 5oz": "WM",
    "Dark & White Rasp 5oz": "WD", "Matcha Rasp 5oz": "Matcha",
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between" style={{ backgroundColor: "#1C2340" }}>
        <div>
          <h3 className="text-sm font-bold text-white">⚠️ DC Inventory Alerts</h3>
          <p className="text-xs mt-0.5" style={{ color: "#9CA3AF" }}>
            Distributor sell-through data · snapshot {snapshotDate} · {alerts.length} alerts across {new Set(alerts.map(a => a.dc)).size} DCs
          </p>
        </div>
        <span className="rounded-full bg-red-500 text-white text-xs font-bold px-2 py-0.5">{alerts.length}</span>
      </div>

      <div className="p-4 space-y-3">
        {/* Critical: OOS no PO */}
        {critical.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wide font-bold text-red-600 mb-2">
              🔴 Critical — Out of stock, no PO ({critical.length})
            </p>
            <div className="space-y-1.5">
              {critical.map((a, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <span className="rounded-full bg-red-100 text-red-700 text-[10px] font-bold px-2 py-0.5 flex-shrink-0">
                    {SKU_SHORT[a.sku] ?? a.sku}
                  </span>
                  <span className="text-xs font-semibold text-red-800 flex-1">{a.dc}</span>
                  <span className="text-[10px] text-red-600 font-mono">{a.distributor}</span>
                  <span className="text-[10px] font-bold text-red-700">0 cases · no PO</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warning: 1-4 weeks */}
        {warning.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wide font-bold text-orange-600 mb-2">
              🟡 Warning — ≤4 weeks on hand ({warning.length})
            </p>
            <div className="space-y-1.5">
              {warning.map((a, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2">
                  <span className="rounded-full bg-orange-100 text-orange-700 text-[10px] font-bold px-2 py-0.5 flex-shrink-0">
                    {SKU_SHORT[a.sku] ?? a.sku}
                  </span>
                  <span className="text-xs font-semibold text-orange-800 flex-1">{a.dc}</span>
                  <span className="text-[10px] text-orange-600 font-mono">{a.distributor}</span>
                  <span className="text-[10px] font-bold text-orange-700">{a.weeks_on_hand}w · {a.cases_on_hand} cases</span>
                  {a.cases_on_po > 0 && <span className="text-[10px] text-emerald-600">PO: {a.cases_on_po}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* At risk other (UNFI 0.0 weeks but has cases) */}
        {atRiskOther.length > 0 && (
          <details>
            <summary className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground cursor-pointer hover:text-foreground">
              📋 Low velocity / no data — {atRiskOther.length} more DCs
            </summary>
            <div className="mt-2 space-y-1">
              {atRiskOther.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground px-1">
                  <span className="font-mono font-semibold text-[10px]">{SKU_SHORT[a.sku] ?? a.sku}</span>
                  <span>{a.dc}</span>
                  <span className="ml-auto font-mono">{a.cases_on_hand} cases</span>
                  {a.cases_on_po > 0 && <span className="text-emerald-600">+{a.cases_on_po} PO</span>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="px-5 pb-3 text-[10px] text-muted-foreground">
        Source: Fron Distributor Hub · Update weekly by uploading new snapshot
      </div>
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
  const [period, setPeriod] = useState<"month" | "quarter" | "year" | "ytd">("month");

  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth(); // 0-based
  const q = Math.floor(m / 3); // 0-based quarter

  // Period ranges
  const periodRange = useMemo(() => {
    switch (period) {
      case "month": return {
        start: new Date(y, m, 1).toISOString().slice(0, 10),
        end: new Date(y, m + 1, 0).toISOString().slice(0, 10),
        label: `${MONTHS[m]} ${y}`,
      };
      case "quarter": return {
        start: new Date(y, q * 3, 1).toISOString().slice(0, 10),
        end: new Date(y, q * 3 + 3, 0).toISOString().slice(0, 10),
        label: `Q${q + 1} ${y}`,
      };
      case "year": return {
        start: `${y}-01-01`,
        end: `${y}-12-31`,
        label: `Full year ${y}`,
      };
      case "ytd": return {
        start: `${y}-01-01`,
        end: today.toISOString().slice(0, 10),
        label: `YTD ${y}`,
      };
    }
  }, [period, y, m, q, today]);

  const monthStart = new Date(y, m, 1).toISOString().slice(0, 10);
  const monthEnd = new Date(y, m + 1, 0).toISOString().slice(0, 10);

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

  // ── KPIs — react to period ──────────────────────────────────────────────────
  const invoiced = useMemo(() => orders.filter(o => o.status === "Invoiced"), [orders]);

  const revenueForPeriod = useMemo(() =>
    invoiced.filter(o => o.invoice_date && o.invoice_date >= periodRange.start && o.invoice_date <= periodRange.end)
      .reduce((s, o) => s + (Number(o.net_sales) || 0), 0),
  [invoiced, periodRange]);

  const CASE_KEYS = ["wd_cases","pw_cases","hm_cases","matcha_cases","xd_cases","wm_cases"] as const;
  const casesForPeriod = useMemo(() =>
    invoiced.filter(o => o.invoice_date && o.invoice_date >= periodRange.start && o.invoice_date <= periodRange.end)
      .reduce((s, o) => s + CASE_KEYS.reduce((cs, k) => cs + (Number(o[k]) || 0), 0), 0),
  [invoiced, periodRange]);

  // Keep MTD for backward compat
  const revenueMTD = revenueForPeriod;
  const casesMTD = casesForPeriod;

  const pendingToCollect = useMemo(() => {
    // Correct logic: invoiced POs where invoice_date >= (today - payment_terms)
    // Meaning: not yet 30/60 days have passed since invoice
    const terms: Record<string, number> = { UNFI: 30, KeHe: 30, RFD: 30, Rainforest: 60, Direct: 30, Other: 30 };
    return invoiced.filter(o => {
      if (!o.invoice_date) return false;
      const t = terms[o.distributor] ?? 30;
      // cutoff = today - t days. If invoice_date >= cutoff → not yet collected (within terms window)
      const cutoffDate = new Date(today.getTime() - t * 86400000);
      const cutoff = cutoffDate.toISOString().slice(0, 10);
      return o.invoice_date >= cutoff;
    }).reduce((s, o) => s + (Number(o.net_sales) || 0), 0);
  }, [invoiced, today]);

  const avgFillRate = useMemo(() => {
    // Historical baseline: Jan–Jun 2026 orders averaged 96% fill rate.
    // Orders in that window without a recorded fill rate inherit the 96% baseline,
    // and the overall average blends that history with recent BOL-confirmed orders.
    const HISTORICAL_FR = 96;
    const values: number[] = [];
    for (const o of invoiced) {
      if (o.fill_rate != null) { values.push(Number(o.fill_rate)); continue; }
      const d = o.invoice_date ?? o.po_date;
      if (d && d >= "2026-01-01" && d <= "2026-06-30") values.push(HISTORICAL_FR);
    }
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
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
    // Open orders = everything not yet invoiced, bucketed by expected ship date (fallback PO date)
    const openByMonth: Record<number, number> = {};
    for (const o of orders) {
      if (o.status === "Invoiced") continue;
      const d = o.ship_est_date || o.po_date;
      if (!d || !d.startsWith("2026")) continue;
      const mn = parseInt(d.slice(5, 7));
      openByMonth[mn] = (openByMonth[mn] ?? 0) + (Number(o.net_sales) || 0);
    }
    return MONTHS.map((label, i) => ({
      label,
      actual: Math.round(byMonth[i + 1] ?? 0),
      budget: Math.round(budget[i + 1] ?? 0),
      open: Math.round(openByMonth[i + 1] ?? 0),
    }));
  }, [invoiced, orders, budget]);

  // ── Sales by Quarter ─────────────────────────────────────────────────────────
  const quarterSales = useMemo(() => {
    const byQ: Record<number, { actual: number; budget: number }> = { 1: { actual: 0, budget: 0 }, 2: { actual: 0, budget: 0 }, 3: { actual: 0, budget: 0 }, 4: { actual: 0, budget: 0 } };
    for (const o of invoiced) {
      if (!o.invoice_date || !o.invoice_date.startsWith("2026")) continue;
      const mo = parseInt(o.invoice_date.slice(5, 7));
      const qn = Math.ceil(mo / 3);
      byQ[qn].actual += Number(o.net_sales) || 0;
    }
    for (let qn = 1; qn <= 4; qn++) {
      const months = [qn * 3 - 2, qn * 3 - 1, qn * 3];
      byQ[qn].budget = months.reduce((s, mn) => s + (budget[mn] ?? 0), 0);
    }
    return [1, 2, 3, 4].map(qn => ({
      label: `Q${qn}`,
      actual: Math.round(byQ[qn].actual),
      budget: Math.round(byQ[qn].budget),
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

    const segs: { label: string; value: number; color: string }[] = DISTRIBUTORS
      .map(d => ({ label: d as string, value: Math.round(byDist[d] ?? 0), color: DIST_COLORS[d] }))
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

      {/* Period filter */}
      <div className="flex gap-1 rounded-xl bg-muted p-1 w-fit">
        {([["month", "This month"], ["quarter", `Q${q + 1}`], ["year", "Full year"], ["ytd", "YTD"]] as const).map(([val, label]) => (
          <button key={val} onClick={() => setPeriod(val)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${period === val ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            style={period === val ? { backgroundColor: "#1C2340" } : {}}>
            {label}
          </button>
        ))}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Revenue with $ / Units toggle */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">💰</span>
              <span className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground">Revenue · {periodRange.label}</span>
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
          <button
            onClick={async () => {
              try {
                setExporting(true);
                await generateWeeklyDeck({
                  monthly: monthlySales,
                  quarters: quarterSales,
                  ytdByDist,
                  year: today.getFullYear(),
                  asOf: today.toISOString().slice(0, 10),
                });
                toast.success("PowerPoint generated");
              } catch (e) {
                toast.error(`Could not generate deck: ${(e as Error).message}`);
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-60"
            style={{ backgroundColor: "#A3224A" }}>
            {exporting ? "Generating…" : "⬇ Generate PowerPoint"}
          </button>
        </div>

        <div className="bg-card p-6 grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Monthly sales chart actual vs budget */}
          <div className="rounded-xl border border-border p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "#1C2340" }}>Monthly Sales · Invoiced vs Budget vs Open 2026</h3>
              <span className="text-xs text-muted-foreground">$ USD · net sales</span>
            </div>
            <GroupedBarChart data={monthlySales} height={320} highlightIndex={today.getMonth()} />
          </div>

          {/* Sales by Quarter */}
          <div className="rounded-xl border border-border p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: "#1C2340" }}>Sales by Quarter · 2026</h3>
              <span className="text-xs text-muted-foreground">Actual vs Budget</span>
            </div>
            <QuarterCompare data={quarterSales} />
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

      {/* AI Search */}

      {/* DC Inventory Alerts */}
      <DCAlerts />

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
