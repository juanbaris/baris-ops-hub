import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  forecastFromState, loadForecastState, skuForecast, skuForecastByMonthKey,
  subscribeForecast, committedForecastFromState, committedLeverCount,
  productionRequirements, initForecastSupabase, loadForecastFromSupabase,
  saveForecastState, type ForecastState,
} from "@/lib/sales-forecast";

// Initialize Supabase client for the forecast module
initForecastSupabase(supabase);

/** Live view of the forecast edited in the Sales module. */
export function useSalesForecast() {
  const [state, setState] = useState<ForecastState>(() => loadForecastState());

  useEffect(() => {
    // On mount: load from Supabase (source of truth for committed state)
    (async () => {
      const remote = await loadForecastFromSupabase();
      if (remote) {
        // Supabase version wins — update both state and localStorage
        setState(remote);
        saveForecastState(remote);
      }
    })();
    // Subscribe to local changes (same-tab updates)
    setState(loadForecastState());
    return subscribeForecast(() => setState(loadForecastState()));
  }, []);

  return useMemo(() => {
    const forecast = forecastFromState(state);
    const committed = committedForecastFromState(state);
    const leverCount = committedLeverCount(state);
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
