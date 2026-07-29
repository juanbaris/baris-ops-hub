import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Order = Database["public"]["Tables"]["customer_orders"]["Row"];
type Distributor = Database["public"]["Enums"]["distributor"];
type Status = Database["public"]["Enums"]["order_status"];

const DISTRIBUTORS: Distributor[] = ["UNFI", "KeHe", "Rainforest", "RFD", "Direct", "Other"];
const STATUSES: Status[] = ["Open", "Acknowledged", "Shipment", "Invoiced"];
const SKU_ITEMS = [
  { key: "wd_cases" as const, label: "W&D", item: "23141" },
  { key: "pw_cases" as const, label: "P&W", item: "77670" },
  { key: "hm_cases" as const, label: "H&M", item: "77671" },
  { key: "matcha_cases" as const, label: "Matcha", item: "77672" },
  { key: "xd_cases" as const, label: "XD", item: "88021" },
  { key: "wm_cases" as const, label: "W&M", item: "93562" },
];

type DateFilter = "all" | "this_month" | "last_month" | "quarter" | "this_year" | "last_year" | "custom";
type Quarter = "Q1" | "Q2" | "Q3" | "Q4";
type Tab = "pipeline" | "shipments" | "collections";

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

// CHANGE 2: All statuses available (not just next)
const STATUS_STYLES: Record<Status, string> = {
  Open: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  Acknowledged: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
  Shipment: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  Invoiced: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
};

// ─── Status cell — CHANGE 2: show all statuses, not just next ──────────────────
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
                <span className={`inline-block w-2 h-2 rounded-full ${s === "Open" ? "bg-blue-400" : s === "Acknowledged" ? "bg-orange-400" : s === "Shipment" ? "bg-emerald-400" : "bg-purple-400"}`} />
                {s}{s === order.status ? " ✓" : ""}
              </button>
            ))}
          </div></>
      )}
    </div>
  );
}

