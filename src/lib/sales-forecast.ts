// ─── Shared sales forecast engine ────────────────────────────────────────────
// Single source of truth for the demand forecast. The Sales module edits this
// state; Operations (Procurement Planning / stock WoH) consumes the result.

export const PRICE_PER_CASE = 37;
export const UNITS_PER_CASE = 8;
export const WEEKS_PER_MONTH = 4.33;
// Normal scenario 12-month total (Aug 2026 → Jul 2027), used for reference.
export const IMPLIED_ANNUAL_2026 = 102242;

// Updated seasonality from Excel budget model (Aug 2026 revision).
// Source: Assumptions sheet · 1.0 = average month · sum = 12.0
export const DEFAULT_SEASON_IDX: Record<number, number> = {
  1: 0.80,  // Jan — Post-holiday
  2: 0.92,  // Feb — Valentine mini-peak
  3: 1.08,  // Mar — Spring reset
  4: 1.18,  // Apr — Spring momentum
  5: 1.25,  // May — Pre-summer
  6: 1.28,  // Jun — Summer peak
  7: 1.22,  // Jul — Summer peak DC reorders
  8: 1.00,  // Aug — Back-to-school (base)
  9: 0.88,  // Sep — Fall slowdown
  10: 0.82, // Oct — Autumn
  11: 0.82, // Nov — Holiday flat
  12: 0.75, // Dec — DC space tight
};

// Growth rates vs 2025 actuals, for reference only.
// Actual base cases come from SCENARIO_BASE_CASES below.
export const GROWTH = { Pessimistic: -0.30, Normal: 0.43, Optimistic: 0.80 };
export type Scenario = keyof typeof GROWTH;

// ─── Explicit monthly base cases per scenario ─────────────────────────────────
// Source: budgets_actualizados.xlsx (Aug 2026 revision)
//   Pessimistic = Best Estimate budget column ÷ $37 (baseline, no growth)
//   Normal      = Scenario Selector "Normal" values (+43% → $2.5M 2026)
//   Optimistic  = Normal × 1.12 ($2.8M/$2.5M revenue target ratio)
// Order: Aug 2026, Sep, Oct, Nov, Dec, Jan 2027, Feb, Mar, Apr, May, Jun, Jul 2027
export const SCENARIO_BASE_CASES: Record<Scenario, readonly number[]> = {
  Pessimistic: [4530, 5955, 7866, 7382, 6855, 4300, 6290, 6032, 3461, 8584, 5068, 5668],
  Normal:      [7397, 9764, 9098, 9098, 9709, 5917, 6805, 7988, 8728, 9246, 9468, 9024],
  Optimistic:  [8285, 10936, 10190, 10190, 10874, 6627, 7622, 8947, 9775, 10356, 10604, 10107],
};

export const SKU_MIX: Record<string, number> = { XD: 0.30, PW: 0.25, HM: 0.18, WM: 0.12, WD: 0.08, Matcha: 0.07 };

