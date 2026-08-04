import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useLogisticsForecast, type PricedLike } from "@/hooks/use-logistics-forecast";
import { distributorOfDc, LOW_SAMPLE, type MonthlySeriesPoint } from "./forecast";
import { norm } from "./rates";

const NAVY = "#1C2340";
const NAVY_LIGHT = "#9AA3C0";
const BURGUNDY = "#A3224A";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2)}`;

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold" style={{ color: color ?? NAVY }}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Shared chart: real months solid, forecast months light. Used in Dashboard and Forecast. */
export function SpendByMonthChart({ series, height = 300 }: { series: MonthlySeriesPoint[]; height?: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: NAVY }} />Real (POs)</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: NAVY_LIGHT }} />Forecast (Sales)</span>
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-40} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`} />
            <Tooltip
              formatter={(v: number) => money(v)}
              labelFormatter={(l: string) => {
                const p = series.find(s => s.label === l);
                return `${l} · ${p?.isReal ? "Real" : "Forecast"}`;
              }}
            />
            <Bar dataKey="total" radius={[4, 4, 0, 0]}>
              {series.map(p => <Cell key={p.monthKey} fill={p.isReal ? NAVY : NAVY_LIGHT} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AssumptionsNote() {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="font-semibold">Supuestos del modelo de forecast</p>
      <ol className="mt-1 list-decimal space-y-0.5 pl-4">
        <li>El mix de distribuidor se asume <b>constante todos los meses</b> (KeHe 55% · UNFI 28% · Rainforest 10% · RFD 7%), porque Sales no tiene mix mes a mes.</li>
        <li><b>RFD y Other vienen juntos</b> en ese 7% en Sales. Se usa el 7% completo como RFD, tratado como Rainforest en logística, lo que sobreestima levemente Rainforest.</li>
        <li>El costo sale del <b>embarque promedio histórico</b> de cada DC (cajas y costo por embarque), no de recalcular la tarifa mes a mes.</li>
      </ol>
    </div>
  );
}

// ─── Forecast tab ─────────────────────────────────────────────────────────────
export default function LogisticsForecastTab({ priced }: { priced: PricedLike[] }) {
  const { dcRows, series, loading } = useLogisticsForecast(priced);
  const [dist, setDist] = useState("all");
  const [month, setMonth] = useState("all");

  const months = useMemo(
    () => [...new Set(dcRows.map(r => r.label))],
    [dcRows],
  );

  const rows = useMemo(() => dcRows.filter(r =>
    (dist === "all" || r.distributor === dist) && (month === "all" || r.label === month),
  ), [dcRows, dist, month]);

  const grouped = useMemo(() => {
    if (month !== "all") return rows;
    const m = new Map<string, typeof rows[number]>();
    for (const r of rows) {
      const cur = m.get(r.canonicalDc);
      if (!cur) { m.set(r.canonicalDc, { ...r, label: "All months" }); continue; }
      cur.cases += r.cases; cur.shipments += r.shipments;
      cur.flete += r.flete; cur.noFlete += r.noFlete; cur.total += r.total;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [rows, month]);

  const k = useMemo(() => {
    const f = dcRows;
    const cases = f.reduce((s, r) => s + r.cases, 0);
    const flete = f.reduce((s, r) => s + r.flete, 0);
    const noFlete = f.reduce((s, r) => s + r.noFlete, 0);
    const total = flete + noFlete;
    return { cases, flete, noFlete, total, perCase: cases ? total / cases : 0 };
  }, [dcRows]);

  const horizon = dcRows.length ? `${dcRows[0].label} → ${dcRows[dcRows.length - 1].label}` : "—";

  if (loading) return <p className="p-8 text-center text-muted-foreground">Loading forecast model…</p>;

  return (
    <div className="grid gap-4">
      <AssumptionsNote />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Total forecast" value={money(k.total)} sub={horizon} color={BURGUNDY} />
        <Kpi label="Forecast cases" value={Math.round(k.cases).toLocaleString()} />
        <Kpi label="Avg cost / case" value={money2(k.perCase)} color={BURGUNDY} />
        <Kpi label="Freight" value={money(k.flete)} sub={k.total ? `${((k.flete / k.total) * 100).toFixed(0)}% del total` : undefined} />
        <Kpi label="Non-freight" value={money(k.noFlete)} sub={k.total ? `${((k.noFlete / k.total) * 100).toFixed(0)}% del total` : undefined} />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-bold" style={{ color: NAVY }}>Logistics cost — real + forecast</h3>
        <p className="mb-3 text-xs text-muted-foreground">Jan 2026 onward. Live: recalculates whenever the Sales forecast changes.</p>
        <SpendByMonthChart series={series} height={320} />
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-bold" style={{ color: NAVY }}>Forecast breakdown by DC</h3>
          <select value={dist} onChange={e => setDist(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs">
            <option value="all">All distributors</option>
            {["KeHe", "UNFI", "Rainforest"].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs">
            <option value="all">All months (total)</option>
            {months.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <span className="ml-auto text-[11px] text-muted-foreground">⚠ = menos de {LOW_SAMPLE} embarques históricos</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              {month !== "all" && <th className="px-3 py-2 text-left">Month</th>}
              <th className="px-3 py-2 text-left">DC</th>
              <th className="px-3 py-2 text-left">Distributor</th>
              <th className="px-3 py-2 text-right">Cases</th>
              <th className="px-3 py-2 text-right">Shipments</th>
              <th className="px-3 py-2 text-right">Freight</th>
              <th className="px-3 py-2 text-right">Non-freight</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr></thead>
            <tbody>
              {grouped.length === 0
                ? <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No rows.</td></tr>
                : grouped.map(r => (
                  <tr key={`${r.label}|${r.canonicalDc}`} className="border-t border-border/70 hover:bg-muted/40">
                    {month !== "all" && <td className="px-3 py-1.5 text-xs">{r.label}</td>}
                    <td className="px-3 py-1.5 text-xs">
                      {r.canonicalDc}
                      {r.lowSample && <span title={`Solo ${r.sample} embarques históricos`} className="ml-1 text-amber-600">⚠</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.distributor}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{r.cases.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{r.shipments}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{money(r.flete)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{money(r.noFlete)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold">{money(r.total)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr className="text-xs font-semibold text-white" style={{ backgroundColor: NAVY }}>
                <td className="px-3 py-2" colSpan={month !== "all" ? 3 : 2}>Total</td>
                <td className="px-3 py-2 text-right font-mono">{grouped.reduce((s, r) => s + r.cases, 0).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{grouped.reduce((s, r) => s + r.shipments, 0)}</td>
                <td className="px-3 py-2 text-right font-mono">{money(grouped.reduce((s, r) => s + r.flete, 0))}</td>
                <td className="px-3 py-2 text-right font-mono">{money(grouped.reduce((s, r) => s + r.noFlete, 0))}</td>
                <td className="px-3 py-2 text-right font-mono">{money(grouped.reduce((s, r) => s + r.total, 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

// ─── Rate cards for the 3 forecast tables ─────────────────────────────────────
function NumCell({ value, onSave, width = "w-24" }: { value: number | string | null; onSave: (v: number) => void; width?: string }) {
  const [v, setV] = useState(String(value ?? ""));
  return (
    <input value={v} inputMode="decimal"
      onChange={e => setV(e.target.value)}
      onBlur={() => { const n = Number(v); if (!Number.isNaN(n) && n !== Number(value)) onSave(n); }}
      className={`${width} rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/30`} />
  );
}

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold" style={{ color: NAVY }}>{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3 overflow-x-auto">{children}</div>
    </section>
  );
}

export function ForecastRateCards({ priced }: { priced: (PricedLike & { order: { distributor: string; po_date: string | null } })[] }) {
  const { book, reload, loading } = useLogisticsForecast(priced);
  const [busy, setBusy] = useState(false);

  async function save(table: "logistics_forecast_distributor_mix" | "logistics_forecast_dc_mix" | "logistics_forecast_shipment_profile", id: string, patch: Record<string, unknown>) {
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table) as any).update(patch).eq("id", id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    await reload();
  }

  /** Rebuild mixes + shipment averages from the priced PO history. */
  async function recalcFromHistory() {
    const costed = priced.filter(p => p.cost.total != null && p.cost.canonicalDc);
    if (costed.length === 0) { toast.error("No hay POs con costo calculado."); return; }
    setBusy(true);

    const perDc = new Map<string, { cases: number; cost: number; flete: number; n: number }>();
    const perDist = new Map<string, number>();
    for (const p of costed) {
      const dc = p.cost.canonicalDc as string;
      const cur = perDc.get(dc) ?? { cases: 0, cost: 0, flete: 0, n: 0 };
      cur.cases += p.cost.totalCases; cur.cost += p.cost.total ?? 0; cur.flete += p.cost.flete ?? 0; cur.n += 1;
      perDc.set(dc, cur);
      const d = distributorOfDc(dc);
      perDist.set(d, (perDist.get(d) ?? 0) + p.cost.totalCases);
    }

    const profiles = [...perDc.entries()].map(([dc, v]) => ({
      canonical_dc: dc,
      avg_cases_per_shipment: Math.round(v.cases / v.n),
      avg_cost_per_shipment: Math.round((v.cost / v.n) * 100) / 100,
      shipment_sample: v.n,
      flete_pct: v.cost ? Math.round((v.flete / v.cost) * 10000) / 10000 : 0.8,
    }));

    const totalCases = [...perDist.values()].reduce((s, v) => s + v, 0);
    const distRows = [...perDist.entries()]
      .filter(([d]) => d !== "Other")
      .map(([d, cases]) => ({ distributor: d, mix_pct: totalCases ? Math.round((cases / totalCases) * 10000) / 10000 : 0 }));

    const dcRowsNew: { distributor: string; canonical_dc: string; mix_pct: number }[] = [];
    for (const [dc, v] of perDc) {
      const d = distributorOfDc(dc);
      const denom = perDist.get(d) ?? 0;
      if (!denom || d === "Other") continue;
      dcRowsNew.push({ distributor: d, canonical_dc: dc, mix_pct: Math.round((v.cases / denom) * 10000) / 10000 });
      if (d === "Rainforest") {
        dcRowsNew.push({ distributor: "RFD", canonical_dc: dc, mix_pct: Math.round((v.cases / denom) * 10000) / 10000 });
      }
    }

    const results = await Promise.all([
      supabase.from("logistics_forecast_shipment_profile").upsert(profiles, { onConflict: "canonical_dc" }),
      supabase.from("logistics_forecast_dc_mix").upsert(dcRowsNew, { onConflict: "distributor,canonical_dc" }),
      supabase.from("logistics_forecast_distributor_mix").upsert(distRows, { onConflict: "distributor" }),
    ]);
    setBusy(false);
    const err = results.find(r => r.error)?.error;
    if (err) { toast.error(err.message); return; }
    toast.success("Modelo recalculado desde el histórico");
    await reload();
  }

  if (loading) return null;

  return (
    <div className="grid gap-4">
      {busy && <p className="text-xs text-muted-foreground">Saving…</p>}

      <Card
        title="Forecast · distributor mix"
        subtitle="Share of forecast cases per distributor. Assumed constant every month."
        action={
          <button onClick={() => void recalcFromHistory()} disabled={busy}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
            style={{ backgroundColor: BURGUNDY }}>
            Recalcular desde histórico
          </button>
        }
      >
        <table className="w-full max-w-sm text-sm">
          <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2 text-left">Distributor</th><th className="px-3 py-2 text-right">Mix (0-1)</th>
          </tr></thead>
          <tbody>{book.distMix.map(r => (
            <tr key={r.id} className="border-t border-border/70">
              <td className="px-3 py-1.5 text-xs">{r.distributor}</td>
              <td className="px-3 py-1 text-right">
                <NumCell value={r.mix_pct} onSave={v => void save("logistics_forecast_distributor_mix", r.id, { mix_pct: v })} />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>

      <Card title="Forecast · DC mix" subtitle="Share of each distributor's cases per DC (historical).">
        <table className="w-full max-w-2xl text-sm">
          <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2 text-left">Distributor</th><th className="px-3 py-2 text-left">DC</th><th className="px-3 py-2 text-right">Mix (0-1)</th>
          </tr></thead>
          <tbody>{[...book.dcMix].sort((a, b) => a.distributor.localeCompare(b.distributor) || norm(b.canonical_dc).localeCompare(norm(a.canonical_dc))).map(r => (
            <tr key={r.id} className="border-t border-border/70">
              <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.distributor}</td>
              <td className="px-3 py-1.5 text-xs">{r.canonical_dc}</td>
              <td className="px-3 py-1 text-right">
                <NumCell value={r.mix_pct} onSave={v => void save("logistics_forecast_dc_mix", r.id, { mix_pct: v })} />
              </td>
            </tr>
          ))}</tbody>
        </table>
      </Card>

      <Card title="Forecast · shipment profile" subtitle="Typical shipment per DC: cases, total cost (freight + accessorials) and the historical freight share.">
        <table className="w-full min-w-max text-sm">
          <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2 text-left">DC</th>
            <th className="px-3 py-2 text-right">Avg cases / shipment</th>
            <th className="px-3 py-2 text-right">Avg cost / shipment</th>
            <th className="px-3 py-2 text-right">Freight %</th>
            <th className="px-3 py-2 text-right">Sample</th>
          </tr></thead>
          <tbody>{book.profiles.map(r => (
            <tr key={r.id} className="border-t border-border/70">
              <td className="px-3 py-1.5 text-xs">
                {r.canonical_dc}
                {r.shipment_sample < LOW_SAMPLE && <span title="Muestra chica" className="ml-1 text-amber-600">⚠</span>}
              </td>
              <td className="px-3 py-1 text-right"><NumCell value={r.avg_cases_per_shipment} onSave={v => void save("logistics_forecast_shipment_profile", r.id, { avg_cases_per_shipment: v })} /></td>
              <td className="px-3 py-1 text-right"><NumCell value={r.avg_cost_per_shipment} onSave={v => void save("logistics_forecast_shipment_profile", r.id, { avg_cost_per_shipment: v })} /></td>
              <td className="px-3 py-1 text-right"><NumCell width="w-20" value={r.flete_pct} onSave={v => void save("logistics_forecast_shipment_profile", r.id, { flete_pct: v })} /></td>
              <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{r.shipment_sample}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}