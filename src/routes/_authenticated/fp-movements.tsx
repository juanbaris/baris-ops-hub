import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  FP_CONCEPTS, SKUS, SKU_LABEL, WAREHOUSES, buildLotMap, fmtDate, money, money2,
  normLot, resolveCogs, skuLabel,
  type FPConcept, type FPRow, type LotCard, type SKU, type Warehouse,
} from "@/lib/fp-shared";

const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";
const sel = "rounded-lg border border-border bg-background px-2 py-1.5 text-xs focus:outline-none";

type Form = {
  movement_date: string; type: "In" | "Out"; sku: SKU; cases: string;
  warehouse: Warehouse; lot_number: string; concept: FPConcept;
  cogs_per_case: string; po_ref: string; notes: string;
};

const emptyForm = (): Form => ({
  movement_date: new Date().toISOString().slice(0, 10),
  type: "In", sku: "XD", cases: "", warehouse: "Lineage Newark",
  lot_number: "", concept: "Production", cogs_per_case: "", po_ref: "", notes: "",
});

function isSystemRow(r: FPRow) {
  return r.concept === ("Balance correction" as FPConcept) || (r.notes ?? "").toLowerCase().includes("aggregate shipments");
}

function FPMovements() {
  const [rows, setRows] = useState<FPRow[]>([]);
  const [lotMap, setLotMap] = useState<Record<string, LotCard>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [fSku, setFSku] = useState("all");
  const [fWh, setFWh] = useState("all");
  const [fType, setFType] = useState("all");
  const [fMonth, setFMonth] = useState("all");
  const [q, setQ] = useState("");

  const [form, setForm] = useState<Form>(emptyForm());
  const [editing, setEditing] = useState<FPRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function load() {
    const [mv, lots] = await Promise.all([
      supabase.from("fp_movements")
        .select("id, movement_date, type, sku, cases, warehouse, lot_number, concept, notes, cogs_per_case, po_ref")
        .order("movement_date", { ascending: false }),
      supabase.from("lot_master").select("lot_number,cogs_per_case,cogs_status,expiry_date,sku"),
    ]);
    if (mv.error) setErr(mv.error.message);
    else { setErr(null); setRows((mv.data as unknown as FPRow[]) ?? []); }
    setLotMap(buildLotMap(lots.data ?? []));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const months = useMemo(
    () => [...new Set(rows.map((r) => r.movement_date.slice(0, 7)))].sort().reverse(),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (fSku !== "all" && r.sku !== fSku) return false;
      if (fWh !== "all" && r.warehouse !== fWh) return false;
      if (fType !== "all" && r.type !== fType) return false;
      if (fMonth !== "all" && r.movement_date.slice(0, 7) !== fMonth) return false;
      if (needle) {
        const hay = `${r.lot_number ?? ""} ${r.concept} ${r.notes ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, fSku, fWh, fType, fMonth, q]);

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  const lotCard = lotMap[normLot(form.lot_number)];

  function onLotChange(v: string) {
    setForm((f) => {
      const card = lotMap[normLot(v)];
      return { ...f, lot_number: v, cogs_per_case: card?.cogs != null ? String(card.cogs) : f.cogs_per_case };
    });
  }

  function startEdit(r: FPRow) {
    setEditing(r);
    setForm({
      movement_date: r.movement_date,
      type: r.type as "In" | "Out",
      sku: r.sku as SKU,
      cases: String(r.cases),
      warehouse: r.warehouse as Warehouse,
      lot_number: r.lot_number ?? "",
      concept: r.concept as FPConcept,
      cogs_per_case: r.cogs_per_case == null ? "" : String(r.cogs_per_case),
      po_ref: (r as FPRow & { po_ref?: string | null }).po_ref ?? "",
      notes: r.notes ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() { setEditing(null); setForm(emptyForm()); }

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
      po_ref: form.po_ref || null,
      notes: form.notes || null,
    };
    const res = editing
      ? await supabase.from("fp_movements").update(payload).eq("id", editing.id)
      : await supabase.from("fp_movements").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success(editing ? "Movement updated" : `FP movement added: ${form.type} ${form.cases} cases ${SKU_LABEL[form.sku]}`);
    setEditing(null);
    setForm(emptyForm());
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("fp_movements").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    setConfirmId(null);
    toast.success("Movement deleted");
    load();
  }

  return (
    <>
      <PageHeader title="FP Movements" subtitle="Finished product ledger with COGS valuation." />

      {editing && (
        <div className="mb-3 rounded-xl border px-4 py-2 text-sm font-semibold"
          style={{ borderColor: "#A3224A", color: "#A3224A", backgroundColor: "#A3224A10" }}>
          Editing movement — {editing.lot_number || "(no lot)"}
        </div>
      )}

      {/* Form */}
      <div className="mb-5 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold" style={{ color: "#1C2340" }}>
          {editing ? "Edit FP Movement" : "New FP Movement"}
        </h3>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><Lbl>Date</Lbl><input type="date" className={`${inp} mt-1`} value={form.movement_date} onChange={(e) => set("movement_date", e.target.value)} /></div>
          <div><Lbl>Type</Lbl>
            <select className={`${inp} mt-1`} value={form.type} onChange={(e) => set("type", e.target.value as "In" | "Out")}>
              <option value="In">In</option><option value="Out">Out</option>
            </select></div>
          <div><Lbl>SKU</Lbl>
            <select className={`${inp} mt-1`} value={form.sku} onChange={(e) => set("sku", e.target.value as SKU)}>
              {SKUS.map((s) => <option key={s} value={s}>{SKU_LABEL[s]}</option>)}
            </select></div>
          <div><Lbl>Cases *</Lbl><input type="number" min={1} className={`${inp} mt-1 font-mono`} value={form.cases} onChange={(e) => set("cases", e.target.value)} placeholder="0" /></div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><Lbl>Warehouse</Lbl>
            <select className={`${inp} mt-1`} value={form.warehouse} onChange={(e) => set("warehouse", e.target.value as Warehouse)}>
              {WAREHOUSES.map((w) => <option key={w} value={w}>{w}</option>)}
            </select></div>
          <div><Lbl>Lot # {form.concept === "Production" ? "*" : ""}</Lbl>
            <input className={`${inp} mt-1 font-mono`} value={form.lot_number} onChange={(e) => onLotChange(e.target.value)} placeholder={form.concept === "Production" ? "Required" : "Optional"} />
            {form.lot_number && (
              <p className={`mt-1 text-[10px] ${lotCard?.cogs != null ? "text-emerald-600" : "text-amber-600"}`}>
                {lotCard?.cogs != null
                  ? `✓ COGS from Lot Master: ${money2(lotCard.cogs)}`
                  : "⚠ Lot not in Lot Master — enter COGS manually"}
              </p>
            )}
          </div>
          <div><Lbl>Concept</Lbl>
            <select className={`${inp} mt-1`} value={form.concept} onChange={(e) => set("concept", e.target.value as FPConcept)}>
              {FP_CONCEPTS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select></div>
          <div><Lbl>COGS/case ($)</Lbl><input type="number" step="0.01" className={`${inp} mt-1 font-mono`} value={form.cogs_per_case} onChange={(e) => set("cogs_per_case", e.target.value)} placeholder="Optional" /></div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div><Lbl>PO Ref</Lbl><input className={`${inp} mt-1 font-mono`} value={form.po_ref} onChange={(e) => set("po_ref", e.target.value)} placeholder="Optional" /></div>
          <div><Lbl>Notes</Lbl><input className={`${inp} mt-1`} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional" /></div>
        </div>
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "#A3224A" }}>
            {saving ? "Saving…" : editing ? "Update movement" : `+ Add ${form.type} · ${form.cases || "?"} cases ${SKU_LABEL[form.sku]}`}
          </button>
          {editing && (
            <button onClick={cancelEdit} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className={sel} value={fSku} onChange={(e) => setFSku(e.target.value)}>
          <option value="all">All SKUs</option>
          {SKUS.map((s) => <option key={s} value={s}>{SKU_LABEL[s]}</option>)}
        </select>
        <select className={sel} value={fWh} onChange={(e) => setFWh(e.target.value)}>
          <option value="all">All warehouses</option>
          {WAREHOUSES.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        <select className={sel} value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="all">All types</option><option value="In">In</option><option value="Out">Out</option>
        </select>
        <select className={sel} value={fMonth} onChange={(e) => setFMonth(e.target.value)}>
          <option value="all">All months</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className={`${sel} w-56`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lot, concept, notes…" />
        <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {filtered.length.toLocaleString()} movements
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {["Date", "Type", "SKU"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
              <th className="px-3 py-2 text-right font-medium">Cases</th>
              {["Warehouse", "Lot #", "Concept"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
              <th className="px-3 py-2 text-right font-medium">COGS/case</th>
              <th className="px-3 py-2 text-right font-medium">Value ($)</th>
              <th className="px-3 py-2 text-left font-medium">Notes</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : err ? (
              <tr><td colSpan={11} className="p-6 text-center text-destructive">{err}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={11} className="p-6 text-center text-muted-foreground">No movements match the filters.</td></tr>
            ) : filtered.map((r) => {
              const { cogs, status } = resolveCogs(r, lotMap);
              const value = cogs == null ? null : cogs * Number(r.cases);
              return (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs">{fmtDate(r.movement_date)}</td>
                  <td className="px-3 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.type === "In" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{r.type}</span>
                  </td>
                  <td className="px-3 py-1.5 font-semibold" style={{ color: "#1C2340" }}>{skuLabel(r.sku)}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-semibold">{Number(r.cases).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.warehouse}</td>
                  <td className="px-3 py-1.5 font-mono text-xs" style={{ color: "#A3224A" }}>{r.lot_number || "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{r.concept}</td>
                  <td className={`px-3 py-1.5 text-right font-mono text-xs ${status === "estimated" ? "text-amber-600" : ""}`}>{money2(cogs)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{money(value)}</td>
                  <td className="max-w-[220px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={r.notes ?? ""}>
                    {r.notes ? (r.notes.length > 40 ? `${r.notes.slice(0, 40)}…` : r.notes) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {confirmId === r.id ? (
                      <div className="flex flex-col items-end gap-1">
                        {isSystemRow(r) && (
                          <span className="text-[10px] font-semibold text-amber-600">⚠ This is a system entry. Deleting will affect stock balances.</span>
                        )}
                        <span className="flex items-center gap-2 text-xs">
                          Delete?
                          <button onClick={() => remove(r.id)} className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">Confirm</button>
                          <button onClick={() => setConfirmId(null)} className="rounded border border-border px-2 py-0.5 text-[11px]">Cancel</button>
                        </span>
                      </div>
                    ) : (
                      <span className="flex justify-end gap-2">
                        <button onClick={() => startEdit(r)} title="Edit" className="text-muted-foreground hover:text-foreground">✎</button>
                        <button onClick={() => setConfirmId(r.id)} title="Delete" className="text-muted-foreground hover:text-red-600">🗑</button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</label>;
}

export const Route = createFileRoute("/_authenticated/fp-movements")({
  component: FPMovements,
  head: () => ({
    meta: [
      { title: "FP Movements · BARIS Operations Hub" },
      { name: "description", content: "Finished product movement ledger with lot tracking, COGS per case and inventory valuation for BARIS." },
      { property: "og:title", content: "FP Movements · BARIS Operations Hub" },
      { property: "og:description", content: "Finished product movement ledger with lot tracking and COGS valuation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
