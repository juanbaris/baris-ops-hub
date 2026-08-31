// ─── Core constants ──────────────────────────────────────────────────────────
export const WEEKS_PER_MONTH = 4.345;
export const UNITS_PER_CASE = 8;
export const PRICE_PER_CASE = 36.96;
export const IMPLIED_ANNUAL_2026 = 55000;
export const GROWTH = 1.0;

export type Scenario = "Pessimistic" | "Normal" | "Optimistic";
export const SCENARIO_ANNUAL_CASES: Record<Scenario, number> = {
  Pessimistic: 36000, Normal: 55000, Optimistic: 77000,
};

export const DEFAULT_SEASON_IDX: Record<number, number> = {
  1: 0.52, 2: 0.64, 3: 1.12, 4: 1.23, 5: 1.17, 6: 1.33,
  7: 0.89, 8: 1.25, 9: 0.86, 10: 0.98, 11: 0.88, 12: 1.13,
};
const DEFAULT_PROMO_MULTIPLIERS = Array(12).fill(1);

export const SKU_MIX: Record<string, number> = {
  XD: 0.30, PW: 0.25, HM: 0.18, WM: 0.12, WD: 0.08, Matcha: 0.07,
};
export const DEFAULT_MIX_PCT: Record<string, number> = {
  XD: 30, PW: 25, HM: 18, WM: 12, WD: 8, Matcha: 7,
};

// ─── New SKU type ─────────────────────────────────────────────────────────────
export type NewSku = {
  name: string; stores: number; vel: number; entry: number; active: boolean;
  committed?: boolean;
  cannibalizesMatcha?: boolean;
  skuVel?: number[];
};

export const DEFAULT_NEW_SKUS: NewSku[] = [
  { name: "Strawberry & White",  stores: 404, vel: 1.20, entry: 3, active: false, committed: false, cannibalizesMatcha: false },
  { name: "Strawberry Caramel",  stores: 404, vel: 1.20, entry: 4, active: false, committed: false, cannibalizesMatcha: false },
  { name: "Strawberry Yogurt",   stores: 404, vel: 1.00, entry: 5, active: false, committed: false, cannibalizesMatcha: false },
  { name: "Raspberry Yogurt",    stores: 404, vel: 1.00, entry: 6, active: false, committed: false, cannibalizesMatcha: false },
];
export const NEW_SKU_COLORS = ["#EC4899", "#F97316", "#14B8A6", "#A855F7"];

export function newSkuCases(sku: NewSku, idx: number) {
  const monthsIn = idx - (sku.entry - 1);
  if (monthsIn < 0) return 0;
  const ramp = monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0;
  return Math.round(sku.stores * sku.vel * WEEKS_PER_MONTH / UNITS_PER_CASE * ramp);
}

// ─── Months ───────────────────────────────────────────────────────────────────
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

// ─── Velocity chains ──────────────────────────────────────────────────────────
export type VelChain = { name: string; stores: number; velCurrent: number; lastWeek: number };
export const DEFAULT_VEL_CHAINS: VelChain[] = [
  { name: "Sprouts",              stores: 404, velCurrent: 1.39, lastWeek: 1.20 },
  { name: "Whole Foods",          stores: 60,  velCurrent: 8.09, lastWeek: 9.40 },
  { name: "GoPuff",               stores: 80,  velCurrent: 2.84, lastWeek: 2.10 },
  { name: "INFRA/Independientes", stores: 41,  velCurrent: 2.15, lastWeek: 2.00 },
];

export const NEW_RETAILERS = [
  { name: "Whole Foods expansion", stores: 100, vel: 8.09, entry: 3, note: "Today 60 stores" },
  { name: "Raley's",               stores: 80,  vel: 1.50, entry: 4, note: "Regional NoCal/Nevada" },
  { name: "Kroger",                stores: 300, vel: 1.50, entry: 6, note: "Mayor chain convencional" },
  { name: "Walmart",               stores: 500, vel: 1.20, entry: 8, note: "Nacional Frozen" },
  { name: "Costco",                stores: 50,  vel: 3.00, entry: 6, note: "Club — alta velocidad" },
  { name: "Publix",                stores: 150, vel: 1.50, entry: 9, note: "South East" },
  { name: "Target",                stores: 400, vel: 1.20, entry: 10, note: "Nacional convencional" },
];

