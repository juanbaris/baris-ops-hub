import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Actuals from the Fulfillment pipeline (status = Invoiced), bucketed by invoice
// month, broken down by SKU and by distributor. Cases-based (pipeline is in cases).
// Used by Sales Breakdown to compare forecast vs real.

const SKU_COLS = ["xd", "pw", "hm", "wm", "wd", "matcha", "vs", "cs", "gr", "gs"] as const;
const SKU_CODE: Record<string, string> = {
  xd: "XD", pw: "PW", hm: "HM", wm: "WM", wd: "WD", matcha: "Matcha", vs: "VS", cs: "CS", gr: "GR", gs: "GS",
};

export type ActualBreakdown = {
  // cases per "YYYY-MM" for each SKU code
  bySkuMonth: Record<string, Record<string, number>>;       // sku → { "2027-01": cases }
  // cases per "YYYY-MM" for each distributor
  byDistMonth: Record<string, Record<string, number>>;      // dist → { "2027-01": cases }
};

export function useInvoicedBreakdown() {
  const [data, setData] = useState<ActualBreakdown>({ bySkuMonth: {}, byDistMonth: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const cols = SKU_COLS.map(s => `${s}_cases`).join(",");
      const { data: rows, error } = await supabase
        .from("customer_orders")
        .select(`invoice_date,po_date,distributor,${cols}`)
        .eq("status", "Invoiced")
        .limit(10000);
      if (cancel) return;
      if (error) { console.error("useInvoicedBreakdown error:", error); setLoading(false); return; }

      const bySkuMonth: Record<string, Record<string, number>> = {};
      const byDistMonth: Record<string, Record<string, number>> = {};
      for (const o of (rows ?? []) as Record<string, unknown>[]) {
        const raw = (o.invoice_date ?? o.po_date) as string | null;
        if (!raw) continue;
        const [y, m] = String(raw).split("-").map(Number);
        if (!y || !m) continue;
        const mk = `${y}-${String(m).padStart(2, "0")}`;
        const dist = (o.distributor as string) || "Other";
        let orderCases = 0;
        for (const s of SKU_COLS) {
          const v = Number(o[`${s}_cases`] ?? 0) || 0;
          if (!v) continue;
          const code = SKU_CODE[s];
          (bySkuMonth[code] ??= {})[mk] = (bySkuMonth[code]?.[mk] ?? 0) + v;
          orderCases += v;
        }
        (byDistMonth[dist] ??= {})[mk] = (byDistMonth[dist]?.[mk] ?? 0) + orderCases;
      }
      setData({ bySkuMonth, byDistMonth });
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  return { ...data, loading };
}
