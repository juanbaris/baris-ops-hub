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

type DateFilter = "all" | "this_month" | "last_month" | "quarter" | "this_year" | "last_year" | "custom";
type Quarter = "Q1" | "Q2" | "Q3" | "Q4";

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function computeRange(
  filter: DateFilter,
  quarter: Quarter,
  from: string,
  to: string,
): { from: string | null; to: string | null } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = (yr: number, mo: number, day = 1) => ymd(new Date(yr, mo, day));
  const endOfMonth = (yr: number, mo: number) => ymd(new Date(yr, mo + 1, 0));
  switch (filter) {
    case "all":
      return { from: null, to: null };
    case "this_month":
      return { from: start(y, m), to: endOfMonth(y, m) };
    case "last_month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return { from: start(ly, lm), to: endOfMonth(ly, lm) };
    }
    case "quarter": {
      const qStart = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 }[quarter];
      return { from: start(y, qStart), to: endOfMonth(y, qStart + 2) };
    }
    case "this_year":
      return { from: start(y, 0), to: endOfMonth(y, 11) };
    case "last_year":
      return { from: start(y - 1, 0), to: endOfMonth(y - 1, 11) };
    case "custom":
      return { from: from || null, to: to || null };
  }
}

const NEXT_STATUS: Record<Status, Status | null> = {
  Open: "Acknowledged",
  Acknowledged: "Shipment",
  Shipment: "Invoiced",
  Invoiced: null,
};

