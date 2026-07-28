import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Row = Database["public"]["Tables"]["fp_movements"]["Row"];

function FPStock() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("fp_movements")
        .select("sku,warehouse,type,cases");
      if (cancel) return;
      if (error) setErr(error.message);
      else setRows((data as Row[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const stock = useMemo(() => {
    const map = new Map<string, { sku: string; warehouse: string; stock: number }>();
    for (const r of rows) {
      const key = `${r.sku}|${r.warehouse}`;
      const delta = r.type === "In" ? r.cases : -r.cases;
      const cur = map.get(key);
      if (cur) cur.stock += delta;
      else map.set(key, { sku: r.sku, warehouse: r.warehouse, stock: delta });
    }
    return [...map.values()].sort(
      (a, b) => a.sku.localeCompare(b.sku) || a.warehouse.localeCompare(b.warehouse),
    );
  }, [rows]);

  return (
    <>
      <PageHeader title="FP Stock" subtitle="Finished product on hand by SKU and warehouse." />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">SKU</th>
              <th className="px-3 py-2 text-left font-medium">Warehouse</th>
              <th className="px-3 py-2 text-right font-medium">Cases</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="p-6 text-center text-muted-foreground">Loading…</td>
              </tr>
            ) : err ? (
              <tr>
                <td colSpan={3} className="p-6 text-center text-destructive">{err}</td>
              </tr>
            ) : stock.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-6 text-center text-muted-foreground">No movements yet.</td>
              </tr>
            ) : (
              stock.map((s) => (
                <tr key={`${s.sku}|${s.warehouse}`} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2">{s.sku}</td>
                  <td className="px-3 py-2">{s.warehouse}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.stock.toLocaleString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const Route = createFileRoute("/_authenticated/fp-stock")({
  component: FPStock,
  head: () => ({ meta: [{ title: "FP Stock · BARIS" }] }),
});