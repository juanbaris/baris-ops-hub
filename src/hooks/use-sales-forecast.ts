import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  forecastFromState, loadForecastState, skuForecast, skuForecastByMonthKey,
  subscribeForecast, committedForecastFromState, committedLeverCount,
  productionRequirements, initForecastSupabase, loadForecastFromSupabase,
  type ForecastState,
} from "@/lib/sales-forecast";

// Initialize Supabase client for the forecast module
initForecastSupabase(supabase);

const STORAGE_KEY = "baris.sales.forecast.v1";

/** Live view of the forecast edited in the Sales module. */
export function useSalesForecast() {
  const [state, setState] = useState<ForecastState>(() => loadForecastState());

  useEffect(() => {
    let cancelled = false;
    // Load from Supabase — source of truth. Overrides localStorage.
    (async () => {
      try {
        const remote = await loadForecastFromSupabase();
        if (!cancelled && remote) {
          // Only use Supabase if it actually has meaningful data
          const hasCommitted = (remote.velCommitted ?? []).some(Boolean)
            || (remote.retCommitted ?? []).some(Boolean)
            || (remote.skuCommitted ?? []).some(Boolean)
            || !!remote.mixCommitted;
          if (hasCommitted || remote.committedAt) {
            setState(remote);
            // Sync to localStorage so sales.tsx picks it up
            try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remote)); } catch {}
          }
        }
      } catch { /* Supabase unavailable — localStorage is fine */ }
    })();
    // Subscribe to local changes (same-tab, from sales.tsx edits)
    const unsub = subscribeForecast(() => {
      if (!cancelled) setState(loadForecastState());
    });
    return () => { cancelled = true; unsub(); };
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
