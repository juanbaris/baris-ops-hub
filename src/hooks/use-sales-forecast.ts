import { useEffect, useMemo, useState } from "react";
import {
  forecastFromState, loadForecastState, skuForecast, skuForecastByMonthKey,
  subscribeForecast, type ForecastState,
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
    return {
      state,
      forecast,
      bySku: skuForecast(forecast),
      bySkuMonthKey: skuForecastByMonthKey(forecast),
    };
  }, [state]);
}
