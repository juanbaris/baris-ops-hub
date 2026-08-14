import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useSalesForecast } from "@/hooks/use-sales-forecast";
import { calcForecast, skuForecastByMonthKey, DEFAULT_VEL_CHAINS, NEW_RETAILERS, type Scenario as SalesScenario } from "@/lib/sales-forecast";
import { buildLotMap, resolveCogs, type LotCard } from "@/lib/fp-shared";

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
const WAREHOUSES: Warehouse[] = ["Lineage Newark","Lineage Linden","Cold Chain","Empire","Heinlein","OOE"];
const FP_CONCEPTS: FPConcept[] = ["Production","Sale","Sample","Damage","Transfer","Free"];
const IP_CONCEPTS: IPConcept[] = ["Procurement","Consumption","Damage","Transfer"];
const FACILITIES: Facility[] = ["Heinlein","Empire","OOE"];
const FULL_TRUCK = 6630;
const LOT_BASELINE_DATE = "2026-08-14"; // Lot Master fixed as of this date; later FP movements adjust each lot

type BaselineRow = {
  id: string;
  baseline_date: string;
  sku: string;
  warehouse: string;
  lot_number: string | null;
  cases: number;
  cases_available: number | null;
  expiry_date: string | null;
  cogs_per_case: number | null;
  pallet_id: string | null;
  notes: string | null;
  created_at: string;
};

/** PO statuses that count as committed (not yet shipped). */
const COMMITTED_STATUSES = ["Open", "Accepted", "Sent to 3PL", "Shipment"];

/** Calculate stock from baseline + movements after baseline date */
function calcStockFromBaseline(
  baseline: BaselineRow[],
  movements: FPRow[],
): { bySku: Record<string, number>; bySkuWh: Record<string, { sku: SKU; warehouse: Warehouse; cases: number }> } {
  const bySku: Record<string, number> = {};
  const bySkuWh: Record<string, { sku: SKU; warehouse: Warehouse; cases: number }> = {};

  // If no baseline, fall back to summing all movements (legacy behavior)
  if (baseline.length === 0) {
    for (const r of movements) {
      const delta = r.type === "In" ? Number(r.cases) : -Number(r.cases);
      bySku[r.sku] = (bySku[r.sku] ?? 0) + delta;
      const k = `${r.sku}|${r.warehouse}`;
      if (!bySkuWh[k]) bySkuWh[k] = { sku: r.sku as SKU, warehouse: r.warehouse as Warehouse, cases: 0 };
      bySkuWh[k].cases += delta;
    }
    return { bySku, bySkuWh };
  }

  // Find the latest baseline date
  const baselineDate = baseline.reduce((max, b) => b.baseline_date > max ? b.baseline_date : max, "");

  // Seed from baseline
  for (const b of baseline) {
    if (b.baseline_date !== baselineDate) continue; // only use latest baseline
    bySku[b.sku] = (bySku[b.sku] ?? 0) + b.cases;
    const wh = b.warehouse as Warehouse;
    const k = `${b.sku}|${wh}`;
    if (!bySkuWh[k]) bySkuWh[k] = { sku: b.sku as SKU, warehouse: wh, cases: 0 };
    bySkuWh[k].cases += b.cases;
  }

  // Add only movements AFTER the baseline date
  for (const r of movements) {
    if (r.movement_date <= baselineDate) continue;
    const delta = r.type === "In" ? Number(r.cases) : -Number(r.cases);
    bySku[r.sku] = (bySku[r.sku] ?? 0) + delta;
    const k = `${r.sku}|${r.warehouse}`;
    if (!bySkuWh[k]) bySkuWh[k] = { sku: r.sku as SKU, warehouse: r.warehouse as Warehouse, cases: 0 };
    bySkuWh[k].cases += delta;
  }

  return { bySku, bySkuWh };
}

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

