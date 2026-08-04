import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useSalesForecast } from "@/hooks/use-sales-forecast";

type FPRow = Database["public"]["Tables"]["fp_movements"]["Row"];
type IPRow = Database["public"]["Tables"]["ip_movements"]["Row"];
type SKU = Database["public"]["Enums"]["sku"];
type Warehouse = Database["public"]["Enums"]["warehouse"];
type FPConcept = Database["public"]["Enums"]["fp_concept"];
type IPConcept = Database["public"]["Enums"]["ip_concept"];
type Facility = Database["public"]["Enums"]["facility"];
type MoveType = Database["public"]["Enums"]["movement_type"];

const SKUS: SKU[] = ["XD","PW","HM","WM","WD","Matcha"];
const SKU_ITEMS: Record<SKU, string> = { XD:"88021", PW:"77670", HM:"77671", WM:"93562", WD:"23141", Matcha:"77672" };
const WAREHOUSES: Warehouse[] = ["Lineage Newark","Cold Chain","Empire","Heinlein","OOE"];
const FP_CONCEPTS: FPConcept[] = ["Production","Sale","Sample","Damage","Transfer","Free"];
const IP_CONCEPTS: IPConcept[] = ["Procurement","Consumption","Damage","Transfer"];
const FACILITIES: Facility[] = ["Heinlein","Empire","OOE"];

import { FPSummaryTab } from "@/components/fp/fp-summary-tab";
import { LotMasterTab } from "@/components/fp/lot-master-tab";

type OpsTab = "stock" | "fp" | "ip" | "production" | "cogs" | "procurement" | "summary" | "lots" | "ipsummary";

function ymd(d = new Date()) { return d.toISOString().slice(0,10); }

// ─── FP Stock Tab ─────────────────────────────────────────────────────────────
const SKU_KEYS: Record<SKU, string> = { XD:"xd_cases", PW:"pw_cases", HM:"hm_cases", WM:"wm_cases", WD:"wd_cases", Matcha:"matcha_cases" };
/** Fallback used only until the shared sales forecast is available. */
const FORECAST_FALLBACK: Record<SKU, number> = { XD:1161, PW:967, HM:696, WM:464, WD:310, Matcha:271 };

function stockStatus(available: number, woh: number) {
  if (available <= 0) return "OOS";
  if (woh < 2) return "CRITICAL";
  if (woh < 4) return "LOW";
  return "OK";
}
const STATUS_PILL: Record<string, string> = {
  OOS: "bg-red-600 text-white",
  CRITICAL: "bg-red-100 text-red-700",
  LOW: "bg-orange-100 text-orange-700",
  OK: "bg-emerald-100 text-emerald-700",
};

