import type { Database } from "@/integrations/supabase/types";

export type DcMapping = Database["public"]["Tables"]["logistics_dc_mapping"]["Row"];
export type LineageTariff = Database["public"]["Tables"]["logistics_lineage_tariff"]["Row"];
export type Surcharges = Database["public"]["Tables"]["logistics_lineage_surcharges"]["Row"];
export type KeheRate = Database["public"]["Tables"]["logistics_kehe_rate"]["Row"];
export type Accessorial = Database["public"]["Tables"]["logistics_accessorial_rates"]["Row"];

export type RateBook = {
  mapping: DcMapping[];
  tariffs: LineageTariff[];
  surcharges: Surcharges | null;
  kehe: KeheRate[];
  accessorial: Accessorial | null;
};

export type LogisticsCost = {
  totalCases: number;
  canonicalDc: string | null;
  payer: string | null;
  pallets: number | null;
  flete: number | null;
  noFlete: number | null;
  total: number | null;
};

/** Distributors that never go through the 3PL logistics model. */
const EXCLUDED_DISTRIBUTORS = new Set(["Direct", "Other"]);

export const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

const r2 = (n: number) => Math.round(n * 100) / 100;

export function totalCasesOf(o: {
  wd_cases: number | null; pw_cases: number | null; hm_cases: number | null;
  matcha_cases: number | null; xd_cases: number | null; wm_cases: number | null;
}): number {
  return [o.wd_cases, o.pw_cases, o.hm_cases, o.matcha_cases, o.xd_cases, o.wm_cases]
    .reduce<number>((s, v) => s + (Number(v) || 0), 0);
}

/**
 * Cost model validated against real Lineage/KeHe invoices.
 *
 * NOTE: we tried "correcting" the underestimate seen on 2+ pallet shipments by
 * multiplying the 1-pallet tariff by the pallet count. Validated against 40 real
 * freight invoices it was WORSE (58% error vs 29% leaving the tariff as-is).
 * Do NOT reintroduce that adjustment without new real evidence.
 */
export function calcLogistics(
  order: { customer: string; distributor: string } & Parameters<typeof totalCasesOf>[0],
  book: RateBook,
): LogisticsCost {
  const totalCases = totalCasesOf(order);
  const empty: LogisticsCost = {
    totalCases, canonicalDc: null, payer: null, pallets: null, flete: null, noFlete: null, total: null,
  };
  const acc = book.accessorial;
  if (!acc) return empty;
  if (EXCLUDED_DISTRIBUTORS.has(order.distributor)) return empty;

  const map = book.mapping.find(m => norm(m.raw_customer_name) === norm(order.customer));
  if (!map || !map.canonical_dc) return empty;

  const dc = map.canonical_dc;
  const casesPerPallet = Number(acc.cases_per_pallet) || 255;
  const pallets = Math.max(1, Math.ceil(totalCases / casesPerPallet));

  let flete: number | null = null;
  if (map.quien_cobra_flete === "KeHe FOB") {
    const rate = book.kehe.find(k => norm(k.canonical_dc) === norm(dc));
    if (rate) flete = Number(rate.cost_per_lb) * Number(acc.assumed_lb_per_case) * casesPerPallet * pallets;
  } else {
    const t = book.tariffs.find(x => norm(x.canonical_dc) === norm(dc));
    const s = book.surcharges;
    if (t && s) {
      const n = Math.min(pallets, 10);
      const base = Number((t as unknown as Record<string, number>)[`plt_${n}`]) || 0;
      flete = base * (1 + Number(s.fuel_surcharge_pct)) + Number(s.detention_expected) + Number(s.lumper_expected);
    }
  }
  if (flete == null) return { ...empty, canonicalDc: dc, payer: map.quien_cobra_flete, pallets };

  const noFlete = Number(acc.bol_per_shipment)
    + Number(acc.loading_per_pallet) * pallets
    + Number(acc.case_picking_per_case) * totalCases;

  return {
    totalCases, canonicalDc: dc, payer: map.quien_cobra_flete, pallets,
    flete: r2(flete), noFlete: r2(noFlete), total: r2(flete + noFlete),
  };
}

export const PALLET_COLS = ["plt_1","plt_2","plt_3","plt_4","plt_5","plt_6","plt_7","plt_8","plt_9","plt_10"] as const;
