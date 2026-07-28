import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Row = Database["public"]["Tables"]["ip_movements"]["Row"];

function IPMovements() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data, error } = await supabase
        .from("ip_movements")
        .select("*")
        .order("movement_date", { ascending: false });
      if (cancel) return;
      if (error) setErr(error.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const cols: { key: keyof Row; label: string; numeric?: boolean }[] = [
    { key: "movement_date", label: "Date" },
    { key: "type", label: "Type" },
    { key: "concept", label: "Concept" },
    { key: "material", label: "Material" },
    { key: "quantity", label: "Qty", numeric: true },
    { key: "unit", label: "Unit" },
    { key: "vendor", label: "Vendor" },
    { key: "lot_number", label: "Lot" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <>
      <PageHeader title="I&P Movements" subtitle="Ingredients & packaging ledger." />
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {cols.map((c) => (
                <th
                  key={String(c.key)}
                  className={`px-3 py-2 font-medium ${c.numeric ? "text-right" : "text-left"}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : err ? (
              <tr><td colSpan={cols.length} className="p-6 text-center text-destructive">{err}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="p-6 text-center text-muted-foreground">No movements yet.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  {cols.map((c) => {
                    const v = r[c.key];
                    return (
                      <td
                        key={String(c.key)}
                        className={`px-3 py-2 ${c.numeric ? "text-right font-mono" : ""}`}
                      >
                        {v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString() : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const Route = createFileRoute("/_authenticated/ip-movements")({
  component: IPMovements,
  head: () => ({ meta: [{ title: "I&P Movements · BARIS" }] }),
});