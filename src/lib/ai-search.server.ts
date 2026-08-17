import { supabaseAdmin } from "@/integrations/supabase/client.server";

const n = (v: unknown) => Number(v ?? 0) || 0;
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const monthKey = (d: string | null) => (d ?? "").slice(0, 7);

/**
 * Builds a compact, factual snapshot of the operational database so the AI
 * answers from real numbers instead of guessing. Everything is aggregated
 * server-side; only summaries + the most relevant rows are sent to the model.
 */
export async function buildDataContext() {
  const today = new Date().toISOString().slice(0, 10);

  const [orders, movements, baseline, prod, terms, fin, lots] = await Promise.all([
    supabaseAdmin
      .from("customer_orders")
      .select(
        "po_number,po_date,ship_est_date,invoice_date,invoice_number,distributor,customer,status,gross_sales,net_sales,promo_discount,wd_cases,pw_cases,hm_cases,matcha_cases,xd_cases,wm_cases,collected_at,bol_number,notes",
      )
      .order("po_date", { ascending: false }),
    supabaseAdmin.from("fp_movements").select("movement_date,type,sku,cases,warehouse,lot_number,concept,cogs_per_case"),
    supabaseAdmin.from("fp_stock_baseline").select("sku,warehouse,cases,cases_available,lot_number,expiry_date,cogs_per_case"),
    supabaseAdmin.from("production_runs").select("run_date,facility,sku,cases_produced,cogs_per_case,lot_number").order("run_date", { ascending: false }).limit(60),
    supabaseAdmin.from("distributor_terms").select("distributor,payment_terms_days"),
    supabaseAdmin.from("finance_actuals").select("period,period_label,gross_sales,net_sales,cogs,gross_margin,gm_pct,ebitda,cash,ar,ap,inventory,units_sold").order("period", { ascending: true }),
    supabaseAdmin.from("lot_master").select("lot_number,sku,warehouse,expiry_date,cogs_per_case,cases_initial"),
  ]);

  const O = orders.data ?? [];
  const M = movements.data ?? [];
  const B = baseline.data ?? [];
  const P = prod.data ?? [];
  const T = terms.data ?? [];
  const F = fin.data ?? [];
  const L = lots.data ?? [];

  const caseCols = ["wd_cases", "pw_cases", "hm_cases", "matcha_cases", "xd_cases", "wm_cases"] as const;
  const skuOf: Record<(typeof caseCols)[number], string> = {
    wd_cases: "WD", pw_cases: "PW", hm_cases: "HM", matcha_cases: "Matcha", xd_cases: "XD", wm_cases: "WM",
  };
  const orderCases = (o: Record<string, unknown>) => caseCols.reduce((s, c) => s + n(o[c]), 0);

  // ---- Stock by SKU / warehouse (baseline + movements) ----
  const stock = new Map<string, number>();
  const add = (sku: string, wh: string, cases: number) => {
    const k = `${sku}|${wh}`;
    stock.set(k, (stock.get(k) ?? 0) + cases);
  };
  for (const b of B) add(String(b.sku), String(b.warehouse), n(b.cases_available ?? b.cases));
  for (const m of M) add(String(m.sku), String(m.warehouse), m.type === "In" ? n(m.cases) : -n(m.cases));

  const bySku = new Map<string, number>();
  const stockLines: string[] = [];
  for (const [k, v] of [...stock.entries()].sort()) {
    const [sku, wh] = k.split("|");
    bySku.set(sku, (bySku.get(sku) ?? 0) + v);
    if (Math.round(v) !== 0) stockLines.push(`  ${sku} @ ${wh}: ${Math.round(v)} cases`);
  }

  // ---- Sales by month (invoiced = revenue recognized) ----
  const months = new Map<string, { invoicedGross: number; invoicedCases: number; poGross: number; poCases: number; orders: number }>();
  for (const o of O) {
    const pk = monthKey(o.po_date);
    if (pk) {
      const r = months.get(pk) ?? { invoicedGross: 0, invoicedCases: 0, poGross: 0, poCases: 0, orders: 0 };
      r.poGross += n(o.gross_sales); r.poCases += orderCases(o); r.orders += 1;
      months.set(pk, r);
    }
    if (o.status === "Invoiced" && o.invoice_date) {
      const ik = monthKey(o.invoice_date);
      const r = months.get(ik) ?? { invoicedGross: 0, invoicedCases: 0, poGross: 0, poCases: 0, orders: 0 };
      r.invoicedGross += n(o.gross_sales); r.invoicedCases += orderCases(o);
      months.set(ik, r);
    }
  }
  const monthLines = [...months.entries()].sort().slice(-24).map(([k, r]) =>
    `  ${k}: invoiced ${usd(r.invoicedGross)} (${r.invoicedCases} cases) | POs booked ${usd(r.poGross)} (${r.poCases} cases, ${r.orders} orders)`);

  // ---- Sales by distributor / customer (last 12 months of invoices) ----
  const cut = new Date(); cut.setMonth(cut.getMonth() - 12);
  const cutS = cut.toISOString().slice(0, 10);
  const byDist = new Map<string, { gross: number; cases: number }>();
  const byCust = new Map<string, { gross: number; cases: number }>();
  const bySkuSold = new Map<string, number>();
  for (const o of O) {
    if (o.status !== "Invoiced" || !o.invoice_date || o.invoice_date < cutS) continue;
    const d = byDist.get(o.distributor) ?? { gross: 0, cases: 0 };
    d.gross += n(o.gross_sales); d.cases += orderCases(o); byDist.set(o.distributor, d);
    const c = byCust.get(o.customer) ?? { gross: 0, cases: 0 };
    c.gross += n(o.gross_sales); c.cases += orderCases(o); byCust.set(o.customer, c);
    for (const col of caseCols) bySkuSold.set(skuOf[col], (bySkuSold.get(skuOf[col]) ?? 0) + n((o as Record<string, unknown>)[col]));
  }

  // ---- Open pipeline & collections ----
  const open = O.filter((o) => o.status !== "Invoiced");
  const openValue = open.reduce((s, o) => s + n(o.gross_sales), 0);
  const termsMap = new Map(T.map((t) => [t.distributor, t.payment_terms_days]));
  const pending = O.filter((o) => o.status === "Invoiced" && o.invoice_date && !o.collected_at);
  const pendingRows = pending.map((o) => {
    const days = termsMap.get(o.distributor) ?? 30;
    const due = new Date(o.invoice_date as string);
    due.setDate(due.getDate() + days);
    const dueS = due.toISOString().slice(0, 10);
    return { ...o, dueS, overdue: dueS < today, amount: n(o.gross_sales) };
  });
  const pendingTotal = pendingRows.reduce((s, r) => s + r.amount, 0);
  const overdueTotal = pendingRows.filter((r) => r.overdue).reduce((s, r) => s + r.amount, 0);

  const orderLine = (o: (typeof O)[number]) =>
    `  PO ${o.po_number} | ${o.po_date} | ${o.distributor} / ${o.customer} | ${o.status} | ${orderCases(o)} cases | gross ${usd(n(o.gross_sales))} | ship_est ${o.ship_est_date ?? "—"} | invoice ${o.invoice_date ?? "—"}`;

  return `
BARIS OPERATIONS HUB — LIVE DATABASE SNAPSHOT (generated ${today})
All money is USD gross sales unless stated. Cases are integers.

== 1. FINISHED PRODUCT STOCK (cases on hand = baseline + movements In − Out) ==
By SKU total: ${[...bySku.entries()].map(([s, v]) => `${s}: ${Math.round(v)}`).join(", ") || "no data"}
By SKU/warehouse:
${stockLines.join("\n") || "  no data"}

== 2. SALES BY MONTH (last 24 months) ==
"invoiced" = orders with status Invoiced, dated by invoice_date (this is recognized revenue).
"POs booked" = orders dated by po_date, any status.
${monthLines.join("\n") || "  no data"}

== 3. INVOICED SALES LAST 12 MONTHS ==
Total: ${usd([...byDist.values()].reduce((s, d) => s + d.gross, 0))}
By distributor: ${[...byDist.entries()].sort((a, b) => b[1].gross - a[1].gross).map(([k, v]) => `${k} ${usd(v.gross)} (${v.cases} cases)`).join(" | ") || "none"}
By SKU (cases): ${[...bySkuSold.entries()].map(([k, v]) => `${k}: ${v}`).join(", ")}
Top 15 customers: ${[...byCust.entries()].sort((a, b) => b[1].gross - a[1].gross).slice(0, 15).map(([k, v]) => `${k} ${usd(v.gross)}`).join(" | ") || "none"}

== 4. OPEN PIPELINE (${open.length} orders not yet invoiced, ${usd(openValue)}) ==
${open.slice(0, 60).map(orderLine).join("\n") || "  none"}

== 5. COLLECTIONS (invoiced, not collected) ==
Payment terms: ${T.map((t) => `${t.distributor} ${t.payment_terms_days}d`).join(", ") || "default 30d"}
Pending to collect: ${usd(pendingTotal)} across ${pendingRows.length} invoices. Overdue: ${usd(overdueTotal)}.
${pendingRows.sort((a, b) => a.dueS.localeCompare(b.dueS)).slice(0, 40).map((r) => `  PO ${r.po_number} | ${r.distributor} / ${r.customer} | invoiced ${r.invoice_date} | due ${r.dueS}${r.overdue ? " (OVERDUE)" : ""} | ${usd(r.amount)}`).join("\n") || "  none"}

== 6. RECENT PRODUCTION RUNS ==
${P.slice(0, 25).map((p) => `  ${p.run_date} | ${p.facility} | ${p.sku} | ${p.cases_produced} cases | lot ${p.lot_number} | COGS/case $${n(p.cogs_per_case).toFixed(2)}`).join("\n") || "  none"}

== 7. LOTS (expiry / COGS) ==
${L.slice(0, 40).map((l) => `  ${l.lot_number} | ${l.sku} | ${l.warehouse ?? "—"} | exp ${l.expiry_date ?? "—"} | COGS/case ${l.cogs_per_case != null ? `$${n(l.cogs_per_case).toFixed(2)}` : "n/a"}`).join("\n") || "  none"}

== 8. FINANCE ACTUALS (closed months from accounting) ==
${F.map((f) => `  ${f.period_label ?? f.period}: gross ${usd(n(f.gross_sales))} | net ${usd(n(f.net_sales))} | COGS ${usd(Math.abs(n(f.cogs)))} | GM ${f.gm_pct != null ? `${Number(f.gm_pct).toFixed(1)}%` : "—"} | EBITDA ${usd(n(f.ebitda))} | cash ${usd(n(f.cash))} | AR ${usd(n(f.ar))}`).join("\n") || "  none"}

== 9. RECENT ORDERS (last 60 by PO date, any status) ==
${O.slice(0, 60).map(orderLine).join("\n") || "  none"}
`.trim();
}

export const SEARCH_SYSTEM_PROMPT = `You are the data analyst for BARIS, a premium frozen chocolate-dipped berry CPG brand.
You answer questions using ONLY the DATA SNAPSHOT provided in the user message. It is the live database.

Rules:
- Never invent numbers. Every figure must be traceable to the snapshot; do arithmetic yourself when needed and show the components briefly.
- Pick the right section: stock -> section 1; monthly sales/revenue -> section 2; distributor/customer/SKU mix -> section 3; open orders/pipeline -> section 4; collections, overdue, AR aging -> section 5; production -> section 6; lots/expiry/COGS -> section 7; P&L, EBITDA, margin, cash -> section 8; specific POs -> sections 4/9.
- "Revenue" means invoiced gross sales unless the user says otherwise. Distinguish booked POs from invoiced revenue when it matters.
- If the snapshot is truncated (a section shows only the top N rows) and the answer could depend on hidden rows, say so.
- If the data does not contain the answer, say exactly what is missing instead of guessing.
- Answer in the language the user asked in (Spanish or English). Be concise: a direct answer first, then at most a few supporting lines or a small list. Format money as $1,234 and cases as integers.`;
