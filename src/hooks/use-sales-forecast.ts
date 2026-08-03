import { useEffect, useMemo, useState } from "react";
import {
  forecastFromState, loadForecastState, skuForecast, skuForecastByMonthKey,
  subscribeForecast, committedForecastFromState, committedLeverCount,
  productionRequirements, type ForecastState,
} from "@/lib/sales-forecast";

/** Live view of the forecast edited in the Sales module. */
export function useSalesForecast() {
  const [state, setState] = useState<ForecastState>(() => loadForecastState());

  useEffect(() => {
    setState(loadForecastState());
    return subscribeForecast(() => setState(loadForecastState()));
  }, []);

  return useMemo(() => {
    const forecast = forecastFromState(state);
    const committed = committedForecastFromState(state);
    const leverCount = committedLeverCount(state);
    // Committed scenario always wins downstream (Procurement, Finance).
    const effective = committed ?? forecast;
    const newSkus = (state.newSkus ?? []).map((s, i) =>
      committed ? { ...s, active: s.active && !!(state.skuCommitted ?? [])[i] } : s);
    return {
      state,
      forecast,
      committedForecast: committed,
      committedLevers: leverCount,
      committedAt: state.committedAt ?? null,
      scenario: state.scenario,
      effectiveForecast: effective,
      isCommitted: !!committed,
      production: productionRequirements(
        effective, newSkus, state.mixOverrides ?? {}, !!state.mixOverrideActive && !!state.mixCommitted,
      ),
      bySku: skuForecast(effective),
      bySkuMonthKey: skuForecastByMonthKey(effective),
    };
  }, [state]);
}
