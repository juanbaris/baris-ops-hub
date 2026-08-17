import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { buildLotMap } from "@/lib/fp-shared";
import { FPStockTab, IPSummaryTab } from "@/routes/_authenticated/operations";
import { PNLTab } from "@/routes/_authenticated/finance";
import { FPSummaryTab } from "@/components/fp/fp-summary-tab";
import { generateAccountingDeck } from "@/lib/accounting-deck";

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

  async function exportDeck() {
    try {
      setExporting(true);
      await generateAccountingDeck({
        asOf: new Date().toISOString().slice(0, 10),
        salesByMonth: salesByMonth.map(r => ({ label: monthLabel(r.month), gross: r.gross })),
        lots: (await supabase.from("lot_master").select("*")).data ?? [],
        fpMovements, ipMovements, actuals, realMonths, periods: PERIODS, months: MONTHS,
      });
      toast.success("PowerPoint generated");
    } catch (e) {
      toast.error(`Could not generate deck: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <PageHeader title="Accounting" subtitle="Consolidated view · P&L, inventory, sales & I&P in one place." />
        <button onClick={exportDeck} disabled={exporting || loading}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-60 shrink-0"
          style={{ backgroundColor: "#A3224A" }}>
          {exporting ? "Generating…" : "⬇ Download PowerPoint"}
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
