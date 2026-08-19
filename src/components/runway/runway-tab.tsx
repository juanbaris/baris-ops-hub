import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  useRunwayForecast, type RunwayPeriod, type RunwayFixedCost, type RunwayEvent, type RunwayCogsPayment,
} from "@/hooks/use-runway-forecast";
import type { Scenario } from "@/lib/sales-forecast";

declare global { interface Window { Chart: any } }

const SCENARIOS: Scenario[] = ["Pessimistic", "Normal", "Optimistic"];

const fmt = (n: number) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
};
const fmtOrBlank = (n: number) => (n === 0 ? "" : fmt(n));

function useChart(ref: React.RefObject<HTMLCanvasElement | null>, builder: () => any, deps: any[]) {
  const chartRef = useRef<any>(null);
  useEffect(() => {
    if (window.Chart) return;
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);
  useEffect(() => {
    if (!ref.current || !window.Chart) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new window.Chart(ref.current, builder());
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function KPI({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="text-[9px] uppercase tracking-widest font-semibold text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-bold font-mono" style={{ color: negative ? "#A3224A" : "#1C2340" }}>{value}</div>
    </div>
  );
}

export function RunwayTab() {
  const [scenario, setScenario] = useState<Scenario>("Normal");
  const { periods, loading, error, settings, fixedCosts, events, cogsPayments, reload } = useRunwayForecast(20, scenario);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const monthlyCanvas = useRef<HTMLCanvasElement>(null);
  const cashCanvas = useRef<HTMLCanvasElement>(null);

  const totals = useMemo(() => {
    const t = { ingreso: 0, ingresoProj: 0, deduccion: 0, deduccionProj: 0, logistica: 0, logisticaProj: 0, cogs: 0, cogsProj: 0, fijo: 0, blando: 0 };
    for (const p of periods) {
      t.ingreso += p.ingresoDefinido + p.ingresoEstimado;
      t.ingresoProj += p.ingresoProyectado;
      t.deduccion += p.deduccionDefinido + p.deduccionEstimado;
      t.deduccionProj += p.deduccionProyectado;
      t.logistica += p.logisticaDefinido + p.logisticaEstimado;
      t.logisticaProj += p.logisticaProyectado;
      t.cogs += p.cogsDefinido;
      t.cogsProj += p.cogsProyectado;
      t.fijo += p.fijo;
      t.blando += p.blando;
    }
    return t;
  }, [periods]);

  const cashEndFinal = periods.length ? periods[periods.length - 1].cashEnd : 0;
  const cashMin = periods.length ? Math.min(...periods.map((p) => p.cashEnd)) : 0;

  // ── Monthly aggregation for the charts ──
  const monthly = useMemo(() => {
    const map: Record<string, { label: string; ingresoReal: number; ingresoProj: number; gastoReal: number; gastoProj: number; cashEnd: number; order: number }> = {};
    for (const p of periods) {
      const key = `${p.start.getFullYear()}-${p.start.getMonth()}`;
      const label = p.start.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      const iReal = p.ingresoDefinido + p.ingresoEstimado;
      const gReal = p.deduccionDefinido + p.deduccionEstimado + p.logisticaDefinido + p.logisticaEstimado + p.cogsDefinido + p.fijo + p.blando + p.eventos;
      const iProj = p.ingresoProyectado;
      const gProj = p.deduccionProyectado + p.logisticaProyectado + p.cogsProyectado;
      if (!map[key]) map[key] = { label, ingresoReal: 0, ingresoProj: 0, gastoReal: 0, gastoProj: 0, cashEnd: 0, order: p.start.getTime() };
      map[key].ingresoReal += iReal;
      map[key].ingresoProj += iProj;
      map[key].gastoReal += gReal;
      map[key].gastoProj += gProj;
      map[key].cashEnd = p.cashEnd;
    }
    return Object.values(map).sort((a, b) => a.order - b.order);
  }, [periods]);

  useChart(monthlyCanvas, () => ({
    type: "line",
    data: {
      labels: monthly.map((m) => m.label),
      datasets: [
        { label: "Inflows (Real)", data: monthly.map((m) => m.ingresoReal), borderColor: "#2E7D4F", backgroundColor: "#2E7D4F", tension: 0.3, pointRadius: 3, borderWidth: 2 },
        { label: "Inflows (Proj)", data: monthly.map((m) => m.ingresoProj), borderColor: "#7C3AED", backgroundColor: "#7C3AED", tension: 0.3, pointRadius: 3, borderWidth: 2, borderDash: [5, 4] },
        { label: "Outflows (Real)", data: monthly.map((m) => Math.abs(m.gastoReal)), borderColor: "#A3224A", backgroundColor: "#A3224A", tension: 0.3, pointRadius: 3, borderWidth: 2 },
        { label: "Net", data: monthly.map((m) => m.ingresoReal + m.ingresoProj + m.gastoReal + m.gastoProj), borderColor: "#1C2340", backgroundColor: "#1C2340", tension: 0.3, pointRadius: 3, borderWidth: 2, borderDash: [3, 3] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom" },
        tooltip: { callbacks: { label: (c: any) => `${c.dataset.label}: $${Math.round(c.parsed.y).toLocaleString("en-US")}` } },
      },
      scales: { y: { ticks: { callback: (v: number) => "$" + Math.round(v).toLocaleString("en-US") } } },
    },
  }), [monthly]);

  useChart(cashCanvas, () => ({
    type: "line",
    data: {
      labels: periods.map((p) => p.label),
      datasets: [
        { label: "Projected cash", data: periods.map((p) => p.cashEnd), borderColor: "#1C2340", backgroundColor: "rgba(28,35,64,0.08)", fill: true, tension: 0.3, pointRadius: 3 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v: number) => "$" + Math.round(v).toLocaleString("en-US") } } } },
  }), [periods]);

  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Loading runway…</div>;
  }
  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">⚠ {error}</div>;
  }

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#1C2340" }}>Weekly Runway</h1>
          <p className="text-sm text-muted-foreground">
            Week-by-week projected cash · Confirmed = invoiced · Estimated = pipeline · <span style={{ color: "#7C3AED" }}>Projected = Sales Forecast ({scenario})</span>
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
            {SCENARIOS.map((s) => (
              <button key={s} onClick={() => setScenario(s)}
                className={`px-3 py-1.5 ${scenario === s ? "text-white" : "text-muted-foreground hover:bg-muted"}`}
                style={scenario === s ? { backgroundColor: "#7C3AED" } : undefined}>
                {s}
              </button>
            ))}
          </div>
          <button onClick={() => setAssumptionsOpen(true)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted flex items-center gap-1.5">
            ⚙️ Assumptions
          </button>
        </div>
      </div>

      {cashMin < 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          ⚠️ Projected cash drops below $0 at some point in the horizon — review COGS/fixed cost timing.
        </div>
      )}

      {assumptionsOpen && (
        <RunwayAssumptionsModal
          settings={settings} fixedCosts={fixedCosts} events={events}
          onClose={() => setAssumptionsOpen(false)} onSaved={reload}
        />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Collections (Real)" value={fmt(totals.ingreso)} />
        <KPI label="Collections (Projected)" value={fmt(totals.ingresoProj)} />
        <KPI label="IP & Production (Confirmed)" value={fmt(totals.cogs)} negative />
        <KPI label="IP & Production (Projected)" value={fmt(totals.cogsProj)} negative />
        <KPI label="Total Fixed" value={fmt(totals.fijo)} negative />
        <KPI label="Total Soft Costs" value={fmt(totals.blando)} negative />
        <KPI label="Projected Ending Cash" value={fmt(cashEndFinal)} />
        <KPI label="Minimum Projected Cash" value={fmt(cashMin)} negative={cashMin < 0} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "#1C2340" }}>Inflows vs Outflows vs Net — monthly</h3>
          <div style={{ height: 240 }}><canvas ref={monthlyCanvas} /></div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "#1C2340" }}>Projected cash — week by week</h3>
          <div style={{ height: 240 }}><canvas ref={cashCanvas} /></div>
        </div>
      </div>

      {/* Weekly table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr>
              <th className="px-3 py-2 bg-white" colSpan={2} />
              <th colSpan={5} className="text-center text-white font-bold text-sm py-1.5" style={{ backgroundColor: "#2E7D4F" }}>COLLECTIONS</th>
              <th colSpan={8} className="text-center text-white font-bold text-sm py-1.5" style={{ backgroundColor: "#A3224A" }}>EXPENSES</th>
              <th className="px-3 py-2 bg-white" colSpan={3} />
            </tr>
            <tr>
              <th className="px-3 py-1 bg-white" colSpan={2} />
              <th colSpan={3} className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#DCEEE3", color: "#1C2340" }}>Revenue</th>
              <th colSpan={2} className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#FBE1E7", color: "#1C2340" }}>Deductions</th>
              <th colSpan={2} className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#FDEBD3", color: "#1C2340" }}>Logistics</th>
              <th colSpan={2} className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#E2E7F5", color: "#1C2340" }}>IP &amp; Production</th>
              <th colSpan={2} className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#EDEAE3", color: "#1C2340" }}>Expenses</th>
              <th className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#FFF6D6", color: "#1C2340" }}>Events</th>
              <th className="px-3 py-1 bg-white" colSpan={3} />
            </tr>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2 text-[10px] uppercase text-muted-foreground">Week</th>
              <th className="text-right px-2 py-2 text-[10px] uppercase text-muted-foreground">Opening Cash</th>
              <th className="text-right px-2 py-2 text-[10px]">Confirmed</th>
              <th className="text-right px-2 py-2 text-[10px]">Estimated</th>
              <th className="text-right px-2 py-2 text-[10px]" style={{ color: "#7C3AED" }}>Projected</th>
              <th className="text-right px-2 py-2 text-[10px]">Conf+Est</th>
              <th className="text-right px-2 py-2 text-[10px]" style={{ color: "#7C3AED" }}>Projected</th>
              <th className="text-right px-2 py-2 text-[10px]">Conf+Est</th>
              <th className="text-right px-2 py-2 text-[10px]" style={{ color: "#7C3AED" }}>Projected</th>
              <th className="text-right px-2 py-2 text-[10px]">Confirmed</th>
              <th className="text-right px-2 py-2 text-[10px]" style={{ color: "#7C3AED" }}>Projected</th>
              <th className="text-right px-2 py-2 text-[10px]">Fixed</th>
              <th className="text-right px-2 py-2 text-[10px]">Soft</th>
              <th className="text-right px-2 py-2 text-[10px]">Special</th>
              <th className="text-right px-2 py-2 text-[10px] uppercase text-muted-foreground">Weekly Net</th>
              <th className="text-right px-2 py-2 text-[10px] uppercase text-muted-foreground">Ending Cash</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.key} className={`border-t border-border/40 ${p.isGap ? "italic bg-red-50/40" : ""}`}>
                <td className="px-3 py-1.5" style={{ color: p.isGap ? "#A3224A" : "#1C2340" }}>{p.label}</td>
                <td className="text-right px-2 py-1.5 font-mono font-semibold">{fmt(p.cashStart)}</td>
                {/* Revenue */}
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.ingresoDefinido)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.ingresoEstimado)}</td>
                <td className="text-right px-2 py-1.5 font-mono" style={{ color: "#7C3AED" }}>{fmtOrBlank(p.ingresoProyectado)}</td>
                {/* Deductions */}
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.deduccionDefinido + p.deduccionEstimado)}</td>
                <td className="text-right px-2 py-1.5 font-mono" style={{ color: "#7C3AED" }}>{fmtOrBlank(p.deduccionProyectado)}</td>
                {/* Logistics */}
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.logisticaDefinido + p.logisticaEstimado)}</td>
                <td className="text-right px-2 py-1.5 font-mono" style={{ color: "#7C3AED" }}>{fmtOrBlank(p.logisticaProyectado)}</td>
                {/* IP & Production */}
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.cogsDefinido)}</td>
                <td className="text-right px-2 py-1.5 font-mono" style={{ color: "#7C3AED" }}>{fmtOrBlank(p.cogsProyectado)}</td>
                {/* Expenses */}
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.fijo)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.blando)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmtOrBlank(p.eventos)}</td>
                {/* Weekly Net: Real portion + Projected portion */}
                <td className="text-right px-2 py-1.5 font-mono font-semibold whitespace-nowrap">
                  {p.netoReal !== 0 && <span style={{ color: p.netoReal < 0 ? "#EF4444" : "#10B981" }}>{fmt(p.netoReal)}</span>}
                  {p.netoReal !== 0 && p.netoProyectado !== 0 && " "}
                  {p.netoProyectado !== 0 && <span style={{ color: "#7C3AED" }}>{(p.netoProyectado > 0 ? "+" : "") + fmt(p.netoProyectado).replace("-$", "-$")}</span>}
                  {p.netoReal === 0 && p.netoProyectado === 0 && "$0"}
                </td>
                <td className="text-right px-2 py-1.5 font-mono font-bold" style={{ color: "#1C2340" }}>{fmt(p.cashEnd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20 font-bold">
              <td className="px-3 py-2" colSpan={2}>TOTAL</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.ingresoDefinido, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.ingresoEstimado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono" style={{ color: "#7C3AED" }}>{fmt(periods.reduce((s, p) => s + p.ingresoProyectado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.deduccionDefinido + p.deduccionEstimado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono" style={{ color: "#7C3AED" }}>{fmt(periods.reduce((s, p) => s + p.deduccionProyectado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.logisticaDefinido + p.logisticaEstimado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono" style={{ color: "#7C3AED" }}>{fmt(periods.reduce((s, p) => s + p.logisticaProyectado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.cogsDefinido, 0))}</td>
              <td className="text-right px-2 py-2 font-mono" style={{ color: "#7C3AED" }}>{fmt(periods.reduce((s, p) => s + p.cogsProyectado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.fijo, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.blando, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.eventos, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.neto, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(cashEndFinal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground italic">
        La fila en rojo cubre lo que falta entre el cash inicial (fecha de tu balance) y el arranque de la primera semana completa. Todo lo anterior a esa fecha se asume ya cobrado/pagado y no se cuenta.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSUMPTIONS MODAL
// ═══════════════════════════════════════════════════════════════════════════
function RunwayAssumptionsModal({
  settings, fixedCosts, events, onClose, onSaved,
}: {
  settings: ReturnType<typeof useRunwayForecast>["settings"];
  fixedCosts: RunwayFixedCost[];
  events: RunwayEvent[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"settings" | "fixed" | "events">("settings");
  const [cashStart, setCashStart] = useState(String(settings.cash_start));
  const [cashStartDate, setCashStartDate] = useState(settings.cash_start_date);
  const [weeks3, setWeeks3] = useState(String(settings.est_weeks_open_accepted));
  const [weeks2, setWeeks2] = useState(String(settings.est_weeks_bol_shipment));
  const [blando, setBlando] = useState(String(settings.blando_monthly));
  const [logFallback, setLogFallback] = useState(String(settings.logistics_fallback_per_case));
  const [saving, setSaving] = useState(false);

  async function saveSettings() {
    setSaving(true);
    const rows = [
      { key: "cash_start", number_value: parseFloat(cashStart) || 0, date_value: null },
      { key: "cash_start_date", number_value: null, date_value: cashStartDate },
      { key: "est_weeks_open_accepted", number_value: parseFloat(weeks3) || 0, date_value: null },
      { key: "est_weeks_bol_shipment", number_value: parseFloat(weeks2) || 0, date_value: null },
      { key: "blando_monthly", number_value: parseFloat(blando) || 0, date_value: null },
      { key: "logistics_fallback_per_case", number_value: parseFloat(logFallback) || 0, date_value: null },
    ];
    for (const r of rows) {
      await supabase.from("runway_settings").upsert({ ...r, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }
    setSaving(false);
    onSaved();
  }

  async function updateFixedCost(id: string, patch: Partial<RunwayFixedCost>) {
    await supabase.from("runway_fixed_costs").update(patch).eq("id", id);
    onSaved();
  }
  async function addFixedCost() {
    await supabase.from("runway_fixed_costs").insert({ label: "New line", amount: 0, timing: "eom", sort_order: fixedCosts.length + 1, active: true });
    onSaved();
  }
  async function deleteFixedCost(id: string) {
    await supabase.from("runway_fixed_costs").delete().eq("id", id);
    onSaved();
  }

  async function addEvent() {
    await supabase.from("runway_events").insert({ description: "New event", amount: 0, event_date: new Date().toISOString().slice(0, 10) });
    onSaved();
  }
  async function updateEvent(id: string, patch: Partial<RunwayEvent>) {
    await supabase.from("runway_events").update(patch).eq("id", id);
    onSaved();
  }
  async function deleteEvent(id: string) {
    await supabase.from("runway_events").delete().eq("id", id);
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-3xl p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-sm" style={{ color: "#1C2340" }}>Runway — Assumptions</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg">✕</button>
        </div>

        <div className="flex gap-1 border-b border-border">
          {[
            { id: "settings", label: "General" },
            { id: "fixed", label: "Fixed Costs" },
            { id: "events", label: "Events" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 ${tab === t.id ? "border-[#A3224A] text-[#A3224A]" : "border-transparent text-muted-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "settings" && (
          <div className="space-y-3">
            <Field label="Opening cash (bank balance, $)" value={cashStart} onChange={setCashStart} />
            <Field label="Balance date (opening cash)" value={cashStartDate} onChange={setCashStartDate} type="date" />
            <Field label="Weeks to invoice — Open/Accepted/Sent to 3PL" value={weeks3} onChange={setWeeks3} />
            <Field label="Weeks to invoice — Shipment/BOL Confirmed" value={weeks2} onChange={setWeeks2} />
            <Field label="Soft costs — monthly average (negative, $)" value={blando} onChange={setBlando} />
            <Field label="Logistics — $/case fallback" value={logFallback} onChange={setLogFallback} />
            <button onClick={saveSettings} disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#A3224A" }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}

        {tab === "fixed" && (
          <div className="space-y-2">
            {fixedCosts.map((f) => (
              <div key={f.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <input defaultValue={f.label} onBlur={(e) => updateFixedCost(f.id, { label: e.target.value })}
                  className="flex-1 rounded border border-border px-2 py-1 text-xs" />
                <input type="number" defaultValue={f.amount} onBlur={(e) => updateFixedCost(f.id, { amount: parseFloat(e.target.value) || 0 })}
                  className="w-28 rounded border border-border px-2 py-1 text-xs text-right font-mono" />
                <select defaultValue={f.timing} onChange={(e) => updateFixedCost(f.id, { timing: e.target.value as "day1" | "eom" })}
                  className="rounded border border-border px-2 py-1 text-xs">
                  <option value="day1">Day 1</option>
                  <option value="eom">End of month</option>
                </select>
                <button onClick={() => deleteFixedCost(f.id)} className="text-muted-foreground hover:text-red-600 text-xs">✕</button>
              </div>
            ))}
            <button onClick={addFixedCost} className="text-xs font-semibold text-[#A3224A] hover:underline">+ Add line</button>
          </div>
        )}

        {tab === "events" && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground">E.g. new listing fee, one-off slotting. Use a negative amount for an expense.</p>
            {events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <input defaultValue={ev.description} onBlur={(e) => updateEvent(ev.id, { description: e.target.value })}
                  className="flex-1 rounded border border-border px-2 py-1 text-xs" />
                <input type="number" defaultValue={ev.amount} onBlur={(e) => updateEvent(ev.id, { amount: parseFloat(e.target.value) || 0 })}
                  className="w-28 rounded border border-border px-2 py-1 text-xs text-right font-mono" />
                <input type="date" defaultValue={ev.event_date} onBlur={(e) => updateEvent(ev.id, { event_date: e.target.value })}
                  className="rounded border border-border px-2 py-1 text-xs" />
                <button onClick={() => deleteEvent(ev.id)} className="text-muted-foreground hover:text-red-600 text-xs">✕</button>
              </div>
            ))}
            <button onClick={addEvent} className="text-xs font-semibold text-[#A3224A] hover:underline">+ Add event</button>
          </div>
        )}

      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-40 rounded-lg border border-border px-2 py-1 text-xs text-right font-mono" />
    </div>
  );
}
