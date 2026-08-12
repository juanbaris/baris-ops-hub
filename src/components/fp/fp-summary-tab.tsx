import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SKUS, SKU_LABEL, buildLotMap, downloadCsv, money, resolveCogs, type LotCard, type SKU } from "@/lib/fp-shared";

type Mv = {
  movement_date: string;
  type: string;
  sku: string;
  cases: number;
  lot_number: string | null;
  concept: string;
  warehouse: string;
  cogs_per_case: number | null;
};

type SkuMonthSummary = {
  sku: SKU;
  openingCases: number;
  openingValue: number | null;
  inCases: number;
  inValue: number | null;
  outCases: number;
  outValue: number | null;
  closingCases: number;
  closingValue: number | null;
  cogsMissing: boolean;
};

const BRAND = "#1C2340";
const SKU_COLORS: Record<string, string> = {
  XD: "#A3224A", PW: "#1C2340", HM: "#7C3AED", WM: "#0EA5E9", WD: "#D97706", Matcha: "#16A34A",
};

/** Preferred display order for warehouses; anything else follows alphabetically. */
const WH_ORDER = ["Lineage Newark", "Lineage Linden", "Cold Chain", "Heinlein", "OOE"];
/** Warehouses that are retired — never shown as their own card, and left out of the combined total. */
const HIDDEN_WAREHOUSES = ["FreezPak", "Empire"];
/** Always render a card for these even if there are no movements yet (e.g. a new 3PL coming online). */
const ALWAYS_SHOW_WAREHOUSES = ["Lineage Newark", "Cold Chain", "Lineage Linden"];

function sortWarehouses(list: string[]): string[] {
  return [...list].sort((a, b) => {
    const ia = WH_ORDER.indexOf(a), ib = WH_ORDER.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });
}

const UNITS_PER_CASE = 8;
const monthLabel = (m: string) => m.slice(2).replace("-", "/");