// ─── Forecast calculation ─────────────────────────────────────────────────────
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
  promoMultipliers: number[] = DEFAULT_PROMO_MULTIPLIERS,
  retVelBySku?: (number[] | null)[],
) {
  const velDelta = velChains.reduce((s, chain, i) => {
    if (!velActive[i]) return s;
    return s + Math.round((velNew[i] - chain.velCurrent) * chain.stores * WEEKS_PER_MONTH / UNITS_PER_CASE);
  }, 0);

  return FORECAST_MONTHS.map((m, idx) => {
    const promoMult = promoMultipliers[idx] ?? 1;
    const baseCases = Math.round(
      (SCENARIO_ANNUAL_CASES[scenario] / 12) * (seasonIdx[m.month] ?? 1) * promoMult
    );
    const acctDelta = NEW_RETAILERS.reduce((s, retailer, ri) => {
      if (!retailerActive[ri]) return s;
      const monthsIn = idx - (retailerEntry[ri] - 2);
      if (monthsIn < 0) return s;
      const skuVels = retVelBySku?.[ri];
      const vel = skuVels != null ? skuVels.reduce((sum, v) => sum + v, 0) : retailerVel[ri];
      return s + Math.round(retailerStores[ri] * vel * WEEKS_PER_MONTH / UNITS_PER_CASE * 1.2);
    }, 0);
    const newSkuDelta = newSkus.reduce((s, sku) => {
      if (!sku.active || sku.cannibalizesMatcha) return s;
      return s + newSkuCases(sku, idx);
    }, 0);
    const totalCases = baseCases + velDelta + acctDelta + newSkuDelta;
    const budgetCases = Math.round(
      (SCENARIO_ANNUAL_CASES.Pessimistic / 12) * (seasonIdx[m.month] ?? 1) * promoMult
    );
    return {
      ...m, baseCases, velDelta, acctDelta, newSkuDelta, totalCases,
      revenue: Math.round(totalCases * PRICE_PER_CASE),
      budget: Math.round(budgetCases * PRICE_PER_CASE),
      budgetCases,
    };
  });
}

export type ForecastRow = ReturnType<typeof calcForecast>[number];

export function skuForecast(forecast: ForecastRow[]): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(SKU_MIX).map(([sku, pct]) => [sku, forecast.map(f => Math.round(f.totalCases * pct))]),
  );
}

export function skuForecastByMonthKey(forecast: ForecastRow[]): Record<string, Record<string, number>> {
  const bySku = skuForecast(forecast);
  const out: Record<string, Record<string, number>> = {};
  for (const [sku, arr] of Object.entries(bySku)) {
    out[sku] = {};
    forecast.forEach((f, i) => { out[sku][`${f.year}-${String(f.month).padStart(2, "0")}`] = arr[i] ?? 0; });
  }
  return out;
}

// ─── Forecast state (localStorage + Supabase sync) ──────────────────────────
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
  retVelBySku?: (number[] | null)[];
  newSkus?: NewSku[];
  velCommitted?: boolean[];
  retCommitted?: boolean[];
  skuCommitted?: boolean[];
  mixCommitted?: boolean;
  mixOverrides?: Record<string, Record<string, number>>;
  mixOverrideActive?: boolean;
  committedAt?: string | null;
  promoMultipliers?: number[];
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
  retVelBySku: NEW_RETAILERS.map(() => null),
  newSkus: DEFAULT_NEW_SKUS,
  velCommitted: DEFAULT_VEL_CHAINS.map(() => false),
  retCommitted: NEW_RETAILERS.map(() => false),
  skuCommitted: DEFAULT_NEW_SKUS.map(() => false),
  mixCommitted: false,
  mixOverrides: {},
  mixOverrideActive: false,
  committedAt: null,
  promoMultipliers: Array(12).fill(1),
};

const STORAGE_KEY = "baris.sales.forecast.v1";
const SUPABASE_KEY = "sales_forecast_state";
const EVENT = "baris:forecast-changed";

export function loadForecastState(): ForecastState {
  if (typeof window === "undefined") return DEFAULT_FORECAST_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORECAST_STATE;
    return { ...DEFAULT_FORECAST_STATE, ...JSON.parse(raw) } as ForecastState;
  } catch { return DEFAULT_FORECAST_STATE; }
}