function FPStockTab({ movements, orders, loading }: { movements: FPRow[]; orders: any[]; loading: boolean }) {
  const { bySkuMonthKey } = useSalesForecast();
  // Next month's demand comes straight from the Sales "Forecast by SKU" tab.
  const forecastNextMonth = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    return Object.fromEntries(SKUS.map(sku => [sku, bySkuMonthKey[sku]?.[key] ?? FORECAST_FALLBACK[sku]])) as Record<SKU, number>;
  }, [bySkuMonthKey]);
  const stock = useMemo(() => {
    const map: Record<string, { sku: SKU; warehouse: Warehouse; cases: number }> = {};
    for (const r of movements) {
      const k = `${r.sku}|${r.warehouse}`;
      if (!map[k]) map[k] = { sku: r.sku as SKU, warehouse: r.warehouse as Warehouse, cases: 0 };
      map[k].cases += r.type === "In" ? Number(r.cases) : -Number(r.cases);
    }
    return Object.values(map).sort((a,b) => a.sku.localeCompare(b.sku));
  }, [movements]);

  // Summary by SKU
  const bySku = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of movements) m[r.sku] = (m[r.sku] ?? 0) + (r.type === "In" ? Number(r.cases) : -Number(r.cases));
    return m;
  }, [movements]);

  const committed = useMemo(() => {
    const m: Record<string, number> = {};
    const open = (orders ?? []).filter(o => o.status !== "Invoiced");
    for (const sku of SKUS) m[sku] = open.reduce((s,o) => s + (Number(o[SKU_KEYS[sku]]) || 0), 0);
    return m;
  }, [orders]);

  return (
    <div className="space-y-5">
      {/* SKU summary cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {SKUS.map(sku => {
          const qty = Math.round(bySku[sku] ?? 0);
          const comm = Math.round(committed[sku] ?? 0);
          const available = qty - comm;
          const fc = forecastNextMonth[sku] ?? 0;
          const woh = fc > 0 ? (available / fc) * 4 : 0;
          const st = stockStatus(available, woh);
          const isCrit = st === "CRITICAL" || st === "OOS";
          const isLow = st === "LOW";
          return (
            <div key={sku} className={`rounded-2xl border p-4 text-center shadow-sm ${isCrit ? "border-red-200 bg-red-50" : isLow ? "border-orange-200 bg-orange-50" : "border-border bg-card"}`}>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{sku}</p>
              <p className="text-[10px] text-muted-foreground">{SKU_ITEMS[sku]}</p>
              <p className={`text-xl font-bold font-mono mt-1 ${isCrit ? "text-red-600" : isLow ? "text-orange-500" : ""}`} style={!isCrit && !isLow ? {color:"#1C2340"} : {}}>
                {available.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">available cases</p>
              <p className="text-[11px] font-mono font-semibold mt-0.5" style={{color:"#1C2340"}}>{woh.toFixed(1)} wks</p>
              <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${STATUS_PILL[st]}`}>{st}</span>
            </div>
          );
        })}
      </div>

      {/* Detail by SKU × Warehouse */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>Stock by SKU × Warehouse</p>
          <p className="text-xs text-muted-foreground">Calculated from all fp_movements · last updated: {ymd()}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-left">Item #</th>
              <th className="px-4 py-2.5 text-left">Warehouse</th>
              <th className="px-4 py-2.5 text-right">Stock</th>
              <th className="px-4 py-2.5 text-right">Committed</th>
              <th className="px-4 py-2.5 text-right">Available</th>
              <th className="px-4 py-2.5 text-right">Forecast</th>
              <th className="px-4 py-2.5 text-right">WoH</th>
              <th className="px-4 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : stock.filter(s => s.cases > 0).length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No stock data yet</td></tr>
            ) : stock.filter(s => s.cases > 0).map(s => {
              const skuStock = Math.round(bySku[s.sku] ?? 0);
              const comm = Math.round(committed[s.sku] ?? 0);
              // allocate committed proportionally to this warehouse's share of SKU stock
              const share = skuStock > 0 ? s.cases / skuStock : 0;
              const rowComm = Math.round(comm * share);
              const available = Math.round(s.cases) - rowComm;
              const fc = forecastNextMonth[s.sku] ?? 0;
              const woh = fc > 0 ? (available / (fc * share || fc)) * 4 : 0;
              const st = stockStatus(available, woh);
              return (
                <tr key={`${s.sku}|${s.warehouse}`} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{s.sku}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{SKU_ITEMS[s.sku]}</td>
                  <td className="px-4 py-2">{s.warehouse}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{Math.round(s.cases).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{rowComm ? rowComm.toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{available.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{Math.round(fc * share).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{woh.toFixed(1)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_PILL[st]}`}>{st}</span>
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

// ─── FP Input Tab ─────────────────────────────────────────────────────────────
function FPInputTab({ movements, loading, onAdded }: { movements: FPRow[]; loading: boolean; onAdded: () => void }) {
  const [form, setForm] = useState({
    movement_date: ymd(), type: "In" as MoveType, sku: "XD" as SKU,
    cases: "", warehouse: "Lineage Newark" as Warehouse,
    lot_number: "", concept: "Production" as FPConcept,
    cogs_per_case: "", po_number_ref: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [filterSku, setFilterSku] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.cases || Number(form.cases) <= 0) { toast.error("Cases required"); return; }
    if (!form.lot_number && form.concept === "Production") { toast.error("Lot number required for Production"); return; }
    setSaving(true);
    const { error } = await supabase.from("fp_movements").insert({
      movement_date: form.movement_date,
      type: form.type,
      sku: form.sku,
      cases: Number(form.cases),
      warehouse: form.warehouse,
      lot_number: form.lot_number || `LOT-${form.sku}-${form.movement_date}`,
      concept: form.concept,
      cogs_per_case: form.cogs_per_case ? Number(form.cogs_per_case) : null,
      po_number_ref: form.po_number_ref || null,
      notes: form.notes || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`FP movement added: ${form.type} ${form.cases} cases ${form.sku}`);
    setForm(f => ({ ...f, cases: "", lot_number: "", cogs_per_case: "", po_number_ref: "", notes: "" }));
    onAdded();
  }

  const filtered = useMemo(() => {
    return [...movements]
      .filter(r => (filterSku === "all" || r.sku === filterSku) && (filterType === "all" || r.type === filterType))
      .sort((a,b) => sortDir === "desc" ? (a.movement_date < b.movement_date ? 1 : -1) : (a.movement_date > b.movement_date ? 1 : -1));
  }, [movements, filterSku, filterType, sortDir]);

  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>New FP Movement</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Date</label>
            <input type="date" className={`${inp} mt-1`} value={form.movement_date} onChange={e => set("movement_date", e.target.value)} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Type</label>
            <select className={`${inp} mt-1`} value={form.type} onChange={e => set("type", e.target.value)}>
              <option value="In">In</option><option value="Out">Out</option>
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">SKU</label>
            <select className={`${inp} mt-1`} value={form.sku} onChange={e => set("sku", e.target.value)}>
              {SKUS.map(s => <option key={s} value={s}>{s} ({SKU_ITEMS[s as SKU]})</option>)}
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Cases *</label>
            <input type="number" className={`${inp} mt-1 font-mono`} value={form.cases} min={1}
              onChange={e => set("cases", e.target.value)} placeholder="0" /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Warehouse</label>
            <select className={`${inp} mt-1`} value={form.warehouse} onChange={e => set("warehouse", e.target.value)}>
              {WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Lot # {form.concept === "Production" ? "*" : ""}
          </label>
            <input className={`${inp} mt-1 font-mono`} value={form.lot_number} onChange={e => set("lot_number", e.target.value)}
              placeholder={form.concept === "Production" ? "Required" : "Optional"} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Concept</label>
            <select className={`${inp} mt-1`} value={form.concept} onChange={e => set("concept", e.target.value)}>
              {FP_CONCEPTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">COGS/case ($)</label>
            <input type="number" className={`${inp} mt-1 font-mono`} value={form.cogs_per_case}
              onChange={e => set("cogs_per_case", e.target.value)} placeholder="Optional" step="0.01" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">PO Ref</label>
            <input className={`${inp} mt-1 font-mono`} value={form.po_number_ref} onChange={e => set("po_number_ref", e.target.value)} placeholder="Optional" /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Notes</label>
            <input className={`${inp} mt-1`} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Optional" /></div>
        </div>
        <button onClick={save} disabled={saving}
          className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{backgroundColor:"#A3224A"}}>
          {saving ? "Saving…" : `+ Add ${form.type} · ${form.cases || "?"} cases ${form.sku}`}
        </button>
      </div>

      {/* Movements table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>FP Movements <span className="text-muted-foreground font-normal text-xs">({filtered.length} records)</span></p>
          <div className="flex gap-2">
            <select value={filterSku} onChange={e => setFilterSku(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
              <option value="all">All SKUs</option>
              {SKUS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
              <option value="all">In + Out</option>
              <option value="In">In only</option>
              <option value="Out">Out only</option>
            </select>
            <button onClick={() => setSortDir(d => d === "desc" ? "asc" : "desc")}
              className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted">
              Date {sortDir === "desc" ? "▼" : "▲"}
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Date</th>
              <th className="px-4 py-2.5 text-left">Type</th>
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-right">Cases</th>
              <th className="px-4 py-2.5 text-left">Warehouse</th>
              <th className="px-4 py-2.5 text-left">Lot</th>
              <th className="px-4 py-2.5 text-left">Concept</th>
              <th className="px-4 py-2.5 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No movements match filters</td></tr>
              : filtered.map(r => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-1.5 font-mono text-xs">{r.movement_date}</td>
                  <td className="px-4 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.type === "In" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                      {r.type}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 font-semibold" style={{color:"#1C2340"}}>{r.sku}</td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold">{Number(r.cases).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-muted-foreground text-xs">{r.warehouse}</td>
                  <td className="px-4 py-1.5 font-mono text-xs" style={{color:"#A3224A"}}>{r.lot_number}</td>
                  <td className="px-4 py-1.5 text-xs">{r.concept}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground truncate max-w-[200px]">{r.notes ?? "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── I&P Input Tab ────────────────────────────────────────────────────────────
function IPInputTab({ movements, loading, onAdded }: { movements: IPRow[]; loading: boolean; onAdded: () => void }) {
  const [form, setForm] = useState({
    movement_date: ymd(), material: "", vendor: "",
    type: "In" as MoveType, quantity: "", unit: "lbs",
    lot_number: "", concept: "Procurement" as IPConcept,
    warehouse: "Heinlein",
    total_price: "", shipping_price: "", other_costs: "",
    estimated_receive_date: "", estimated_payment_date: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<IPRow | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [filterConcept, setFilterConcept] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [filterMaterial, setFilterMaterial] = useState("all");
  const [sortCol, setSortCol] = useState<"date"|"material"|"qty">("date");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  const qty   = parseFloat(form.quantity)       || 0;
  const total = parseFloat(form.total_price)    || 0;
  const ship  = parseFloat(form.shipping_price) || 0;
  const other = parseFloat(form.other_costs)    || 0;
  const pricePerUnit = qty > 0 ? total / qty : 0;
  const cogsPerUnit  = qty > 0 ? (total + ship + other) / qty : 0;

  async function save() {
    if (!form.material) { toast.error("Material required"); return; }
    if (!form.quantity || Number(form.quantity) === 0) { toast.error("Quantity required"); return; }
    setSaving(true);
    const payload: any = {
      movement_date: form.movement_date,
      material: form.material,
      vendor: form.vendor || null,
      type: form.type,
      quantity: Number(form.quantity),
      unit: form.unit,
      lot_number: form.lot_number || null,
      concept: form.concept,
      notes: form.notes || null,
      warehouse: form.warehouse || null,
      total_price: total || null,
      shipping_price: ship || null,
      other_costs: other || null,
      price_per_unit: pricePerUnit || null,
      cogs_per_unit: cogsPerUnit || null,
      estimated_receive_date: form.estimated_receive_date || null,
      estimated_payment_date: form.estimated_payment_date || null,
    };
    const res = editing
      ? await supabase.from("ip_movements").update(payload).eq("id", editing.id)
      : await supabase.from("ip_movements").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(editing ? "I&P movement updated" : `Added: ${form.type} ${form.quantity} ${form.unit} ${form.material}`);
    setEditing(null);
    setForm(f => ({
      ...f, quantity: "", lot_number: "", notes: "",
      total_price: "", shipping_price: "", other_costs: "",
      estimated_receive_date: "", estimated_payment_date: "",
    }));
    onAdded();
  }

  function startEdit(r: IPRow) {
    setEditing(r);
    const rr = r as any;
    setForm({
      movement_date: r.movement_date,
      material: r.material,
      vendor: r.vendor ?? "",
      type: r.type as MoveType,
      quantity: String(r.quantity),
      unit: r.unit ?? "lbs",
      lot_number: r.lot_number ?? "",
      concept: r.concept as IPConcept,
      warehouse: rr.warehouse ?? "Heinlein",
      total_price: rr.total_price != null ? String(rr.total_price) : "",
      shipping_price: rr.shipping_price != null ? String(rr.shipping_price) : "",
      other_costs: rr.other_costs != null ? String(rr.other_costs) : "",
      estimated_receive_date: rr.estimated_receive_date ?? "",
      estimated_payment_date: rr.estimated_payment_date ?? "",
      notes: r.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() { setEditing(null); }

  async function remove(id: string) {
    const { error } = await supabase.from("ip_movements").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setConfirmId(null);
    toast.success("Movement deleted");
    onAdded();
  }

  async function toggleFlag(r: IPRow, flag: "received" | "paid") {
    const rr = r as any;
    const current: boolean = rr[flag] ?? false;
    const dateCol = flag === "received" ? "actual_receive_date" : "actual_payment_date";
    const patch: any = { [flag]: !current };
    if (!current) patch[dateCol] = ymd();
    else patch[dateCol] = null;
    const { error } = await supabase.from("ip_movements").update(patch).eq("id", r.id);
    if (error) toast.error(error.message);
    else onAdded();
  }

  function dateIndicator(estDate: string | null | undefined, done: boolean, actualDate: string | null | undefined) {
    if (done) return { color: "text-emerald-600", bg: "bg-emerald-50", label: actualDate ? actualDate.slice(5) : "✓" };
    if (!estDate) return { color: "text-muted-foreground", bg: "", label: "—" };
    const days = Math.ceil((new Date(estDate).getTime() - Date.now()) / 86400000);
    if (days < 0)  return { color: "text-red-600",    bg: "bg-red-50",    label: `${Math.abs(days)}d late` };
    if (days <= 7) return { color: "text-orange-600", bg: "bg-orange-50", label: `${days}d` };
    return              { color: "text-emerald-600", bg: "", label: estDate.slice(5) };
  }

  const materials = useMemo(() => [...new Set(movements.map(r => r.material))].sort(), [movements]);

  const filtered = useMemo(() => {
    return [...movements]
      .filter(r =>
        (filterConcept  === "all" || r.concept  === filterConcept) &&
        (filterType     === "all" || r.type     === filterType) &&
        (filterMaterial === "all" || r.material === filterMaterial)
      )
      .sort((a, b) => {
        let cmp = 0;
        if (sortCol === "date")     cmp = a.movement_date.localeCompare(b.movement_date);
        if (sortCol === "material") cmp = a.material.localeCompare(b.material);
        if (sortCol === "qty")      cmp = Number(a.quantity) - Number(b.quantity);
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [movements, filterConcept, filterType, filterMaterial, sortCol, sortDir]);

  function toggleSort(col: "date"|"material"|"qty") {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const IP_WAREHOUSES = ["Heinlein","Empire","Lineage Newark","Long Grove","FreezPak","OOE"];
  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";
  const Lbl = ({ children }: { children: React.ReactNode }) => (
    <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{children}</label>
  );
  const SortTh = ({ col, label }: { col: "date"|"material"|"qty"; label: string }) => (
    <th className="px-3 py-2.5 text-left cursor-pointer select-none hover:text-foreground"
      onClick={() => toggleSort(col)}>
      <span className="flex items-center gap-1">
        {label}
        <span className="text-[10px]">{sortCol === col ? (sortDir === "desc" ? "↓" : "↑") : "↕"}</span>
      </span>
    </th>
  );

  return (
    <div className="space-y-5">
      {/* ── Form ── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        {editing && (
          <div className="mb-3 rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{ borderColor:"#A3224A", color:"#A3224A", backgroundColor:"#A3224A10" }}>
            Editing: {editing.material} — {editing.movement_date}
          </div>
        )}
        <h3 className="text-sm font-bold mb-4" style={{ color:"#1C2340" }}>
          {editing ? "Edit I&P Movement" : "New I&P Movement"}
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><Lbl>Date</Lbl>
            <input type="date" className={`${inp} mt-1`} value={form.movement_date}
              onChange={e => set("movement_date", e.target.value)} /></div>
          <div><Lbl>Type</Lbl>
            <select className={`${inp} mt-1`} value={form.type} onChange={e => set("type", e.target.value)}>
              <option value="In">In</option><option value="Out">Out</option>
            </select></div>
          <div><Lbl>Concept</Lbl>
            <select className={`${inp} mt-1`} value={form.concept} onChange={e => set("concept", e.target.value)}>
              {IP_CONCEPTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div><Lbl>Material *</Lbl>
            <input className={`${inp} mt-1`} value={form.material}
              onChange={e => set("material", e.target.value)} placeholder="e.g. IQF Rasp" /></div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><Lbl>Quantity *</Lbl>
            <input type="number" className={`${inp} mt-1 font-mono`} value={form.quantity}
              onChange={e => set("quantity", e.target.value)} /></div>
          <div><Lbl>Unit</Lbl>
            <select className={`${inp} mt-1`} value={form.unit} onChange={e => set("unit", e.target.value)}>
              {["lbs","kg","Piece","cases","units"].map(u => <option key={u} value={u}>{u}</option>)}
            </select></div>
          <div><Lbl>Vendor</Lbl>
            <input className={`${inp} mt-1`} value={form.vendor}
              onChange={e => set("vendor", e.target.value)} placeholder="e.g. Blommer" /></div>
          <div><Lbl>Warehouse</Lbl>
            <select className={`${inp} mt-1`} value={form.warehouse} onChange={e => set("warehouse", e.target.value)}>
              {IP_WAREHOUSES.map(w => <option key={w} value={w}>{w}</option>)}
            </select></div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><Lbl>Lot #</Lbl>
            <input className={`${inp} mt-1 font-mono`} value={form.lot_number}
              onChange={e => set("lot_number", e.target.value)} /></div>
        </div>

        <div className="rounded-xl border border-border bg-muted/20 p-3 mb-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Pricing</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><label className="text-[10px] text-muted-foreground">Total price ($)</label>
              <input type="number" step="0.01" className={`${inp} mt-1 font-mono`}
                value={form.total_price} onChange={e => set("total_price", e.target.value)} placeholder="0.00" /></div>
            <div><label className="text-[10px] text-muted-foreground">Shipping ($)</label>
              <input type="number" step="0.01" className={`${inp} mt-1 font-mono`}
                value={form.shipping_price} onChange={e => set("shipping_price", e.target.value)} placeholder="0.00" /></div>
            <div><label className="text-[10px] text-muted-foreground">Other costs ($)</label>
              <input type="number" step="0.01" className={`${inp} mt-1 font-mono`}
                value={form.other_costs} onChange={e => set("other_costs", e.target.value)} placeholder="0.00" /></div>
            <div className="rounded-lg bg-card border border-border p-2">
              <label className="text-[10px] text-muted-foreground">Price / unit</label>
              <p className="font-mono font-semibold text-sm mt-0.5" style={{ color:"#1C2340" }}>
                {pricePerUnit > 0 ? `$${pricePerUnit.toFixed(4)}` : "—"}
              </p>
              <p className="text-[9px] text-muted-foreground">total ÷ qty</p>
            </div>
            <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-2">
              <label className="text-[10px] text-emerald-700 font-semibold">COGS / unit</label>
              <p className="font-mono font-bold text-sm mt-0.5 text-emerald-700">
                {cogsPerUnit > 0 ? `$${cogsPerUnit.toFixed(4)}` : "—"}
              </p>
              <p className="text-[9px] text-emerald-600">(total+ship+other)÷qty</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div><Lbl>Est. receive date</Lbl>
            <input type="date" className={`${inp} mt-1`} value={form.estimated_receive_date}
              onChange={e => set("estimated_receive_date", e.target.value)} /></div>
          <div><Lbl>Est. payment date</Lbl>
            <input type="date" className={`${inp} mt-1`} value={form.estimated_payment_date}
              onChange={e => set("estimated_payment_date", e.target.value)} /></div>
          <div className="md:col-span-2"><Lbl>Notes</Lbl>
            <input className={`${inp} mt-1`} value={form.notes}
              onChange={e => set("notes", e.target.value)} placeholder="Optional" /></div>
        </div>

        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor:"#A3224A" }}>
            {saving ? "Saving…" : editing ? "Update movement"
              : `+ Add ${form.type} · ${form.quantity || "?"} ${form.unit} ${form.material || "?"}`}
          </button>
          {editing && (
            <button onClick={cancelEdit}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
          <option value="all">In + Out</option>
          <option value="In">In only</option>
          <option value="Out">Out only</option>
        </select>
        <select value={filterConcept} onChange={e => setFilterConcept(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
          <option value="all">All concepts</option>
          {IP_CONCEPTS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterMaterial} onChange={e => setFilterMaterial(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
          <option value="all">All materials</option>
          {materials.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {filtered.length} records
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <SortTh col="date" label="Date" />
              <th className="px-3 py-2.5 text-left">Type</th>
              <SortTh col="material" label="Material" />
              <SortTh col="qty" label="Qty" />
              <th className="px-3 py-2.5 text-left">Unit</th>
              <th className="px-3 py-2.5 text-left">Vendor</th>
              <th className="px-3 py-2.5 text-left">Lot</th>
              <th className="px-3 py-2.5 text-left">Warehouse</th>
              <th className="px-3 py-2.5 text-right">Total ($)</th>
              <th className="px-3 py-2.5 text-right">COGS/unit</th>
              <th className="px-3 py-2.5 text-center">Received</th>
              <th className="px-3 py-2.5 text-center">Paid</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : filtered.length === 0
              ? <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">No movements match filters</td></tr>
              : filtered.map(r => {
                const rr = r as any;
                const recv = dateIndicator(rr.estimated_receive_date, rr.received ?? false, rr.actual_receive_date);
                const paid = dateIndicator(rr.estimated_payment_date, rr.paid ?? false, rr.actual_payment_date);
                return (
                  <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono">{r.movement_date}</td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold
                        ${r.type === "In" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>
                        {r.type}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 font-semibold" style={{ color:"#1C2340" }}>{r.material}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{Number(r.quantity).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.unit}</td>
                    <td className="px-3 py-1.5" style={{ color:"#A3224A" }}>{r.vendor ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{r.lot_number ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{rr.warehouse ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono">
                      {rr.total_price ? `$${Number(rr.total_price).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold text-emerald-700">
                      {rr.cogs_per_unit ? `$${Number(rr.cogs_per_unit).toFixed(4)}` : "—"}
                    </td>
                    <td className={`px-3 py-1.5 text-center ${recv.bg}`}>
                      <div className="flex flex-col items-center gap-0.5">
                        <input type="checkbox" checked={rr.received ?? false}
                          onChange={() => toggleFlag(r, "received")}
                          className="h-3.5 w-3.5 cursor-pointer accent-emerald-600" />
                        <span className={`text-[9px] font-semibold ${recv.color}`}>{recv.label}</span>
                      </div>
                    </td>
                    <td className={`px-3 py-1.5 text-center ${paid.bg}`}>
                      <div className="flex flex-col items-center gap-0.5">
                        <input type="checkbox" checked={rr.paid ?? false}
                          onChange={() => toggleFlag(r, "paid")}
                          className="h-3.5 w-3.5 cursor-pointer accent-emerald-600" />
                        <span className={`text-[9px] font-semibold ${paid.color}`}>{paid.label}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {confirmId === r.id ? (
                        <span className="flex flex-col items-end gap-1">
                          <span className="flex items-center gap-1.5 text-xs">
                            Delete?
                            <button onClick={() => remove(r.id)}
                              className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Confirm</button>
                            <button onClick={() => setConfirmId(null)}
                              className="rounded border border-border px-2 py-0.5 text-[10px]">Cancel</button>
                          </span>
                        </span>
                      ) : (
                        <span className="flex justify-end gap-2">
                          <button onClick={() => startEdit(r)} className="text-muted-foreground hover:text-foreground">✎</button>
                          <button onClick={() => setConfirmId(r.id)} className="text-muted-foreground hover:text-red-600">🗑</button>
                        </span>
                      )}
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

// ─── I&P Summary Tab ──────────────────────────────────────────────────────────
function IPSummaryTab({ movements }: { movements: IPRow[] }) {
  const [filterMaterial, setFilterMaterial] = useState("all");

  const materials = useMemo(
    () => [...new Set(movements.map(r => r.material))].sort(),
    [movements]
  );

  const inventory = useMemo(() => {
    const map = new Map<string, {
      material: string;
      inQty: number; outQty: number; inValue: number;
      unit: string;
      lots: Map<string, { qty: number; cogs: number | null; unit: string }>;
    }>();

    for (const r of movements) {
      const rr = r as any;
      const qty   = Number(r.quantity);
      const delta = r.type === "In" ? qty : -qty;
      const cogs: number | null = rr.cogs_per_unit ?? null;
      const lot = r.lot_number ?? "—";

      if (!map.has(r.material)) {
        map.set(r.material, {
          material: r.material, inQty: 0, outQty: 0,
          inValue: 0, unit: r.unit ?? "lbs", lots: new Map(),
        });
      }
      const cur = map.get(r.material)!;
      if (r.type === "In") {
        cur.inQty += qty;
        if (cogs) cur.inValue += qty * cogs;
      } else {
        cur.outQty += qty;
      }

      const lotCur = cur.lots.get(lot) ?? { qty: 0, cogs: null, unit: r.unit ?? "lbs" };
      lotCur.qty += delta;
      if (lotCur.cogs == null && cogs != null) lotCur.cogs = cogs;
      cur.lots.set(lot, lotCur);
    }

    return [...map.values()]
      .map(m => ({ ...m, netQty: m.inQty - m.outQty }))
      .filter(m => m.netQty > 0)
      .sort((a, b) => a.material.localeCompare(b.material));
  }, [movements]);

  const shown = filterMaterial === "all"
    ? inventory
    : inventory.filter(m => m.material === filterMaterial);

  const totalValue = shown.reduce((s, m) => {
    const avgCogs = m.inQty > 0 ? m.inValue / m.inQty : 0;
    return s + m.netQty * avgCogs;
  }, 0);

  const totalIn  = movements.filter(r => r.type === "In").length;
  const totalOut = movements.filter(r => r.type === "Out").length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Active materials</p>
          <p className="text-2xl font-bold font-mono" style={{ color:"#1C2340" }}>{inventory.length}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Total movements</p>
          <p className="text-2xl font-bold font-mono" style={{ color:"#1C2340" }}>{movements.length.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">{totalIn} in · {totalOut} out</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Pending received</p>
          <p className="text-2xl font-bold font-mono text-orange-600">
            {movements.filter(r => !(r as any).received && (r as any).estimated_receive_date).length}
          </p>
          <p className="text-[10px] text-muted-foreground">with est. date, not yet ticked</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Inventory value (est.)</p>
          <p className="text-2xl font-bold font-mono" style={{ color:"#A3224A" }}>
            ${Math.round(totalValue).toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground">where COGS available</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select value={filterMaterial} onChange={e => setFilterMaterial(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
          <option value="all">All materials</option>
          {materials.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">{shown.length} materials with stock</span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{ color:"#1C2340" }}>I&P Inventory — current stock by material & lot</p>
          <p className="text-xs text-muted-foreground">Net balance from all movements · COGS = weighted average of In movements</p>
        </div>
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Material</th>
              <th className="px-4 py-2.5 text-left">Lot #</th>
              <th className="px-4 py-2.5 text-right">Net qty</th>
              <th className="px-4 py-2.5 text-left">Unit</th>
              <th className="px-4 py-2.5 text-right">COGS / unit</th>
              <th className="px-4 py-2.5 text-right">Inventory value</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No stock data yet</td></tr>
            ) : shown.map(m => {
              const avgCogs = m.inQty > 0 ? m.inValue / m.inQty : 0;
              const value   = m.netQty * avgCogs;
              const lots    = [...m.lots.entries()].filter(([, v]) => v.qty > 0);
              return (
                <React.Fragment key={m.material}>
                  <tr className="border-t-2 border-border bg-muted/10 font-semibold">
                    <td className="px-4 py-2" style={{ color:"#1C2340" }}>{m.material}</td>
                    <td className="px-4 py-2 text-muted-foreground text-[10px]">
                      {lots.length} lot{lots.length !== 1 ? "s" : ""}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">{m.netQty.toLocaleString()}</td>
                    <td className="px-4 py-2 text-muted-foreground">{m.unit}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {avgCogs > 0 ? `$${avgCogs.toFixed(4)}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-bold" style={{ color:"#A3224A" }}>
                      {value > 0 ? `$${Math.round(value).toLocaleString()}` : "—"}
                    </td>
                  </tr>
                  {lots.map(([lot, v]) => (
                    <tr key={`${m.material}|${lot}`} className="border-t border-border/40 hover:bg-muted/20">
                      <td className="px-4 py-1.5 text-muted-foreground pl-8 text-[10px]">↳</td>
                      <td className="px-4 py-1.5 font-mono" style={{ color:"#A3224A" }}>{lot}</td>
                      <td className="px-4 py-1.5 text-right font-mono">{v.qty.toLocaleString()}</td>
                      <td className="px-4 py-1.5 text-muted-foreground">{v.unit}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">
                        {v.cogs ? `$${v.cogs.toFixed(4)}` : "—"}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">
                        {v.cogs ? `$${Math.round(v.qty * v.cogs).toLocaleString()}` : "—"}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor:"#1C2340", color:"#fff" }}>
              <td className="px-4 py-2 font-semibold text-xs" colSpan={5}>TOTAL INVENTORY VALUE</td>
              <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">
                ${Math.round(totalValue).toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Production Tab ───────────────────────────────────────────────────────────
function ProductionTab({ onAdded }: { onAdded: () => void }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    run_date: ymd(), facility: "Heinlein" as Facility, sku: "XD" as SKU,
    cases_produced: "", cogs_per_case: "", lot_number: "", notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadRuns(); }, []);

  async function loadRuns() {
    const { data } = await supabase.from("production_runs").select("*").order("run_date", { ascending: false });
    setRuns(data ?? []);
    setLoading(false);
  }

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.cases_produced || Number(form.cases_produced) <= 0) { toast.error("Cases produced required"); return; }
    if (!form.lot_number) { toast.error("Lot number required for production runs"); return; }
    if (!form.cogs_per_case) { toast.error("COGS/case required"); return; }
    setSaving(true);

    // Insert production run
    const { data: runData, error } = await supabase.from("production_runs").insert({
      run_date: form.run_date,
      facility: form.facility,
      sku: form.sku,
      cases_produced: Number(form.cases_produced),
      cogs_per_case: Number(form.cogs_per_case),
      lot_number: form.lot_number,
      notes: form.notes || null,
    }).select().single();

    if (error || !runData) { toast.error(error?.message ?? "Failed"); setSaving(false); return; }

    // Auto-create fp_movements In record
    const fpWh: Warehouse = form.facility === "Heinlein" ? "Heinlein" : form.facility === "Empire" ? "Empire" : "OOE";
    await supabase.from("fp_movements").insert({
      movement_date: form.run_date,
      type: "In" as const,
      sku: form.sku,
      cases: Number(form.cases_produced),
      warehouse: fpWh,
      lot_number: form.lot_number,
      concept: "Production" as const,
      cogs_per_case: Number(form.cogs_per_case),
      notes: `Production run · ${form.facility} · ${form.run_date}`,
    });

    setSaving(false);
    toast.success(`Production run saved · ${form.cases_produced} cases ${form.sku} · FP stock updated`);
    setForm(f => ({ ...f, cases_produced: "", cogs_per_case: "", lot_number: "", notes: "" }));
    loadRuns();
    onAdded();
  }

  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>New Production Run</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Run Date</label>
            <input type="date" className={`${inp} mt-1`} value={form.run_date} onChange={e => set("run_date", e.target.value)} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Facility</label>
            <select className={`${inp} mt-1`} value={form.facility} onChange={e => set("facility", e.target.value)}>
              {FACILITIES.map(f => <option key={f} value={f}>{f}</option>)}
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">SKU</label>
            <select className={`${inp} mt-1`} value={form.sku} onChange={e => set("sku", e.target.value)}>
              {SKUS.map(s => <option key={s} value={s}>{s} ({SKU_ITEMS[s as SKU]})</option>)}
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Cases Produced *</label>
            <input type="number" className={`${inp} mt-1 font-mono`} value={form.cases_produced} min={1}
              onChange={e => set("cases_produced", e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">COGS/case ($) *</label>
            <input type="number" className={`${inp} mt-1 font-mono`} value={form.cogs_per_case}
              onChange={e => set("cogs_per_case", e.target.value)} step="0.01" placeholder="e.g. 3.21" /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Lot # *</label>
            <input className={`${inp} mt-1 font-mono`} value={form.lot_number} onChange={e => set("lot_number", e.target.value)}
              placeholder="e.g. HEI-2026-07" /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Notes</label>
            <input className={`${inp} mt-1`} value={form.notes} onChange={e => set("notes", e.target.value)} /></div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{backgroundColor:"#A3224A"}}>
            {saving ? "Saving…" : `+ Save Run · ${form.cases_produced || "?"} cases ${form.sku}`}
          </button>
          <p className="text-xs text-muted-foreground">↳ Auto-creates FP movement In on save</p>
        </div>
      </div>

      {/* Production runs table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>Production History</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Date</th>
              <th className="px-4 py-2.5 text-left">Facility</th>
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-right">Cases</th>
              <th className="px-4 py-2.5 text-right">COGS/case</th>
              <th className="px-4 py-2.5 text-right">Total COGS</th>
              <th className="px-4 py-2.5 text-left">Lot #</th>
              <th className="px-4 py-2.5 text-left">Notes</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : runs.length === 0 ? (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">
                  No production runs yet — add your first run above
                </td></tr>
              ) : runs.map(r => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-1.5 font-mono text-xs">{r.run_date}</td>
                  <td className="px-4 py-1.5">{r.facility}</td>
                  <td className="px-4 py-1.5 font-semibold" style={{color:"#1C2340"}}>{r.sku}</td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold">{Number(r.cases_produced).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">${Number(r.cogs_per_case).toFixed(2)}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-emerald-600">
                    ${Math.round(Number(r.cases_produced) * Number(r.cogs_per_case)).toLocaleString()}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-xs" style={{color:"#A3224A"}}>{r.lot_number}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── COGS Simulator Tab ───────────────────────────────────────────────────────
const BOM_DATA: Record<string, { lbs_per_case: number; ingredients: Record<string, number> }> = {
  PW:     { lbs_per_case: 2.5, ingredients: { "IQF Raspberry": 0.825, "Chocolate": 1.428, "Pistachio Paste": 0.200, "Cocoa Butter": 0.042, "Spirulina": 0.001 } },
  XD:     { lbs_per_case: 2.5, ingredients: { "IQF Raspberry": 1.125, "Chocolate": 1.375 } },
  HM:     { lbs_per_case: 2.5, ingredients: { "IQF Raspberry": 0.825, "Chocolate": 1.398, "Hazelnut Butter": 0.250, "Cocoa Butter": 0.024 } },
  WD:     { lbs_per_case: 2.5, ingredients: { "IQF Raspberry": 0.750, "Chocolate": 1.719, "Cocoa Butter": 0.029 } },
  WM:     { lbs_per_case: 2.5, ingredients: { "IQF Raspberry": 0.750, "Chocolate": 1.719, "Cocoa Butter": 0.029 } },
  Matcha: { lbs_per_case: 2.5, ingredients: { "IQF Raspberry": 1.125, "Chocolate": 1.322, "Matcha Powder": 0.022, "Cocoa Butter": 0.025 } },
};

const DEFAULT_PRICES: Record<string, number> = {
  "IQF Raspberry":   2.91,
  "Chocolate":       3.80,
  "Pistachio Paste": 9.50,
  "Hazelnut Butter": 5.20,
  "Matcha Powder":   15.00,
  "Cocoa Butter":    6.00,
  "Sea Salt":        0.50,
  "Soy Lecithin":    2.00,
  "Spirulina":       20.00,
};

const DEFAULT_TOLLING = 1.45;
const DEFAULT_PACKAGING = 0.65;

function COGSSimulatorTab() {
  const [prices, setPrices] = useState({ ...DEFAULT_PRICES });
  const [tolling, setTolling] = useState(DEFAULT_TOLLING);
  const [packaging, setPackaging] = useState(DEFAULT_PACKAGING);
  const [selectedSku, setSelectedSku] = useState<string>("XD");

  function setPrice(ingredient: string, val: string) {
    setPrices(p => ({ ...p, [ingredient]: parseFloat(val) || 0 }));
  }

  function calcCOGS(sku: string) {
    const bom = BOM_DATA[sku];
    if (!bom) return { rm: 0, total: 0, breakdown: [] };
    const breakdown = Object.entries(bom.ingredients).map(([ing, lbs]) => ({
      ingredient: ing,
      lbs,
      price: prices[ing] ?? DEFAULT_PRICES[ing] ?? 3.0,
      cost: lbs * (prices[ing] ?? DEFAULT_PRICES[ing] ?? 3.0),
    }));
    const rm = breakdown.reduce((s, b) => s + b.cost, 0);
    return { rm, total: rm + tolling + packaging, breakdown };
  }

  const allIngredients = [...new Set(Object.values(BOM_DATA).flatMap(b => Object.keys(b.ingredients)))].sort();
  const detail = calcCOGS(selectedSku);

  // Price sensitivity: what % change in each ingredient moves total COGS
  const baseCOGS = calcCOGS(selectedSku).total;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Ingredient price inputs */}
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <p className="text-sm font-bold" style={{color:"#1C2340"}}>Ingredient Prices ($/lb)</p>
            <button onClick={() => setPrices({...DEFAULT_PRICES})}
              className="rounded-lg px-3 py-1 text-xs border border-border hover:bg-muted">
              ↺ Reset
            </button>
          </div>
          <div className="divide-y divide-border/60">
            {allIngredients.map(ing => {
              const current = prices[ing] ?? DEFAULT_PRICES[ing] ?? 0;
              const def = DEFAULT_PRICES[ing] ?? 0;
              const diff = def > 0 ? ((current - def) / def * 100) : 0;
              return (
                <div key={ing} className="flex items-center justify-between px-5 py-2.5 hover:bg-muted/20">
                  <span className="text-sm">{ing}</span>
                  <div className="flex items-center gap-3">
                    {Math.abs(diff) > 0.5 && (
                      <span className={`text-[10px] font-semibold ${diff > 0 ? "text-red-500" : "text-emerald-600"}`}>
                        {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                      </span>
                    )}
                    <input type="number" step="0.01" min="0"
                      value={current}
                      onChange={e => setPrice(ing, e.target.value)}
                      className="w-20 text-right rounded-lg border border-border bg-background px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-5 py-2.5 bg-muted/10">
              <span className="text-sm text-muted-foreground">Tolling ($/case)</span>
              <input type="number" step="0.01" value={tolling} onChange={e => setTolling(parseFloat(e.target.value)||0)}
                className="w-20 text-right rounded-lg border border-border bg-background px-2 py-1 text-sm font-mono focus:outline-none" />
            </div>
            <div className="flex items-center justify-between px-5 py-2.5 bg-muted/10">
              <span className="text-sm text-muted-foreground">Packaging ($/case)</span>
              <input type="number" step="0.01" value={packaging} onChange={e => setPackaging(parseFloat(e.target.value)||0)}
                className="w-20 text-right rounded-lg border border-border bg-background px-2 py-1 text-sm font-mono focus:outline-none" />
            </div>
          </div>
        </div>

        {/* COGS breakdown for selected SKU */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3">
              <p className="text-sm font-bold" style={{color:"#1C2340"}}>COGS Breakdown</p>
              <div className="flex gap-1 ml-auto">
                {SKUS.map(s => (
                  <button key={s} onClick={() => setSelectedSku(s)}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${selectedSku === s ? "text-white" : "bg-muted text-muted-foreground"}`}
                    style={selectedSku === s ? {backgroundColor:"#A3224A"} : {}}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="divide-y divide-border/60">
              {detail.breakdown.map(b => (
                <div key={b.ingredient} className="flex items-center justify-between px-5 py-2 hover:bg-muted/20">
                  <div>
                    <span className="text-sm">{b.ingredient}</span>
                    <span className="ml-2 text-xs text-muted-foreground font-mono">{b.lbs.toFixed(3)} lbs × ${b.price.toFixed(2)}</span>
                  </div>
                  <span className="font-mono text-sm font-semibold">${b.cost.toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-5 py-2 bg-muted/10">
                <span className="text-sm text-muted-foreground">Tolling</span>
                <span className="font-mono text-sm">${tolling.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-2 bg-muted/10">
                <span className="text-sm text-muted-foreground">Packaging</span>
                <span className="font-mono text-sm">${packaging.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between px-5 py-3" style={{backgroundColor:"#1C2340"}}>
                <span className="text-sm font-bold text-white">Total COGS / case</span>
                <span className="font-mono text-lg font-bold text-emerald-400">${detail.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* GM preview at $36.96 */}
          <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Gross Margin preview at standard price</p>
            {[["UNFI/KeHe", 36.96], ["RFD", 38.50]].map(([dist, price]) => {
              const net = (price as number) * 0.82; // ~18% deductions
              const gm = ((net - detail.total) / net * 100);
              return (
                <div key={dist as string} className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
                  <span className="text-sm">{dist as string} · ${price as number}/case</span>
                  <span className={`font-mono text-sm font-bold ${gm > 30 ? "text-emerald-600" : gm > 15 ? "text-orange-500" : "text-red-500"}`}>
                    {gm.toFixed(1)}% GM
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* All SKUs comparison table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>All SKUs COGS Comparison</p>
          <p className="text-xs text-muted-foreground">Based on current prices above · Source: Super BOM 04/20/2026</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-right">RM Cost</th>
              <th className="px-4 py-2.5 text-right">Tolling</th>
              <th className="px-4 py-2.5 text-right">Packaging</th>
              <th className="px-4 py-2.5 text-right font-bold">Total COGS</th>
              <th className="px-4 py-2.5 text-right">vs Default</th>
              <th className="px-4 py-2.5 text-right">GM @ $36.96</th>
            </tr>
          </thead>
          <tbody>
            {SKUS.map(sku => {
              const r = calcCOGS(sku);
              const defaultRM = Object.entries(BOM_DATA[sku]?.ingredients ?? {})
                .reduce((s, [ing, lbs]) => s + lbs * (DEFAULT_PRICES[ing] ?? 3), 0);
              const defaultTotal = defaultRM + DEFAULT_TOLLING + DEFAULT_PACKAGING;
              const delta = r.total - defaultTotal;
              const net = 36.96 * 0.82;
              const gm = ((net - r.total) / net * 100);
              return (
                <tr key={sku} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{sku}</td>
                  <td className="px-4 py-2 text-right font-mono">${r.rm.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">${tolling.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">${packaging.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono font-bold" style={{color:"#1C2340"}}>${r.total.toFixed(2)}</td>
                  <td className={`px-4 py-2 text-right font-mono text-xs ${Math.abs(delta) < 0.01 ? "text-muted-foreground" : delta > 0 ? "text-red-500" : "text-emerald-600"}`}>
                    {Math.abs(delta) < 0.01 ? "—" : (delta > 0 ? "+" : "") + delta.toFixed(2)}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${gm > 30 ? "text-emerald-600" : gm > 15 ? "text-orange-500" : "text-red-500"}`}>
                    {gm.toFixed(1)}%
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

// ─── Procurement Planning Tab (full) ─────────────────────────────────────────
const BOM_PCT: Record<string, Record<string, number>> = {
  XD:     { "IQF Raspberry":45.0, "RASG Dark 72%":55.0 },
  WD:     { "IQF Raspberry":30.0, "Corinthian White":38.8, "RASG Dark 72%":30.0, "Cocoa Butter":1.2, "Soy Lecithin":0.1 },
  WM:     { "IQF Raspberry":30.0, "Corinthian White":38.8, "Valcour Milk":30.0,  "Cocoa Butter":1.2, "Soy Lecithin":0.1 },
  PW:     { "IQF Raspberry":33.0, "Corinthian White":57.1, "Pistachio Paste":8.0, "Cocoa Butter":1.7, "Soy Lecithin":0.04, "Sea Salt":0.05, "Spirulina":0.04 },
  HM:     { "IQF Raspberry":33.0, "Corinthian White":22.9, "Valcour Milk":33.0, "Hazelnut Paste":10.0, "Cocoa Butter":0.9, "Soy Lecithin":0.04, "Sea Salt":0.10 },
  Matcha: { "IQF Raspberry":45.0, "Corinthian White":52.9, "Matcha Powder":0.9, "Cocoa Butter":1.0, "Soy Lecithin":0.10, "Sea Salt":0.10 },
};
const LBS_PER_CASE_BOM = 2.5;
const UNITS_PER_CASE_BOM = 8;
const DEFAULT_ING_PRICES: Record<string, number> = {
  "IQF Raspberry":2.91,"RASG Dark 72%":5.50,"Corinthian White":3.20,
  "Valcour Milk":5.20,"Duluth Dark":4.88,"Pistachio Paste":17.23,
  "Hazelnut Paste":12.20,"Matcha Powder":19.50,"Spirulina":11.88,
  "Cocoa Butter":6.50,"Soy Lecithin":3.10,"Sea Salt":8.45,
};
const DEFAULT_PROD_COSTS = { tolling_per_unit:0.65, cup_per_unit:0.095, lid_per_unit:0.092, sealer_per_unit:0.030, case_per_case:0.36 };
const ING_PACK_SIZES: Record<string, number> = {
  "IQF Raspberry":22,"RASG Dark 72%":1100,"Corinthian White":1100,"Valcour Milk":1100,
  "Duluth Dark":1100,"Pistachio Paste":550,"Hazelnut Paste":550,"Matcha Powder":44,
  "Spirulina":55,"Cocoa Butter":1100,"Soy Lecithin":55,"Sea Salt":55,
};
const ALL_INGS = Object.keys(DEFAULT_ING_PRICES);
const SKU_MIX_PCT: Record<string,number> = {XD:0.30,PW:0.25,HM:0.18,WM:0.12,WD:0.08,Matcha:0.07};

const FORECAST_MONTHS_OPS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() + i);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
});
/** Month keys ("YYYY-M") aligned with FORECAST_MONTHS_OPS labels. */
const FORECAST_KEYS_OPS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + i);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
});
/** Builds the 12-month per-SKU demand from the Sales module forecast. */
function buildOpsForecast(bySkuMonthKey: Record<string, Record<string, number>>): Record<string, number[]> {
  return Object.fromEntries(SKUS.map(sku => [
    sku,
    FORECAST_KEYS_OPS.map(k => bySkuMonthKey[sku]?.[k] ?? 0),
  ]));
}

type ProcSubTab = "schedule"|"stock_proj"|"bom_cogs"|"shopping"|"raw_materials";

/** Production requirements coming from the Sales simulator (committed scenario wins). */
function CommittedRequirements() {
  const { production, isCommitted, committedLevers, committedAt, scenario } = useSalesForecast();
  const newSkuNames = useMemo(()=>{
    const set = new Set<string>();
    for(const m of production) for(const n of m.newSkuBreakdown) set.add(n.name);
    return [...set];
  },[production]);

  function exportCsv(){
    const head = ["Month",...SKUS,...newSkuNames,"TOTAL"];
    const rows = production.map(m=>[
      m.label,
      ...SKUS.map(s=>m.skuBreakdown[s]??0),
      ...newSkuNames.map(n=>m.newSkuBreakdown.find(x=>x.name===n)?.cases??0),
      m.totalCases,
    ]);
    const csv=[head,...rows].map(r=>r.join(",")).join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a=document.createElement("a");
    a.href=url; a.download="production-requirements.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div>
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Production requirements — {isCommitted?"committed scenario":"active forecast"}</p>
          {isCommitted ? (
            <p className="text-xs text-amber-700 font-semibold">
              🔒 Based on committed scenario · {committedLevers} lever{committedLevers===1?"":"s"} active
              {committedAt?` · Last updated: ${new Date(committedAt).toLocaleString()}`:""}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              ℹ️ No committed scenario — showing active forecast ({scenario}). Go to Sales → Simulador and click SET on any lever to define the production input.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link to="/sales" className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Review in Simulador
          </Link>
          <button onClick={exportCsv} className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Export CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2 text-left">Month</th>
              {SKUS.map(s=><th key={s} className="px-3 py-2 text-right">{s}</th>)}
              {newSkuNames.map(n=><th key={n} className="px-3 py-2 text-right">{n}</th>)}
              <th className="px-4 py-2 text-right font-bold">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {production.map(m=>(
              <tr key={m.label} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-4 py-1.5 font-semibold">{m.label}</td>
                {SKUS.map(s=><td key={s} className="px-3 py-1.5 text-right font-mono">{(m.skuBreakdown[s]??0).toLocaleString()}</td>)}
                {newSkuNames.map(n=><td key={n} className="px-3 py-1.5 text-right font-mono">{(m.newSkuBreakdown.find(x=>x.name===n)?.cases??0).toLocaleString()}</td>)}
                <td className="px-4 py-1.5 text-right font-mono font-bold">{m.totalCases.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function calcCOGSFull(prices: Record<string,number>, costs: typeof DEFAULT_PROD_COSTS, scrap: {raspberry:number;chocolate:number}) {
  return Object.fromEntries(SKUS.map(sku => {
    const bom = BOM_PCT[sku]??{};
    let rasp=0,choc=0,other=0;
    for (const [ing,pct] of Object.entries(bom)) {
      const lbs=(pct/100)*LBS_PER_CASE_BOM;
      const price=prices[ing]??0;
      const isRasp=ing==="IQF Raspberry";
      const isChoc=["RASG Dark 72%","Corinthian White","Valcour Milk","Duluth Dark"].includes(ing);
      const sc=isRasp?(1+scrap.raspberry):isChoc?(1+scrap.chocolate):1;
      if(isRasp) rasp+=lbs*price*sc;
      else if(isChoc) choc+=lbs*price*sc;
      else other+=lbs*price*sc;
    }
    const pkg=(costs.cup_per_unit+costs.lid_per_unit+costs.sealer_per_unit)+(costs.case_per_case/UNITS_PER_CASE_BOM);
    const per_unit=rasp/UNITS_PER_CASE_BOM+choc/UNITS_PER_CASE_BOM+other/UNITS_PER_CASE_BOM+pkg+costs.tolling_per_unit;
    return [sku,{rasp:rasp/UNITS_PER_CASE_BOM,choc:choc/UNITS_PER_CASE_BOM,other:other/UNITS_PER_CASE_BOM,pkg,tolling:costs.tolling_per_unit,per_unit,per_case:per_unit*UNITS_PER_CASE_BOM}];
  }));
}

function calcProdSchedule(stockBySku:Record<string,number>, orders:any[], safetyWoh:number, minRun:number, freqMonths:number, FORECAST_SKU_OPS:Record<string,number[]>, wipBySku:Record<string,number>={}) {
  const SK: Record<string,string>={XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"};
  const committed: Record<string,number>={};
  for(const sku of SKUS) committed[sku]=orders.reduce((s,o)=>s+(Number(o[SK[sku]])||0),0);
  const plan: Record<string,number[]>={};
  const stockProj: Record<string,number[]>={};
  const ingNeeded: Record<string,number>={};
  const ingByMonth: Record<string,number[]>={};
  for(const sku of SKUS) {
    let running=Math.max(0,(stockBySku[sku]??0)-(committed[sku]??0))+(wipBySku[sku]??0);
    plan[sku]=[]; stockProj[sku]=[];
    for(let i=0;i<FORECAST_MONTHS_OPS.length;i++) {
      const fcst=FORECAST_SKU_OPS[sku]?.[i]??0;
      const woh=fcst>0?(running/fcst)*4:99;
      let produce=0;
      const isWindow=(i%freqMonths)===0;
      if(isWindow) {
        let lookahead=running;
        for(let j=i;j<Math.min(i+freqMonths*2,FORECAST_MONTHS_OPS.length);j++) lookahead-=FORECAST_SKU_OPS[sku]?.[j]??0;
        if(lookahead<0||woh<safetyWoh) {
          const demand=FORECAST_MONTHS_OPS.slice(i,i+freqMonths).reduce((s,_,j)=>s+(FORECAST_SKU_OPS[sku]?.[i+j]??0),0);
          const buf=Math.round((safetyWoh/4)*(fcst||1));
          const needed=demand+buf-running;
          if(needed>0) produce=Math.ceil(needed/minRun)*minRun;
        }
      }
      plan[sku].push(produce);
      running=running+produce-fcst;
      stockProj[sku].push(Math.round(running));
      if(produce>0) {
        const bom=BOM_PCT[sku]??{};
        for(const [ing,pct] of Object.entries(bom)) {
          const lbs=(pct/100)*LBS_PER_CASE_BOM*produce;
          const isR=ing==="IQF Raspberry";
          const isC=["RASG Dark 72%","Corinthian White","Valcour Milk","Duluth Dark"].includes(ing);
          const qty=lbs*(isR?1.10:isC?1.08:1);
          ingNeeded[ing]=(ingNeeded[ing]??0)+qty;
          if(!ingByMonth[ing]) ingByMonth[ing]=FORECAST_MONTHS_OPS.map(()=>0);
          ingByMonth[ing][i]+=qty;
        }
      }
    }
  }
  return {plan,stockProj,ingNeeded,ingByMonth};
}

function ProcurementTab({ movements, orders }: { movements: FPRow[]; orders: any[] }) {
  const [procTab, setProcTab] = useState<ProcSubTab>("schedule");
  const [safetyWoh,  setSafetyWoh]  = useState(5);
  const [minRun,     setMinRun]     = useState(1000);
  const [freqMonths, setFreqMonths] = useState(3);
  const [ingPrices,  setIngPrices]  = useState({...DEFAULT_ING_PRICES});
  const [prodCosts,  setProdCosts]  = useState({...DEFAULT_PROD_COSTS});
  const [scrap,      setScrap]      = useState({raspberry:0.10,chocolate:0.08});
  const [ingInv,     setIngInv]     = useState<Record<string,string>>(Object.fromEntries(ALL_INGS.map(k=>[k,""])));
  // WIP = cases currently being produced (manual entry), counted as available stock.
  const WIP_KEY="baris.ops.wip.v1";
  const [wip, setWip] = useState<Record<string,{cases:string;due:string}>>(
    Object.fromEntries(SKUS.map(s=>[s,{cases:"",due:""}])));
  const [shopScope, setShopScope] = useState<"next"|"3m"|"all">("next");
  useEffect(()=>{
    try{
      const raw=window.localStorage.getItem(WIP_KEY);
      if(raw) setWip(w=>({...w,...JSON.parse(raw)}));
    }catch{/* ignore */}
  },[]);
  function updateWip(sku:string, patch:Partial<{cases:string;due:string}>){
    setWip(w=>{
      const next={...w,[sku]:{...(w[sku]??{cases:"",due:""}),...patch}};
      try{ window.localStorage.setItem(WIP_KEY, JSON.stringify(next)); }catch{/* ignore */}
      return next;
    });
  }
  const wipBySku = useMemo(()=>Object.fromEntries(SKUS.map(s=>[s,parseInt(wip[s]?.cases??"")||0])),[wip]);
  const { bySkuMonthKey } = useSalesForecast();
  const fcstOps = useMemo(()=>buildOpsForecast(bySkuMonthKey),[bySkuMonthKey]);

  const bySku = useMemo(()=>{
    const m:Record<string,number>={};
    for(const r of movements) m[r.sku]=(m[r.sku]??0)+(r.type==="In"?Number(r.cases):-Number(r.cases));
    return m;
  },[movements]);

  const {plan,stockProj,ingNeeded,ingByMonth} = useMemo(()=>calcProdSchedule(bySku,orders,safetyWoh,minRun,freqMonths,fcstOps,wipBySku),[bySku,orders,safetyWoh,minRun,freqMonths,fcstOps,wipBySku]);
  const cogs = useMemo(()=>calcCOGSFull(ingPrices,prodCosts,scrap),[ingPrices,prodCosts,scrap]);

  const totalByMonth = FORECAST_MONTHS_OPS.map((_,i)=>SKUS.reduce((s,sku)=>s+(plan[sku]?.[i]??0),0));
  const nextRunIdx = totalByMonth.findIndex(t=>t>0);
  const shopRange = useMemo(()=>{
    if(nextRunIdx<0) return null;
    if(shopScope==="next") return [nextRunIdx,nextRunIdx] as const;
    if(shopScope==="3m") return [nextRunIdx,Math.min(nextRunIdx+2,FORECAST_MONTHS_OPS.length-1)] as const;
    return [0,FORECAST_MONTHS_OPS.length-1] as const;
  },[shopScope,nextRunIdx]);
  /** Ingredient lbs required for the selected shopping-list window. */
  const ingWindow = useMemo(()=>{
    const out:Record<string,number>={};
    if(!shopRange) return out;
    for(const [ing,arr] of Object.entries(ingByMonth)){
      let s=0; for(let i=shopRange[0];i<=shopRange[1];i++) s+=arr[i]??0;
      if(s>0) out[ing]=s;
    }
    return out;
  },[ingByMonth,shopRange]);
  const shopCasesWindow = shopRange
    ? totalByMonth.slice(shopRange[0],shopRange[1]+1).reduce((a,b)=>a+b,0) : 0;
  const totalProduce = SKUS.reduce((s,sku)=>s+(plan[sku]??[]).reduce((a,b)=>a+b,0),0);
  const weightedCOGS = SKUS.reduce((s,sku)=>s+(cogs[sku]?.per_case??0)*(SKU_MIX_PCT[sku]??0),0);

  const inp="rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30";
  const SUBTABS: {id:ProcSubTab;label:string}[] = [
    {id:"schedule",label:"📅 Schedule"},{id:"stock_proj",label:"📊 Stock Projection"},
    {id:"bom_cogs",label:"🧪 BOM + COGS"},{id:"shopping",label:"🛒 Shopping List"},
    {id:"raw_materials",label:"📦 Raw Materials"},
  ];

  return (
    <div className="space-y-4">
      <CommittedRequirements />
      {/* Controls */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground">Min. safety stock</label>
            <input type="number" min={1} max={16} value={safetyWoh} onChange={e=>setSafetyWoh(Number(e.target.value))} className={`${inp} w-12 text-center`}/>
            <span className="text-xs text-muted-foreground">weeks</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground">Minimum run</label>
            <input type="number" min={500} step={500} value={minRun} onChange={e=>setMinRun(Number(e.target.value))} className={`${inp} w-20 text-center`}/>
            <span className="text-xs text-muted-foreground">cases</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground">Frequency</label>
            <select value={freqMonths} onChange={e=>setFreqMonths(Number(e.target.value))} className={`${inp} w-28`}>
              <option value={1}>Monthly</option><option value={2}>Bimonthly</option>
              <option value={3}>Quarterly</option><option value={4}>Every 4 months</option><option value={6}>Biannual</option>
            </select>
          </div>
          <div className="ml-auto flex gap-6 text-center">
            <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total to produce</p>
              <p className="text-xl font-bold font-mono" style={{color:"#A3224A"}}>{totalProduce.toLocaleString()} cases</p></div>
            <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">COGS ponderado</p>
              <p className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>${weightedCOGS.toFixed(2)}/case</p></div>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {SUBTABS.map(t=>(
          <button key={t.id} onClick={()=>setProcTab(t.id)}
            className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${procTab===t.id?"border-primary text-primary":"border-transparent text-muted-foreground"}`}
            style={procTab===t.id?{borderColor:"#A3224A",color:"#A3224A"}:{}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── SCHEDULE ── */}
      {procTab==="schedule" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            🏭 Yellow cells = planned runs · Frequency: {["","monthly","bimonthly","quarterly","four-monthly","","semiannual"][freqMonths]} · Safety {safetyWoh}w · Min {minRun.toLocaleString()} cases
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
            🛠️ "In production now" = cases currently being manufactured. They count as available stock, so the planner shifts or shrinks the suggested runs. Once the run is finished, log it in Production (creates the real In movement) and clear the cell here.
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="text-xs min-w-max w-full">
              <thead>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <th className="px-4 py-2.5 text-left sticky left-0" style={{backgroundColor:"#1C2340"}}>SKU</th>
                  <th className="px-3 py-2.5 text-right">Stock avail.</th>
                  <th className="px-3 py-2.5 text-center min-w-[150px]">In production now</th>
                  <th className="px-3 py-2.5 text-right">Available + WIP</th>
                  {FORECAST_MONTHS_OPS.map(m=><th key={m} className="px-3 py-2.5 text-center min-w-[75px]">{m}</th>)}
                  <th className="px-4 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {SKUS.map(sku=>{
                  const SK: Record<string,string>={XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"};
                  const comm=orders.reduce((s,o)=>s+(Number(o[SK[sku]])||0),0);
                  const avail=Math.max(0,(bySku[sku]??0)-comm);
                  const w=wip[sku]??{cases:"",due:""};
                  const wipCases=parseInt(w.cases)||0;
                  const skuTotal=(plan[sku]??[]).reduce((a,b)=>a+b,0);
                  return (
                    <tr key={sku} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card" style={{color:"#1C2340"}}>{sku} <span className="text-muted-foreground font-normal text-[10px]">({SKU_ITEMS[sku as SKU]})</span></td>
                      <td className="px-3 py-1.5 text-right font-mono">{avail.toLocaleString()}</td>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <input type="number" min={0} value={w.cases} placeholder="0"
                            onChange={e=>updateWip(sku,{cases:e.target.value})}
                            className={`${inp} w-20 text-right ${wipCases>0?"bg-emerald-50":""}`}/>
                          <input type="date" value={w.due} title="Ready date"
                            onChange={e=>updateWip(sku,{due:e.target.value})}
                            className={`${inp} w-[124px]`}/>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold" style={{color:wipCases>0?"#10B981":undefined}}>
                        {(avail+wipCases).toLocaleString()}
                      </td>
                      {(plan[sku]??[]).map((prod,i)=>(
                        <td key={i} className={`px-3 py-1.5 text-center font-mono font-semibold ${prod>0?"text-amber-900":"text-muted-foreground"}`}
                          style={prod>0?{backgroundColor:"#FEF08A"}:{}}>
                          {prod>0?prod.toLocaleString():"—"}
                        </td>
                      ))}
                      <td className="px-4 py-1.5 text-right font-mono font-bold" style={{color:skuTotal>0?"#A3224A":"#10B981"}}>
                        {skuTotal>0?skuTotal.toLocaleString():"✓"}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold sticky left-0 text-xs" style={{backgroundColor:"#1C2340"}}>Total cases</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{SKUS.reduce((s,sku)=>s+Math.max(0,(bySku[sku]??0)-orders.reduce((a,o)=>a+(Number(o[{XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"}[sku]])||0),0)),0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-emerald-300">
                    {SKUS.reduce((s,sku)=>s+(wipBySku[sku]??0),0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {SKUS.reduce((s,sku)=>s+Math.max(0,(bySku[sku]??0)-orders.reduce((a,o)=>a+(Number(o[{XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"}[sku]])||0),0))+(wipBySku[sku]??0),0).toLocaleString()}
                  </td>
                  {totalByMonth.map((t,i)=>(
                    <td key={i} className="px-3 py-2 text-center font-mono font-bold text-amber-300"
                      style={t>0?{backgroundColor:"rgba(254,240,138,0.15)"}:{}}>
                      {t>0?t.toLocaleString():"—"}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">{totalProduce.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── STOCK PROJECTION ── */}
      {procTab==="stock_proj" && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="text-xs min-w-max w-full">
              <thead>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <th className="px-4 py-2.5 text-left sticky left-0" style={{backgroundColor:"#1C2340"}}>SKU</th>
                  {FORECAST_MONTHS_OPS.map(m=><th key={m} className="px-3 py-2.5 text-center min-w-[80px]">{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {SKUS.map(sku=>(
                  <tr key={sku} className="border-t border-border/60">
                    <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card" style={{color:"#1C2340"}}>{sku}</td>
                    {(stockProj[sku]??[]).map((stock,i)=>{
                      const fcst=fcstOps[sku]?.[i]??0;
                      const woh=fcst>0?(stock/fcst)*4:99;
                      const isCrit=stock<0||woh<2;
                      const isLow=!isCrit&&woh<safetyWoh;
                      const isProd=(plan[sku]?.[i]??0)>0;
                      return (
                        <td key={i} className="px-3 py-1.5 text-center font-mono text-xs"
                          style={{backgroundColor:isCrit?"#FEE2E2":isLow?"#FEF3C7":isProd?"#DCFCE7":undefined,
                            color:isCrit?"#DC2626":isLow?"#92400E":"#1C2340",fontWeight:isProd?"bold":undefined}}>
                          {stock.toLocaleString()}
                          {woh<99&&<div className="text-[9px] opacity-60">{woh.toFixed(1)}w</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3 text-xs flex-wrap">
            {[["bg-red-100","🔴 Critical (< 2w or negative)"],["bg-yellow-100",`🟡 Low (< ${safetyWoh}w safety)`],["bg-green-100","🟢 Production month"]].map(([cls,label])=>(
              <div key={label} className={`flex items-center gap-1.5 rounded px-3 py-1 ${cls}`}><span>{label}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* ── BOM + COGS ── */}
      {procTab==="bom_cogs" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm flex flex-wrap gap-6 items-center">
            <p className="text-xs font-semibold text-muted-foreground">Scrap %:</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Raspberry</label>
              <input type="number" step="0.01" min={0} max={0.5} value={scrap.raspberry}
                onChange={e=>setScrap(s=>({...s,raspberry:parseFloat(e.target.value)||0}))} className={`${inp} w-16`}/>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Chocolate/flavor</label>
              <input type="number" step="0.01" min={0} max={0.5} value={scrap.chocolate}
                onChange={e=>setScrap(s=>({...s,chocolate:parseFloat(e.target.value)||0}))} className={`${inp} w-16`}/>
            </div>
            <p className="text-xs text-muted-foreground">Cambios recalculan COGS en vivo</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <p className="text-sm font-bold" style={{color:"#1C2340"}}>Formula (BOM) — % Receta · Source: Super BOM Consolidado</p>
              <p className="text-xs text-muted-foreground">Editable $/lb prices</p>
            </div>
            <table className="text-xs min-w-max w-full">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">Material</th>
                  {SKUS.map(s=><th key={s} className="px-3 py-2.5 text-center">{s}</th>)}
                  <th className="px-4 py-2.5 text-right">Precio/lb</th>
                </tr>
              </thead>
              <tbody>
                {ALL_INGS.filter(ing=>SKUS.some(sku=>(BOM_PCT[sku]?.[ing]??0)>0)).map(ing=>(
                  <tr key={ing} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-1.5 font-medium">{ing}</td>
                    {SKUS.map(sku=>{
                      const pct=BOM_PCT[sku]?.[ing]??0;
                      return <td key={sku} className={`px-3 py-1.5 text-center font-mono ${pct>0?"font-semibold":"text-muted-foreground"}`}>
                        {pct>0?`${pct.toFixed(1)}%`:"—"}
                      </td>;
                    })}
                    <td className="px-4 py-1.5 text-right">
                      <input type="number" step="0.01" value={ingPrices[ing]??0}
                        onChange={e=>setIngPrices(p=>({...p,[ing]:parseFloat(e.target.value)||0}))}
                        className={`${inp} w-20 text-right`}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Tolling + Packaging ($/unit)</p>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
              {[["Tolling (Heinlein)","tolling_per_unit"],["Cup","cup_per_unit"],["Lid","lid_per_unit"],["Sealer","sealer_per_unit"],["Case $/case","case_per_case"]].map(([label,key])=>(
                <div key={key}>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</label>
                  <input type="number" step="0.001" value={prodCosts[key as keyof typeof prodCosts]}
                    onChange={e=>setProdCosts(c=>({...c,[key]:parseFloat(e.target.value)||0}))}
                    className={`${inp} mt-1 w-full`}/>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <p className="text-sm font-bold" style={{color:"#1C2340"}}>COGS unitario calculado</p>
              <p className="text-xs text-muted-foreground">All inputs editable above</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">SKU</th>
                  <th className="px-4 py-2.5 text-right">Rasp</th>
                  <th className="px-4 py-2.5 text-right">Choc/Flavor</th>
                  <th className="px-4 py-2.5 text-right">Otros ing.</th>
                  <th className="px-4 py-2.5 text-right">Packaging</th>
                  <th className="px-4 py-2.5 text-right">Tolling</th>
                  <th className="px-4 py-2.5 text-right font-bold">$/unit</th>
                  <th className="px-4 py-2.5 text-right font-bold">$/case</th>
                </tr>
              </thead>
              <tbody>
                {SKUS.map(sku=>{
                  const c=cogs[sku]; if(!c) return null;
                  return (
                    <tr key={sku} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{sku}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">${c.rasp.toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">${c.choc.toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">${c.other.toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">${c.pkg.toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">${c.tolling.toFixed(3)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold" style={{color:"#1C2340"}}>${c.per_unit.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold" style={{color:"#A3224A"}}>${c.per_case.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold text-xs" colSpan={6}>COGS PONDERADO (portfolio mix)</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${(weightedCOGS/UNITS_PER_CASE_BOM).toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${weightedCOGS.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── SHOPPING LIST ── */}
      {procTab==="shopping" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <span className="text-xs font-semibold text-muted-foreground">Buy for:</span>
            {([["next","Next run only"],["3m","Next 3 months"],["all","Full horizon (12 mo)"]] as const).map(([id,label])=>(
              <button key={id} onClick={()=>setShopScope(id)}
                className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                style={shopScope===id
                  ?{backgroundColor:"#A3224A",borderColor:"#A3224A",color:"#fff"}
                  :{borderColor:"hsl(var(--border))",color:"hsl(var(--muted-foreground))"}}>
                {label}
              </button>
            ))}
            <div className="ml-auto text-right">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Covers</p>
              <p className="text-sm font-bold font-mono" style={{color:"#1C2340"}}>
                {shopRange
                  ? `${FORECAST_MONTHS_OPS[shopRange[0]]}${shopRange[0]===shopRange[1]?"":` → ${FORECAST_MONTHS_OPS[shopRange[1]]}`} · ${shopCasesWindow.toLocaleString()} cases`
                  : "No production planned"}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
            {shopScope==="next" && nextRunIdx>=0
              ? `📅 Next production run: ${FORECAST_MONTHS_OPS[nextRunIdx]} — ${shopCasesWindow.toLocaleString()} cases. `
              : ""}
            💡 Inventory = load actual stock in the "Raw Materials" tab. To Acquire = Needed − Inventory rounded to pack size.
          </div>
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">Material</th>
                  <th className="px-4 py-2.5 text-right">Needed (lbs)</th>
                  <th className="px-4 py-2.5 text-right">Inventory (lbs)</th>
                  <th className="px-4 py-2.5 text-right">To Acquire</th>
                  <th className="px-4 py-2.5 text-right">Pack size</th>
                  <th className="px-4 py-2.5 text-right">Final amount</th>
                  <th className="px-4 py-2.5 text-right">$/lb</th>
                  <th className="px-4 py-2.5 text-right font-bold">Total cost</th>
                </tr>
              </thead>
              <tbody>
                {ALL_INGS.filter(ing=>(ingWindow[ing]??0)>0).map(ing=>{
                  const needed=Math.round(ingWindow[ing]??0);
                  const inv=parseInt(ingInv[ing])||0;
                  const toAcq=Math.max(0,needed-inv);
                  const ps=ING_PACK_SIZES[ing]??1;
                  const finalAmt=toAcq>0?Math.ceil(toAcq/ps)*ps:0;
                  const price=ingPrices[ing]??0;
                  const cost=finalAmt*price;
                  return (
                    <tr key={ing} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{ing}</td>
                      <td className="px-4 py-2 text-right font-mono">{needed.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{inv>0?inv.toLocaleString():"—"}</td>
                      <td className={`px-4 py-2 text-right font-mono ${toAcq>0?"font-semibold text-orange-600":""}`}>{toAcq>0?toAcq.toLocaleString():"✓"}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{ps.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold" style={{color:"#1C2340"}}>{finalAmt>0?finalAmt.toLocaleString():"—"}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">${price.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold" style={{color:cost>0?"#A3224A":"#10B981"}}>{cost>0?`$${cost.toLocaleString()}`:"$0"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold text-xs" colSpan={7}>TOTAL INGREDIENTS</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">
                    ${ALL_INGS.filter(ing=>(ingWindow[ing]??0)>0).reduce((s,ing)=>{
                      const needed=Math.round(ingWindow[ing]??0);
                      const inv=parseInt(ingInv[ing])||0;
                      const toAcq=Math.max(0,needed-inv);
                      const ps=ING_PACK_SIZES[ing]??1;
                      return s+(toAcq>0?Math.ceil(toAcq/ps)*ps*(ingPrices[ing]??0):0);
                    },0).toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── RAW MATERIALS ── */}
      {procTab==="raw_materials" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
            💡 Enter current inventory. These values flow into the Shopping List. Update them after each receipt.
          </div>
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">Material</th>
                  <th className="px-4 py-2.5 text-right">Pack size (lbs)</th>
                  <th className="px-4 py-2.5 text-right">Precio/lb</th>
                  <th className="px-4 py-2.5 text-right">Stock actual (lbs)</th>
                  <th className="px-4 py-2.5 text-right">Valor ($)</th>
                  <th className="px-4 py-2.5 text-left">Notes / Lot</th>
                </tr>
              </thead>
              <tbody>
                {ALL_INGS.map(ing=>{
                  const inv=parseInt(ingInv[ing])||0;
                  const price=ingPrices[ing]??0;
                  return (
                    <tr key={ing} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{ing}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{(ING_PACK_SIZES[ing]??0).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">
                        <input type="number" step="0.01" value={ingPrices[ing]??0}
                          onChange={e=>setIngPrices(p=>({...p,[ing]:parseFloat(e.target.value)||0}))}
                          className={`${inp} w-20 text-right`}/>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <input type="number" min={0} value={ingInv[ing]??""}
                          onChange={e=>setIngInv(v=>({...v,[ing]:e.target.value}))}
                          placeholder="0" className={`${inp} w-28 text-right ${inv>0?"bg-emerald-50":""}`}/>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{inv>0?`$${(inv*price).toLocaleString()}`:"—"}</td>
                      <td className="px-4 py-2">
                        <input placeholder="Lot, date, vendor..." className={`${inp} w-full`}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold text-xs" colSpan={3}>TOTAL INVENTORY</td>
                  <td className="px-4 py-2 text-right font-mono">{ALL_INGS.reduce((s,ing)=>s+(parseInt(ingInv[ing])||0),0).toLocaleString()} lbs</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${ALL_INGS.reduce((s,ing)=>{const inv=parseInt(ingInv[ing])||0;return s+inv*(ingPrices[ing]??0);},0).toLocaleString()}</td>
                  <td/>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function OperationsPage() {
  const [tab, setTab] = useState<OpsTab>("stock");
  const [fpMovements, setFpMovements] = useState<FPRow[]>([]);
  const [fpMovementsAll, setFpMovementsAll] = useState<FPRow[]>([]);
  const [ipMovements, setIpMovements] = useState<IPRow[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [fp, fpAll, ip, ord] = await Promise.all([
      supabase.from("fp_movements").select("*").neq("concept","Historical").order("movement_date", { ascending: false }),
      supabase.from("fp_movements").select("*").order("movement_date", { ascending: false }),
      supabase.from("ip_movements").select("*").order("movement_date", { ascending: false }),
      supabase.from("customer_orders").select("*").neq("status", "Invoiced").order("po_date", { ascending: false }),
    ]);
    setFpMovements(fp.data ?? []);
    setFpMovementsAll(fpAll.data ?? []);
    setIpMovements(ip.data ?? []);
    setOrders(ord.data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const tabs: { id: OpsTab; label: string }[] = [
    { id:"stock",       label:"FP Stock" },
    { id:"fp",          label:"FP Input" },
    { id:"ip",          label:"I&P Input" },
    { id:"ipsummary",   label:"I&P Summary" },
    { id:"production",  label:"Production" },
    { id:"procurement", label:"Procurement Planning" },
    { id:"cogs",        label:"COGS Simulator" },
    { id:"summary",     label:"FP Summary" },
  ];
  const refTabs: { id: OpsTab; label: string }[] = [{ id: "lots", label: "Lot Master" }];

  return (
    <>
      <PageHeader title="Operations" subtitle="Finished product, ingredients & packaging, and production runs." />

      <div className="mb-5 flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab === t.id ? {borderColor:"#A3224A", color:"#A3224A"} : {}}>
            {t.label}
          </button>
        ))}
        <div className="mx-2 my-1.5 w-px self-stretch bg-border" />
        {refTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="border-b-2 px-4 py-2 text-sm font-semibold transition-colors"
            style={tab === t.id ? { borderColor: "#6B7280", color: "#6B7280" } : { borderColor: "transparent", color: "#9CA3AF" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stock"       && <FPStockTab movements={fpMovements} orders={orders} loading={loading} />}
      {tab === "fp"          && <FPInputTab movements={fpMovementsAll} loading={loading} onAdded={loadAll} />}
      {tab === "ip"          && <IPInputTab movements={ipMovements} loading={loading} onAdded={loadAll} />}
      {tab === "ipsummary"   && <IPSummaryTab movements={ipMovements} />}
      {tab === "production"  && <ProductionTab onAdded={loadAll} />}
      {tab === "procurement" && <ProcurementTab movements={fpMovements} orders={orders} />}
      {tab === "cogs"        && <COGSSimulatorTab />}
      {tab === "summary"     && <FPSummaryTab />}
      {tab === "lots"        && <LotMasterTab />}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/operations")({
  component: OperationsPage,
  head: () => ({ meta: [{ title: "Operations · BARIS" }] }),
});
