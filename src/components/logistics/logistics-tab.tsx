import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  calcLogistics, norm, PALLET_COLS,
  type Accessorial, type DcMapping, type KeheRate, type LineageTariff, type LogisticsCost,
  type RateBook, type Surcharges,
} from "./rates";

type Order = Database["public"]["Tables"]["customer_orders"]["Row"];

const BURGUNDY = "#A3224A";
const NAVY = "#1C2340";
const GRAY = "#6B7280";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const money2 = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2)}`;

const STATUSES = ["Open", "Accepted", "Sent to 3PL", "Shipment", "BOL Confirmed", "Invoiced", "Acknowledged"];
const DISTRIBUTORS = ["UNFI", "KeHe", "Rainforest", "RFD", "Direct", "Other"];

// ─── tiny local filter widgets ────────────────────────────────────────────────
function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: Set<string>; onChange: (v: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);
  const all = selected.size === 0;
  const display = all ? "All" : selected.size === 1 ? [...selected][0] : `${selected.size} selected`;
  function toggle(v: string) {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  }
  return (
    <div ref={ref} className="relative">
      <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        <button type="button" onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-normal normal-case tracking-normal shadow-sm focus:outline-none ${!all ? "border-[#A3224A] bg-[#A3224A]/5 text-[#A3224A]" : "border-border bg-background text-foreground"}`}>
          {display}<span className="text-[10px]">▾</span>
        </button>
      </label>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 max-h-72 min-w-[180px] overflow-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          <button type="button" onClick={() => { onChange(new Set()); setOpen(false); }}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs hover:bg-muted ${all ? "font-semibold" : ""}`}>All</button>
          {options.map(opt => (
            <button key={opt} type="button" onClick={() => toggle(opt)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs hover:bg-muted">
              <span className={`flex h-3 w-3 flex-shrink-0 items-center justify-center rounded border ${selected.has(opt) ? "border-[#A3224A] bg-[#A3224A]" : "border-border"}`}>
                {selected.has(opt) && <span className="text-[8px] text-white">✓</span>}
              </span>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      <select className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold" style={{ color: color ?? NAVY }}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

// cell input used across rate cards
function NumInput({ value, onSave, width = "w-24" }: { value: number | string | null; onSave: (v: number) => void; width?: string }) {
  const [v, setV] = useState(String(value ?? ""));
  useEffect(() => { setV(String(value ?? "")); }, [value]);
  return (
    <input value={v} inputMode="decimal"
      onChange={e => setV(e.target.value)}
      onBlur={() => { const n = Number(v); if (!Number.isNaN(n) && n !== Number(value)) onSave(n); }}
      className={`${width} rounded-md border border-border bg-background px-2 py-1 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-primary/30`} />
  );
}

function TextInput({ value, onSave, width = "w-48", placeholder }: { value: string | null; onSave: (v: string | null) => void; width?: string; placeholder?: string }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  return (
    <input value={v} placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { const nv = v.trim() === "" ? null : v.trim(); if (nv !== value) onSave(nv); }}
      className={`${width} rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30`} />
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────
export default function LogisticsTab({ orders }: { orders: Order[] }) {
  const [sub, setSub] = useState<"pipeline" | "rates" | "dashboard">("pipeline");
  const [book, setBook] = useState<RateBook>({ mapping: [], tariffs: [], surcharges: null, kehe: [], accessorial: null });
  const [loading, setLoading] = useState(true);

  async function reload() {
    const [m, t, s, k, a] = await Promise.all([
      supabase.from("logistics_dc_mapping").select("*").order("raw_customer_name"),
      supabase.from("logistics_lineage_tariff").select("*").order("canonical_dc"),
      supabase.from("logistics_lineage_surcharges").select("*").limit(1).maybeSingle(),
      supabase.from("logistics_kehe_rate").select("*").order("canonical_dc"),
      supabase.from("logistics_accessorial_rates").select("*").limit(1).maybeSingle(),
    ]);
    setBook({
      mapping: m.data ?? [], tariffs: t.data ?? [], surcharges: s.data ?? null,
      kehe: k.data ?? [], accessorial: a.data ?? null,
    });
    setLoading(false);
  }
  useEffect(() => { void reload(); }, []);

  // costs are always computed on the fly from the rate tables — never stored on the PO
  const priced = useMemo(
    () => orders.map(o => ({ order: o, cost: calcLogistics(o, book) })),
    [orders, book],
  );

  const subTabs = [
    { id: "pipeline", label: "Pipeline" },
    { id: "rates", label: "Rate Cards" },
    { id: "dashboard", label: "Dashboard" },
  ] as const;

  return (
    <div>
      <div className="mb-4 inline-flex gap-1 rounded-xl bg-muted p-1">
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${sub === t.id ? "text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            style={sub === t.id ? { backgroundColor: NAVY } : {}}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <p className="p-8 text-center text-muted-foreground">Loading rates…</p>
        : sub === "pipeline" ? <PipelineView priced={priced} />
        : sub === "rates" ? <RateCards book={book} orders={orders} reload={reload} />
        : <DashboardView priced={priced} />}
    </div>
  );
}

type Priced = { order: Order; cost: LogisticsCost };

const UNMAPPED = "Sin DC identificado";

const PIPELINE_COLS = [
  { key: "po_number", label: "PO #" },
  { key: "po_date", label: "PO date" },
  { key: "distributor", label: "Distributor" },
  { key: "customer", label: "Customer" },
  { key: "dc", label: "DC" },
  { key: "status", label: "Status" },
  { key: "cases", label: "Cases" },
  { key: "pallets", label: "Pallets" },
  { key: "freight", label: "Freight" },
  { key: "noFreight", label: "Non-freight" },
  { key: "total", label: "Total" },
  { key: "payer", label: "Freight payer" },
] as const;

function sortValue(p: Priced, key: string): string | number {
  const { order: o, cost: c } = p;
  switch (key) {
    case "po_number": return o.po_number ?? "";
    case "po_date": return o.po_date ?? "";
    case "distributor": return o.distributor ?? "";
    case "customer": return o.customer ?? "";
    case "dc": return c.canonicalDc ?? "zzz";
    case "status": return o.status ?? "";
    case "cases": return c.totalCases;
    case "pallets": return c.pallets ?? -1;
    case "freight": return c.flete ?? -1;
    case "noFreight": return c.noFlete ?? -1;
    case "total": return c.total ?? -1;
    case "payer": return c.payer ?? "";
    default: return "";
  }
}

// ─── a) Pipeline ──────────────────────────────────────────────────────────────
function PipelineView({ priced }: { priced: Priced[] }) {
  const [dateFilter, setDateFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selDist, setSelDist] = useState<Set<string>>(new Set());
  const [selDc, setSelDc] = useState<Set<string>>(new Set());
  const [selStatus, setSelStatus] = useState<Set<string>>(new Set());
  const [onlyCosted, setOnlyCosted] = useState(false);
  const [sortKey, setSortKey] = useState<string>("po_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const dcOptions = useMemo(
    () => [UNMAPPED, ...[...new Set(priced.map(p => p.cost.canonicalDc).filter(Boolean) as string[])].sort()],
    [priced],
  );

  const range = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const s = (yr: number, mo: number) => new Date(yr, mo, 1).toISOString().slice(0, 10);
    const e = (yr: number, mo: number) => new Date(yr, mo + 1, 0).toISOString().slice(0, 10);
    switch (dateFilter) {
      case "this_month": return { from: s(y, m), to: e(y, m) };
      case "last_month": { const lm = m === 0 ? 11 : m - 1, ly = m === 0 ? y - 1 : y; return { from: s(ly, lm), to: e(ly, lm) }; }
      case "this_year": return { from: s(y, 0), to: e(y, 11) };
      case "last_year": return { from: s(y - 1, 0), to: e(y - 1, 11) };
      case "custom": return { from: from || null, to: to || null };
      default: return { from: null, to: null };
    }
  }, [dateFilter, from, to]);

  const rows = useMemo(() => priced.filter(p => {
    const o = p.order, c = p.cost;
    if (selDist.size && !selDist.has(o.distributor)) return false;
    if (selStatus.size && !selStatus.has(o.status)) return false;
    if (selDc.size && !selDc.has(c.canonicalDc ?? UNMAPPED)) return false;
    if (onlyCosted && c.total == null) return false;
    if (range.from && (o.po_date ?? "") < range.from) return false;
    if (range.to && (o.po_date ?? "") > range.to) return false;
    return true;
  }).sort((a, b) => {
    const va = sortValue(a, sortKey), vb = sortValue(b, sortKey);
    let cmp: number;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    return sortDir === "asc" ? cmp : -cmp;
  }), [priced, selDist, selStatus, selDc, onlyCosted, range, sortKey, sortDir]);

  const k = useMemo(() => {
    const cases = rows.reduce((s, r) => s + r.cost.totalCases, 0);
    const flete = rows.reduce((s, r) => s + (r.cost.flete ?? 0), 0);
    const noFlete = rows.reduce((s, r) => s + (r.cost.noFlete ?? 0), 0);
    const costedCases = rows.filter(r => r.cost.total != null).reduce((s, r) => s + r.cost.totalCases, 0);
    return { pos: rows.length, cases, flete, noFlete, total: flete + noFlete, perCase: costedCases ? (flete + noFlete) / costedCases : 0 };
  }, [rows]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
        <FilterSelect label="Date" value={dateFilter} onChange={setDateFilter} options={[
          { value: "all", label: "All" }, { value: "this_month", label: "This month" },
          { value: "last_month", label: "Last month" }, { value: "this_year", label: "This year" },
          { value: "last_year", label: "Last year" }, { value: "custom", label: "Custom range" },
        ]} />
        {dateFilter === "custom" && (<>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm shadow-sm" />
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm shadow-sm" />
        </>)}
        <MultiSelect label="Distributor" options={DISTRIBUTORS} selected={selDist} onChange={setSelDist} />
        <MultiSelect label="DC" options={dcOptions} selected={selDc} onChange={setSelDc} />
        <MultiSelect label="Status" options={STATUSES} selected={selStatus} onChange={setSelStatus} />
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <input type="checkbox" checked={onlyCosted} onChange={e => setOnlyCosted(e.target.checked)} />
          Solo con costo calculado
        </label>
        <span className="ml-auto rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{rows.length} POs</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="POs" value={k.pos.toLocaleString()} />
        <Kpi label="Cases" value={k.cases.toLocaleString()} />
        <Kpi label="Freight" value={money(k.flete)} />
        <Kpi label="Non-freight" value={money(k.noFlete)} />
        <Kpi label="Total logistics" value={money(k.total)} color={BURGUNDY} />
        <Kpi label="Avg cost / case" value={money2(k.perCase)} color={BURGUNDY} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-md ring-1 ring-black/5">
        <table className="w-full min-w-max text-sm">
          <thead>
            <tr className="bg-muted/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
              {PIPELINE_COLS.map((col, i) => (
                <th
                  key={col.key}
                  onClick={() => {
                    if (sortKey === col.key) setSortDir(d => (d === "asc" ? "desc" : "asc"));
                    else { setSortKey(col.key); setSortDir(col.key === "po_date" ? "desc" : "asc"); }
                  }}
                  className={`cursor-pointer select-none px-3 py-2.5 font-semibold hover:text-foreground ${i >= 6 && i <= 10 ? "text-right" : "text-left"}`}
                >
                  {col.label}
                  <span className="ml-1 text-[9px]">{sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0
              ? <tr><td colSpan={12} className="p-8 text-center text-muted-foreground">No POs match the filters.</td></tr>
              : rows.map(({ order: o, cost: c }) => (
                <tr key={o.id} className="border-t border-border/70 hover:bg-muted/40">
                  <td className="px-3 py-1.5 font-mono text-xs" style={{ color: BURGUNDY }}>{o.po_number}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{o.po_date}</td>
                  <td className="px-3 py-1.5 text-xs">{o.distributor}</td>
                  <td className="px-3 py-1.5 text-xs">{o.customer}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {c.canonicalDc ?? <span className="text-muted-foreground/70 italic">Sin DC identificado</span>}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{o.status}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{c.totalCases.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{c.pallets ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{money(c.flete)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{money(c.noFlete)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs font-semibold" style={{ color: c.total == null ? undefined : "#047857" }}>{money(c.total)}</td>
                  <td className="px-3 py-1.5 text-xs">
                    {c.payer
                      ? <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.payer === "KeHe FOB" ? "bg-orange-50 text-orange-700" : "bg-blue-50 text-blue-700"}`}>{c.payer}</span>
                      : <span className="text-muted-foreground/70">—</span>}
                  </td>
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr className="text-xs font-semibold text-white" style={{ backgroundColor: NAVY }}>
              <td className="px-3 py-2" colSpan={6}>Total ({rows.length} POs)</td>
              <td className="px-3 py-2 text-right font-mono">{k.cases.toLocaleString()}</td>
              <td />
              <td className="px-3 py-2 text-right font-mono">{money(k.flete)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(k.noFlete)}</td>
              <td className="px-3 py-2 text-right font-mono">{money(k.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── b) Rate Cards ────────────────────────────────────────────────────────────
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-bold" style={{ color: NAVY }}>{title}</h3>
      {subtitle && <p className="mb-3 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-2 overflow-x-auto">{children}</div>
    </section>
  );
}

