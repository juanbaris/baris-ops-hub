// ─── Shared sales forecast engine ────────────────────────────────────────────
// Single source of truth for the demand forecast. The Sales module edits this
// state; Operations (Procurement Planning / stock WoH) consumes the result.

export const PRICE_PER_CASE = 37;
export const UNITS_PER_CASE = 8;
export const WEEKS_PER_MONTH = 4.33;
export const IMPLIED_ANNUAL_2026 = 62113;

export const DEFAULT_SEASON_IDX: Record<number, number> = {
  1: 0.21, 2: 1.40, 3: 1.39, 4: 1.64, 5: 0.72, 6: 1.47,
  7: 0.68, 8: 0.65, 9: 1.48, 10: 0.76, 11: 0.26, 12: 1.33,
};
export const GROWTH = { Pessimistic: 0.0, Normal: 0.15, Optimistic: 0.25 };
export type Scenario = keyof typeof GROWTH;

export const SKU_MIX: Record<string, number> = { XD: 0.30, PW: 0.25, HM: 0.18, WM: 0.12, WD: 0.08, Matcha: 0.07 };

export type NewSku = { name: string; stores: number; vel: number; entry: number; active: boolean; committed?: boolean };
export const DEFAULT_NEW_SKUS: NewSku[] = [
  { name: "Frutilla & White", stores: 50, vel: 1.20, entry: 3, active: false, committed: false },
  { name: "Frutilla Caramel", stores: 50, vel: 1.20, entry: 4, active: false, committed: false },
  { name: "Frutilla Yogur", stores: 50, vel: 1.00, entry: 5, active: false, committed: false },
  { name: "Frambusa Yogur", stores: 50, vel: 1.00, entry: 6, active: false, committed: false },
];
export const NEW_SKU_COLORS = ["#EC4899", "#F97316", "#14B8A6", "#A855F7"];

/** Incremental cases for one new SKU in forecast month `idx` (0-based). */
export function newSkuCases(sku: NewSku, idx: number) {
  const monthsIn = idx - (sku.entry - 1);
  if (monthsIn < 0) return 0;
  const ramp = monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0;
  return Math.round(sku.stores * sku.vel * WEEKS_PER_MONTH / UNITS_PER_CASE * ramp);
}

export const FORECAST_MONTHS = [
  { label: "Aug 2026", month: 8, year: 2026, yoy2025: 1384 },
  { label: "Sep 2026", month: 9, year: 2026, yoy2025: 2728 },
  { label: "Oct 2026", month: 10, year: 2026, yoy2025: 1386 },
  { label: "Nov 2026", month: 11, year: 2026, yoy2025: 489 },
  { label: "Dec 2026", month: 12, year: 2026, yoy2025: 2452 },
  { label: "Jan 2027", month: 1, year: 2027, yoy2025: 388 },
  { label: "Feb 2027", month: 2, year: 2027, yoy2025: 2582 },
  { label: "Mar 2027", month: 3, year: 2027, yoy2025: 2562 },
  { label: "Apr 2027", month: 4, year: 2027, yoy2025: 3021 },
  { label: "May 2027", month: 5, year: 2027, yoy2025: 1314 },
  { label: "Jun 2027", month: 6, year: 2027, yoy2025: 2710 },
  { label: "Jul 2027", month: 7, year: 2027, yoy2025: 1242 },
];

export type VelChain = { name: string; stores: number; velCurrent: number; lastWeek: number };
export const DEFAULT_VEL_CHAINS: VelChain[] = [
  { name: "Sprouts", stores: 404, velCurrent: 1.39, lastWeek: 1.20 },
  { name: "Whole Foods", stores: 60, velCurrent: 8.09, lastWeek: 9.40 },
  { name: "GoPuff", stores: 80, velCurrent: 2.84, lastWeek: 2.10 },
  { name: "INFRA/Independientes", stores: 41, velCurrent: 2.15, lastWeek: 2.00 },
];

export const NEW_RETAILERS = [
  { name: "Whole Foods expansion", stores: 100, vel: 8.09, entry: 3, note: "Today 60 stores" },
  { name: "Raley's", stores: 80, vel: 1.50, entry: 4, note: "Regional NoCal/Nevada" },
  { name: "Kroger", stores: 300, vel: 1.50, entry: 6, note: "Mayor chain convencional" },
  { name: "Walmart", stores: 500, vel: 1.20, entry: 8, note: "Nacional Frozen" },
  { name: "Costco", stores: 50, vel: 3.00, entry: 6, note: "Club — alta velocidad" },
  { name: "Publix", stores: 150, vel: 1.50, entry: 9, note: "South East" },
  { name: "Target", stores: 400, vel: 1.20, entry: 10, note: "Nacional convencional" },
];

