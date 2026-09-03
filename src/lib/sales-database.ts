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
): Record<string, DbMonthAgg> {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));

  const out: Record<string, DbMonthAgg> = {};
  for (const r of rows) {
    const label = monthLabel(r.year, r.month);
    if (!out[label]) out[label] = { label, year: r.year, month: r.month, totalCases: 0, revenue: 0, bySku: {} };
    const cost = costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62;
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
): Map<string, number> {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const out = new Map<string, number>();
  for (const r of rows) {
    const cost = costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62;
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
): Map<string, number> {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const out = new Map<string, number>();
  for (const r of rows) {
    const cost = costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62;
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
): BreakdownRow[] {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const map = new Map<string, BreakdownRow>();
  for (const r of rows) {
    const g = groupBy(r);
    if (!map.has(g)) map.set(g, { key: g, unitsByMonth: {}, revByMonth: {} });
    const row = map.get(g)!;
    const mk = mkKey(r.year, r.month);
    const cost = costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62;
    const units = r.total_units ?? 0;
    row.unitsByMonth[mk] = (row.unitsByMonth[mk] ?? 0) + units;
    row.revByMonth[mk] = (row.revByMonth[mk] ?? 0) + units * cost;
  }
  return Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key));
}

export function breakdownByRetail(rows: PromoCalendarRow[], accounts: SalesAccount[]): BreakdownRow[] {
  return buildBreakdown(rows, accounts, r => r.account_name);
}
export function breakdownByDistributor(rows: PromoCalendarRow[], accounts: SalesAccount[]): BreakdownRow[] {
  return buildBreakdown(rows, accounts, r => r.distributor);
}
export function breakdownBySku(rows: PromoCalendarRow[], accounts: SalesAccount[]): BreakdownRow[] {
  return buildBreakdown(rows, accounts, r => r.sku_code);
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
