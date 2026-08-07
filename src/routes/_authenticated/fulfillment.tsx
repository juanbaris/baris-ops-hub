import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import LogisticsTab from "@/components/logistics/logistics-tab";

type Order = Database["public"]["Tables"]["customer_orders"]["Row"];
type Distributor = Database["public"]["Enums"]["distributor"];
type Status = Database["public"]["Enums"]["order_status"];

const DISTRIBUTORS: Distributor[] = ["UNFI", "KeHe", "Rainforest", "RFD", "Direct", "Other"];
const STATUSES: Status[] = ["Open", "Accepted", "Sent to 3PL", "Shipment", "BOL Confirmed", "Invoiced"];
const SKU_ITEMS = [
  { key: "wm_cases" as const, label: "W&M", item: "93562" },
  { key: "wd_cases" as const, label: "W&D", item: "23141" },
  { key: "xd_cases" as const, label: "XD", item: "88021" },
  { key: "pw_cases" as const, label: "P&W", item: "77670" },
  { key: "hm_cases" as const, label: "H&M", item: "77671" },
  { key: "matcha_cases" as const, label: "Matcha", item: "77672" },
];

type DateFilter = "all" | "this_month" | "last_month" | "quarter" | "this_year" | "last_year" | "custom";
type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
type Tab = "pipeline" | "tasks" | "collections" | "logistics";
type DateField = "po_date" | "ship_est_date" | "invoice_date";

function ymd(d: Date) { return d.toISOString().slice(0, 10); }

function computeRange(filter: DateFilter, quarter: Quarter, from: string, to: string) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = (yr: number, mo: number) => ymd(new Date(yr, mo, 1));
  const endOfMonth = (yr: number, mo: number) => ymd(new Date(yr, mo + 1, 0));
  switch (filter) {
    case "all": return { from: null, to: null };
    case "this_month": return { from: start(y, m), to: endOfMonth(y, m) };
    case "last_month": { const lm = m === 0 ? 11 : m - 1; const ly = m === 0 ? y - 1 : y; return { from: start(ly, lm), to: endOfMonth(ly, lm) }; }
    case "quarter": { const qStart = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 }[quarter]; return { from: start(y, qStart), to: endOfMonth(y, qStart + 2) }; }
    case "this_year": return { from: start(y, 0), to: endOfMonth(y, 11) };
    case "last_year": return { from: start(y - 1, 0), to: endOfMonth(y - 1, 11) };
    case "custom": return { from: from || null, to: to || null };
  }
}

const STATUS_STYLES: Record<string, string> = {
  Open:           "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  Accepted:       "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
  Acknowledged:   "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
  "Sent to 3PL":  "bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-200",
  Shipment:       "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  "BOL Confirmed":"bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200",
  Invoiced:       "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
};

// ─── Status cell ──────────────────────────────────────────────────────────────
function StatusCell({ order, onChanged }: { order: Order; onChanged: (o: Order) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function changeTo(newStatus: Status) {
    if (newStatus === order.status) { setOpen(false); return; }
    setSaving(true); setOpen(false);
    const oldStatus = order.status;
    const patch: Database["public"]["Tables"]["customer_orders"]["Update"] = { status: newStatus };
    if (newStatus === "Invoiced" && !order.invoice_date) {
      patch.invoice_date = new Date().toISOString().slice(0, 10);
    }
    const { data, error } = await supabase.from("customer_orders").update(patch).eq("id", order.id).select().single();
    if (error || !data) { setSaving(false); toast.error(error?.message ?? "Failed"); return; }

    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      table_name: "customer_orders", record_id: order.id, action: "status_change",
      user_id: userData.user?.id ?? null,
      old_data: { field: "status", old_value: oldStatus },
      new_data: { field: "status", new_value: newStatus },
    });
    onChanged(data); setSaving(false);
    toast.success(`Status → ${newStatus}${newStatus === "Invoiced" ? " · invoice date set to today" : ""}`);
  }

  return (
    <div className="relative inline-block">
      <button type="button" disabled={saving} onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[order.status]} cursor-pointer hover:brightness-95`}>
        {saving ? "…" : order.status}<span>▾</span>
      </button>
      {open && (
        <><div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-border bg-popover p-1 shadow-lg">
            {STATUSES.map(s => (
              <button key={s} type="button"
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium hover:bg-muted ${s === order.status ? "opacity-40 cursor-default" : ""}`}
                onClick={() => changeTo(s)}>
                <span className={`inline-block w-2 h-2 rounded-full ${s === "Open" ? "bg-blue-400" : s === "Accepted" || s === "Acknowledged" ? "bg-orange-400" : s === "Sent to 3PL" ? "bg-yellow-400" : s === "Shipment" ? "bg-emerald-400" : s === "BOL Confirmed" ? "bg-teal-400" : "bg-purple-400"}`} />
                {s}{s === order.status ? " ✓" : ""}
              </button>
            ))}
          </div></>
      )}
    </div>
  );
}

