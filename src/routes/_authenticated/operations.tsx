import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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

type OpsTab = "stock" | "fp" | "ip" | "production";

function ymd(d = new Date()) { return d.toISOString().slice(0,10); }

// ─── FP Stock Tab ─────────────────────────────────────────────────────────────
function FPStockTab({ movements, loading }: { movements: FPRow[]; loading: boolean }) {
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

  return (
    <div className="space-y-5">
      {/* SKU summary cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {SKUS.map(sku => {
          const qty = Math.round(bySku[sku] ?? 0);
          const isCrit = qty < 200;
          const isLow = qty < 500;
          return (
            <div key={sku} className={`rounded-2xl border p-4 text-center shadow-sm ${isCrit ? "border-red-200 bg-red-50" : isLow ? "border-orange-200 bg-orange-50" : "border-border bg-card"}`}>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{sku}</p>
              <p className="text-[10px] text-muted-foreground">{SKU_ITEMS[sku]}</p>
              <p className={`text-xl font-bold font-mono mt-1 ${isCrit ? "text-red-600" : isLow ? "text-orange-500" : ""}`} style={!isCrit && !isLow ? {color:"#1C2340"} : {}}>
                {qty.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">cases</p>
              {isCrit && <p className="text-[9px] font-bold text-red-600 mt-0.5">CRITICAL</p>}
              {!isCrit && isLow && <p className="text-[9px] font-bold text-orange-500 mt-0.5">LOW</p>}
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
              <th className="px-4 py-2.5 text-right">Cases on hand</th>
              <th className="px-4 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
            ) : stock.filter(s => s.cases > 0).length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-muted-foreground">No stock data yet</td></tr>
            ) : stock.filter(s => s.cases > 0).map(s => {
              const isCrit = s.cases < 200;
              const isLow = s.cases < 500;
              return (
                <tr key={`${s.sku}|${s.warehouse}`} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{s.sku}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{SKU_ITEMS[s.sku]}</td>
                  <td className="px-4 py-2">{s.warehouse}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{Math.round(s.cases).toLocaleString()}</td>
                  <td className="px-4 py-2 text-center">
                    {isCrit ? <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-red-100 text-red-700">CRITICAL</span>
                     : isLow ? <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-100 text-orange-700">LOW</span>
                     : <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">OK</span>}
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
    lot_number: "", concept: "Procurement" as IPConcept, notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [filterConcept, setFilterConcept] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.material) { toast.error("Material required"); return; }
    if (!form.quantity || Number(form.quantity) === 0) { toast.error("Quantity required"); return; }
    setSaving(true);
    const { error } = await supabase.from("ip_movements").insert({
      movement_date: form.movement_date,
      material: form.material,
      vendor: form.vendor || null,
      type: form.type,
      quantity: Number(form.quantity),
      unit: form.unit,
      lot_number: form.lot_number || null,
      concept: form.concept,
      notes: form.notes || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`I&P movement added: ${form.type} ${form.quantity} ${form.unit} ${form.material}`);
    setForm(f => ({ ...f, quantity: "", lot_number: "", notes: "" }));
    onAdded();
  }

  const filtered = useMemo(() => {
    return [...movements]
      .filter(r => (filterConcept === "all" || r.concept === filterConcept) && (filterType === "all" || r.type === filterType))
      .sort((a,b) => a.movement_date < b.movement_date ? 1 : -1);
  }, [movements, filterConcept, filterType]);

  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-5">
      {/* Form */}
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>New I&P Movement</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Date</label>
            <input type="date" className={`${inp} mt-1`} value={form.movement_date} onChange={e => set("movement_date", e.target.value)} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Type</label>
            <select className={`${inp} mt-1`} value={form.type} onChange={e => set("type", e.target.value)}>
              <option value="In">In</option><option value="Out">Out</option>
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Concept</label>
            <select className={`${inp} mt-1`} value={form.concept} onChange={e => set("concept", e.target.value)}>
              {IP_CONCEPTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Material *</label>
            <input className={`${inp} mt-1`} value={form.material} onChange={e => set("material", e.target.value)}
              placeholder="e.g. IQF Rasp, Choc Dark" /></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Vendor</label>
            <input className={`${inp} mt-1`} value={form.vendor} onChange={e => set("vendor", e.target.value)} placeholder="e.g. Blommer" /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Quantity *</label>
            <input type="number" className={`${inp} mt-1 font-mono`} value={form.quantity} onChange={e => set("quantity", e.target.value)} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Unit</label>
            <select className={`${inp} mt-1`} value={form.unit} onChange={e => set("unit", e.target.value)}>
              {["lbs","kg","Piece","cases","units"].map(u => <option key={u} value={u}>{u}</option>)}
            </select></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Lot #</label>
            <input className={`${inp} mt-1 font-mono`} value={form.lot_number} onChange={e => set("lot_number", e.target.value)} /></div>
        </div>
        <div className="mb-4">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Notes</label>
          <input className={`${inp} mt-1`} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Optional" />
        </div>
        <button onClick={save} disabled={saving}
          className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          style={{backgroundColor:"#A3224A"}}>
          {saving ? "Saving…" : `+ Add ${form.type} · ${form.quantity || "?"} ${form.unit} ${form.material || "?"}`}
        </button>
      </div>

      {/* Movements table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>I&P Movements <span className="text-muted-foreground font-normal text-xs">({filtered.length} records)</span></p>
          <div className="flex gap-2">
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
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Date</th>
              <th className="px-4 py-2.5 text-left">Type</th>
              <th className="px-4 py-2.5 text-left">Concept</th>
              <th className="px-4 py-2.5 text-left">Material</th>
              <th className="px-4 py-2.5 text-right">Qty</th>
              <th className="px-4 py-2.5 text-left">Unit</th>
              <th className="px-4 py-2.5 text-left">Vendor</th>
              <th className="px-4 py-2.5 text-left">Lot</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No movements match filters</td></tr>
              : filtered.map(r => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-1.5 font-mono text-xs">{r.movement_date}</td>
                  <td className="px-4 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.type === "In" ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>
                      {r.type}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-xs">{r.concept}</td>
                  <td className="px-4 py-1.5 font-semibold text-xs" style={{color:"#1C2340"}}>{r.material}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-xs">{Number(r.quantity).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.unit}</td>
                  <td className="px-4 py-1.5 text-xs" style={{color:"#A3224A"}}>{r.vendor ?? "—"}</td>
                  <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground">{r.lot_number ?? "—"}</td>
                </tr>
              ))}
          </tbody>
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

// ─── Main ─────────────────────────────────────────────────────────────────────
function OperationsPage() {
  const [tab, setTab] = useState<OpsTab>("stock");
  const [fpMovements, setFpMovements] = useState<FPRow[]>([]);
  const [ipMovements, setIpMovements] = useState<IPRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [fp, ip] = await Promise.all([
      supabase.from("fp_movements").select("*").order("movement_date", { ascending: false }),
      supabase.from("ip_movements").select("*").order("movement_date", { ascending: false }),
    ]);
    setFpMovements(fp.data ?? []);
    setIpMovements(ip.data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const tabs: { id: OpsTab; label: string }[] = [
    { id:"stock",      label:"FP Stock" },
    { id:"fp",         label:"FP Input" },
    { id:"ip",         label:"I&P Input" },
    { id:"production", label:"Production" },
  ];

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
      </div>

      {tab === "stock"      && <FPStockTab movements={fpMovements} loading={loading} />}
      {tab === "fp"         && <FPInputTab movements={fpMovements} loading={loading} onAdded={loadAll} />}
      {tab === "ip"         && <IPInputTab movements={ipMovements} loading={loading} onAdded={loadAll} />}
      {tab === "production" && <ProductionTab onAdded={loadAll} />}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/operations")({
  component: OperationsPage,
  head: () => ({ meta: [{ title: "Operations · BARIS" }] }),
});
