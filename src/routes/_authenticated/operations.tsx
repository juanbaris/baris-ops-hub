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

type OpsTab = "stock" | "fp" | "ip" | "production" | "cogs" | "procurement";

function ymd(d = new Date()) { return d.toISOString().slice(0,10); }

// ─── Forecast data (from BARIS_Demand_Forecast_2026_2027 Excel) ───────────────
const FORECAST_MONTHS_OPS = [
  "Ago 26","Sep 26","Oct 26","Nov 26","Dic 26","Ene 27","Feb 27","Mar 27","Abr 27","May 27","Jun 27","Jul 27"
];
const FORECAST_SKU_OPS: Record<string, number[]> = {
  XD:     [1766, 4022, 2065, 707,  3614, 571,  3804, 3777, 4457, 1957, 3995, 6160],
  PW:     [1472, 3352, 1721, 589,  3012, 476,  3170, 3148, 3714, 1631, 3329, 2355],
  HM:     [1060, 2413, 1239, 424,  2168, 342,  2283, 2266, 2674, 1174, 2397, 1694],
  WM:     [707,  1609, 826,  283,  1446, 228,  1522, 1511, 1783, 783,  1598, 1130],
  WD:     [471,  1072, 551,  188,  964,  152,  1014, 1007, 1188, 522,  1065, 753],
  Matcha: [412,  938,  482,  165,  843,  133,  888,  881,  1040, 457,  932,  659],
};
const MIN_WOH_TRIGGER = 6; // weeks — produce when projected drops below this
const PROD_RUN_SIZE = 1000; // minimum cases per production run

// BOM: lbs per case per ingredient (from Super BOM Consolidado)
const BOM_LBS: Record<string, Record<string, number>> = {
  XD:     { "IQF Raspberry":1.125, "Chocolate":1.375 },
  PW:     { "IQF Raspberry":0.825, "Chocolate":1.428, "Pistachio Paste":0.200, "Cocoa Butter":0.042 },
  HM:     { "IQF Raspberry":0.825, "Chocolate":1.398, "Hazelnut Butter":0.250, "Cocoa Butter":0.024 },
  WM:     { "IQF Raspberry":0.750, "Chocolate":1.719, "Cocoa Butter":0.029 },
  WD:     { "IQF Raspberry":0.750, "Chocolate":1.719, "Cocoa Butter":0.029 },
  Matcha: { "IQF Raspberry":1.125, "Chocolate":1.322, "Matcha Powder":0.022, "Cocoa Butter":0.025 },
};
const ING_PRICES: Record<string, number> = {
  "IQF Raspberry":2.91, "Chocolate":3.80, "Pistachio Paste":9.50,
  "Hazelnut Butter":5.20, "Matcha Powder":15.00, "Cocoa Butter":6.00,
};

