import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SKUS, SKU_LABEL, money, type SKU } from "@/lib/fp-shared";

const inp = "rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";
const BRAND = "#1C2340";
const UNITS_PER_CASE = 8;
// Lot Master values are fixed as of TODAY; FP movements dated AFTER this adjust each lot.
const LOT_BASELINE = "2026-08-14";
const WH_ORDER = ["Lineage Newark", "Cold Chain", "Lineage Linden"];

type Lot = {
  id: string | null;            // null = virtual (came from a post-baseline movement, not yet a master row)
  warehouse: string;
  sku: string;
  lineage_item_code: string | null;
  lot_number: string;
  expiry_date: string | null;
  cases: number;                // live on-hand
  cogs_per_case: number | null; // per pote
  cogs_status: string | null;
  notes: string | null;
};

type Mv = { movement_date: string; type: string; lot_number: string | null; cases: number; sku: string; warehouse: string; cogs_per_case: number | null };

function StatusBadge({ s }: { s: string | null }) {
  const v = (s ?? "").toLowerCase();
  if (v === "confirmed") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Confirmed</span>;
  if (v === "estimated") return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">Estimated ✎</span>;
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Missing</span>;
}

type SortKey = "warehouse" | "sku" | "lot_number" | "expiry_date" | "cases" | "cogs_per_case" | "value" | "cogs_status";

