import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  useRunwayForecast, type RunwayPeriod, type RunwayFixedCost, type RunwayEvent, type RunwayCogsPayment,
} from "@/hooks/use-runway-forecast";

declare global { interface Window { Chart: any } }

const fmt = (n: number) => {
  if (n == null || isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
};

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
  const { periods, loading, error, settings, fixedCosts, events, cogsPayments, reload } = useRunwayForecast(20);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const monthlyCanvas = useRef<HTMLCanvasElement>(null);
  const cashCanvas = useRef<HTMLCanvasElement>(null);

  const totals = useMemo(() => {
    const t = { ingreso: 0, deduccion: 0, logistica: 0, cogs: 0, fijo: 0, blando: 0 };
    for (const p of periods) {
      t.ingreso += p.ingresoDefinido + p.ingresoEstimado;
      t.deduccion += p.deduccionDefinido + p.deduccionEstimado;
      t.logistica += p.logisticaDefinido + p.logisticaEstimado;
      t.cogs += p.cogsDefinido + p.cogsEstimado;
      t.fijo += p.fijo;
      t.blando += p.blando;
    }
    return t;
  }, [periods]);

  const cashEndFinal = periods.length ? periods[periods.length - 1].cashEnd : 0;
  const cashMin = periods.length ? Math.min(...periods.map((p) => p.cashEnd)) : 0;

  // ── Monthly aggregation for the charts ──
  const monthly = useMemo(() => {
    const map: Record<string, { label: string; ingreso: number; gasto: number; cashEnd: number; order: number }> = {};
    for (const p of periods) {
      const key = `${p.start.getFullYear()}-${p.start.getMonth()}`;
      const label = p.start.toLocaleDateString("es-AR", { month: "short", year: "2-digit" });
      const ingreso = p.ingresoDefinido + p.ingresoEstimado;
      const gasto = p.deduccionDefinido + p.deduccionEstimado + p.logisticaDefinido + p.logisticaEstimado
        + p.cogsDefinido + p.cogsEstimado + p.fijo + p.blando + p.eventos;
      if (!map[key]) map[key] = { label, ingreso: 0, gasto: 0, cashEnd: 0, order: p.start.getTime() };
      map[key].ingreso += ingreso;
      map[key].gasto += gasto;
      map[key].cashEnd = p.cashEnd; // last period of the month wins
    }
    return Object.values(map).sort((a, b) => a.order - b.order);
  }, [periods]);

  useChart(monthlyCanvas, () => ({
    type: "bar",
    data: {
      labels: monthly.map((m) => m.label),
      datasets: [
        { label: "Ingresos", data: monthly.map((m) => m.ingreso), backgroundColor: "#2E7D4F", borderRadius: 4 },
        { label: "Gastos", data: monthly.map((m) => m.gasto), backgroundColor: "#A3224A", borderRadius: 4 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { y: { ticks: { callback: (v: number) => "$" + v } } } },
  }), [monthly]);

  useChart(cashCanvas, () => ({
    type: "line",
    data: {
      labels: periods.map((p) => p.label),
      datasets: [
        { label: "Cash proyectado", data: periods.map((p) => p.cashEnd), borderColor: "#1C2340", backgroundColor: "rgba(28,35,64,0.08)", fill: true, tension: 0.3, pointRadius: 3 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: (v: number) => "$" + v } } } },
  }), [periods]);

  if (loading) {
    return <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Cargando runway…</div>;
  }
  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">⚠ {error}</div>;
  }

  const colGroups = [
    { label: "Ingresos", fill: "#DCEEE3" },
    { label: "Deducción", fill: "#FBE1E7" },
    { label: "Logística", fill: "#FDEBD3" },
    { label: "COGS", fill: "#E2E7F5" },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#1C2340" }}>Runway Semanal</h1>
          <p className="text-sm text-muted-foreground">
            Cash proyectado semana a semana · Definido = ya facturado/confirmado · Estimado = forecast del Pipeline
          </p>
        </div>
        <button onClick={() => setAssumptionsOpen(true)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted flex items-center gap-1.5 mt-1">
          ⚙️ Assumptions
        </button>
      </div>

      {cashMin < 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          ⚠️ El cash proyectado cae por debajo de $0 en algún momento del horizonte — revisar timing de COGS/Fijo.
        </div>
      )}

      {assumptionsOpen && (
        <RunwayAssumptionsModal
          settings={settings} fixedCosts={fixedCosts} events={events} cogsPayments={cogsPayments}
          onClose={() => setAssumptionsOpen(false)} onSaved={reload}
        />
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total a Cobrar" value={fmt(totals.ingreso)} />
        <KPI label="Total Deducción" value={fmt(totals.deduccion)} negative />
        <KPI label="Total Logística" value={fmt(totals.logistica)} negative />
        <KPI label="Total COGS" value={fmt(totals.cogs)} negative />
        <KPI label="Total Fijo" value={fmt(totals.fijo)} negative />
        <KPI label="Total Blando" value={fmt(totals.blando)} negative />
        <KPI label="Cash Final proyectado" value={fmt(cashEndFinal)} />
        <KPI label="Cash mínimo proyectado" value={fmt(cashMin)} negative={cashMin < 0} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "#1C2340" }}>Ingresos vs Gastos por mes</h3>
          <div style={{ height: 240 }}><canvas ref={monthlyCanvas} /></div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3" style={{ color: "#1C2340" }}>Cash proyectado — semana a semana</h3>
          <div style={{ height: 240 }}><canvas ref={cashCanvas} /></div>
        </div>
      </div>

      {/* Weekly table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr>
              <th className="px-3 py-2 bg-white" colSpan={2} />
              <th colSpan={4} className="text-center text-white font-bold text-sm py-1.5" style={{ backgroundColor: "#2E7D4F" }}>COBRANZAS</th>
              <th colSpan={7} className="text-center text-white font-bold text-sm py-1.5" style={{ backgroundColor: "#A3224A" }}>GASTOS</th>
              <th className="px-3 py-2 bg-white" colSpan={2} />
            </tr>
            <tr>
              <th className="px-3 py-1 bg-white" colSpan={2} />
              {colGroups.map((g) => (
                <th key={g.label} colSpan={2} className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: g.fill, color: "#1C2340" }}>{g.label}</th>
              ))}
              <th colSpan={2} className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#EDEAE3", color: "#1C2340" }}>Expenses</th>
              <th className="text-center text-[10px] font-bold py-1" style={{ backgroundColor: "#FFF6D6", color: "#1C2340" }}>Eventos</th>
              <th className="px-3 py-1 bg-white" colSpan={2} />
            </tr>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left px-3 py-2 text-[10px] uppercase text-muted-foreground">Semana</th>
              <th className="text-right px-2 py-2 text-[10px] uppercase text-muted-foreground">Cash Inicial</th>
              <th className="text-right px-2 py-2 text-[10px]">Definido</th>
              <th className="text-right px-2 py-2 text-[10px]">Estimado</th>
              <th className="text-right px-2 py-2 text-[10px]">Definido</th>
              <th className="text-right px-2 py-2 text-[10px]">Estimado</th>
              <th className="text-right px-2 py-2 text-[10px]">Definido</th>
              <th className="text-right px-2 py-2 text-[10px]">Estimado</th>
              <th className="text-right px-2 py-2 text-[10px]">Definido</th>
              <th className="text-right px-2 py-2 text-[10px]">Estimado</th>
              <th className="text-right px-2 py-2 text-[10px]">Fijo</th>
              <th className="text-right px-2 py-2 text-[10px]">Blando</th>
              <th className="text-right px-2 py-2 text-[10px]">Especiales</th>
              <th className="text-right px-2 py-2 text-[10px] uppercase text-muted-foreground">Neto Semana</th>
              <th className="text-right px-2 py-2 text-[10px] uppercase text-muted-foreground">Cash Final</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p, i) => (
              <tr key={p.key} className={`border-t border-border/40 ${p.isGap ? "italic bg-red-50/40" : ""}`}>
                <td className="px-3 py-1.5" style={{ color: p.isGap ? "#A3224A" : "#1C2340" }}>{p.label}</td>
                <td className="text-right px-2 py-1.5 font-mono font-semibold">{fmt(p.cashStart)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.ingresoDefinido)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.ingresoEstimado)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.deduccionDefinido)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.deduccionEstimado)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.logisticaDefinido)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.logisticaEstimado)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.cogsDefinido)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.cogsEstimado)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.fijo)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.blando)}</td>
                <td className="text-right px-2 py-1.5 font-mono">{fmt(p.eventos)}</td>
                <td className="text-right px-2 py-1.5 font-mono font-semibold" style={{ color: p.neto < 0 ? "#EF4444" : "#10B981" }}>{fmt(p.neto)}</td>
                <td className="text-right px-2 py-1.5 font-mono font-bold" style={{ color: "#1C2340" }}>{fmt(p.cashEnd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20 font-bold">
              <td className="px-3 py-2" colSpan={2}>TOTAL</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.ingresoDefinido, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.ingresoEstimado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.deduccionDefinido, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.deduccionEstimado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.logisticaDefinido, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.logisticaEstimado, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.cogsDefinido, 0))}</td>
              <td className="text-right px-2 py-2 font-mono">{fmt(periods.reduce((s, p) => s + p.cogsEstimado, 0))}</td>
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
        La fila roja ("previo") suma lo que pasó entre el balance de bancos (cash inicial) y el arranque de la primera semana — no está separada del cash, ya se lo suma.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSUMPTIONS MODAL
// ═══════════════════════════════════════════════════════════════════════════
function RunwayAssumptionsModal({
  settings, fixedCosts, events, cogsPayments, onClose, onSaved,
}: {
  settings: ReturnType<typeof useRunwayForecast>["settings"];
  fixedCosts: RunwayFixedCost[];
  events: RunwayEvent[];
  cogsPayments: RunwayCogsPayment[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"settings" | "fixed" | "events" | "cogs">("settings");
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
    await supabase.from("runway_fixed_costs").insert({ label: "Nueva línea", amount: 0, timing: "eom", sort_order: fixedCosts.length + 1, active: true });
    onSaved();
  }
  async function deleteFixedCost(id: string) {
    await supabase.from("runway_fixed_costs").delete().eq("id", id);
    onSaved();
  }

  async function addEvent() {
    await supabase.from("runway_events").insert({ description: "Nuevo evento", amount: 0, event_date: new Date().toISOString().slice(0, 10) });
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

  async function addCogsPayment() {
    await supabase.from("runway_cogs_estimado_payments").insert({ payment_month: new Date().toISOString().slice(0, 10), ingredient_purchases: 0, heinlein_tolling: 0 });
    onSaved();
  }
  async function updateCogsPayment(id: string, patch: Partial<RunwayCogsPayment>) {
    await supabase.from("runway_cogs_estimado_payments").update(patch).eq("id", id);
    onSaved();
  }
  async function deleteCogsPayment(id: string) {
    await supabase.from("runway_cogs_estimado_payments").delete().eq("id", id);
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
            { id: "fixed", label: "Costos Fijos" },
            { id: "events", label: "Eventos" },
            { id: "cogs", label: "COGS Estimado" },
          ].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
              className={`px-3 py-1.5 text-xs font-semibold border-b-2 ${tab === t.id ? "border-[#A3224A] text-[#A3224A]" : "border-transparent text-muted-foreground"}`}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "settings" && (
          <div className="space-y-3">
            <Field label="Cash inicial (balance de bancos, $)" value={cashStart} onChange={setCashStart} />
            <Field label="Fecha del balance (cash inicial)" value={cashStartDate} onChange={setCashStartDate} type="date" />
            <Field label="Semanas a invoice — Open/Accepted/Sent to 3PL" value={weeks3} onChange={setWeeks3} />
            <Field label="Semanas a invoice — Shipment/BOL Confirmed" value={weeks2} onChange={setWeeks2} />
            <Field label="Blando — promedio mensual (negativo, $)" value={blando} onChange={setBlando} />
            <Field label="Logística — $/case fallback" value={logFallback} onChange={setLogFallback} />
            <button onClick={saveSettings} disabled={saving}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "#A3224A" }}>
              {saving ? "Guardando…" : "Guardar"}
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
                  <option value="day1">Día 1</option>
                  <option value="eom">Fin de mes</option>
                </select>
                <button onClick={() => deleteFixedCost(f.id)} className="text-muted-foreground hover:text-red-600 text-xs">✕</button>
              </div>
            ))}
            <button onClick={addFixedCost} className="text-xs font-semibold text-[#A3224A] hover:underline">+ Agregar línea</button>
          </div>
        )}

        {tab === "events" && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground">Ej: nuevo listing fee, slotting puntual. Monto negativo para un gasto.</p>
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
            <button onClick={addEvent} className="text-xs font-semibold text-[#A3224A] hover:underline">+ Agregar evento</button>
          </div>
        )}

        {tab === "cogs" && (
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground">
              Sincronizar manualmente desde Operations → Procurement Planning → Payments. (La próxima iteración puede automatizar esto.)
            </p>
            {cogsPayments.map((cp) => (
              <div key={cp.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
                <input type="date" defaultValue={cp.payment_month} onBlur={(e) => updateCogsPayment(cp.id, { payment_month: e.target.value })}
                  className="rounded border border-border px-2 py-1 text-xs" />
                <input type="number" defaultValue={cp.ingredient_purchases} onBlur={(e) => updateCogsPayment(cp.id, { ingredient_purchases: parseFloat(e.target.value) || 0 })}
                  className="w-32 rounded border border-border px-2 py-1 text-xs text-right font-mono" placeholder="Ingredient $" />
                <input type="number" defaultValue={cp.heinlein_tolling} onBlur={(e) => updateCogsPayment(cp.id, { heinlein_tolling: parseFloat(e.target.value) || 0 })}
                  className="w-32 rounded border border-border px-2 py-1 text-xs text-right font-mono" placeholder="Tolling $" />
                <button onClick={() => deleteCogsPayment(cp.id)} className="text-muted-foreground hover:text-red-600 text-xs">✕</button>
              </div>
            ))}
            <button onClick={addCogsPayment} className="text-xs font-semibold text-[#A3224A] hover:underline">+ Agregar pago</button>
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
