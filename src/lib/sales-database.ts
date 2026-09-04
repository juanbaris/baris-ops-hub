// ─── Sales Database: Accounts + Promo Calendar (2027+) ──────────────────────
// Fuente: Sales_Budget_2027_Master.xlsx → tablas Supabase `sales_accounts` y
// `sales_promo_calendar`. Reemplaza la fórmula de escenario para los meses que
// tengan datos acá (2027 en adelante). 2026 sigue viniendo de Fulfillment.

import { UNITS_PER_CASE } from "@/lib/sales-forecast";

export type Distributor = "UNFI" | "KEHE" | "Rainforest";

export const EXTENDED_SKUS = ["XD", "PW", "HM", "WM", "WD", "Matcha", "VS", "CS", "GR", "GS"] as const;
export type ExtendedSku = (typeof EXTENDED_SKUS)[number];

export const SKU_FULL_NAMES: Record<string, string> = {
  XD: "Extra Dark Rasp", PW: "Pistachio Rasp", HM: "Hazelnut Rasp", WM: "Milk Rasp",
  WD: "Dark Rasp", Matcha: "Matcha Rasp", VS: "Vanilla Straw", CS: "Caramel Straw",
  GR: "Greek Rasp", GS: "Greek Straw",
};

export type SalesAccount = {
  id: string;
  year: number;
  account_name: string;
  distributor: Distributor;
  delivered_cost: number;
  dist_markup_pct: number | null;
  edlp_allowance: number | null;
  srp: number | null;
  discounts_pct: number | null;
  edlp_pct: number | null;
  promos_pct: number | null;
  dist_fees_pct: number | null;
  dist_allowance_pct: number | null;
  payment_terms_pct: number | null;
  fulfillment_cost: number | null;
  cogs_per_unit: number | null;
};

