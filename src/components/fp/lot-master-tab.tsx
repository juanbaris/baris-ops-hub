import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SKUS, SKU_LABEL, money, money2, type LotRow } from "@/lib/fp-shared";

const inp = "rounded-lg border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

const STATUS_BG: Record<string, string> = {
  missing: "bg-yellow-100", estimated: "bg-orange-100", confirmed: "bg-emerald-50",
};

function StatusBadge({ s }: { s: string | null }) {
  if (s === "confirmed") return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Confirmed</span>;
  if (s === "estimated") return <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">Estimated ✎</span>;
  return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Missing — enter COGS</span>;
}

export function LotMasterTab() {
  const [rows, setRows] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ sku: "XD", lineage_item_code: "", lot_number: "", expiry_date: "", cases_initial: "", cogs_per_case: "", notes: "" });

  async function load() {
    const { data, error } = await supabase.from("lot_master").select("*").order("sku").order("lot_number");
    if (error) toast.error(error.message);
    setRows((data as LotRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function updateLot(id: string, value: number | null) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, cogs_per_case: value, cogs_status: value == null ? "missing" : "confirmed" } : r)));
    const { error } = await supabase.from("lot_master").update({
      cogs_per_case: value,
      cogs_status: value == null ? "missing" : "confirmed",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    toast.success("✓ saved");
  }

  async function addLot() {
    if (!draft.lot_number.trim()) { toast.error("Lot # required"); return; }
    const cogs = draft.cogs_per_case ? Number(draft.cogs_per_case) : null;
    const { error } = await supabase.from("lot_master").insert({
      sku: draft.sku,
      lineage_item_code: draft.lineage_item_code || null,
      lot_number: draft.lot_number.trim(),
      expiry_date: draft.expiry_date || null,
      cases_initial: draft.cases_initial ? Number(draft.cases_initial) : null,
      cogs_per_case: cogs,
      cogs_status: cogs == null ? "missing" : "confirmed",
      notes: draft.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Lot added");
    setAdding(false);
    setDraft({ sku: "XD", lineage_item_code: "", lot_number: "", expiry_date: "", cases_initial: "", cogs_per_case: "", notes: "" });
    load();
  }

  const kpis = useMemo(() => {
    const cases = rows.reduce((s, r) => s + (r.cases_initial ?? 0), 0);
    const confirmedValue = rows
      .filter((r) => r.cogs_status === "confirmed" && r.cogs_per_case != null)
      .reduce((s, r) => s + (r.cases_initial ?? 0) * Number(r.cogs_per_case) * 8, 0);
    const missing = rows.filter((r) => r.cogs_per_case == null);
    return { cases, confirmedValue, missingLots: missing.length, missingCases: missing.reduce((s, r) => s + (r.cases_initial ?? 0), 0) };
  }, [rows]);

  const th = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

  if (loading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total cases</p>
          <p className="mt-1 font-mono text-xl font-bold" style={{ color: "#1C2340" }}>{kpis.cases.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Value confirmed</p>
          <p className="mt-1 font-mono text-xl font-bold" style={{ color: "#A3224A" }}>{money(kpis.confirmedValue)}</p>
        </div>
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Missing COGS</p>
          <p className="mt-1 font-mono text-xl font-bold text-amber-800">{kpis.missingLots} lots · {kpis.missingCases.toLocaleString()} cases</p>
          <p className="text-[11px] text-amber-700">→ Fill in yellow cells</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setAdding((a) => !a)} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
          {adding ? "Close" : "+ Add lot"}
        </button>
      </div>

      {adding && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-card p-4 md:grid-cols-7">
          <select className={inp} value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })}>
            {SKUS.map((s) => <option key={s} value={SKU_LABEL[s]}>{SKU_LABEL[s]}</option>)}
          </select>
          <input className={inp} placeholder="Lineage code" value={draft.lineage_item_code} onChange={(e) => setDraft({ ...draft, lineage_item_code: e.target.value })} />
          <input className={inp} placeholder="Lot # *" value={draft.lot_number} onChange={(e) => setDraft({ ...draft, lot_number: e.target.value })} />
          <input className={inp} type="date" value={draft.expiry_date} onChange={(e) => setDraft({ ...draft, expiry_date: e.target.value })} />
          <input className={inp} type="number" placeholder="Cases" value={draft.cases_initial} onChange={(e) => setDraft({ ...draft, cases_initial: e.target.value })} />
          <input className={inp} type="number" step="0.01" placeholder="COGS/case" value={draft.cogs_per_case} onChange={(e) => setDraft({ ...draft, cogs_per_case: e.target.value })} />
          <button onClick={addLot} className="rounded-lg px-3 py-1 text-sm font-semibold text-white" style={{ backgroundColor: "#1C2340" }}>Save lot</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/40">
            <tr>
              {["BARIS SKU", "Lineage code", "Lot #", "Expiry"].map((h) => <th key={h} className={`${th} text-left`}>{h}</th>)}
              <th className={`${th} text-right`}>Cases</th>
              <th className={`${th} text-right`}>COGS/pote ($)</th>
              <th className={`${th} text-right`}>COGS/caja (×8)</th>
              <th className={`${th} text-right`}>Inv. value</th>
              <th className={`${th} text-left`}>Status</th>
              <th className={`${th} text-left`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No lots yet.</td></tr>
            ) : rows.map((r) => {
              const oldest = (r.expiry_date ?? "").startsWith("2027");
              const perCase = r.cogs_per_case == null ? null : Number(r.cogs_per_case) * 8;
              const value = perCase == null ? null : (r.cases_initial ?? 0) * perCase;
              return (
                <tr key={r.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-3 py-1.5 font-semibold" style={{ color: "#1C2340" }}>{r.sku}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{r.lineage_item_code ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-xs" style={{ color: "#A3224A" }}>{r.lot_number}</td>
                  <td className={`px-3 py-1.5 text-xs ${oldest ? "font-semibold text-red-600" : ""}`}>
                    {r.expiry_date ?? "—"}{oldest ? " ⚠ OLDEST" : ""}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{(r.cases_initial ?? 0).toLocaleString()}</td>
                  <td className={`px-3 py-1.5 text-right ${STATUS_BG[r.cogs_status ?? "missing"] ?? ""}`}>
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={r.cogs_per_case ?? ""}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw === "" ? null : parseFloat(raw);
                        if (v === (r.cogs_per_case == null ? null : Number(r.cogs_per_case))) return;
                        if (v != null && Number.isNaN(v)) return;
                        updateLot(r.id, v);
                      }}
                      className="w-20 rounded border border-border bg-background px-1 py-0.5 text-right font-mono text-xs text-blue-700"
                      placeholder="—"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{perCase == null ? "—" : money2(perCase)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{money(value)}</td>
                  <td className="px-3 py-1.5"><StatusBadge s={r.cogs_status} /></td>
                  <td className="max-w-[220px] truncate px-3 py-1.5 text-xs text-muted-foreground" title={r.notes ?? ""}>{r.notes ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">Lot Master COGS is stored <strong>per pote</strong> (per bar) — the authoritative source. Per-case value = ×8 (a case holds 8 potes). A COGS set on an individual movement overrides it for that movement. Reference price format: {money2(2.54)}.</p>
    </div>
  );
}
