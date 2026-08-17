import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { buildLotMap, resolveCogs } from "@/lib/fp-shared";
import { FPStockTab, IPSummaryTab } from "@/routes/_authenticated/operations";
import { PNLTab } from "@/routes/_authenticated/finance";
import { FPSummaryTab } from "@/components/fp/fp-summary-tab";
import { downloadExcel } from "@/lib/excel-report";

const SKUS = ["XD", "PW", "HM", "WM", "WD", "Matcha"];
const LOT_BASELINE = "2026-08-14";

const PERIODS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border bg-muted/30">
        <h2 className="text-base font-bold" style={{ color: "#1C2340" }}>{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function AccountingPage() {
  const [fpMovements, setFpMovements] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [baseline, setBaseline] = useState<any[]>([]);
  const [lotMap, setLotMap] = useState<Record<string, any>>({});
  const [lotRows, setLotRows] = useState<any[]>([]);
  const [ipMovements, setIpMovements] = useState<any[]>([]);
  const [actuals, setActuals] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      const [fp, ord, bl, lots, ip, act] = await Promise.all([
        supabase.from("fp_movements").select("*").limit(10000),
        supabase.from("customer_orders").select("*").limit(10000),
        supabase.from("fp_stock_baseline").select("*"),
        supabase.from("lot_master").select("*"),
        supabase.from("ip_movements").select("*").limit(10000),
        supabase.from("finance_actuals").select("*").order("period"),
      ]);
      setFpMovements(fp.data ?? []);
      setOrders(ord.data ?? []);
      setBaseline(bl.data ?? []);
      setLotMap(buildLotMap(lots.data ?? []));
      setLotRows(lots.data ?? []);
      setIpMovements(ip.data ?? []);
      const am: Record<string, any> = {};
      (act.data ?? []).forEach((r: any) => { am[r.period] = r; });
      setActuals(am);
      setLoading(false);
    })();
  }, []);

  const realMonths = useMemo(() => PERIODS.filter(p => actuals[p]?.pnl_detail != null).length, [actuals]);

  // ── Gross sales (invoiced POs), last 3 invoiced months ──
  const salesByMonth = useMemo(() => {
    const m: Record<string, number> = {};
    for (const o of orders) {
      if (o.status !== "Invoiced" || !o.invoice_date) continue;
      const key = o.invoice_date.slice(0, 7);
      m[key] = (m[key] ?? 0) + (Number(o.gross_sales) || 0);
    }
    const months = Object.keys(m).sort().slice(-3);
    return months.map(mo => ({ month: mo, gross: m[mo] }));
  }, [orders]);
  const salesTotal = salesByMonth.reduce((s, r) => s + r.gross, 0);
  const monthLabel = (yyyymm: string) => {
    const [y, mm] = yyyymm.split("-");
    return `${MONTHS[parseInt(mm) - 1]} ${y.slice(2)}`;
  };

  // ── FP Accumulated inventory (all warehouses combined) — units + value, per month ──
  const fpAccum = useMemo(() => {
    const mList = [...new Set(fpMovements.map((m: any) => m.movement_date.slice(0, 7)))].sort();
    const CUR = LOT_BASELINE.slice(0, 7);
    if (!mList.includes(CUR)) { mList.push(CUR); mList.sort(); }
    const sorted = [...fpMovements].sort((a: any, b: any) => a.movement_date.localeCompare(b.movement_date));
    const snapU: Record<string, Record<string, number>> = {};
    const snapV: Record<string, Record<string, number>> = {};
    const take = (mo: string, u: Record<string, number>, v: Record<string, number>) => {
      snapU[mo] = Object.fromEntries(SKUS.map(s => [s, u[s] ?? 0]));
      snapV[mo] = Object.fromEntries(SKUS.map(s => [s, v[s] ?? 0]));
    };
    // history (< CUR)
    const balU: Record<string, number> = {}, balV: Record<string, number> = {};
    const hist = mList.filter(m => m < CUR);
    let hi = 0;
    for (const mv of sorted) {
      const mo = mv.movement_date.slice(0, 7);
      while (hi < hist.length && hist[hi] < mo) { take(hist[hi], balU, balV); hi++; }
      if (mo >= CUR) continue;
      const signed = mv.type === "In" ? Number(mv.cases) : -Number(mv.cases);
      balU[mv.sku] = (balU[mv.sku] ?? 0) + signed;
      const { cogs } = resolveCogs(mv, lotMap);
      if (cogs != null) balV[mv.sku] = (balV[mv.sku] ?? 0) + signed * cogs * 8;
    }
    while (hi < hist.length) { take(hist[hi], balU, balV); hi++; }
    // baseline month onward: Lot Master anchor + post-baseline movements
    const curU: Record<string, number> = {}, curV: Record<string, number> = {};
    for (const r of lotRows) {
      const cs = Number(r.cases_initial) || 0;
      curU[r.sku] = (curU[r.sku] ?? 0) + cs;
      curV[r.sku] = (curV[r.sku] ?? 0) + cs * (Number(r.cogs_per_case) || 0) * 8;
    }
    for (const mo of mList.filter(m => m >= CUR)) {
      for (const mv of sorted) {
        if (mv.movement_date.slice(0, 7) !== mo || mv.movement_date <= LOT_BASELINE) continue;
        const signed = mv.type === "In" ? Number(mv.cases) : -Number(mv.cases);
        curU[mv.sku] = (curU[mv.sku] ?? 0) + signed;
        const { cogs } = resolveCogs(mv, lotMap);
        if (cogs != null) curV[mv.sku] = (curV[mv.sku] ?? 0) + signed * cogs * 8;
      }
      take(mo, curU, curV);
    }
    const months = mList.slice(-3);
    return { months, snapU, snapV };
  }, [fpMovements, lotRows, lotMap]);

  // ── I&P inventory history — closing stock by month (units + value) ──
  const ipHist = useMemo(() => {
    const mList = [...new Set(ipMovements.map((m: any) => m.movement_date.slice(0, 7)))].sort();
    const materials = [...new Set(ipMovements.map((m: any) => m.material))].sort();
    const sorted = [...ipMovements].sort((a: any, b: any) => a.movement_date.localeCompare(b.movement_date));
    const balU: Record<string, number> = {}, balV: Record<string, number> = {};
    const snapU: Record<string, Record<string, number>> = {};
    const snapV: Record<string, Record<string, number>> = {};
    const take = (mo: string) => {
      snapU[mo] = Object.fromEntries(materials.map(mt => [mt, balU[mt] ?? 0]));
      snapV[mo] = Object.fromEntries(materials.map(mt => [mt, balV[mt] ?? 0]));
    };
    let mi = 0;
    for (const mv of sorted) {
      const mo = mv.movement_date.slice(0, 7);
      while (mi < mList.length && mList[mi] < mo) { take(mList[mi]); mi++; }
      const signed = mv.type === "In" ? Number(mv.quantity) : -Number(mv.quantity);
      balU[mv.material] = (balU[mv.material] ?? 0) + signed;
      const cogs = (mv as any).cogs_per_unit;
      if (cogs) balV[mv.material] = (balV[mv.material] ?? 0) + signed * Number(cogs);
    }
    while (mi < mList.length) { take(mList[mi]); mi++; }
    return { months: mList.slice(-3), materials, snapU, snapV };
  }, [ipMovements]);

  function exportExcel() {
    try {
      setExporting(true);
      // Sheet 1 — FP accumulated inventory (units + value), combined all warehouses
      const fpHeader = ["SKU", ...fpAccum.months.flatMap(m => [`${monthLabel(m)} · units`, `${monthLabel(m)} · value $`])];
      const fpBody = SKUS.map(sku => [
        sku,
        ...fpAccum.months.flatMap(m => [Math.round(fpAccum.snapU[m]?.[sku] ?? 0), Math.round(fpAccum.snapV[m]?.[sku] ?? 0)]),
      ]);
      const fpTotal = ["TOTAL", ...fpAccum.months.flatMap(m => [
        Math.round(SKUS.reduce((s, sku) => s + (fpAccum.snapU[m]?.[sku] ?? 0), 0)),
        Math.round(SKUS.reduce((s, sku) => s + (fpAccum.snapV[m]?.[sku] ?? 0), 0)),
      ])];
      // Sheet 2 — Sales gross invoiced
      const salesRows = [["Month", "Gross sales $"], ...salesByMonth.map(r => [monthLabel(r.month), Math.round(r.gross)]), ["TOTAL (3 mo)", Math.round(salesTotal)]];
      // Sheet 3 — I&P closing stock by month (units + value)
      const ipHeader = ["Material", ...ipHist.months.flatMap(m => [`${monthLabel(m)} · units`, `${monthLabel(m)} · value $`])];
      const ipBody = ipHist.materials.map(mt => [
        mt,
        ...ipHist.months.flatMap(m => [Math.round(ipHist.snapU[m]?.[mt] ?? 0), Math.round(ipHist.snapV[m]?.[mt] ?? 0)]),
      ]);

      downloadExcel(`BARIS-Accounting-${new Date().toISOString().slice(0, 10)}`, [
        { name: "FP Accumulated Inv", rows: [["FP Accumulated inventory — all warehouses (combined)"], fpHeader, ...fpBody, fpTotal] },
        { name: "Sales Gross Invoiced", rows: [["Sales — gross invoiced (last 3 months)"], ...salesRows] },
        { name: "IP Inventory History", rows: [["Inventory history — closing stock by month"], ipHeader, ...ipBody] },
      ]);
      toast.success("Excel report generated");
    } catch (e) {
      toast.error(`Could not generate report: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Accounting" subtitle="Consolidated view · P&L, inventory, sales & I&P in one place." />
        <button onClick={exportExcel} disabled={exporting || loading}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60 shrink-0"
          style={{ backgroundColor: "#1D6F42" }}
          title="FP accumulated inventory + Sales + I&P history · last 3 months">
          {exporting ? "Generating…" : "⬇ Download Excel report"}
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">Loading…</div>
      ) : (
        <>
          <Section title="P&L (Collapsed)" subtitle="Actual months · from Finance">
            <PNLTab realMonths={realMonths} actuals={actuals} actualOnly={true} />
          </Section>

          <Section title="FP Stock — actual" subtitle="Current finished-product stock · from Lot Master">
            <FPStockTab movements={fpMovements} orders={orders} loading={loading} baseline={baseline} lotMap={lotMap} />
          </Section>

          <Section title="FP Summary — inventory & COGS" subtitle="Accumulated inventory + monthly COGS of sales">
            <FPSummaryTab />
          </Section>

          <Section title="Sales — gross invoiced (last 3 months)" subtitle="All invoiced POs · by invoice month">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
                  <th className="px-4 py-2.5 text-left">Month</th>
                  <th className="px-4 py-2.5 text-right">Gross sales</th>
                </tr>
              </thead>
              <tbody>
                {salesByMonth.length === 0 ? (
                  <tr><td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">No invoiced POs yet.</td></tr>
                ) : salesByMonth.map(r => (
                  <tr key={r.month} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-2 font-semibold">{monthLabel(r.month)}</td>
                    <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700">{money(r.gross)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ backgroundColor: "#1C2340", color: "#fff" }}>
                  <td className="px-4 py-2 text-xs font-semibold">TOTAL (3 mo)</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">{money(salesTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </Section>

          <Section title="I&P Summary — inventory" subtitle="Ingredients & packaging inventory over time">
            <IPSummaryTab movements={ipMovements} />
          </Section>
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/accounting")({
  component: AccountingPage,
});
