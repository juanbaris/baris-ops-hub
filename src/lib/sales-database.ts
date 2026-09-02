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

// ─── Simulator overlays (temporary "what-if" plays over the Promo Calendar) ───
// Two kinds of play, applied on top of the real Promo Calendar rows before
// aggregation. They never touch the DB until the user explicitly applies them.
export type SimPlay =
  | {
      id: string; kind: "new_stores"; active: boolean; label: string;
      account: string; distributor: Distributor; skus: string[];
      stores: number; vel: number; weeks: number;
      fromYear: number; fromMonth: number; // effective from this month onward
    }
  | {
      id: string; kind: "vel_bump"; active: boolean; label: string;
      account: string; sku: string; pct: number; // e.g. +10 => +10%
      fromYear: number; fromMonth: number;
    };

const WEEKS_PER_MONTH_DEFAULT = 4.345;
function ym(year: number, month: number) { return year * 12 + month; }

// Returns synthetic + modified rows reflecting the active plays.
export function applySimPlays(rows: PromoCalendarRow[], plays: SimPlay[]): PromoCalendarRow[] {
  const active = plays.filter(p => p.active);
  if (!active.length) return rows;

  // 1) velocity bumps modify existing rows from their effective month onward
  const out = rows.map(r => {
    let units = r.total_units ?? 0;
    let touched = false;
    for (const p of active) {
      if (p.kind !== "vel_bump") continue;
      if (p.account !== r.account_name || p.sku !== r.sku_code) continue;
      if (ym(r.year, r.month) < ym(p.fromYear, p.fromMonth)) continue;
      units = units * (1 + p.pct / 100);
      touched = true;
    }
    return touched ? { ...r, total_units: Math.round(units * 1000) / 1000 } : r;
  });

  // 2) new-store plays add synthetic rows from their effective month to Dec 2028
  const synthetic: PromoCalendarRow[] = [];
  for (const p of active) {
    if (p.kind !== "new_stores") continue;
    for (let mm = ym(p.fromYear, p.fromMonth); mm <= ym(2028, 12); mm++) {
      const year = Math.floor((mm - 1) / 12);
      const month = ((mm - 1) % 12) + 1;
      if (year < 2027) continue;
      for (const sku of p.skus) {
        const units = p.stores * p.vel * (p.weeks || WEEKS_PER_MONTH_DEFAULT);
        synthetic.push({
          id: `sim-${p.id}-${year}-${month}-${sku}`,
          year, month, account_name: p.account, sku_code: sku,
          distributor: p.distributor, stores: p.stores, reg_avg_vel: p.vel,
          weeks: p.weeks || WEEKS_PER_MONTH_DEFAULT,
          total_units: Math.round(units * 1000) / 1000,
          reg_units: Math.round(units * 1000) / 1000, promo_units: 0,
          promo_label: null, promo_weeks: null, lift_pct: null, unit_cost: null,
          ad_dollars: null, total_cost: null, edlp_cost: null,
        } as PromoCalendarRow);
      }
    }
  }
  return [...out, ...synthetic];
}

export function hasActivePlays(plays: SimPlay[]) { return plays.some(p => p.active); }

// Convert active plays into DB rows to persist (for "Apply to Promo Calendar").
export function playsToPromoRows(plays: SimPlay[]): Partial<PromoCalendarRow>[] {
  const rows: Partial<PromoCalendarRow>[] = [];
  for (const p of plays.filter(x => x.active && x.kind === "new_stores") as Extract<SimPlay, {kind:"new_stores"}>[]) {
    for (let mm = ym(p.fromYear, p.fromMonth); mm <= ym(2028, 12); mm++) {
      const year = Math.floor((mm - 1) / 12);
      const month = ((mm - 1) % 12) + 1;
      if (year < 2027) continue;
      for (const sku of p.skus) {
        const units = p.stores * p.vel * (p.weeks || WEEKS_PER_MONTH_DEFAULT);
        rows.push({
          year, month, account_name: p.account, sku_code: sku, distributor: p.distributor,
          stores: p.stores, reg_avg_vel: p.vel, weeks: p.weeks || WEEKS_PER_MONTH_DEFAULT,
          total_units: Math.round(units * 1000) / 1000, reg_units: Math.round(units * 1000) / 1000, promo_units: 0,
        });
      }
    }
  }
  return rows;
}

