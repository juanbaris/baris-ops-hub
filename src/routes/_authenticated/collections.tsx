import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Order = Database["public"]["Tables"]["customer_orders"]["Row"];

function Collections() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("customer_orders")
        .select("*")
        .eq("status", "Invoiced")
        .order("invoice_date", { ascending: false });
      if (cancel) return;
      if (error) setErr(error.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const fmtMoney = (v: number | null) =>
    v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <PageHeader title="Collections" subtitle="Invoiced orders pending or received." />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Distributor</th>
              <th className="px-3 py-2 text-left font-medium">PO #</th>
              <th className="px-3 py-2 text-left font-medium">Invoice Date</th>
              <th className="px-3 py-2 text-right font-medium">Net Sales</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : err ? (
              <tr><td colSpan={4} className="p-6 text-center text-destructive">{err}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No invoiced orders.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">{r.distributor}</td>
                  <td className="px-3 py-2">{r.po_number}</td>
                  <td className="px-3 py-2">{r.invoice_date ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmtMoney(r.net_sales)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const Route = createFileRoute("/_authenticated/collections")({
  component: Collections,
  head: () => ({ meta: [{ title: "Collections · BARIS" }] }),
});