import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  SKUS, SKU_LABEL, buildLotMap, downloadCsv, money, resolveCogs,
  type LotCard, type SKU,
} from "@/lib/fp-shared";

type Mv = {
  movement_date: string; type: string; sku: string; cases: number;
  lot_number: string | null; concept: string; warehouse: string; cogs_per_case: number | null;
};

type SkuMonthSummary = {
  sku: SKU;
  openingCases: number; openingValue: number | null;
  inCases: number; inValue: number | null;
  outCases: number; outValue: number | null;
  closingCases: number; closingValue: number | null;
  cogsMissing: boolean;
};

export function FPSummaryTab() {
  const [movements, setMovements] = useState<Mv[]>([]);
  const [lotMap, setLotMap] = useState<Record<string, LotCard>>({});
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const [mv, lots] = await Promise.all([
        supabase.from("fp_movements")
          .select("movement_date, type, sku, cases, lot_number, concept, warehouse, cogs_per_case")
          .order("movement_date"),
        supabase.from("lot_master").select("lot_number,cogs_per_case,cogs_status,expiry_date,sku"),
      ]);
      setMovements((mv.data as unknown as Mv[]) ?? []);
      setLotMap(buildLotMap(lots.data ?? []));
      setLoading(false);
    })();
  }, []);

  const months = useMemo(
    () => [...new Set(movements.map((m) => m.movement_date.slice(0, 7)))].sort().reverse(),
    [movements],
  );

  useEffect(() => {
    if (month === "all" && months.length) setMonth(months[0]);
  }, [months]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows: SkuMonthSummary[] = useMemo(() => {
    return SKUS.map((sku) => {
      const mine = movements.filter((m) => m.sku === sku);
      let openingCases = 0, openingValue = 0, openingKnown = true;
      let inCases = 0, inValue = 0, outCases = 0, outValue = 0, missing = false;

      for (const m of mine) {
        const inPeriod = month === "all" ? true : m.movement_date.slice(0, 7) === month;
        const before = month === "all" ? false : m.movement_date.slice(0, 7) < month;
        const { cogs } = resolveCogs(m, lotMap);
        const cases = Number(m.cases);
        const signed = m.type === "In" ? cases : -cases;

        if (before) {
          openingCases += signed;
          if (cogs == null) openingKnown = false;
          else openingValue += signed * cogs;
          continue;
        }
        if (!inPeriod) continue;
        if (cogs == null) missing = true;
        if (m.type === "In") { inCases += cases; if (cogs != null) inValue += cases * cogs; }
        else { outCases += cases; if (cogs != null) outValue += cases * cogs; }
      }

      const openVal = openingKnown ? openingValue : null;
      const closingCases = openingCases + inCases - outCases;
      const closingValue = openVal == null ? null : openVal + inValue - outValue;
      return {
        sku, openingCases, openingValue: openVal,
        inCases, inValue, outCases, outValue,
        closingCases, closingValue,
        cogsMissing: missing || !openingKnown,
      };
    }).filter((r) => r.openingCases !== 0 || r.inCases !== 0 || r.outCases !== 0);
  }, [movements, lotMap, month]);

  const tot = rows.reduce(
    (a, r) => ({
      openingCases: a.openingCases + r.openingCases,
      inCases: a.inCases + r.inCases,
      outCases: a.outCases + r.outCases,
      closingCases: a.closingCases + r.closingCases,
      openingValue: a.openingValue + (r.openingValue ?? 0),
      inValue: a.inValue + (r.inValue ?? 0),
      outValue: a.outValue + (r.outValue ?? 0),
      closingValue: a.closingValue + (r.closingValue ?? 0),
    }),
    { openingCases: 0, inCases: 0, outCases: 0, closingCases: 0, openingValue: 0, inValue: 0, outValue: 0, closingValue: 0 },
  );

  const anyMissing = rows.some((r) => r.cogsMissing);

  function exportCsv() {
    const label = month === "all" ? "ALL" : month.replace("-", "_");
    const data: (string | number)[][] = [
      [`BARIS FP Report — ${month === "all" ? "All time" : month}`],
      [],
      ["CASES"],
      ["SKU", "Opening", "IN", "OUT", "Closing", "Change"],
      ...rows.map((r) => [SKU_LABEL[r.sku], r.openingCases, r.inCases, r.outCases, r.closingCases, r.closingCases - r.openingCases]),
      ["TOTAL", tot.openingCases, tot.inCases, tot.outCases, tot.closingCases, tot.closingCases - tot.openingCases],
      [],
      ["DOLLAR VALUE (COGS)"],
      ["SKU", "Opening $", "IN $", "OUT $", "Closing $", "Notes"],
      ...rows.map((r) => [
        SKU_LABEL[r.sku],
        r.openingValue == null ? "" : Math.round(r.openingValue),
        Math.round(r.inValue ?? 0), Math.round(r.outValue ?? 0),
        r.closingValue == null ? "" : Math.round(r.closingValue),
        r.cogsMissing ? "COGS missing" : "",
      ]),
      ["TOTAL", Math.round(tot.openingValue), Math.round(tot.inValue), Math.round(tot.outValue), Math.round(tot.closingValue), ""],
    ];
    downloadCsv(`BARIS_FP_Report_${label}.csv`, data);
  }

  const th = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

  if (loading) return <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select value={month} onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm">
          <option value="all">All time</option>
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={exportCsv} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "#1C2340" }}>
          ↓ Export report
        </button>
      </div>

      {anyMissing && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          ⚠ Some movements are missing COGS data — dollar values are partial. Edit movements in FP Input or update Lot Master to add COGS.
        </div>
      )}

      {/* Cases */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-5 py-2.5 text-sm font-semibold" style={{ color: "#1C2340" }}>Cases</div>
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className={`${th} text-left`}>SKU</th>
              {["Opening", "+ IN", "− OUT", "= Closing", "Change"].map((h) => <th key={h} className={`${th} text-right`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-3 py-2 font-semibold" style={{ color: "#1C2340" }}>{SKU_LABEL[r.sku]}</td>
                <td className="px-3 py-2 text-right font-mono">{r.openingCases.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">{r.inCases.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{r.outCases.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{r.closingCases.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">{(r.closingCases - r.openingCases).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
              <td className="px-3 py-2" style={{ color: "#1C2340" }}>TOTAL</td>
              <td className="px-3 py-2 text-right font-mono">{tot.openingCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{tot.inCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{tot.outCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{tot.closingCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{(tot.closingCases - tot.openingCases).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Value */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-5 py-2.5 text-sm font-semibold" style={{ color: "#1C2340" }}>Dollar value (COGS-based)</div>
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className={`${th} text-left`}>SKU</th>
              {["Opening $", "+ IN $", "− OUT $", "= Closing $"].map((h) => <th key={h} className={`${th} text-right`}>{h}</th>)}
              <th className={`${th} text-left`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-3 py-2 font-semibold" style={{ color: "#1C2340" }}>{SKU_LABEL[r.sku]}</td>
                <td className="px-3 py-2 text-right font-mono">{money(r.openingValue)}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">{money(r.inValue)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{money(r.outValue)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{money(r.closingValue)}</td>
                <td className="px-3 py-2 text-xs">
                  {r.cogsMissing ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">⚠ COGS missing</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
              <td className="px-3 py-2" style={{ color: "#1C2340" }}>TOTAL</td>
              <td className="px-3 py-2 text-right font-mono">{money(tot.openingValue)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(tot.inValue)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(tot.outValue)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(tot.closingValue)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