// Incremental impact of a single play (cases + revenue) over the base Promo Calendar.
export function computePlayImpact(play: SimPlay, rows: PromoCalendarRow[], accounts: SalesAccount[]): { cases: number; revenue: number } {
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const costFor = (year: number, account: string, dist: Distributor) =>
    costMap.get(`${year}|${account}`) ?? DEFAULT_DELIVERED_COST[dist] ?? 4.62;

  let cases = 0, revenue = 0;
  if (!play.active) return { cases: 0, revenue: 0 };

  if (play.kind === "new_stores") {
    for (let mm = ym(play.fromYear, play.fromMonth); mm <= ym(2028, 12); mm++) {
      const year = Math.floor((mm - 1) / 12);
      const month = ((mm - 1) % 12) + 1;
      if (year < 2027) continue;
      void month;
      for (const sku of play.skus) {
        const units = play.stores * play.vel * (play.weeks || WEEKS_PER_MONTH_DEFAULT);
        cases += units / UNITS_PER_CASE;
        revenue += units * costFor(year, play.account, play.distributor);
      }
    }
  } else {
    for (const r of rows) {
      if (r.account_name !== play.account || r.sku_code !== play.sku) continue;
      if (ym(r.year, r.month) < ym(play.fromYear, play.fromMonth)) continue;
      const delta = (r.total_units ?? 0) * (play.pct / 100);
      cases += delta / UNITS_PER_CASE;
      revenue += delta * costFor(r.year, r.account_name, r.distributor);
    }
  }
  return { cases: Math.round(cases), revenue: Math.round(revenue) };
}

// Per-month incremental cases from active plays. key = month label ("Jul 2027").
export function playsMonthlyCaseDelta(
  rows: PromoCalendarRow[], accounts: SalesAccount[], plays: SimPlay[],
): Record<string, number> {
  const active = plays.filter(p => p.active);
  const out: Record<string, number> = {};
  const add = (year: number, month: number, cases: number) => {
    const label = monthLabel(year, month);
    out[label] = (out[label] ?? 0) + cases;
  };
  for (const p of active) {
    if (p.kind === "new_stores") {
      for (let mm = ym(p.fromYear, p.fromMonth); mm <= ym(2028, 12); mm++) {
        const year = Math.floor((mm - 1) / 12);
        const month = ((mm - 1) % 12) + 1;
        if (year < 2027) continue;
        for (const _sku of p.skus) {
          const units = p.stores * p.vel * (p.weeks || WEEKS_PER_MONTH_DEFAULT);
          add(year, month, units / UNITS_PER_CASE);
        }
      }
    } else {
      for (const r of rows) {
        if (r.account_name !== p.account || r.sku_code !== p.sku) continue;
        if (ym(r.year, r.month) < ym(p.fromYear, p.fromMonth)) continue;
        const delta = (r.total_units ?? 0) * (p.pct / 100);
        add(r.year, r.month, delta / UNITS_PER_CASE);
      }
    }
  }
  Object.keys(out).forEach(k => { out[k] = Math.round(out[k]); });
  return out;
}

// Merge using the OVERLAY agg (already includes plays) but expose the per-month
// delta in acctDelta so the simulator's Monthly Detail shows the extra units,
// with revenue already reflecting the boosted total at real per-account prices.
export function mergeForecastWithDbAndDelta<T extends { label: string; totalCases: number; revenue: number }>(
  forecast: T[],
  dbAggSim: Record<string, DbMonthAgg>,   // aggregation of effectivePromo (base + plays)
  dbAggBase: Record<string, DbMonthAgg>,  // aggregation of real Promo Calendar (base only)
  monthlyDelta: Record<string, number>,
  scenarioFactor = 1,
): T[] {
  return forecast.map(f => {
    const agg = dbAggSim[f.label];
    if (!agg) return f;
    const base = dbAggBase[f.label];
    const scaledTotal = Math.round(agg.totalCases * scenarioFactor);
    const scaledBase = Math.round((base?.totalCases ?? agg.totalCases) * scenarioFactor);
    const delta = monthlyDelta[f.label] ?? (scaledTotal - scaledBase);
    return {
      ...f,
      baseCases: scaledBase, velDelta: 0, acctDelta: delta, newSkuDelta: 0,
      totalCases: scaledTotal,
      revenue: Math.round(agg.revenue * scenarioFactor),
      budgetCases: Math.round(base?.totalCases ?? agg.totalCases),
      budget: Math.round(base?.revenue ?? agg.revenue),
    } as T;
  });
}
