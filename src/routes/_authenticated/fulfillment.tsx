import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Order = Database["public"]["Tables"]["customer_orders"]["Row"];
type Distributor = Database["public"]["Enums"]["distributor"];
type Status = Database["public"]["Enums"]["order_status"];

const DISTRIBUTORS: Distributor[] = ["UNFI", "KeHe", "Rainforest", "RFD", "Direct", "Other"];
const STATUSES: Status[] = ["Open", "Acknowledged", "Shipment", "Invoiced"];

const NEXT_STATUS: Record<Status, Status | null> = {
  Open: "Acknowledged",
  Acknowledged: "Shipment",
  Shipment: "Invoiced",
  Invoiced: null,
};

const STATUS_STYLES: Record<Status, string> = {
  Open: "bg-muted text-foreground",
  Acknowledged: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  Shipment: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  Invoiced: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
};

function StatusCell({
  order,
  onChanged,
}: {
  order: Order;
  onChanged: (updated: Order) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const next = NEXT_STATUS[order.status];

  async function changeTo(newStatus: Status) {
    setSaving(true);
    setOpen(false);
    const oldStatus = order.status;
    const patch: Database["public"]["Tables"]["customer_orders"]["Update"] = {
      status: newStatus,
    };
    if (newStatus === "Invoiced" && !order.invoice_date) {
      patch.invoice_date = new Date().toISOString().slice(0, 10);
    }
    const { data, error } = await supabase
      .from("customer_orders")
      .update(patch)
      .eq("id", order.id)
      .select()
      .single();
    if (error || !data) {
      setSaving(false);
      toast.error(error?.message ?? "Failed to update status");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      table_name: "customer_orders",
      record_id: order.id,
      action: "status_change",
      user_id: userData.user?.id ?? null,
      old_data: { field: "status", old_value: oldStatus },
      new_data: { field: "status", new_value: newStatus },
    });
    onChanged(data);
    setSaving(false);
    toast.success(`Status updated to ${newStatus}`);
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        disabled={!next || saving}
        onClick={() => setOpen((o) => !o)}
        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[order.status]} ${next && !saving ? "cursor-pointer hover:ring-2 hover:ring-ring/40" : "cursor-default opacity-80"}`}
      >
        {order.status}
        {next ? " ▾" : ""}
      </button>
      {open && next && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-popover p-1 shadow-md">
            <button
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-muted"
              onClick={() => changeTo(next)}
            >
              Move to <span className="font-semibold">{next}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const COLUMNS: { key: keyof Order; label: string; numeric?: boolean }[] = [
  { key: "po_number", label: "PO #" },
  { key: "po_date", label: "PO Date" },
  { key: "ship_est_date", label: "Ship Est." },
  { key: "invoice_date", label: "Invoice" },
  { key: "distributor", label: "Distributor" },
  { key: "customer", label: "Customer" },
  { key: "status", label: "Status" },
  { key: "wd_cases", label: "WD", numeric: true },
  { key: "pw_cases", label: "PW", numeric: true },
  { key: "hm_cases", label: "HM", numeric: true },
  { key: "matcha_cases", label: "MA", numeric: true },
  { key: "xd_cases", label: "XD", numeric: true },
  { key: "wm_cases", label: "WM", numeric: true },
  { key: "gross_sales", label: "Gross", numeric: true },
  { key: "promo_discount", label: "Promo", numeric: true },
  { key: "net_sales", label: "Net", numeric: true },
  { key: "fill_rate", label: "Fill %", numeric: true },
];

function PipelinePO() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dist, setDist] = useState<Distributor | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [sortKey, setSortKey] = useState<keyof Order>("po_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("customer_orders")
        .select("*")
        .order("po_date", { ascending: false });
      if (cancel) return;
      if (error) setErr(error.message);
      else setRows(data ?? []);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const f = rows.filter(
      (r) =>
        (dist === "all" || r.distributor === dist) &&
        (status === "all" || r.status === status),
    );
    const sorted = [...f].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, dist, status, sortKey, sortDir]);

  function toggleSort(k: keyof Order) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const fmtNum = (v: unknown) =>
    v == null || v === "" ? "—" : typeof v === "number" ? v.toLocaleString() : String(v);

  function applyUpdate(updated: Order) {
    setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <>
      <PageHeader title="Pipeline PO" subtitle="Customer orders in the pipeline." />

      <div className="mb-4">
        <Link
          to="/collections"
          className="text-sm font-medium text-primary hover:underline"
        >
          View Collections →
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Distributor</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={dist}
            onChange={(e) => setDist(e.target.value as Distributor | "all")}
          >
            <option value="all">All</option>
            {DISTRIBUTORS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as Status | "all")}
          >
            <option value="all">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "order" : "orders"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {COLUMNS.map((c) => (
                <th
                  key={String(c.key)}
                  className={`cursor-pointer select-none px-3 py-2 font-medium ${c.numeric ? "text-right" : "text-left"}`}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}
                  {sortKey === c.key && (
                    <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : err ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-6 text-center text-destructive">
                  {err}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-6 text-center text-muted-foreground">
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  {COLUMNS.map((c) => (
                    <td
                      key={String(c.key)}
                      className={`px-3 py-2 ${c.numeric ? "text-right font-mono" : ""}`}
                    >
                      {c.key === "status" ? (
                        <StatusCell order={r} onChanged={applyUpdate} />
                      ) : c.numeric ? (
                        fmtNum(r[c.key])
                      ) : (
                        ((r[c.key] as string) ?? "—")
                      )}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export const Route = createFileRoute("/_authenticated/fulfillment")({
  component: PipelinePO,
  head: () => ({ meta: [{ title: "Pipeline PO · BARIS" }] }),
});