export function saveForecastState(state: ForecastState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {}
  // Also persist committed state to Supabase for cross-user sync
  _syncToSupabase(state);
}

// ─── Supabase sync: committed levers persist for all users ──────────────────
let _supabase: any = null;
let _syncTimeout: any = null;

export function initForecastSupabase(supabaseClient: any) {
  _supabase = supabaseClient;
}

function _syncToSupabase(state: ForecastState) {
  if (!_supabase) return;
  // Debounce: only sync 500ms after last change
  clearTimeout(_syncTimeout);
  _syncTimeout = setTimeout(async () => {
    try {
      await _supabase.from("ops_published").upsert({
        key: SUPABASE_KEY,
        value: state,
        published_at: new Date().toISOString(),
      });
    } catch (e: any) { console.error("Forecast sync error:", e); }
  }, 500);
}

export async function loadForecastFromSupabase(): Promise<ForecastState | null> {
  if (!_supabase) return null;
  try {
    const { data, error } = await _supabase.from("ops_published").select("value").eq("key", SUPABASE_KEY).maybeSingle();
    if (error || !data?.value || typeof data.value !== "object") return null;
    return { ...DEFAULT_FORECAST_STATE, ...data.value } as ForecastState;
  } catch { return null; }
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
    s.scenario, s.velActive, s.velNew, s.retActive, s.retStores, s.retVel, s.retEntry,
    s.velChains, s.seasonIdx, s.newSkus ?? [],
    s.promoMultipliers ?? DEFAULT_PROMO_MULTIPLIERS,
    s.retVelBySku,
  );
}

export const MIX_SKUS = ["XD", "PW", "HM", "WM", "WD", "Matcha"] as const;

export function committedLeverCount(s: ForecastState) {
  const vel = (s.velCommitted ?? []).filter(Boolean).length;
  const ret = (s.retCommitted ?? []).filter(Boolean).length;
  const sku = (s.skuCommitted ?? []).filter((c, i) => c && (s.newSkus ?? [])[i]?.active).length;
  return { vel, ret, sku, mix: !!s.mixCommitted, total: vel + ret + sku + (s.mixCommitted ? 1 : 0) };
}

export function committedForecastFromState(s: ForecastState) {
  const velC = s.velCommitted ?? [];
  const retC = s.retCommitted ?? [];
  const skuC = s.skuCommitted ?? [];
  if (!velC.some(Boolean) && !retC.some(Boolean) && !skuC.some(Boolean)) return null;
  return calcForecast(
    s.scenario,
    s.velActive.map((a, i) => a && !!velC[i]),
    s.velNew, s.retActive.map((a, i) => a && !!retC[i]),
    s.retStores, s.retVel, s.retEntry, s.velChains, s.seasonIdx,
    (s.newSkus ?? []).map((sk, i) => ({ ...sk, active: sk.active && !!skuC[i] })),
    s.promoMultipliers ?? DEFAULT_PROMO_MULTIPLIERS,
    s.retVelBySku,
  );
}

function skuForecastWithMix(
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
  newSkuBreakdown: { name: string; cases: number; isCannibalization?: boolean }[];
};

export function productionRequirements(
  forecast: ForecastRow[],
  newSkus: NewSku[],
  mixOverrides: Record<string, Record<string, number>> = {},
  mixOverrideActive = false,
): ProductionMonth[] {
  const bySku = skuForecastWithMix(forecast, mixOverrides, mixOverrideActive);
  return forecast.map((f, i) => {
    const matchaReduction = newSkus
      .filter(s => s.active && s.cannibalizesMatcha)
      .reduce((sum, s) => sum + newSkuCases(s, i), 0);
    const skuBreakdown = Object.fromEntries(
      MIX_SKUS.map(s => [
        s,
        s === 'Matcha'
          ? Math.max(0, (bySku[s]?.[i] ?? 0) - matchaReduction)
          : (bySku[s]?.[i] ?? 0),
      ])
    );
    return {
      label: f.label, month: f.month, year: f.year, totalCases: f.totalCases,
      skuBreakdown,
      newSkuBreakdown: newSkus.filter(s => s.active).map(s => ({
        name: s.name,
        cases: newSkuCases(s, i),
        isCannibalization: !!s.cannibalizesMatcha,
      })),
    };
  });
}
