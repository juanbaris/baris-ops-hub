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
 * Actual sales derived from the Fulfillment pipeline: only orders with
 * status = "Invoiced", bucketed by invoice month. Single source of truth for
 * "Real" numbers across Sales / Home.
 */
export function useInvoicedActuals() {
  const [byLabel, setByLabel] = useState<Record<string, MonthActual>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("customer_orders")
        .select("invoice_date,po_date,net_sales,gross_sales,xd_cases,pw_cases,hm_cases,wm_cases,wd_cases,matcha_cases")
        .eq("status", "Invoiced");
      if (cancel) return;
      if (error) { setError(error.message); setLoading(false); return; }

      const acc: Record<string, MonthActual> = {};
      for (const o of data ?? []) {
        const raw = o.invoice_date ?? o.po_date;
        if (!raw) continue;
        const [y, m] = String(raw).split("-").map(Number);
        if (!y || !m) continue;
        const label = `${MONTHS[m - 1]} ${y}`;
        acc[label] ??= {
          label, year: y, month: m, revenue: 0, cases: 0, orders: 0,
          sku: { xd: 0, pw: 0, hm: 0, wm: 0, wd: 0, matcha: 0 },
        };
        const row = acc[label];
        row.orders += 1;
        row.revenue += Number(o.net_sales ?? o.gross_sales ?? 0) || 0;
        for (const s of SKU_COLS) {
          const v = Number((o as Record<string, unknown>)[`${s}_cases`] ?? 0) || 0;
          row.sku[s] += v;
          row.cases += v;
        }
      }
      setByLabel(acc);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  const history = Object.values(byLabel).sort((a, b) => a.year - b.year || a.month - b.month);
  const casesByLabel: Record<string, number> = {};
  for (const r of history) casesByLabel[r.label] = r.cases;

  return { byLabel, history, casesByLabel, loading, error };
}
