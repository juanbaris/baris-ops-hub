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

// ─── Simulator overlays (temporary "what-if" plays over the Promo Calendar) ───
// Applied on top of the real Promo Calendar rows before aggregation. Never touch
// the DB until the user explicitly applies them.
//
// new_stores: adds stores to an account/SKU set from a given month. The velocity
// and weeks are NOT entered — each month reuses whatever that account/SKU already
// has in the Promo Calendar, so extra stores simply scale the units up. Optional
// storesPerMonth ramps the added stores (e.g. +10/month up to a cap).
export type SimPlay =
  | {
      id: string; kind: "new_stores"; active: boolean; label: string;
      account: string; skus: string[];
      addStores: number;                 // stores added (target, or cap if ramping)
      storesPerMonth?: number;           // if set, ramp: add this many per month up to addStores
      fromYear: number; fromMonth: number;
    }
  | {
      id: string; kind: "vel_bump"; active: boolean; label: string;
      account: string; skus: string[]; pct: number;   // +10 => +10%
      pctPerMonth?: number;               // if set, compound this % each month
      fromYear: number; fromMonth: number;
    };

const WEEKS_PER_MONTH_DEFAULT = 4.345;
function ym(year: number, month: number) { return year * 12 + month; }

// stores added in the given month for a ramping/flat new_stores play
function storesAddedAt(p: Extract<SimPlay, {kind:"new_stores"}>, monthsElapsed: number): number {
  if (!p.storesPerMonth || p.storesPerMonth <= 0) return p.addStores;
  return Math.min(p.addStores, p.storesPerMonth * (monthsElapsed + 1));
}

// cumulative pct bump in the given month for a ramping/flat vel_bump play
function pctAt(p: Extract<SimPlay, {kind:"vel_bump"}>, monthsElapsed: number): number {
  if (!p.pctPerMonth || p.pctPerMonth <= 0) return p.pct;
  // linear accumulation of pctPerMonth, capped at pct if pct>0
  const acc = p.pctPerMonth * (monthsElapsed + 1);
  return p.pct > 0 ? Math.min(p.pct, acc) : acc;
}

// Returns modified rows reflecting the active plays (velocity/units scaled in place).
export function applySimPlays(rows: PromoCalendarRow[], plays: SimPlay[]): PromoCalendarRow[] {
  const active = plays.filter(p => p.active);
  if (!active.length) return rows;

  return rows.map(r => {
    let units = r.total_units ?? 0;
    let stores = r.stores ?? 0;
    let touched = false;

    for (const p of active) {
      const elapsed = ym(r.year, r.month) - ym(p.fromYear, p.fromMonth);
      if (elapsed < 0) continue;

      if (p.kind === "vel_bump") {
        if (p.account !== r.account_name || !p.skus.includes(r.sku_code)) continue;
        const pct = pctAt(p, elapsed);
        units = units * (1 + pct / 100);
        touched = true;
      } else { // new_stores — add stores, keep this month's velocity, scale units
        if (p.account !== r.account_name || !p.skus.includes(r.sku_code)) continue;
        const added = storesAddedAt(p, elapsed);
        const baseStores = r.stores ?? 0;
        if (baseStores > 0) {
          const ratio = (baseStores + added) / baseStores;
          units = units * ratio;
          stores = baseStores + added;
        } else {
          // no existing stores that month → can't infer velocity; leave as is
        }
        touched = true;
      }
    }
    return touched ? { ...r, total_units: Math.round(units * 1000) / 1000, stores } : r;
  });
}

export function hasActivePlays(plays: SimPlay[]) { return plays.some(p => p.active); }

// Persist active new_stores plays into the Promo Calendar by writing the
// scaled rows they produce (base row × store ratio) as real data.
export function playsToPromoRows(rows: PromoCalendarRow[], plays: SimPlay[]): Partial<PromoCalendarRow>[] {
  const newStorePlays = plays.filter(x => x.active && x.kind === "new_stores");
  if (!newStorePlays.length) return [];
  const applied = applySimPlays(rows, newStorePlays);
  // Return only the rows that changed (upsert-style patches keyed by identity).
  const baseById = new Map(rows.map(r => [r.id, r]));
  const out: Partial<PromoCalendarRow>[] = [];
  for (const r of applied) {
    const orig = baseById.get(r.id);
    if (orig && (orig.total_units !== r.total_units || orig.stores !== r.stores)) {
      out.push({ year: r.year, month: r.month, account_name: r.account_name, sku_code: r.sku_code,
        distributor: r.distributor, stores: r.stores, reg_avg_vel: r.reg_avg_vel, weeks: r.weeks,
        total_units: r.total_units, reg_units: r.total_units, promo_units: r.promo_units ?? 0 });
    }
  }
  return out;
}

// Incremental impact of a single play (cases + revenue) over the base Promo Calendar,
// derived from the diff between applying just this play and the base rows.
export function computePlayImpact(play: SimPlay, rows: PromoCalendarRow[], accounts: SalesAccount[]): { cases: number; revenue: number } {
  if (!play.active) return { cases: 0, revenue: 0 };
  const costMap = new Map<string, number>();
  accounts.forEach(a => costMap.set(`${a.year}|${a.account_name}`, a.delivered_cost));
  const costOf = (r: PromoCalendarRow) => costMap.get(`${r.year}|${r.account_name}`) ?? DEFAULT_DELIVERED_COST[r.distributor] ?? 4.62;

  const applied = applySimPlays(rows, [play]);
  const baseById = new Map(rows.map(r => [r.id, r]));
  let cases = 0, revenue = 0;
  for (const r of applied) {
    const orig = baseById.get(r.id);
    const deltaUnits = (r.total_units ?? 0) - (orig?.total_units ?? 0);
    if (deltaUnits === 0) continue;
    cases += deltaUnits / UNITS_PER_CASE;
    revenue += deltaUnits * costOf(r);
  }
  return { cases: Math.round(cases), revenue: Math.round(revenue) };
}

// Per-month incremental cases from active plays, derived from the diff.
export function playsMonthlyCaseDelta(
  rows: PromoCalendarRow[], accounts: SalesAccount[], plays: SimPlay[],
): Record<string, number> {
  const active = plays.filter(p => p.active);
  const out: Record<string, number> = {};
  if (!active.length) return out;
  const applied = applySimPlays(rows, active);
  const baseById = new Map(rows.map(r => [r.id, r]));
  for (const r of applied) {
    const orig = baseById.get(r.id);
    const deltaUnits = (r.total_units ?? 0) - (orig?.total_units ?? 0);
    if (deltaUnits === 0) continue;
    const label = monthLabel(r.year, r.month);
    out[label] = (out[label] ?? 0) + deltaUnits / UNITS_PER_CASE;
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
