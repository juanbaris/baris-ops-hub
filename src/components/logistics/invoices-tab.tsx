// src/components/logistics/invoices-tab.tsx
//
// Tab nuevo de Logística: carga de facturas reales (con confirmación humana),
// historial buscable, y vista Supply Chain (real acumulado + forecast simple
// 9%/1%/storage, con la mezcla del mes corriente).
//
// Autocontenido: no depende de helpers de otros archivos (define los suyos).

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2, Upload, FileText, AlertTriangle } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { totalCasesOf } from "./rates";
import {
  buildSupplyChainSeries, forecastByMonth, CATEGORY_LABEL,
  type InvoiceCategory,
} from "./invoices";
import { useLogisticsInvoices, type NewInvoiceInput } from "@/hooks/use-logistics-invoices";

import { useSalesForecast } from "@/hooks/use-sales-forecast";

type Order = Database["public"]["Tables"]["customer_orders"]["Row"];

const NAVY = "#1C2340";
const BURGUNDY = "#A3224A";
const GREEN = "#15803D";
const BLUE = "#93A4D4";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2)}`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const prettyMonth = (k: string) => { const [y,m] = k.split("-"); return `${MONTHS[Number(m)-1]} ${y.slice(2)}`; };
const currentMonthKey = () => new Date().toISOString().slice(0, 7);

const CARRIERS = ["Lineage", "KeHe"] as const;
const CATEGORIES: InvoiceCategory[] = ["freight", "accessorial", "storage_receipt", "storage_renewal"];

// ── input helpers ────────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
const inputCls = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

export default function InvoicesTab({ orders }: { orders: Order[] }) {
  const [panel, setPanel] = useState<"facturas" | "supply">("facturas");
  return (
    <div>
      <div className="mb-4 inline-flex gap-1 rounded-xl bg-muted p-1">
        {[["facturas","Facturas"],["supply","Supply Chain"]].map(([id,label]) => (
          <button key={id} onClick={() => setPanel(id as typeof panel)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${panel===id ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            style={panel===id ? { backgroundColor: BURGUNDY } : {}}>
            {label}
          </button>
        ))}
      </div>
      {panel === "facturas" ? <FacturasPanel orders={orders} /> : <SupplyChainPanel />}
    </div>
  );
}

// ═══ Panel 1: carga + historial ════════════════════════════════════════════════
const BLANK: NewInvoiceInput = {
  invoice_number: "", invoice_date: currentMonthKey() + "-01",
  carrier: "Lineage", category: "freight", canonical_dc: null,
  cases: null, pallets: null, weight_lb: null,
  freight_base: null, fuel: null, detention: null, lumper: null,
  charges: null, total_charged: 0, bol: null, po_ref: null, pdf_path: null,
};

function FacturasPanel({ orders }: { orders: Order[] }) {
  const inv = useLogisticsInvoices();
  const [form, setForm] = useState<NewInvoiceInput>(BLANK);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");

  const orderLookup = useMemo(
    () => orders.map(o => ({ id: o.id, po_number: o.po_number, totalCases: totalCasesOf(o) })),
    [orders],
  );
  const dup = form.invoice_number.trim() !== "" && inv.exists(form.invoice_number.trim());
  const isStorage = form.category.startsWith("storage");

  function set<K extends keyof NewInvoiceInput>(k: K, v: NewInvoiceInput[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }
  const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

  async function save() {
    if (!form.invoice_number.trim()) return toast.error("Falta el N° de factura");
    if (dup) return toast.error("Esa factura ya está cargada");
    if (!form.total_charged || form.total_charged <= 0) return toast.error("Falta el TOTAL (PLEASE PAY THIS AMOUNT)");
    setSaving(true);
    try {
      let pdf_path = form.pdf_path;
      if (file) pdf_path = await inv.uploadPdf(form.invoice_number.trim(), file);
      await inv.saveInvoice({ ...form, invoice_number: form.invoice_number.trim(), pdf_path }, orderLookup);
      toast.success("Factura cargada y confirmada");
      setForm(BLANK); setFile(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Error guardando la factura");
    } finally { setSaving(false); }
  }

  const linkCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of inv.links) m.set(l.invoice_id, (m.get(l.invoice_id) ?? 0) + 1);
    return m;
  }, [inv.links]);

  const list = useMemo(() => inv.invoices.filter(i => {
    if (catFilter !== "all" && i.category !== catFilter) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      return [i.invoice_number, i.canonical_dc, i.po_ref, i.bol].some(v => (v ?? "").toLowerCase().includes(s));
    }
    return true;
  }), [inv.invoices, catFilter, q]);

  return (
    <div className="space-y-6">
      {/* ── formulario de carga ── */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Upload className="h-4 w-4" style={{ color: BURGUNDY }} />
          <h3 className="text-sm font-semibold" style={{ color: NAVY }}>Cargar factura</h3>
          <span className="text-xs text-muted-foreground">— confirmá los datos antes de guardar</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="N° Factura">
            <input className={inputCls} value={form.invoice_number}
              onChange={e => set("invoice_number", e.target.value)} />
          </Field>
          <Field label="Fecha">
            <input type="date" className={inputCls} value={form.invoice_date}
              onChange={e => set("invoice_date", e.target.value)} />
          </Field>
          <Field label="Carrier">
            <select className={inputCls} value={form.carrier}
              onChange={e => set("carrier", e.target.value as NewInvoiceInput["carrier"])}>
              {CARRIERS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Categoría">
            <select className={inputCls} value={form.category}
              onChange={e => set("category", e.target.value as InvoiceCategory)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>

          {!isStorage && <>
            <Field label="DC (canónico)">
              <input className={inputCls} value={form.canonical_dc ?? ""}
                onChange={e => set("canonical_dc", e.target.value || null)} />
            </Field>
            <Field label="PO(s) — coma">
              <input className={inputCls} value={form.po_ref ?? ""} placeholder="1327361, 246901…"
                onChange={e => set("po_ref", e.target.value || null)} />
            </Field>
            <Field label="BOL">
              <input className={inputCls} value={form.bol ?? ""}
                onChange={e => set("bol", e.target.value || null)} />
            </Field>
            <Field label="Cases">
              <input className={inputCls} inputMode="numeric" value={form.cases ?? ""}
                onChange={e => set("cases", num(e.target.value))} />
            </Field>
          </>}

          {form.category === "freight" && <>
            <Field label="Peso (lb)">
              <input className={inputCls} inputMode="decimal" value={form.weight_lb ?? ""}
                onChange={e => set("weight_lb", num(e.target.value))} />
            </Field>
            <Field label="Pallets">
              <input className={inputCls} inputMode="numeric" value={form.pallets ?? ""}
                onChange={e => set("pallets", num(e.target.value))} />
            </Field>
            <Field label="Freight base">
              <input className={inputCls} inputMode="decimal" value={form.freight_base ?? ""}
                onChange={e => set("freight_base", num(e.target.value))} />
            </Field>
            <Field label="Fuel">
              <input className={inputCls} inputMode="decimal" value={form.fuel ?? ""}
                onChange={e => set("fuel", num(e.target.value))} />
            </Field>
            <Field label="Detention">
              <input className={inputCls} inputMode="decimal" value={form.detention ?? ""}
                onChange={e => set("detention", num(e.target.value))} />
            </Field>
            <Field label="Lumper">
              <input className={inputCls} inputMode="decimal" value={form.lumper ?? ""}
                onChange={e => set("lumper", num(e.target.value))} />
            </Field>
          </>}

          {/* TOTAL — resaltado (regla de oro: PLEASE PAY THIS AMOUNT, no Gross/Net) */}
          <Field label="TOTAL (PLEASE PAY THIS AMOUNT)">
            <input className={`${inputCls} border-[#15803D] bg-[#15803D]/5 font-mono font-bold`}
              inputMode="decimal" value={form.total_charged || ""}
              onChange={e => set("total_charged", Number(e.target.value) || 0)} />
          </Field>
          <Field label="PDF (opcional)">
            <input type="file" accept="application/pdf" className="text-xs"
              onChange={e => setFile(e.target.files?.[0] ?? null)} />
          </Field>
        </div>

        {isStorage && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            Storage: cargá en TOTAL la suma del "Summary Of charges" (= PLEASE PAY THIS AMOUNT), NO el Gross/Net de la mercadería.
          </p>
        )}
        {dup && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
            <AlertTriangle className="h-3.5 w-3.5" /> Esa factura ya existe — no se puede duplicar.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={saving || dup}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            style={{ backgroundColor: BURGUNDY }}>
            {saving ? "Guardando…" : "Confirmar y guardar"}
          </button>
          <span className="text-xs text-muted-foreground">
            El monto suma al REAL del mes de la fecha. Freight/Accesorial matchea la(s) PO(s) del pipeline.
          </span>
        </div>
      </div>

      {/* ── historial ── */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h3 className="text-sm font-semibold" style={{ color: NAVY }}>Historial de facturas</h3>
          <input className={inputCls} placeholder="Buscar factura / DC / PO / BOL…" value={q}
            onChange={e => setQ(e.target.value)} />
          <select className={inputCls} value={catFilter} onChange={e => setCatFilter(e.target.value)}>
            <option value="all">Todas las categorías</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <span className="ml-auto text-xs text-muted-foreground">{list.length} facturas</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">Fecha</th><th className="pr-3">N° Factura</th><th className="pr-3">Carrier</th>
                <th className="pr-3">Categoría</th><th className="pr-3">DC</th><th className="pr-3 text-right">Total</th>
                <th className="pr-3 text-center">POs</th><th className="pr-3">PDF</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.map(i => (
                <tr key={i.id} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 font-mono text-xs">{i.invoice_date}</td>
                  <td className="pr-3 font-mono text-xs">{i.invoice_number}{i.is_supplemental && <span className="ml-1 text-amber-600">·supl</span>}</td>
                  <td className="pr-3">{i.carrier}</td>
                  <td className="pr-3 text-xs">{CATEGORY_LABEL[i.category]}</td>
                  <td className="pr-3 text-xs">{i.canonical_dc ?? "—"}</td>
                  <td className="pr-3 text-right font-mono">{money2(i.total_charged)}</td>
                  <td className="pr-3 text-center text-xs">{linkCount.get(i.id) ?? 0}</td>
                  <td className="pr-3">
                    {i.pdf_path
                      ? <button className="text-xs underline" style={{ color: BURGUNDY }}
                          onClick={async () => { const u = await inv.signedPdfUrl(i.pdf_path!); if (u) window.open(u, "_blank"); }}>
                          <FileText className="inline h-3.5 w-3.5" />
                        </button>
                      : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td>
                    <button onClick={async () => { if (confirm(`¿Borrar factura ${i.invoice_number}?`)) { await inv.deleteInvoice(i.id); toast.success("Borrada"); } }}
                      className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">Sin facturas.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══ Panel 2: Supply Chain (real + forecast) ═══════════════════════════════════
type SettingRow = { key: string; number_value: number | null };
const FROM_KEY = "2026-01";

function SupplyChainPanel() {
  const inv = useLogisticsInvoices();
  const sales = useSalesForecast();
  const [freightPct, setFreightPct] = useState(0.09);
  const [accPct, setAccPct] = useState(0.01);
  const [storageAvg, setStorageAvg] = useState(0);
  const [bucket, setBucket] = useState<"total" | "freight" | "accessorial" | "storage">("total");

  // cargar assumptions
  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("runway_settings").select("key, number_value");
      const map = new Map<string, number>((data ?? []).map((s: SettingRow) => [s.key, Number(s.number_value ?? 0)]));
      setFreightPct(map.get("logi_freight_pct_sales") ?? 0.09);
      setAccPct(map.get("logi_accessorial_pct_sales") ?? 0.01);
      setStorageAvg(map.get("logi_storage_monthly_avg") ?? 0);
    })();
  }, []);
  // autocompletar storage promedio con el real si la assumption está en 0
  useEffect(() => { if (!storageAvg && inv.storageAvg) setStorageAvg(inv.storageAvg); }, [inv.storageAvg]); // eslint-disable-line

  async function saveSetting(key: string, value: number) {
    await (supabase as any).from("runway_settings")
      .upsert({ key, number_value: value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    toast.success("Assumption guardada");
  }

  // gross sales $ por mes desde el forecast de ventas (revenue = cases × $37)
  const months = useMemo(
    () => (sales.effectiveForecast ?? []).map((f: any) => ({
      monthKey: `${f.year}-${String(f.month).padStart(2, "0")}`,
      grossSales: Number(f.revenue ?? f.totalCases * 37) || 0,
    })),
    [sales.effectiveForecast],
  );

  const forecast = useMemo(
    () => forecastByMonth(months, { freightPctSales: freightPct, accessorialPctSales: accPct, storageMonthlyAvg: storageAvg }),
    [months, freightPct, accPct, storageAvg],
  );
  const series = useMemo(
    () => buildSupplyChainSeries(inv.real, forecast, currentMonthKey(), FROM_KEY),
    [inv.real, forecast],
  );

  const chartData = useMemo(() => series.map(p => ({
    label: prettyMonth(p.monthKey),
    real: p.real[bucket],
    pending: p.pending[bucket],
  })), [series, bucket]);

  const totals = useMemo(() => {
    let real = 0, fc = 0;
    for (const p of series) { real += p.real.total; fc += p.shown.total; }
    return { real, fc };
  }, [series]);

  return (
    <div className="space-y-4">
      {/* assumptions */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <Field label="Freight (% gross sales)">
          <input className={`${inputCls} w-24`} value={freightPct}
            onChange={e => setFreightPct(Number(e.target.value) || 0)}
            onBlur={() => saveSetting("logi_freight_pct_sales", freightPct)} />
        </Field>
        <Field label="Accesorial (% gross sales)">
          <input className={`${inputCls} w-24`} value={accPct}
            onChange={e => setAccPct(Number(e.target.value) || 0)}
            onBlur={() => saveSetting("logi_accessorial_pct_sales", accPct)} />
        </Field>
        <Field label="Storage ($/mes prom.)">
          <input className={`${inputCls} w-28`} value={storageAvg}
            onChange={e => setStorageAvg(Number(e.target.value) || 0)}
            onBlur={() => saveSetting("logi_storage_monthly_avg", storageAvg)} />
        </Field>
        <span className="text-xs text-muted-foreground">Storage real últimos 6 meses: {money(inv.storageAvg)}/mes</span>
        <div className="ml-auto flex gap-1 rounded-lg bg-muted p-1">
          {(["total","freight","accessorial","storage"] as const).map(b => (
            <button key={b} onClick={() => setBucket(b)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${bucket===b ? "text-white" : "text-muted-foreground"}`}
              style={bucket===b ? { backgroundColor: NAVY } : {}}>{b === "total" ? "Total" : b}</button>
          ))}
        </div>
      </div>

      {/* chart */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold" style={{ color: NAVY }}>
            Costo supply chain — real + forecast ({bucket === "total" ? "total" : bucket})
          </h3>
          <span className="text-xs text-muted-foreground">
            Real acumulado {money(totals.real)} · total período {money(totals.fc)}
          </span>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => money(v)} />
            <Legend />
            <Bar dataKey="real" name="Real" stackId="a" fill={GREEN} radius={[0,0,0,0]} />
            <Bar dataKey="pending" name="Forecast pendiente" stackId="a" fill={BLUE} radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-xs text-muted-foreground">
          Mes corriente: el total queda fijo en el forecast; a medida que cargás facturas sube el verde (real) y baja el azul (pendiente). Al cerrar el mes queda solo el real.
        </p>
      </div>
    </div>
  );
}