export function calcForecast(
  scenario: Scenario,
  velActive: boolean[],
  velNew: number[],
  retailerActive: boolean[],
  retailerStores: number[],
  retailerVel: number[],
  retailerEntry: number[],
  velChains: VelChain[] = DEFAULT_VEL_CHAINS,
  seasonIdx: Record<number, number> = DEFAULT_SEASON_IDX,
  newSkus: NewSku[] = [],
) {
  const growth = GROWTH[scenario];
  const base = IMPLIED_ANNUAL_2026 * (1 + growth);

  const velDelta = velChains.reduce((s, chain, i) => {
    if (!velActive[i]) return s;
    return s + Math.round((velNew[i] - chain.velCurrent) * chain.stores * WEEKS_PER_MONTH / UNITS_PER_CASE);
  }, 0);

  return FORECAST_MONTHS.map((m, idx) => {
    const baseCases = Math.round((base / 12) * (seasonIdx[m.month] ?? 1));

    const acctDelta = NEW_RETAILERS.reduce((s, retailer, ri) => {
      if (!retailerActive[ri]) return s;
      const monthsIn = idx - (retailerEntry[ri] - 1);
      if (monthsIn < 0) return s;
      const ramp = monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0;
      return s + Math.round(retailerStores[ri] * retailerVel[ri] * WEEKS_PER_MONTH / UNITS_PER_CASE * ramp);
    }, 0);

    const newSkuDelta = newSkus.reduce((s, sku) => (sku.active ? s + newSkuCases(sku, idx) : s), 0);

    const totalCases = baseCases + velDelta + acctDelta + newSkuDelta;
    const budgetCases = Math.round((IMPLIED_ANNUAL_2026 * (1 + GROWTH.Normal) / 12) * (seasonIdx[m.month] ?? 1));

    return {
      ...m,
      baseCases,
      velDelta,
      acctDelta,
      newSkuDelta,
      totalCases,
      revenue: Math.round(totalCases * PRICE_PER_CASE),
      budget: Math.round(budgetCases * PRICE_PER_CASE),
      budgetCases,
    };
  });
}

export type ForecastRow = ReturnType<typeof calcForecast>[number];

/** Per-SKU cases for each forecast month, derived from the SKU mix. */
export function skuForecast(forecast: ForecastRow[]): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(SKU_MIX).map(([sku, pct]) => [sku, forecast.map(f => Math.round(f.totalCases * pct))]),
  );
}

/** Per-SKU cases keyed by "YYYY-M" so any module can look up an arbitrary month. */
export function skuForecastByMonthKey(forecast: ForecastRow[]): Record<string, Record<string, number>> {
  const bySku = skuForecast(forecast);
  const out: Record<string, Record<string, number>> = {};
  for (const [sku, arr] of Object.entries(bySku)) {
    out[sku] = {};
    forecast.forEach((f, i) => { out[sku][`${f.year}-${f.month}`] = arr[i] ?? 0; });
  }
  return out;
}

// ─── Shared (cross-module) forecast state ────────────────────────────────────
export type ForecastState = {
  scenario: Scenario;
  seasonIdx: Record<number, number>;
  velChains: VelChain[];
  velActive: boolean[];
  velNew: number[];
  retActive: boolean[];
  retStores: number[];
  retVel: number[];
  retEntry: number[];
  newSkus?: NewSku[];
};

export const DEFAULT_FORECAST_STATE: ForecastState = {
  scenario: "Normal",
  seasonIdx: DEFAULT_SEASON_IDX,
  velChains: DEFAULT_VEL_CHAINS,
  velActive: DEFAULT_VEL_CHAINS.map(() => false),
  velNew: DEFAULT_VEL_CHAINS.map(c => c.velCurrent),
  retActive: NEW_RETAILERS.map(() => false),
  retStores: NEW_RETAILERS.map(r => r.stores),
  retVel: NEW_RETAILERS.map(r => r.vel),
  retEntry: NEW_RETAILERS.map(r => r.entry),
  newSkus: DEFAULT_NEW_SKUS,
};

const STORAGE_KEY = "baris.sales.forecast.v1";
const EVENT = "baris:forecast-changed";

export function loadForecastState(): ForecastState {
  if (typeof window === "undefined") return DEFAULT_FORECAST_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORECAST_STATE;
    return { ...DEFAULT_FORECAST_STATE, ...JSON.parse(raw) } as ForecastState;
  } catch {
    return DEFAULT_FORECAST_STATE;
  }
}

export function saveForecastState(state: ForecastState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch { /* ignore quota errors */ }
}

export function subscribeForecast(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function forecastFromState(s: ForecastState) {
  return calcForecast(
    s.scenario, s.velActive, s.velNew,
    s.retActive, s.retStores, s.retVel, s.retEntry,
    s.velChains, s.seasonIdx, s.newSkus ?? [],
  );
}
