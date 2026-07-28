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
type Tab = "pipeline" | "shipments";

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
    case "last_month": {
      const lm = m === 0 ? 11 : m - 1;
      const ly = m === 0 ? y - 1 : y;
      return { from: start(ly, lm), to: endOfMonth(ly, lm) };
    }
    case "quarter": {
      const qStart = { Q1: 0, Q2: 3, Q3: 6, Q4: 9 }[quarter];
      return { from: start(y, qStart), to: endOfMonth(y, qStart + 2) };
    }
    case "this_year": return { from: start(y, 0), to: endOfMonth(y, 11) };
    case "last_year": return { from: start(y - 1, 0), to: endOfMonth(y - 1, 11) };
    case "custom": return { from: from || null, to: to || null };
  }
}

const NEXT_STATUS: Record<Status, Status | null> = {
  Open: "Acknowledged", Acknowledged: "Shipment", Shipment: "Invoiced", Invoiced: null,
};

const STATUS_STYLES: Record<Status, string> = {
  Open: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200",
  Acknowledged: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200",
  Shipment: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  Invoiced: "bg-purple-50 text-purple-700 ring-1 ring-inset ring-purple-200",
};

// ─── Status cell ───────────────────────────────────────────────────────────────
function StatusCell({ order, onChanged }: { order: Order; onChanged: (o: Order) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const next = NEXT_STATUS[order.status];

  async function changeTo(newStatus: Status) {
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
    toast.success(`Status updated to ${newStatus}`);
  }

  return (
    <div className="relative inline-block">
      <button type="button" disabled={!next || saving} onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[order.status]} ${next && !saving ? "cursor-pointer hover:brightness-95" : "cursor-default opacity-80"}`}>
        {order.status}{next ? <span>▾</span> : null}
      </button>
      {open && next && (
        <><div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-border bg-popover p-1 shadow-lg">
            <button type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-xs font-medium hover:bg-muted"
              onClick={() => changeTo(next)}>Move to <span className="font-semibold">{next}</span></button>
          </div></>
      )}
    </div>
  );
}

// ─── PO Detail Modal ───────────────────────────────────────────────────────────
function PODetailModal({ order, onClose, onUpdated }: { order: Order; onClose: () => void; onUpdated: (o: Order) => void }) {
  const [notes, setNotes] = useState(order.notes ?? "");
  const [saving, setSaving] = useState(false);
  const steps: Status[] = ["Open", "Acknowledged", "Shipment", "Invoiced"];
  const currentIdx = steps.indexOf(order.status);

  async function saveNotes() {
    setSaving(true);
    const { data, error } = await supabase.from("customer_orders").update({ notes }).eq("id", order.id).select().single();
    setSaving(false);
    if (error || !data) { toast.error("Failed to save notes"); return; }
    onUpdated(data); toast.success("Notes saved");
  }

  const totalCases = SKU_ITEMS.reduce((s, sk) => s + (Number(order[sk.key]) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-2xl bg-card shadow-2xl ring-1 ring-black/10" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-muted-foreground hover:text-foreground text-lg">✕</button>
        <div className="p-6">
          <h2 className="text-lg font-bold" style={{ color: "#1C2340" }}>PO #{order.po_number}</h2>
          <p className="text-sm text-muted-foreground mb-5">{order.distributor} · {order.customer} · PO Date: {order.po_date ?? "—"}</p>

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
            <div className="rounded-xl border border-border p-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">PO Quantities</p>
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
            </div>
            <div className="rounded-xl border border-border p-4">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">Financials</p>
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
            </div>
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
    </div>
  );
}

// ─── Send to Lineage Modal ─────────────────────────────────────────────────────
function LineageModal({ order, onClose, onSent }: { order: Order; onClose: () => void; onSent: (o: Order) => void }) {
  const isKehe = order.distributor === "KeHe";
  const to = "a6orders@onelineage.com";
  const cc = "pedro@everybaris.com,a6ship@onelineage.com,ltranssolutionseast@onelineage.com";
  const subject = `PO #${order.po_number} - ${order.customer}`;
  const body = isKehe
    ? `Hi team,\n\nPlease see attached a new order for ${order.customer}\nKeHe will do the pickup at Lineage (FOB). Please prepare the order accordingly.\n\nThanks!\nMarcos`
    : `Hi team,\n\nPlease see attached a new order for ${order.customer}\nWe would need Lineage to make the delivery.\n\nThanks!\nMarcos`;

  async function openMail() {
    const url = `mailto:${to}?cc=${cc}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = url;
    // Update status to Shipment
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
          💡 Attach the <strong>BARIS_PS_{order.po_number}.html</strong> Packing Slip to the email before sending.
        </div>
        <button onClick={openMail} className="w-full rounded-lg py-2 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
          Open in Mail & Mark as Shipment
        </button>
      </div>
    </div>
  );
}

// ─── BOL Upload Modal ──────────────────────────────────────────────────────────
function BOLModal({ order, onClose, onConfirmed }: { order: Order; onClose: () => void; onConfirmed: (o: Order) => void }) {
  const [step, setStep] = useState<"upload" | "review" | "saving">("upload");
  const [extracted, setExtracted] = useState<Record<string, number>>({});
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setProcessing(true);
    try {
      const base64 = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const mediaType = file.type as "image/jpeg" | "image/png" | "application/pdf";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              { type: mediaType === "application/pdf" ? "document" : "image",
                source: { type: "base64", media_type: mediaType, data: base64 } },
              { type: "text", text: `Extract from this BOL the cases shipped per SKU. Item codes: 23141=WD, 77670=PW, 77671=HM, 77672=Matcha, 88021=XD, 93562=WM. Return JSON only with keys: wd, pw, hm, matcha, xd, wm (integers, 0 if not present). Example: {"wd":0,"pw":360,"hm":45,"matcha":0,"xd":130,"wm":0}` }
            ]
          }]
        })
      });
      const data = await response.json();
      const text = data.content?.[0]?.text ?? "{}";
      const clean = text.replace(/```json|```/g, "").trim();
      setExtracted(JSON.parse(clean));
      setStep("review");
    } catch (e) {
      toast.error("Could not read BOL. Please enter cases manually.");
      setExtracted({ wd: 0, pw: 0, hm: 0, matcha: 0, xd: 0, wm: 0 });
      setStep("review");
    }
    setProcessing(false);
  }

  async function confirm() {
    setStep("saving");
    const patch: Database["public"]["Tables"]["customer_orders"]["Update"] = {
      status: "Invoiced",
      invoice_date: new Date().toISOString().slice(0, 10),
      wd_cases: extracted.wd || order.wd_cases,
      pw_cases: extracted.pw || order.pw_cases,
      hm_cases: extracted.hm || order.hm_cases,
      matcha_cases: extracted.matcha || order.matcha_cases,
      xd_cases: extracted.xd || order.xd_cases,
      wm_cases: extracted.wm || order.wm_cases,
    };
    const { data, error } = await supabase.from("customer_orders").update(patch).eq("id", order.id).select().single();
    if (error || !data) { toast.error("Failed to update order"); setStep("review"); return; }

    // Create fp_movements Out records for each SKU
    const movements = SKU_ITEMS
      .filter(sk => Number(patch[sk.key]) > 0)
      .map(sk => ({
        movement_date: String(patch.invoice_date ?? new Date().toISOString().slice(0, 10)),
        type: "Out" as const,
        sku: sk.label.replace("&", "").replace(" ", "") as Database["public"]["Enums"]["sku"],
        cases: Number(patch[sk.key]),
        warehouse: "Lineage Newark" as Database["public"]["Enums"]["warehouse"],
        lot_number: `BOL-${order.po_number}-${patch.invoice_date}`,
        concept: "Sale" as Database["public"]["Enums"]["fp_concept"],
        po_number_ref: order.po_number,
        notes: `Auto from BOL · PO ${order.po_number}`,
      }));
    if (movements.length > 0) {
      await supabase.from("fp_movements").insert(movements);
    }

    const { data: userData } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      table_name: "customer_orders", record_id: order.id, action: "bol_uploaded",
      user_id: userData.user?.id ?? null,
      old_data: { status: order.status },
      new_data: { status: "Invoiced", bol_cases: extracted },
    });
    onConfirmed(data);
    toast.success("BOL confirmed — order marked as Invoiced");
    onClose();
  }

  const skuMap: [string, keyof typeof extracted, keyof Order][] = [
    ["W&D", "wd", "wd_cases"], ["P&W", "pw", "pw_cases"], ["H&M", "hm", "hm_cases"],
    ["Matcha", "matcha", "matcha_cases"], ["XD", "xd", "xd_cases"], ["W&M", "wm", "wm_cases"],
  ];

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
                  <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG</p></>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          </div>
        )}

        {step === "review" && (
          <div>
            <p className="text-xs text-muted-foreground mb-3">Review extracted quantities — edit if needed:</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {skuMap.map(([label, extKey, orderKey]) => (
                <div key={extKey}>
                  <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</label>
                  <div className="flex items-center gap-1 mt-0.5">
                    <input type="number" className="w-full rounded-lg border border-border px-2 py-1 text-sm font-mono"
                      value={extracted[extKey] ?? 0}
                      onChange={e => setExtracted(x => ({ ...x, [extKey]: parseInt(e.target.value) || 0 }))} />
                    {Number(order[orderKey]) > 0 && extracted[extKey] !== Number(order[orderKey]) && (
                      <span className="text-[10px] text-orange-500">({order[orderKey]})</span>
                    )}
                  </div>
                </div>
              ))}
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

// ─── New Order Modal ───────────────────────────────────────────────────────────
function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (o: Order) => void }) {
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
        const r = new FileReader();
        r.onload = () => res((r.result as string).split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const mediaType = file.type || "application/pdf";

      // Call Edge Function — handles Claude Vision + Packing Slip generation
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-po`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ fileBase64: base64, mediaType }),
        }
      );

      if (!response.ok) throw new Error(`Edge function error: ${response.status}`);
      const ex = await response.json();

      // Fill form fields
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

      // Store packing slip for download
      if (ex.packing_slip_html) {
        setPackingSlip({ html: ex.packing_slip_html, filename: ex.packing_slip_filename });
      }

      setMode("manual");
      toast.success("PO extracted — review fields and save");
    } catch (e) {
      console.error(e);
      toast.error("Could not extract — fill in manually");
      setMode("manual");
    }
    setProcessing(false);
  }

  async function save() {
    if (!form.po_number) { toast.error("PO number required"); return; }
    const { data, error } = await supabase.from("customer_orders").insert({
      po_number: form.po_number, po_date: form.po_date || new Date().toISOString().slice(0, 10), ship_est_date: form.ship_est_date || null,
      distributor: form.distributor, customer: form.customer, status: form.status,
      wd_cases: parseInt(form.wd_cases) || null, pw_cases: parseInt(form.pw_cases) || null,
      hm_cases: parseInt(form.hm_cases) || null, matcha_cases: parseInt(form.matcha_cases) || null,
      xd_cases: parseInt(form.xd_cases) || null, wm_cases: parseInt(form.wm_cases) || null,
      gross_sales: parseFloat(form.gross_sales) || null, promo_discount: parseFloat(form.promo_discount) || null,
      net_sales: parseFloat(form.net_sales) || null, notes: form.notes || null,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Failed to create order"); return; }
    onCreated(data); toast.success(`Order ${data.po_number} created`); onClose();
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
                  <p className="text-sm font-medium">Upload PO document</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — Claude will extract all fields</p></>
              )}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) extractFromFile(f); }} />

          <div className={row2}>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">PO Number *</label>
              <input className={`${inp} mt-1`} value={form.po_number} onChange={e => set("po_number", e.target.value)} /></div>
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
                <p className="text-xs font-semibold text-emerald-800">Packing Slip generated</p>
                <p className="text-[11px] text-emerald-600">{packingSlip.filename}</p>
              </div>
              <button
                onClick={() => {
                  const html = decodeURIComponent(escape(atob(packingSlip.html)));
                  const blob = new Blob([html], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url; a.download = packingSlip.filename; a.click();
                  URL.revokeObjectURL(url);
                }}
                className="rounded-lg px-3 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: "#1C2340" }}
              >
                Download
              </button>
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

  const daysSince = (dateStr: string | null) => {
    if (!dateStr) return "—";
    const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    return `${d}d`;
  };

  return (
    <div className="space-y-6">
      {/* Ready to ship */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: "#1C2340" }}>Ready to Ship</span>
          <span className="rounded-full bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5">{readyToShip.length} orders</span>
        </div>
        {readyToShip.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No orders with Acknowledged status.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
              <th className="px-4 py-2 text-left">PO #</th><th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Distributor</th><th className="px-4 py-2 text-left">Ship Est.</th>
              <th className="px-4 py-2 text-right">Total Cases</th><th className="px-4 py-2 text-right">Net</th>
              <th className="px-4 py-2" />
            </tr></thead>
            <tbody>{readyToShip.map(o => {
              const total = SKU_ITEMS.reduce((s, sk) => s + (Number(o[sk.key]) || 0), 0);
              return (
                <tr key={o.id} className="border-t border-border/60 hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs font-semibold">{o.po_number}</td>
                  <td className="px-4 py-2">{o.customer}</td>
                  <td className="px-4 py-2">{o.distributor}</td>
                  <td className="px-4 py-2 text-muted-foreground">{o.ship_est_date ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{total.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-600">${Math.round(Number(o.net_sales) || 0).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setLineageOrder(o)}
                      className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
                      Send to Lineage →
                    </button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>

      {/* In transit */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3">
          <span className="text-sm font-semibold" style={{ color: "#1C2340" }}>In Transit — Waiting for BOL</span>
          <span className="rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-2 py-0.5">{inTransit.length} orders</span>
        </div>
        {inTransit.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">No orders in Shipment status.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20">
              <th className="px-4 py-2 text-left">PO #</th><th className="px-4 py-2 text-left">Customer</th>
              <th className="px-4 py-2 text-left">Distributor</th><th className="px-4 py-2 text-left">Ship Est.</th>
              <th className="px-4 py-2 text-right">Days</th><th className="px-4 py-2" />
            </tr></thead>
            <tbody>{inTransit.map(o => (
              <tr key={o.id} className="border-t border-border/60 hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs font-semibold">{o.po_number}</td>
                <td className="px-4 py-2">{o.customer}</td>
                <td className="px-4 py-2">{o.distributor}</td>
                <td className="px-4 py-2 text-muted-foreground">{o.ship_est_date ?? "—"}</td>
                <td className="px-4 py-2 text-right font-mono text-orange-600">{daysSince(o.ship_est_date)}</td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => setBolOrder(o)}
                    className="rounded-lg px-3 py-1 text-xs font-semibold border border-border hover:bg-muted">
                    Upload BOL (AI)
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

// ─── Column config ─────────────────────────────────────────────────────────────
type ColumnKey = keyof Order | "total_cases";
const COLUMNS: { key: ColumnKey; label: string; numeric?: boolean; sku?: boolean; money?: boolean }[] = [
  { key: "po_number", label: "PO #" }, { key: "po_date", label: "PO Date" },
  { key: "ship_est_date", label: "Ship Est." }, { key: "invoice_date", label: "Invoice" },
  { key: "distributor", label: "Distributor" }, { key: "customer", label: "Customer" },
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
  if (c.key === "po_number") return (
    <button type="button" onClick={() => onOpenDetail(r)}
      className="font-mono text-xs font-semibold hover:underline" style={{ color: "#A3224A" }}>
      {r.po_number}
    </button>
  );
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
  const [dist, setDist] = useState<Distributor | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
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

  const filtered = useMemo(() => {
    const range = computeRange(dateFilter, quarter, customFrom, customTo);
    return [...rows.filter(r =>
      (dist === "all" || r.distributor === dist) &&
      (status === "all" || r.status === status) &&
      (!range.from || r.po_date >= range.from) &&
      (!range.to || r.po_date <= range.to),
    )].sort((a, b) => {
      const av = sortKey === "total_cases" ? rowTotalCases(a) : a[sortKey as keyof Order];
      const bv = sortKey === "total_cases" ? rowTotalCases(b) : b[sortKey as keyof Order];
      if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1; if (av > bv) return sortDir === "asc" ? 1 : -1; return 0;
    });
  }, [rows, dist, status, dateFilter, quarter, customFrom, customTo, sortKey, sortDir]);

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

  const tabs: { id: Tab; label: string }[] = [
    { id: "pipeline", label: "Pipeline PO" },
    { id: "shipments", label: "Shipments" },
  ];

  return (
    <>
      <PageHeader title="Fulfillment" subtitle="Sales orders, shipments, collections and activity." />

      {/* Sub-tabs */}
      <div className="mb-5 flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            style={activeTab === t.id ? { borderColor: "#A3224A", color: "#A3224A" } : {}}>
            {t.label}
          </button>
        ))}
        <Link to="/collections" className="ml-auto self-center text-sm font-medium text-primary hover:underline pb-2" style={{ color: "#A3224A" }}>
          Collections →
        </Link>
      </div>

      {activeTab === "shipments" && <ShipmentsTab orders={rows} onUpdated={applyUpdate} />}

      {activeTab === "pipeline" && (
        <>
          {/* Filters */}
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
            <FilterSelect label="Distributor" value={dist} onChange={v => setDist(v as Distributor | "all")}
              options={[{ value: "all", label: "All" }, ...DISTRIBUTORS.map(d => ({ value: d, label: d }))]} />
            <FilterSelect label="Status" value={status} onChange={v => setStatus(v as Status | "all")}
              options={[{ value: "all", label: "All" }, ...STATUSES.map(s => ({ value: s, label: s }))]} />
            <span className="rounded-full bg-muted px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "order" : "orders"}
            </span>
            <button onClick={() => setShowNewOrder(true)}
              className="ml-auto rounded-lg px-4 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: "#A3224A" }}>
              + New Order
            </button>
          </div>

          {/* Table */}
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
                  : filtered.length === 0 ? <tr><td colSpan={COLUMNS.length} className="p-8 text-center text-muted-foreground">No orders match the current filters.</td></tr>
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

      {/* Modals */}
      {detailOrder && <PODetailModal order={detailOrder} onClose={() => setDetailOrder(null)} onUpdated={o => { applyUpdate(o); setDetailOrder(o); }} />}
      {showNewOrder && <NewOrderModal onClose={() => setShowNewOrder(false)} onCreated={o => { setRows(rs => [o, ...rs]); setShowNewOrder(false); }} />}
    </>
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