// ─── FP Stock Tab — with WoH ──────────────────────────────────────────────────
function FPStockTab({ movements, orders, loading }: { movements: FPRow[]; orders: any[]; loading: boolean }) {
  // Stock from fp_movements (live)
  const bySku = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of movements) {
      m[r.sku] = (m[r.sku] ?? 0) + (r.type === "In" ? Number(r.cases) : -Number(r.cases));
    }
    return m;
  }, [movements]);

  // Committed = open POs (not invoiced) — cases per SKU
  const committed = useMemo(() => {
    const c: Record<string, number> = {};
    const SKU_KEYS: Record<string, string> = {
      XD:"xd_cases", PW:"pw_cases", HM:"hm_cases", WM:"wm_cases", WD:"wd_cases", Matcha:"matcha_cases"
    };
    const openOrders = orders.filter(o => !["Invoiced"].includes(o.status));
    for (const sku of SKUS) {
      c[sku] = openOrders.reduce((s, o) => s + (Number(o[SKU_KEYS[sku]]) || 0), 0);
    }
    return c;
  }, [orders]);

  // Available = stock - committed
  // WoH = available / (forecast_4w / 4)
  const skuData = useMemo(() => SKUS.map(sku => {
    const stockCases = Math.round(bySku[sku] ?? 0);
    const committedCases = committed[sku] ?? 0;
    const availCases = stockCases - committedCases;
    const fcst4w = FORECAST_SKU_OPS[sku]?.[0] ?? 0; // next month forecast as proxy for 4w
    const woh = fcst4w > 0 ? (availCases / fcst4w) * 4 : 0;
    const status = availCases <= 0 ? "OOS" : woh < 2 ? "CRITICAL" : woh < 4 ? "LOW" : "OK";
    return { sku, stockCases, committedCases, availCases, fcst4w, woh, status };
  }), [bySku, committed]);

  return (
    <div className="space-y-5">
      {/* SKU cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {skuData.map(s => {
          const isOOS = s.status === "OOS";
          const isCrit = s.status === "CRITICAL";
          const isLow = s.status === "LOW";
          return (
            <div key={s.sku} className={`rounded-2xl border p-4 text-center shadow-sm
              ${isOOS ? "border-red-400 bg-red-100" : isCrit ? "border-red-200 bg-red-50" : isLow ? "border-orange-200 bg-orange-50" : "border-border bg-card"}`}>
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{s.sku}</p>
              <p className="text-[10px] text-muted-foreground">{SKU_ITEMS[s.sku as SKU]}</p>
              <p className={`text-xl font-bold font-mono mt-1 ${isOOS || isCrit ? "text-red-600" : isLow ? "text-orange-500" : ""}`}
                style={!isOOS && !isCrit && !isLow ? {color:"#1C2340"} : {}}>
                {s.availCases.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">cases avail.</p>
              <p className={`text-sm font-bold mt-1 ${isOOS || isCrit ? "text-red-600" : isLow ? "text-orange-500" : "text-emerald-600"}`}>
                {s.woh.toFixed(1)}w
              </p>
              <p className={`text-[9px] font-bold mt-0.5 ${isOOS ? "text-red-700" : isCrit ? "text-red-600" : isLow ? "text-orange-500" : "text-emerald-600"}`}>
                {s.status}
              </p>
            </div>
          );
        })}
      </div>

      {/* Detail table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>Stock Detail · Weeks on Hand</p>
          <p className="text-xs text-muted-foreground">
            Stock = fp_movements live · Committed = open POs (not invoiced) · WoH = available ÷ forecast próx. mes
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-right">Stock (cases)</th>
              <th className="px-4 py-2.5 text-right">Committed (cases)</th>
              <th className="px-4 py-2.5 text-right">Available (cases)</th>
              <th className="px-4 py-2.5 text-right">Fcst próx. mes</th>
              <th className="px-4 py-2.5 text-right">WoH</th>
              <th className="px-4 py-2.5 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : skuData.map(s => (
              <tr key={s.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{s.sku} <span className="text-xs text-muted-foreground font-normal">({SKU_ITEMS[s.sku as SKU]})</span></td>
                <td className="px-4 py-2 text-right font-mono">{s.stockCases.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-orange-500">{s.committedCases > 0 ? s.committedCases.toLocaleString() : "—"}</td>
                <td className={`px-4 py-2 text-right font-mono font-semibold ${s.availCases < 0 ? "text-red-600" : ""}`}>
                  {s.availCases.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">{s.fcst4w.toLocaleString()}</td>
                <td className={`px-4 py-2 text-right font-mono font-bold ${s.status === "OOS" || s.status === "CRITICAL" ? "text-red-600" : s.status === "LOW" ? "text-orange-500" : "text-emerald-600"}`}>
                  {s.woh.toFixed(1)}w
                </td>
                <td className="px-4 py-2 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold
                    ${s.status === "OOS" ? "bg-red-200 text-red-800" : s.status === "CRITICAL" ? "bg-red-100 text-red-700" : s.status === "LOW" ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {s.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{backgroundColor:"#1C2340", color:"#fff"}}>
              <td className="px-4 py-2 text-xs font-semibold">TOTAL</td>
              <td className="px-4 py-2 text-right font-mono">{skuData.reduce((s,r)=>s+r.stockCases,0).toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono text-orange-300">{skuData.reduce((s,r)=>s+r.committedCases,0).toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">{skuData.reduce((s,r)=>s+r.availCases,0).toLocaleString()}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
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

// ─── Procurement Planning Tab ─────────────────────────────────────────────────
function ProcurementTab({ movements, orders }: { movements: FPRow[]; orders: any[] }) {
  const [safetyWoh, setSafetyWoh] = useState(MIN_WOH_TRIGGER);

  // Live stock from fp_movements
  const bySku = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of movements) m[r.sku] = (m[r.sku] ?? 0) + (r.type === "In" ? Number(r.cases) : -Number(r.cases));
    return m;
  }, [movements]);

  // Committed from open POs
  const committed = useMemo(() => {
    const c: Record<string, number> = {};
    const SKU_KEYS: Record<string, string> = {
      XD:"xd_cases", PW:"pw_cases", HM:"hm_cases", WM:"wm_cases", WD:"wd_cases", Matcha:"matcha_cases"
    };
    const openOrders = orders.filter(o => o.status !== "Invoiced");
    for (const sku of SKUS) {
      c[sku] = openOrders.reduce((s, o) => s + (Number(o[SKU_KEYS[sku]]) || 0), 0);
    }
    return c;
  }, [orders]);

  // Calculate production schedule for each SKU
  const schedule = useMemo(() => SKUS.map(sku => {
    const startCases = Math.max(0, (bySku[sku] ?? 0) - (committed[sku] ?? 0));
    const runs: { month: string; produce: number; stockBefore: number; stockAfter: number }[] = [];
    let running = startCases;
    let totalProduce = 0;

    for (let i = 0; i < FORECAST_MONTHS_OPS.length; i++) {
      const fcst = FORECAST_SKU_OPS[sku]?.[i] ?? 0;
      const woh = fcst > 0 ? (running / fcst) * 4 : 99;
      let produce = 0;
      if (woh < safetyWoh && fcst > 0) {
        // Produce enough to cover safety weeks + current month
        const needed = Math.ceil((safetyWoh / 4) * fcst) - running + fcst;
        produce = Math.ceil(needed / PROD_RUN_SIZE) * PROD_RUN_SIZE;
        totalProduce += produce;
      }
      const stockBefore = running;
      running = running + produce - fcst;
      if (produce > 0) runs.push({ month: FORECAST_MONTHS_OPS[i], produce, stockBefore, stockAfter: running });
    }
    return { sku, startCases, runs, totalProduce };
  }), [bySku, committed, safetyWoh]);

  // Raw material shopping list: aggregate all production runs × BOM
  const shoppingList = useMemo(() => {
    const totals: Record<string, { lbs: number; cost: number; runs: string[] }> = {};
    for (const s of schedule) {
      for (const run of s.runs) {
        const bom = BOM_LBS[s.sku] ?? {};
        for (const [ing, lbsPerCase] of Object.entries(bom)) {
          const totalLbs = run.produce * lbsPerCase;
          if (!totals[ing]) totals[ing] = { lbs: 0, cost: 0, runs: [] };
          totals[ing].lbs += totalLbs;
          totals[ing].cost += totalLbs * (ING_PRICES[ing] ?? 0);
          totals[ing].runs.push(`${run.month}: ${run.produce}c ${s.sku}`);
        }
      }
    }
    return Object.entries(totals).map(([ing, v]) => ({
      ingredient: ing,
      lbs: Math.round(v.lbs),
      cost: Math.round(v.cost),
      price: ING_PRICES[ing] ?? 0,
    })).sort((a,b) => b.cost - a.cost);
  }, [schedule]);

  const totalProduceCases = schedule.reduce((s,r) => s + r.totalProduce, 0);
  const totalIngCost = shoppingList.reduce((s,r) => s + r.cost, 0);

  return (
    <div className="space-y-6">
      {/* Config */}
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <label className="text-sm font-semibold text-muted-foreground">Safety stock (weeks on hand trigger)</label>
        <input type="number" min={1} max={12} value={safetyWoh}
          onChange={e => setSafetyWoh(Number(e.target.value))}
          className="w-20 rounded-lg border border-border px-3 py-1.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <span className="text-xs text-muted-foreground">Produce when projected WoH drops below this threshold</span>
        <div className="ml-auto flex gap-6 text-center">
          <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total to produce</p>
            <p className="text-xl font-bold font-mono" style={{color:"#A3224A"}}>{totalProduceCases.toLocaleString()} cases</p></div>
          <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Est. ingredient cost</p>
            <p className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>${Math.round(totalIngCost/1000)}K</p></div>
        </div>
      </div>

      {/* Production schedule per SKU */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>Production Schedule — Ago 2026 → Jul 2027</p>
          <p className="text-xs text-muted-foreground">Based on live stock (fp_movements) + open POs + demand forecast. Produce when WoH {"<"} {safetyWoh}w.</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-right">Stock avail.</th>
              <th className="px-4 py-2.5 text-left">Production runs needed</th>
              <th className="px-4 py-2.5 text-right">Total to produce</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map(s => (
              <tr key={s.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{s.sku}</td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">{s.startCases.toLocaleString()} cases</td>
                <td className="px-4 py-2">
                  {s.runs.length === 0 ? (
                    <span className="text-xs text-emerald-600 font-semibold">✓ No production needed</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {s.runs.map((r,i) => (
                        <span key={i} className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-100 text-orange-700 border border-orange-200">
                          {r.month}: <strong>{r.produce.toLocaleString()}</strong> cases
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono font-bold" style={{color: s.totalProduce > 0 ? "#A3224A" : "#10B981"}}>
                  {s.totalProduce > 0 ? s.totalProduce.toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Raw material shopping list */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-semibold" style={{color:"#1C2340"}}>Raw Material Shopping List</p>
          <p className="text-xs text-muted-foreground">
            From BOM (Super BOM Consolidado) × production schedule above · prices from procurement planning
          </p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Ingredient</th>
              <th className="px-4 py-2.5 text-right">Total lbs needed</th>
              <th className="px-4 py-2.5 text-right">Price/lb</th>
              <th className="px-4 py-2.5 text-right">Est. cost</th>
              <th className="px-4 py-2.5 text-right">% of total</th>
            </tr>
          </thead>
          <tbody>
            {shoppingList.length === 0 ? (
              <tr><td colSpan={5} className="p-8 text-center text-emerald-600 font-semibold">✓ No purchases needed — stock covers full forecast</td></tr>
            ) : shoppingList.map((r,i) => (
              <tr key={i} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-4 py-2 font-semibold">{r.ingredient}</td>
                <td className="px-4 py-2 text-right font-mono">{r.lbs.toLocaleString()} lbs</td>
                <td className="px-4 py-2 text-right font-mono text-muted-foreground">${r.price.toFixed(2)}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold" style={{color:"#A3224A"}}>${r.cost.toLocaleString()}</td>
                <td className="px-4 py-2 text-right text-muted-foreground text-xs">
                  {totalIngCost > 0 ? `${((r.cost/totalIngCost)*100).toFixed(1)}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          {shoppingList.length > 0 && (
            <tfoot>
              <tr style={{backgroundColor:"#1C2340", color:"#fff"}}>
                <td className="px-4 py-2 font-semibold text-xs">TOTAL</td>
                <td className="px-4 py-2 text-right font-mono">{shoppingList.reduce((s,r)=>s+r.lbs,0).toLocaleString()} lbs</td>
                <td />
                <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${totalIngCost.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          )}
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
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const [fp, ip, ord] = await Promise.all([
      supabase.from("fp_movements").select("*").order("movement_date", { ascending: false }),
      supabase.from("ip_movements").select("*").order("movement_date", { ascending: false }),
      supabase.from("customer_orders").select("xd_cases,pw_cases,hm_cases,wm_cases,wd_cases,matcha_cases,status").neq("status","Invoiced"),
    ]);
    setFpMovements(fp.data ?? []);
    setIpMovements(ip.data ?? []);
    setOrders(ord.data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const tabs: { id: OpsTab; label: string }[] = [
    { id:"stock",       label:"Stock & WoH" },
    { id:"fp",          label:"FP Input" },
    { id:"ip",          label:"I&P Input" },
    { id:"production",  label:"Production" },
    { id:"cogs",        label:"COGS Simulator" },
    { id:"procurement", label:"Procurement Planning" },
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

      {tab === "stock"       && <FPStockTab movements={fpMovements} orders={orders} loading={loading} />}
      {tab === "fp"          && <FPInputTab movements={fpMovements} loading={loading} onAdded={loadAll} />}
      {tab === "ip"          && <IPInputTab movements={ipMovements} loading={loading} onAdded={loadAll} />}
      {tab === "production"  && <ProductionTab onAdded={loadAll} />}
      {tab === "cogs"        && <COGSSimulatorTab />}
      {tab === "procurement" && <ProcurementTab movements={fpMovements} orders={orders} />}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/operations")({
  component: OperationsPage,
  head: () => ({ meta: [{ title: "Operations · BARIS" }] }),
});
