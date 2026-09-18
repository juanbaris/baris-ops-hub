// BARIS Ops Hub — Agente CEO (v1, SOLO LECTURA)
// Tool-calling con Anthropic; los tools leen la DB con service role.
// El modelo NO recalcula finanzas: narra/analiza lo que devuelven los tools.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseAdmin as any;

const MAX_TOOL_ROUNDS = 6;

export const SYSTEM_PROMPT = `
Sos el asistente de operaciones de BARIS (Patagonia Bites Corp), una marca de CPG
congelado: barritas de frambuesa cubiertas de chocolate. Le respondés al founder/CEO.

Contexto del negocio:
- SKUs: XD, PW (P&W), HM (H&M), WM (W&M), WD (W&D), Matcha, y nuevos sabores de
  frutilla (Strawberry & White, Strawberry Caramel, Strawberry Yogurt, Raspberry Yogurt).
- Distribuidores: UNFI, KeHe (Sprouts), Rainforest, RFD, Direct.
- Copacker: Heinlein (esquema de tolling fee). Bookkeeping: Accountfully (cierra con lag).
- Los distribuidores compran ~1 mes antes de que el retailer venda (timing shift).

Tu rol:
- Respondé como un analista de operaciones senior / CFO de bolsillo: directo, cuantitativo,
  orientado a decisiones. Sin relleno.
- Respondé SIEMPRE en el idioma en que te escriben (español o inglés).
- Cuando pidan "los 5 KPIs" o un panorama general, combiná varios tools y armá un resumen
  ejecutivo con los números clave y 1-2 señales de alerta.

Reglas de datos (críticas):
- NUNCA inventes ni estimes un número. Todo dato cuantitativo tiene que venir de un tool.
  Si un tool no devuelve algo, decí explícitamente que no lo tenés, no lo completes de memoria.
- Los números que devuelven los tools son la fuente de la verdad. No los recalcules a mano.
- Todavía NO tenés acceso a: (a) el forecast a futuro (P&L/cashflow proyectado), ni
  (b) el stock del depósito FP con la lógica de baseline FIFO. Si te preguntan por eso,
  aclará que esos módulos todavía no están conectados al agente y ofrecé lo que sí tenés
  (actuals cerrados, stock por DC, pipeline). No improvises un forecast.
- 'finance_actuals' son datos ya cerrados por Accountfully; pueden tener lag de 1-2 meses.
  Siempre decí de qué período son los números.
- Montos en USD. Redondeá a dólar salvo que pidan centavos.

Formato:
- Conciso. Números primero, contexto después. Usá tablas simples cuando ayude.
- Si algo se ve raro (margen negativo, stockout, PO trabada), marcalo.
`.trim();

const TOOLS = [
  {
    name: "get_financials",
    description:
      "Resumen financiero de un período cerrado (P&L, balance, cashflow, márgenes) desde finance_actuals. " +
      "Usar para preguntas de cashflow, ventas, EBITDA, margen, caja, AR/AP, inventario. " +
      "Si no se pasa 'period', devuelve el período más reciente disponible.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", description: "Período a consultar, ej '2026-06'. Opcional." },
        all: { type: "boolean", description: "Si es true, devuelve la serie completa de períodos." },
      },
    },
  },
  {
    name: "get_nof",
    description:
      "Calcula la NOF (Necesidades Operativas de Fondos) = Inventario + Cuentas por Cobrar (AR) - Cuentas por Pagar (AP), " +
      "a partir de finance_actuals del período pedido (o el más reciente).",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", description: "Ej '2026-06'. Opcional." } },
    },
  },
  {
    name: "get_sku_stock_health",
    description:
      "Salud de stock por SKU a nivel DC de distribuidor (weeks-on-hand, stockouts, at_risk) desde dc_inventory, " +
      "más ventas recientes por SKU desde customer_orders. Usar para preguntas de SKU, stockouts, riesgo de quiebre.",
    input_schema: {
      type: "object",
      properties: { sku: { type: "string", description: "Filtrar por un SKU (ej 'XD'). Opcional." } },
    },
  },
  {
    name: "get_pipeline",
    description:
      "Estado del pipeline de POs (customer_orders): órdenes abiertas, por status, por distribuidor, próximos embarques, " +
      "cases y gross sales por SKU. Usar para preguntas de ventas comprometidas, POs, fill rate.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filtrar por status (ej 'Open'). Opcional." },
        distributor: { type: "string", description: "Filtrar por distribuidor (ej 'UNFI'). Opcional." },
      },
    },
  },
  {
    name: "check_inconsistencies",
    description:
      "Escaneo de inconsistencias operativas: lotes sin COGS, SKUs en riesgo/quiebre por DC, POs trabadas, " +
      "insumos recibidos y no pagados vencidos. Usar cuando pidan revisar problemas o inconsistencias.",
    input_schema: { type: "object", properties: {} },
  },
];

