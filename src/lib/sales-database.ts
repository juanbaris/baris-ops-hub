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