function RateCards({ book, orders, reload }: { book: RateBook; orders: Order[]; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  async function save<T extends "logistics_dc_mapping" | "logistics_lineage_tariff" | "logistics_lineage_surcharges" | "logistics_kehe_rate" | "logistics_accessorial_rates">(
    table: T, id: string, patch: Record<string, unknown>,
  ) {
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from(table) as any).update(patch).eq("id", id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Saved");
    await reload();
  }

  const unmapped = useMemo(() => {
    const known = new Set(book.mapping.map(m => norm(m.raw_customer_name)));
    const counts = new Map<string, { n: number; last: string }>();
    for (const o of orders) {
      if (o.distributor === "Direct" || o.distributor === "Other") continue;
      const key = (o.customer ?? "").trim();
      if (!key || known.has(norm(key))) continue;
      const prev = counts.get(key) ?? { n: 0, last: "" };
      const d = o.po_date ?? "";
      counts.set(key, { n: prev.n + 1, last: d > prev.last ? d : prev.last });
    }
    // Only ask to map customers with at least one PO from 2025 onward.
    return [...counts.entries()]
      .filter(([, v]) => v.last.slice(0, 4) >= "2025")
      .map(([raw, v]) => [raw, v.n] as [string, number])
      .sort((a, b) => b[1] - a[1]);
  }, [book.mapping, orders]);

  const dcOptions = useMemo(() => [
    ...book.tariffs.map(t => ({ dc: t.canonical_dc, payer: "Lineage" })),
    ...book.kehe.map(k => ({ dc: k.canonical_dc, payer: "KeHe FOB" })),
  ], [book.tariffs, book.kehe]);

  async function addMapping(raw: string, choice: string) {
    const dc = choice === "__none" ? "" : choice;
    const payer = dcOptions.find(o => o.dc === dc)?.payer ?? null;
    setBusy(true);
    const { error } = await supabase.from("logistics_dc_mapping")
      .insert({ raw_customer_name: raw, canonical_dc: dc || null, quien_cobra_flete: dc ? payer : null });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Mapped");
    await reload();
  }

  const sur = book.surcharges;
  const acc = book.accessorial;

  return (
    <div className="grid gap-4">
      {busy && <p className="text-xs text-muted-foreground">Saving…</p>}

      <Card title="Pendientes de mapear" subtitle="Customers in customer_orders with no row in the DC mapping table.">
        {unmapped.length === 0 ? <p className="text-xs text-muted-foreground">Everything is mapped 🎉</p> : (
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Customer (raw)</th><th className="px-3 py-2 text-right">POs</th><th className="px-3 py-2 text-left">Assign DC</th>
            </tr></thead>
            <tbody>
              {unmapped.map(([raw, n]) => (
                <tr key={raw} className="border-t border-border/70">
                  <td className="px-3 py-1.5 text-xs">{raw}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{n}</td>
                  <td className="px-3 py-1.5">
                    <select defaultValue="" onChange={e => { if (e.target.value !== "") void addMapping(raw, e.target.value); }}
                      className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                      <option value="">Select…</option>
                      <option value="__none">Excluir (Sin DC)</option>
                      {dcOptions.map(o => <option key={o.dc} value={o.dc}>{o.dc} · {o.payer}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="DC mapping" subtitle="Raw customer name → canonical DC + who charges the freight.">
        <table className="w-full min-w-max text-sm">
          <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2 text-left">Raw customer</th><th className="px-3 py-2 text-left">Canonical DC</th><th className="px-3 py-2 text-left">Freight payer</th><th />
          </tr></thead>
          <tbody>
            {book.mapping.map(m => (
              <tr key={m.id} className="border-t border-border/70">
                <td className="px-3 py-1.5 text-xs">{m.raw_customer_name}</td>
                <td className="px-3 py-1.5">
                  <select value={m.canonical_dc ?? ""}
                    onChange={e => void save("logistics_dc_mapping", m.id, {
                      canonical_dc: e.target.value || null,
                      quien_cobra_flete: e.target.value ? (dcOptions.find(o => o.dc === e.target.value)?.payer ?? null) : null,
                    })}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                    <option value="">Sin DC identificado</option>
                    {dcOptions.map(o => <option key={o.dc} value={o.dc}>{o.dc}</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-xs">{m.quien_cobra_flete ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <button className="text-xs text-muted-foreground underline hover:text-destructive"
                    onClick={async () => {
                      const { error } = await supabase.from("logistics_dc_mapping").delete().eq("id", m.id);
                      if (error) toast.error(error.message); else { toast.success("Deleted"); await reload(); }
                    }}>delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Lineage tariff" subtitle="Base freight per pallet count (no surcharges). Editable.">
        <table className="w-full min-w-max text-sm">
          <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2 text-left">DC</th><th className="px-2 py-2">ST</th>
            {PALLET_COLS.map(c => <th key={c} className="px-2 py-2 text-right">{c.replace("plt_", "")} plt</th>)}
            <th className="px-2 py-2 text-left">Confianza</th>
          </tr></thead>
          <tbody>
            {book.tariffs.map(t => (
              <tr key={t.id} className="border-t border-border/70">
                <td className="px-3 py-1.5 text-xs font-medium">{t.canonical_dc}</td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">{t.state}</td>
                {PALLET_COLS.map(c => (
                  <td key={c} className="px-1 py-1">
                    <NumInput width="w-20" value={(t as unknown as Record<string, number>)[c]}
                      onSave={v => void save("logistics_lineage_tariff", t.id, { [c]: v })} />
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  <select value={t.confianza} onChange={e => void save("logistics_lineage_tariff", t.id, { confianza: e.target.value })}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs">
                    <option>Real</option><option>Estimado</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Lineage surcharges" subtitle="Only applied to shipments where Lineage charges the freight.">
        {sur && (
          <div className="flex flex-wrap gap-6">
            {([
              ["fuel_surcharge_pct", "Fuel surcharge (0-1)"],
              ["detention_expected", "Detention expected ($)"],
              ["lumper_expected", "Lumper expected ($)"],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-xs text-muted-foreground">
                <span className="mb-1 block font-semibold uppercase tracking-wide">{label}</span>
                <NumInput value={sur[key] as number} onSave={v => void save("logistics_lineage_surcharges", sur.id, { [key]: v })} />
              </label>
            ))}
          </div>
        )}
      </Card>

      <Card title="KeHe FOB rates" subtitle="Real cost per lb by DC.">
        <table className="w-full max-w-md text-sm">
          <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
            <th className="px-3 py-2 text-left">DC</th><th className="px-3 py-2 text-right">Cost / lb</th>
          </tr></thead>
          <tbody>
            {book.kehe.map(k => (
              <tr key={k.id} className="border-t border-border/70">
                <td className="px-3 py-1.5 text-xs">{k.canonical_dc}</td>
                <td className="px-3 py-1 text-right">
                  <NumInput value={k.cost_per_lb} onSave={v => void save("logistics_kehe_rate", k.id, { cost_per_lb: v })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Accessorial rates" subtitle="Charged by Lineage on every shipment, regardless of who pays the freight.">
        {acc && (
          <div className="flex flex-wrap gap-6">
            {([
              ["bol_per_shipment", "BOL / shipment"],
              ["loading_per_pallet", "Loading / pallet"],
              ["case_picking_per_case", "Case picking / case"],
              ["cases_per_pallet", "Cases / pallet"],
              ["assumed_lb_per_case", "Assumed lb / case"],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-xs text-muted-foreground">
                <span className="mb-1 block font-semibold uppercase tracking-wide">{label}</span>
                <NumInput value={acc[key] as number} onSave={v => void save("logistics_accessorial_rates", acc.id, { [key]: v })} />
              </label>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── c) Dashboard ─────────────────────────────────────────────────────────────
function DashboardView({ priced }: { priced: Priced[] }) {
  const costed = useMemo(() => priced.filter(p => p.cost.total != null), [priced]);

  const kpis = useMemo(() => {
    const cases = costed.reduce((s, r) => s + r.cost.totalCases, 0);
    const spend = costed.reduce((s, r) => s + (r.cost.total ?? 0), 0);
    return { pos: costed.length, cases, avgCases: costed.length ? cases / costed.length : 0, spend };
  }, [costed]);

  const topCases = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of costed) m.set(r.cost.totalCases, (m.get(r.cost.totalCases) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([cases, count]) => ({ cases: String(cases), count }));
  }, [costed]);

  const byMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of costed) {
      const key = (r.order.po_date ?? "").slice(0, 7);
      if (!key) continue;
      m.set(key, (m.get(key) ?? 0) + (r.cost.total ?? 0));
    }
    return [...m.entries()].sort().map(([month, spend]) => ({ month, spend: Math.round(spend) }));
  }, [costed]);

  const byYear = useMemo(() => {
    const m = new Map<string, { spend: number; cases: number; pallets: number; pos: number }>();
    for (const r of costed) {
      const y = (r.order.po_date ?? "").slice(0, 4) || "—";
      const cur = m.get(y) ?? { spend: 0, cases: 0, pallets: 0, pos: 0 };
      cur.spend += r.cost.total ?? 0; cur.cases += r.cost.totalCases; cur.pallets += r.cost.pallets ?? 0; cur.pos += 1;
      m.set(y, cur);
    }
    return [...m.entries()].sort().map(([year, v]) => ({
      year, ...v,
      perPallet: v.pallets ? v.spend / v.pallets : 0,
      perCase: v.cases ? v.spend / v.cases : 0,
    }));
  }, [costed]);

  const byDistYear = useMemo(() => {
    const m = new Map<string, { dist: string; year: string; spend: number; cases: number; pos: number }>();
    for (const r of costed) {
      const y = (r.order.po_date ?? "").slice(0, 4) || "—";
      const key = `${r.order.distributor}|${y}`;
      const cur = m.get(key) ?? { dist: r.order.distributor, year: y, spend: 0, cases: 0, pos: 0 };
      cur.spend += r.cost.total ?? 0; cur.cases += r.cost.totalCases; cur.pos += 1;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => a.year.localeCompare(b.year) || a.dist.localeCompare(b.dist));
  }, [costed]);

  const distChart = useMemo(() => {
    const years = [...new Set(byDistYear.map(r => r.year))].sort();
    const dists = [...new Set(byDistYear.map(r => r.dist))];
    return {
      years,
      data: dists.map(d => {
        const row: Record<string, string | number> = { dist: d };
        for (const y of years) row[y] = Math.round(byDistYear.find(r => r.dist === d && r.year === y)?.spend ?? 0);
        return row;
      }),
    };
  }, [byDistYear]);

  const perCaseByDist = useMemo(() => {
    const m = new Map<string, { spend: number; cases: number }>();
    for (const r of costed) {
      const cur = m.get(r.order.distributor) ?? { spend: 0, cases: 0 };
      cur.spend += r.cost.total ?? 0; cur.cases += r.cost.totalCases;
      m.set(r.order.distributor, cur);
    }
    return [...m.entries()].map(([dist, v]) => ({ dist, perCase: v.cases ? v.spend / v.cases : 0 }));
  }, [costed]);

  const YEAR_COLORS = [BURGUNDY, NAVY, "#0E9F6E", GRAY];

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="POs costed" value={kpis.pos.toLocaleString()} />
        <Kpi label="Total cases" value={kpis.cases.toLocaleString()} />
        <Kpi label="Avg cases / PO" value={kpis.avgCases.toFixed(0)} />
        <Kpi label="Logistics spend" value={money(kpis.spend)} color={BURGUNDY} />
      </div>

      <Card title="Most repeated case quantities">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCases}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="cases" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill={BURGUNDY} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="h-fit w-full text-sm">
            <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Cases</th><th className="px-3 py-2 text-right">POs</th>
            </tr></thead>
            <tbody>{topCases.map(r => (
              <tr key={r.cases} className="border-t border-border/70">
                <td className="px-3 py-1.5 font-mono text-xs">{r.cases}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{r.count}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      <Card title="Logistics spend by month">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Bar dataKey="spend" fill={NAVY} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card title="Spend by distributor and year">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distChart.data}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dist" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {distChart.years.map((y, i) => (
                  <Bar key={y} dataKey={y} fill={YEAR_COLORS[i % YEAR_COLORS.length]} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="h-fit w-full text-sm">
            <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Year</th><th className="px-3 py-2 text-left">Distributor</th>
              <th className="px-3 py-2 text-right">POs</th><th className="px-3 py-2 text-right">Cases</th><th className="px-3 py-2 text-right">Spend</th>
            </tr></thead>
            <tbody>{byDistYear.map(r => (
              <tr key={`${r.dist}${r.year}`} className="border-t border-border/70">
                <td className="px-3 py-1.5 text-xs">{r.year}</td>
                <td className="px-3 py-1.5 text-xs">{r.dist}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{r.pos}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{r.cases.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{money(r.spend)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Average cost per pallet / per case by year">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/60 text-[11px] uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Year</th><th className="px-3 py-2 text-right">Pallets</th>
              <th className="px-3 py-2 text-right">$ / pallet</th><th className="px-3 py-2 text-right">$ / case</th>
            </tr></thead>
            <tbody>{byYear.map(r => (
              <tr key={r.year} className="border-t border-border/70">
                <td className="px-3 py-1.5 text-xs">{r.year}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{r.pallets.toLocaleString()}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{money2(r.perPallet)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-xs">{money2(r.perCase)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>

        <Card title="Average cost per case by distributor">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perCaseByDist}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="dist" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => money2(v)} />
                <Bar dataKey="perCase" radius={[4, 4, 0, 0]}>
                  {perCaseByDist.map((_, i) => <Cell key={i} fill={i % 2 ? NAVY : BURGUNDY} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

export type { DcMapping, LineageTariff, Surcharges, KeheRate, Accessorial };