const num = (v: unknown) => (v == null ? null : Number(v));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function slimFin(r: Record<string, any>) {
  return {
    period: r.period,
    gross_sales: num(r.gross_sales),
    net_sales: num(r.net_sales),
    cogs: num(r.cogs),
    gross_margin: num(r.gross_margin),
    gm_pct: num(r.gm_pct),
    trade_spend: num(r.trade_spend),
    distr_fees: num(r.distr_fees),
    freight_out: num(r.freight_out),
    storage: num(r.storage),
    selling_exp: num(r.selling_exp),
    gen_exp: num(r.gen_exp),
    team: num(r.team),
    ebitda: num(r.ebitda),
    units_sold: num(r.units_sold),
    cash: num(r.cash),
    ar: num(r.ar),
    ap: num(r.ap),
    inventory: num(r.inventory),
    total_assets: num(r.total_assets),
    total_liab: num(r.total_liab),
    total_equity: num(r.total_equity),
    commercial_debt: num(r.commercial_debt),
    cash_bop: num(r.cash_bop),
    cash_eop: num(r.cash_eop),
    cash_from_ops: num(r.cash_from_ops),
    chg_wc: num(r.chg_wc),
    chg_ar: num(r.chg_ar),
    chg_ap: num(r.chg_ap),
    chg_inventory: num(r.chg_inventory),
    capital_contrib: num(r.capital_contrib),
  };
}

async function getFinancials(input: { period?: string; all?: boolean }) {
  const { data, error } = await db
    .from("finance_actuals")
    .select("*")
    .order("period", { ascending: false })
    .limit(10000);
  if (error) return { error: error.message };
  if (!data?.length) return { note: "No hay filas en finance_actuals." };

  if (input.all) return { periods: data.map(slimFin) };

  const row = input.period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? data.find((r: any) => (r.period ?? "").startsWith(input.period!)) ?? null
    : data[0];
  if (!row)
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      note: `No encontré el período ${input.period}. Disponibles: ${data.map((r: any) => r.period).join(", ")}`,
    };
  return { period: row.period, period_label: row.period_label, source: row.source, financials: slimFin(row) };
}

async function getNof(input: { period?: string }) {
  const { data, error } = await db
    .from("finance_actuals")
    .select("period, period_label, inventory, ar, ap")
    .order("period", { ascending: false })
    .limit(10000);
  if (error) return { error: error.message };
  if (!data?.length) return { note: "No hay filas en finance_actuals." };
  const row = input.period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? data.find((r: any) => (r.period ?? "").startsWith(input.period!)) ?? null
    : data[0];
  if (!row) return { note: `No encontré el período ${input.period}.` };
  const inv = num(row.inventory) ?? 0;
  const ar = num(row.ar) ?? 0;
  const ap = num(row.ap) ?? 0;
  return {
    period: row.period,
    formula: "NOF = Inventario + AR - AP",
    inventory: inv,
    accounts_receivable: ar,
    accounts_payable: ap,
    nof: inv + ar - ap,
  };
}

const SKU_COLS: Record<string, string> = {
  XD: "xd_cases",
  PW: "pw_cases",
  HM: "hm_cases",
  WM: "wm_cases",
  WD: "wd_cases",
  Matcha: "matcha_cases",
};