export function FPSummaryTab() {
  const [movements, setMovements] = useState<Mv[]>([]);
  const [lotMap, setLotMap] = useState<Record<string, LotCard>>({});
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const [mv, lots] = await Promise.all([
        supabase
          .from("fp_movements")
          .select("movement_date, type, sku, cases, lot_number, concept, warehouse, cogs_per_case")
          .order("movement_date")
          .limit(10000),
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

  // ── Per-month movement summary (Opening / IN / OUT / Closing) for selected month ──
  const rows: SkuMonthSummary[] = useMemo(() => {
    return SKUS.map((sku) => {
      const mine = movements.filter((m) => m.sku === sku);
      let openingCases = 0, openingValue = 0, openingKnown = true;
      let inCases = 0, inValue = 0, outCases = 0, outValue = 0, missing = false;

      for (const m of mine) {
        const inPeriod = month === "all" ? true : m.movement_date.slice(0, 7) === month;
        const before = month === "all" ? false : m.movement_date.slice(0, 7) < month;
        const { cogs: pote } = resolveCogs(m, lotMap);
        const cogs = pote == null ? null : pote * 8; // per-case $ = per-pote × 8
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
        if (m.type === "In") {
          inCases += cases;
          if (cogs != null) inValue += cases * cogs;
        } else {
          outCases += cases;
          if (cogs != null) outValue += cases * cogs;
        }
      }

      const openVal = openingKnown ? openingValue : null;
      const closingCases = openingCases + inCases - outCases;
      const closingValue = openVal == null ? null : openVal + inValue - outValue;
      return {
        sku, openingCases, openingValue: openVal, inCases, inValue, outCases, outValue,
        closingCases, closingValue, cogsMissing: missing || !openingKnown,
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

  // ── Accumulated inventory over time, broken down by warehouse ─────────────
  const { monthList, whList, accCases, accValue } = useMemo(() => {
    const mList = [...new Set(movements.map((m) => m.movement_date.slice(0, 7)))].sort();
    const whSet = new Set<string>(ALWAYS_SHOW_WAREHOUSES);
    for (const m of movements) if (m.warehouse) whSet.add(m.warehouse);
    for (const h of HIDDEN_WAREHOUSES) whSet.delete(h);
    const whs = sortWarehouses([...whSet]);

    // running balances keyed by sku|wh
    const balCases: Record<string, number> = {};
    const balValue: Record<string, number> = {};
    const sorted = [...movements].sort((a, b) => a.movement_date.localeCompare(b.movement_date));

    // snapshots[monthIndex][sku][wh] = closing balance at end of that month
    const snapC: Record<string, Record<string, Record<string, number>>> = {};
    const snapV: Record<string, Record<string, Record<string, number>>> = {};
    const takeSnap = (mo: string) => {
      const c: Record<string, Record<string, number>> = {};
      const v: Record<string, Record<string, number>> = {};
      for (const sku of SKUS) {
        c[sku] = {}; v[sku] = {};
        for (const wh of whs) {
          c[sku][wh] = balCases[`${sku}|${wh}`] ?? 0;
          v[sku][wh] = balValue[`${sku}|${wh}`] ?? 0;
        }
      }
      snapC[mo] = c; snapV[mo] = v;
    };

    let mi = 0;
    for (const mv of sorted) {
      const mo = mv.movement_date.slice(0, 7);
      while (mi < mList.length && mList[mi] < mo) { takeSnap(mList[mi]); mi++; }
      const cases = Number(mv.cases);
      const signed = mv.type === "In" ? cases : -cases;
      const key = `${mv.sku}|${mv.warehouse}`;
      balCases[key] = (balCases[key] ?? 0) + signed;
      const { cogs: pote } = resolveCogs(mv, lotMap);
      if (pote != null) balValue[key] = (balValue[key] ?? 0) + signed * pote * 8;
    }
    while (mi < mList.length) { takeSnap(mList[mi]); mi++; }

    return { monthList: mList, whList: whs, accCases: snapC, accValue: snapV };
  }, [movements, lotMap]);

  // ── Monthly COGS of sales (net: Out adds, In/return subtracts) ────────────
  const salesByMonth = useMemo(() => {
    // result[sku][month] = { cases, cogs }
    const res: Record<string, Record<string, { cases: number; cogs: number }>> = {};
    for (const sku of SKUS) { res[sku] = {}; for (const m of monthList) res[sku][m] = { cases: 0, cogs: 0 }; }
    for (const mv of movements) {
      if (mv.concept !== "Sale") continue;
      const mo = mv.movement_date.slice(0, 7);
      if (!res[mv.sku]?.[mo]) continue;
      const sign = mv.type === "Out" ? 1 : -1; // returns (In) reduce net sales
      const cases = Number(mv.cases);
      const { cogs: pote } = resolveCogs(mv, lotMap);
      res[mv.sku][mo].cases += sign * cases;
      if (pote != null) res[mv.sku][mo].cogs += sign * cases * pote * 8;
    }
    return res;
  }, [movements, lotMap, monthList]);

  function exportCsv() {
    const label = month === "all" ? "ALL" : month.replace("-", "_");
    const data: (string | number)[][] = [
      [`BARIS FP Report — ${month === "all" ? "All time" : month}`],
      [],
      ["CASES (movement summary)"],
      ["SKU", "Opening", "IN", "OUT", "Closing", "Change"],
      ...rows.map((r) => [SKU_LABEL[r.sku], r.openingCases, r.inCases, r.outCases, r.closingCases, r.closingCases - r.openingCases]),
      ["TOTAL", tot.openingCases, tot.inCases, tot.outCases, tot.closingCases, tot.closingCases - tot.openingCases],
      [],
      ["DOLLAR VALUE (COGS)"],
      ["SKU", "Opening $", "IN $", "OUT $", "Closing $", "Notes"],
      ...rows.map((r) => [
        SKU_LABEL[r.sku],
        r.openingValue == null ? "" : Math.round(r.openingValue),
        Math.round(r.inValue ?? 0),
        Math.round(r.outValue ?? 0),
        r.closingValue == null ? "" : Math.round(r.closingValue),
        r.cogsMissing ? "COGS missing" : "",
      ]),
      ["TOTAL", Math.round(tot.openingValue), Math.round(tot.inValue), Math.round(tot.outValue), Math.round(tot.closingValue), ""],
      [],
      ["ACCUMULATED INVENTORY — CLOSING CASES BY WAREHOUSE"],
      ["Warehouse", "SKU", ...monthList],
      ...whList.flatMap((wh) =>
        SKUS.map((sku) => [wh, SKU_LABEL[sku], ...monthList.map((m) => Math.round(accCases[m]?.[sku]?.[wh] ?? 0))]),
      ),
      [],
      ["MONTHLY COGS OF SALES — CASES SOLD"],
      ["SKU", ...monthList],
      ...SKUS.map((sku) => [SKU_LABEL[sku], ...monthList.map((m) => Math.round(salesByMonth[sku]?.[m]?.cases ?? 0))]),
      [],
      ["MONTHLY COGS OF SALES — TOTAL COGS $"],
      ["SKU", ...monthList],
      ...SKUS.map((sku) => [SKU_LABEL[sku], ...monthList.map((m) => Math.round(salesByMonth[sku]?.[m]?.cogs ?? 0))]),
    ];
    downloadCsv(`BARIS_FP_Report_${label}.csv`, data);
  }

  const th = "px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

  if (loading)
    return <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
        >
          <option value="all">All time</option>
          {months.map((m) => (<option key={m} value={m}>{m}</option>))}
        </select>
        <button onClick={exportCsv} className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: BRAND }}>
          ↓ Export report
        </button>
      </div>

      {anyMissing && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          ⚠ Some movements are missing COGS data — dollar values are partial. Edit movements in FP Input or update Lot
          Master to add COGS.
        </div>
      )}

      {/* Accumulated inventory by warehouse (historical) — most important, on top */}
      <AccumulatedInventory monthList={monthList} whList={whList} accCases={accCases} accValue={accValue} />

      {/* Monthly COGS of sales */}
      <MonthlyCOGSSales monthList={monthList} salesByMonth={salesByMonth} />

      {/* ── Per-month movement detail (secondary — kept at the bottom) ── */}
      <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Movement detail {month !== "all" && <>· {month}</>}
      </div>

      {/* Cases movement summary */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-5 py-2.5 text-sm font-semibold" style={{ color: BRAND }}>
          Cases {month !== "all" && <span className="text-muted-foreground font-normal">· {month}</span>}
        </div>
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className={`${th} text-left`}>SKU</th>
              {["Opening", "+ IN", "− OUT", "= Closing", "Change"].map((h) => (<th key={h} className={`${th} text-right`}>{h}</th>))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-3 py-2 font-semibold" style={{ color: BRAND }}>{SKU_LABEL[r.sku]}</td>
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
              <td className="px-3 py-2" style={{ color: BRAND }}>TOTAL</td>
              <td className="px-3 py-2 text-right font-mono">{tot.openingCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{tot.inCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{tot.outCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{tot.closingCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono">{(tot.closingCases - tot.openingCases).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Dollar movement summary */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-5 py-2.5 text-sm font-semibold" style={{ color: BRAND }}>
          Dollar value (COGS-based) {month !== "all" && <span className="text-muted-foreground font-normal">· {month}</span>}
        </div>
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/20">
            <tr>
              <th className={`${th} text-left`}>SKU</th>
              {["Opening $", "+ IN $", "− OUT $", "= Closing $"].map((h) => (<th key={h} className={`${th} text-right`}>{h}</th>))}
              <th className={`${th} text-left`}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-3 py-2 font-semibold" style={{ color: BRAND }}>{SKU_LABEL[r.sku]}</td>
                <td className="px-3 py-2 text-right font-mono">{money(r.openingValue)}</td>
                <td className="px-3 py-2 text-right font-mono text-emerald-700">{money(r.inValue)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-600">{money(r.outValue)}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{money(r.closingValue)}</td>
                <td className="px-3 py-2 text-xs">
                  {r.cogsMissing ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">⚠ COGS missing</span>
                  ) : ("—")}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
              <td className="px-3 py-2" style={{ color: BRAND }}>TOTAL</td>
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

// ─── Accumulated inventory by warehouse ──────────────────────────────────────
function AccumulatedInventory({
  monthList, whList, accCases, accValue,
}: {
  monthList: string[];
  whList: string[];
  accCases: Record<string, Record<string, Record<string, number>>>;
  accValue: Record<string, Record<string, Record<string, number>>>;
}) {
  const [viewMode, setViewMode] = useState<"cases" | "value">("cases");
  // Individual warehouse tables are collapsed by default; the combined view stays open.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const snap = viewMode === "cases" ? accCases : accValue;

  const balAt = (m: string, sku: string, wh: string | null) => {
    if (wh) return snap[m]?.[sku]?.[wh] ?? 0;
    return whList.reduce((s, w) => s + (snap[m]?.[sku]?.[w] ?? 0), 0);
  };

  const InventoryTable = ({ wh }: { wh: string | null }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-xs min-w-max">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
            <th className="px-4 py-2 text-left sticky left-0 bg-muted/20">SKU</th>
            {monthList.map((m) => (<th key={m} className="px-3 py-2 text-right whitespace-nowrap">{monthLabel(m)}</th>))}
          </tr>
        </thead>
        <tbody>
          {SKUS.map((sku) => (
            <tr key={sku} className="border-t border-border/40 hover:bg-muted/20">
              <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card" style={{ color: SKU_COLORS[sku] }}>
                {SKU_LABEL[sku]}
              </td>
              {monthList.map((m) => {
                const v = balAt(m, sku, wh);
                return (
                  <td key={m} className={`px-3 py-1.5 text-right font-mono ${v < 0 ? "text-red-600 font-semibold" : ""}`}>
                    {viewMode === "cases" ? v.toLocaleString() : v ? `$${Math.round(v).toLocaleString()}` : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ backgroundColor: BRAND, color: "#fff" }}>
            <td className="px-4 py-2 font-semibold text-xs sticky left-0" style={{ backgroundColor: BRAND }}>TOTAL</td>
            {monthList.map((m) => {
              const total = SKUS.reduce((s, sku) => s + balAt(m, sku, wh), 0);
              return (
                <td key={m} className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                  {viewMode === "cases" ? total.toLocaleString() : total ? `$${Math.round(total).toLocaleString()}` : "—"}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold" style={{ color: BRAND }}>Accumulated inventory — by warehouse</p>
          <p className="text-xs text-muted-foreground">End-of-month closing balance from all FP movements</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(["cases", "value"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${viewMode === m ? "text-white shadow-sm" : "text-muted-foreground"}`}
              style={viewMode === m ? { backgroundColor: BRAND } : {}}
            >
              {m === "cases" ? "Units" : "$ Value"}
            </button>
          ))}
        </div>
      </div>

      {/* Combined view — always visible, on top */}
      <div className="px-5 py-2 text-xs font-semibold uppercase tracking-wide bg-muted/10" style={{ color: BRAND }}>
        All warehouses (combined)
      </div>
      <InventoryTable wh={null} />

      {/* Individual warehouses — collapsible */}
      <div className="divide-y divide-border border-t border-border">
        {whList.map((wh) => {
          const isOpen = open[wh] ?? false;
          return (
            <div key={wh}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [wh]: !isOpen }))}
                className="w-full flex items-center gap-2 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:bg-muted/20 transition-colors"
              >
                <span className="inline-block transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
                Stock — {wh}
              </button>
              {isOpen && <InventoryTable wh={wh} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Monthly COGS of sales ───────────────────────────────────────────────────
function MonthlyCOGSSales({
  monthList, salesByMonth,
}: {
  monthList: string[];
  salesByMonth: Record<string, Record<string, { cases: number; cogs: number }>>;
}) {
  const [view, setView] = useState<"cases" | "cogs" | "unitary">("cases");

  const value = (sku: string, m: string): number => {
    const d = salesByMonth[sku]?.[m] ?? { cases: 0, cogs: 0 };
    if (view === "cases") return d.cases;
    if (view === "cogs") return d.cogs;
    return d.cases !== 0 ? d.cogs / (d.cases * UNITS_PER_CASE) : 0; // unitary $/bar
  };

  const totalFor = (m: string): number => {
    const cases = SKUS.reduce((s, sku) => s + (salesByMonth[sku]?.[m]?.cases ?? 0), 0);
    const cogs = SKUS.reduce((s, sku) => s + (salesByMonth[sku]?.[m]?.cogs ?? 0), 0);
    if (view === "cases") return cases;
    if (view === "cogs") return cogs;
    return cases !== 0 ? cogs / (cases * UNITS_PER_CASE) : 0;
  };

  const fmt = (v: number): string => {
    if (view === "cases") return v.toLocaleString();
    if (view === "cogs") return v ? `$${Math.round(v).toLocaleString()}` : "—";
    return v ? `$${v.toFixed(2)}` : "—";
  };

  const TABS: { id: typeof view; label: string }[] = [
    { id: "cases", label: "Cases sold" },
    { id: "cogs", label: "Total COGS $" },
    { id: "unitary", label: "Unitary COGS" },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold" style={{ color: BRAND }}>Monthly COGS of sales</p>
          <p className="text-xs text-muted-foreground">Net sales per month (returns reduce the total) · unitary = $/bar</p>
        </div>
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${view === t.id ? "text-white shadow-sm" : "text-muted-foreground"}`}
              style={view === t.id ? { backgroundColor: BRAND } : {}}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2 text-left sticky left-0 bg-muted/20">SKU</th>
              {monthList.map((m) => (<th key={m} className="px-3 py-2 text-right whitespace-nowrap">{monthLabel(m)}</th>))}
            </tr>
          </thead>
          <tbody>
            {SKUS.map((sku) => (
              <tr key={sku} className="border-t border-border/40 hover:bg-muted/20">
                <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card" style={{ color: SKU_COLORS[sku] }}>
                  {SKU_LABEL[sku]}
                </td>
                {monthList.map((m) => {
                  const v = value(sku, m);
                  return (
                    <td key={m} className={`px-3 py-1.5 text-right font-mono ${v < 0 ? "text-red-600 font-semibold" : ""}`}>
                      {fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ backgroundColor: BRAND, color: "#fff" }}>
              <td className="px-4 py-2 font-semibold text-xs sticky left-0" style={{ backgroundColor: BRAND }}>
                {view === "unitary" ? "AVG" : "TOTAL"}
              </td>
              {monthList.map((m) => (
                <td key={m} className="px-3 py-2 text-right font-mono font-bold text-emerald-400">{fmt(totalFor(m))}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
