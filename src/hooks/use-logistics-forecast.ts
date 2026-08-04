import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSalesForecast } from "@/hooks/use-sales-forecast";
import {
  buildMonthlySeries, forecastDcRows,
  type ForecastBook, type RealMonthCost,
} from "@/components/logistics/forecast";
import type { LogisticsCost } from "@/components/logistics/rates";

export type PricedLike = { order: { po_date: string | null }; cost: LogisticsCost };

/**
 * Real (Pipeline) + forecast (Sales-driven) monthly logistics series.
 * Never persisted: it recomputes whenever Sales or the rate tables change.
 */
export function useLogisticsForecast(priced: PricedLike[]) {
  const [book, setBook] = useState<ForecastBook>({ distMix: [], dcMix: [], profiles: [] });
  const [loading, setLoading] = useState(true);
  const sales = useSalesForecast();

  const reload = useCallback(async () => {
    const [d, c, p] = await Promise.all([
      supabase.from("logistics_forecast_distributor_mix").select("*").order("distributor"),
      supabase.from("logistics_forecast_dc_mix").select("*").order("distributor").order("canonical_dc"),
      supabase.from("logistics_forecast_shipment_profile").select("*").order("canonical_dc"),
    ]);
    setBook({ distMix: d.data ?? [], dcMix: c.data ?? [], profiles: p.data ?? [] });
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const months = useMemo(
    () => sales.effectiveForecast.map(f => ({
      label: f.label, month: f.month, year: f.year, totalCases: f.totalCases,
    })),
    [sales.effectiveForecast],
  );

  const dcRows = useMemo(() => forecastDcRows(months, book), [months, book]);

  const realByMonth = useMemo(() => {
    const m = new Map<string, RealMonthCost>();
    for (const r of priced) {
      const key = (r.order.po_date ?? "").slice(0, 7);
      if (!key || r.cost.total == null) continue;
      const cur = m.get(key) ?? { cases: 0, flete: 0, noFlete: 0, total: 0 };
      cur.cases += r.cost.totalCases;
      cur.flete += r.cost.flete ?? 0;
      cur.noFlete += r.cost.noFlete ?? 0;
      cur.total += r.cost.total ?? 0;
      m.set(key, cur);
    }
    return m;
  }, [priced]);

  const series = useMemo(() => buildMonthlySeries(realByMonth, dcRows), [realByMonth, dcRows]);

  return { book, dcRows, series, loading, reload, months };
}