async function getSkuStockHealth(input: { sku?: string }) {
  const { data: dc, error: dcErr } = await db
    .from("dc_inventory")
    .select("*")
    .order("snapshot_date", { ascending: false })
    .limit(10000);
  if (dcErr) return { error: dcErr.message };

  const latestSnap = dc?.length ? dc[0].snapshot_date : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows = (dc ?? []).filter((r: any) => r.snapshot_date === latestSnap);
  if (input.sku)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows = rows.filter((r: any) => (r.sku ?? "").toUpperCase().includes(input.sku!.toUpperCase()));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bySku: Record<string, any> = {};
  for (const r of rows) {
    const s = r.sku ?? "?";
    bySku[s] ??= {
      sku: s,
      cases_on_hand: 0,
      cases_on_po: 0,
      cases_on_so: 0,
      dcs: 0,
      at_risk_dcs: 0,
      stockout_dcs: 0,
      low_woh_dcs: [] as string[],
    };
    const b = bySku[s];
    b.cases_on_hand += num(r.cases_on_hand) ?? 0;
    b.cases_on_po += num(r.cases_on_po) ?? 0;
    b.cases_on_so += num(r.cases_on_so) ?? 0;
    b.dcs += 1;
    if (r.at_risk) b.at_risk_dcs += 1;
    if ((num(r.cases_on_hand) ?? 0) <= 0) b.stockout_dcs += 1;
    const woh = num(r.weeks_on_hand);
    if (woh != null && woh <= 2) b.low_woh_dcs.push(`${r.dc} (${woh.toFixed(1)}w)`);
  }

  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const { data: orders } = await db
    .from("customer_orders")
    .select("po_date, xd_cases, pw_cases, hm_cases, wm_cases, wd_cases, matcha_cases")
    .gte("po_date", since)
    .limit(10000);
  const sales90: Record<string, number> = {};
  for (const o of orders ?? []) {
    for (const [sku, col] of Object.entries(SKU_COLS)) {
      sales90[sku] = (sales90[sku] ?? 0) + (num(o[col]) ?? 0);
    }
  }
  for (const s of Object.keys(bySku)) bySku[s].cases_sold_90d = sales90[s] ?? null;

  return {
    snapshot_date: latestSnap,
    note: "Stock a nivel DC de distribuidor (dc_inventory). NO incluye stock de depósito FP (aún no conectado).",
    skus: Object.values(bySku),
  };
}

async function getPipeline(input: { status?: string; distributor?: string }) {
  let q = db.from("customer_orders").select("*").order("po_date", { ascending: false }).limit(10000);
  if (input.status) q = q.eq("status", input.status);
  if (input.distributor) q = q.eq("distributor", input.distributor);
  const { data, error } = await q;
  if (error) return { error: error.message };
  const rows = data ?? [];

  const byStatus: Record<string, { orders: number; gross: number }> = {};
  const byDist: Record<string, { orders: number; gross: number }> = {};
  const bySkuCases: Record<string, number> = {};
  let totalGross = 0;
  let totalNet = 0;

  for (const r of rows) {
    const g = num(r.gross_sales) ?? 0;
    totalGross += g;
    totalNet += num(r.net_sales) ?? 0;
    byStatus[r.status] ??= { orders: 0, gross: 0 };
    byStatus[r.status].orders++;
    byStatus[r.status].gross += g;
    byDist[r.distributor] ??= { orders: 0, gross: 0 };
    byDist[r.distributor].orders++;
    byDist[r.distributor].gross += g;
    for (const [sku, col] of Object.entries(SKU_COLS))
      bySkuCases[sku] = (bySkuCases[sku] ?? 0) + (num(r[col]) ?? 0);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const openish = rows.filter((r: any) => !["Invoiced"].includes(r.status));
  const upcoming = openish
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => r.ship_est_date)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => (a.ship_est_date < b.ship_est_date ? -1 : 1))
    .slice(0, 15)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => ({
      po: r.po_number,
      customer: r.customer,
      distributor: r.distributor,
      status: r.status,
      ship_est_date: r.ship_est_date,
      gross_sales: num(r.gross_sales),
    }));

  return {
    total_orders: rows.length,
    total_gross_sales: totalGross,
    total_net_sales: totalNet,
    by_status: byStatus,
    by_distributor: byDist,
    cases_by_sku: bySkuCases,
    upcoming_shipments: upcoming,
  };
}