export type NewSku = { name: string; stores: number; vel: number; entry: number; active: boolean; committed?: boolean };
export const DEFAULT_NEW_SKUS: NewSku[] = [
  { name: "Strawberry & White", stores: 50, vel: 1.20, entry: 3, active: false, committed: false },
  { name: "Strawberry Caramel", stores: 50, vel: 1.20, entry: 4, active: false, committed: false },
  { name: "Strawberry Yogurt", stores: 50, vel: 1.00, entry: 5, active: false, committed: false },
  { name: "Raspberry Yogurt", stores: 50, vel: 1.00, entry: 6, active: false, committed: false },
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
  seasonIdx: Record<number, number> = DEFAULT_SEASON_IDX, // retained for API compat
  newSkus: NewSku[] = [],
) {
  const velDelta = velChains.reduce((s, chain, i) => {
    if (!velActive[i]) return s;
    return s + Math.round((velNew[i] - chain.velCurrent) * chain.stores * WEEKS_PER_MONTH / UNITS_PER_CASE);
  }, 0);

  return FORECAST_MONTHS.map((m, idx) => {
    // Base cases come from the explicit Excel scenario table (exact monthly values).
    const baseCases = SCENARIO_BASE_CASES[scenario][idx];

    const acctDelta = NEW_RETAILERS.reduce((s, retailer, ri) => {
      if (!retailerActive[ri]) return s;
      const monthsIn = idx - (retailerEntry[ri] - 1);
      if (monthsIn < 0) return s;
      const ramp = monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0;
      return s + Math.round(retailerStores[ri] * retailerVel[ri] * WEEKS_PER_MONTH / UNITS_PER_CASE * ramp);
    }, 0);

    const newSkuDelta = newSkus.reduce((s, sku) => (sku.active ? s + newSkuCases(sku, idx) : s), 0);

    const totalCases = baseCases + velDelta + acctDelta + newSkuDelta;
    // Budget = Normal scenario (used for "vs Budget" column in Detalle tab).
    const budgetCases = SCENARIO_BASE_CASES.Normal[idx];

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
  /** Committed ("SET") levers — the official production/finance scenario. */
  velCommitted?: boolean[];
  retCommitted?: boolean[];
  skuCommitted?: boolean[];
  mixCommitted?: boolean;
  mixOverrides?: Record<string, Record<string, number>>;
  mixOverrideActive?: boolean;
  committedAt?: string | null;
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
  velCommitted: DEFAULT_VEL_CHAINS.map(() => false),
  retCommitted: NEW_RETAILERS.map(() => false),
  skuCommitted: DEFAULT_NEW_SKUS.map(() => false),
  mixCommitted: false,
  mixOverrides: {},
  mixOverrideActive: false,
  committedAt: null,
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

// ─── Committed ("SET") scenario ──────────────────────────────────────────────

export const MIX_SKUS = ["XD", "PW", "HM", "WM", "WD", "Matcha"] as const;
export const DEFAULT_MIX_PCT: Record<string, number> = { XD: 30, PW: 25, HM: 18, WM: 12, WD: 8, Matcha: 7 };

/** How many levers the user locked in with SET. */
export function committedLeverCount(s: ForecastState) {
  const vel = (s.velCommitted ?? []).filter((c, i) => c && s.velActive[i]).length;
  const ret = (s.retCommitted ?? []).filter((c, i) => c && s.retActive[i]).length;
  const sku = (s.skuCommitted ?? []).filter((c, i) => c && (s.newSkus ?? [])[i]?.active).length;
  return vel + ret + sku + (s.mixCommitted ? 1 : 0);
}

/** Forecast built from committed levers only. Null when nothing is committed. */
export function committedForecastFromState(s: ForecastState) {
  if (committedLeverCount(s) === 0) return null;
  const velC = s.velCommitted ?? [];
  const retC = s.retCommitted ?? [];
  const skuC = s.skuCommitted ?? [];
  return calcForecast(
    s.scenario,
    s.velActive.map((a, i) => a && !!velC[i]), s.velNew,
    s.retActive.map((a, i) => a && !!retC[i]), s.retStores, s.retVel, s.retEntry,
    s.velChains, s.seasonIdx,
    (s.newSkus ?? []).map((sk, i) => ({ ...sk, active: sk.active && !!skuC[i] })),
  );
}

/** Existing-SKU cases per month, honouring a per-month mix override. */
export function skuForecastWithMix(
  forecast: ForecastRow[],
  mixOverrides: Record<string, Record<string, number>> = {},
  mixOverrideActive = false,
): Record<string, number[]> {
  const base = forecast.map(f => f.totalCases - (f.newSkuDelta ?? 0));
  return Object.fromEntries(MIX_SKUS.map(sku => [
    sku,
    forecast.map((f, i) => {
      const pct = mixOverrideActive
        ? (mixOverrides[f.label]?.[sku] ?? DEFAULT_MIX_PCT[sku])
        : DEFAULT_MIX_PCT[sku];
      return Math.round(base[i] * (pct / 100));
    }),
  ]));
}

export type ProductionMonth = {
  label: string; month: number; year: number; totalCases: number;
  skuBreakdown: Record<string, number>;
  newSkuBreakdown: { name: string; cases: number }[];
};

/** Per-SKU production requirement per month for a given forecast. */
export function productionRequirements(
  forecast: ForecastRow[],
  newSkus: NewSku[],
  mixOverrides: Record<string, Record<string, number>> = {},
  mixOverrideActive = false,
): ProductionMonth[] {
  const bySku = skuForecastWithMix(forecast, mixOverrides, mixOverrideActive);
  return forecast.map((f, i) => ({
    label: f.label, month: f.month, year: f.year, totalCases: f.totalCases,
    skuBreakdown: Object.fromEntries(MIX_SKUS.map(s => [s, bySku[s]?.[i] ?? 0])),
    newSkuBreakdown: newSkus.filter(s => s.active).map(s => ({ name: s.name, cases: newSkuCases(s, i) })),
  }));
}