export type PromoCalendarRow = {
  id: string;
  year: number;
  month: number;
  account_name: string;
  sku_code: string;
  distributor: Distributor;
  stores: number | null;
  reg_avg_vel: number | null;
  weeks: number | null;
  total_units: number;
  reg_units: number | null;
  promo_units: number | null;
  promo_label: string | null;
  promo_weeks: number | null;
  lift_pct: number | null;
  unit_cost: number | null;
  ad_dollars: number | null;
  total_cost: number | null;
  edlp_cost: number | null;
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

const DEFAULT_DELIVERED_COST: Record<Distributor, number> = { UNFI: 4.62, KEHE: 4.62, Rainforest: 4.8125 };

// ─── Fetch ────────────────────────────────────────────────────────────────────
export async function fetchSalesAccounts(supabase: any): Promise<SalesAccount[]> {
  const { data, error } = await supabase
    .from("sales_accounts").select("*")
    .order("year", { ascending: true }).order("account_name", { ascending: true })
    .limit(1000);
  if (error) { console.error("fetchSalesAccounts error:", error); return []; }
  return (data ?? []) as SalesAccount[];
}

export async function fetchPromoCalendar(supabase: any): Promise<PromoCalendarRow[]> {
  const all: PromoCalendarRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sales_promo_calendar").select("*")
      .order("year", { ascending: true })
      .order("month", { ascending: true })
      .order("account_name", { ascending: true })
      .order("sku_code", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("fetchPromoCalendar error:", error); break; }
    const batch = (data ?? []) as PromoCalendarRow[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

export async function updateSalesAccount(supabase: any, id: string, patch: Partial<SalesAccount>) {
  const { error } = await supabase.from("sales_accounts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function updatePromoCalendarRow(supabase: any, id: string, patch: Partial<PromoCalendarRow>) {
  const { error } = await supabase.from("sales_promo_calendar").update(patch).eq("id", id);
  if (error) throw error;
}

// ─── Insert / delete (add or remove accounts and promo rows) ──────────────────
export async function insertSalesAccount(supabase: any, row: Partial<SalesAccount>): Promise<SalesAccount | null> {
  const { data, error } = await supabase.from("sales_accounts").insert(row).select().single();
  if (error) { console.error("insertSalesAccount error:", error); throw error; }
  return data as SalesAccount;
}

export async function deleteSalesAccount(supabase: any, id: string) {
  const { error } = await supabase.from("sales_accounts").delete().eq("id", id);
  if (error) throw error;
}

export async function insertPromoRows(supabase: any, rows: Partial<PromoCalendarRow>[]): Promise<PromoCalendarRow[]> {
  const { data, error } = await supabase.from("sales_promo_calendar").insert(rows).select();
  if (error) { console.error("insertPromoRows error:", error); throw error; }
  return (data ?? []) as PromoCalendarRow[];
}

export async function deletePromoRows(supabase: any, ids: string[]) {
  if (!ids.length) return;
  const { error } = await supabase.from("sales_promo_calendar").delete().in("id", ids);
  if (error) throw error;
}

// ─── Actuals by account (Sales P&L: forecast vs real, editable per cell) ──────
export type AccountActual = { id: string; year: number; month: number; account_name: string; actual_revenue: number | null };

export async function fetchAccountActuals(supabase: any): Promise<AccountActual[]> {
  const all: AccountActual[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sales_account_actuals").select("*")
      .order("year", { ascending: true }).order("month", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error("fetchAccountActuals error:", error); break; }
    const batch = (data ?? []) as AccountActual[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

export async function upsertAccountActual(supabase: any, year: number, month: number, account_name: string, actual_revenue: number | null) {
  const { error } = await supabase
    .from("sales_account_actuals")
    .upsert({ year, month, account_name, actual_revenue, updated_at: new Date().toISOString() },
      { onConflict: "year,month,account_name" });
  if (error) throw error;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────
export type DbMonthAgg = {
  label: string; year: number; month: number;
  totalCases: number; revenue: number;
  bySku: Record<string, number>; // cases per SKU code
};

// ─── Distributor timing shift (2027+) ────────────────────────────────────────
// The Promo Calendar holds RETAILER sell-through. The distributor buys from us one
// month EARLIER, so distributor sales in month M = retailer sales in month M+1.
// We display distributor sales, so each row is moved back one month. Only applies
// from 2027 onward. Dec 2028 would need Jan 2029 (missing) → we repeat Dec 2028.
export function shiftPromoOneMonthEarlier(rows: PromoCalendarRow[]): PromoCalendarRow[] {
  const out: PromoCalendarRow[] = [];
  for (const r of rows) {
    // 2026 (if any) stays as-is
    if (r.year < 2027) { out.push(r); continue; }
    let dm = r.month - 1, dy = r.year;
    if (dm < 1) { dm = 12; dy -= 1; }
    if (dy < 2027) continue; // Jan 2027 → Dec 2026 falls off the displayed window
    out.push({ ...r, id: `shift-${r.id}`, year: dy, month: dm });
  }
  // Dec 2028 = retailer Jan 2029 (missing) → repeat retailer Dec 2028 in place
  for (const r of rows) {
    if (r.year === 2028 && r.month === 12) {
      out.push({ ...r, id: `shiftrepeat-${r.id}` });
    }
  }
  return out;
}

export function aggregatePromoCalendar(
  rows: PromoCalendarRow[],
  accounts: SalesAccount[],
  assumptions?: Record<string, number>,
): Record<string, DbMonthAgg> {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));

  const out: Record<string, DbMonthAgg> = {};
  for (const r of rows) {
    const label = monthLabel(r.year, r.month);
    if (!out[label]) out[label] = { label, year: r.year, month: r.month, totalCases: 0, revenue: 0, bySku: {} };
    const cost = assumptions ? deliveredCostOf(assumptions, r.distributor) : (costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62);
    const units = r.total_units ?? 0;
    const cases = units / UNITS_PER_CASE;
    out[label].totalCases += cases;
    out[label].revenue += units * cost;
    out[label].bySku[r.sku_code] = (out[label].bySku[r.sku_code] ?? 0) + cases;
  }
  Object.values(out).forEach(m => { m.totalCases = Math.round(m.totalCases); });
  return out;
}

// Merge DB-sourced months into a formula-driven forecast array (2027+ overrides).
// scenarioFactor scales the Promo Calendar units: Normal=1, Pessimistic=1-pct, Optimistic=1+pct.
export function mergeForecastWithDb<T extends { label: string; totalCases: number; revenue: number }>(
  forecast: T[],
  dbAgg: Record<string, DbMonthAgg>,
  scenarioFactor = 1,
): T[] {
  return forecast.map(f => {
    const agg = dbAgg[f.label];
    if (!agg) return f;
    const cases = Math.round(agg.totalCases * scenarioFactor);
    return {
      ...f,
      baseCases: cases, velDelta: 0, acctDelta: 0, newSkuDelta: 0,
      totalCases: cases, revenue: Math.round(agg.revenue * scenarioFactor),
      // Budget line = Normal (Promo Calendar, unscaled) so it stays put as a reference.
      budgetCases: agg.totalCases,
      budget: Math.round(agg.revenue),
    } as T;
  });
}

export function dbSkuByMonthFromAgg(dbAgg: Record<string, DbMonthAgg>): Record<string, Record<string, number>> {
  return Object.fromEntries(Object.entries(dbAgg).map(([label, agg]) => [label, agg.bySku]));
}

// Revenue per account per (year, month). key = `${year}|${month}|${account_name}`.
export function aggregateByAccountMonth(
  rows: PromoCalendarRow[],
  accounts: SalesAccount[],
  assumptions?: Record<string, number>,
): Map<string, number> {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const out = new Map<string, number>();
  for (const r of rows) {
    const cost = assumptions ? deliveredCostOf(assumptions, r.distributor) : (costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62);
    const rev = (r.total_units ?? 0) * cost;
    const key = `${r.year}|${r.month}|${r.account_name}`;
    out.set(key, (out.get(key) ?? 0) + rev);
  }
  return out;
}

// Annual revenue per account per year. key = `${year}|${account_name}`.
export function aggregateAnnualByAccount(
  rows: PromoCalendarRow[],
  accounts: SalesAccount[],
  assumptions?: Record<string, number>,
): Map<string, number> {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const out = new Map<string, number>();
  for (const r of rows) {
    const cost = assumptions ? deliveredCostOf(assumptions, r.distributor) : (costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62);
    const rev = (r.total_units ?? 0) * cost;
    const key = `${r.year}|${r.account_name}`;
    out.set(key, (out.get(key) ?? 0) + rev);
  }
  return out;
}

// Annual unit totals per account per year. key = `${year}|${account_name}`.
export function aggregateAnnualUnitsByAccount(rows: PromoCalendarRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.year}|${r.account_name}`;
    out.set(key, (out.get(key) ?? 0) + (r.total_units ?? 0));
  }
  return out;
}

// ─── Sales Breakdown: por Retail / DC / SKU, en units y revenue ───────────────
// Cada fila del breakdown tiene el dato por mes (key "YYYY-MM") en units y revenue,
// para que la UI pueda filtrar por mes/quarter/año sumando los meses que correspondan.
export type BreakdownRow = {
  key: string;                          // nombre del retail / DC / SKU
  unitsByMonth: Record<string, number>; // "2027-01" → units
  revByMonth: Record<string, number>;   // "2027-01" → revenue ($)
};

function mkKey(year: number, month: number) { return `${year}-${String(month).padStart(2, "0")}`; }

function buildBreakdown(
  rows: PromoCalendarRow[],
  accounts: SalesAccount[],
  groupBy: (r: PromoCalendarRow) => string,
  assumptions?: Record<string, number>,
): BreakdownRow[] {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const map = new Map<string, BreakdownRow>();
  for (const r of rows) {
    const g = groupBy(r);
    if (!map.has(g)) map.set(g, { key: g, unitsByMonth: {}, revByMonth: {} });
    const row = map.get(g)!;
    const mk = mkKey(r.year, r.month);
    const cost = assumptions ? deliveredCostOf(assumptions, r.distributor) : (costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62);
    const units = r.total_units ?? 0;
    row.unitsByMonth[mk] = (row.unitsByMonth[mk] ?? 0) + units;
    row.revByMonth[mk] = (row.revByMonth[mk] ?? 0) + units * cost;
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function breakdownByRetail(rows: PromoCalendarRow[], accounts: SalesAccount[], assumptions?: Record<string, number>): BreakdownRow[] {
  return buildBreakdown(rows, accounts, r => r.account_name, assumptions);
}
export function breakdownByDistributor(rows: PromoCalendarRow[], accounts: SalesAccount[], assumptions?: Record<string, number>): BreakdownRow[] {
  return buildBreakdown(rows, accounts, r => r.distributor, assumptions);
}
export function breakdownBySku(rows: PromoCalendarRow[], accounts: SalesAccount[], assumptions?: Record<string, number>): BreakdownRow[] {
  return buildBreakdown(rows, accounts, r => r.sku_code, assumptions);
}

// Sum a breakdown row's units/revenue over a set of month keys (period filter).
export function sumOverMonths(row: BreakdownRow, monthKeys: string[]): { units: number; revenue: number } {
  let units = 0, revenue = 0;
  for (const mk of monthKeys) {
    units += row.unitsByMonth[mk] ?? 0;
    revenue += row.revByMonth[mk] ?? 0;
  }
  return { units: Math.round(units), revenue: Math.round(revenue) };
}

// Build the list of month keys for a given period selection.
export function monthKeysForPeriod(mode: "year" | "quarter" | "month", year: number, q?: number, month?: number): string[] {
  if (mode === "month" && month) return [mkKey(year, month)];
  if (mode === "quarter" && q) {
    const start = (q - 1) * 3 + 1;
    return [mkKey(year, start), mkKey(year, start + 1), mkKey(year, start + 2)];
  }
  return Array.from({ length: 12 }, (_, i) => mkKey(year, i + 1));
}

// ─── Assumptions centrales (fuente única de verdad) ───────────────────────────
export type Assumptions = Record<string, number>;

export async function fetchAssumptions(supabase: any): Promise<Assumptions> {
  const { data, error } = await supabase.from("sales_assumptions").select("key,value").limit(1000);
  if (error) { console.error("fetchAssumptions error:", error); return {}; }
  const out: Assumptions = {};
  (data ?? []).forEach((r: any) => { out[r.key] = Number(r.value); });
  return out;
}

export async function updateAssumption(supabase: any, key: string, value: number) {
  const { error } = await supabase.from("sales_assumptions")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw error;
}

// Convenience getters with sane fallbacks
export function deliveredCostOf(a: Assumptions, dist: string): number {
  return a[`delivered_cost.${dist}`] ?? (dist === "Rainforest" ? 4.8125 : 4.62);
}
export function distPctOf(a: Assumptions, kind: "dist_fees" | "dist_allowance" | "payment_terms", dist: string): number {
  return a[`${kind}.${dist}`] ?? 0;
}
export function cogsOf(a: Assumptions, sku: string): number { return a[`cogs.${sku}`] ?? 0; }
export function fulfillmentPerUnit(a: Assumptions): number { return a["fulfillment_per_unit"] ?? 0.5; }

// ─── Per-account P&L inputs from the Promo Calendar ───────────────────────────
// For a given year, per account: total units, regular units, promo units,
// promo cost (sum of total_cost), and units split by SKU (for COGS).
export type AccountPnLInputs = {
  totalUnits: number; regUnits: number; promoUnits: number; promoCost: number;
  unitsBySku: Record<string, number>;
};

export function accountPnLInputs(rows: PromoCalendarRow[], year: number): Map<string, AccountPnLInputs> {
  const map = new Map<string, AccountPnLInputs>();
  for (const r of rows) {
    if (r.year !== year) continue;
    if (!map.has(r.account_name)) map.set(r.account_name, { totalUnits: 0, regUnits: 0, promoUnits: 0, promoCost: 0, unitsBySku: {} });
    const m = map.get(r.account_name)!;
    const u = r.total_units ?? 0;
    m.totalUnits += u;
    m.regUnits += r.reg_units ?? 0;
    m.promoUnits += r.promo_units ?? 0;
    m.promoCost += r.total_cost ?? 0;
    m.unitsBySku[r.sku_code] = (m.unitsBySku[r.sku_code] ?? 0) + u;
  }
  return map;
}

// ─── Promo analytics: todas las promos del Promo Calendar con rentabilidad ─────
export type PromoAnalyticsRow = {
  id: string;                 // promo calendar row id (para editar)
  year: number; month: number;
  account_name: string; distributor: Distributor; sku_code: string;
  promo_label: string | null;
  promo_weeks: number | null;
  lift_pct: number | null;
  unit_cost: number | null;
  total_cost: number;         // costo de la promo
  promo_units: number;
  incrementalUnits: number;   // unidades que no venderías sin la promo
  incrementalMargin: number;  // margen de esas unidades (delivered - cogs)
  netProfit: number;          // incrementalMargin - total_cost
  roi: number | null;         // netProfit / total_cost
};

// A row "has promo" if it has a promo_label or promo_units or total_cost > 0.
export function promoAnalytics(
  rows: PromoCalendarRow[],
  assumptions: Record<string, number>,
): PromoAnalyticsRow[] {
  const out: PromoAnalyticsRow[] = [];
  for (const r of rows) {
    const hasPromo = (r.promo_label && String(r.promo_label).trim() !== "")
      || (r.promo_units ?? 0) > 0 || (r.total_cost ?? 0) > 0;
    if (!hasPromo) continue;

    const lift = r.lift_pct ?? 0;                 // e.g. 0.30 for +30%
    const promoUnits = r.promo_units ?? 0;
    const totalCost = r.total_cost ?? 0;
    // incremental units = promoUnits × lift/(1+lift) — the share that is truly extra
    const incrementalUnits = lift > 0 ? promoUnits * (lift / (1 + lift)) : 0;
    const delivered = deliveredCostOf(assumptions, r.distributor);
    const cogs = cogsOf(assumptions, r.sku_code);
    const incrementalMargin = incrementalUnits * (delivered - cogs);
    const netProfit = incrementalMargin - totalCost;
    const roi = totalCost > 0 ? netProfit / totalCost : null;

    out.push({
      id: r.id, year: r.year, month: r.month,
      account_name: r.account_name, distributor: r.distributor, sku_code: r.sku_code,
      promo_label: r.promo_label, promo_weeks: r.promo_weeks, lift_pct: r.lift_pct,
      unit_cost: r.unit_cost, total_cost: totalCost, promo_units: promoUnits,
      incrementalUnits, incrementalMargin, netProfit, roi,
    });
  }
  return out;
}

// ─── Discounts por distribuidor × mes (crudo, sin shift) ──────────────────────
// Cada línea de descuento, agregada por distribuidor y mes ("YYYY-MM").
// EDLP = Σ(units × edlp_allowance de la cuenta). Promo = Σ(total_cost del Promo Calendar).
// Dist Fee/Allow/Paym = Gross Sales × % del distribuidor (assumptions).
export type DiscountRow = {
  distributor: string;
  byMonth: Record<string, {
    grossSales: number; edlp: number; promo: number;
    distFee: number; distAllow: number; payTerms: number; total: number;
  }>;
};

export function discountsByDistributorMonth(
  rows: PromoCalendarRow[],
  accounts: SalesAccount[],
  assumptions: Record<string, number>,
): DiscountRow[] {
  // edlp allowance per account (from Accounts master), keyed year|account
  const edlpMap = new Map<string, number>();
  accounts.forEach(a => edlpMap.set(`${a.year}|${a.account_name}`, a.edlp_allowance ?? 0));

  const map = new Map<string, DiscountRow>();
  for (const r of rows) {
    const dist = r.distributor;
    if (!map.has(dist)) map.set(dist, { distributor: dist, byMonth: {} });
    const d = map.get(dist)!;
    const mk = `${r.year}-${String(r.month).padStart(2, "0")}`;
    if (!d.byMonth[mk]) d.byMonth[mk] = { grossSales: 0, edlp: 0, promo: 0, distFee: 0, distAllow: 0, payTerms: 0, total: 0 };
    const cell = d.byMonth[mk];

    const units = r.total_units ?? 0;
    const delivered = deliveredCostOf(assumptions, dist);
    const gross = units * delivered;
    const edlpAllow = edlpMap.get(`${r.year}|${r.account_name}`) ?? 0;

    cell.grossSales += gross;
    cell.edlp += units * edlpAllow;
    cell.promo += r.total_cost ?? 0;
    cell.distFee += gross * distPctOf(assumptions, "dist_fees", dist);
    cell.distAllow += gross * distPctOf(assumptions, "dist_allowance", dist);
    cell.payTerms += gross * distPctOf(assumptions, "payment_terms", dist);
  }
  // total per cell
  for (const d of map.values()) {
    for (const mk of Object.keys(d.byMonth)) {
      const c = d.byMonth[mk];
      c.total = c.edlp + c.promo + c.distFee + c.distAllow + c.payTerms;
    }
  }
  return Array.from(map.values()).sort((a, b) => a.distributor.localeCompare(b.distributor));
}

// ─── Deductions actuals (real cargado a mano, por distribuidor × mes) ─────────
export type DeductionActual = { id: string; year: number; month: number; distributor: string; line: string; amount: number | null };

export async function fetchDeductionActuals(supabase: any): Promise<DeductionActual[]> {
  const { data, error } = await supabase
    .from("sales_deductions_actuals").select("*")
    .order("year", { ascending: true }).order("month", { ascending: true })
    .limit(10000);
  if (error) { console.error("fetchDeductionActuals error:", error); return []; }
  return (data ?? []) as DeductionActual[];
}

export async function upsertDeductionActual(supabase: any, year: number, month: number, distributor: string, line: string, amount: number | null) {
  const { error } = await supabase
    .from("sales_deductions_actuals")
    .upsert({ year, month, distributor, line, amount, updated_at: new Date().toISOString() },
      { onConflict: "year,month,distributor,line" });
  if (error) throw error;
}

// Aggregate a set of DiscountRows into a single TOTAL row (sum across distributors).
export function totalDiscountRow(rows: DiscountRow[]): DiscountRow {
  const total: DiscountRow = { distributor: "TOTAL", byMonth: {} };
  for (const d of rows) {
    for (const [mk, c] of Object.entries(d.byMonth)) {
      if (!total.byMonth[mk]) total.byMonth[mk] = { grossSales: 0, edlp: 0, promo: 0, distFee: 0, distAllow: 0, payTerms: 0, total: 0 };
      const t = total.byMonth[mk];
      t.grossSales += c.grossSales; t.edlp += c.edlp; t.promo += c.promo;
      t.distFee += c.distFee; t.distAllow += c.distAllow; t.payTerms += c.payTerms; t.total += c.total;
    }
  }
  return total;
}