async function checkInconsistencies() {
  const issues: { severity: string; type: string; detail: string; count?: number }[] = [];

  const { data: lots } = await db
    .from("lot_master")
    .select("lot_number, sku, cogs_per_case, cogs_status")
    .limit(10000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noCogs = (lots ?? []).filter((l: any) => l.cogs_per_case == null || l.cogs_status === "missing");
  if (noCogs.length)
    issues.push({
      severity: "high",
      type: "cogs_faltante",
      count: noCogs.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: `Lotes sin COGS: ${noCogs.slice(0, 12).map((l: any) => `${l.lot_number}(${l.sku})`).join(", ")}${noCogs.length > 12 ? "…" : ""}`,
    });

  const { data: dc } = await db
    .from("dc_inventory")
    .select("*")
    .order("snapshot_date", { ascending: false })
    .limit(10000);
  const latest = dc?.length ? dc[0].snapshot_date : null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latestRows = (dc ?? []).filter((r: any) => r.snapshot_date === latest);
  const stockouts = latestRows.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => (num(r.cases_on_hand) ?? 0) <= 0 && (num(r.cases_on_so) ?? 0) > 0,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atRisk = latestRows.filter((r: any) => r.at_risk);
  if (stockouts.length)
    issues.push({
      severity: "high",
      type: "stockout_con_demanda",
      count: stockouts.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: `SKU/DC en quiebre con órdenes abiertas: ${stockouts.slice(0, 12).map((r: any) => `${r.sku}@${r.dc}`).join(", ")}${stockouts.length > 12 ? "…" : ""}`,
    });
  if (atRisk.length)
    issues.push({
      severity: "medium",
      type: "at_risk",
      count: atRisk.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: `SKU/DC marcados at_risk: ${atRisk.slice(0, 12).map((r: any) => `${r.sku}@${r.dc}`).join(", ")}${atRisk.length > 12 ? "…" : ""}`,
    });

  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const { data: orders } = await db
    .from("customer_orders")
    .select("po_number, status, po_date, gross_sales")
    .eq("status", "Open")
    .lt("po_date", cutoff)
    .limit(10000);
  if (orders?.length)
    issues.push({
      severity: "medium",
      type: "po_trabada",
      count: orders.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: `POs en 'Open' con >45 días: ${orders.slice(0, 12).map((o: any) => o.po_number).join(", ")}${orders.length > 12 ? "…" : ""}`,
    });

  const today = new Date().toISOString().slice(0, 10);
  const { data: ip } = await db
    .from("ip_movements")
    .select("material, vendor, received, paid, estimated_payment_date, total_price")
    .eq("received", true)
    .eq("paid", false)
    .lt("estimated_payment_date", today)
    .limit(10000);
  if (ip?.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owed = ip.reduce((s: number, r: any) => s + (num(r.total_price) ?? 0), 0);
    issues.push({
      severity: "medium",
      type: "ap_vencido",
      count: ip.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      detail: `Insumos recibidos, no pagados y vencidos: ${ip.length} (≈ $${Math.round(owed).toLocaleString("en-US")} a proveedores como ${[...new Set(ip.map((r: any) => r.vendor).filter(Boolean))].slice(0, 5).join(", ")})`,
    });
  }

  return { issues_found: issues.length, issues };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runTool(name: string, input: any) {
  try {
    switch (name) {
      case "get_financials":
        return await getFinancials(input ?? {});
      case "get_nof":
        return await getNof(input ?? {});
      case "get_sku_stock_health":
        return await getSkuStockHealth(input ?? {});
      case "get_pipeline":
        return await getPipeline(input ?? {});
      case "check_inconsistencies":
        return await checkInconsistencies();
      default:
        return { error: `Tool desconocido: ${name}` };
    }
  } catch (e) {
    return { error: `Fallo en ${name}: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callAnthropic(messages: any[], apiKey: string, model: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 2048, system: SYSTEM_PROMPT, tools: TOOLS, messages }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? JSON.stringify(json));
  return json;
}

export async function agentTurn(
  userMessage: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[] = [],
  opts: { apiKey: string; model: string },
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [...history, { role: "user", content: userMessage }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toolTrace: { tool: string; input: any }[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await callAnthropic(messages, opts.apiKey, opts.model);
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") {
      const text = (resp.content ?? [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((b: any) => b.type === "text")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((b: any) => b.text)
        .join("\n")
        .trim();
      return { reply: text, tools_used: toolTrace, messages };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      toolTrace.push({ tool: block.name, input: block.input });
      const result = await runTool(block.name, block.input);
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply: "Me quedé sin rondas de herramientas antes de terminar. Reformulá la pregunta más acotada.",
    tools_used: toolTrace,
    messages,
  };
}