// ─── PO Detail Modal ──────────────────────────────────────────────────────────
function PODetailModal({ order, onClose, onUpdated, onDelete }: {
  order: Order; onClose: () => void; onUpdated: (o: Order) => void; onDelete: (id: string) => void;
}) {
  const [notes, setNotes] = useState(order.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [files, setFiles] = useState<{ name: string; url: string; created_at: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showPS, setShowPS] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const steps: string[] = ["Open", "Accepted", "Sent to 3PL", "Shipment", "BOL Confirmed", "Invoiced"];
  const currentIdx = steps.indexOf(order.status);

  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editData, setEditData] = useState({
    po_date: order.po_date ?? "",
    ship_est_date: order.ship_est_date ?? "",
    invoice_date: order.invoice_date ?? "",
    customer: order.customer ?? "",
    distributor: order.distributor as Distributor,
    wm_cases: String(order.wm_cases ?? ""),
    wd_cases: String(order.wd_cases ?? ""),
    xd_cases: String(order.xd_cases ?? ""),
    pw_cases: String(order.pw_cases ?? ""),
    hm_cases: String(order.hm_cases ?? ""),
    matcha_cases: String(order.matcha_cases ?? ""),
    case_value: String((order as any).case_value ?? ""),
    gross_sales: String(order.gross_sales ?? ""),
    promo_discount: String(order.promo_discount ?? ""),
  });

  // Auto-recalculate gross = total × case_value whenever SKU qty or case_value changes
  function recalcEdit(data: typeof editData, changedKey?: string): typeof editData {
    const cv = parseFloat(data.case_value) || 0;
    if (cv <= 0) return data;
    const total = SKU_ITEMS.reduce((s, sk) => s + (parseInt(data[sk.key as keyof typeof data] as string) || 0), 0);
    const gross = total * cv;
    return { ...data, gross_sales: gross > 0 ? gross.toFixed(2) : data.gross_sales };
  }

  useEffect(() => {
    if (!editing) {
      setEditData({
        po_date: order.po_date ?? "",
        ship_est_date: order.ship_est_date ?? "",
        invoice_date: order.invoice_date ?? "",
        customer: order.customer ?? "",
        distributor: order.distributor as Distributor,
        wm_cases: String(order.wm_cases ?? ""),
        wd_cases: String(order.wd_cases ?? ""),
        xd_cases: String(order.xd_cases ?? ""),
        pw_cases: String(order.pw_cases ?? ""),
        hm_cases: String(order.hm_cases ?? ""),
        matcha_cases: String(order.matcha_cases ?? ""),
        case_value: String((order as any).case_value ?? ""),
        gross_sales: String(order.gross_sales ?? ""),
        promo_discount: String(order.promo_discount ?? ""),
      });
    }
  }, [order, editing]);

  useEffect(() => { loadFiles(); }, [order.id]);

  async function loadFiles() {
    const { data, error } = await supabase.storage.from("po-attachments").list(`${order.po_number}/`);
    if (error || !data || data.length === 0) { setFiles([]); return; }
    const withUrls = await Promise.all(data.map(async f => {
      const { data: urlData } = await supabase.storage.from("po-attachments").createSignedUrl(`${order.po_number}/${f.name}`, 3600);
      return { name: f.name, url: urlData?.signedUrl ?? "", created_at: f.created_at ?? "" };
    }));
    setFiles(withUrls.filter(f => f.url !== ""));
  }

  async function uploadFile(file: File) {
    setUploading(true);
    const path = `${order.po_number}/${file.name}`;
    const { error } = await supabase.storage.from("po-attachments").upload(path, file, { upsert: true });
    if (error) {
      toast.error(`Upload failed: ${error.message}`);
    } else {
      toast.success("File uploaded ✓");
      await loadFiles();
    }
    setUploading(false);
  }

  async function deleteFile(name: string) {
    await supabase.storage.from("po-attachments").remove([`${order.po_number}/${name}`]);
    toast.success("File removed");
    await loadFiles();
  }

  async function saveNotes() {
    setSaving(true);
    const { data, error } = await supabase.from("customer_orders").update({ notes }).eq("id", order.id).select().single();
    setSaving(false);
    if (error || !data) { toast.error("Failed to save notes"); return; }
    onUpdated(data); toast.success("Notes saved");
  }

  async function saveEdit() {
    setEditSaving(true);
    const gross = parseFloat(editData.gross_sales) || 0;
    const promo = parseFloat(editData.promo_discount) || 0;
    const cv = parseFloat(editData.case_value) || null;
    const payload = {
      po_date: editData.po_date || null,
      ship_est_date: editData.ship_est_date || null,
      invoice_date: editData.invoice_date || null,
      customer: editData.customer,
      distributor: editData.distributor,
      wm_cases: parseInt(editData.wm_cases) || 0,
      wd_cases: parseInt(editData.wd_cases) || 0,
      xd_cases: parseInt(editData.xd_cases) || 0,
      pw_cases: parseInt(editData.pw_cases) || 0,
      hm_cases: parseInt(editData.hm_cases) || 0,
      matcha_cases: parseInt(editData.matcha_cases) || 0,
      case_value: cv,
      gross_sales: gross || null,
      promo_discount: promo || null,
      net_sales: gross > 0 ? gross - promo : null,
    } as any;
    const { data, error } = await supabase.from("customer_orders").update(payload).eq("id", order.id).select().single();
    setEditSaving(false);
    if (error || !data) { toast.error("Failed to save changes"); return; }
    onUpdated(data);
    toast.success("Order updated");
    setEditing(false);
  }

  async function deletePO() {
    if (!confirm(`Delete PO #${order.po_number}? This cannot be undone.`)) return;
    setDeleting(true);
    const { error } = await supabase.from("customer_orders").delete().eq("id", order.id);
    if (error) { toast.error("Failed to delete: " + error.message); setDeleting(false); return; }
    toast.success(`PO #${order.po_number} deleted`);
    onDelete(order.id);
    onClose();
  }

  const totalCases = SKU_ITEMS.reduce((s, sk) => s + (Number(order[sk.key]) || 0), 0);

  async function markInvoiced() {
    setShowInvoice(true);
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.from("customer_orders")
      .update({ status: "Invoiced" as Status, invoice_date: order.invoice_date ?? today })
      .eq("id", order.id).select().single();
    setShowInvoice(false);
    if (error || !data) { toast.error(error?.message ?? "Failed to mark as invoiced"); return; }
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      table_name: "customer_orders", record_id: order.id, action: "status_change",
      user_id: userData.user?.id ?? null,
      old_data: { field: "status", old_value: order.status },
      new_data: { field: "status", new_value: "Invoiced" },
    });
    onUpdated(data);
    toast.success(`PO #${order.po_number} marked as Invoiced`);
  }

  const fillRate = order.fill_rate != null ? Number(order.fill_rate) : null;
  const fillRateColor = fillRate == null ? "" : fillRate >= 99 ? "text-emerald-600" : fillRate >= 90 ? "text-orange-500" : "text-red-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-2xl bg-card shadow-2xl ring-1 ring-black/10 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground text-lg">✕</button>
        <div className="p-6">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-lg font-bold" style={{ color: "#1C2340" }}>PO #{order.po_number}</h2>
            <div className="flex gap-2 mr-8">
              <button onClick={() => setEditing(e => !e)}
                className={`rounded-lg px-3 py-1 text-xs font-semibold border ${editing ? "bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100" : "border-border hover:bg-muted"}`}>
                {editing ? "✕ Cancel" : "✏️ Edit"}
              </button>
              <button onClick={() => setShowPS(true)}
                className="rounded-lg px-3 py-1 text-xs font-semibold border border-border hover:bg-muted">
                📋 Packing Slip
              </button>
              {order.status === "BOL Confirmed" && (
                <button onClick={markInvoiced} disabled={showInvoice}
                  className="rounded-lg px-3 py-1 text-xs font-semibold text-white"
                  style={{ backgroundColor: "#1C2340" }}>
                  {showInvoice ? "Saving…" : "📄 Mark as Invoiced"}
                </button>
              )}
              <button onClick={deletePO} disabled={deleting}
                className="rounded-lg px-3 py-1 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete PO"}
              </button>
            </div>
          </div>
          {editing ? (
            <div className="flex flex-wrap gap-3 mb-5">
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">Distributor</label>
                <select value={editData.distributor}
                  onChange={e => setEditData(d => ({ ...d, distributor: e.target.value as Distributor }))}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400">
                  {DISTRIBUTORS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-0.5 flex-1 min-w-[140px]">
                <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">Customer</label>
                <input type="text" value={editData.customer}
                  onChange={e => setEditData(d => ({ ...d, customer: e.target.value }))}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">PO Date</label>
                <input type="date" value={editData.po_date}
                  onChange={e => setEditData(d => ({ ...d, po_date: e.target.value }))}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">Ship Date</label>
                <input type="date" value={editData.ship_est_date}
                  onChange={e => setEditData(d => ({ ...d, ship_est_date: e.target.value }))}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
              <div className="flex flex-col gap-0.5">
                <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">Invoice Date</label>
                <input type="date" value={editData.invoice_date}
                  onChange={e => setEditData(d => ({ ...d, invoice_date: e.target.value }))}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-5">
              {order.distributor} · {order.customer} · PO Date: {order.po_date ?? "—"}
              {order.ship_est_date && <> · Ship: {order.ship_est_date}</>}
              {order.invoice_date && <> · Invoice: {order.invoice_date}</>}
            </p>
          )}

          {/* Timeline */}
          <div className="flex items-center gap-0 mb-6">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i <= currentIdx ? "text-white" : "bg-muted text-muted-foreground"}`}
                    style={i <= currentIdx ? { backgroundColor: "#1C2340" } : {}}>
                    {i <= currentIdx ? "✓" : i + 1}
                  </div>
                  <span className="text-[10px] mt-1 text-muted-foreground text-center">{s}</span>
                </div>
                {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-1 mb-4 ${i < currentIdx ? "" : "bg-muted"}`}
                  style={i < currentIdx ? { backgroundColor: "#1C2340" } : {}} />}
              </div>
            ))}
          </div>

          {/* Quantities + Financials */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            <div className={`rounded-xl border p-4 ${editing ? "border-amber-300 bg-amber-50/40" : "border-border"}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">PO Quantities</p>
              {editing ? (
                <>
                  {SKU_ITEMS.map(sk => (
                    <div key={sk.key} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-xs text-muted-foreground w-20">{sk.label}</span>
                      <input type="number" min="0"
                        value={editData[sk.key]}
                        onChange={e => setEditData(d => recalcEdit({ ...d, [sk.key]: e.target.value }))}
                        className="w-24 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-mono text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                    </div>
                  ))}
                  <div className="flex justify-between text-sm py-0.5 mt-1 border-t border-amber-200 pt-1">
                    <span className="font-semibold">Total</span>
                    <span className="font-mono font-bold">
                      {SKU_ITEMS.reduce((s, sk) => s + (parseInt(editData[sk.key]) || 0), 0).toLocaleString()} cases
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {SKU_ITEMS.filter(sk => Number(order[sk.key]) > 0).map(sk => (
                    <div key={sk.key} className="flex justify-between text-sm py-0.5">
                      <span className="text-muted-foreground">{sk.label} ({sk.item})</span>
                      <span className="font-mono font-semibold">{Number(order[sk.key]).toLocaleString()}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-sm py-0.5 mt-1 border-t border-border pt-1">
                    <span className="font-semibold">Total</span>
                    <span className="font-mono font-bold">{totalCases.toLocaleString()} cases</span>
                  </div>
                  {fillRate != null && (
                    <div className={`flex justify-between text-sm py-0.5 mt-1 border-t border-border pt-1 ${fillRateColor}`}>
                      <span className="font-semibold">Fill Rate</span>
                      <span className="font-mono font-bold">{fillRate.toFixed(1)}%</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className={`rounded-xl border p-4 ${editing ? "border-amber-300 bg-amber-50/40" : "border-border"}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Financials</p>
              {editing ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <div>
                      <label className="text-[9px] uppercase tracking-wide text-muted-foreground">$/case (precio unitario)</label>
                      <input type="number" min="0" step="0.01"
                        value={editData.case_value}
                        onChange={e => setEditData(d => recalcEdit({ ...d, case_value: e.target.value }))}
                        className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-400"
                        placeholder="36.96" />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                        Gross Sales ($)
                        {editData.case_value && <span className="text-amber-600 font-semibold">= total × ${parseFloat(editData.case_value).toFixed(2)}</span>}
                      </label>
                      <input type="number" min="0" step="0.01"
                        value={editData.gross_sales}
                        onChange={e => setEditData(d => ({ ...d, gross_sales: e.target.value }))}
                        className={`w-full rounded border px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-400 ${editData.case_value ? "border-amber-200 bg-amber-50/50 text-amber-900" : "border-amber-300 bg-white"}`} />
                    </div>
                    <div>
                      <label className="text-[9px] uppercase tracking-wide text-muted-foreground">Allowance ($)</label>
                      <input type="number" min="0" step="0.01"
                        value={editData.promo_discount}
                        onChange={e => setEditData(d => ({ ...d, promo_discount: e.target.value }))}
                        className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-400" />
                    </div>
                    <div className="flex justify-between text-sm border-t border-amber-200 pt-1 mt-0.5">
                      <span className="font-semibold">Net Sales</span>
                      <span className="font-mono font-bold text-emerald-600">
                        ${Math.max(0, (parseFloat(editData.gross_sales) || 0) - (parseFloat(editData.promo_discount) || 0)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {(order as any).case_value != null && (
                    <div className="flex justify-between text-sm py-0.5">
                      <span className="text-muted-foreground">$/case</span>
                      <span className="font-mono">${Number((order as any).case_value).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm py-0.5">
                    <span className="text-muted-foreground">Gross Sales</span>
                    <span className="font-mono">${Math.round(Number(order.gross_sales) || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm py-0.5">
                    <span className="text-muted-foreground">Allowance</span>
                    <span className="font-mono text-destructive">-${Math.round(Number(order.promo_discount) || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm py-0.5 border-t border-border pt-1 mt-1">
                    <span className="font-semibold">Net Sales</span>
                    <span className="font-mono font-bold text-emerald-600">${Math.round(Number(order.net_sales) || 0).toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {editing && (
            <div className="mb-5">
              <button onClick={saveEdit} disabled={editSaving}
                className="w-full rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: "#A3224A" }}>
                {editSaving ? "Saving…" : "💾 Save Changes"}
              </button>
            </div>
          )}

          {/* File attachments */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Attachments ({files.length})
              </p>
              <div className="flex gap-2">
                {[
                  { label: "SPS PO", prefix: "SPS_PO" },
                  { label: "BOL", prefix: "BOL" },
                  { label: "Invoice", prefix: "INV" },
                ].map(({ label, prefix }) => (
                  <label key={label} className="rounded-lg px-2 py-1 text-[10px] font-semibold border border-border hover:bg-muted cursor-pointer">
                    + {label}
                    <input type="file" className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const ext = f.name.split(".").pop();
                        const renamed = new File([f], `${prefix}_${order.po_number}.${ext}`, { type: f.type });
                        uploadFile(renamed);
                      }} />
                  </label>
                ))}
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="rounded-lg px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "#1C2340" }}>
                  {uploading ? "…" : "+ Other"}
                </button>
                <input ref={fileRef} type="file" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
              </div>
            </div>

            {files.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center">
                <p className="text-xs text-muted-foreground">No attachments yet</p>
                <p className="text-[10px] text-muted-foreground mt-1">Upload: SPS PO · BARIS Packing Slip · BOL · Invoice</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {files.map(f => {
                  const nl = f.name.toLowerCase();
                  const isPS = nl.includes("baris_ps") || nl.includes("packing");
                  const isBOL = nl.includes("bol");
                  const isSPS = nl.includes("sps_po") || nl.includes("sps");
                  const isInvoice = nl.includes("inv_") || nl.includes("invoice");
                  const icon = isPS ? "📋" : isBOL ? "🚚" : isSPS ? "📥" : isInvoice ? "💰" : "📄";
                  const badge = isPS ? { label: "Packing Slip", color: "bg-purple-100 text-purple-700" }
                    : isBOL ? { label: "BOL", color: "bg-blue-100 text-blue-700" }
                    : isSPS ? { label: "SPS PO", color: "bg-orange-100 text-orange-700" }
                    : isInvoice ? { label: "Invoice", color: "bg-emerald-100 text-emerald-700" }
                    : { label: "File", color: "bg-muted text-muted-foreground" };
                  return (
                    <div key={f.name} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 hover:bg-muted/30">
                      <span className="text-base flex-shrink-0">{icon}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold flex-shrink-0 ${badge.color}`}>{badge.label}</span>
                      <span className="flex-1 text-xs font-medium truncate" title={f.name}>{f.name}</span>
                      <button
                        onClick={() => window.open(f.url, "_blank", "noopener,noreferrer")}
                        className="rounded px-2 py-0.5 text-[10px] font-semibold text-white flex-shrink-0" style={{ backgroundColor: "#1C2340" }}>
                        Open
                      </button>
                      <a href={f.url} download={f.name}
                        className="rounded px-2 py-0.5 text-[10px] font-semibold border border-border hover:bg-muted flex-shrink-0">
                        ↓
                      </a>
                      <button onClick={() => deleteFile(f.name)}
                        className="rounded px-2 py-0.5 text-[10px] font-semibold text-red-500 hover:bg-red-50 flex-shrink-0">
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Notes</label>
            <textarea className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal comments..." />
            <button onClick={saveNotes} disabled={saving}
              className="mt-2 rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: "#A3224A" }}>
              {saving ? "Saving…" : "Save Notes"}
            </button>
          </div>
        </div>
      </div>
      {showPS && <PackingSlipModal order={order} onClose={() => setShowPS(false)} onSaved={loadFiles} />}
    </div>
  );
}

// ─── Send to Lineage Modal ────────────────────────────────────────────────────
function LineageModal({ order, onClose, onSent }: { order: Order; onClose: () => void; onSent: (o: Order) => void }) {
  const isKehe = order.distributor === "KeHe";
  const to = "a6orders@onelineage.com";
  const cc = "pedro@everybaris.com,a6ship@onelineage.com,ltranssolutionseast@onelineage.com";
  const subject = `PO #${order.po_number} - ${order.customer}`;
  const body = isKehe
    ? `Hi team,\n\nPlease see attached a new order for ${order.customer}\nKeHe will do the pickup at Lineage (FOB). Please prepare the order accordingly.\n\nThanks!\nJuan`
    : `Hi team,\n\nPlease see attached a new order for ${order.customer}\nWe would need Lineage to make the delivery.\n\nThanks!\nJuan`;

  async function openMail() {
    const url = `mailto:${to}?cc=${cc}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(url, "_blank");
    const { data, error } = await supabase.from("customer_orders").update({ status: "Shipment" }).eq("id", order.id).select().single();
    if (!error && data) { onSent(data); toast.success("Status updated to Shipment"); }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-2xl bg-card shadow-2xl ring-1 ring-black/10 p-6" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">✕</button>
        <h2 className="text-base font-bold mb-1" style={{ color: "#1C2340" }}>Send to Lineage</h2>
        <p className="text-xs text-muted-foreground mb-4">PO #{order.po_number} · {order.customer}</p>
        <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm font-mono whitespace-pre-wrap mb-4 text-xs leading-relaxed">
          <div className="text-muted-foreground mb-1"><span className="font-semibold">To:</span> {to}</div>
          <div className="text-muted-foreground mb-1"><span className="font-semibold">CC:</span> {cc}</div>
          <div className="text-muted-foreground mb-3"><span className="font-semibold">Subject:</span> {subject}</div>
          <div className="text-foreground">{body}</div>
        </div>
        {isKehe && <div className="mb-3 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-700 font-medium">KeHe → FOB pickup at Lineage</div>}
        <div className="mb-3 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
          📋 Before sending, attach the <strong>BARIS Packing Slip</strong> — open the PO detail (click PO# in Pipeline), go to Attachments, and find <strong>BARIS_PS_{order.po_number}</strong>. Open it and attach to the email.
        </div>
        <button onClick={openMail} className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
          Open in Mail & Mark as Shipment
        </button>
      </div>
    </div>
  );
}

// ─── BOL Upload Modal ─────────────────────────────────────────────────────────
function BOLModal({ order, onClose, onConfirmed }: { order: Order; onClose: () => void; onConfirmed: (o: Order) => void }) {
  const [step, setStep] = useState<"upload" | "review" | "saving">("upload");
  const [bolCases, setBolCases] = useState<Record<string, number>>({});
  const [bolNumber, setBolNumber] = useState("");
  const [shipDate, setShipDate] = useState(new Date().toISOString().slice(0, 10));
  const [lots, setLots] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState(false);
  const [bolFile, setBolFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBolCases({
      wd: Number(order.wd_cases) || 0, pw: Number(order.pw_cases) || 0,
      hm: Number(order.hm_cases) || 0, matcha: Number(order.matcha_cases) || 0,
      xd: Number(order.xd_cases) || 0, wm: Number(order.wm_cases) || 0,
    });
  }, [order]);

  async function handleFile(file: File) {
    setProcessing(true);
    setBolFile(file);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
      });
      const mediaType = file.type || "application/pdf";
      const response = await fetch("/api/process-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType, mode: "bol" }),
      });
      if (response.ok) {
        const data = await response.json();
        setBolCases({
          wd: data.wd_cases ?? 0, pw: data.pw_cases ?? 0, hm: data.hm_cases ?? 0,
          matcha: data.matcha_cases ?? 0, xd: data.xd_cases ?? 0, wm: data.wm_cases ?? 0,
        });
        if (data.bol_number) setBolNumber(String(data.bol_number));
        if (data.ship_date && /^\d{4}-\d{2}-\d{2}$/.test(String(data.ship_date))) setShipDate(String(data.ship_date));
        const ln = data.lot_numbers ?? {};
        const single = Object.values(ln).find(v => typeof v === "string" && v.trim());
        setLots({
          wd: (ln.wd || single || "") as string, pw: (ln.pw || single || "") as string,
          hm: (ln.hm || single || "") as string, matcha: (ln.matcha || single || "") as string,
          xd: (ln.xd || single || "") as string, wm: (ln.wm || single || "") as string,
        });
        toast.success("BOL extracted — review quantities");
      } else {
        toast.error("Could not extract — review manually");
      }
    } catch {
      toast.error("Could not read BOL");
    }
    setProcessing(false);
    setStep("review");
  }

  function computeFillRate() {
    const poCases = SKU_ITEMS.reduce((s, sk) => s + (Number(order[sk.key]) || 0), 0);
    const bolTotal = Object.values(bolCases).reduce((s, v) => s + v, 0);
    if (poCases === 0) return 100;
    return Math.round((bolTotal / poCases) * 1000) / 10;
  }

  async function confirm() {
    setStep("saving");
    try {
      const today = new Date().toISOString().slice(0, 10);
      const fillRate = computeFillRate();
      const shipped = shipDate || today;

      const patch: Database["public"]["Tables"]["customer_orders"]["Update"] = {
        status: "BOL Confirmed",
        bol_number: bolNumber || null,
        bol_date: shipped,
        fill_rate: fillRate,
        wd_cases: bolCases.wd || order.wd_cases,
        pw_cases: bolCases.pw || order.pw_cases,
        hm_cases: bolCases.hm || order.hm_cases,
        matcha_cases: bolCases.matcha || order.matcha_cases,
        xd_cases: bolCases.xd || order.xd_cases,
        wm_cases: bolCases.wm || order.wm_cases,
      };
      const { data, error } = await supabase.from("customer_orders").update(patch).eq("id", order.id).select().single();
      if (error || !data) { toast.error(error?.message ?? "Failed to update order"); setStep("review"); return; }

      if (bolFile) {
        const ext = bolFile.name.includes(".") ? bolFile.name.slice(bolFile.name.lastIndexOf(".")) : "";
        const filename = `BOL_${(bolNumber || shipped).replace(/[^A-Za-z0-9_-]/g, "")}${ext}`;
        const { error: upErr } = await supabase.storage
          .from("po-attachments")
          .upload(`${order.po_number}/${filename}`, bolFile, { upsert: true, contentType: bolFile.type || undefined });
        if (upErr) toast.error(`BOL file not saved: ${upErr.message}`);
      }

      const lotKeyByField: Record<string, string> = { wd_cases: "wd", pw_cases: "pw", hm_cases: "hm", matcha_cases: "matcha", xd_cases: "xd", wm_cases: "wm" };
      const movements = SKU_ITEMS
        .filter(sk => Number(patch[sk.key]) > 0)
        .map(sk => ({
          movement_date: shipped,
          type: "Out" as const,
          sku: sk.label.replace("&", "").replace(" ", "") as Database["public"]["Enums"]["sku"],
          cases: Number(patch[sk.key]),
          warehouse: "Lineage Newark" as Database["public"]["Enums"]["warehouse"],
          lot_number: lots[lotKeyByField[sk.key]!]?.trim() || `BOL-${order.po_number}-${shipped}`,
          concept: "Sale" as Database["public"]["Enums"]["fp_concept"],
          po_number_ref: order.po_number,
          notes: `BOL ${bolNumber || "—"} · PO ${order.po_number} · Fill ${fillRate}%`,
        }));
      if (movements.length > 0) {
        const { error: fpErr } = await supabase.from("fp_movements").insert(movements);
        if (fpErr) toast.error(`FP error: ${fpErr.message}`);
      }

      try {
        const { data: userData } = await supabase.auth.getUser();
        await supabase.from("audit_log").insert({
          table_name: "customer_orders", record_id: order.id, action: "bol_confirmed",
          user_id: userData.user?.id ?? null,
          old_data: { status: order.status },
          new_data: { status: "BOL Confirmed", fill_rate: fillRate, bol_cases: bolCases, bol_number: bolNumber, bol_date: shipped },
        });
      } catch { /* audit log is best-effort */ }

      onConfirmed(data);
      toast.success(`BOL confirmed ✓ Fill rate: ${fillRate}%${fillRate < 100 ? " ⚠️" : ""}`);
      onClose();
    } catch (e) {
      toast.error(`Error: ${e instanceof Error ? e.message : "Unknown error"}`);
      setStep("review");
    }
  }

  const skuMap: [string, keyof typeof bolCases, keyof Order][] = [
    ["W&D", "wd", "wd_cases"], ["P&W", "pw", "pw_cases"], ["H&M", "hm", "hm_cases"],
    ["Matcha", "matcha", "matcha_cases"], ["XD", "xd", "xd_cases"], ["W&M", "wm", "wm_cases"],
  ];

  const fillRate = computeFillRate();
  const fillColor = fillRate >= 99 ? "text-emerald-600" : fillRate >= 90 ? "text-orange-500" : "text-red-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-lg rounded-2xl bg-card shadow-2xl ring-1 ring-black/10 p-6" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">✕</button>
        <h2 className="text-base font-bold mb-1" style={{ color: "#1C2340" }}>Upload BOL</h2>
        <p className="text-xs text-muted-foreground mb-4">PO #{order.po_number} · {order.customer}</p>

        {step === "upload" && (
          <div>
            <div onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30 py-10 cursor-pointer hover:bg-muted/50 transition">
              {processing ? <p className="text-sm text-muted-foreground">Analyzing BOL…</p> : (
                <><p className="text-2xl mb-2">📄</p>
                  <p className="text-sm font-medium">Click to upload BOL</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — or enter cases manually</p></>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <button onClick={() => setStep("review")}
              className="mt-3 w-full rounded-lg py-1.5 text-xs font-semibold border border-border hover:bg-muted">
              Enter cases manually →
            </button>
          </div>
        )}

        {step === "review" && (
          <div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">BOL Number</label>
                <input value={bolNumber} onChange={e => setBolNumber(e.target.value)} placeholder="A6-247427"
                  className="mt-0.5 w-full rounded-lg border border-border px-2 py-1 text-sm font-mono" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Ship Date</label>
                <input type="date" value={shipDate} onChange={e => setShipDate(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-border px-2 py-1 text-sm font-mono" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mb-3">BOL quantities — compare vs PO (shown in parentheses):</p>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {skuMap.map(([label, bolKey, orderKey]) => {
                const poQty = Number(order[orderKey]) || 0;
                const bolQty = bolCases[bolKey] ?? 0;
                const diff = bolQty - poQty;
                return (
                  <div key={bolKey}>
                    <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</label>
                    <div className="flex items-center gap-1 mt-0.5">
                      <input type="number" className={`w-full rounded-lg border px-2 py-1 text-sm font-mono ${diff < 0 ? "border-red-300 bg-red-50" : "border-border"}`}
                        value={bolQty} onChange={e => setBolCases(x => ({ ...x, [bolKey]: parseInt(e.target.value) || 0 }))} />
                    </div>
                    {poQty > 0 && (
                      <p className={`text-[10px] mt-0.5 ${diff < 0 ? "text-red-500 font-semibold" : "text-muted-foreground"}`}>
                        PO: {poQty}{diff < 0 ? ` (${diff})` : diff > 0 ? ` (+${diff})` : " ✓"}
                      </p>
                    )}
                    <input value={lots[bolKey] ?? ""} onChange={e => setLots(x => ({ ...x, [bolKey]: e.target.value }))}
                      placeholder="Lot #"
                      className="mt-1 w-full rounded-lg border border-border px-2 py-1 text-[11px] font-mono" />
                  </div>
                );
              })}
            </div>

            <div className={`rounded-xl border p-3 mb-4 flex items-center justify-between ${fillRate < 100 ? "border-orange-200 bg-orange-50" : "border-emerald-200 bg-emerald-50"}`}>
              <span className="text-xs font-semibold text-muted-foreground">Fill Rate</span>
              <span className={`text-lg font-bold font-mono ${fillColor}`}>{fillRate.toFixed(1)}%</span>
            </div>

            <button onClick={confirm} className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
              Confirm BOL → Set as BOL Confirmed
            </button>
          </div>
        )}
        {step === "saving" && <p className="text-center text-sm text-muted-foreground py-6">Saving…</p>}
      </div>
    </div>
  );
}

// ─── Generate Packing Slip HTML ───────────────────────────────────────────────
function generatePackingSlip(po: any): { html: string; filename: string } {
  const filename = `BARIS_PS_${po.po_number || "DRAFT"}.html`;
  const skus = [
    { label: "Rasp covered in pistachio & white", upc: "00860013776701", item: "77670", cases: Number(po.pw_cases) || 0, lbsPerCase: 3.16 },
    { label: "Rasp covered in hazelnut & milk",   upc: "00860013776718", item: "77671", cases: Number(po.hm_cases) || 0, lbsPerCase: 3.16 },
    { label: "Rasp in extra dark chocolate",       upc: "00860013788810", item: "88021", cases: Number(po.xd_cases) || 0, lbsPerCase: 3.37 },
    { label: "Rasp in white & dark chocolate",     upc: "00860013723141", item: "23141", cases: Number(po.wd_cases) || 0, lbsPerCase: 3.41 },
    { label: "Rasp in white & milk chocolate",     upc: "00860013793562", item: "93562", cases: Number(po.wm_cases) || 0, lbsPerCase: 3.41 },
    { label: "Rasp in matcha white chocolate",     upc: "00860013777672", item: "77672", cases: Number(po.matcha_cases) || 0, lbsPerCase: 3.16 },
  ].filter(s => s.cases > 0);

  const totalCases = skus.reduce((s, r) => s + r.cases, 0);
  const totalLbs = skus.reduce((s, r) => s + Math.round(r.cases * r.lbsPerCase), 0);

  const rows = skus.map(s => `
    <tr>
      <td>${s.label}</td>
      <td>${s.upc}</td>
      <td>${s.item}</td>
      <td style="text-align:right">${s.cases}</td>
      <td style="text-align:right">${Math.round(s.cases * s.lbsPerCase)}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Packing Slip ${po.po_number}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 0; padding: 30px 40px; font-size: 12px; color: #000; }
  .brand-header { background: #1C2340; color: white; padding: 14px 20px; margin: -30px -40px 20px; display: flex; align-items: center; justify-content: space-between; }
  .brand-header h1 { margin: 0; font-size: 22px; color: #A3224A; letter-spacing: 2px; }
  .brand-header p { margin: 0; font-size: 11px; color: #9CA3AF; }
  h2 { font-size: 13px; font-weight: bold; margin: 0 0 8px; color: #1C2340; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th { background: #1C2340; color: white; padding: 7px 10px; text-align: left; font-size: 11px; border: 1px solid #1C2340; }
  td { border: 1px solid #ccc; padding: 6px 10px; font-size: 11px; }
  .meta-table td { border: none; padding: 2px 8px 2px 0; }
  .meta-table td:first-child { font-weight: bold; color: #1C2340; width: 130px; }
  .divider { border: none; border-top: 2px solid #A3224A; margin: 14px 0; }
  .ship-table td { border: 1px solid #ccc; padding: 10px 12px; vertical-align: top; width: 50%; }
  .ship-table td strong { color: #1C2340; display: block; margin-bottom: 4px; font-size: 11px; letter-spacing: 0.5px; }
  .section-label { background: #1C2340; color: white; font-weight: bold; font-size: 11px; letter-spacing: 1px; padding: 5px 10px; margin-top: 14px; }
  .summary-table td { border: 1px solid #ccc; padding: 8px 12px; text-align: center; font-weight: bold; font-size: 13px; }
  .summary-table th { text-align: center; }
  .total-row td { background: #F5F0E8; font-weight: bold; }
  .sign-table td { border: none; padding: 8px 20px; vertical-align: bottom; font-size: 11px; width: 50%; }
  .sign-line { border-bottom: 1.5px solid #1C2340; margin-bottom: 5px; height: 30px; }
  .footer { margin-top: 20px; font-size: 9px; color: #aaa; text-align: right; }
  @media print { body { margin: 0; padding: 20px; } .brand-header { margin: -20px -20px 16px; } }
</style>
</head><body>
<div class="brand-header">
  <div><h1>BARIS</h1><p>Patagonia Bites Corp</p></div>
  <div style="text-align:right; color:#9CA3AF; font-size:11px">
    <div style="font-size:14px;font-weight:bold;color:white">Packing Slip</div>
    <div>PO # ${po.po_number || "—"}</div>
  </div>
</div>
<table class="meta-table" style="width:auto;margin-bottom:14px">
  <tr><td>PO DATE</td><td>${po.po_date || "—"}</td></tr>
  <tr><td>VENDOR #</td><td>PATAGONIA BITES CORP</td></tr>
  <tr><td>TEMPERATURE</td><td>Frozen (0°F)</td></tr>
  <tr><td>${po.distributor === "KeHe" ? "PICKUP DATE" : "DELIVERY DATE"}</td><td><strong>${po.ship_est_date || "TBD"}</strong></td></tr>
</table>
<hr class="divider">
<table class="ship-table"><tr>
  <td><strong>SHIP FROM</strong>LINEAGE NEWARK<br>360 Avenue P<br>Newark, NJ 07105</td>
  <td><strong>SHIP TO</strong>${po.customer || "—"}${po.ship_to_address ? `<br>${(po.ship_to_address as string).replace(/\n/g, "<br>")}` : ""}</td>
</tr></table>
<div class="section-label">LOAD</div>
<table class="summary-table" style="width:auto;margin-bottom:12px">
  <tr><th style="width:150px">Total Pallets</th><th style="width:150px">Total LBS</th><th style="width:150px">Total Cases</th></tr>
  <tr><td>${Math.ceil(totalCases / 255)}</td><td>${totalLbs}</td><td>${totalCases}</td></tr>
</table>
<table>
  <thead><tr>
    <th style="width:35%">Product</th><th>Case UPC</th><th>Item #</th>
    <th style="text-align:right;width:70px">Cases</th><th style="text-align:right;width:90px">Weight (LBS)</th>
  </tr></thead>
  <tbody>${rows}
    <tr class="total-row">
      <td colspan="3" style="text-align:right"><strong>TOTAL</strong></td>
      <td style="text-align:right;border:1px solid #ccc;padding:6px 10px"><strong>${totalCases}</strong></td>
      <td style="text-align:right;border:1px solid #ccc;padding:6px 10px"><strong>${totalLbs}</strong></td>
    </tr>
  </tbody>
</table>
<table class="sign-table" style="margin-top:35px;width:100%"><tr>
  <td><div class="sign-line"></div><strong>Shipper (Lineage Newark)</strong><br>Sign / Print / Date</td>
  <td><div class="sign-line"></div><strong>Carrier / Driver (${po.distributor || "Carrier"})</strong><br>Sign / Print / Date</td>
</tr></table>
<div class="footer">Generated by BARIS Ops Hub · ${new Date().toLocaleDateString()}</div>
</body></html>`;

  return { html, filename };
}

// ─── Packing Slip Editor Modal ────────────────────────────────────────────────
function PackingSlipModal({ order, onClose, onSaved }: {
  order: Order; onClose: () => void; onSaved: () => void;
}) {
  const [psData, setPsData] = useState({
    po_number: order.po_number,
    po_date: order.po_date ?? "",
    ship_est_date: order.ship_est_date ?? "",
    distributor: order.distributor,
    customer: order.customer,
    ship_to_address: (order as any).ship_to_address ?? "",
    pw_cases: String(order.pw_cases ?? 0),
    hm_cases: String(order.hm_cases ?? 0),
    xd_cases: String(order.xd_cases ?? 0),
    wd_cases: String(order.wd_cases ?? 0),
    wm_cases: String(order.wm_cases ?? 0),
    matcha_cases: String(order.matcha_cases ?? 0),
    upc_wd: "10197644231413",
    upc_pw: "10860013776708",
    upc_hm: "10860013776715",
    upc_matcha: "10860013776722",
    upc_xd: "10197644880215",
    upc_wm: "10197644935625",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [psHtml, setPsHtml] = useState<string | null>(null);
  const filename = `BARIS_PS_${order.po_number}.html`;

  async function generateFromServer() {
    setGenerating(true);
    try {
      const poJson = JSON.stringify({
        po_number: psData.po_number,
        po_date: psData.po_date,
        ship_date: psData.ship_est_date,
        distributor: psData.distributor,
        customer: psData.customer,
        ship_to_address: psData.ship_to_address,
        items: [
          ...(Number(psData.wd_cases)>0 ? [{ item_number:"23141", sku:"WD", cases:Number(psData.wd_cases), unit_price:36.96, weight_lbs:Math.round(Number(psData.wd_cases)*3.41) }] : []),
          ...(Number(psData.pw_cases)>0 ? [{ item_number:"77670", sku:"PW", cases:Number(psData.pw_cases), unit_price:36.96, weight_lbs:Math.round(Number(psData.pw_cases)*3.16) }] : []),
          ...(Number(psData.hm_cases)>0 ? [{ item_number:"77671", sku:"HM", cases:Number(psData.hm_cases), unit_price:36.96, weight_lbs:Math.round(Number(psData.hm_cases)*3.16) }] : []),
          ...(Number(psData.matcha_cases)>0 ? [{ item_number:"77672", sku:"Matcha", cases:Number(psData.matcha_cases), unit_price:36.96, weight_lbs:Math.round(Number(psData.matcha_cases)*3.16) }] : []),
          ...(Number(psData.xd_cases)>0 ? [{ item_number:"88021", sku:"XD", cases:Number(psData.xd_cases), unit_price:36.96, weight_lbs:Math.round(Number(psData.xd_cases)*3.37) }] : []),
          ...(Number(psData.wm_cases)>0 ? [{ item_number:"93562", sku:"WM", cases:Number(psData.wm_cases), unit_price:36.96, weight_lbs:Math.round(Number(psData.wm_cases)*3.41) }] : []),
        ],
        total_amount: 0, promo_discount_amount: 0, discount_percent: 0,
      });
      const base64 = btoa(unescape(encodeURIComponent(poJson)));
      const response = await fetch("/api/process-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType: "application/pdf", mode: "ps_only" }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.packing_slip_html) {
          const decoded = decodeURIComponent(escape(atob(data.packing_slip_html)));
          setPsHtml(decoded);
        }
      }
    } catch (e) {
      console.error("PS generation error:", e);
    }
    setGenerating(false);
  }

  function buildLocalHtml() {
    const items = [
      ...(Number(psData.wd_cases)>0 ? [{sku:"WD", item:"23141", label:"Rasp in white & dark chocolate", upc:psData.upc_wd, cases:Number(psData.wd_cases), lbs:Math.round(Number(psData.wd_cases)*3.41)}] : []),
      ...(Number(psData.pw_cases)>0 ? [{sku:"PW", item:"77670", label:"Rasp covered in pistachio & white", upc:psData.upc_pw, cases:Number(psData.pw_cases), lbs:Math.round(Number(psData.pw_cases)*3.16)}] : []),
      ...(Number(psData.hm_cases)>0 ? [{sku:"HM", item:"77671", label:"Rasp covered in hazelnut & milk", upc:psData.upc_hm, cases:Number(psData.hm_cases), lbs:Math.round(Number(psData.hm_cases)*3.16)}] : []),
      ...(Number(psData.matcha_cases)>0 ? [{sku:"Matcha", item:"77672", label:"Rasp in matcha white chocolate", upc:psData.upc_matcha, cases:Number(psData.matcha_cases), lbs:Math.round(Number(psData.matcha_cases)*3.16)}] : []),
      ...(Number(psData.xd_cases)>0 ? [{sku:"XD", item:"88021", label:"Rasp in extra dark chocolate", upc:psData.upc_xd, cases:Number(psData.xd_cases), lbs:Math.round(Number(psData.xd_cases)*3.37)}] : []),
      ...(Number(psData.wm_cases)>0 ? [{sku:"WM", item:"93562", label:"Rasp in white & milk chocolate", upc:psData.upc_wm, cases:Number(psData.wm_cases), lbs:Math.round(Number(psData.wm_cases)*3.41)}] : []),
    ];
    const totalCases = items.reduce((s,i) => s+i.cases, 0);
    const totalLbs = items.reduce((s,i) => s+i.lbs, 0);
    const pallets = Math.ceil(totalCases/255);
    const dateLabel = psData.distributor === "KeHe" ? "PICKUP DATE" : "DELIVERY DATE";
    const shipToHtml = [psData.customer, psData.ship_to_address].filter(Boolean).join("<br>");
    const rows = items.map((it,i) => `<tr style="background:${i%2===0?"#fff":"#F2E0E5"}">
      <td style="padding:6px 8px;border:1px solid #ccc">${it.label}</td>
      <td style="padding:6px 8px;border:1px solid #ccc">${it.upc}</td>
      <td style="padding:6px 8px;border:1px solid #ccc">${it.item}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center">${it.cases}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center">${it.lbs}</td>
    </tr>`).join("");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:Calibri,sans-serif;font-size:13px;margin:40px;color:#1a1a1a}
.brand{background:#1C2340;color:white;padding:14px 20px;margin:-40px -40px 20px;display:flex;align-items:center;justify-content:space-between}
.brand-name{font-size:24px;color:#A3224A;font-weight:bold;letter-spacing:2px}
.brand-sub{font-size:11px;color:#9CA3AF}
.ps-label{font-size:16px;font-weight:bold}
table{border-collapse:collapse;width:100%;margin-bottom:16px}
.th{background:#7B1D3A;color:white;font-weight:bold;padding:6px 8px;border:1px solid #7B1D3A;font-size:12px}
.td{padding:6px 8px;border:1px solid #ccc;font-size:12px}
.alt{background:#F2E0E5}
@media print{body{margin:20px}.brand{margin:-20px -20px 16px}}
</style></head><body>
<div class="brand">
  <div><div class="brand-name">BARIS</div><div class="brand-sub">Patagonia Bites Corp</div></div>
  <div style="text-align:right"><div class="ps-label">Packing Slip</div><div style="font-size:12px;color:#9CA3AF">PO # ${psData.po_number}</div></div>
</div>
<table style="width:auto">
  <tr><td class="th" style="width:140px">PO DATE</td><td class="td">${psData.po_date}</td></tr>
  <tr><td class="th">VENDOR #</td><td class="td alt">PATAGONIA BITES CORP</td></tr>
  <tr><td class="th">TEMPERATURE</td><td class="td">Frozen (0°F)</td></tr>
  <tr><td class="th">${dateLabel}</td><td class="td alt"><strong>${psData.ship_est_date}</strong></td></tr>
</table>
<hr style="border:none;border-top:2px solid #A3224A;margin:10px 0 14px">
<table><tr>
  <td class="th" style="width:50%">SHIP FROM</td><td class="th" style="width:50%">SHIP TO</td>
</tr><tr>
  <td class="td" style="vertical-align:top">LINEAGE NEWARK<br>360 Avenue P<br>Newark, NJ 07105</td>
  <td class="td" style="vertical-align:top">${shipToHtml}</td>
</tr></table>
<p style="font-weight:bold;font-size:13px;margin:14px 0 6px;color:#1C2340">LOAD</p>
<table style="width:auto;margin-bottom:14px"><tr>
  <td class="th" style="width:140px;text-align:center">Total Pallets</td>
  <td class="th" style="width:140px;text-align:center">Total LBS</td>
  <td class="th" style="width:140px;text-align:center">Total Cases</td>
</tr><tr>
  <td class="td" style="text-align:center"><strong>${pallets}</strong></td>
  <td class="td" style="text-align:center"><strong>${totalLbs}</strong></td>
  <td class="td" style="text-align:center"><strong>${totalCases}</strong></td>
</tr></table>
<table><tr>
  <td class="th" style="width:32%">Product</td><td class="th" style="width:22%">Case UPC</td>
  <td class="th" style="width:16%">Item #</td>
  <td class="th" style="width:15%;text-align:center">Cases</td>
  <td class="th" style="width:15%;text-align:center">Weight (LBS)</td>
</tr>${rows}
<tr><td class="td"></td><td class="td"></td><td class="td"><strong>TOTAL</strong></td>
  <td class="td" style="text-align:center"><strong>${totalCases}</strong></td>
  <td class="td" style="text-align:center"><strong>${totalLbs}</strong></td>
</tr></table>
<br><br>
<table><tr>
  <td class="td" style="width:50%">____________________________<br><strong>Shipper (Lineage Newark)</strong><br>Sign / Print / Date</td>
  <td class="td" style="width:50%">____________________________<br><strong>Carrier / Driver (${psData.distributor})</strong><br>Sign / Print / Date</td>
</tr></table>
<div style="margin-top:16px;font-size:9px;color:#aaa;text-align:right">Generated by BARIS Ops Hub · ${new Date().toLocaleDateString()}</div>
${psData.notes ? `<p style="font-size:11px;color:#555;margin-top:8px">${psData.notes}</p>` : ""}
</body></html>`;
  }

  const currentHtml = psHtml ?? buildLocalHtml();

  async function saveAndUpload() {
    setSaving(true);
    try {
      const blob = new Blob([currentHtml], { type: "text/html" });
      await supabase.storage.from("po-attachments").upload(`${order.po_number}/${filename}`, blob, { upsert: true });
      toast.success("Packing Slip saved to attachments");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to save");
    }
    setSaving(false);
  }

  function printPS() {
    const w = window.open("", "_blank");
    if (w) { w.document.write(currentHtml); w.document.close(); setTimeout(() => w.print(), 500); }
  }

  const inp = "rounded-lg border border-border bg-background px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary/30";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="relative w-full max-w-4xl rounded-2xl bg-card shadow-2xl max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card rounded-t-2xl px-6 pt-5 pb-3 border-b border-border z-10 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold" style={{color:"#1C2340"}}>Packing Slip — PO #{order.po_number}</h2>
            <p className="text-xs text-muted-foreground">Edit fields then save or print</p>
          </div>
          <div className="flex gap-2">
            <button onClick={printPS} className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-border hover:bg-muted">🖨 Print / PDF</button>
            <button onClick={saveAndUpload} disabled={saving}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{backgroundColor:"#A3224A"}}>
              {saving ? "Saving…" : "💾 Save to attachments"}
            </button>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg px-1">✕</button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-0">
          <div className="p-5 border-r border-border space-y-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Edit fields</p>
            <div><label className="text-xs text-muted-foreground">Pickup / Ship Date</label>
              <input type="date" className={`${inp} mt-1`} value={psData.ship_est_date}
                onChange={e => setPsData(d => ({...d, ship_est_date: e.target.value}))} /></div>
            <div><label className="text-xs text-muted-foreground">Ship To (Customer)</label>
              <input className={`${inp} mt-1`} value={psData.customer}
                onChange={e => setPsData(d => ({...d, customer: e.target.value}))} /></div>
            <div><label className="text-xs text-muted-foreground">Ship To Address</label>
              <textarea className={`${inp} mt-1`} rows={3} value={psData.ship_to_address}
                onChange={e => setPsData(d => ({...d, ship_to_address: e.target.value}))}
                placeholder={"14900 Meridian Parkway\nRiverside, CA 92518"} /></div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mt-3">Cases per SKU</p>
            {[
              {cKey:"pw_cases", uKey:"upc_pw", label:"P&W (77670)"},
              {cKey:"hm_cases", uKey:"upc_hm", label:"H&M (77671)"},
              {cKey:"xd_cases", uKey:"upc_xd", label:"XD (88021)"},
              {cKey:"wd_cases", uKey:"upc_wd", label:"W&D (23141)"},
              {cKey:"wm_cases", uKey:"upc_wm", label:"W&M (93562)"},
              {cKey:"matcha_cases", uKey:"upc_matcha", label:"Matcha (77672)"},
            ].map(f => (
              <div key={f.cKey} className="grid grid-cols-2 gap-1 items-center">
                <div>
                  <label className="text-[10px] text-muted-foreground">{f.label} · Cases</label>
                  <input type="number" min={0} className={`${inp} font-mono`}
                    value={psData[f.cKey as keyof typeof psData]}
                    onChange={e => setPsData(d => ({...d, [f.cKey]: e.target.value}))} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">UPC</label>
                  <input className={`${inp} font-mono text-xs`}
                    value={psData[f.uKey as keyof typeof psData]}
                    onChange={e => setPsData(d => ({...d, [f.uKey]: e.target.value}))} />
                </div>
              </div>
            ))}
            <div><label className="text-xs text-muted-foreground">Notes (optional)</label>
              <textarea className={`${inp} mt-1`} rows={2} value={psData.notes}
                onChange={e => setPsData(d => ({...d, notes: e.target.value}))} /></div>
          </div>

          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Live preview</p>
            <iframe
              srcDoc={currentHtml}
              className="w-full rounded-lg border border-border"
              style={{height: "600px"}}
              title="Packing Slip Preview"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── New Order Modal ───────────────────────────────────────────────────────────
function NewOrderModal({ onClose, onCreated, existingPONumbers }: {
  onClose: () => void; onCreated: (o: Order) => void; existingPONumbers: Set<string>;
}) {
  const [mode, setMode] = useState<"ai" | "manual">("manual");
  const [processing, setProcessing] = useState(false);
  const [packingSlip, setPackingSlip] = useState<{ html: string; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    po_number: "", po_date: ymd(new Date()), ship_est_date: "", distributor: "UNFI" as Distributor,
    customer: "", ship_to_address: "", status: "Open" as unknown as Status,
    wm_cases: "", wd_cases: "", xd_cases: "", pw_cases: "", hm_cases: "", matcha_cases: "",
    case_value: "", gross_sales: "", promo_discount: "", net_sales: "", notes: "",
  });

  const poExists = form.po_number.trim() !== "" && existingPONumbers.has(form.po_number.trim());

  function set(k: string, v: string) {
    setForm(f => {
      const next = { ...f, [k]: v };
      // Auto-calc gross = total × case_value when SKU qty or case_value changes
      const skuKeys = SKU_ITEMS.map(s => s.key as string);
      if (skuKeys.includes(k) || k === "case_value") {
        const cv = parseFloat(k === "case_value" ? v : next.case_value) || 0;
        if (cv > 0) {
          const total = SKU_ITEMS.reduce((s, sk) => s + (parseInt(next[sk.key as keyof typeof next] as string) || 0), 0);
          next.gross_sales = (total * cv).toFixed(2);
        }
      }
      // Auto-calc net = gross - allowance
      if (["gross_sales", "promo_discount", "case_value", ...skuKeys].includes(k)) {
        const g = parseFloat(next.gross_sales) || 0;
        const p = parseFloat(next.promo_discount) || 0;
        next.net_sales = (g - p).toFixed(2);
      }
      return next;
    });
  }

  async function extractFromFile(file: File) {
    setProcessing(true);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
      });
      const mediaType = file.type || "application/pdf";
      const response = await fetch("/api/process-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(`Server error ${response.status}: ${errData.error ?? "unknown"}`);
      }
      const ex = await response.json();
      setForm(f => ({
        ...f,
        po_number: ex.po_number || f.po_number,
        po_date: ex.po_date || f.po_date,
        ship_est_date: ex.ship_est_date || f.ship_est_date,
        distributor: ex.distributor || f.distributor,
        customer: ex.customer || f.customer,
        ship_to_address: ex.ship_to_address || f.ship_to_address,
        wd_cases: String(ex.wd_cases || 0),
        pw_cases: String(ex.pw_cases || 0),
        hm_cases: String(ex.hm_cases || 0),
        matcha_cases: String(ex.matcha_cases || 0),
        xd_cases: String(ex.xd_cases || 0),
        wm_cases: String(ex.wm_cases || 0),
        gross_sales: String(ex.gross_sales || 0),
        promo_discount: String(ex.promo_discount || 0),
        net_sales: String(ex.net_sales || 0),
      }));
      if (ex.packing_slip_html) {
        setPackingSlip({ html: ex.packing_slip_html, filename: ex.packing_slip_filename });
      } else {
        setPackingSlip(generatePackingSlip(ex));
      }
      setMode("manual");
      toast.success("PO extracted — review fields and save");
    } catch (e: any) {
      toast.error(`Extract failed: ${e?.message ?? "unknown error"} — fill in manually`);
      setMode("manual");
    }
    setProcessing(false);
  }

  async function save() {
    if (!form.po_number) { toast.error("PO number required"); return; }
    const { data, error } = await supabase.from("customer_orders").insert({
      po_number: form.po_number, po_date: form.po_date || new Date().toISOString().slice(0, 10), ship_est_date: form.ship_est_date || null,
      distributor: form.distributor, customer: form.customer, ship_to_address: form.ship_to_address || null, status: form.status,
      wm_cases: parseInt(form.wm_cases) || null, wd_cases: parseInt(form.wd_cases) || null,
      xd_cases: parseInt(form.xd_cases) || null, pw_cases: parseInt(form.pw_cases) || null,
      hm_cases: parseInt(form.hm_cases) || null, matcha_cases: parseInt(form.matcha_cases) || null,
      case_value: parseFloat(form.case_value) || null,
      gross_sales: parseFloat(form.gross_sales) || null, promo_discount: parseFloat(form.promo_discount) || null,
      net_sales: parseFloat(form.net_sales) || null, notes: form.notes || null,
    } as any).select().single();
    if (error || !data) { toast.error(error?.message ?? "Failed to create order"); return; }

    if (packingSlip && data.po_number) {
      let htmlContent = packingSlip.html;
      try {
        const decoded = decodeURIComponent(escape(atob(htmlContent)));
        if (decoded.includes("<!DOCTYPE")) htmlContent = decoded;
      } catch { /* already plain HTML */ }
      const blob = new Blob([htmlContent], { type: "text/html" });
      await supabase.storage.from("po-attachments").upload(`${data.po_number}/${packingSlip.filename}`, blob, { upsert: true });
    }

    onCreated(data);
    toast.success(`Order ${data.po_number} created${packingSlip ? " + Packing Slip saved" : ""}`);
    onClose();
  }

  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-primary/30";
  const row2 = "grid grid-cols-2 gap-3 mb-3";
  const row3 = "grid grid-cols-3 gap-3 mb-3";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-2xl bg-card shadow-2xl ring-1 ring-black/10 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card rounded-t-2xl px-6 pt-6 pb-3 border-b border-border z-10">
          <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground">✕</button>
          <h2 className="text-base font-bold" style={{ color: "#1C2340" }}>New Order</h2>
          <div className="flex gap-2 mt-3">
            {(["ai", "manual"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === m ? "text-white" : "bg-muted text-muted-foreground"}`}
                style={mode === m ? { backgroundColor: "#1C2340" } : {}}>
                {m === "ai" ? "📄 AI Extract" : "✏️ Manual"}
              </button>
            ))}
          </div>
        </div>
        <div className="px-6 py-4">
          {mode === "ai" && (
            <div onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30 py-12 cursor-pointer hover:bg-muted/50 mb-4">
              {processing ? <p className="text-sm text-muted-foreground">Extracting PO data…</p> : (
                <><p className="text-3xl mb-2">📄</p>
                  <p className="text-sm font-medium">Upload SPS PO document</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — Claude will extract all fields + generate Packing Slip</p></>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) extractFromFile(f); }} />

          <div className={row2}>
            <div>
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">PO Number *</label>
              <input className={`${inp} mt-1 ${poExists ? "border-orange-400 bg-orange-50" : ""}`}
                value={form.po_number} onChange={e => set("po_number", e.target.value)} />
              {poExists && <p className="text-[10px] text-orange-600 mt-0.5">⚠️ PO #{form.po_number} already exists</p>}
            </div>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">PO Date</label>
              <input type="date" className={`${inp} mt-1`} value={form.po_date} onChange={e => set("po_date", e.target.value)} /></div>
          </div>
          <div className={row2}>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Ship Est.</label>
              <input type="date" className={`${inp} mt-1`} value={form.ship_est_date} onChange={e => set("ship_est_date", e.target.value)} /></div>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Status</label>
              <select className={`${inp} mt-1`} value={form.status} onChange={e => set("status", e.target.value)}>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select></div>
          </div>
          <div className={row2}>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Distributor</label>
              <select className={`${inp} mt-1`} value={form.distributor} onChange={e => set("distributor", e.target.value)}>
                {DISTRIBUTORS.map(d => <option key={d} value={d}>{d}</option>)}
              </select></div>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Customer</label>
              <input className={`${inp} mt-1`} value={form.customer} onChange={e => set("customer", e.target.value)} /></div>
          </div>

          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 mt-1">Cases per SKU</p>
          <div className={row3}>
            {SKU_ITEMS.map(sk => (
              <div key={sk.key}><label className="text-[10px] text-muted-foreground">{sk.label}</label>
                <input type="number" className={`${inp} mt-1 font-mono`} value={form[sk.key as keyof typeof form]} min={0}
                  onChange={e => set(sk.key, e.target.value)} /></div>
            ))}
          </div>

          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 mt-1">Financials</p>
          <div className={row3}>
            <div>
              <label className="text-[10px] text-muted-foreground">$/case (precio)</label>
              <input type="number" step="0.01" className={`${inp} mt-1 font-mono`} value={form.case_value}
                onChange={e => set("case_value", e.target.value)} placeholder="36.96" />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                Gross ($)
                {form.case_value && <span className="text-amber-600">auto</span>}
              </label>
              <input type="number" className={`${inp} mt-1 font-mono ${form.case_value ? "bg-amber-50/50" : ""}`}
                value={form.gross_sales} onChange={e => set("gross_sales", e.target.value)} />
            </div>
            <div><label className="text-[10px] text-muted-foreground">Allowance ($)</label>
              <input type="number" className={`${inp} mt-1 font-mono`} value={form.promo_discount} onChange={e => set("promo_discount", e.target.value)} /></div>
          </div>
          <div className={row2}>
            <div><label className="text-[10px] text-muted-foreground">Net ($)</label>
              <input type="number" className={`${inp} font-mono bg-muted/30`} value={form.net_sales} readOnly /></div>
            <div />
          </div>

          <div className="mb-4"><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Notes</label>
            <textarea className={`${inp} mt-1 resize-none`} rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} /></div>

          {packingSlip && (
            <div className="mb-3 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5">
              <span className="text-lg">📄</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-emerald-800">Packing Slip ready — will be saved automatically</p>
                <p className="text-[11px] text-emerald-600">{packingSlip.filename}</p>
              </div>
            </div>
          )}

          <button onClick={save} className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
            Create Order as {form.status}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Task Queue Tab ────────────────────────────────────────────────────────────
function TaskQueueTab({ orders, onUpdated }: { orders: Order[]; onUpdated: (o: Order) => void }) {
  const [lineageOrder, setLineageOrder] = useState<Order | null>(null);
  const [bolOrder, setBolOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const readyToShip = orders.filter(o => o.status === "Accepted" || o.status === "Acknowledged");
  const inTransit = orders.filter(o => o.status === "Shipment");
  const readyToInvoice = orders.filter(o => o.status === "BOL Confirmed");

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: "#1C2340" }}>Ready to Invoice</span>
          <span className="rounded-full bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5">{readyToInvoice.length} orders</span>
        </div>
        {readyToInvoice.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No orders with BOL Confirmed status.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
              <th className="px-4 py-2 text-left">PO #</th><th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Distributor</th><th className="px-4 py-2 text-left">BOL Date</th>
              <th className="px-4 py-2 text-right">Cases</th><th className="px-4 py-2 text-right">Gross</th>
              <th className="px-4 py-2" />
            </tr></thead>
            <tbody>{readyToInvoice.map(o => {
              const total = SKU_ITEMS.reduce((s, sk) => s + (Number(o[sk.key]) || 0), 0);
              return <tr key={o.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs font-semibold">{o.po_number}</td>
                <td className="px-4 py-2">{o.customer}</td><td className="px-4 py-2">{o.distributor}</td>
                <td className="px-4 py-2 text-muted-foreground">{o.bol_date ?? "—"}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{total.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-600">${Math.round(Number(o.gross_sales) || 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => setDetailOrder(o)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: "#1C2340" }}>
                    Invoice →
                  </button>
                </td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: "#1C2340" }}>Ready to Ship</span>
          <span className="rounded-full bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5">{readyToShip.length} orders</span>
        </div>
        {readyToShip.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No orders with Accepted status.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
              <th className="px-4 py-2 text-left">PO #</th><th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Distributor</th><th className="px-4 py-2 text-left">Ship Est.</th>
              <th className="px-4 py-2 text-right">Cases</th><th className="px-4 py-2 text-right">Gross</th>
              <th className="px-4 py-2" />
            </tr></thead>
            <tbody>{readyToShip.map(o => {
              const total = SKU_ITEMS.reduce((s, sk) => s + (Number(o[sk.key]) || 0), 0);
              return <tr key={o.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs font-semibold">{o.po_number}</td>
                <td className="px-4 py-2">{o.customer}</td><td className="px-4 py-2">{o.distributor}</td>
                <td className="px-4 py-2 text-muted-foreground">{o.ship_est_date ?? "—"}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{total.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-600">${Math.round(Number(o.gross_sales) || 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => setLineageOrder(o)} className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
                    Send to Lineage →
                  </button>
                </td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: "#1C2340" }}>In Transit — Waiting for BOL</span>
          <span className="rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-0.5">{inTransit.length} orders</span>
        </div>
        {inTransit.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No orders in Shipment status.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
              <th className="px-4 py-2 text-left">PO #</th><th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Distributor</th><th className="px-4 py-2 text-left">Ship Est.</th>
              <th className="px-4 py-2 text-right">Cases</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>{inTransit.map(o => (
              <tr key={o.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs font-semibold">{o.po_number}</td>
                <td className="px-4 py-2">{o.customer}</td><td className="px-4 py-2">{o.distributor}</td>
                <td className="px-4 py-2 text-muted-foreground">{o.ship_est_date ?? "—"}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{SKU_ITEMS.reduce((s, sk) => s + (Number(o[sk.key]) || 0), 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => setBolOrder(o)} className="rounded-lg px-3 py-1 text-xs font-semibold border border-border hover:bg-muted">
                    Upload BOL
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {lineageOrder && <LineageModal order={lineageOrder} onClose={() => setLineageOrder(null)} onSent={o => { onUpdated(o); setLineageOrder(null); }} />}
      {bolOrder && <BOLModal order={bolOrder} onClose={() => setBolOrder(null)} onConfirmed={o => { onUpdated(o); setBolOrder(null); }} />}
      {detailOrder && <PODetailModal order={detailOrder} onClose={() => setDetailOrder(null)} onUpdated={o => { onUpdated(o); setDetailOrder(null); }} onDelete={() => {}} />}
    </div>
  );
}

// ─── Column config ─────────────────────────────────────────────────────────────
type ColumnKey = keyof Order | "total_cases" | "case_value";
const COLUMNS: { key: ColumnKey; label: string; numeric?: boolean; sku?: boolean; money?: boolean }[] = [
  { key: "po_number", label: "PO #" }, { key: "po_date", label: "PO Date" },
  { key: "ship_est_date", label: "Ship Est." }, { key: "invoice_date", label: "Invoice" },
  { key: "distributor", label: "Distributor" }, { key: "customer", label: "Customer" },
  { key: "status", label: "Status" },
  { key: "wm_cases", label: "W&M (93562)", numeric: true, sku: true },
  { key: "wd_cases", label: "W&D (23141)", numeric: true, sku: true },
  { key: "xd_cases", label: "XD (88021)", numeric: true, sku: true },
  { key: "pw_cases", label: "P&W (77670)", numeric: true, sku: true },
  { key: "hm_cases", label: "H&M (77671)", numeric: true, sku: true },
  { key: "matcha_cases", label: "Matcha (77672)", numeric: true, sku: true },
  { key: "total_cases", label: "Total", numeric: true },
  { key: "case_value", label: "$/case", numeric: true },
  { key: "gross_sales", label: "Gross", numeric: true, money: true },
  { key: "promo_discount", label: "Allowance", numeric: true, money: true },
  { key: "net_sales", label: "Net", numeric: true, money: true },
  { key: "fill_rate", label: "Fill %", numeric: true },
];

const CASE_KEYS: (keyof Order)[] = ["wd_cases", "pw_cases", "hm_cases", "matcha_cases", "xd_cases", "wm_cases"];
const TOTAL_KEYS: (keyof Order)[] = [...CASE_KEYS, "gross_sales", "promo_discount", "net_sales"];
const MONEY_KEYS = new Set<keyof Order>(["gross_sales", "promo_discount", "net_sales"]);

function rowTotalCases(r: Order) { return CASE_KEYS.reduce((s, k) => s + (Number(r[k]) || 0), 0); }
function fmtMoney(n: number) { return `$${Math.round(n).toLocaleString()}`; }

function cellClass(c: (typeof COLUMNS)[number]) {
  const base = c.numeric ? "text-right font-mono tabular-nums" : "text-left";
  if (c.sku) return `${base} bg-sku-column`;
  if (c.key === "total_cases") return `${base} bg-total-cases-column font-semibold`;
  return base;
}

function renderBodyCell(r: Order, c: (typeof COLUMNS)[number], onChanged: (o: Order) => void, onOpenDetail: (o: Order) => void) {
  if (c.key === "status") return <StatusCell order={r} onChanged={onChanged} />;
  if (c.key === "ship_est_date") return <ShipDateCell date={r.ship_est_date} status={r.status} />;
  if (c.key === "po_number") return (
    <button type="button" onClick={() => onOpenDetail(r)}
      className="font-mono text-xs font-semibold hover:underline" style={{ color: "#A3224A" }}>
      {r.po_number}
    </button>
  );
  if (c.key === "fill_rate") {
    const v = r.fill_rate;
    if (v == null || r.status !== "Invoiced" && r.status !== "BOL Confirmed") return <span className="text-muted-foreground">—</span>;
    const n = Number(v);
    const color = n >= 99 ? "text-emerald-600" : n >= 90 ? "text-orange-500 font-semibold" : "text-red-600 font-bold";
    return <span className={color}>{n.toFixed(1)}%</span>;
  }
  if (c.key === "case_value") {
    const v = (r as any).case_value;
    if (v == null) return <span className="text-muted-foreground">—</span>;
    return <span className="font-mono">${Number(v).toFixed(2)}</span>;
  }
  const v = c.key === "total_cases" ? rowTotalCases(r) : r[c.key as keyof Order];
  if (c.sku) {
    const n = Number(v) || 0;
    if (n === 0) return <span className="block w-full text-center text-muted-foreground">—</span>;
    return n.toLocaleString();
  }
  if (c.key === "total_cases") return <span className="font-semibold">{Math.round(Number(v) || 0).toLocaleString()}</span>;
  if (c.money && typeof v === "number") {
    if (c.key === "net_sales") return <span className="text-emerald-600">{fmtMoney(v)}</span>;
    return fmtMoney(v);
  }
  if (v == null || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}


// ─── Import Modal ──────────────────────────────────────────────────────────────
type ImportRow = {
  po_number: string;
  po_date: string | null;
  ship_est_date: string | null;
  invoice_date: string | null;
  distributor: string;
  customer: string;
  wm_cases: number | null;
  wd_cases: number | null;
  xd_cases: number | null;
  pw_cases: number | null;
  hm_cases: number | null;
  matcha_cases: number | null;
  case_value: number | null;
  gross_sales: number | null;
  promo_discount: number | null;
  net_sales: number | null;
  status: string;
  notes: string | null;
  _action: "new" | "update" | "unchanged";
  _changes: string[];
};

const DIST_FIX: Record<string, string> = {
  kehe: "KeHe", Kehe: "KeHe", KEHE: "KeHe",
  ups: "Direct", UPS: "Direct",
  "jmm distributors": "Other", "JMM Distributors": "Other",
  "pod foods": "Other", "Pod Foods": "Other",
  ubereats: "Other", UberEats: "Other",
};
function fixDist(v: string): Distributor {
  const valid: Distributor[] = ["UNFI","KeHe","Rainforest","RFD","Direct","Other"];
  const mapped = DIST_FIX[v] ?? DIST_FIX[v.toLowerCase()] ?? v;
  return (valid.includes(mapped as Distributor) ? mapped : "Other") as Distributor;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  result.push(cur.trim());
  return result;
}

function safeNum(v: string): number | null {
  if (!v || v === "—") return null;
  const n = parseFloat(v.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

function ImportModal({ onClose, onImported, existingRows }: {
  onClose: () => void;
  onImported: (orders: Order[]) => void;
  existingRows: Order[];
}) {
  const [step, setStep]       = useState<"upload"|"preview"|"importing"|"done">("upload");
  const [rows, setRows]       = useState<ImportRow[]>([]);
  const [result, setResult]   = useState({ updated: 0, created: 0, unchanged: 0 });
  const [errors, setErrors]   = useState<string[]>([]);
  const fileRef               = useRef<HTMLInputElement>(null);

  const existingMap = useMemo(() => new Map(existingRows.map(r => [r.po_number, r])), [existingRows]);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        let text = e.target?.result as string;
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { toast.error("CSV vacío"); return; }
        const headers = parseCSVLine(lines[0]);
        const parsed  = lines.slice(1)
          .map(l => Object.fromEntries(headers.map((h, i) => [h.trim(), parseCSVLine(l)[i]?.trim() ?? ""])))
          .filter(r => r["Invoice/PO"]?.trim() && r["Invoice/PO"] !== "—");

        const importRows: ImportRow[] = parsed.map(r => {
          const po       = r["Invoice/PO"];
          const existing = existingMap.get(po);
          const newRow: ImportRow = {
            po_number:     po,
            po_date:       r["PO Date"]     || null,
            ship_est_date: r["Ship Est."]   || null,
            invoice_date:  r["Invoice Date"]|| null,
            distributor:   fixDist(r["Distributor"] || "Other"),
            customer:      r["Customer"]    || "",
            wm_cases:      safeNum(r["W&M (93562)"]),
            wd_cases:      safeNum(r["W&D (23141)"]),
            xd_cases:      safeNum(r["XD (88021)"]),
            pw_cases:      safeNum(r["P&W (77670)"]),
            hm_cases:      safeNum(r["H&M (77671)"]),
            matcha_cases:  safeNum(r["Matcha (77672)"]),
            case_value:    safeNum(r["$/case"]),
            gross_sales:   safeNum(r["Gross Sales"]),
            promo_discount:safeNum(r["Allowance"]),
            net_sales:     safeNum(r["Net Sales"]),
            status:        r["Status"] || "Open",
            notes:         r["Notes"]  || null,
            _action:       "unchanged",
            _changes:      [],
          };
          if (!existing) {
            newRow._action = "new";
          } else {
            const changes: string[] = [];
            const check = (dbKey: keyof Order, label: string, val: unknown) => {
              const a = String(existing[dbKey] ?? "");
              const b = String(val ?? "");
              if (a !== b && !(existing[dbKey] == null && val == null) && !(a === "0" && b === "null"))
                changes.push(`${label}: ${a || "—"} → ${b || "—"}`);
            };
            check("status",        "Status",    newRow.status);
            check("wm_cases",      "W&M",       newRow.wm_cases);
            check("wd_cases",      "W&D",       newRow.wd_cases);
            check("xd_cases",      "XD",        newRow.xd_cases);
            check("pw_cases",      "P&W",       newRow.pw_cases);
            check("hm_cases",      "H&M",       newRow.hm_cases);
            check("matcha_cases",  "Matcha",    newRow.matcha_cases);
            check("gross_sales",   "Gross",     newRow.gross_sales);
            check("promo_discount","Allowance", newRow.promo_discount);
            check("ship_est_date", "Ship",      newRow.ship_est_date);
            check("invoice_date",  "Invoice",   newRow.invoice_date);
            check("notes",         "Notes",     newRow.notes);
            if (changes.length > 0) { newRow._action = "update"; newRow._changes = changes; }
          }
          return newRow;
        });
        setRows(importRows);
        setStep("preview");
      } catch (err: any) {
        toast.error("Error parseando CSV: " + err.message);
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function applyImport() {
    setStep("importing");
    const toProcess = rows.filter(r => r._action !== "unchanged");
    const errs: string[] = [];
    const saved: Order[] = [];

    for (const row of toProcess) {
      const payload: any = {
        po_number: row.po_number, po_date: row.po_date, ship_est_date: row.ship_est_date,
        invoice_date: row.invoice_date, distributor: row.distributor, customer: row.customer,
        wm_cases: row.wm_cases, wd_cases: row.wd_cases, xd_cases: row.xd_cases,
        pw_cases: row.pw_cases, hm_cases: row.hm_cases, matcha_cases: row.matcha_cases,
        case_value: row.case_value, gross_sales: row.gross_sales,
        promo_discount: row.promo_discount, net_sales: row.net_sales,
        status: row.status, notes: row.notes,
      };
      const op = row._action === "update"
        ? supabase.from("customer_orders").update(payload).eq("po_number", row.po_number).select().single()
        : supabase.from("customer_orders").insert(payload).select().single();
      const { data, error } = await op;
      if (error) errs.push(`PO ${row.po_number}: ${error.message}`);
      else if (data) saved.push(data);
    }
    setResult({
      updated:   rows.filter(r => r._action === "update").length - errs.length,
      created:   rows.filter(r => r._action === "new").length - errs.length,
      unchanged: rows.filter(r => r._action === "unchanged").length,
    });
    setErrors(errs);
    setStep("done");
    if (saved.length > 0) onImported(saved);
  }

  const newCount       = rows.filter(r => r._action === "new").length;
  const updateCount    = rows.filter(r => r._action === "update").length;
  const unchangedCount = rows.filter(r => r._action === "unchanged").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-3xl rounded-2xl bg-card shadow-2xl ring-1 ring-black/10 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground text-lg z-10">✕</button>
        <div className="p-6">
          <h2 className="text-lg font-bold mb-1" style={{ color: "#1C2340" }}>Import Pipeline</h2>
          <p className="text-xs text-muted-foreground mb-5">
            Exportá desde BARIS → editá en Excel → reimportá. Solo se aplican los cambios reales.
          </p>

          {step === "upload" && (
            <div>
              <div onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border bg-muted/30 py-14 cursor-pointer hover:bg-muted/50 transition">
                <p className="text-3xl mb-3">📂</p>
                <p className="text-sm font-semibold">Subí el CSV exportado desde BARIS</p>
                <p className="text-xs text-muted-foreground mt-1">El mismo archivo que genera el botón ↓ Export</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </div>
          )}

          {step === "preview" && (
            <div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                  <p className="text-2xl font-bold font-mono text-emerald-600">{newCount}</p>
                  <p className="text-xs text-emerald-700 font-semibold mt-0.5">Nuevos POs</p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                  <p className="text-2xl font-bold font-mono text-amber-600">{updateCount}</p>
                  <p className="text-xs text-amber-700 font-semibold mt-0.5">Con cambios</p>
                </div>
                <div className="rounded-xl border border-border bg-muted/20 p-3 text-center">
                  <p className="text-2xl font-bold font-mono text-muted-foreground">{unchangedCount}</p>
                  <p className="text-xs text-muted-foreground font-semibold mt-0.5">Sin cambios</p>
                </div>
              </div>

              {newCount + updateCount === 0 ? (
                <div className="rounded-xl border border-border bg-muted/20 p-6 text-center mb-4">
                  <p className="text-sm font-semibold text-muted-foreground">✅ Todo ya está al día — nada que importar</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border overflow-hidden mb-5 max-h-[40vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground sticky top-0">
                        <th className="px-3 py-2 text-left">PO #</th>
                        <th className="px-3 py-2 text-left">Customer</th>
                        <th className="px-3 py-2 text-left">Acción</th>
                        <th className="px-3 py-2 text-left">Cambios</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.filter(r => r._action !== "unchanged").map(r => (
                        <tr key={r.po_number} className="border-t border-border/60 hover:bg-muted/20">
                          <td className="px-3 py-1.5 font-mono font-semibold" style={{ color: "#A3224A" }}>{r.po_number}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.customer}</td>
                          <td className="px-3 py-1.5">
                            {r._action === "new"
                              ? <span className="rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold">Nuevo</span>
                              : <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold">Update</span>}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground max-w-[280px] truncate text-[10px]">
                            {r._changes.length > 0 ? r._changes.join(" · ") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-3">
                {newCount + updateCount > 0 && (
                  <button onClick={applyImport}
                    className="flex-1 rounded-lg py-2 text-sm font-semibold text-white"
                    style={{ backgroundColor: "#A3224A" }}>
                    Aplicar {newCount + updateCount} cambios →
                  </button>
                )}
                <button onClick={onClose}
                  className="rounded-lg py-2 px-4 text-sm font-semibold border border-border hover:bg-muted">
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {step === "importing" && (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground animate-pulse">Aplicando cambios en Supabase…</p>
            </div>
          )}

          {step === "done" && (
            <div className="py-8 text-center space-y-3">
              <p className="text-4xl">✅</p>
              <p className="text-sm font-semibold" style={{ color: "#1C2340" }}>
                {result.updated} actualizados · {result.created} nuevos · {result.unchanged} sin cambios
              </p>
              {errors.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-left">
                  <p className="text-xs font-semibold text-red-700 mb-1">Errores ({errors.length}):</p>
                  {errors.map((e, i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
                </div>
              )}
              <button onClick={onClose}
                className="rounded-lg px-6 py-2 text-sm font-semibold text-white"
                style={{ backgroundColor: "#1C2340" }}>
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
function Fulfillment() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pipeline");
  const [selDist, setSelDist] = useState<Set<string>>(new Set());
  const [selStatus, setSelStatus] = useState<Set<string>>(new Set());
  const [selCustomer, setSelCustomer] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [dateField, setDateField] = useState<DateField>("po_date");
  const [quarter, setQuarter] = useState<Quarter>("Q1");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sortKey, setSortKey] = useState<ColumnKey>("po_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [showNewOrder, setShowNewOrder] = useState(false);
  // ── Export / Import state ──
  const [showExportPicker, setShowExportPicker] = useState(false);
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("customer_orders").select("*").order("po_date", { ascending: false });
      if (cancel) return;
      if (error) setErr(error.message); else setRows(data ?? []);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  const existingPONumbers = useMemo(() => new Set(rows.map(r => r.po_number)), [rows]);
  const allCustomers = useMemo(() => [...new Set(rows.map(r => r.customer).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const range = computeRange(dateFilter, quarter, customFrom, customTo);
    return [...rows.filter(r =>
      (selDist.size === 0 || selDist.has(r.distributor)) &&
      (selStatus.size === 0 || selStatus.has(r.status)) &&
      (selCustomer.size === 0 || selCustomer.has(r.customer)) &&
      (!range.from || (r[dateField] ?? "") >= range.from) &&
      (!range.to || (r[dateField] ?? "") <= range.to),
    )].sort((a, b) => {
      const av = sortKey === "total_cases" ? rowTotalCases(a) : a[sortKey as keyof Order];
      const bv = sortKey === "total_cases" ? rowTotalCases(b) : b[sortKey as keyof Order];
      if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1; if (av > bv) return sortDir === "asc" ? 1 : -1; return 0;
    });
  }, [rows, selDist, selStatus, selCustomer, dateFilter, quarter, customFrom, customTo, sortKey, sortDir]);

  const totals = useMemo(() => {
    const t: Record<string, number> = { total_cases: 0 };
    for (const k of TOTAL_KEYS) t[k as string] = 0;
    for (const r of filtered) { for (const k of TOTAL_KEYS) t[k as string] += Number(r[k]) || 0; t.total_cases += rowTotalCases(r); }
    return t;
  }, [filtered]);

  function toggleSort(k: ColumnKey) {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir("asc"); }
  }
  function applyUpdate(updated: Order) { setRows(rs => rs.map(r => r.id === updated.id ? updated : r)); }
  function applyDelete(id: string) { setRows(rs => rs.filter(r => r.id !== id)); }
  function handleImported(imported: Order[]) {
    setRows(prev => {
      const existingIds = new Set(prev.map(r => r.id));
      const updates = imported.filter(o => existingIds.has(o.id));
      const inserts = imported.filter(o => !existingIds.has(o.id));
      return [...inserts, ...prev.map(r => updates.find(u => u.id === r.id) ?? r)];
    });
  }

  // ── Export to CSV (no external package, opens directly in Excel) ─────────
  function exportToExcel(yearFilter: string) {
    const toExport = yearFilter
      ? rows.filter(r => (r.po_date ?? "").startsWith(yearFilter))
      : filtered;

    if (toExport.length === 0) {
      toast.error("No orders to export");
      return;
    }

    const headers = [
      "Month","Invoice/PO","PO Date","Ship Est.","Invoice Date",
      "Distributor","Customer",
      "W&M (93562)","W&D (23141)","XD (88021)","P&W (77670)","H&M (77671)","Matcha (77672)",
      "Total Cases","$/case","Gross Sales","Allowance","Net Sales","Fill Rate %","Status","Notes",
    ];

    function cell(v: unknown): string {
      if (v === null || v === undefined || v === "") return "";
      const s = String(v);
      return (s.includes(",") || s.includes("\n") || s.includes('"')) ? `"${s.replace(/"/g, '""')}"`  : s;
    }

    const dataRows = toExport
      .sort((a, b) => (a.po_date ?? "").localeCompare(b.po_date ?? ""))
      .map(r => [
        (r.po_date ?? "").slice(0, 7),
        r.po_number,
        r.po_date ?? "",
        r.ship_est_date ?? "",
        r.invoice_date ?? "",
        r.distributor,
        r.customer,
        Number(r.wm_cases ?? 0),
        Number(r.wd_cases ?? 0),
        Number(r.xd_cases ?? 0),
        Number(r.pw_cases ?? 0),
        Number(r.hm_cases ?? 0),
        Number(r.matcha_cases ?? 0),
        rowTotalCases(r),
        (r as any).case_value ?? "",
        Number(r.gross_sales ?? 0),
        Number(r.promo_discount ?? 0),
        Number(r.net_sales ?? 0),
        r.fill_rate != null ? Number(r.fill_rate) : "",
        r.status,
        r.notes ?? "",
      ].map(cell));

    // UTF-8 BOM → Excel abre acentos correctamente
    const csv = "\uFEFF" + [headers.map(cell), ...dataRows].map(row => row.join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = yearFilter
      ? `BARIS_Pipeline_${yearFilter}.csv`
      : `BARIS_Pipeline_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${toExport.length} orders`);
    setShowExportPicker(false);
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "pipeline", label: "Pipeline PO" },
    { id: "tasks", label: "Task Queue" },
    { id: "collections", label: "Collections" },
    { id: "logistics", label: "Logistics" },
  ];

  const currentYear = new Date().getFullYear();

  return (
    <>
      <PageHeader title="Fulfillment" subtitle="Sales orders, shipments, collections and activity." />

      <div className="mb-5 flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            style={activeTab === t.id ? { borderColor: "#A3224A", color: "#A3224A" } : {}}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "tasks" && <TaskQueueTab orders={rows} onUpdated={applyUpdate} />}
      {activeTab === "collections" && <CollectionsTab orders={rows} />}
      {activeTab === "logistics" && <LogisticsTab orders={rows} />}

      {activeTab === "pipeline" && (
        <>
          {/* Filter bar */}
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <FilterSelect label="Date" value={dateField} onChange={v => setDateField(v as DateField)} options={[
              { value: "po_date", label: "PO Date" },
              { value: "ship_est_date", label: "Ship Date" },
              { value: "invoice_date", label: "Invoice Date" },
            ]} />
            <FilterSelect label="Range" value={dateFilter} onChange={v => setDateFilter(v as DateFilter)} options={[
              { value: "all", label: "All" }, { value: "this_month", label: "This month" },
              { value: "last_month", label: "Last month" }, { value: "quarter", label: "By Quarter" },
              { value: "this_year", label: "This year" }, { value: "last_year", label: "Last year" },
              { value: "custom", label: "Custom range" },
            ]} />
            {dateFilter === "quarter" && <FilterSelect label="Quarter" value={quarter} onChange={v => setQuarter(v as Quarter)}
              options={["Q1","Q2","Q3","Q4"].map(q => ({ value: q, label: q }))} />}
            {dateFilter === "custom" && (<>
              <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">From
                <input type="date" className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 normal-case tracking-normal font-normal text-foreground"
                  value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></label>
              <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">To
                <input type="date" className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 normal-case tracking-normal font-normal text-foreground"
                  value={customTo} onChange={e => setCustomTo(e.target.value)} /></label>
            </>)}
            <MultiSelect label="Distributor" options={DISTRIBUTORS} selected={selDist} onChange={setSelDist} />
            <MultiSelect label="Status" options={STATUSES} selected={selStatus} onChange={setSelStatus} />
            <MultiSelect label="Customer" options={allCustomers} selected={selCustomer} onChange={setSelCustomer} />
            {(selDist.size > 0 || selStatus.size > 0 || selCustomer.size > 0) && (
              <button onClick={() => { setSelDist(new Set()); setSelStatus(new Set()); setSelCustomer(new Set()); }}
                className="text-xs text-muted-foreground hover:text-foreground underline">
                Clear filters
              </button>
            )}
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "order" : "orders"}
            </span>

            {/* ── Action buttons ── */}
            <div className="ml-auto flex items-center gap-2">
              {/* Import button */}
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted">
                ↑ Import
              </button>
              {/* Export button */}
              <div className="relative">
                <button
                  onClick={() => setShowExportPicker(p => !p)}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted">
                  ↓ Export
                </button>
                {showExportPicker && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowExportPicker(false)} />
                    <div className="absolute right-0 z-20 mt-1 rounded-xl border border-border bg-popover shadow-xl p-4 min-w-[230px]">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-3">
                        Export PO History to Excel
                      </p>
                      <div className="space-y-1.5">
                        {[currentYear, currentYear - 1, currentYear - 2].map(yr => {
                          const count = rows.filter(r => (r.po_date ?? "").startsWith(String(yr))).length;
                          return (
                            <button
                              key={yr}
                              onClick={() => exportToExcel(String(yr))}
                              className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold border border-border hover:bg-muted text-left">
                              <span>📅 All {yr} POs</span>
                              <span className="text-xs text-muted-foreground font-normal">{count} orders</span>
                            </button>
                          );
                        })}
                        <div className="border-t border-border my-1" />
                        <button
                          onClick={() => exportToExcel("")}
                          className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm border border-border hover:bg-muted text-left text-muted-foreground">
                          <span>📋 Current view</span>
                          <span className="text-xs font-normal">{filtered.length} orders</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* New Order button */}
              <button
                onClick={() => setShowNewOrder(true)}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white"
                style={{ backgroundColor: "#A3224A" }}>
                + New Order
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-md ring-1 ring-black/5">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="bg-muted/60 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                  {COLUMNS.map(c => (
                    <th key={String(c.key)} onClick={() => toggleSort(c.key)}
                      className={`cursor-pointer select-none px-3 py-2.5 font-semibold ${c.numeric ? "text-right" : "text-left"} ${c.sku ? "bg-sku-column" : ""} ${c.key === "total_cases" ? "bg-total-cases-column" : ""}`}>
                      {c.label}{sortKey === c.key && <span className="ml-1 text-primary">{sortDir === "asc" ? "▲" : "▼"}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-muted-foreground">Loading…</td></tr>
                  : err ? <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-destructive">{err}</td></tr>
                  : filtered.length === 0 ? <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-muted-foreground">No orders match filters.</td></tr>
                  : filtered.map(r => (
                    <tr key={r.id} className="border-t border-border/70 transition-colors hover:bg-muted/40">
                      {COLUMNS.map(c => (
                        <td key={String(c.key)} className={`px-3 py-1.5 ${cellClass(c)}`}>
                          {renderBodyCell(r, c, applyUpdate, setDetailOrder)}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
              {!loading && !err && filtered.length > 0 && (
                <tfoot>
                  <tr className="sticky bottom-0 text-xs uppercase tracking-wide" style={{ backgroundColor: "#1C2340", color: "#ffffff" }}>
                    {COLUMNS.map((c, idx) => {
                      if (idx === 0) return <td key={String(c.key)} className="px-3 py-2 font-semibold">Totals ({filtered.length})</td>;
                      if (c.key === "total_cases") return <td key={String(c.key)} className="px-3 py-2 text-right font-mono tabular-nums font-bold">{totals.total_cases.toLocaleString()}</td>;
                      if (c.numeric && TOTAL_KEYS.includes(c.key as keyof Order)) {
                        const v = totals[c.key as string] ?? 0;
                        return <td key={String(c.key)} className={`px-3 py-2 text-right font-mono tabular-nums font-semibold ${c.key === "net_sales" ? "text-emerald-400" : ""}`}>
                          {MONEY_KEYS.has(c.key as keyof Order) ? fmtMoney(v) : Math.round(v).toLocaleString()}
                        </td>;
                      }
                      return <td key={String(c.key)} className="px-3 py-2" />;
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {detailOrder && <PODetailModal order={detailOrder} onClose={() => setDetailOrder(null)}
        onUpdated={o => { applyUpdate(o); setDetailOrder(o); }}
        onDelete={applyDelete} />}
      {showNewOrder && <NewOrderModal onClose={() => setShowNewOrder(false)}
        existingPONumbers={existingPONumbers}
        onCreated={o => { setRows(rs => [o, ...rs]); setShowNewOrder(false); }} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)}
        existingRows={rows}
        onImported={handleImported} />}
    </>
  );
}

// ─── Multi-select filter component ────────────────────────────────────────────
function MultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (v: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const allSelected = selected.size === 0;
  const displayLabel = allSelected ? "All" : selected.size === 1 ? [...selected][0] : `${selected.size} selected`;

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
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-normal normal-case tracking-normal shadow-sm focus:outline-none ${!allSelected ? "border-[#A3224A] bg-[#A3224A]/5 text-[#A3224A]" : "border-border bg-background text-foreground"}`}>
          {displayLabel}
          <span className="text-[10px]">▾</span>
        </button>
      </label>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-30 min-w-[160px] rounded-xl border border-border bg-popover shadow-lg p-1">
          <button type="button" onClick={() => { onChange(new Set()); setOpen(false); }}
            className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs hover:bg-muted ${allSelected ? "font-semibold" : ""}`}>
            <span className={`w-3 h-3 rounded border flex items-center justify-center ${allSelected ? "bg-[#A3224A] border-[#A3224A]" : "border-border"}`}>
              {allSelected && <span className="text-white text-[8px]">✓</span>}
            </span>
            All
          </button>
          {options.map(opt => (
            <button key={opt} type="button" onClick={() => toggle(opt)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs hover:bg-muted">
              <span className={`w-3 h-3 rounded border flex items-center justify-center flex-shrink-0 ${selected.has(opt) ? "bg-[#A3224A] border-[#A3224A]" : "border-border"}`}>
                {selected.has(opt) && <span className="text-white text-[8px]">✓</span>}
              </span>
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ship date cell ────────────────────────────────────────────────────────────
function ShipDateCell({ date, status }: { date: string | null; status: Status }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  if (status === "Invoiced" || status === "BOL Confirmed") {
    return <span className="font-mono text-xs text-muted-foreground">{date}</span>;
  }
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(date); d.setHours(0,0,0,0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  const dayOfWeek = today.getDay();
  const daysUntilSunday = 7 - dayOfWeek;
  const endOfWeek = new Date(today); endOfWeek.setDate(today.getDate() + daysUntilSunday);

  const isOverdue = d < today;
  const isThisWeek = d >= today && d <= endOfWeek;

  return (
    <span className={`font-mono text-xs ${isOverdue ? "text-red-600 font-bold" : isThisWeek ? "text-orange-500 font-semibold" : "text-muted-foreground"}`}
      title={isOverdue ? `Overdue by ${Math.abs(diff)}d — claim BOL` : isThisWeek ? "Ships this week" : ""}>
      {date}
      {isOverdue && " ⚠️"}
      {isThisWeek && !isOverdue && " 🔶"}
    </span>
  );
}

// ─── Collections Tab ──────────────────────────────────────────────────────────
function CollectionsTab({ orders }: { orders: Order[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const TERMS: Record<string, number> = { UNFI: 30, KeHe: 30, RFD: 30, Rainforest: 60, Direct: 30, Other: 30 };
  const [filterDist, setFilterDist] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("daysUntilDue");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");

  const rows = useMemo(() => {
    return orders
      .filter(o => o.status === "Invoiced" && o.invoice_date && !o.collected_at)
      .map(o => {
        const terms = TERMS[o.distributor] ?? 30;
        const dueDate = new Date(new Date(o.invoice_date!).getTime() + terms * 86400000);
        const dueDateStr = dueDate.toISOString().slice(0, 10);
        const daysUntilDue = Math.floor((dueDate.getTime() - new Date(today).getTime()) / 86400000);
        const cutoff = new Date(new Date(today).getTime() - terms * 86400000).toISOString().slice(0, 10);
        if (o.invoice_date! < cutoff) return null;
        const statusLabel = daysUntilDue < 0 ? "Overdue" : daysUntilDue <= 7 ? "Due soon" : "Upcoming";
        return { order: o, terms, dueDate: dueDateStr, daysUntilDue, statusLabel };
      })
      .filter(Boolean) as { order: Order; terms: number; dueDate: string; daysUntilDue: number; statusLabel: string }[];
  }, [orders, today]);

  const filtered = useMemo(() => {
    return rows
      .filter(r =>
        (filterDist === "all" || r.order.distributor === filterDist) &&
        (filterStatus === "all" || r.statusLabel === filterStatus)
      )
      .sort((a, b) => {
        let av: number | string = 0, bv: number | string = 0;
        if (sortKey === "daysUntilDue") { av = a.daysUntilDue; bv = b.daysUntilDue; }
        else if (sortKey === "net_sales") { av = Number(a.order.gross_sales) || 0; bv = Number(b.order.gross_sales) || 0; }
        else if (sortKey === "distributor") { av = a.order.distributor; bv = b.order.distributor; }
        else if (sortKey === "invoice_date") { av = a.order.invoice_date ?? ""; bv = b.order.invoice_date ?? ""; }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [rows, filterDist, filterStatus, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const totalPending = filtered.reduce((s, r) => s + (Number(r.order.gross_sales) || 0), 0);
  const dueThisWeek = filtered.filter(r => r.daysUntilDue <= 7 && r.daysUntilDue >= 0).reduce((s, r) => s + (Number(r.order.gross_sales) || 0), 0);
  const overdue = filtered.filter(r => r.daysUntilDue < 0).reduce((s, r) => s + (Number(r.order.gross_sales) || 0), 0);

  const [marking, setMarking] = useState<string | null>(null);

  async function markCollected(orderId: string) {
    setMarking(orderId);
    const { error } = await supabase.from("customer_orders").update({ collected_at: new Date().toISOString() }).eq("id", orderId);
    if (error) { toast.error("Failed"); } else { toast.success("Marked as collected ✓"); }
    setMarking(null);
  }

  const SortTh = ({ label, key }: { label: string; key: string }) => (
    <th onClick={() => toggleSort(key)}
      className="px-4 py-2.5 text-left cursor-pointer hover:text-foreground select-none">
      {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  const distOptions = [...new Set(rows.map(r => r.order.distributor))].sort();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Total Pending</p>
          <p className="text-2xl font-bold font-mono text-orange-500">${Math.round(totalPending).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">{filtered.length} invoices within terms</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Due This Week</p>
          <p className="text-2xl font-bold font-mono text-orange-600">${Math.round(dueThisWeek).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">{filtered.filter(r => r.daysUntilDue <= 7 && r.daysUntilDue >= 0).length} invoices</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Overdue</p>
          <p className={`text-2xl font-bold font-mono ${overdue > 0 ? "text-red-600" : "text-emerald-600"}`}>${Math.round(overdue).toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">{filtered.filter(r => r.daysUntilDue < 0).length} invoices past due</p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {[["UNFI","30d"],["KeHe","30d"],["RFD","30d"],["Rainforest","60d ⚠️"]].map(([d,t]) => (
            <span key={d} className={`rounded-full px-3 py-1 text-xs font-semibold ${d === "Rainforest" ? "bg-orange-100 text-orange-700 border border-orange-200" : "bg-muted text-muted-foreground"}`}>
              {d}: {t}
            </span>
          ))}
        </div>
        <div className="ml-auto flex gap-2 flex-wrap">
          <select value={filterDist} onChange={e => setFilterDist(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none">
            <option value="all">All distributors</option>
            {distOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none">
            <option value="all">All statuses</option>
            <option value="Overdue">Overdue</option>
            <option value="Due soon">Due soon (≤7d)</option>
            <option value="Upcoming">Upcoming</option>
          </select>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <SortTh label="Distributor" key="distributor" />
              <th className="px-4 py-2.5 text-left">PO #</th>
              <th className="px-4 py-2.5 text-left">Customer</th>
              <SortTh label="Invoice Date" key="invoice_date" />
              <th className="px-4 py-2.5 text-center">Terms</th>
              <SortTh label="Due Date" key="daysUntilDue" />
              <SortTh label="Amount" key="net_sales" />
              <th className="px-4 py-2.5 text-center">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No pending collections ✅</td></tr>
            ) : filtered.map(({ order: o, terms, dueDate, daysUntilDue, statusLabel }) => {
              const isOverdue = daysUntilDue < 0;
              const isDueSoon = daysUntilDue >= 0 && daysUntilDue <= 7;
              const rowBg = isOverdue ? "bg-red-50/40" : isDueSoon ? "bg-orange-50/30" : "";
              return (
                <tr key={o.id} className={`border-t border-border/60 hover:bg-muted/20 ${rowBg}`}>
                  <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{o.distributor}</td>
                  <td className="px-4 py-2 font-mono text-xs font-semibold" style={{color:"#A3224A"}}>{o.po_number}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">{o.customer}</td>
                  <td className="px-4 py-2 font-mono text-xs">{o.invoice_date}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${terms === 60 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"}`}>
                      {terms}d
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    <span className={isOverdue ? "text-red-600 font-bold" : isDueSoon ? "text-orange-500 font-semibold" : "text-muted-foreground"}>
                      {dueDate}
                      {isOverdue && <span className="ml-1 text-[10px] font-semibold">({Math.abs(daysUntilDue)}d late)</span>}
                      {isDueSoon && <span className="ml-1 text-[10px]">(in {daysUntilDue}d)</span>}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-600">
                    ${Math.round(Number(o.gross_sales) || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isOverdue ? "bg-red-100 text-red-700" : isDueSoon ? "bg-orange-100 text-orange-700" : "bg-blue-50 text-blue-700"}`}>
                      {statusLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => markCollected(o.id)} disabled={marking === o.id}
                      className="rounded-lg px-3 py-1 text-xs font-semibold border border-border hover:bg-muted disabled:opacity-50">
                      {marking === o.id ? "…" : "Mark collected"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{backgroundColor:"#1C2340", color:"#fff"}}>
                <td colSpan={6} className="px-4 py-2 text-xs font-semibold">Total ({filtered.length} invoices)</td>
                <td className="px-4 py-2 text-right font-mono font-bold text-emerald-400">${Math.round(totalPending).toLocaleString()}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
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

export const Route = createFileRoute("/_authenticated/fulfillment")({
  component: Fulfillment,
  head: () => ({ meta: [{ title: "Fulfillment · BARIS" }] }),
});
