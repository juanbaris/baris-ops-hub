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
  const { data, error } = await supabase
    .from("sales_promo_calendar").select("*")
    .order("year", { ascending: true }).order("month", { ascending: true })
    .limit(10000);
  if (error) { console.error("fetchPromoCalendar error:", error); return []; }
  return (data ?? []) as PromoCalendarRow[];
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
  const { data, error } = await supabase
    .from("sales_account_actuals").select("*")
    .order("year", { ascending: true }).order("month", { ascending: true })
    .limit(10000);
  if (error) { console.error("fetchAccountActuals error:", error); return []; }
  return (data ?? []) as AccountActual[];
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
export function mergeForecastWithDb<T extends { label: string; totalCases: number; revenue: number }>(
  forecast: T[],
  dbAgg: Record<string, DbMonthAgg>,
): T[] {
  return forecast.map(f => {
    const agg = dbAgg[f.label];
    if (!agg) return f;
    return {
      ...f,
      baseCases: agg.totalCases, velDelta: 0, acctDelta: 0, newSkuDelta: 0,
      totalCases: agg.totalCases, revenue: Math.round(agg.revenue),
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
