import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type MonthActual = {
  label: string;
  year: number;
  month: number;
  revenue: number;
  cases: number;
  sku: Record<"xd" | "pw" | "hm" | "wm" | "wd" | "matcha", number>;
  orders: number;
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const SKU_COLS = ["xd","pw","hm","wm","wd","matcha"] as const;

/**
 * Actual sales derived from the Fulfillment pipeline.
 *  - byLabel: only status = "Invoiced", bucketed by invoice month (the confirmed real).
 *  - openByLabel: everything NOT invoiced (Open, Accepted, Sent to 3PL, Shipment,
 *    BOL Confirmed) — POs in the pipe that aren't billed yet. Revenue per month.
 */
export function useInvoicedActuals() {
  const [byLabel, setByLabel] = useState<Record<string, MonthActual>>({});
  const [openByLabel, setOpenByLabel] = useState<Record<string, { revenue: number; cases: number; orders: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("customer_orders")
        .select("status,invoice_date,po_date,net_sales,gross_sales,xd_cases,pw_cases,hm_cases,wm_cases,wd_cases,matcha_cases")
        .limit(10000);
      if (cancel) return;
      if (error) { setError(error.message); setLoading(false); return; }

      const acc: Record<string, MonthActual> = {};
      const open: Record<string, { revenue: number; cases: number; orders: number }> = {};

      for (const o of data ?? []) {
        const invoiced = o.status === "Invoiced";
        const raw = invoiced ? (o.invoice_date ?? o.po_date) : (o.po_date ?? o.invoice_date);
        if (!raw) continue;
        const [y, m] = String(raw).split("-").map(Number);
        if (!y || !m) continue;
        const label = `${MONTHS[m - 1]} ${y}`;
        let orderCases = 0;
        for (const s of SKU_COLS) orderCases += Number((o as Record<string, unknown>)[`${s}_cases`] ?? 0) || 0;
        const rev = Number(o.gross_sales ?? o.net_sales ?? 0) || 0;

        if (invoiced) {
          acc[label] ??= { label, year: y, month: m, revenue: 0, cases: 0, orders: 0, sku: { xd:0,pw:0,hm:0,wm:0,wd:0,matcha:0 } };
          const row = acc[label];
          row.orders += 1; row.revenue += rev;
          for (const s of SKU_COLS) { const v = Number((o as Record<string, unknown>)[`${s}_cases`] ?? 0) || 0; row.sku[s] += v; row.cases += v; }
        } else {
          open[label] ??= { revenue: 0, cases: 0, orders: 0 };
          open[label].revenue += rev; open[label].cases += orderCases; open[label].orders += 1;
        }
      }
      setByLabel(acc); setOpenByLabel(open); setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  const history = Object.values(byLabel).sort((a, b) => a.year - b.year || a.month - b.month);
  const casesByLabel: Record<string, number> = {};
  for (const r of history) casesByLabel[r.label] = r.cases;

  return { byLabel, openByLabel, history, casesByLabel, loading, error };
}
