import type { Database } from "@/integrations/supabase/types";
import { norm } from "./rates";

export type FDistMix = Database["public"]["Tables"]["logistics_forecast_distributor_mix"]["Row"];
export type FDcMix = Database["public"]["Tables"]["logistics_forecast_dc_mix"]["Row"];
export type FProfile = Database["public"]["Tables"]["logistics_forecast_shipment_profile"]["Row"];

export type ForecastBook = { distMix: FDistMix[]; dcMix: FDcMix[]; profiles: FProfile[] };

/** Sample size below which a DC average is considered unreliable. */
export const LOW_SAMPLE = 5;

/** First month shown in the logistics forecast views. */
export const FORECAST_CHART_START = "2026-01";

export type ForecastMonthInput = { label: string; month: number; year: number; totalCases: number };

export type DcForecastRow = {
  key: string;
  label: string;
  monthKey: string;
  year: number;
  month: number;
  distributor: string;
  canonicalDc: string;
  cases: number;
  shipments: number;
  flete: number;
  noFlete: number;
  total: number;
  sample: number;
  lowSample: boolean;
};

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Distributor bucket a canonical DC belongs to (RFD is folded into Rainforest). */
export function distributorOfDc(dc: string): string {
  const n = norm(dc);
  if (n.startsWith("KEHE")) return "KeHe";
  if (n.startsWith("UNFI")) return "UNFI";
  if (n.startsWith("RAINFOREST")) return "Rainforest";
  return "Other";
}

/**
 * Forecast logistics cost per DC per month.
 *
 * Cases are split distributor → DC with the editable mixes, then translated to
 * cost through the historical shipment profile (avg cases and avg total cost of
 * a typical shipment to that DC) instead of pricing one giant monthly load.
 */
export function forecastDcRows(months: ForecastMonthInput[], book: ForecastBook): DcForecastRow[] {
  const distPct = new Map(book.distMix.map(d => [norm(d.distributor), Number(d.mix_pct) || 0]));
  const profile = new Map(book.profiles.map(p => [norm(p.canonical_dc), p]));

  const out: DcForecastRow[] = [];
  for (const m of months) {
    // Cases per canonical DC (RFD and Rainforest land on the same DCs, so they merge here).
    const casesByDc = new Map<string, number>();
    for (const row of book.dcMix) {
      const dp = distPct.get(norm(row.distributor)) ?? 0;
      const cases = m.totalCases * dp * (Number(row.mix_pct) || 0);
      if (cases <= 0) continue;
      casesByDc.set(row.canonical_dc, (casesByDc.get(row.canonical_dc) ?? 0) + cases);
    }

    for (const [dc, rawCases] of casesByDc) {
      const p = profile.get(norm(dc));
      const cases = Math.round(rawCases);
      const avgCases = Number(p?.avg_cases_per_shipment) || 0;
      const avgCost = Number(p?.avg_cost_per_shipment) || 0;
      // Fractional shipments drive the cost so tiny DCs are not rounded up to a
      // full extra truck every month; the displayed count is the rounded value.
      const exact = avgCases > 0 && cases > 0 ? cases / avgCases : 0;
      const shipments = exact > 0 ? Math.max(1, Math.round(exact)) : 0;
      const total = exact * avgCost;
      const fpct = p ? Math.min(1, Math.max(0, Number(p.flete_pct))) : 0.8;
      const sample = p?.shipment_sample ?? 0;
      out.push({
        key: `${m.label}|${dc}`,
        label: m.label,
        monthKey: monthKey(m.year, m.month),
        year: m.year,
        month: m.month,
        distributor: distributorOfDc(dc),
        canonicalDc: dc,
        cases,
        shipments,
        flete: Math.round(total * fpct * 100) / 100,
        noFlete: Math.round(total * (1 - fpct) * 100) / 100,
        total: Math.round(total * 100) / 100,
        sample,
        lowSample: !p || sample < LOW_SAMPLE,
      });
    }
  }
  return out;
}

export type MonthlySeriesPoint = {
  monthKey: string;
  label: string;
  isReal: boolean;
  cases: number;
  flete: number;
  noFlete: number;
  total: number;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function prettyMonth(key: string) {
  const [y, m] = key.split("-");
  return `${MONTH_LABELS[Number(m) - 1]} ${y.slice(2)}`;
}

/** Every month from `from` (YYYY-MM) through `to` (YYYY-MM), inclusive. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(monthKey(y, m));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export type RealMonthCost = { cases: number; flete: number; noFlete: number; total: number };

/**
 * Single source of truth for the "real up to today, forecast afterwards"
 * monthly series used by both the Dashboard chart and the Forecast tab.
 */
export function buildMonthlySeries(
  realByMonth: Map<string, RealMonthCost>,
  dcRows: DcForecastRow[],
  startKey = FORECAST_CHART_START,
): MonthlySeriesPoint[] {
  const fc = new Map<string, RealMonthCost>();
  for (const r of dcRows) {
    const cur = fc.get(r.monthKey) ?? { cases: 0, flete: 0, noFlete: 0, total: 0 };
    cur.cases += r.cases; cur.flete += r.flete; cur.noFlete += r.noFlete; cur.total += r.total;
    fc.set(r.monthKey, cur);
  }
  const forecastKeys = [...fc.keys()].sort();
  const realKeys = [...realByMonth.keys()].filter(k => k >= startKey).sort();
  const last = [...forecastKeys, ...realKeys].sort().at(-1);
  if (!last) return [];

  return monthRange(startKey, last).map(k => {
    // A month is "real" whenever it is not part of the forward-looking forecast.
    const isReal = !fc.has(k);
    const src = (isReal ? realByMonth.get(k) : fc.get(k)) ?? { cases: 0, flete: 0, noFlete: 0, total: 0 };
    return {
      monthKey: k,
      label: prettyMonth(k),
      isReal,
      cases: Math.round(src.cases),
      flete: Math.round(src.flete),
      noFlete: Math.round(src.noFlete),
      total: Math.round(src.total),
    };
  });
}