// ─── PO Detail Modal — CHANGE 3: file attachments ─────────────────────────────
function PODetailModal({ order, onClose, onUpdated, onDelete }: {
  order: Order; onClose: () => void; onUpdated: (o: Order) => void; onDelete: (id: string) => void;
}) {
  const [notes, setNotes] = useState(order.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [files, setFiles] = useState<{ name: string; url: string; created_at: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showPS, setShowPS] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const steps: Status[] = ["Open", "Acknowledged", "Shipment", "Invoiced"];
  const currentIdx = steps.indexOf(order.status);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editData, setEditData] = useState({
    ship_est_date: order.ship_est_date ?? "",
    customer: order.customer ?? "",
    distributor: order.distributor as Distributor,
    wd_cases: String(order.wd_cases ?? ""),
    pw_cases: String(order.pw_cases ?? ""),
    hm_cases: String(order.hm_cases ?? ""),
    matcha_cases: String(order.matcha_cases ?? ""),
    xd_cases: String(order.xd_cases ?? ""),
    wm_cases: String(order.wm_cases ?? ""),
    gross_sales: String(order.gross_sales ?? ""),
    promo_discount: String(order.promo_discount ?? ""),
  });
  // Sync editData when order prop updates (after a save) and we're not editing
  useEffect(() => {
    if (!editing) {
      setEditData({
        ship_est_date: order.ship_est_date ?? "",
        customer: order.customer ?? "",
        distributor: order.distributor as Distributor,
        wd_cases: String(order.wd_cases ?? ""),
        pw_cases: String(order.pw_cases ?? ""),
        hm_cases: String(order.hm_cases ?? ""),
        matcha_cases: String(order.matcha_cases ?? ""),
        xd_cases: String(order.xd_cases ?? ""),
        wm_cases: String(order.wm_cases ?? ""),
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
      console.error("Storage upload error:", error);
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
    const payload = {
      ship_est_date: editData.ship_est_date || null,
      customer: editData.customer,
      distributor: editData.distributor,
      wd_cases: parseInt(editData.wd_cases) || 0,
      pw_cases: parseInt(editData.pw_cases) || 0,
      hm_cases: parseInt(editData.hm_cases) || 0,
      matcha_cases: parseInt(editData.matcha_cases) || 0,
      xd_cases: parseInt(editData.xd_cases) || 0,
      wm_cases: parseInt(editData.wm_cases) || 0,
      gross_sales: gross || null,
      promo_discount: promo || null,
      net_sales: gross > 0 ? gross - promo : null,
    };
    const { data, error } = await supabase.from("customer_orders").update(payload).eq("id", order.id).select().single();
    setEditSaving(false);
    if (error || !data) { toast.error("Failed to save changes"); return; }
    onUpdated(data);
    toast.success("Order updated");
    setEditing(false);
  }

  // CHANGE 4: delete PO
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

  // CHANGE 5: fill rate calculation
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
                <label className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">Ship Date</label>
                <input type="date" value={editData.ship_est_date}
                  onChange={e => setEditData(d => ({ ...d, ship_est_date: e.target.value }))}
                  className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-5">
              {order.distributor} · {order.customer} · PO Date: {order.po_date ?? "—"}
              {order.ship_est_date && <> · Ship: {order.ship_est_date}</>}
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
            {/* Quantities — view or edit */}
            <div className={`rounded-xl border p-4 ${editing ? "border-amber-300 bg-amber-50/40" : "border-border"}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">PO Quantities</p>
              {editing ? (
                <>
                  {SKU_ITEMS.map(sk => (
                    <div key={sk.key} className="flex items-center justify-between gap-2 py-0.5">
                      <span className="text-xs text-muted-foreground w-20">{sk.label}</span>
                      <input type="number" min="0"
                        value={editData[sk.key]}
                        onChange={e => setEditData(d => ({ ...d, [sk.key]: e.target.value }))}
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

            {/* Financials — view or edit */}
            <div className={`rounded-xl border p-4 ${editing ? "border-amber-300 bg-amber-50/40" : "border-border"}`}>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Financials</p>
              {editing ? (
                <>
                  <div className="flex flex-col gap-1.5">
                    <div>
                      <label className="text-[9px] uppercase tracking-wide text-muted-foreground">Gross Sales ($)</label>
                      <input type="number" min="0" step="0.01"
                        value={editData.gross_sales}
                        onChange={e => {
                          const g = e.target.value;
                          const net = (parseFloat(g) || 0) - (parseFloat(editData.promo_discount) || 0);
                          setEditData(d => ({ ...d, gross_sales: g }));
                          // net_sales auto-shown below
                        }}
                        className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-400" />
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

          {/* Save button — only visible in edit mode */}
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
                {/* Quick upload buttons by type */}
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
                  // Detect file type by name
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
                        onClick={async () => {
                          try {
                            const res = await fetch(f.url);
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            window.open(url, "_blank");
                            setTimeout(() => URL.revokeObjectURL(url), 10000);
                          } catch { window.open(f.url, "_blank"); }
                        }}
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

// ─── Send to Lineage Modal — CHANGE 1: Juan instead of Marcos ─────────────────
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

// ─── BOL Upload Modal — CHANGE 5: fill rate calculation ───────────────────────
function BOLModal({ order, onClose, onConfirmed }: { order: Order; onClose: () => void; onConfirmed: (o: Order) => void }) {
  const [step, setStep] = useState<"upload" | "review" | "saving">("upload");
  const [bolCases, setBolCases] = useState<Record<string, number>>({});
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Pre-fill with PO quantities
  useEffect(() => {
    setBolCases({
      wd: Number(order.wd_cases) || 0, pw: Number(order.pw_cases) || 0,
      hm: Number(order.hm_cases) || 0, matcha: Number(order.matcha_cases) || 0,
      xd: Number(order.xd_cases) || 0, wm: Number(order.wm_cases) || 0,
    });
  }, [order]);

  async function handleFile(file: File) {
    setProcessing(true);
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

  // CHANGE 5: compute fill rate from BOL vs PO
  function computeFillRate() {
    const poCases = SKU_ITEMS.reduce((s, sk) => s + (Number(order[sk.key]) || 0), 0);
    const bolTotal = Object.values(bolCases).reduce((s, v) => s + v, 0);
    if (poCases === 0) return 100;
    return Math.round((bolTotal / poCases) * 1000) / 10;
  }

  async function confirm() {
    setStep("saving");
    const today = new Date().toISOString().slice(0, 10);
    const fillRate = computeFillRate();

    const patch: Database["public"]["Tables"]["customer_orders"]["Update"] = {
      status: "Invoiced",
      invoice_date: order.invoice_date ?? today,
      fill_rate: fillRate,
      wd_cases: bolCases.wd || order.wd_cases,
      pw_cases: bolCases.pw || order.pw_cases,
      hm_cases: bolCases.hm || order.hm_cases,
      matcha_cases: bolCases.matcha || order.matcha_cases,
      xd_cases: bolCases.xd || order.xd_cases,
      wm_cases: bolCases.wm || order.wm_cases,
    };
    const { data, error } = await supabase.from("customer_orders").update(patch).eq("id", order.id).select().single();
    if (error || !data) { toast.error("Failed to update order"); setStep("review"); return; }

    // Create fp_movements Out records
    const movements = SKU_ITEMS
      .filter(sk => Number(patch[sk.key]) > 0)
      .map(sk => ({
        movement_date: String(patch.invoice_date ?? today),
        type: "Out" as const,
        sku: sk.label.replace("&", "").replace(" ", "") as Database["public"]["Enums"]["sku"],
        cases: Number(patch[sk.key]),
        warehouse: "Lineage Newark" as Database["public"]["Enums"]["warehouse"],
        lot_number: `BOL-${order.po_number}-${patch.invoice_date}`,
        concept: "Sale" as Database["public"]["Enums"]["fp_concept"],
        po_number_ref: order.po_number,
        notes: `BOL confirmed · PO ${order.po_number} · Fill ${fillRate}%`,
      }));
    if (movements.length > 0) await supabase.from("fp_movements").insert(movements);

    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      table_name: "customer_orders", record_id: order.id, action: "bol_confirmed",
      user_id: userData.user?.id ?? null,
      old_data: { status: order.status },
      new_data: { status: "Invoiced", fill_rate: fillRate, bol_cases: bolCases },
    });
    onConfirmed(data);
    toast.success(`BOL confirmed — Fill rate: ${fillRate}%${fillRate < 100 ? " ⚠️" : ""}`);
    onClose();
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
                  </div>
                );
              })}
            </div>

            {/* Fill rate preview */}
            <div className={`rounded-xl border p-3 mb-4 flex items-center justify-between ${fillRate < 100 ? "border-orange-200 bg-orange-50" : "border-emerald-200 bg-emerald-50"}`}>
              <span className="text-xs font-semibold text-muted-foreground">Fill Rate</span>
              <span className={`text-lg font-bold font-mono ${fillColor}`}>{fillRate.toFixed(1)}%</span>
            </div>

            <button onClick={confirm} className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
              Confirm & Mark as Invoiced
            </button>
          </div>
        )}
        {step === "saving" && <p className="text-center text-sm text-muted-foreground py-6">Saving…</p>}
      </div>
    </div>
  );
}

// ─── Generate Packing Slip HTML — BARIS format (matches Word template) ────────
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
  .note { font-style: italic; font-size: 10px; color: #555; margin: 8px 0; }
  .footer { margin-top: 20px; font-size: 9px; color: #aaa; text-align: right; }
  @media print { body { margin: 0; padding: 20px; } .brand-header { margin: -20px -20px 16px; } }
</style>
</head><body>

<div class="brand-header">
  <div>
    <h1>BARIS</h1>
    <p>Patagonia Bites Corp</p>
  </div>
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

<p class="note">Note: Freight Prepaid by Seller - Destination.</p>
<hr class="divider">

<table class="ship-table"><tr>
  <td>
    <strong>SHIP FROM</strong>
    LINEAGE NEWARK<br>
    360 Avenue P<br>
    Newark, NJ 07105
  </td>
  <td>
    <strong>SHIP TO</strong>
    ${po.customer || "—"}
  </td>
</tr></table>

<div class="section-label">LOAD</div>
<table class="summary-table" style="width:auto;margin-bottom:12px">
  <tr>
    <th style="width:150px">Total Pallets</th>
    <th style="width:150px">Total LBS</th>
    <th style="width:150px">Total Cases</th>
  </tr>
  <tr>
    <td>${Math.ceil(totalCases / 255)}</td>
    <td>${totalLbs}</td>
    <td>${totalCases}</td>
  </tr>
</table>

<table>
  <thead><tr>
    <th style="width:35%">Product</th>
    <th>Case UPC</th>
    <th>Item #</th>
    <th style="text-align:right;width:70px">Cases</th>
    <th style="text-align:right;width:90px">Weight (LBS)</th>
  </tr></thead>
  <tbody>
    ${rows}
    <tr class="total-row">
      <td colspan="3" style="text-align:right"><strong>TOTAL</strong></td>
      <td style="text-align:right;border:1px solid #ccc;padding:6px 10px"><strong>${totalCases}</strong></td>
      <td style="text-align:right;border:1px solid #ccc;padding:6px 10px"><strong>${totalLbs}</strong></td>
    </tr>
  </tbody>
</table>

<table class="sign-table" style="margin-top:35px;width:100%"><tr>
  <td>
    <div class="sign-line"></div>
    <strong>Shipper (Lineage Newark)</strong><br>Sign / Print / Date
  </td>
  <td>
    <div class="sign-line"></div>
    <strong>Carrier / Driver (${po.distributor || "Carrier"})</strong><br>Sign / Print / Date
  </td>
</tr></table>

<div class="footer">Generated by BARIS Ops Hub · ${new Date().toLocaleDateString()}</div>
</body></html>`;

<p style="margin-top:20px;font-size:10px;color:#888">Generated by BARIS Ops Hub</p>
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
    pw_cases: String(order.pw_cases ?? 0),
    hm_cases: String(order.hm_cases ?? 0),
    xd_cases: String(order.xd_cases ?? 0),
    wd_cases: String(order.wd_cases ?? 0),
    wm_cases: String(order.wm_cases ?? 0),
    matcha_cases: String(order.matcha_cases ?? 0),
  });
  const [saving, setSaving] = useState(false);

  const ps = generatePackingSlip(psData);

  async function saveAndUpload() {
    setSaving(true);
    try {
      const blob = new Blob([ps.html], { type: "text/html" });
      await supabase.storage.from("po-attachments").upload(`${order.po_number}/${ps.filename}`, blob, { upsert: true });
      toast.success("Packing Slip saved to attachments");
      onSaved();
      onClose();
    } catch (e) {
      toast.error("Failed to save");
    }
    setSaving(false);
  }

  function printPS() {
    const w = window.open("", "_blank");
    if (w) { w.document.write(ps.html); w.document.close(); w.print(); }
  }

  const inp = "rounded-lg border border-border bg-background px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono";

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="relative w-full max-w-4xl rounded-2xl bg-card shadow-2xl max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card rounded-t-2xl px-6 pt-5 pb-3 border-b border-border z-10 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold" style={{color:"#1C2340"}}>Packing Slip — PO #{order.po_number}</h2>
            <p className="text-xs text-muted-foreground">Edit before saving or printing</p>
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
          {/* Left: edit fields */}
          <div className="p-5 border-r border-border space-y-3">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Edit fields</p>
            <div><label className="text-xs text-muted-foreground">Pickup / Ship Date</label>
              <input type="date" className={`${inp} mt-1`} value={psData.ship_est_date}
                onChange={e => setPsData(d => ({...d, ship_est_date: e.target.value}))} /></div>
            <div><label className="text-xs text-muted-foreground">Ship To (Customer)</label>
              <input className={`${inp} mt-1`} value={psData.customer}
                onChange={e => setPsData(d => ({...d, customer: e.target.value}))} /></div>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mt-3">Cases per SKU</p>
            {[
              {key:"pw_cases", label:"P&W (77670)"},
              {key:"hm_cases", label:"H&M (77671)"},
              {key:"xd_cases", label:"XD (88021)"},
              {key:"wd_cases", label:"W&D (23141)"},
              {key:"wm_cases", label:"W&M (93562)"},
              {key:"matcha_cases", label:"Matcha (77672)"},
            ].map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground w-24">{f.label}</label>
                <input type="number" min={0} className={`${inp} w-20`}
                  value={psData[f.key as keyof typeof psData]}
                  onChange={e => setPsData(d => ({...d, [f.key]: e.target.value}))} />
              </div>
            ))}
          </div>

          {/* Right: live preview */}
          <div className="p-4">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Live preview</p>
            <iframe
              srcDoc={ps.html}
              className="w-full rounded-lg border border-border"
              style={{height: "580px"}}
              title="Packing Slip Preview"
            />
          </div>
        </div>
      </div>
    </div>
  );
}