const STATUS_STYLES: Record<Status, string> = {
  Open: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  Acknowledged: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
  Shipment: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  Invoiced: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
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
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[order.status]} ${next && !saving ? "cursor-pointer transition hover:brightness-95" : "cursor-default opacity-80"}`}
      >
        {order.status}
        {next ? <span aria-hidden>▾</span> : null}
      </button>
      {open && next && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-border bg-popover p-1 shadow-lg">
            <button
              type="button"
              className="block w-full rounded-md px-2 py-1.5 text-left text-xs font-medium hover:bg-muted"
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

type ColumnKey = keyof Order | "total_cases";
const COLUMNS: { key: ColumnKey; label: string; numeric?: boolean; sku?: boolean; money?: boolean }[] = [
  { key: "po_number", label: "PO #" },
  { key: "po_date", label: "PO Date" },
  { key: "ship_est_date", label: "Ship Est." },
  { key: "invoice_date", label: "Invoice" },
  { key: "distributor", label: "Distributor" },
  { key: "customer", label: "Customer" },
  { key: "status", label: "Status" },
  { key: "wd_cases", label: "WD", numeric: true, sku: true },
  { key: "pw_cases", label: "PW", numeric: true, sku: true },
  { key: "hm_cases", label: "HM", numeric: true, sku: true },
  { key: "matcha_cases", label: "MA", numeric: true, sku: true },
  { key: "xd_cases", label: "XD", numeric: true, sku: true },
  { key: "wm_cases", label: "WM", numeric: true, sku: true },
  { key: "total_cases", label: "Total", numeric: true },
  { key: "gross_sales", label: "Gross", numeric: true, money: true },
  { key: "promo_discount", label: "Promo", numeric: true, money: true },
  { key: "net_sales", label: "Net", numeric: true, money: true },
  { key: "fill_rate", label: "Fill %", numeric: true },
];

const SKU_KEYS = new Set<ColumnKey>(["wd_cases", "pw_cases", "hm_cases", "matcha_cases", "xd_cases", "wm_cases"]);

const CASE_KEYS: (keyof Order)[] = [
  "wd_cases",
  "pw_cases",
  "hm_cases",
  "matcha_cases",
  "xd_cases",
  "wm_cases",
];
const TOTAL_KEYS: (keyof Order)[] = [
  ...CASE_KEYS,
  "gross_sales",
  "promo_discount",
  "net_sales",
];

const MONEY_KEYS = new Set<keyof Order>(["gross_sales", "promo_discount", "net_sales"]);

function rowTotalCases(r: Order): number {
  return CASE_KEYS.reduce((s, k) => s + (Number(r[k]) || 0), 0);
}

function fmtMoney(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

function PipelinePO() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [dist, setDist] = useState<Distributor | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [quarter, setQuarter] = useState<Quarter>("Q1");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [sortKey, setSortKey] = useState<ColumnKey>("po_date");
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
    const range = computeRange(dateFilter, quarter, customFrom, customTo);
    const f = rows.filter(
      (r) =>
        (dist === "all" || r.distributor === dist) &&
        (status === "all" || r.status === status) &&
        (!range.from || r.po_date >= range.from) &&
        (!range.to || r.po_date <= range.to),
    );
    const sorted = [...f].sort((a, b) => {
      const av = sortKey === "total_cases" ? rowTotalCases(a) : a[sortKey as keyof Order];
      const bv = sortKey === "total_cases" ? rowTotalCases(b) : b[sortKey as keyof Order];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, dist, status, dateFilter, quarter, customFrom, customTo, sortKey, sortDir]);

  function toggleSort(k: ColumnKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

function fmtCell(k: ColumnKey, v: unknown) {
  if (v == null || v === "") return "—";
  if (k === "total_cases" && typeof v === "number") return Math.round(v).toLocaleString();
  if (MONEY_KEYS.has(k as keyof Order) && typeof v === "number") return fmtMoney(v);
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

function getCellValue(r: Order, k: ColumnKey): unknown {
  if (k === "total_cases") return rowTotalCases(r);
  return r[k as keyof Order];
}

function cellClass(c: (typeof COLUMNS)[number]) {
  const base = c.numeric ? "text-right font-mono tabular-nums" : "text-left";
  if (c.sku) return `${base} bg-sku-column`;
  if (c.key === "total_cases") return `${base} bg-total-cases-column font-semibold`;
  return base;
}

function renderBodyCell(r: Order, c: (typeof COLUMNS)[number], onChanged: (o: Order) => void) {
  if (c.key === "status") return <StatusCell order={r} onChanged={onChanged} />;
  const v = getCellValue(r, c.key);
  if (c.sku) {
    const n = Number(v) || 0;
    if (n === 0) return <span className="block w-full text-center text-muted-foreground">—</span>;
    return n.toLocaleString();
  }
  if (c.key === "total_cases") {
    return <span className="font-semibold">{Math.round(Number(v) || 0).toLocaleString()}</span>;
  }
  if (c.money && typeof v === "number") {
    const formatted = fmtMoney(v);
    if (c.key === "net_sales") return <span className="text-success">{formatted}</span>;
    return formatted;
  }
  return fmtCell(c.key, v);
}

  const totals = useMemo(() => {
    const t: Record<string, number> = { total_cases: 0 };
    for (const k of TOTAL_KEYS) t[k as string] = 0;
    for (const r of filtered) {
      for (const k of TOTAL_KEYS) t[k as string] += Number(r[k]) || 0;
      t.total_cases += rowTotalCases(r);
    }
    return t;
  }, [filtered]);

  function applyUpdate(updated: Order) {
    setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <>
      <PageHeader title="Pipeline PO" subtitle="Customer orders in the pipeline." />

      <div className="mb-5">
        <Link
          to="/collections"
          className="text-sm font-medium text-primary hover:underline"
        >
          View Collections →
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <FilterSelect
          label="Date"
          value={dateFilter}
          onChange={(v) => setDateFilter(v as DateFilter)}
          options={[
            { value: "all", label: "All" },
            { value: "this_month", label: "This month" },
            { value: "last_month", label: "Last month" },
            { value: "quarter", label: "By Quarter" },
            { value: "this_year", label: "This year" },
            { value: "last_year", label: "Last year" },
            { value: "custom", label: "Custom range" },
          ]}
        />
        {dateFilter === "quarter" && (
          <FilterSelect
            label="Quarter"
            value={quarter}
            onChange={(v) => setQuarter(v as Quarter)}
            options={[
              { value: "Q1", label: "Q1" },
              { value: "Q2", label: "Q2" },
              { value: "Q3", label: "Q3" },
              { value: "Q4", label: "Q4" },
            ]}
          />
        )}
        {dateFilter === "custom" && (
          <>
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              From
              <input
                type="date"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              To
              <input
                type="date"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </>
        )}
        <FilterSelect
          label="Distributor"
          value={dist}
          onChange={(v) => setDist(v as Distributor | "all")}
          options={[
            { value: "all", label: "All" },
            ...DISTRIBUTORS.map((d) => ({ value: d, label: d })),
          ]}
        />
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as Status | "all")}
          options={[
            { value: "all", label: "All" },
            ...STATUSES.map((s) => ({ value: s, label: s })),
          ]}
        />
        <span className="ml-auto rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "order" : "orders"}
        </span>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-md ring-1 ring-black/5">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-muted/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {COLUMNS.map((c) => (
                <th
                  key={String(c.key)}
                  className={`cursor-pointer select-none px-3 py-2.5 font-semibold ${c.numeric ? "text-right" : "text-left"} ${c.sku ? "bg-sku-column" : ""} ${c.key === "total_cases" ? "bg-total-cases-column" : ""}`}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label}
                  {sortKey === c.key && (
                    <span className="ml-1 text-primary">
                      {sortDir === "asc" ? "▲" : "▼"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : err ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-8 text-center text-destructive">
                  {err}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="p-8 text-center text-muted-foreground">
                  No orders match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border/70 transition-colors hover:bg-muted/40"
                >
                  {COLUMNS.map((c) => (
                    <td
                      key={String(c.key)}
                      className={`px-3 py-1.5 ${cellClass(c)}`}
                    >
                      {renderBodyCell(r, c, applyUpdate)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {!loading && !err && filtered.length > 0 && (
            <tfoot>
              <tr
                className="sticky bottom-0 text-xs uppercase tracking-wide"
                style={{ backgroundColor: "#1C2340", color: "#ffffff" }}
              >
                {COLUMNS.map((c, idx) => {
                  if (idx === 0) {
                    return (
                      <td key={String(c.key)} className="px-3 py-2 font-semibold">
                        Totals
                      </td>
                    );
                  }
                  if (c.key === "total_cases") {
                    return (
                      <td
                        key={String(c.key)}
                        className="px-3 py-2 text-right font-mono tabular-nums font-bold"
                      >
                        {totals.total_cases.toLocaleString()}
                      </td>
                    );
                  }
                  if (c.numeric && TOTAL_KEYS.includes(c.key as keyof Order)) {
                    const v = totals[c.key as string] ?? 0;
                    return (
                      <td
                        key={String(c.key)}
                        className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${c.key === "net_sales" ? "text-success" : ""}`}
                      >
                        {MONEY_KEYS.has(c.key as keyof Order) ? fmtMoney(v) : Math.round(v).toLocaleString()}
                      </td>
                    );
                  }
                  return <td key={String(c.key)} className="px-3 py-2" />;
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <select
        className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const Route = createFileRoute("/_authenticated/fulfillment")({
  component: PipelinePO,
  head: () => ({ meta: [{ title: "Pipeline PO · BARIS" }] }),
});