export function LotMasterTab() {
  const [master, setMaster] = useState<any[]>([]);
  const [movements, setMovements] = useState<Mv[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSku, setFilterSku] = useState("all");
  const [filterWh, setFilterWh] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ warehouse: "Lineage Newark", sku: "XD", lineage_item_code: "", lot_number: "", expiry_date: "", cases_initial: "", cogs_per_case: "", notes: "" });

  async function load() {
    const [lm, mv] = await Promise.all([
      supabase.from("lot_master").select("*"),
      supabase.from("fp_movements").select("movement_date,type,lot_number,cases,sku,warehouse,cogs_per_case").gt("movement_date", LOT_BASELINE).limit(10000),
    ]);
    if (lm.error) toast.error(lm.error.message);
    setMaster(lm.data ?? []);
    setMovements((mv.data as unknown as Mv[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Live on-hand per lot = master baseline + signed movements after LOT_BASELINE (keyed by lot+warehouse).
  const lots: Lot[] = useMemo(() => {
    const deltaByLotWh: Record<string, number> = {};
    const key = (lot: string, wh: string) => `${lot}||${wh}`;
    const seen = new Set<string>();
    for (const m of movements) {
      const lot = (m.lot_number ?? "").trim();
      if (!lot) continue;
      const k = key(lot, m.warehouse ?? "—");
      deltaByLotWh[k] = (deltaByLotWh[k] ?? 0) + (m.type === "In" ? Number(m.cases) : -Number(m.cases));
    }
    const out: Lot[] = master.map((r) => {
      const lot = r.lot_number;
      const wh = r.warehouse ?? "—";
      const k = key(lot, wh);
      seen.add(k);
      return {
        id: r.id, warehouse: wh, sku: r.sku, lineage_item_code: r.lineage_item_code,
        lot_number: lot, expiry_date: r.expiry_date,
        cases: (Number(r.cases_initial) || 0) + (deltaByLotWh[k] ?? 0),
        cogs_per_case: r.cogs_per_case, cogs_status: r.cogs_status, notes: r.notes,
      };
    });
    // Lot+warehouse combos that only exist in post-baseline movements — show as virtual.
    for (const m of movements) {
      const lot = (m.lot_number ?? "").trim();
      const wh = m.warehouse ?? "—";
      const k = key(lot, wh);
      if (!lot || seen.has(k)) continue;
      seen.add(k);
      out.push({
        id: null, warehouse: wh, sku: m.sku, lineage_item_code: null,
        lot_number: lot, expiry_date: null, cases: deltaByLotWh[k] ?? 0,
        cogs_per_case: m.cogs_per_case, cogs_status: "estimated",
        notes: "From FP movement (not yet in Lot Master)",
      });
    }
    return out;
  }, [master, movements]);

  const warehouses = useMemo(() => {
    const s = new Set<string>(WH_ORDER);
    lots.forEach((l) => s.add(l.warehouse));
    return [...s].filter((w) => w !== "—").sort((a, b) => {
      const ia = WH_ORDER.indexOf(a), ib = WH_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1; if (ib !== -1) return 1; return a.localeCompare(b);
    });
  }, [lots]);

  const filtered = useMemo(() => {
    let r = lots.filter((l) =>
      (filterSku === "all" || l.sku === filterSku) &&
      (filterWh === "all" || l.warehouse === filterWh));
    const val = (l: Lot) => (l.cases) * (Number(l.cogs_per_case) || 0) * UNITS_PER_CASE;
    const get = (l: Lot): string | number => {
      switch (sortKey) {
        case "value": return val(l);
        case "cases": return l.cases;
        case "cogs_per_case": return Number(l.cogs_per_case) || 0;
        case "expiry_date": return l.expiry_date ?? "9999";
        default: return (l[sortKey] ?? "") as string;
      }
    };
    r = [...r].sort((a, b) => {
      const va = get(a), vb = get(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [lots, filterSku, filterWh, sortKey, sortDir]);

  const totals = useMemo(() => {
    const cases = filtered.reduce((s, l) => s + l.cases, 0);
    const value = filtered.reduce((s, l) => s + l.cases * (Number(l.cogs_per_case) || 0) * UNITS_PER_CASE, 0);
    return { cases, value, lots: filtered.length };
  }, [filtered]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
  }

  async function saveField(id: string | null, patch: Record<string, any>) {
    if (!id) { toast.error("Virtual lot — add it to Lot Master first"); return; }
    setMaster((ms) => ms.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from("lot_master").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    toast.success("✓ saved");
  }
  async function deleteLot(id: string | null, lot: string) {
    if (!id) { toast.error("Virtual lot — nothing to delete"); return; }
    if (!window.confirm(`Delete lot ${lot}? This cannot be undone.`)) return;
    const { error } = await supabase.from("lot_master").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Lot deleted"); load();
  }
  async function addLot() {
    if (!draft.lot_number.trim()) { toast.error("Lot # required"); return; }
    const cogs = draft.cogs_per_case ? Number(draft.cogs_per_case) : null;
    const { error } = await supabase.from("lot_master").insert({
      warehouse: draft.warehouse, sku: draft.sku, lineage_item_code: draft.lineage_item_code || null,
      lot_number: draft.lot_number.trim(), expiry_date: draft.expiry_date || null,
      cases_initial: draft.cases_initial ? Number(draft.cases_initial) : 0,
      cogs_per_case: cogs, cogs_status: cogs == null ? "missing" : "confirmed", notes: draft.notes || null,
    } as any);
    if (error) { toast.error(error.message); return; }
    toast.success("Lot added"); setAdding(false);
    setDraft({ warehouse: "Lineage Newark", sku: "XD", lineage_item_code: "", lot_number: "", expiry_date: "", cases_initial: "", cogs_per_case: "", notes: "" });
    load();
  }

  const th = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground select-none cursor-pointer hover:text-foreground";
  const arrow = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  if (loading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">Loading…</div>;

  const LotTable = ({ data, editable = true }: { data: Lot[]; editable?: boolean }) => (
    <table className="w-full min-w-max text-sm">
      <thead className="bg-muted/20">
        <tr>
          <th className={`${th} text-left`} onClick={() => toggleSort("warehouse")}>WH{arrow("warehouse")}</th>
          <th className={`${th} text-left`} onClick={() => toggleSort("sku")}>SKU{arrow("sku")}</th>
          <th className={`${th} text-left`} onClick={() => toggleSort("lot_number")}>Lot #{arrow("lot_number")}</th>
          <th className={`${th} text-left`} onClick={() => toggleSort("expiry_date")}>Expiry{arrow("expiry_date")}</th>
          <th className={`${th} text-right`} onClick={() => toggleSort("cases")}>Cases{arrow("cases")}</th>
          <th className={`${th} text-right`} onClick={() => toggleSort("cogs_per_case")}>COGS/pote{arrow("cogs_per_case")}</th>
          <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-right">COGS/caja</th>
          <th className={`${th} text-right`} onClick={() => toggleSort("value")}>Inv. value{arrow("value")}</th>
          <th className={`${th} text-left`} onClick={() => toggleSort("cogs_status")}>Status{arrow("cogs_status")}</th>
          <th className="px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground text-left">Notes</th>
          {editable && <th className="px-3 py-2" />}
        </tr>
      </thead>
      <tbody>
        {data.length === 0 ? (
          <tr><td colSpan={editable ? 11 : 10} className="p-6 text-center text-muted-foreground">No lots.</td></tr>
        ) : data.map((l) => {
          const perCase = l.cogs_per_case == null ? null : Number(l.cogs_per_case) * UNITS_PER_CASE;
          const value = perCase == null ? null : l.cases * perCase;
          return (
            <tr key={(l.id ?? "v") + l.lot_number} className="border-t border-border/60 hover:bg-muted/20">
              <td className="px-3 py-1.5 text-xs">{l.warehouse}</td>
              <td className="px-3 py-1.5 font-semibold" style={{ color: BRAND }}>{l.sku}</td>
              <td className="px-3 py-1.5 font-mono text-xs" style={{ color: "#A3224A" }}>{l.lot_number}{l.id === null && <span className="ml-1 text-[9px] text-muted-foreground">(mov)</span>}</td>
              <td className="px-3 py-1.5 text-xs">
                {editable && l.id ? (
                  <input type="date" defaultValue={l.expiry_date ?? ""} onBlur={(e) => { if (e.target.value !== (l.expiry_date ?? "")) saveField(l.id, { expiry_date: e.target.value || null }); }} className={`${inp} text-xs`} />
                ) : (l.expiry_date ?? "—")}
              </td>
              <td className={`px-3 py-1.5 text-right font-mono ${l.cases < 0 ? "text-red-600 font-semibold" : ""}`}>{l.cases.toLocaleString(undefined, { maximumFractionDigits: 3 })}</td>
              <td className="px-3 py-1.5 text-right">
                {editable && l.id ? (
                  <input type="number" step="0.01" defaultValue={l.cogs_per_case ?? ""} placeholder="—"
                    onBlur={(e) => { const raw = e.target.value.trim(); const v = raw === "" ? null : parseFloat(raw); if (v !== (l.cogs_per_case == null ? null : Number(l.cogs_per_case))) saveField(l.id, { cogs_per_case: v, cogs_status: v == null ? "missing" : "confirmed" }); }}
                    className={`${inp} w-16 text-right font-mono text-xs text-blue-700`} />
                ) : (l.cogs_per_case != null ? `$${Number(l.cogs_per_case).toFixed(2)}` : "—")}
              </td>
              <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{perCase == null ? "—" : `$${perCase.toFixed(2)}`}</td>
              <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold">{money(value)}</td>
              <td className="px-3 py-1.5"><StatusBadge s={l.cogs_status} /></td>
              <td className="max-w-[220px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={l.notes ?? ""}>
                {editable && l.id ? (
                  <input defaultValue={l.notes ?? ""} onBlur={(e) => { if (e.target.value !== (l.notes ?? "")) saveField(l.id, { notes: e.target.value || null }); }} className={`${inp} w-44 text-xs`} placeholder="—" />
                ) : (l.notes ?? "—")}
              </td>
              {editable && (
                <td className="px-3 py-1.5 text-right">
                  {l.id && <button onClick={() => deleteLot(l.id, l.lot_number)} className="rounded border border-red-200 px-2 py-0.5 text-[10px] text-red-600 hover:bg-red-50">Del</button>}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr style={{ backgroundColor: BRAND, color: "#fff" }}>
          <td className="px-3 py-2 font-semibold text-xs" colSpan={4}>TOTAL ({data.length} lots)</td>
          <td className="px-3 py-2 text-right font-mono font-bold">{data.reduce((s, l) => s + l.cases, 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
          <td /><td />
          <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">${Math.round(data.reduce((s, l) => s + l.cases * (Number(l.cogs_per_case) || 0) * UNITS_PER_CASE, 0)).toLocaleString()}</td>
          <td /><td />{editable && <td />}
        </tr>
      </tfoot>
    </table>
  );

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setAdding((a) => !a)} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: BRAND }}>+ Add lot</button>
        <select value={filterSku} onChange={(e) => setFilterSku(e.target.value)} className={inp}>
          <option value="all">All SKUs</option>
          {SKUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterWh} onChange={(e) => setFilterWh(e.target.value)} className={inp}>
          <option value="all">All warehouses</option>
          {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">
          {totals.lots} lots · <strong>{totals.cases.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong> cases · <strong className="text-emerald-700">${Math.round(totals.value).toLocaleString()}</strong>
          {(filterSku !== "all" || filterWh !== "all") && " (filtered)"}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">Values as of {LOT_BASELINE} + later FP movements</span>
      </div>

      {adding && (
        <div className="rounded-2xl border border-border bg-muted/20 p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <select value={draft.warehouse} onChange={(e) => setDraft({ ...draft, warehouse: e.target.value })} className={inp}>
            {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <select value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} className={inp}>
            {SKUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input placeholder="Lot #" value={draft.lot_number} onChange={(e) => setDraft({ ...draft, lot_number: e.target.value })} className={inp} />
          <input type="date" value={draft.expiry_date} onChange={(e) => setDraft({ ...draft, expiry_date: e.target.value })} className={inp} />
          <input placeholder="Cases" type="number" value={draft.cases_initial} onChange={(e) => setDraft({ ...draft, cases_initial: e.target.value })} className={inp} />
          <input placeholder="COGS/pote" type="number" step="0.01" value={draft.cogs_per_case} onChange={(e) => setDraft({ ...draft, cogs_per_case: e.target.value })} className={inp} />
          <input placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={`${inp} md:col-span-1`} />
          <button onClick={addLot} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: BRAND }}>Save</button>
        </div>
      )}

      {/* Combined */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/30 px-5 py-2.5 text-sm font-semibold" style={{ color: BRAND }}>
          All lots (combined) {(filterSku !== "all" || filterWh !== "all") && <span className="font-normal text-muted-foreground">· filtered</span>}
        </div>
        <LotTable data={filtered} />
      </div>

      {/* Per-warehouse collapsible */}
      <div className="space-y-3">
        {warehouses.map((wh) => {
          const data = filtered.filter((l) => l.warehouse === wh);
          const isOpen = open[wh] ?? false;
          const whCases = data.reduce((s, l) => s + l.cases, 0);
          const whValue = data.reduce((s, l) => s + l.cases * (Number(l.cogs_per_case) || 0) * UNITS_PER_CASE, 0);
          return (
            <div key={wh} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
              <button onClick={() => setOpen((o) => ({ ...o, [wh]: !isOpen }))} className="w-full flex items-center gap-2 px-5 py-3 hover:bg-muted/20 transition-colors">
                <span className="inline-block transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
                <span className="text-sm font-bold" style={{ color: BRAND }}>{wh}</span>
                <span className="ml-auto text-xs text-muted-foreground">{data.length} lots · {whCases.toLocaleString(undefined, { maximumFractionDigits: 1 })} cases · <strong className="text-emerald-700">${Math.round(whValue).toLocaleString()}</strong></span>
              </button>
              {isOpen && <div className="overflow-x-auto border-t border-border">{<LotTable data={data} />}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