function NewOrderModal({ onClose, onCreated, existingPONumbers }: {
  onClose: () => void; onCreated: (o: Order) => void; existingPONumbers: Set<string>;
}) {
  const [mode, setMode] = useState<"ai" | "manual">("manual");
  const [processing, setProcessing] = useState(false);
  const [packingSlip, setPackingSlip] = useState<{ html: string; filename: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    po_number: "", po_date: ymd(new Date()), ship_est_date: "", distributor: "UNFI" as Distributor,
    customer: "", status: "Open" as Status,
    wd_cases: "", pw_cases: "", hm_cases: "", matcha_cases: "", xd_cases: "", wm_cases: "",
    gross_sales: "", promo_discount: "", net_sales: "", notes: "",
  });

  // CHANGE 4: warn if PO already exists
  const poExists = form.po_number.trim() !== "" && existingPONumbers.has(form.po_number.trim());

  function set(k: string, v: string) {
    setForm(f => {
      const next = { ...f, [k]: v };
      if (k === "gross_sales" || k === "promo_discount") {
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
      console.error("extractFromFile error:", e);
      toast.error(`Extract failed: ${e?.message ?? "unknown error"} — fill in manually`);
      setMode("manual");
    }
    setProcessing(false);
  }

  async function save() {
    if (!form.po_number) { toast.error("PO number required"); return; }
    const { data, error } = await supabase.from("customer_orders").insert({
      po_number: form.po_number, po_date: form.po_date || null, ship_est_date: form.ship_est_date || null,
      distributor: form.distributor, customer: form.customer, status: form.status,
      wd_cases: parseInt(form.wd_cases) || null, pw_cases: parseInt(form.pw_cases) || null,
      hm_cases: parseInt(form.hm_cases) || null, matcha_cases: parseInt(form.matcha_cases) || null,
      xd_cases: parseInt(form.xd_cases) || null, wm_cases: parseInt(form.wm_cases) || null,
      gross_sales: parseFloat(form.gross_sales) || null, promo_discount: parseFloat(form.promo_discount) || null,
      net_sales: parseFloat(form.net_sales) || null, notes: form.notes || null,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Failed to create order"); return; }

    // Auto-upload packing slip to storage
    if (packingSlip && data.po_number) {
      const blob = new Blob([packingSlip.html], { type: "text/html" });
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
            <div><label className="text-[10px] text-muted-foreground">Gross ($)</label>
              <input type="number" className={`${inp} mt-1 font-mono`} value={form.gross_sales} onChange={e => set("gross_sales", e.target.value)} /></div>
            <div><label className="text-[10px] text-muted-foreground">Promo/Allow ($)</label>
              <input type="number" className={`${inp} mt-1 font-mono`} value={form.promo_discount} onChange={e => set("promo_discount", e.target.value)} /></div>
            <div><label className="text-[10px] text-muted-foreground">Net ($)</label>
              <input type="number" className={`${inp} mt-1 font-mono bg-muted/30`} value={form.net_sales} readOnly /></div>
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

// ─── Shipments Tab ─────────────────────────────────────────────────────────────
function ShipmentsTab({ orders, onUpdated }: { orders: Order[]; onUpdated: (o: Order) => void }) {
  const [lineageOrder, setLineageOrder] = useState<Order | null>(null);
  const [bolOrder, setBolOrder] = useState<Order | null>(null);
  const readyToShip = orders.filter(o => o.status === "Acknowledged");
  const inTransit = orders.filter(o => o.status === "Shipment");

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: "#1C2340" }}>Ready to Ship</span>
          <span className="rounded-full bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5">{readyToShip.length} orders</span>
        </div>
        {readyToShip.length === 0 ? <p className="px-5 py-6 text-sm text-muted-foreground">No orders with Acknowledged status.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
              <th className="px-4 py-2 text-left">PO #</th><th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Distributor</th><th className="px-4 py-2 text-left">Ship Est.</th>
              <th className="px-4 py-2 text-right">Cases</th><th className="px-4 py-2 text-right">Net</th>
              <th className="px-4 py-2" />
            </tr></thead>
            <tbody>{readyToShip.map(o => {
              const total = SKU_ITEMS.reduce((s, sk) => s + (Number(o[sk.key]) || 0), 0);
              return <tr key={o.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs font-semibold">{o.po_number}</td>
                <td className="px-4 py-2">{o.customer}</td><td className="px-4 py-2">{o.distributor}</td>
                <td className="px-4 py-2 text-muted-foreground">{o.ship_est_date ?? "—"}</td>
                <td className="px-4 py-2 text-right font-mono font-semibold">{total.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-emerald-600">${Math.round(Number(o.net_sales) || 0).toLocaleString()}</td>
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
    </div>
  );
}

// ─── Column config — CHANGE 5: fill rate colored ──────────────────────────────
type ColumnKey = keyof Order | "total_cases";
const COLUMNS: { key: ColumnKey; label: string; numeric?: boolean; sku?: boolean; money?: boolean }[] = [
  { key: "po_number", label: "PO #" }, { key: "po_date", label: "PO Date" },
  { key: "ship_est_date", label: "Ship Est." }, { key: "invoice_date", label: "Invoice" },
  { key: "distributor", label: "Distributor" }, { key: "customer", label: "Customer" },
  { key: "status", label: "Status" },
  { key: "wd_cases", label: "W&D (23141)", numeric: true, sku: true },
  { key: "pw_cases", label: "P&W (77670)", numeric: true, sku: true },
  { key: "hm_cases", label: "H&M (77671)", numeric: true, sku: true },
  { key: "matcha_cases", label: "Matcha (77672)", numeric: true, sku: true },
  { key: "xd_cases", label: "XD (88021)", numeric: true, sku: true },
  { key: "wm_cases", label: "W&M (93562)", numeric: true, sku: true },
  { key: "total_cases", label: "Total", numeric: true },
  { key: "gross_sales", label: "Gross", numeric: true, money: true },
  { key: "promo_discount", label: "Promo", numeric: true, money: true },
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
  // CHANGE 5: fill rate colored
  if (c.key === "fill_rate") {
    const v = r.fill_rate;
    if (v == null || r.status !== "Invoiced") return <span className="text-muted-foreground">—</span>;
    const n = Number(v);
    const color = n >= 99 ? "text-emerald-600" : n >= 90 ? "text-orange-500 font-semibold" : "text-red-600 font-bold";
    return <span className={color}>{n.toFixed(1)}%</span>;
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

// ─── Main component ────────────────────────────────────────────────────────────
function Fulfillment() {
  const [rows, setRows] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pipeline");
  // Multi-select filters
  const [selDist, setSelDist] = useState<Set<string>>(new Set());
  const [selStatus, setSelStatus] = useState<Set<string>>(new Set());
  const [selCustomer, setSelCustomer] = useState<Set<string>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [quarter, setQuarter] = useState<Quarter>("Q1");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [sortKey, setSortKey] = useState<ColumnKey>("po_date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [showNewOrder, setShowNewOrder] = useState(false);

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

  // Unique customers for filter
  const allCustomers = useMemo(() => [...new Set(rows.map(r => r.customer).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const range = computeRange(dateFilter, quarter, customFrom, customTo);
    return [...rows.filter(r =>
      (selDist.size === 0 || selDist.has(r.distributor)) &&
      (selStatus.size === 0 || selStatus.has(r.status)) &&
      (selCustomer.size === 0 || selCustomer.has(r.customer)) &&
      (!range.from || (r.po_date ?? "") >= range.from) &&
      (!range.to || (r.po_date ?? "") <= range.to),
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

  const tabs: { id: Tab; label: string }[] = [
    { id: "pipeline", label: "Pipeline PO" },
    { id: "shipments", label: "Shipments" },
    { id: "collections", label: "Collections" },
  ];

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

      {activeTab === "shipments" && <ShipmentsTab orders={rows} onUpdated={applyUpdate} />}
      {activeTab === "collections" && <CollectionsTab orders={rows} />}

      {activeTab === "pipeline" && (
        <>
          {/* Filter bar */}
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <FilterSelect label="Date" value={dateFilter} onChange={v => setDateFilter(v as DateFilter)} options={[
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
            <button onClick={() => setShowNewOrder(true)}
              className="ml-auto rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
              + New Order
            </button>
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
    </>
  );
}

// ─── Multi-select filter component ───────────────────────────────────────────
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

// ─── Ship date cell — colored by urgency, only for non-Invoiced ──────────────
function ShipDateCell({ date, status }: { date: string | null; status: Status }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  // Don't flag ship date if already invoiced — it's done
  if (status === "Invoiced") {
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
        else if (sortKey === "net_sales") { av = Number(a.order.net_sales) || 0; bv = Number(b.order.net_sales) || 0; }
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

  const totalPending = filtered.reduce((s, r) => s + (Number(r.order.net_sales) || 0), 0);
  const dueThisWeek = filtered.filter(r => r.daysUntilDue <= 7 && r.daysUntilDue >= 0).reduce((s, r) => s + (Number(r.order.net_sales) || 0), 0);
  const overdue = filtered.filter(r => r.daysUntilDue < 0).reduce((s, r) => s + (Number(r.order.net_sales) || 0), 0);

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
      {/* KPIs */}
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

      {/* Payment terms + Filters */}
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

      {/* Collections table */}
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
                    ${Math.round(Number(o.net_sales) || 0).toLocaleString()}
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
