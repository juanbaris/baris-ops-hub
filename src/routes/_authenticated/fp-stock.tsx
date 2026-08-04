import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  SKUS, SKU_LABEL, WAREHOUSES, buildLotMap, fmtDate, money, money2, monthsUntil,
  normLot, resolveCogs, skuLabel, type CogsStatus, type LotCard, type SKU,
} from "@/lib/fp-shared";

type Mv = { sku: string; warehouse: string; type: string; cases: number; lot_number: string | null; cogs_per_case: number | null; movement_date?: string };

const STATUS_BADGE: Record<CogsStatus, string> = {
  confirmed: "bg-emerald-100 text-emerald-700",
  estimated: "bg-orange-100 text-orange-700",
  missing: "bg-red-100 text-red-700",
};
const STATUS_TEXT: Record<CogsStatus, string> = { confirmed: "Confirmed", estimated: "Estimated", missing: "Missing" };

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className={`rounded-2xl border p-4 ${tone === "amber" ? "border-amber-300 bg-amber-50" : "border-border bg-card"}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold" style={{ color: tone === "amber" ? "#B45309" : "#1C2340" }}>{value}</p>
    </div>
  );
}

function FPStock() {
  const [movements, setMovements] = useState<Mv[]>([]);
  const [lotMap, setLotMap] = useState<Record<string, LotCard>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"sku" | "lot">("sku");
  const [fSku, setFSku] = useState("all");
  const [fWh, setFWh] = useState("all");

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [movementsRes, lotsRes] = await Promise.all([
        supabase.from("fp_movements").select("sku,warehouse,type,cases,lot_number,cogs_per_case,movement_date"),
        supabase.from("lot_master").select("lot_number,cogs_per_case,cogs_status,expiry_date,sku"),
      ]);
      if (cancel) return;
      if (movementsRes.error) setErr(movementsRes.error.message);
      else setMovements((movementsRes.data as unknown as Mv[]) ?? []);
      setLotMap(buildLotMap(lotsRes.data ?? []));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  /** View 1 — SKU × warehouse net cases + value. */
  const bySku = useMemo(() => {
    const map = new Map<SKU, { cases: Record<string, number>; total: number; value: number }>();
    for (const m of movements) {
      const sku = (SKUS as string[]).includes(m.sku) ? (m.sku as SKU) : null;
      if (!sku) continue;
      const delta = m.type === "In" ? Number(m.cases) : -Number(m.cases);
      const cur = map.get(sku) ?? { cases: {}, total: 0, value: 0 };
      cur.cases[m.warehouse] = (cur.cases[m.warehouse] ?? 0) + delta;
      cur.total += delta;
      const { cogs } = resolveCogs(m, lotMap);
      if (cogs != null) cur.value += delta * cogs;
      map.set(sku, cur);
    }
    return SKUS.filter((s) => map.has(s)).map((s) => ({ sku: s, ...map.get(s)! })).filter((r) => r.total !== 0);
  }, [movements, lotMap]);

  /** View 2 — lot detail. */
  const byLot = useMemo(() => {
    const map = new Map<string, {
      sku: string; lot: string; warehouse: string; cases: number;
      cogs: number | null; status: CogsStatus; expiry: string | null; first: string;
    }>();
    for (const m of movements) {
      const lot = m.lot_number ?? "—";
      const key = `${m.sku}|${lot}|${m.warehouse}`;
      const delta = m.type === "In" ? Number(m.cases) : -Number(m.cases);
      const { cogs, status } = resolveCogs(m, lotMap);
      const card = lotMap[normLot(lot)];
      const cur = map.get(key);
      if (cur) {
        cur.cases += delta;
        if (cur.cogs == null && cogs != null) { cur.cogs = cogs; cur.status = status; }
        if (m.movement_date && m.movement_date < cur.first) cur.first = m.movement_date;
      } else {
        map.set(key, {
          sku: m.sku, lot, warehouse: m.warehouse, cases: delta,
          cogs: cogs ?? card?.cogs ?? null,
          status: cogs != null ? status : card?.cogs != null ? card.status : "missing",
          expiry: card?.expiry ?? null,
          first: m.movement_date ?? new Date().toISOString().slice(0, 10),
        });
      }
    }
    return [...map.values()]
      .filter((r) => r.cases !== 0)
      .sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999"));
  }, [movements, lotMap]);

  const lotsFiltered = byLot.filter(
    (r) => (fSku === "all" || r.sku === fSku) && (fWh === "all" || r.warehouse === fWh),
  );

  const missing = byLot.filter((r) => r.cogs == null && r.cases > 0);
  const missingCases = missing.reduce((s, r) => s + r.cases, 0);

  const newarkCases = bySku.reduce((s, r) => s + (r.cases["Lineage Newark"] ?? 0), 0);
  const newarkValue = byLot
    .filter((r) => r.warehouse === "Lineage Newark" && r.cogs != null)
    .reduce((s, r) => s + r.cases * (r.cogs ?? 0), 0);

  const otherOf = (c: Record<string, number>) =>
    Object.entries(c).filter(([w]) => w !== "Lineage Newark" && w !== "Cold Chain").reduce((s, [, v]) => s + v, 0);

  const totals = bySku.reduce(
    (acc, r) => ({
      newark: acc.newark + (r.cases["Lineage Newark"] ?? 0),
      cold: acc.cold + (r.cases["Cold Chain"] ?? 0),
      other: acc.other + otherOf(r.cases),
      total: acc.total + r.total,
      value: acc.value + r.value,
    }),
    { newark: 0, cold: 0, other: 0, total: 0, value: 0 },
  );

  return (
    <>
      <PageHeader title="FP Stock" subtitle="Finished product on hand, by SKU and by lot, valued at COGS." />

      <div className="mb-5 flex gap-1 border-b border-border">
        {([["sku", "By SKU"], ["lot", "By Lot"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className="border-b-2 px-4 py-2 text-sm font-semibold transition-colors"
            style={tab === id ? { borderColor: "#A3224A", color: "#A3224A" } : { borderColor: "transparent", color: "#6B7280" }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">Loading…</div>
      ) : err ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-destructive">{err}</div>
      ) : tab === "sku" ? (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Kpi label="Cases · Lineage Newark" value={newarkCases.toLocaleString()} />
            <Kpi label="Inventory value · Lineage Newark" value={money(newarkValue)} />
            <Kpi label="Lots missing COGS" value={`${missing.length} lots · ${missingCases.toLocaleString()} cases`} tone="amber" />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">SKU</th>
                  <th className="px-3 py-2 text-right font-medium">Lineage Newark</th>
                  <th className="px-3 py-2 text-right font-medium">Cold Chain</th>
                  <th className="px-3 py-2 text-right font-medium">Other</th>
                  <th className="px-3 py-2 text-right font-medium">Total cases</th>
                  <th className="px-3 py-2 text-right font-medium">Est. value</th>
                </tr>
              </thead>
              <tbody>
                {bySku.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No stock yet.</td></tr>
                ) : bySku.map((r) => (
                  <tr key={r.sku} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-3 py-2 font-semibold" style={{ color: "#1C2340" }}>{SKU_LABEL[r.sku]}</td>
                    <td className="px-3 py-2 text-right font-mono">{(r.cases["Lineage Newark"] ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">{(r.cases["Cold Chain"] ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">{otherOf(r.cases).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{r.total.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono">{money(r.value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-3 py-2" style={{ color: "#1C2340" }}>TOTAL</td>
                  <td className="px-3 py-2 text-right font-mono">{totals.newark.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{totals.cold.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{totals.other.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{totals.total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono">{money(totals.value)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
              ⚠ {missing.length} lots totaling {missingCases.toLocaleString()} cases are missing COGS. Go to Lot Master to add them.
            </div>
          )}
          <div className="mb-3 flex flex-wrap gap-2">
            <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value={fSku} onChange={(e) => setFSku(e.target.value)}>
              <option value="all">All SKUs</option>
              {SKUS.map((s) => <option key={s} value={s}>{SKU_LABEL[s]}</option>)}
            </select>
            <select className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value={fWh} onChange={(e) => setFWh(e.target.value)}>
              <option value="all">All warehouses</option>
              {WAREHOUSES.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
            <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">{lotsFiltered.length} lots</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-max text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  {["SKU", "Lot #", "Warehouse"].map((h) => <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>)}
                  <th className="px-3 py-2 text-right font-medium">Cases</th>
                  <th className="px-3 py-2 text-left font-medium">Expiry</th>
                  <th className="px-3 py-2 text-right font-medium">COGS/case</th>
                  <th className="px-3 py-2 text-right font-medium">Inv. value</th>
                  <th className="px-3 py-2 text-left font-medium">COGS status</th>
                  <th className="px-3 py-2 text-right font-medium">Days old</th>
                </tr>
              </thead>
              <tbody>
                {lotsFiltered.length === 0 ? (
                  <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No lots match the filters.</td></tr>
                ) : lotsFiltered.map((r) => {
                  const mu = monthsUntil(r.expiry);
                  const bg = mu != null && mu < 3 ? "bg-red-50" : mu != null && mu < 6 ? "bg-amber-50" : "";
                  const days = Math.max(0, Math.round((Date.now() - new Date(`${r.first}T00:00:00`).getTime()) / 86400000));
                  return (
                    <tr key={`${r.sku}|${r.lot}|${r.warehouse}`} className={`border-t border-border/60 ${bg} hover:bg-muted/20`}>
                      <td className="px-3 py-1.5 font-semibold" style={{ color: "#1C2340" }}>{skuLabel(r.sku)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs" style={{ color: "#A3224A" }}>{r.lot}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.warehouse}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.cases.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-xs">{fmtDate(r.expiry)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{money2(r.cogs)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs">{r.cogs == null ? "—" : money(r.cases * r.cogs)}</td>
                      <td className="px-3 py-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[r.status]}`}>{STATUS_TEXT[r.status]}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-xs text-muted-foreground">{days}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

export const Route = createFileRoute("/_authenticated/fp-stock")({
  component: FPStock,
  head: () => ({
    meta: [
      { title: "FP Stock · BARIS Operations Hub" },
      { name: "description", content: "Finished product stock by SKU, warehouse and lot, with COGS valuation and FIFO expiry priority." },
      { property: "og:title", content: "FP Stock · BARIS Operations Hub" },
      { property: "og:description", content: "Finished product stock by SKU, warehouse and lot with COGS valuation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});