function FPStockTab({ movements, orders, loading, baseline, lotMap }: { movements: FPRow[]; orders: any[]; loading: boolean; baseline: BaselineRow[]; lotMap: Record<string, LotCard> }) {
  const { bySkuMonthKey } = useSalesForecast();
  const [showValue, setShowValue] = useState(false);
  const [lots, setLots] = useState<any[]>([]);
  useEffect(() => { (async () => { const { data } = await supabase.from("lot_master").select("*"); setLots(data ?? []); })(); }, []);

  // Live lot on-hand = master cases (as of LOT_BASELINE_DATE) + signed movements after it (keyed by lot+warehouse).
  const deltaByLot = useMemo(() => {
    const d: Record<string, number> = {};
    for (const m of (movements ?? [])) {
      const lot = (m.lot_number ?? "").trim();
      if (!lot || m.movement_date <= LOT_BASELINE_DATE) continue;
      const k = `${lot}||${m.warehouse ?? "—"}`;
      d[k] = (d[k] ?? 0) + (m.type === "In" ? Number(m.cases) : -Number(m.cases));
    }
    return d;
  }, [movements]);

  // Aggregate lot on-hand into per-SKU and per-SKU/warehouse stock + $ value (from Lot Master COGS × 8).
  const { bySku, whRows, cogsBySku, valBySku } = useMemo(() => {
    const casesSku: Record<string, number> = {};
    const casesWh: Record<string, number> = {};
    const valWh: Record<string, number> = {};
    const valSku: Record<string, number> = {};
    const seen = new Set<string>();
    const add = (sku: string, wh: string, c: number, cogs: number | null) => {
      casesSku[sku] = (casesSku[sku] ?? 0) + c;
      const k = `${sku}|${wh}`;
      casesWh[k] = (casesWh[k] ?? 0) + c;
      const v = c * (Number(cogs) || 0) * 8;
      valWh[k] = (valWh[k] ?? 0) + v;
      valSku[sku] = (valSku[sku] ?? 0) + v;
    };
    for (const r of lots) { const k=`${r.lot_number}||${r.warehouse ?? "—"}`; seen.add(k); add(r.sku, r.warehouse ?? "—", (Number(r.cases_initial) || 0) + (deltaByLot[k] ?? 0), r.cogs_per_case); }
    for (const m of (movements ?? [])) {
      const lot = (m.lot_number ?? "").trim();
      const k = `${lot}||${m.warehouse ?? "—"}`;
      if (!lot || seen.has(k) || m.movement_date <= LOT_BASELINE_DATE) continue;
      seen.add(k); add(m.sku, m.warehouse ?? "—", deltaByLot[k] ?? 0, m.cogs_per_case);
    }
    const bySku: Record<string, number> = {};
    const cogsBySku: Record<string, number> = {};
    for (const sku of SKUS) {
      const c = casesSku[sku] ?? 0;
      bySku[sku] = Math.max(0, Math.round(c));               // stock never < 0
      cogsBySku[sku] = c > 0 ? (valSku[sku] ?? 0) / c : 0;    // effective $/case (per-pote × 8, weighted)
    }
    const whRows = Object.entries(casesWh).map(([k, c]) => {
      const [sku, warehouse] = k.split("|");
      return { sku, warehouse, cases: Math.max(0, c), value: Math.max(0, valWh[k] ?? 0) };
    });
    const valBySku: Record<string, number> = {};
    for (const sku of SKUS) valBySku[sku] = Math.max(0, valSku[sku] ?? 0);
    return { bySku, whRows, cogsBySku, valBySku };
  }, [lots, movements, deltaByLot]);

  const forecastNextMonth = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
    return Object.fromEntries(SKUS.map(sku => [sku, bySkuMonthKey[sku]?.[key] ?? FORECAST_FALLBACK[sku]])) as Record<SKU, number>;
  }, [bySkuMonthKey]);

  const baselineDate = LOT_BASELINE_DATE;

  const committed = useMemo(() => {
    const m: Record<string, number> = {};
    const open = (orders ?? []).filter(o => COMMITTED_STATUSES.includes(o.status));
    for (const sku of SKUS) m[sku] = open.reduce((s,o) => s + (Number(o[SKU_KEYS[sku]]) || 0), 0);
    return m;
  }, [orders]);

  return (
    <div className="space-y-5">
      {/* ── Total stock across ALL warehouses (as of today) ── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>📊 Total stock — all warehouses</p>
          <p className="text-xs text-muted-foreground">Newark + Cold Chain + Linden · from Lot Master · as of {ymd()}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">SKU</th>
              <th className="px-4 py-2.5 text-left">Item #</th>
              <th className="px-4 py-2.5 text-right">Stock (cajas)</th>
              <th className="px-4 py-2.5 text-right">Potes</th>
              <th className="px-4 py-2.5 text-right text-amber-700">Inv. $</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : SKUS.map(sku => {
              const cs = Math.round(bySku[sku] ?? 0);
              const v = valBySku[sku] ?? 0;
              return (
                <tr key={sku} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{sku}</td>
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{SKU_ITEMS[sku]}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{cs.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{(cs*8).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold" style={{color:"#A3224A"}}>{v?`$${Math.round(v).toLocaleString()}`:"—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
              <td className="px-4 py-2 text-xs font-semibold" colSpan={2}>TOTAL</td>
              <td className="px-4 py-2 text-right font-mono font-bold">{SKUS.reduce((s,sku)=>s+Math.round(bySku[sku]??0),0).toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono text-slate-300">{SKUS.reduce((s,sku)=>s+Math.round(bySku[sku]??0)*8,0).toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${Math.round(SKUS.reduce((s,sku)=>s+(valBySku[sku]??0),0)).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

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
                {showValue && cogsBySku[sku]
                  ? `$${Math.round(available * cogsBySku[sku] / 1000).toLocaleString()}K`
                  : available.toLocaleString()}
              </p>
              <p className="text-[10px] text-muted-foreground">{showValue ? "$ value (COGS)" : "available cases"}</p>
              <p className="text-[11px] font-mono font-semibold mt-0.5" style={{color:"#1C2340"}}>{woh.toFixed(1)} wks</p>
              <span className={`inline-block mt-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${STATUS_PILL[st]}`}>{st}</span>
            </div>
          );
        })}
      </div>

      {(['Lineage Newark', 'Cold Chain', 'Lineage Linden', 'other'] as const).map(wh => {
        const isFixed = wh !== 'other';
        const KNOWN = ['Lineage Newark', 'Cold Chain', 'Lineage Linden'];
        const rows = isFixed
          ? SKUS.map(sku => {
              const r = whRows.find(x => x.sku === sku && x.warehouse === wh);
              return r ?? { sku, warehouse: wh, cases: 0, value: 0 };
            })
          : whRows.filter(s => !KNOWN.includes(s.warehouse) && s.cases > 0).sort((a, b) => a.sku.localeCompare(b.sku));
        if (rows.length === 0) return null;
        const isLineage = wh === 'Lineage Newark';
        const whIcon = wh === 'Lineage Newark' ? '📦' : wh === 'Cold Chain' ? '❄️' : wh === 'Lineage Linden' ? '🏬' : '🏭';
        const whTitle = isFixed ? `${whIcon} ${wh}` : '🏭 Other Warehouses';
        return (
          <div key={wh} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <p className="text-sm font-semibold" style={{color:"#1C2340"}}>
                {whTitle}
              </p>
              <p className="text-xs text-muted-foreground">
                From Lot Master · fixed {baselineDate} + later FP movements · as of {ymd()}
              </p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">SKU</th>
                  <th className="px-4 py-2.5 text-left">Item #</th>
                  {!isFixed && <th className="px-4 py-2.5 text-left">Warehouse</th>}
                  <th className="px-4 py-2.5 text-right text-amber-700">Inv. $</th>
                  <th className="px-4 py-2.5 text-right">{showValue ? "Stock $" : "Stock (cajas)"}</th>
                  <th className="px-4 py-2.5 text-right">{showValue ? "Committed $" : "Committed"}</th>
                  <th className="px-4 py-2.5 text-right">{showValue ? "Available $" : "Available"}</th>
                  <th className="px-4 py-2.5 text-right">Forecast</th>
                  <th className="px-4 py-2.5 text-right">WoH</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
                ) : rows.map(s => {
                  const skuStock = Math.round(bySku[s.sku] ?? 0);
                  const comm = Math.round(committed[s.sku] ?? 0);
                  const share = skuStock > 0 ? s.cases / skuStock : 0;
                  const rowComm = Math.round(comm * share);
                  const available = Math.round(s.cases) - rowComm;   // can be < 0
                  const fc = forecastNextMonth[s.sku] ?? 0;
                  const woh = fc > 0 ? (available / (fc * share || fc)) * 4 : 0;
                  const st = stockStatus(available, woh);
                  return (
                    <tr key={`${s.sku}|${s.warehouse}`} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{s.sku}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{SKU_ITEMS[s.sku]}</td>
                      {!isFixed && <td className="px-4 py-2 text-xs text-muted-foreground">{s.warehouse}</td>}
                      <td className="px-4 py-2 text-right font-mono font-semibold" style={{color:"#A3224A"}}>
                        {s.value ? `$${Math.round(s.value).toLocaleString()}` : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">
                        {showValue ? `$${Math.round(s.value / 1000).toLocaleString()}K` : (
                          <span>
                            {Math.round(s.cases).toLocaleString()}
                            <span className="block text-[10px] font-normal text-muted-foreground">{Math.round(s.cases * 8).toLocaleString()} potes</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {showValue && rowComm && cogsBySku[s.sku] ? `$${Math.round(rowComm * cogsBySku[s.sku] / 1000).toLocaleString()}K` : (rowComm ? rowComm.toLocaleString() : "—")}
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">
                        {showValue && cogsBySku[s.sku]
                          ? <span style={{color:"#A3224A"}}>${Math.round(available * cogsBySku[s.sku] / 1000).toLocaleString()}K</span>
                          : available.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">{Math.round(fc * (share || (isLineage ? 1 : 0))).toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs">{woh.toFixed(1)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_PILL[st]}`}>{st}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 text-xs font-semibold" colSpan={isFixed ? 2 : 3}>
                    TOTAL ({rows.length} SKUs)
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold" style={{color:"#f87171"}}>
                    ${Math.round(rows.reduce((s,r)=>s+r.value,0)).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">
                    {rows.reduce((s,r)=>s+Math.round(r.cases),0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-300">
                    {(() => {
                      const tot = rows.reduce((s,r)=>{
                        const skuStock=Math.round(bySku[r.sku]??0);
                        const comm=Math.round(committed[r.sku]??0);
                        const share=skuStock>0?r.cases/skuStock:0;
                        return s+Math.round(comm*share);
                      },0);
                      return tot>0?tot.toLocaleString():"—";
                    })()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-400">
                    {rows.reduce((s,r)=>{
                      const skuStock=Math.round(bySku[r.sku]??0);
                      const comm=Math.round(committed[r.sku]??0);
                      const share=skuStock>0?r.cases/skuStock:0;
                      return s+Math.round(r.cases)-Math.round(comm*share);
                    },0).toLocaleString()}
                  </td>
                  <td colSpan={3}/>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </div>
  );
}
// ─── FP Input Tab ─────────────────────────────────────────────────────────────
function FPInputTab({ movements, loading, onAdded, lotMap }: { movements: FPRow[]; loading: boolean; onAdded: () => void; lotMap: Record<string, LotCard> }) {
  const [form, setForm] = useState({
    movement_date: ymd(), type: "In" as MoveType, sku: "XD" as SKU,
    cases: "", warehouse: "Lineage Newark" as Warehouse,
    lot_number: "", concept: "Production" as FPConcept,
    cogs_per_case: "", po_number_ref: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [editingFP, setEditingFP] = useState<FPRow | null>(null);
  const [confirmFPId, setConfirmFPId] = useState<string | null>(null);
  const [filterSku, setFilterSku] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterConcept, setFilterConcept] = useState<string>("all");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function save() {
    if (!form.cases || Number(form.cases) <= 0) { toast.error("Cases required"); return; }
    if (!form.lot_number && form.concept === "Production") { toast.error("Lot number required for Production"); return; }
    setSaving(true);
    const payload = {
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
    };
    const res = editingFP
      ? await supabase.from("fp_movements").update(payload).eq("id", editingFP.id)
      : await supabase.from("fp_movements").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(editingFP ? "Movement updated" : `FP movement added: ${form.type} ${form.cases} cases ${form.sku}`);
    setEditingFP(null);
    setForm(f => ({ ...f, cases: "", lot_number: "", cogs_per_case: "", po_number_ref: "", notes: "" }));
    onAdded();
  }

  function startEditFP(r: FPRow) {
    setEditingFP(r);
    const rr = r as any;
    setForm({
      movement_date: r.movement_date,
      type: r.type as MoveType,
      sku: r.sku as SKU,
      cases: String(r.cases),
      warehouse: r.warehouse as Warehouse,
      lot_number: r.lot_number ?? "",
      concept: r.concept as FPConcept,
      cogs_per_case: rr.cogs_per_case != null ? String(rr.cogs_per_case) : "",
      po_number_ref: rr.po_number_ref ?? "",
      notes: r.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEditFP() { setEditingFP(null); }

  async function removeFP(id: string) {
    const { error } = await supabase.from("fp_movements").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setConfirmFPId(null);
    toast.success("Movement deleted");
    onAdded();
  }

  const monthOptions = useMemo(
    () => [...new Set(movements.map(r => r.movement_date.slice(0, 7)))].sort().reverse(),
    [movements],
  );
  const conceptOptions = useMemo(
    () => [...new Set(movements.map(r => r.concept).filter(Boolean))].sort(),
    [movements],
  );

  const filtered = useMemo(() => {
    return [...movements]
      .filter(r =>
        (filterSku === "all" || r.sku === filterSku) &&
        (filterType === "all" || r.type === filterType) &&
        (filterConcept === "all" || r.concept === filterConcept) &&
        (filterMonth === "all" || r.movement_date.slice(0, 7) === filterMonth))
      .sort((a,b) => sortDir === "desc" ? (a.movement_date < b.movement_date ? 1 : -1) : (a.movement_date > b.movement_date ? 1 : -1));
  }, [movements, filterSku, filterType, filterConcept, filterMonth, sortDir]);

  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
        {editingFP && (
          <div className="mb-3 rounded-xl border px-4 py-2 text-sm font-semibold"
            style={{borderColor:"#A3224A",color:"#A3224A",backgroundColor:"#A3224A10"}}>
            Editing movement — {editingFP.lot_number || "(no lot)"} · {editingFP.sku}
          </div>
        )}
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>
          {editingFP ? "Edit FP Movement" : "New FP Movement"}
        </h3>
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
          {saving ? "Saving…" : editingFP ? "Update movement" : `+ Add ${form.type} · ${form.cases || "?"} cases ${form.sku}`}
        </button>
        {editingFP && (
          <button onClick={cancelEditFP} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
        )}
      </div>

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
            <select value={filterConcept} onChange={e => setFilterConcept(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
              <option value="all">All concepts</option>
              {conceptOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
              <option value="all">All months</option>
              {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
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
              <th className="px-4 py-2.5 text-right">COGS/pote</th>
              <th className="px-4 py-2.5 text-right">$ Value</th>
              <th className="px-4 py-2.5 text-left">Warehouse</th>
              <th className="px-4 py-2.5 text-left">Lot</th>
              <th className="px-4 py-2.5 text-left">Concept</th>
              <th className="px-4 py-2.5 text-left">Notes</th>
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : filtered.length === 0 ? <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No movements match filters</td></tr>
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
                  {(() => {
                    const { cogs } = resolveCogs(r, lotMap);
                    return (<>
                      <td className="px-4 py-1.5 text-right font-mono text-xs">
                        {cogs != null
                          ? <span className="text-emerald-700">${cogs.toFixed(2)}</span>
                          : <span className="text-orange-500 text-[10px]">⚠ missing</span>}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-xs">
                        {cogs != null
                          ? <span style={{color:"#1C2340"}}>${Math.round(Number(r.cases) * cogs * 8).toLocaleString()}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </>);
                  })()}
                  <td className="px-4 py-1.5 text-muted-foreground text-xs">{r.warehouse}</td>
                  <td className="px-4 py-1.5 font-mono text-xs" style={{color:"#A3224A"}}>{r.lot_number}</td>
                  <td className="px-4 py-1.5 text-xs">{r.concept}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground truncate max-w-[200px]">{r.notes ?? "—"}</td>
                  <td className="px-4 py-1.5 text-right">
                    {confirmFPId === r.id ? (
                      <span className="flex items-center justify-end gap-1.5 text-xs">
                        <span className="text-muted-foreground">Delete?</span>
                        <button onClick={() => removeFP(r.id)} className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">Yes</button>
                        <button onClick={() => setConfirmFPId(null)} className="rounded border border-border px-2 py-0.5 text-[10px]">No</button>
                      </span>
                    ) : (
                      <span className="flex justify-end gap-1.5">
                        <button onClick={() => startEditFP(r)} className="rounded border border-border px-2 py-0.5 text-[10px] font-semibold hover:bg-muted">Edit</button>
                        <button onClick={() => setConfirmFPId(r.id)} className="rounded border border-red-200 px-2 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50">Del</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
          {!loading && filtered.length > 0 && (() => {
            const totCases = filtered.reduce((s, r) => s + Number(r.cases || 0), 0);
            const totValue = filtered.reduce((s, r) => { const { cogs } = resolveCogs(r, lotMap); return s + (cogs != null ? Number(r.cases || 0) * cogs * 8 : 0); }, 0);
            return (
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 text-xs font-semibold" colSpan={3}>TOTAL ({filtered.length} mov.)</td>
                  <td className="px-4 py-2 text-right font-mono font-bold">{totCases.toLocaleString()}</td>
                  <td/>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${Math.round(totValue).toLocaleString()}</td>
                  <td colSpan={5}/>
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>
    </div>
  );
}
// ─── I&P Input Tab ────────────────────────────────────────────────────────────
function IPInputTab({ movements, loading, onAdded }: { movements: IPRow[]; loading: boolean; onAdded: () => void }) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const pendingUploadId = useRef<string | null>(null);

  async function uploadReceipt(file: File, movementId: string) {
    setUploadingId(movementId);
    const ext = file.name.split('.').pop();
    const path = `${movementId}/receipt_${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('ip-receipts')
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) toast.error('Upload failed: ' + error.message);
    else toast.success('Receipt saved ✓');
    setUploadingId(null);
  }
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
  const [filterWarehouse, setFilterWarehouse] = useState("all");
  const [filterReceived, setFilterReceived] = useState("all");
  const [filterPaid, setFilterPaid] = useState("all");
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
  const warehouses = useMemo(() => [...new Set(movements.map(r => (r as any).warehouse).filter(Boolean))].sort(), [movements]);

  const filtered = useMemo(() => {
    return [...movements]
      .filter(r => {
        const rr = r as any;
        return (filterConcept  === "all" || r.concept  === filterConcept) &&
        (filterType     === "all" || r.type     === filterType) &&
        (filterMaterial === "all" || r.material === filterMaterial) &&
        (filterWarehouse === "all" || rr.warehouse === filterWarehouse) &&
        (filterReceived === "all" || (filterReceived === "yes" ? (rr.received ?? false) : !(rr.received ?? false))) &&
        (filterPaid === "all" || (filterPaid === "yes" ? (rr.paid ?? false) : !(rr.paid ?? false)));
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortCol === "date")     cmp = a.movement_date.localeCompare(b.movement_date);
        if (sortCol === "material") cmp = a.material.localeCompare(b.material);
        if (sortCol === "qty")      cmp = Number(a.quantity) - Number(b.quantity);
        return sortDir === "asc" ? cmp : -cmp;
      });
  }, [movements, filterConcept, filterType, filterMaterial, filterWarehouse, filterReceived, filterPaid, sortCol, sortDir]);

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
      {/* Hidden file input for IP receipt upload */}
      <input ref={receiptRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f && pendingUploadId.current) uploadReceipt(f, pendingUploadId.current);
          e.target.value = '';
        }} />
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
        <select value={filterWarehouse} onChange={e => setFilterWarehouse(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
          <option value="all">All warehouses</option>
          {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
        <select value={filterReceived} onChange={e => setFilterReceived(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
          <option value="all">Received: all</option>
          <option value="yes">Received ✓</option>
          <option value="no">Not received</option>
        </select>
        <select value={filterPaid} onChange={e => setFilterPaid(e.target.value)}
          className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
          <option value="all">Paid: all</option>
          <option value="yes">Paid ✓</option>
          <option value="no">Not paid</option>
        </select>
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {filtered.length} records
        </span>
      </div>

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
                        <button
                          title="Upload payment receipt"
                          onClick={() => { pendingUploadId.current = r.id; receiptRef.current?.click(); }}
                          className={`text-[10px] mt-0.5 ${uploadingId === r.id ? 'animate-pulse text-amber-500' : 'text-muted-foreground hover:text-emerald-600'}`}>
                          {uploadingId === r.id ? '⏳' : '📎'}
                        </button>
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
          {!loading && filtered.length > 0 && (() => {
            const totCost = filtered.reduce((s, r) => { const rr = r as any; return s + Number(rr.total_price || 0) + Number(rr.shipping_price || 0) + Number(rr.other_costs || 0); }, 0);
            return (
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-3 py-2 text-xs font-semibold" colSpan={8}>TOTAL ({filtered.length} mov.)</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">${Math.round(totCost).toLocaleString()}</td>
                  <td colSpan={4}/>
                </tr>
              </tfoot>
            );
          })()}
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

      {/* ── Payment tracking ── */}
      {(() => {
        const allMovs = movements as any[];
        // Payment bucket date: paid → actual (fallback movement), pending → estimated (fallback movement)
        const payDate = (m:any): string =>
          (m.paid ? (m.actual_payment_date ?? m.movement_date) : (m.estimated_payment_date ?? m.movement_date)) ?? '';
        // Only payments from 2026 onwards (older I&P history is kept in the DB but hidden here)
        const rr = allMovs.filter(m => payDate(m) >= '2026-01');
        // Monthly paid vs pending (bucketed by payment date)
        const monthly: Record<string,{paid:number;pending:number}> = {};
        for (const m of rr) {
          const mon = payDate(m).slice(0,7);
          if (!mon) continue;
          const cost = (Number(m.total_price ?? 0)) + (Number(m.shipping_price ?? 0)) + (Number(m.other_costs ?? 0));
          if (!monthly[mon]) monthly[mon] = {paid:0,pending:0};
          if (m.paid) monthly[mon].paid += cost;
          else monthly[mon].pending += cost;
        }
        const months = Object.keys(monthly).sort().reverse();
        // Pending: unpaid with est. payment date
        const pending = rr
          .filter(m => !m.paid && m.estimated_payment_date)
          .sort((a,b) => a.estimated_payment_date.localeCompare(b.estimated_payment_date));
        const totalPending = rr.filter(m => !m.paid).reduce((s,m) => s + Number(m.total_price ?? 0) + Number(m.shipping_price ?? 0) + Number(m.other_costs ?? 0), 0);
        const totalPaid    = rr.filter(m =>  m.paid).reduce((s,m) => s + Number(m.total_price ?? 0) + Number(m.shipping_price ?? 0) + Number(m.other_costs ?? 0), 0);
        return (
          <div className="space-y-4">
            {/* KPIs */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Total Paid <span className="normal-case">(2026+)</span></p>
                <p className="text-xl font-bold font-mono text-emerald-600">${Math.round(totalPaid).toLocaleString()}</p>
              </div>
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Pending Payment <span className="normal-case">(2026+)</span></p>
                <p className="text-xl font-bold font-mono text-orange-600">${Math.round(totalPending).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">{rr.filter(m=>!m.paid).length} movements</p>
              </div>
              <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Next due</p>
                <p className="text-sm font-bold font-mono" style={{color:"#1C2340"}}>
                  {pending[0]?.estimated_payment_date ?? "—"}
                </p>
              </div>
            </div>
            {/* Monthly paid vs pending */}
            <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <p className="text-sm font-bold" style={{color:"#1C2340"}}>Monthly payments — paid vs pending</p>
                <p className="text-[11px] text-muted-foreground">From 2026 onwards · bucketed by payment date</p>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                    <th className="px-4 py-2.5 text-left">Month</th>
                    <th className="px-4 py-2.5 text-right text-emerald-700">Paid</th>
                    <th className="px-4 py-2.5 text-right text-orange-600">Pending</th>
                    <th className="px-4 py-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {months.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No payments recorded from 2026 onwards yet.</td></tr>
                  )}
                  {months.map(mon => (
                    <tr key={mon} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-1.5 font-semibold" style={{color:"#1C2340"}}>{mon}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-emerald-600">
                        {monthly[mon].paid > 0 ? `$${Math.round(monthly[mon].paid).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-orange-600">
                        {monthly[mon].pending > 0 ? `$${Math.round(monthly[mon].pending).toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">
                        ${Math.round(monthly[mon].paid + monthly[mon].pending).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Weekly pending */}
            {pending.length > 0 && (
              <div className="rounded-2xl border border-orange-200 bg-card shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b border-orange-200 bg-orange-50/40">
                  <p className="text-sm font-bold text-orange-700">Pending payments — by due date ({pending.length} movements)</p>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                      <th className="px-4 py-2.5 text-left">Due date</th>
                      <th className="px-4 py-2.5 text-left">Material</th>
                      <th className="px-4 py-2.5 text-left">Vendor</th>
                      <th className="px-4 py-2.5 text-right">Qty</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.slice(0,20).map((m:any) => {
                      const daysLeft = Math.ceil((new Date(m.estimated_payment_date).getTime()-Date.now())/86400000);
                      const color = daysLeft < 0 ? "text-red-600" : daysLeft <= 7 ? "text-orange-600" : "text-muted-foreground";
                      return (
                        <tr key={m.id} className="border-t border-border/60 hover:bg-muted/20">
                          <td className={`px-4 py-1.5 font-mono font-semibold ${color}`}>
                            {m.estimated_payment_date}
                            {daysLeft < 0 && <span className="ml-1 text-[9px]">({Math.abs(daysLeft)}d late)</span>}
                            {daysLeft >= 0 && daysLeft <= 7 && <span className="ml-1 text-[9px]">({daysLeft}d)</span>}
                          </td>
                          <td className="px-4 py-1.5 font-semibold" style={{color:"#1C2340"}}>{m.material}</td>
                          <td className="px-4 py-1.5 text-muted-foreground">{m.vendor ?? "—"}</td>
                          <td className="px-4 py-1.5 text-right font-mono">{Number(m.quantity).toLocaleString()} {m.unit}</td>
                          <td className="px-4 py-1.5 text-right font-mono text-orange-700">
                            {(m.total_price || m.shipping_price || m.other_costs)
                            ? `$${Math.round(Number(m.total_price??0)+Number(m.shipping_price??0)+Number(m.other_costs??0)).toLocaleString()}`
                            : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

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

      <IPHistoryTable movements={movements} />
    </div>
  );
}
// ─── BOM constants (from COGS Simulator · Source: Super BOM Consolidado) ─────
const UNITS_PER_CASE = 8;
const LBS_PER_UNIT = 0.344;
const SCRAP: Record<string, number> = { rasp: 0.10, choc: 0.08, other: 0 };

type BomLine = {
  material: string;
  unit: "lbs" | "Piece" | "cases";
  pct?: number;
  perCase?: number;
  scrapGroup: "rasp" | "choc" | "other";
};
const BOM: Record<string, BomLine[]> = {
  XD: [
    { material: "IQF Rasp",      unit: "lbs",  pct: 0.45, scrapGroup: "rasp" },
    { material: "Choc Ex Dark",  unit: "lbs",  pct: 0.55, scrapGroup: "choc" },
    { material: "Cocoa Butter",  unit: "lbs",  pct: 0.00, scrapGroup: "other" },
    { material: "Soy Lecithin",  unit: "lbs",  pct: 0.00, scrapGroup: "other" },
    { material: "Cup ED",        unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Lid ED",        unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Sealers",       unit: "Piece", perCase: 1, scrapGroup: "other" },
    { material: "Cases",         unit: "Piece", perCase: 1, scrapGroup: "other" },
  ],
  PW: [
    { material: "IQF Rasp",        unit: "lbs",  pct: 0.33, scrapGroup: "rasp" },
    { material: "Corinthian White", unit: "lbs",  pct: 0.571, scrapGroup: "choc" },
    { material: "Pistachio Paste",  unit: "lbs",  pct: 0.08, scrapGroup: "other" },
    { material: "Cocoa Butter",     unit: "lbs",  pct: 0.017, scrapGroup: "other" },
    { material: "Sea Salt",         unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Spirulina",        unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Soy Lecithin",     unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Cup P&W",          unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Lid P&W",          unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Sealers",          unit: "Piece", perCase: 1, scrapGroup: "other" },
    { material: "Cases",            unit: "Piece", perCase: 1, scrapGroup: "other" },
  ],
  HM: [
    { material: "IQF Rasp",         unit: "lbs",  pct: 0.33, scrapGroup: "rasp" },
    { material: "Corinthian White",  unit: "lbs",  pct: 0.229, scrapGroup: "choc" },
    { material: "Valcour Milk",      unit: "lbs",  pct: 0.33, scrapGroup: "choc" },
    { material: "Hazelnut Butter",   unit: "lbs",  pct: 0.10, scrapGroup: "other" },
    { material: "Cocoa Butter",      unit: "lbs",  pct: 0.009, scrapGroup: "other" },
    { material: "Sea Salt",          unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Soy Lecithin",      unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Cup H&M",           unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Lid H&M",           unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Sealers",           unit: "Piece", perCase: 1, scrapGroup: "other" },
    { material: "Cases",             unit: "Piece", perCase: 1, scrapGroup: "other" },
  ],
  WM: [
    { material: "IQF Rasp",         unit: "lbs",  pct: 0.30, scrapGroup: "rasp" },
    { material: "Corinthian White",  unit: "lbs",  pct: 0.388, scrapGroup: "choc" },
    { material: "Valcour Milk",      unit: "lbs",  pct: 0.30, scrapGroup: "choc" },
    { material: "Cocoa Butter",      unit: "lbs",  pct: 0.012, scrapGroup: "other" },
    { material: "Soy Lecithin",      unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Cup W&M",           unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Lid W&M",           unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Sealers",           unit: "Piece", perCase: 1, scrapGroup: "other" },
    { material: "Cases",             unit: "Piece", perCase: 1, scrapGroup: "other" },
  ],
  WD: [
    { material: "IQF Rasp",         unit: "lbs",  pct: 0.30, scrapGroup: "rasp" },
    { material: "RASG Dark 72%",     unit: "lbs",  pct: 0.30, scrapGroup: "choc" },
    { material: "Corinthian White",  unit: "lbs",  pct: 0.388, scrapGroup: "choc" },
    { material: "Cocoa Butter",      unit: "lbs",  pct: 0.012, scrapGroup: "other" },
    { material: "Soy Lecithin",      unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Cup W&D",           unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Lid W&D",           unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Sealers",           unit: "Piece", perCase: 1, scrapGroup: "other" },
    { material: "Cases",             unit: "Piece", perCase: 1, scrapGroup: "other" },
  ],
  Matcha: [
    { material: "IQF Rasp",         unit: "lbs",  pct: 0.45, scrapGroup: "rasp" },
    { material: "Corinthian White",  unit: "lbs",  pct: 0.529, scrapGroup: "choc" },
    { material: "Matcha",            unit: "lbs",  pct: 0.009, scrapGroup: "other" },
    { material: "Cocoa Butter",      unit: "lbs",  pct: 0.01, scrapGroup: "other" },
    { material: "Sea Salt",          unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Soy Lecithin",      unit: "lbs",  pct: 0.001, scrapGroup: "other" },
    { material: "Cup Matcha",        unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Lid Matcha",        unit: "Piece", perCase: UNITS_PER_CASE, scrapGroup: "other" },
    { material: "Sealers",           unit: "Piece", perCase: 1, scrapGroup: "other" },
    { material: "Cases",             unit: "Piece", perCase: 1, scrapGroup: "other" },
  ],
};

function calcBomQty(line: BomLine, cases: number): number {
  if (line.perCase !== undefined) return line.perCase * cases;
  const baseQty = (line.pct ?? 0) * cases * UNITS_PER_CASE * LBS_PER_UNIT;
  return baseQty / (1 - SCRAP[line.scrapGroup]);
}
// ─── FP Transfer Form ─────────────────────────────────────────────────────────
function FPTransferForm({ fpMovements, onAdded }: { fpMovements: FPRow[]; onAdded: () => void }) {
  const [form, setForm] = useState({
    date: ymd(), sku: "XD" as SKU, lot: "", cases: "",
    from_wh: "Heinlein", to_wh: "Lineage Newark", freight_per_case: "", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";
  const Lbl = ({ children }: { children: React.ReactNode }) => (
    <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{children}</label>
  );

  const lotCogs = useMemo(() => {
    if (!form.lot) return null;
    const match = fpMovements.find(m => m.lot_number === form.lot && m.type === "In");
    return (match as any)?.cogs_per_case ?? null;
  }, [form.lot, fpMovements]);

  const freight = parseFloat(form.freight_per_case) || 0;
  const newCogs = lotCogs != null ? lotCogs + freight : null;

  async function save() {
    if (!form.sku || !form.cases || !form.lot) { toast.error("SKU, lot and cases required"); return; }
    if (!form.from_wh || !form.to_wh) { toast.error("From and To warehouses required"); return; }
    if (form.from_wh === form.to_wh) { toast.error("From and To warehouses must be different"); return; }
    setSaving(true);

    const cases = Number(form.cases);
    const noteBase = `Transfer ${form.from_wh} → ${form.to_wh}${form.notes ? " · " + form.notes : ""}`;

    const { error: e1 } = await supabase.from("fp_movements").insert({
      movement_date: form.date, type: "Out" as const, sku: form.sku, cases,
      warehouse: form.from_wh as Warehouse, lot_number: form.lot,
      concept: "Transfer" as const, cogs_per_case: lotCogs ?? null, notes: noteBase,
    });
    if (e1) { toast.error(e1.message); setSaving(false); return; }

    const { error: e2 } = await supabase.from("fp_movements").insert({
      movement_date: form.date, type: "In" as const, sku: form.sku, cases,
      warehouse: form.to_wh as Warehouse, lot_number: form.lot,
      concept: "Transfer" as const, cogs_per_case: newCogs ?? lotCogs ?? null,
      notes: noteBase + (freight > 0 ? ` · freight $${freight.toFixed(2)}/case` : ""),
    });
    if (e2) { toast.error(e2.message); setSaving(false); return; }

    setSaving(false);
    toast.success(`Transfer saved · ${cases} cases ${form.sku} · ${form.from_wh} → ${form.to_wh}`);
    setForm(f => ({ ...f, lot: "", cases: "", freight_per_case: "", notes: "" }));
    onAdded();
  }

  const FP_WAREHOUSES_ALL = ["Heinlein","Lineage Newark","Cold Chain","Empire","OOE","FreezPak"];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
      <h3 className="text-sm font-bold mb-1" style={{ color:"#1C2340" }}>FP Transfer between warehouses</h3>
      <p className="text-xs text-muted-foreground mb-4">Creates one OUT + one IN movement · COGS carries over (+ freight if entered)</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div><Lbl>Date</Lbl>
          <input type="date" className={`${inp} mt-1`} value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
        <div><Lbl>SKU</Lbl>
          <select className={`${inp} mt-1`} value={form.sku}
            onChange={e => setForm(f => ({ ...f, sku: e.target.value as SKU, lot: "" }))}>
            {SKUS.map(s => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><Lbl>Lot #</Lbl>
          <input className={`${inp} mt-1 font-mono`} value={form.lot}
            onChange={e => setForm(f => ({ ...f, lot: e.target.value }))}
            placeholder="Type or paste lot" /></div>
        <div><Lbl>Cases *</Lbl>
          <input type="number" className={`${inp} mt-1 font-mono`} value={form.cases}
            onChange={e => setForm(f => ({ ...f, cases: e.target.value }))} /></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div><Lbl>From warehouse</Lbl>
          <select className={`${inp} mt-1`} value={form.from_wh}
            onChange={e => setForm(f => ({ ...f, from_wh: e.target.value }))}>
            {FP_WAREHOUSES_ALL.map(w => <option key={w} value={w}>{w}</option>)}
          </select></div>
        <div><Lbl>To warehouse</Lbl>
          <select className={`${inp} mt-1`} value={form.to_wh}
            onChange={e => setForm(f => ({ ...f, to_wh: e.target.value }))}>
            {FP_WAREHOUSES_ALL.map(w => <option key={w} value={w}>{w}</option>)}
          </select></div>
        <div><Lbl>Freight/case ($) · optional</Lbl>
          <input type="number" step="0.01" className={`${inp} mt-1 font-mono`}
            value={form.freight_per_case} placeholder="0.00"
            onChange={e => setForm(f => ({ ...f, freight_per_case: e.target.value }))} /></div>
        <div><Lbl>Notes</Lbl>
          <input className={`${inp} mt-1`} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" /></div>
      </div>
      {form.lot && (
        <div className="mb-4 rounded-xl bg-muted/30 border border-border px-4 py-2.5 flex gap-6 text-xs">
          <span>Source COGS: <span className="font-mono font-bold" style={{ color:"#1C2340" }}>
            {lotCogs != null ? `$${lotCogs.toFixed(2)}/case` : "—"}
          </span></span>
          {freight > 0 && <span>+ Freight: <span className="font-mono font-bold text-orange-600">${freight.toFixed(2)}/case</span></span>}
          {newCogs != null && <span className="ml-auto font-semibold">COGS at destination: <span className="font-mono text-emerald-700">${newCogs.toFixed(2)}/case</span></span>}
        </div>
      )}
      <button onClick={save} disabled={saving}
        className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor:"#1C2340" }}>
        {saving ? "Saving…" : `→ Transfer ${form.cases || "?"} cases ${form.sku} · ${form.from_wh} → ${form.to_wh}`}
      </button>
    </div>
  );
}

// ─── IP Historical Inventory ─────────────────────────────────────────────────
function IPHistoryTable({ movements }: { movements: IPRow[] }) {
  const [viewMode, setViewMode] = useState<"units"|"value">("units");
  const [filterMaterial, setFilterMaterial] = useState("all");
  const [stockView, setStockView] = useState<"ordered"|"received"|"paid"|"both">("ordered");

  const materials = useMemo(() => [...new Set(movements.map(r => r.material))].sort(), [movements]);

  const { monthList, history } = useMemo(() => {
    const mList = [...new Set(movements.map(m => m.movement_date.slice(0,7)))].sort();
    const shown = filterMaterial === "all" ? materials : [filterMaterial];
    const balance: Record<string, number> = {};
    const valueBalance: Record<string, number> = {};
    shown.forEach(s => { balance[s] = 0; valueBalance[s] = 0; });

    // View filter applies to purchases (In). Out (consumption) always counts.
    //   ordered  = count everything ordered · received = only In that arrived
    //   paid     = only In already paid   · both = In received AND paid
    const passes = (mv: any) => {
      if (stockView === "ordered" || mv.type !== "In") return true;
      const rc = mv.received ?? false, pd = mv.paid ?? false;
      if (stockView === "received") return rc;
      if (stockView === "paid") return pd;
      return rc && pd; // both
    };

    const sorted = [...movements].sort((a,b) => a.movement_date.localeCompare(b.movement_date));
    let mi = 0;
    const snaps: { month: string; units: Record<string, number>; value: Record<string, number> }[] = [];

    for (const mv of sorted) {
      if (!shown.includes(mv.material)) continue;
      const mo = mv.movement_date.slice(0,7);
      while (mi < mList.length && mList[mi] < mo) {
        snaps.push({ month: mList[mi], units: {...balance}, value: {...valueBalance} });
        mi++;
      }
      if (!passes(mv)) continue;
      const delta = mv.type === "In" ? Number(mv.quantity) : -Number(mv.quantity);
      balance[mv.material] = (balance[mv.material] || 0) + delta;
      const cogs = (mv as any).cogs_per_unit;
      if (cogs) valueBalance[mv.material] = (valueBalance[mv.material] || 0) + delta * cogs;
    }
    if (mi < mList.length) {
      snaps.push({ month: mList[mi] ?? "", units: {...balance}, value: {...valueBalance} });
    }
    // Show only July 2025 onwards; earlier months are hidden but their balance is
    // carried into the first visible column (accumulation stays correct).
    const visible = snaps.filter(s => s.month >= "2025-07");
    return { monthList: visible.map(s => s.month), history: visible };
  }, [movements, filterMaterial, materials, stockView]);

  const shownMaterials = filterMaterial === "all" ? materials : [filterMaterial];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Inventory history — closing stock by month</p>
          <p className="text-xs text-muted-foreground">
            End-of-month balance · from Jul 2025 · {
              stockView === "ordered" ? "all ordered" :
              stockView === "received" ? "only received" :
              stockView === "paid" ? "only paid" : "received & paid"}
          </p>
          <div className="mt-2 flex gap-1 rounded-xl bg-muted p-1 w-fit">
            {([["ordered","Ordered"],["received","Received"],["paid","Paid"],["both","Recv+Paid"]] as const).map(([v,label])=>(
              <button key={v} onClick={()=>setStockView(v)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${stockView===v?"text-white":"text-muted-foreground"}`}
                style={stockView===v?{backgroundColor:"#1C2340"}:{}}>{label}</button>
            ))}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={filterMaterial} onChange={e => setFilterMaterial(e.target.value)}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs focus:outline-none">
            <option value="all">All materials</option>
            {materials.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {(["units","value"] as const).map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${viewMode===m ? "text-white shadow-sm" : "text-muted-foreground"}`}
                style={viewMode===m ? {backgroundColor:"#1C2340"} : {}}>
                {m === "units" ? "Units" : "$ Value"}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2 text-left sticky left-0 bg-muted/20">Material</th>
              {monthList.map(m => (
                <th key={m} className="px-3 py-2 text-right whitespace-nowrap">{m.slice(2).replace("-","/")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shownMaterials.map(mat => (
              <tr key={mat} className="border-t border-border/40 hover:bg-muted/20">
                <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card" style={{color:"#1C2340"}}>{mat}</td>
                {history.map(snap => {
                  const val = viewMode === "units" ? snap.units[mat] || 0 : snap.value[mat] || 0;
                  return (
                    <td key={snap.month} className={`px-3 py-1.5 text-right font-mono ${val < 0 ? "text-red-600 font-semibold" : ""}`}>
                      {viewMode === "units"
                        ? (val || 0).toLocaleString()
                        : val ? `$${Math.round(val).toLocaleString()}` : "—"
                      }
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {filterMaterial === "all" && (
            <tfoot>
              <tr style={{backgroundColor:"#1C2340", color:"#fff"}}>
                <td className="px-4 py-2 font-semibold text-xs sticky left-0" style={{backgroundColor:"#1C2340"}}>TOTAL VALUE</td>
                {history.map(snap => {
                  const total = materials.reduce((s, m) => s + (snap.value[m] || 0), 0);
                  return (
                    <td key={snap.month} className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                      {total ? `$${Math.round(total).toLocaleString()}` : "—"}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
// ─── Production Tab ───────────────────────────────────────────────────────────
function ProductionTab({ fpMovements, ipMovements, onAdded }: {
  fpMovements: FPRow[]; ipMovements: IPRow[]; onAdded: () => void;
}) {
  const [activeForm, setActiveForm] = useState<"production"|"transfer">("production");
  const [runs, setRuns] = useState<any[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [form, setForm] = useState({
    run_date: ymd(), facility: "Heinlein" as Facility, sku: "XD" as SKU,
    cases_produced: "", lot_number: "", notes: "",
    override_cogs: "",
  });
  const [saving, setSaving] = useState(false);
  const [editingRun, setEditingRun] = useState<any | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [parsingReport, setParsingReport] = useState(false);

  async function parseProductionReport(file: File) {
    setParsingReport(true);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const mediaType = file.name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: `Extract production run data from this Heinlein production report. Return ONLY JSON (no markdown):
{
  "run_date": "YYYY-MM-DD",
  "sku": "XD|PW|HM|WM|WD|Matcha",
  "cases_produced": <number>,
  "lot_number": "<lot code>",
  "cogs_per_case": <number or null if not available>,
  "notes": "<any relevant notes or null>"
}` }
            ]
          }]
        })
      });
      const data = await resp.json();
      const text = data.content?.find((c: any) => c.type === 'text')?.text ?? '';
      const parsed = JSON.parse(text.replace(/\`\`\`json|\`\`\`/g, '').trim());
      setForm(f => ({
        ...f,
        run_date: parsed.run_date || f.run_date,
        sku: (parsed.sku || f.sku) as SKU,
        cases_produced: parsed.cases_produced ? String(parsed.cases_produced) : f.cases_produced,
        lot_number: parsed.lot_number || f.lot_number,
        override_cogs: parsed.cogs_per_case ? String(parsed.cogs_per_case) : f.override_cogs,
        notes: parsed.notes || f.notes,
      }));
      toast.success("Report parsed — review fields and save");
    } catch (e: any) {
      toast.error("Could not parse report: " + e.message);
    } finally {
      setParsingReport(false);
    }
  }

  useEffect(() => { loadRuns(); }, []);

  async function loadRuns() {
    const { data } = await supabase.from("production_runs").select("*").order("run_date", { ascending: false });
    setRuns(data ?? []);
    setLoadingRuns(false);
  }

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  const cases = Number(form.cases_produced) || 0;
  const bom = BOM[form.sku] ?? [];

  const ipStock = useMemo(() => {
    const map = new Map<string, { material: string; lot: string; qty: number; cogs: number | null; unit: string }>();
    for (const r of ipMovements) {
      const rr = r as any;
      const key = `${r.material}|${r.lot_number ?? "—"}`;
      const cur = map.get(key) ?? { material: r.material, lot: r.lot_number ?? "—", qty: 0, cogs: null, unit: r.unit ?? "lbs" };
      cur.qty += r.type === "In" ? Number(r.quantity) : -Number(r.quantity);
      if (cur.cogs == null && rr.cogs_per_unit) cur.cogs = rr.cogs_per_unit;
      map.set(key, cur);
    }
    return map;
  }, [ipMovements]);

  const bomLines = useMemo(() => {
    if (cases <= 0) return bom.map(line => ({ ...line, qty: 0, cogsContrib: 0, availableLots: [] as any[], cogs: null as number | null }));
    return bom.filter(l => (l.pct ?? 0) > 0 || (l.perCase ?? 0) > 0).map(line => {
      const qty = calcBomQty(line, cases);
      const availableLots = [...ipStock.entries()]
        .filter(([, v]) => v.material === line.material && v.qty > 0)
        .map(([, v]) => v)
        .sort((a, b) => a.lot.localeCompare(b.lot));
      const cogs = availableLots[0]?.cogs ?? null;
      const cogsContrib = cogs != null ? qty * cogs : 0;
      return { ...line, qty, cogsContrib, availableLots, cogs };
    });
  }, [bom, cases, ipStock]);

  const tolling = 0.65;
  const autoCogs = useMemo(() => {
    if (cases <= 0) return 0;
    const ingredientCogs = bomLines.reduce((s, l) => s + l.cogsContrib, 0);
    return (ingredientCogs / cases) + tolling;
  }, [bomLines, cases]);

  const finalCogs = form.override_cogs ? Number(form.override_cogs) : autoCogs;

  async function save() {
    if (!form.cases_produced || cases <= 0) { toast.error("Cases produced required"); return; }
    if (!form.lot_number) { toast.error("Lot number required"); return; }
    if (finalCogs <= 0) { toast.error("COGS could not be calculated — enter override COGS manually"); return; }
    setSaving(true);

    const runPayload = {
      run_date: form.run_date, facility: form.facility, sku: form.sku,
      cases_produced: cases, cogs_per_case: finalCogs,
      lot_number: form.lot_number, notes: form.notes || null,
    };

    if (editingRun) {
      const { error } = await supabase.from("production_runs").update(runPayload).eq("id", editingRun.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Production run updated");
    } else {
      const { data: runData, error: runErr } = await supabase
        .from("production_runs").insert(runPayload).select().single();
      if (runErr || !runData) { toast.error(runErr?.message ?? "Failed"); setSaving(false); return; }

      const fpWh: Warehouse = form.facility === "Heinlein" ? "Heinlein" : form.facility === "Empire" ? "Empire" : "OOE";
      await supabase.from("fp_movements").insert({
        movement_date: form.run_date, type: "In" as const,
        sku: form.sku, cases, warehouse: fpWh,
        lot_number: form.lot_number, concept: "Production" as const,
        cogs_per_case: finalCogs,
        notes: `Production run · ${form.facility} · ${form.run_date}`,
      });

      for (const line of bomLines) {
        if (line.qty <= 0) continue;
        const lot = line.availableLots[0];
        await supabase.from("ip_movements").insert({
          movement_date: form.run_date, type: "Out" as const,
          material: line.material, quantity: Math.round(line.qty * 100) / 100,
          unit: line.unit, lot_number: lot?.lot ?? null,
          concept: "Consumption" as const,
          cogs_per_unit: lot?.cogs ?? null,
          notes: `BOM consumption · ${form.sku} · ${cases} cases · lot ${form.lot_number}`,
        });
      }

      toast.success(`Production run saved · ${cases} cases ${form.sku} · ${bomLines.length} IP movements created`);
    }

    setSaving(false);
    setEditingRun(null);
    setForm(f => ({ ...f, cases_produced: "", lot_number: "", notes: "", override_cogs: "" }));
    loadRuns();
    onAdded();
  }

  function startEdit(r: any) {
    setEditingRun(r);
    setForm({
      run_date: r.run_date, facility: r.facility as Facility, sku: r.sku as SKU,
      cases_produced: String(r.cases_produced), lot_number: r.lot_number ?? "",
      notes: r.notes ?? "", override_cogs: String(r.cogs_per_case),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function removeRun(id: string) {
    const runToDelete = runs.find(r => r.id === id);
    if (!runToDelete) { toast.error("Run not found"); return; }

    await supabase.from("fp_movements")
      .delete()
      .eq("lot_number", runToDelete.lot_number)
      .eq("concept", "Production")
      .eq("sku", runToDelete.sku)
      .eq("movement_date", runToDelete.run_date)
      .eq("type", "In");

    await supabase.from("ip_movements")
      .delete()
      .eq("concept", "Consumption")
      .eq("movement_date", runToDelete.run_date)
      .ilike("notes", `%${runToDelete.lot_number}%`);

    const { error } = await supabase.from("production_runs").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setConfirmId(null);
    toast.success(`Production run deleted · FP movement and IP consumptions removed`);
    loadRuns();
    onAdded();
  }

  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";
  const Lbl = ({ children }: { children: React.ReactNode }) => (
    <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{children}</label>
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-xl bg-muted p-1 w-fit">
        {(["production","transfer"] as const).map(m => (
          <button key={m} onClick={() => setActiveForm(m)}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${activeForm===m ? "text-white shadow-sm" : "text-muted-foreground"}`}
            style={activeForm===m ? { backgroundColor: m==="production" ? "#A3224A" : "#1C2340" } : {}}>
            {m === "production" ? "Production run" : "Warehouse transfer"}
          </button>
        ))}
      </div>

      {activeForm === "transfer" && (
        <FPTransferForm fpMovements={fpMovements} onAdded={onAdded} />
      )}

      {activeForm === "production" && (
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          {editingRun && (
            <div className="mb-3 rounded-xl border px-4 py-2 text-sm font-semibold"
              style={{ borderColor:"#A3224A", color:"#A3224A", backgroundColor:"#A3224A10" }}>
              Editing run — {editingRun.lot_number}
            </div>
          )}
          <h3 className="text-sm font-bold mb-4" style={{ color:"#1C2340" }}>
            {editingRun ? "Edit Production Run" : "New Production Run"}
          </h3>

          {!editingRun && (
            <div className="mb-5">
              <label className="cursor-pointer block">
                <div className="rounded-2xl border-2 border-dashed p-5 text-center hover:opacity-80 transition-opacity"
                  style={{borderColor:"#A3224A", backgroundColor:"#A3224A08"}}>
                  <div className="text-3xl mb-2">📄</div>
                  <p className="text-sm font-bold" style={{color:"#A3224A"}}>Upload Heinlein production report</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF or Excel · AI reads BOM, lot number and cases automatically</p>
                  <div className="mt-3 inline-block rounded-lg px-5 py-2 text-sm font-semibold text-white" style={{backgroundColor:"#A3224A"}}>
                    Choose file
                  </div>
                </div>
                <input type="file" accept=".pdf,.xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) parseProductionReport(f); }} />
              </label>
              {parsingReport && (
                <div className="mt-2 rounded-xl bg-muted/40 p-3 text-center text-sm text-muted-foreground">
                  <span className="animate-pulse">🤖 AI is reading the report and filling the form…</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div><Lbl>Run Date</Lbl>
              <input type="date" className={`${inp} mt-1`} value={form.run_date}
                onChange={e => set("run_date", e.target.value)} /></div>
            <div><Lbl>Facility</Lbl>
              <select className={`${inp} mt-1`} value={form.facility} onChange={e => set("facility", e.target.value)}>
                {FACILITIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select></div>
            <div><Lbl>SKU</Lbl>
              <select className={`${inp} mt-1`} value={form.sku} onChange={e => set("sku", e.target.value)}>
                {SKUS.map(s => <option key={s} value={s}>{s} ({SKU_ITEMS[s as SKU]})</option>)}
              </select></div>
            <div><Lbl>Cases Produced *</Lbl>
              <input type="number" className={`${inp} mt-1 font-mono`} value={form.cases_produced}
                min={1} onChange={e => set("cases_produced", e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <div><Lbl>Lot # *</Lbl>
              <input className={`${inp} mt-1 font-mono`} value={form.lot_number}
                onChange={e => set("lot_number", e.target.value)} placeholder="e.g. HEI-2026-07" /></div>
            <div>
              <Lbl>COGS override ($) · leave blank = auto</Lbl>
              <input type="number" step="0.01" className={`${inp} mt-1 font-mono`}
                value={form.override_cogs} placeholder={autoCogs > 0 ? `Auto: $${autoCogs.toFixed(2)}` : "—"}
                onChange={e => set("override_cogs", e.target.value)} />
            </div>
            <div><Lbl>Notes</Lbl>
              <input className={`${inp} mt-1`} value={form.notes} onChange={e => set("notes", e.target.value)} /></div>
          </div>

          {cases > 0 && (
            <div className="rounded-xl border border-border bg-muted/20 p-3 mb-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                BOM · {cases} cases of {form.sku} — auto-generated IP OUT movements on save
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/60">
                      <th className="pb-1.5 text-left">Material</th>
                      <th className="pb-1.5 text-right">Qty needed</th>
                      <th className="pb-1.5 text-left pl-3">Available lot</th>
                      <th className="pb-1.5 text-right">Available qty</th>
                      <th className="pb-1.5 text-right">COGS/unit</th>
                      <th className="pb-1.5 text-right">COGS contrib.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomLines.map(line => {
                      const firstLot = line.availableLots[0];
                      const enough = firstLot ? firstLot.qty >= line.qty : false;
                      return (
                        <tr key={line.material} className={`border-t border-border/40 ${!enough ? "bg-red-50/30" : ""}`}>
                          <td className="py-1 font-semibold" style={{ color:"#1C2340" }}>{line.material}</td>
                          <td className="py-1 text-right font-mono">
                            {line.qty.toFixed(1)} {line.unit}
                          </td>
                          <td className="py-1 pl-3 font-mono text-muted-foreground text-[10px]">
                            {firstLot ? firstLot.lot : <span className="text-red-600 font-semibold">⚠ no stock</span>}
                          </td>
                          <td className="py-1 text-right font-mono text-muted-foreground">
                            {firstLot ? `${firstLot.qty.toLocaleString()} ${line.unit}` : "—"}
                            {!enough && firstLot && <span className="ml-1 text-red-600 font-semibold">⚠</span>}
                          </td>
                          <td className="py-1 text-right font-mono text-muted-foreground">
                            {line.cogs != null ? `$${line.cogs.toFixed(4)}` : "—"}
                          </td>
                          <td className="py-1 text-right font-mono font-semibold" style={{ color:"#A3224A" }}>
                            {line.cogsContrib > 0 ? `$${line.cogsContrib.toFixed(2)}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-border font-semibold bg-muted/10">
                      <td className="py-1.5" colSpan={5} style={{ color:"#1C2340" }}>
                        Ingredients + Tolling (${tolling.toFixed(2)}/case)
                      </td>
                      <td className="py-1.5 text-right font-mono text-emerald-700">
                        {finalCogs > 0 ? `$${finalCogs.toFixed(2)}/case` : "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {form.override_cogs && (
                <p className="mt-2 text-[10px] text-orange-600 font-semibold">
                  ⚠ Using manual COGS override of ${Number(form.override_cogs).toFixed(2)}/case instead of calculated ${autoCogs.toFixed(2)}/case
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor:"#A3224A" }}>
              {saving ? "Saving…"
                : editingRun ? "Update run"
                : `+ Save · ${cases || "?"} cases ${form.sku} · COGS $${finalCogs > 0 ? finalCogs.toFixed(2) : "?"}`}
            </button>
            {editingRun && (
              <button onClick={() => { setEditingRun(null); setForm(f => ({ ...f, cases_produced:"", lot_number:"", notes:"", override_cogs:"" })); }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">Cancel</button>
            )}
            {!editingRun && <p className="text-xs text-muted-foreground self-center">↳ Creates FP IN + {bomLines.length} IP OUT movements</p>}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <p className="text-sm font-semibold" style={{ color:"#1C2340" }}>Production History</p>
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
              <th className="px-4 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loadingRuns
              ? <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
              : runs.length === 0
              ? <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">No production runs yet</td></tr>
              : runs.map(r => (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-1.5 font-mono text-xs">{r.run_date}</td>
                  <td className="px-4 py-1.5 text-xs">{r.facility}</td>
                  <td className="px-4 py-1.5 font-semibold" style={{ color:"#1C2340" }}>{r.sku}</td>
                  <td className="px-4 py-1.5 text-right font-mono font-semibold">{Number(r.cases_produced).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">${Number(r.cogs_per_case).toFixed(2)}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-emerald-600">
                    ${Math.round(Number(r.cases_produced) * Number(r.cogs_per_case)).toLocaleString()}
                  </td>
                  <td className="px-4 py-1.5 font-mono text-xs" style={{ color:"#A3224A" }}>{r.lot_number}</td>
                  <td className="px-4 py-1.5 text-xs text-muted-foreground">{r.notes ?? "—"}</td>
                  <td className="px-4 py-1.5 text-right">
                    {confirmId === r.id ? (
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-[10px] text-amber-600 font-semibold">⚠ Also deletes linked FP + IP movements</span>
                        <span className="flex items-center gap-1.5 text-xs">
                          Delete?
                          <button onClick={() => removeRun(r.id)}
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
      ingredient: ing, lbs,
      price: prices[ing] ?? DEFAULT_PRICES[ing] ?? 3.0,
      cost: lbs * (prices[ing] ?? DEFAULT_PRICES[ing] ?? 3.0),
    }));
    const rm = breakdown.reduce((s, b) => s + b.cost, 0);
    return { rm, total: rm + tolling + packaging, breakdown };
  }

  const allIngredients = [...new Set(Object.values(BOM_DATA).flatMap(b => Object.keys(b.ingredients)))].sort();
  const detail = calcCOGS(selectedSku);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
            <p className="text-sm font-bold" style={{color:"#1C2340"}}>Ingredient Prices ($/lb)</p>
            <button onClick={() => setPrices({...DEFAULT_PRICES})}
              className="rounded-lg px-3 py-1 text-xs border border-border hover:bg-muted">↺ Reset</button>
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
                    <input type="number" step="0.01" min="0" value={current}
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

          <div className="rounded-2xl border border-border bg-card shadow-sm p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Gross Margin preview at standard price</p>
            {[["UNFI/KeHe", 36.96], ["RFD", 38.50]].map(([dist, price]) => {
              const net = (price as number) * 0.82;
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
const LBS_PER_CASE_BOM = 2.5;   // legacy reference basis
const UNITS_PER_CASE_BOM = 8;
const DEFAULT_PROD_COSTS = { tolling_per_unit:0.65, cup_per_unit:0.095, lid_per_unit:0.092, sealer_per_unit:0.030, case_per_case:0.36 };

// ─── Procurement material master + BOM (quantities are PER CASE of 8 units) ───
const PROC_SKUS: string[] = ["XD","PW","HM","WM","WD","Matcha","Strawberry"];
const PROC_SKU_LABEL: Record<string,string> = {
  XD:"Extra Dark", PW:"Pistachio & White", HM:"Hazelnut & Milk",
  WM:"White & Milk", WD:"White & Dark", Matcha:"Matcha & White", Strawberry:"Strawberry",
};
const RAW_MATS = [
  "IQF Raspberries","Choc Extra Dark (Revere 70%)","Choc Dark (Duluth)","Choc Milk (Valcour)",
  "Choc White (Corinthian)","Cocoa Butter","Hazelnut Butter","Pistachio Paste",
  "Matcha Powder","Spirulina","Sea Salt","Soy Lecithin",
];
const PACK_MATS = [
  ...PROC_SKUS.map(s=>`Cup - ${PROC_SKU_LABEL[s]}`),
  ...PROC_SKUS.map(s=>`Lid - ${PROC_SKU_LABEL[s]}`),
  "Sealers (Momar)","Master Cases (8u)",
];
const ALL_INGS = [...RAW_MATS, ...PACK_MATS];
const RAW_SET = new Set(RAW_MATS);
const isRawMat = (m:string)=>RAW_SET.has(m);

// Per-case BOM (lbs for raw, units for packaging). Packaging filled programmatically.
const BOM_QTY: Record<string, Record<string, number>> = (()=>{
  const b: Record<string, Record<string, number>> = {
    XD:     { "IQF Raspberries":1.159794, "Choc Extra Dark (Revere 70%)":1.417526 },
    PW:     { "IQF Raspberries":0.850515, "Choc White (Corinthian)":1.472552, "Cocoa Butter":0.043428, "Pistachio Paste":0.206186, "Spirulina":0.000747, "Sea Salt":0.001289, "Soy Lecithin":0.002655 },
    HM:     { "IQF Raspberries":0.850515, "Choc Milk (Valcour)":0.850515, "Choc White (Corinthian)":0.602835, "Cocoa Butter":0.012062, "Hazelnut Butter":0.257732, "Sea Salt":0.002577, "Soy Lecithin":0.001082 },
    WM:     { "IQF Raspberries":0.773196, "Choc Milk (Valcour)":0.773196, "Choc White (Corinthian)":0.998892, "Cocoa Butter":0.030232, "Soy Lecithin":0.001804 },
    WD:     { "IQF Raspberries":0.773196, "Choc White (Corinthian)":0.999149, "Cocoa Butter":0.029974, "Soy Lecithin":0.001804 },
    Matcha: { "IQF Raspberries":1.159794, "Choc White (Corinthian)":1.363067, "Cocoa Butter":0.025773, "Matcha Powder":0.022680, "Sea Salt":0.003557, "Soy Lecithin":0.002448 },
    Strawberry: {},
  };
  for (const s of PROC_SKUS) {
    b[s] = b[s] || {};
    b[s][`Cup - ${PROC_SKU_LABEL[s]}`] = 8;
    b[s][`Lid - ${PROC_SKU_LABEL[s]}`] = 8;
    b[s]["Sealers (Momar)"] = 8;
    b[s]["Master Cases (8u)"] = 1;
  }
  return b;
})();

const DEFAULT_SCRAP: Record<string,number> = (()=>{
  const o:Record<string,number>={};
  for (const m of RAW_MATS) o[m] = m==="IQF Raspberries" ? 25
    : ["Choc Dark (Duluth)","Choc Milk (Valcour)","Choc White (Corinthian)"].includes(m) ? 20 : 10;
  for (const m of PACK_MATS) o[m] = 2;
  return o;
})();
const DEFAULT_OVERFILL: Record<string,number> = Object.fromEntries(
  ALL_INGS.map(m=>[m, isRawMat(m)?5:0]));
const DEFAULT_LEAD_MAT: Record<string,number> = (()=>{
  const o:Record<string,number>={};
  for (const m of RAW_MATS) o[m] = m==="IQF Raspberries" ? 12
    : ["Choc Extra Dark (Revere 70%)","Choc Dark (Duluth)","Choc Milk (Valcour)","Choc White (Corinthian)"].includes(m) ? 10 : 6;
  for (const s of PROC_SKUS){ o[`Cup - ${PROC_SKU_LABEL[s]}`]=12; o[`Lid - ${PROC_SKU_LABEL[s]}`]=12; }
  o["Sealers (Momar)"]=6; o["Master Cases (8u)"]=6;
  return o;
})();
const RAW_PRICES: Record<string,number> = {
  "IQF Raspberries":2.91,"Choc Extra Dark (Revere 70%)":5.50,"Choc Dark (Duluth)":4.88,
  "Choc Milk (Valcour)":5.20,"Choc White (Corinthian)":3.20,"Cocoa Butter":6.50,
  "Hazelnut Butter":12.20,"Pistachio Paste":17.23,"Matcha Powder":19.50,
  "Spirulina":11.88,"Sea Salt":8.45,"Soy Lecithin":3.10,
};
const DEFAULT_ING_PRICES: Record<string,number> = (()=>{
  const o:Record<string,number>={...RAW_PRICES};
  for (const s of PROC_SKUS){ o[`Cup - ${PROC_SKU_LABEL[s]}`]=0.095; o[`Lid - ${PROC_SKU_LABEL[s]}`]=0.092; }
  o["Sealers (Momar)"]=0.030; o["Master Cases (8u)"]=0.36;
  return o;
})();
const RAW_PACK: Record<string,number> = {
  "IQF Raspberries":22,"Choc Extra Dark (Revere 70%)":1100,"Choc Dark (Duluth)":1100,
  "Choc Milk (Valcour)":1100,"Choc White (Corinthian)":1100,"Cocoa Butter":1100,
  "Hazelnut Butter":550,"Pistachio Paste":550,"Matcha Powder":44,
  "Spirulina":55,"Sea Salt":55,"Soy Lecithin":55,
};
const ING_PACK_SIZES: Record<string,number> = (()=>{
  const o:Record<string,number>={...RAW_PACK};
  for (const m of PACK_MATS) o[m] = 1;
  return o;
})();
const SKU_MIX_PCT: Record<string,number> = {XD:0.30,PW:0.25,HM:0.18,WM:0.12,WD:0.08,Matcha:0.07};

// Maps an IP Summary material name → Procurement material name (to pull current stock from I&P).
const IP_TO_PROC_MAT: Record<string,string> = {
  "IQF Rasp":"IQF Raspberries",
  "Choc Ex Dark":"Choc Extra Dark (Revere 70%)",
  "Choc Dark":"Choc Dark (Duluth)",
  "Choc Milk":"Choc Milk (Valcour)",
  "Choc White":"Choc White (Corinthian)",
  "Cocoa Butter":"Cocoa Butter",
  "Hazelnut Butter":"Hazelnut Butter",
  "Pistachio Paste":"Pistachio Paste",
  "Matcha":"Matcha Powder",
  "Spirulina":"Spirulina",
  "Sea Salt":"Sea Salt",
  "Soy Lecithin":"Soy Lecithin",
  "Cup ED":"Cup - Extra Dark",
  "Cup P&W":"Cup - Pistachio & White",
  "Cup H&M":"Cup - Hazelnut & Milk",
  "Cup W&M":"Cup - White & Milk",
  "Cup W&D":"Cup - White & Dark",
  "Cup Matcha":"Cup - Matcha & White",
  "Lid ED":"Lid - Extra Dark",
  "Lid P&W":"Lid - Pistachio & White",
  "Lid H&M":"Lid - Hazelnut & Milk",
  "Lid W&M":"Lid - White & Milk",
  "Lid W&D":"Lid - White & Dark",
  "Lid Matcha":"Lid - Matcha & White",
  "Sealers":"Sealers (Momar)",
  "Cases":"Master Cases (8u)",
};
type PayTerm = "t0"|"lead"|"lead1m";
const PAY_TERM_LABEL: Record<PayTerm,string> = { t0:"On order (t=0)", lead:"On arrival (t=lead)", lead1m:"30d after receipt" };
const PAY_TERM_KEY = "baris.ops.payTerms.v1";


const FORECAST_MONTHS_OPS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setMonth(d.getMonth() + i);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
});
const FORECAST_KEYS_OPS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + i);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
});
function buildOpsForecast(bySkuMonthKey: Record<string, Record<string, number>>): Record<string, number[]> {
  return Object.fromEntries(SKUS.map(sku => [
    sku,
    FORECAST_KEYS_OPS.map(k => bySkuMonthKey[sku]?.[k] ?? 0),
  ]));
}
// First-of-month Date for forecast month index i (production month)
function opsMonthDate(i: number): Date {
  const k = FORECAST_KEYS_OPS[i] ?? FORECAST_KEYS_OPS[0];
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1);
}
function shiftWeeks(d: Date, weeks: number): Date {
  const x = new Date(d); x.setDate(x.getDate() - Math.round(weeks * 7)); return x;
}
function fmtMonthShort(d: Date): string { return d.toLocaleString("en-US", { month: "short", year: "2-digit" }); }
function monthKeyOf(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
// When a purchase is paid, given production month date, its lead time, and payment terms.
function payDateFor(prodDate: Date, leadWeeks: number, term: PayTerm): Date {
  if (term === "t0") return shiftWeeks(prodDate, leadWeeks);              // pay when ordered (production − lead)
  if (term === "lead") return new Date(prodDate);                        // pay on arrival (≈ production month)
  return new Date(prodDate.getFullYear(), prodDate.getMonth() + 1, 1);   // 30d after receipt (next month)
}

type ProcSubTab = "schedule"|"stock_proj"|"bom_cogs"|"shopping"|"raw_materials"|"payments";

const MANUAL_PROD_KEY = "baris.ops.manualProd.v1";
const SKU_MINS_KEY = "baris.ops.skuMins.v1";
const BOM_PCT_KEY = "baris.ops.bomPct.v1";
const LEAD_KEY = "baris.ops.leadTimes.v1";
const DEFAULT_LEAD_WEEKS = 4;

/** Production requirements coming from the Sales simulator (committed scenario wins). */
function CommittedRequirements({ planScenario, onPlanScenarioChange, forecast, months }: { planScenario: SalesScenario; onPlanScenarioChange: (s: SalesScenario) => void; forecast: Record<string,number[]>; months: string[] }) {
  function exportCsv(){
    const head = ["Month",...PROC_SKUS,"TOTAL"];
    const rows = months.map((label,i)=>[
      label,
      ...PROC_SKUS.map(s=>Math.round(forecast[s]?.[i]??0)),
      PROC_SKUS.reduce((a,s)=>a+Math.round(forecast[s]?.[i]??0),0),
    ]);
    const csv=[head,...rows].map(r=>r.join(",")).join("\n");
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    const a=document.createElement("a");
    a.href=url; a.download="forecast-by-sku.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <div>
          <p className="text-sm font-bold" style={{color:"#1C2340"}}>Forecast sales by SKU — {planScenario} scenario</p>
          <p className="text-xs text-muted-foreground">
            Monthly forecast driving this whole tab. Switch scenario to recalculate schedule, stock, shopping &amp; payments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-muted p-1">
            {(["Pessimistic","Normal","Optimistic"] as const).map(s=>(
              <button key={s} onClick={()=>onPlanScenarioChange(s)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${planScenario===s?"text-white":"text-muted-foreground"}`}
                style={planScenario===s?{backgroundColor:s==="Pessimistic"?"#EF4444":s==="Normal"?"#1C2340":"#10B981"}:{}}>
                {s}
              </button>
            ))}
          </div>
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
              {PROC_SKUS.map(s=><th key={s} className="px-3 py-2 text-right" title={PROC_SKU_LABEL[s]}>{s}</th>)}
              <th className="px-4 py-2 text-right font-bold">TOTAL</th>
            </tr>
          </thead>
          <tbody>
            {months.map((label,i)=>{
              const rowTotal = PROC_SKUS.reduce((a,s)=>a+Math.round(forecast[s]?.[i]??0),0);
              return (
                <tr key={label} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-1.5 font-semibold">{label}</td>
                  {PROC_SKUS.map(s=><td key={s} className="px-3 py-1.5 text-right font-mono">{Math.round(forecast[s]?.[i]??0).toLocaleString()}</td>)}
                  <td className="px-4 py-1.5 text-right font-mono font-bold">{rowTotal.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function calcCOGSFull(prices: Record<string,number>, costs: typeof DEFAULT_PROD_COSTS, matScrap: Record<string,number>, matOverfill: Record<string,number>, bomQty: Record<string, Record<string, number>>) {
  return Object.fromEntries(PROC_SKUS.map(sku => {
    const bom = bomQty[sku]??{};
    let rasp=0,choc=0,other=0,pkg=0;
    for (const [mat,qty] of Object.entries(bom)) {
      if (!qty) continue;
      const price=prices[mat]??0;
      const factor=(1+(matScrap[mat]??0)/100)*(1+(matOverfill[mat]??0)/100);
      const cost=qty*price*factor;   // per case
      if (isRawMat(mat)) {
        if (mat==="IQF Raspberries") rasp+=cost;
        else if (mat.startsWith("Choc")) choc+=cost;
        else other+=cost;
      } else {
        pkg+=cost;
      }
    }
    const tollingCase=(costs.tolling_per_unit??0)*UNITS_PER_CASE_BOM;
    const per_case=rasp+choc+other+pkg+tollingCase;
    const per_unit=per_case/UNITS_PER_CASE_BOM;
    return [sku,{rasp:rasp/UNITS_PER_CASE_BOM,choc:choc/UNITS_PER_CASE_BOM,other:other/UNITS_PER_CASE_BOM,pkg:pkg/UNITS_PER_CASE_BOM,tolling:costs.tolling_per_unit,per_unit,per_case}];
  }));
}

/** ─── MODIFIED calcProdSchedule with manual overrides, per-SKU mins, truck opt ── */
function calcProdSchedule(
  stockBySku: Record<string,number>,
  orders: any[],
  safetyWoh: number,
  minRun: number,
  freqMonths: number,
  FORECAST_SKU_OPS: Record<string,number[]>,
  wipBySku: Record<string,number>,
  skuMinRuns: Record<string,number>,
  manualProd: Record<string,number[]>,
  optimizeTruck: boolean,
  bomQty: Record<string, Record<string, number>>,
  matScrap: Record<string,number>,
  matOverfill: Record<string,number>,
) {
  const SK: Record<string,string>={XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"};
  const committed: Record<string,number>={};
  const openOrders = orders.filter(o => COMMITTED_STATUSES.includes(o.status));
  for(const sku of SKUS) committed[sku]=openOrders.reduce((s,o)=>s+(Number(o[SK[sku]])||0),0);
  const plan: Record<string,number[]>={};
  const stockProj: Record<string,number[]>={};
  const ingNeeded: Record<string,number>={};
  const ingByMonth: Record<string,number[]>={};
  for(const sku of PROC_SKUS) {
    let running=Math.max(0,(stockBySku[sku]??0)-(committed[sku]??0))+(wipBySku[sku]??0);
    plan[sku]=[]; stockProj[sku]=[];
    const skuMin = Math.max(minRun, skuMinRuns[sku] ?? 0);
    for(let i=0;i<FORECAST_MONTHS_OPS.length;i++) {
      const fcst=FORECAST_SKU_OPS[sku]?.[i]??0;
      const woh=fcst>0?(running/fcst)*4:99;
      let produce=0;
      const manualVal = manualProd[sku]?.[i] ?? 0;
      if (manualVal > 0) {
        // Manual override takes precedence
        produce = manualVal;
      } else {
        // Auto-planner logic
        const isWindow=(i%freqMonths)===0;
        if(isWindow) {
          let lookahead=running;
          for(let j=i;j<Math.min(i+freqMonths*2,FORECAST_MONTHS_OPS.length);j++) lookahead-=FORECAST_SKU_OPS[sku]?.[j]??0;
          if(lookahead<0||woh<safetyWoh) {
            const demand=FORECAST_MONTHS_OPS.slice(i,i+freqMonths).reduce((s,_,j)=>s+(FORECAST_SKU_OPS[sku]?.[i+j]??0),0);
            const buf=Math.round((safetyWoh/4)*(fcst||1));
            const needed=demand+buf-running;
            if(needed>0) {
              produce=Math.ceil(needed/skuMin)*skuMin;
              if (optimizeTruck && produce > 0) {
                produce = Math.ceil(produce / FULL_TRUCK) * FULL_TRUCK;
              }
            }
          }
        }
      }
      plan[sku].push(produce);
      running=running+produce-fcst;
      stockProj[sku].push(Math.round(running));
      if(produce>0) {
        const bom=bomQty[sku]??{};
        for(const [mat,q] of Object.entries(bom)) {
          if(!q) continue;
          const factor=(1+(matScrap[mat]??0)/100)*(1+(matOverfill[mat]??0)/100);
          const qty=q*produce*factor;
          ingNeeded[mat]=(ingNeeded[mat]??0)+qty;
          if(!ingByMonth[mat]) ingByMonth[mat]=FORECAST_MONTHS_OPS.map(()=>0);
          ingByMonth[mat][i]+=qty;
        }
      }
    }
  }
  return {plan,stockProj,ingNeeded,ingByMonth};
}
function ProcurementTab({ movements, orders, baseline, ipMovements }: { movements: FPRow[]; orders: any[]; baseline: BaselineRow[]; ipMovements: IPRow[] }) {
  const [procTab, setProcTab] = useState<ProcSubTab>("schedule");
  const [safetyWoh,  setSafetyWoh]  = useState(6);
  const [minRun,     setMinRun]     = useState(2000);
  const [freqMonths, setFreqMonths] = useState(3);
  const [ingPrices,  setIngPrices]  = useState<Record<string,number>>(()=>{
    try { const raw = window.localStorage.getItem("baris.ops.ingPrices.v2"); if (raw) return {...DEFAULT_ING_PRICES, ...JSON.parse(raw)}; } catch {}
    return {...DEFAULT_ING_PRICES};
  });
  useEffect(()=>{ try { window.localStorage.setItem("baris.ops.ingPrices.v2", JSON.stringify(ingPrices)); } catch {} },[ingPrices]);
  const [prodCosts,  setProdCosts]  = useState({...DEFAULT_PROD_COSTS});
  // ── Current raw-material stock: defaults live from I&P Summary (net on-hand), editable override ──
  // From I&P: stock = only RECEIVED purchases minus consumption; ordered = In not yet received.
  const { ipOnHand, ipOrdered } = useMemo(() => {
    const stock: Record<string, number> = {};
    const ordered: Record<string, number> = {};
    for (const m of (ipMovements ?? [])) {
      const proc = IP_TO_PROC_MAT[(m as any).material];
      if (!proc) continue;
      const q = Number(m.quantity || 0);
      const received = (m as any).received ?? false;
      if (m.type === "In") {
        if (received) stock[proc] = (stock[proc] ?? 0) + q;   // arrived → counts as stock
        else ordered[proc] = (ordered[proc] ?? 0) + q;        // on the way → "Pedido"
      } else {
        stock[proc] = (stock[proc] ?? 0) - q;                 // consumption reduces stock
      }
    }
    return { ipOnHand: stock, ipOrdered: ordered };
  }, [ipMovements]);
  const [ingInvOverride, setIngInvOverride] = useState<Record<string,string>>(() => {
    try { const raw = window.localStorage.getItem("baris.ops.ingInvOverride.v1"); if (raw) return JSON.parse(raw); } catch {}
    return {};
  });
  useEffect(()=>{ try { window.localStorage.setItem("baris.ops.ingInvOverride.v1", JSON.stringify(ingInvOverride)); } catch {} },[ingInvOverride]);
  // Effective inventory: manual override wins; otherwise the live I&P on-hand.
  const ingInv: Record<string,string> = useMemo(() => {
    const o: Record<string,string> = {};
    for (const k of ALL_INGS) {
      o[k] = (ingInvOverride[k] !== undefined && ingInvOverride[k] !== "")
        ? ingInvOverride[k]
        : (ipOnHand[k] != null ? String(Math.round(ipOnHand[k])) : "");
    }
    return o;
  }, [ingInvOverride, ipOnHand]);
  const setIngInv = (updater: any) => {
    setIngInvOverride(prev => {
      const cur: Record<string,string> = {}; for (const k of ALL_INGS) cur[k] = prev[k] ?? "";
      const next = typeof updater === "function" ? updater(cur) : updater;
      return next;
    });
  };
  const resetIngInv = (mat: string) => setIngInvOverride(prev => { const n = {...prev}; delete n[mat]; return n; });
  // ── Payment terms per material (drives Shopping "Paid by" & Payments timing) ──
  const [payTerms, setPayTerms] = useState<Record<string,PayTerm>>(() => {
    try { const raw = window.localStorage.getItem(PAY_TERM_KEY); if (raw) return JSON.parse(raw); } catch {}
    return Object.fromEntries(ALL_INGS.map(k=>[k,"lead" as PayTerm]));
  });
  useEffect(()=>{ try { window.localStorage.setItem(PAY_TERM_KEY, JSON.stringify(payTerms)); } catch {} },[payTerms]);
  // ─── Editable BOM — stored as QTY PER CASE (lbs raw / units packaging); % is a synced view ───
  const [bomQty, setBomQty] = useState<Record<string, Record<string, number>>>(
    () => {
      try { const raw = window.localStorage.getItem(BOM_PCT_KEY); if (raw) return JSON.parse(raw); } catch {}
      return JSON.parse(JSON.stringify(BOM_QTY));
    }
  );
  useEffect(()=>{ try { window.localStorage.setItem(BOM_PCT_KEY, JSON.stringify(bomQty)); } catch {} },[bomQty]);
  function setBomQtyCell(sku:string, mat:string, val:number){
    setBomQty(prev=>({...prev,[sku]:{...(prev[sku]??{}),[mat]:val}}));
  }
  // Editing the % re-derives qty using the SKU's current total raw lbs as basis
  function setBomPctCell(sku:string, mat:string, pct:number){
    setBomQty(prev=>{
      const row=prev[sku]??{};
      const rawTotal=RAW_MATS.reduce((s,m)=>s+(row[m]??0),0);
      const basis = rawTotal>0 ? rawTotal : LBS_PER_CASE_BOM;
      return {...prev,[sku]:{...row,[mat]:(pct/100)*basis}};
    });
  }
  function resetBom(){ setBomQty(JSON.parse(JSON.stringify(BOM_QTY))); toast.success("BOM reset to default"); }
  // ─── Editable material master: scrap %, overfill %, lead weeks (per material) ───
  const [matScrap, setMatScrap] = useState<Record<string,number>>(()=>{
    try { const raw = window.localStorage.getItem("baris.ops.matScrap.v1"); if (raw) return {...DEFAULT_SCRAP, ...JSON.parse(raw)}; } catch {}
    return {...DEFAULT_SCRAP};
  });
  useEffect(()=>{ try { window.localStorage.setItem("baris.ops.matScrap.v1", JSON.stringify(matScrap)); } catch {} },[matScrap]);
  const [matOverfill, setMatOverfill] = useState<Record<string,number>>(()=>{
    try { const raw = window.localStorage.getItem("baris.ops.matOverfill.v1"); if (raw) return {...DEFAULT_OVERFILL, ...JSON.parse(raw)}; } catch {}
    return {...DEFAULT_OVERFILL};
  });
  useEffect(()=>{ try { window.localStorage.setItem("baris.ops.matOverfill.v1", JSON.stringify(matOverfill)); } catch {} },[matOverfill]);
  const [leadTimes, setLeadTimes] = useState<Record<string,number>>(
    () => {
      try { const raw = window.localStorage.getItem(LEAD_KEY); if (raw) return {...DEFAULT_LEAD_MAT, ...JSON.parse(raw)}; } catch {}
      return {...DEFAULT_LEAD_MAT};
    }
  );
  useEffect(()=>{ try { window.localStorage.setItem(LEAD_KEY, JSON.stringify(leadTimes)); } catch {} },[leadTimes]);
  const WIP_KEY="baris.ops.wip.v1";
  const [wip, setWip] = useState<Record<string,{cases:string;due:string}>>(
    Object.fromEntries(SKUS.map(s=>[s,{cases:"",due:""}])));
  const [shopScope, setShopScope] = useState<"next"|"3m"|"all">("next");
  const [bomView, setBomView] = useState<"qty"|"pct">("qty");
  // ─── NEW: truck optimization ───
  const [optimizeTruck, setOptimizeTruck] = useState(false);
  // ─── NEW: per-SKU minimum runs ───
  const [skuMinRuns, setSkuMinRuns] = useState<Record<string,number>>(
    () => {
      try { const raw = window.localStorage.getItem(SKU_MINS_KEY); if (raw) return JSON.parse(raw); } catch {}
      return Object.fromEntries(SKUS.map(s=>[s,0]));
    }
  );
  const [showSkuMins, setShowSkuMins] = useState(false);
  // ─── NEW: manual production overrides ───
  const [manualProd, setManualProd] = useState<Record<string,number[]>>(
    () => {
      try { const raw = window.localStorage.getItem(MANUAL_PROD_KEY); if (raw) return JSON.parse(raw); } catch {}
      return Object.fromEntries(SKUS.map(s=>[s, FORECAST_MONTHS_OPS.map(()=>0)]));
    }
  );

  // Persist per-SKU mins
  useEffect(()=>{
    try { window.localStorage.setItem(SKU_MINS_KEY, JSON.stringify(skuMinRuns)); } catch {}
  },[skuMinRuns]);
  // Persist manual overrides
  useEffect(()=>{
    try { window.localStorage.setItem(MANUAL_PROD_KEY, JSON.stringify(manualProd)); } catch {}
  },[manualProd]);

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
  function updateSkuMin(sku:string, val:number){
    setSkuMinRuns(prev=>({...prev,[sku]:val}));
  }
  function updateManualProd(sku:string, monthIdx:number, val:number){
    setManualProd(prev=>{
      const arr=[...(prev[sku]??FORECAST_MONTHS_OPS.map(()=>0))];
      arr[monthIdx]=val;
      return {...prev,[sku]:arr};
    });
  }
  function clearAllManual(){
    setManualProd(Object.fromEntries(SKUS.map(s=>[s, FORECAST_MONTHS_OPS.map(()=>0)])));
    toast.success("All manual overrides cleared");
  }

  const hasAnyManual = useMemo(()=>PROC_SKUS.some(sku=>(manualProd[sku]??[]).some(v=>v>0)),[manualProd]);

  const wipBySku = useMemo(()=>Object.fromEntries(SKUS.map(s=>[s,parseInt(wip[s]?.cases??"")||0])),[wip]);
  const { bySkuMonthKey } = useSalesForecast();
  const [planScenario, setPlanScenario] = useState<SalesScenario>("Normal");
  const planForecast = useMemo(()=>calcForecast(
    planScenario,
    DEFAULT_VEL_CHAINS.map(()=>false as boolean), DEFAULT_VEL_CHAINS.map(ch=>ch.velCurrent),
    NEW_RETAILERS.map(()=>false as boolean), NEW_RETAILERS.map(r=>r.stores),
    NEW_RETAILERS.map(r=>r.vel), NEW_RETAILERS.map(r=>r.entry),
  ),[planScenario]);
  const planSkuByMonthKey = useMemo(()=>skuForecastByMonthKey(planForecast),[planForecast]);
  const fcstOps = useMemo(()=>buildOpsForecast(planSkuByMonthKey),[planSkuByMonthKey]);

  // Stock from Lot Master (all warehouses) — same source as FP Stock, so Schedule "available"
  // = total stock (Newark + Cold Chain + Linden) − committed, matching FP Stock exactly.
  const [procLots, setProcLots] = useState<any[]>([]);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.from("lot_master").select("sku,warehouse,cases_initial,lot_number,cogs_per_case").limit(10000); setProcLots(data ?? []); })(); },[]);
  const bySku = useMemo(()=>{
    const delta: Record<string,number> = {};
    for (const m of (movements ?? [])) {
      const lot=(m.lot_number ?? "").trim();
      if(!lot || m.movement_date <= LOT_BASELINE_DATE) continue;
      const k=`${lot}||${m.warehouse ?? "—"}`;
      delta[k]=(delta[k]??0)+(m.type==="In"?Number(m.cases):-Number(m.cases));
    }
    const casesSku: Record<string,number> = {};
    const seen=new Set<string>();
    for (const r of procLots){ const k=`${r.lot_number}||${r.warehouse ?? "—"}`; seen.add(k); casesSku[r.sku]=(casesSku[r.sku]??0)+(Number(r.cases_initial)||0)+(delta[k]??0); }
    for (const m of (movements ?? [])){ const lot=(m.lot_number??"").trim(); const k=`${lot}||${m.warehouse??"—"}`; if(!lot||seen.has(k)||m.movement_date<=LOT_BASELINE_DATE) continue; seen.add(k); casesSku[m.sku]=(casesSku[m.sku]??0)+(delta[k]??0); }
    const out: Record<string,number> = {};
    for (const sku of SKUS) out[sku]=Math.max(0,Math.round(casesSku[sku]??0));
    return out;
  },[procLots, movements]);

  const {plan,stockProj,ingNeeded,ingByMonth} = useMemo(
    ()=>calcProdSchedule(bySku,orders,safetyWoh,minRun,freqMonths,fcstOps,wipBySku,skuMinRuns,manualProd,optimizeTruck,bomQty,matScrap,matOverfill),
    [bySku,orders,safetyWoh,minRun,freqMonths,fcstOps,wipBySku,skuMinRuns,manualProd,optimizeTruck,bomQty,matScrap,matOverfill]
  );
  const cogs = useMemo(()=>calcCOGSFull(ingPrices,prodCosts,matScrap,matOverfill,bomQty),[ingPrices,prodCosts,matScrap,matOverfill,bomQty]);

  // ─── NEW: Payments forecast — ingredient purchases (timed by lead time) + Heinlein tolling (30d after production) ───
  const payments = useMemo(()=>{
    const ing: Record<string,number> = {};      // payMonthKey -> $
    const toll: Record<string,number> = {};      // payMonthKey -> $
    const meta: Record<string,string> = {};      // monthKey -> label
    const bump = (bucket:Record<string,number>, d:Date, amt:number) => {
      const k = monthKeyOf(d);
      bucket[k] = (bucket[k]??0) + amt;
      meta[k] = fmtMonthShort(new Date(d.getFullYear(), d.getMonth(), 1));
    };
    // Ingredient purchases: net current inventory greedily against earliest needs
    for (const ingName of ALL_INGS) {
      let remInv = (parseInt(ingInv[ingName])||0) + Math.round(ipOrdered[ingName]??0); // stock + already ordered
      const price = ingPrices[ingName] ?? 0;
      const ps = ING_PACK_SIZES[ingName] ?? 1;
      const lead = leadTimes[ingName] ?? DEFAULT_LEAD_WEEKS;
      const term = payTerms[ingName] ?? "lead";
      for (let i=0;i<FORECAST_MONTHS_OPS.length;i++) {
        const need = ingByMonth[ingName]?.[i] ?? 0;
        if (need<=0) continue;
        const fromInv = Math.min(remInv, need); remInv -= fromInv;
        const buy = need - fromInv;
        if (buy<=0) continue;
        const finalAmt = Math.ceil(buy/ps)*ps;
        const cost = finalAmt*price;
        bump(ing, payDateFor(opsMonthDate(i), lead, term), cost);   // pay per payment terms
      }
    }
    // Heinlein tolling: cases produced month i -> units×tolling, paid 30 days later (next month)
    for (let i=0;i<FORECAST_MONTHS_OPS.length;i++){
      const cases = PROC_SKUS.reduce((s,sku)=>s+(plan[sku]?.[i]??0),0);
      if (cases<=0) continue;
      const amt = cases * UNITS_PER_CASE_BOM * (prodCosts.tolling_per_unit ?? 0);
      const prod = opsMonthDate(i);
      bump(toll, new Date(prod.getFullYear(), prod.getMonth()+1, 1), amt);  // +1 month
    }
    const keys = [...new Set([...Object.keys(ing),...Object.keys(toll)])].sort();
    return { ing, toll, meta, keys };
  },[ingByMonth, plan, ingInv, ipOrdered, ingPrices, leadTimes, payTerms, prodCosts]);

  const totalByMonth = FORECAST_MONTHS_OPS.map((_,i)=>PROC_SKUS.reduce((s,sku)=>s+(plan[sku]?.[i]??0),0));
  const nextRunIdx = totalByMonth.findIndex(t=>t>0);
  const shopRange = useMemo(()=>{
    if(nextRunIdx<0) return null;
    if(shopScope==="next") return [nextRunIdx,nextRunIdx] as const;
    if(shopScope==="3m") return [nextRunIdx,Math.min(nextRunIdx+2,FORECAST_MONTHS_OPS.length-1)] as const;
    return [0,FORECAST_MONTHS_OPS.length-1] as const;
  },[shopScope,nextRunIdx]);
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
  const totalProduce = PROC_SKUS.reduce((s,sku)=>s+(plan[sku]??[]).reduce((a,b)=>a+b,0),0);
  const weightedCOGS = SKUS.reduce((s,sku)=>s+(cogs[sku]?.per_case??0)*(SKU_MIX_PCT[sku]??0),0);

  // ─── NEW: compute WoH coverage per SKU when manual overrides exist ───
  const manualCoverage = useMemo(()=>{
    if (!hasAnyManual) return null;
    const result: Record<string,{woh:number;monthsCovered:number}> = {};
    for (const sku of SKUS) {
      const finalStock = stockProj[sku]?.[stockProj[sku].length-1] ?? 0;
      const avgMonthlyFcst = (fcstOps[sku]??[]).reduce((a,b)=>a+b,0) / 12;
      const woh = avgMonthlyFcst > 0 ? (finalStock / avgMonthlyFcst) * 4 : 99;
      // Count months until stock goes negative
      let monthsCov = 0;
      for (const s of (stockProj[sku]??[])) {
        if (s <= 0) break;
        monthsCov++;
      }
      result[sku] = { woh: Math.round(woh*10)/10, monthsCovered: monthsCov };
    }
    return result;
  },[hasAnyManual,stockProj,fcstOps]);

  const inp="rounded border border-border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30";
  const SUBTABS: {id:ProcSubTab;label:string}[] = [
    {id:"schedule",label:"📅 Schedule"},{id:"stock_proj",label:"📊 Stock Projection"},
    {id:"bom_cogs",label:"🧪 BOM + COGS"},{id:"shopping",label:"🛒 Shopping List"},
    {id:"raw_materials",label:"📦 Raw Materials"},
    {id:"payments",label:"💵 Payments"},
  ];

  return (
    <div className="space-y-4">
      <CommittedRequirements planScenario={planScenario} onPlanScenarioChange={setPlanScenario} forecast={fcstOps} months={FORECAST_MONTHS_OPS} />
      {/* Controls */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground">Min. safety stock</label>
            <input type="number" min={1} max={16} value={safetyWoh} onChange={e=>setSafetyWoh(Number(e.target.value))} className={`${inp} w-12 text-center`}/>
            <span className="text-xs text-muted-foreground">weeks</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-muted-foreground">Minimum run (global)</label>
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
          {/* NEW: Truck optimization toggle */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={optimizeTruck} onChange={e=>setOptimizeTruck(e.target.checked)}
                className="h-4 w-4 accent-emerald-600 cursor-pointer rounded" />
              <span className="text-xs font-semibold text-muted-foreground">🚛 Full truck</span>
            </label>
            <span className="text-[10px] text-muted-foreground">({FULL_TRUCK.toLocaleString()} cases)</span>
          </div>
          {/* NEW: Per-SKU mins toggle */}
          <button onClick={()=>setShowSkuMins(v=>!v)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${showSkuMins ? "border-blue-400 bg-blue-50 text-blue-700" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {showSkuMins ? "▾ SKU mins" : "▸ SKU mins"}
          </button>
          <div className="ml-auto flex gap-6 text-center">
            <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total to produce</p>
              <p className="text-xl font-bold font-mono" style={{color:"#A3224A"}}>{totalProduce.toLocaleString()} cases</p></div>
            <div><p className="text-[10px] text-muted-foreground uppercase tracking-wide">COGS ponderado</p>
              <p className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>${weightedCOGS.toFixed(2)}/case</p></div>
          </div>
        </div>
        {/* Per-SKU minimums panel */}
        {showSkuMins && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Minimum production per SKU (overrides global min when higher)</p>
            <div className="flex flex-wrap gap-3">
              {SKUS.map(sku=>(
                <div key={sku} className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold w-14" style={{color:"#1C2340"}}>{sku}</span>
                  <input type="number" min={0} step={500} value={skuMinRuns[sku]||""} placeholder={String(minRun)}
                    onChange={e=>updateSkuMin(sku, parseInt(e.target.value)||0)}
                    className={`${inp} w-20 text-center ${(skuMinRuns[sku]??0)>0?"bg-blue-50 border-blue-300":""}`}/>
                  <span className="text-[10px] text-muted-foreground">cases</span>
                </div>
              ))}
              <button onClick={()=>setSkuMinRuns(Object.fromEntries(SKUS.map(s=>[s,0])))}
                className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted self-center">
                Reset all
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Manual override banner */}
      {hasAnyManual && (
        <div className="rounded-xl border-2 border-blue-300 bg-blue-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-blue-800">✏️ Manual production overrides active</p>
            <p className="text-xs text-blue-600 mt-0.5">
              Blue cells = your manual entries. Auto-planner adjusts remaining months around them.
              {manualCoverage && (
                <span className="ml-2">
                  Coverage: {SKUS.filter(s=>(manualProd[s]??[]).some(v=>v>0)).map(s=>
                    `${s}: ${manualCoverage[s]?.monthsCovered ?? 0} months (${manualCoverage[s]?.woh ?? 0}w end-WoH)`
                  ).join(" · ")}
                </span>
              )}
            </p>
          </div>
          <button onClick={clearAllManual}
            className="rounded-lg border border-blue-400 px-4 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
            Clear all overrides
          </button>
        </div>
      )}

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
            🏭 Yellow cells = auto-planned runs · Frequency: {["","monthly","bimonthly","quarterly","four-monthly","","semiannual"][freqMonths]} · Safety {safetyWoh}w · Global min {minRun.toLocaleString()} cases
            {optimizeTruck && ` · 🚛 Truck optimization ON (${FULL_TRUCK.toLocaleString()} cases/truck)`}
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
            ✏️ Click any month cell to enter a <strong>manual production override</strong>. Blue cells = manual entries (override auto-planner). Yellow = auto-suggested. The planner recalculates stock, WoH, and materials around your manual values.
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
            🛠️ "In production now" = cases currently being manufactured. They count as available stock. Once the run is finished, log it in Production and clear the cell.
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="text-xs min-w-max w-full">
              <thead>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <th className="px-4 py-2.5 text-left sticky left-0" style={{backgroundColor:"#1C2340"}}>SKU</th>
                  <th className="px-3 py-2.5 text-right">Stock avail.</th>
                  <th className="px-3 py-2.5 text-center min-w-[150px]">In production now</th>
                  <th className="px-3 py-2.5 text-right">Avail + WIP</th>
                  <th className="px-3 py-2.5 text-center min-w-[60px]">SKU min</th>
                  {FORECAST_MONTHS_OPS.map(m=><th key={m} className="px-3 py-2.5 text-center min-w-[85px]">{m}</th>)}
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-3 py-2.5 text-right">End WoH</th>
                </tr>
              </thead>
              <tbody>
                {PROC_SKUS.map(sku=>{
                  const SK: Record<string,string>={XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"};
                  const comm=orders.filter(o=>COMMITTED_STATUSES.includes(o.status)).reduce((s,o)=>s+(Number(o[SK[sku]])||0),0);
                  const avail=Math.max(0,(bySku[sku]??0)-comm);
                  const w=wip[sku]??{cases:"",due:""};
                  const wipCases=parseInt(w.cases)||0;
                  const skuTotal=(plan[sku]??[]).reduce((a,b)=>a+b,0);
                  const endStock = stockProj[sku]?.[stockProj[sku].length-1] ?? 0;
                  const avgFcst = (fcstOps[sku]??[]).reduce((a,b)=>a+b,0)/12;
                  const endWoh = avgFcst>0?(endStock/avgFcst)*4:99;
                  const skuMinVal = skuMinRuns[sku] ?? 0;
                  return (
                    <tr key={sku} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card" style={{color:"#1C2340"}}>{sku} <span className="text-muted-foreground font-normal text-[10px]">({SKU_ITEMS[sku as SKU] ?? "new"})</span></td>
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
                      <td className="px-3 py-1.5 text-center">
                        <input type="number" min={0} step={500} value={skuMinVal||""} placeholder="—"
                          onChange={e=>updateSkuMin(sku, parseInt(e.target.value)||0)}
                          className={`${inp} w-16 text-center ${skuMinVal>0?"bg-blue-50 border-blue-300":""}`}
                          title={`Per-SKU minimum for ${sku} (0 = use global min ${minRun})`}/>
                      </td>
                      {(plan[sku]??[]).map((prod,i)=>{
                        const isManual = (manualProd[sku]?.[i] ?? 0) > 0;
                        const isAuto = !isManual && prod > 0;
                        return (
                          <td key={i} className="px-1 py-1 text-center"
                            style={isManual?{backgroundColor:"#DBEAFE"}:isAuto?{backgroundColor:"#FEF08A"}:{}}>
                            <input type="number" min={0} step={500}
                              value={isManual ? (manualProd[sku]?.[i]??0) : (prod > 0 ? prod : "")}
                              placeholder={prod > 0 && !isManual ? String(prod) : "—"}
                              onChange={e=>{
                                const val = parseInt(e.target.value) || 0;
                                updateManualProd(sku, i, val);
                              }}
                              className={`w-full text-center border rounded px-1 py-1 text-xs font-mono font-semibold focus:outline-none focus:ring-1 focus:ring-primary/30
                                ${isManual
                                  ? "border-blue-400 bg-blue-50 text-blue-900"
                                  : isAuto
                                    ? "border-amber-300 bg-amber-50/50 text-amber-900"
                                    : "border-transparent bg-transparent text-muted-foreground"
                                }`}
                              title={isManual ? `Manual override: ${prod.toLocaleString()} cases` : isAuto ? `Auto-suggested: ${prod.toLocaleString()} cases (click to override)` : "No production planned (enter value to override)"}
                            />
                          </td>
                        );
                      })}
                      <td className="px-4 py-1.5 text-right font-mono font-bold" style={{color:skuTotal>0?"#A3224A":"#10B981"}}>
                        {skuTotal>0?skuTotal.toLocaleString():"✓"}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono text-xs font-semibold ${endWoh<4?"text-red-600":endWoh<safetyWoh?"text-orange-500":"text-emerald-600"}`}>
                        {endWoh<99?`${endWoh.toFixed(1)}w`:"∞"}
                      </td>
                    </tr>
                  );
                })}
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold sticky left-0 text-xs" style={{backgroundColor:"#1C2340"}}>Total cases</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{SKUS.reduce((s,sku)=>s+Math.max(0,(bySku[sku]??0)-orders.filter(o=>COMMITTED_STATUSES.includes(o.status)).reduce((a,o)=>a+(Number(o[{XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"}[sku]])||0),0)),0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-center font-mono text-xs text-emerald-300">
                    {SKUS.reduce((s,sku)=>s+(wipBySku[sku]??0),0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {SKUS.reduce((s,sku)=>s+Math.max(0,(bySku[sku]??0)-orders.filter(o=>COMMITTED_STATUSES.includes(o.status)).reduce((a,o)=>a+(Number(o[{XD:"xd_cases",PW:"pw_cases",HM:"hm_cases",WM:"wm_cases",WD:"wd_cases",Matcha:"matcha_cases"}[sku]])||0),0))+(wipBySku[sku]??0),0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2"></td>
                  {totalByMonth.map((t,i)=>{
                    const hasManual = SKUS.some(sku=>(manualProd[sku]?.[i]??0)>0);
                    return (
                      <td key={i} className="px-3 py-2 text-center font-mono font-bold"
                        style={hasManual?{backgroundColor:"rgba(191,219,254,0.3)",color:"#93C5FD"}:t>0?{backgroundColor:"rgba(254,240,138,0.15)",color:"#FDE047"}:{}}>
                        {t>0?t.toLocaleString():"—"}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">{totalProduce.toLocaleString()}</td>
                  <td className="px-3 py-2"></td>
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
                {PROC_SKUS.map(sku=>(
                  <tr key={sku} className="border-t border-border/60">
                    <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card" style={{color:"#1C2340"}}>{sku}</td>
                    {(stockProj[sku]??[]).map((stock,i)=>{
                      const fcst=fcstOps[sku]?.[i]??0;
                      const woh=fcst>0?(stock/fcst)*4:99;
                      const isCrit=stock<0||woh<4;
                      const isLow=!isCrit&&woh<=8;
                      const isOver=!isCrit&&!isLow&&woh<99&&woh>17.5;
                      const isProd=(plan[sku]?.[i]??0)>0;
                      const isManual=(manualProd[sku]?.[i]??0)>0;
                      return (
                        <td key={i} className="px-3 py-1.5 text-center font-mono text-xs"
                          style={{backgroundColor:isCrit?"#FEE2E2":isLow?"#FEF3C7":isOver?"#EDE9FE":isManual?"#DBEAFE":isProd?"#DCFCE7":undefined,
                            color:isCrit?"#DC2626":isLow?"#92400E":isOver?"#6D28D9":"#1C2340",fontWeight:isProd||isManual?"bold":undefined}}>
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
            {[["bg-red-100","🔴 Critical (< 4w or negative)"],["bg-yellow-100","🟡 Low (4–8w)"],["bg-violet-100","🟣 Overstocked (> 17.5w)"],["bg-green-100","🟢 Auto production month"],["bg-blue-100","🔵 Manual override month"]].map(([cls,label])=>(
              <div key={label} className={`flex items-center gap-1.5 rounded px-3 py-1 ${cls}`}><span>{label}</span></div>
            ))}
          </div>
        </div>
      )}

      {/* ── BOM + COGS ── */}
      {procTab==="bom_cogs" && (
        <div className="space-y-5">
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <div className="px-5 py-3 border-b border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold" style={{color:"#1C2340"}}>Formula (BOM) per case (8 units)</p>
                <p className="text-xs text-muted-foreground">Editable in <strong>{bomView==="qty"?"quantity per case":"% of recipe"}</strong>. Both stay in sync. Scrap/overfill/lead live in Raw Materials.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1 rounded-xl bg-muted p-1">
                  {(["qty","pct"] as const).map(v=>(
                    <button key={v} onClick={()=>setBomView(v)}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${bomView===v?"text-white":"text-muted-foreground"}`}
                      style={bomView===v?{backgroundColor:"#1C2340"}:{}}>
                      {v==="qty"?"Qty / case":"% receta"}
                    </button>
                  ))}
                </div>
                <button onClick={resetBom} className="rounded border border-border px-3 py-1 text-[10px] text-muted-foreground hover:bg-muted">Reset BOM</button>
              </div>
            </div>
            <table className="text-xs min-w-max w-full">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left sticky left-0 bg-muted/20">Material</th>
                  <th className="px-2 py-2.5 text-center">UOM</th>
                  {PROC_SKUS.map(s=><th key={s} className="px-3 py-2.5 text-center" title={PROC_SKU_LABEL[s]}>{s}</th>)}
                  <th className="px-4 py-2.5 text-right">$/unit</th>
                </tr>
              </thead>
              <tbody>
                {ALL_INGS.filter(mat=>PROC_SKUS.some(sku=>(bomQty[sku]?.[mat]??0)>0)).map(mat=>{
                  const raw=isRawMat(mat);
                  return (
                    <tr key={mat} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-1.5 font-medium sticky left-0 bg-card">{mat}</td>
                      <td className="px-2 py-1.5 text-center text-[10px] text-muted-foreground">{raw?"lbs":"units"}</td>
                      {PROC_SKUS.map(sku=>{
                        const qty=bomQty[sku]?.[mat]??0;
                        const rawTotal=RAW_MATS.reduce((s,m)=>s+(bomQty[sku]?.[m]??0),0);
                        const pct = raw && rawTotal>0 ? (qty/rawTotal)*100 : 0;
                        if (bomView==="pct" && !raw) {
                          return <td key={sku} className="px-2 py-1 text-center text-muted-foreground">{qty>0?qty:"—"}</td>;
                        }
                        const showVal = bomView==="qty" ? qty : pct;
                        return <td key={sku} className="px-2 py-1 text-center">
                          <input type="number" step={bomView==="qty"?"0.0001":"0.1"} min={0} value={showVal?Number(showVal.toFixed(bomView==="qty"?4:2)):""} placeholder="—"
                            onChange={e=>{ const v=parseFloat(e.target.value)||0; bomView==="qty"?setBomQtyCell(sku,mat,v):setBomPctCell(sku,mat,v); }}
                            className={`${inp} w-[70px] text-center ${qty>0?"font-semibold":"text-muted-foreground"}`}/>
                        </td>;
                      })}
                      <td className="px-4 py-1.5 text-right">
                        <input type="number" step="0.001" value={ingPrices[mat]??0}
                          onChange={e=>setIngPrices(p=>({...p,[mat]:parseFloat(e.target.value)||0}))}
                          className={`${inp} w-20 text-right`}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {bomView==="pct" && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/10">
                    <td className="px-4 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground" colSpan={2}>Σ % (raw)</td>
                    {PROC_SKUS.map(sku=>{
                      const rawTotal=RAW_MATS.reduce((s,m)=>s+(bomQty[sku]?.[m]??0),0);
                      const sum=rawTotal>0?100:0;
                      return <td key={sku} className={`px-2 py-1.5 text-center font-mono text-[10px] ${sum>0?"text-emerald-600":"text-muted-foreground"}`}>{sum?sum.toFixed(0)+"%":"—"}</td>;
                    })}
                    <td/>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Heinlein tolling ($/unit)</p>
            <div className="w-40">
              <input type="number" step="0.001" value={prodCosts.tolling_per_unit}
                onChange={e=>setProdCosts(c=>({...c,tolling_per_unit:parseFloat(e.target.value)||0}))}
                className={`${inp} w-full`}/>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">Packaging (cups, lids, sealers, cases) now lives in the BOM above with its own price. COGS below applies each material's scrap % + overfill % from Raw Materials.</p>
          </div>

          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/30">
              <p className="text-sm font-bold" style={{color:"#1C2340"}}>COGS calculado (incluye scrap + overfill)</p>
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
                {PROC_SKUS.map(sku=>{
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
            💡 Inventory (lbs) = pedido Y recibido en I&P (stock real). Pedido (lbs) = pedido en I&P pero aún no recibido. To Acquire = Needed − Inventory − Pedido. "Paid by" = según los payment terms.
          </div>
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">Material</th>
                  <th className="px-4 py-2.5 text-right">Needed (lbs)</th>
                  <th className="px-4 py-2.5 text-right">Inventory (lbs)</th>
                  <th className="px-4 py-2.5 text-right">Pedido (lbs)</th>
                  <th className="px-4 py-2.5 text-right">To Acquire</th>
                  <th className="px-4 py-2.5 text-right">Pack size</th>
                  <th className="px-4 py-2.5 text-right">Final amount</th>
                  <th className="px-4 py-2.5 text-center">Lead</th>
                  <th className="px-4 py-2.5 text-center">Need by</th>
                  <th className="px-4 py-2.5 text-center">Order by</th>
                  <th className="px-4 py-2.5 text-center">Paid by</th>
                  <th className="px-4 py-2.5 text-right">$/lb</th>
                  <th className="px-4 py-2.5 text-right font-bold">Total cost</th>
                </tr>
              </thead>
              <tbody>
                {ALL_INGS.filter(ing=>(ingWindow[ing]??0)>0).map(ing=>{
                  const needed=Math.round(ingWindow[ing]??0);
                  const inv=parseInt(ingInv[ing])||0;
                  const ordered=Math.round(ipOrdered[ing]??0);   // ordered in I&P, not yet received
                  const toAcq=Math.max(0,needed-inv-ordered);
                  const ps=ING_PACK_SIZES[ing]??1;
                  const finalAmt=Math.max(0, toAcq>0?Math.ceil(toAcq/ps)*ps:0);
                  const price=ingPrices[ing]??0;
                  const cost=finalAmt*price;
                  const lead=leadTimes[ing]??DEFAULT_LEAD_WEEKS;
                  // earliest production month in the window that needs this material
                  let needIdx=shopRange?shopRange[0]:0;
                  if(shopRange){ for(let i=shopRange[0];i<=shopRange[1];i++){ if((ingByMonth[ing]?.[i]??0)>0){ needIdx=i; break; } } }
                  const needBy=opsMonthDate(needIdx);
                  const orderBy=shiftWeeks(needBy,lead);
                  const orderLate = orderBy < new Date();
                  const term=payTerms[ing]??"lead";
                  const paidBy=payDateFor(needBy,lead,term);
                  return (
                    <tr key={ing} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium">{ing}</td>
                      <td className="px-4 py-2 text-right font-mono">{needed.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{inv>0?inv.toLocaleString():"—"}</td>
                      <td className="px-4 py-2 text-right font-mono text-blue-600" title="Ordered in I&P, not yet received">{ordered>0?ordered.toLocaleString():"—"}</td>
                      <td className={`px-4 py-2 text-right font-mono ${toAcq>0?"font-semibold text-orange-600":""}`}>{toAcq>0?toAcq.toLocaleString():"✓"}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">{ps.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold" style={{color:"#1C2340"}}>{finalAmt>0?finalAmt.toLocaleString():"—"}</td>
                      <td className="px-4 py-2 text-center font-mono text-muted-foreground">{lead}w</td>
                      <td className="px-4 py-2 text-center font-mono">{fmtMonthShort(needBy)}</td>
                      <td className={`px-4 py-2 text-center font-mono font-semibold ${orderLate?"text-red-600":"text-blue-700"}`} title={orderLate?"Order date is in the past — order ASAP":""}>
                        {fmtMonthShort(orderBy)}{orderLate?" ⚠":""}
                      </td>
                      <td className="px-4 py-2 text-center font-mono font-semibold text-emerald-700" title={PAY_TERM_LABEL[term]}>{fmtMonthShort(paidBy)}</td>
                      <td className="px-4 py-2 text-right font-mono text-muted-foreground">${price.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold" style={{color:cost>0?"#A3224A":"#10B981"}}>{cost>0?`$${cost.toLocaleString()}`:"$0"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold text-xs" colSpan={12}>TOTAL INGREDIENTS</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">
                    ${ALL_INGS.filter(ing=>(ingWindow[ing]??0)>0).reduce((s,ing)=>{
                      const needed=Math.round(ingWindow[ing]??0);
                      const inv=parseInt(ingInv[ing])||0;
                      const ordered=Math.round(ipOrdered[ing]??0);
                      const toAcq=Math.max(0,needed-inv-ordered);
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
            💡 Material master — UOM, scrap %, overfill %, lead time, price &amp; current stock. Scrap and overfill inflate purchase quantities in the Shopping List &amp; Payments; lead time drives the "order by" date. Stock feeds the Shopping List. All editable.
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left sticky left-0 bg-muted/20">Material</th>
                  <th className="px-3 py-2.5 text-center">Cat</th>
                  <th className="px-3 py-2.5 text-center">UOM</th>
                  <th className="px-3 py-2.5 text-center">Scrap %</th>
                  <th className="px-3 py-2.5 text-center">Overfill %</th>
                  <th className="px-3 py-2.5 text-center">Factor</th>
                  <th className="px-3 py-2.5 text-center">Lead (wks)</th>
                  <th className="px-3 py-2.5 text-center">Payment terms</th>
                  <th className="px-3 py-2.5 text-right">Pack size</th>
                  <th className="px-3 py-2.5 text-right">$/unit</th>
                  <th className="px-3 py-2.5 text-right">Stock</th>
                  <th className="px-3 py-2.5 text-right">Valor ($)</th>
                </tr>
              </thead>
              <tbody>
                {ALL_INGS.map(ing=>{
                  const inv=parseInt(ingInv[ing])||0;
                  const price=ingPrices[ing]??0;
                  const raw=isRawMat(ing);
                  const sc=matScrap[ing]??0, ov=matOverfill[ing]??0;
                  const factor=(1+sc/100)*(1+ov/100);
                  return (
                    <tr key={ing} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="px-4 py-2 font-medium sticky left-0 bg-card">{ing}</td>
                      <td className="px-3 py-2 text-center text-[10px] text-muted-foreground">{raw?"Raw":"Pack"}</td>
                      <td className="px-3 py-2 text-center text-[10px] text-muted-foreground">{raw?"lbs":"units"}</td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min={0} step={1} value={sc}
                          onChange={e=>setMatScrap(m=>({...m,[ing]:parseFloat(e.target.value)||0}))} className={`${inp} w-14 text-center`}/>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min={0} step={1} value={ov}
                          onChange={e=>setMatOverfill(m=>({...m,[ing]:parseFloat(e.target.value)||0}))} className={`${inp} w-14 text-center`}/>
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-[11px] text-muted-foreground">{factor.toFixed(3)}</td>
                      <td className="px-3 py-2 text-center">
                        <input type="number" min={0} step={1} value={leadTimes[ing]??DEFAULT_LEAD_WEEKS}
                          onChange={e=>setLeadTimes(l=>({...l,[ing]:parseInt(e.target.value)||0}))} className={`${inp} w-14 text-center`}/>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <select value={payTerms[ing]??"lead"} onChange={e=>setPayTerms(p=>({...p,[ing]:e.target.value as PayTerm}))}
                          className={`${inp} text-[11px]`} title="When this material is paid, relative to ordering/receiving">
                          <option value="t0">On order (t=0)</option>
                          <option value="lead">On arrival (t=lead)</option>
                          <option value="lead1m">30d after receipt</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{(ING_PACK_SIZES[ing]??0).toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        <input type="number" step="0.001" value={price}
                          onChange={e=>setIngPrices(p=>({...p,[ing]:parseFloat(e.target.value)||0}))} className={`${inp} w-20 text-right`}/>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <input type="number" min={0} value={ingInv[ing]??""}
                            onChange={e=>setIngInv((v:any)=>({...v,[ing]:e.target.value}))}
                            placeholder="0" className={`${inp} w-24 text-right ${inv>0?"bg-emerald-50":""}`}
                            title={ingInvOverride[ing]!==undefined&&ingInvOverride[ing]!==""?"Manual override — ↻ to use I&P":"Live from I&P Summary"}/>
                          {ingInvOverride[ing]!==undefined&&ingInvOverride[ing]!==""
                            ? <button onClick={()=>resetIngInv(ing)} className="text-[10px] text-muted-foreground hover:text-foreground" title="Reset to I&P on-hand">↻</button>
                            : ipOnHand[ing]!=null ? <span className="text-[9px] text-emerald-600" title="From I&P Summary">IP</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{inv>0?`$${Math.round(inv*price).toLocaleString()}`:"—"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold text-xs sticky left-0" style={{backgroundColor:"#1C2340"}} colSpan={10}>TOTAL INVENTORY VALUE</td>
                  <td className="px-3 py-2 text-right font-mono">{ALL_INGS.reduce((s,ing)=>s+(parseInt(ingInv[ing])||0),0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">${Math.round(ALL_INGS.reduce((s,ing)=>{const inv=parseInt(ingInv[ing])||0;return s+inv*(ingPrices[ing]??0);},0)).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── PAYMENTS ── */}
      {procTab==="payments" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700">
            💵 Cash-out forecast: ingredient purchases are timed by each material's <strong>lead time</strong> (you pay when you order — production month minus lead time), and Heinlein <strong>tolling</strong> is booked <strong>30 days after production</strong> ({UNITS_PER_CASE_BOM} units/case × ${(prodCosts.tolling_per_unit??0).toFixed(2)}/unit). Ingredient inventory on hand is netted against the earliest runs.
          </div>
          <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">Payment month</th>
                  <th className="px-4 py-2.5 text-right">Ingredient purchases</th>
                  <th className="px-4 py-2.5 text-right">Heinlein tolling</th>
                  <th className="px-4 py-2.5 text-right font-bold">Total cash out</th>
                </tr>
              </thead>
              <tbody>
                {payments.keys.length===0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No planned purchases or production yet.</td></tr>
                )}
                {payments.keys.map(k=>{
                  const ingAmt=payments.ing[k]??0;
                  const tollAmt=payments.toll[k]??0;
                  const total=ingAmt+tollAmt;
                  const past = k < monthKeyOf(new Date());
                  return (
                    <tr key={k} className="border-t border-border/60 hover:bg-muted/20">
                      <td className={`px-4 py-2 font-semibold ${past?"text-red-600":""}`}>{payments.meta[k]??k}{past?" ⚠":""}</td>
                      <td className="px-4 py-2 text-right font-mono">{ingAmt>0?`$${Math.round(ingAmt).toLocaleString()}`:"—"}</td>
                      <td className="px-4 py-2 text-right font-mono">{tollAmt>0?`$${Math.round(tollAmt).toLocaleString()}`:"—"}</td>
                      <td className="px-4 py-2 text-right font-mono font-bold" style={{color:"#A3224A"}}>${Math.round(total).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                  <td className="px-4 py-2 font-semibold text-xs">TOTAL (horizon)</td>
                  <td className="px-4 py-2 text-right font-mono">${Math.round(Object.values(payments.ing).reduce((a,b)=>a+b,0)).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono">${Math.round(Object.values(payments.toll).reduce((a,b)=>a+b,0)).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${Math.round(Object.values(payments.ing).reduce((a,b)=>a+b,0)+Object.values(payments.toll).reduce((a,b)=>a+b,0)).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">⚠ = payment date already in the past (order/produce ASAP). This is a planning forecast from the schedule &amp; shopping list, not booked I&amp;P payments.</p>
        </div>
      )}
    </div>
  );
}
// ─── Main Operations Page ─────────────────────────────────────────────────────
function OperationsPage() {
  const [tab, setTab] = useState<OpsTab>("stock");
  const [fpMovements, setFpMovements] = useState<FPRow[]>([]);
  const [ipMovements, setIpMovements] = useState<IPRow[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [baseline, setBaseline] = useState<BaselineRow[]>([]);
  const [lots, setLots] = useState<any[]>([]);
  const lotMap = useMemo(() => buildLotMap(lots), [lots]);
  const [loadingFP, setLoadingFP] = useState(true);
  const [loadingIP, setLoadingIP] = useState(true);

  async function loadFP() {
    const { data } = await supabase.from("fp_movements").select("*").order("movement_date", { ascending: false });
    setFpMovements(data ?? []);
    setLoadingFP(false);
  }
  async function loadIP() {
    const { data } = await supabase.from("ip_movements").select("*").order("movement_date", { ascending: false });
    setIpMovements(data ?? []);
    setLoadingIP(false);
  }
  async function loadOrders() {
    const { data } = await supabase.from("customer_orders").select("*");
    setOrders(data ?? []);
  }
  async function loadBaseline() {
    const { data } = await supabase
      .from("fp_stock_baseline")
      .select("*")
      .order("baseline_date", { ascending: false });
    setBaseline((data ?? []) as BaselineRow[]);
  }
  async function loadLots() {
    const { data } = await supabase
      .from("lot_master")
      .select("lot_number,sku,cogs_per_case,cogs_status,expiry_date");
    setLots(data ?? []);
  }

  useEffect(() => { loadFP(); loadIP(); loadOrders(); loadBaseline(); loadLots(); }, []);

  function reload() { loadFP(); loadIP(); loadOrders(); loadBaseline(); loadLots(); }

  const TABS: { id: OpsTab; label: string; emoji: string }[] = [
    { id: "stock",       label: "FP Stock",             emoji: "📊" },
    { id: "summary",     label: "FP Summary",           emoji: "📋" },
    { id: "lots",        label: "Lot Master",           emoji: "📦" },
    { id: "fp",          label: "FP Movements",         emoji: "📥" },
    { id: "ipsummary",   label: "I&P Summary",          emoji: "🧪" },
    { id: "ip",          label: "I&P Movements",        emoji: "🧴" },
    { id: "production",  label: "Production",           emoji: "🏭" },
    { id: "cogs",        label: "COGS Simulator",       emoji: "💰" },
    { id: "procurement", label: "Procurement Planning", emoji: "📅" },
  ];

  return (
    <div>
      <PageHeader
        title="Operations"
        description="Inventory, production, and procurement planning"
      />

      <div className="flex gap-1 overflow-x-auto border-b border-border mb-6 pb-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            style={tab === t.id ? { borderColor: "#A3224A", color: "#A3224A" } : {}}
          >
            <span>{t.emoji}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stock"       && <FPStockTab movements={fpMovements} orders={orders} loading={loadingFP} baseline={baseline} lotMap={lotMap} />}
      {tab === "summary"     && <FPSummaryTab movements={fpMovements} orders={orders} loading={loadingFP} />}
      {tab === "lots"        && <LotMasterTab movements={fpMovements} loading={loadingFP} />}
      {tab === "fp"          && <FPInputTab movements={fpMovements} loading={loadingFP} onAdded={reload} lotMap={lotMap} />}
      {tab === "ipsummary"   && <IPSummaryTab movements={ipMovements} />}
      {tab === "ip"          && <IPInputTab movements={ipMovements} loading={loadingIP} onAdded={reload} />}
      {tab === "production"  && <ProductionTab fpMovements={fpMovements} ipMovements={ipMovements} onAdded={reload} />}
      {tab === "cogs"        && <COGSSimulatorTab />}
      {tab === "procurement" && <ProcurementTab movements={fpMovements} orders={orders} baseline={baseline} ipMovements={ipMovements} />}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/operations")({
  component: OperationsPage,
});
