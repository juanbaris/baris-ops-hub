import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calcLogistics, type RateBook } from "@/components/logistics/rates";
import { useSalesForecast } from "@/hooks/use-sales-forecast";
import {
  calcForecast, PRICE_PER_CASE, FORECAST_MONTHS,
  type Scenario, type ForecastState,
} from "@/lib/sales-forecast";

// ═══════════════════════════════════════════════════════════════════════════
// RUNWAY SEMANAL — single source of truth for the weekly cash forecast.
//
// INPUTS (all real, all live-queried — nothing hardcoded except sensible
// fallbacks used only when a table row is missing):
//   • customer_orders          → Pipeline PO: distributor, status, dates, cases, gross_sales
//   • distributor_terms        → payment terms (days) per distributor (UNFI/KeHe/Rainforest/...)
//   • logistics_dc_mapping, logistics_lineage_tariff, logistics_lineage_surcharges,
//     logistics_kehe_rate, logistics_accessorial_rates
//                               → the same rate-card model used in Fulfillment › Logistics
//                                 (calcLogistics from components/logistics/rates.ts)
//   • ip_movements              → COGS Definido: unpaid movements, bucketed by
//                                 estimated_payment_date (fallback movement_date)
//   • finance_assumptions       → deduction_pct_kehe / deduction_pct_unfi / deduction_pct_rainforest
//                                 (existing keys, now actually consumed here)
//   • runway_settings           → cash_start, cash_start_date, est_weeks_open_accepted,
//                                 est_weeks_bol_shipment, blando_monthly, logistics_fallback_per_case
//   • runway_fixed_costs        → editable list of fixed monthly costs (label, amount, timing)
//   • runway_events             → one-time / special events (description, amount, date)
//   • runway_cogs_estimado_payments → Procurement Planning → Payments (manual sync for now;
//                                 see note in RunwayAssumptionsPanel)
// ═══════════════════════════════════════════════════════════════════════════

const MS_DAY = 24 * 60 * 60 * 1000;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * MS_DAY);
}
function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s + (s.length === 10 ? "T00:00:00" : ""));
  return isNaN(d.getTime()) ? null : d;
}
function lastDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function firstDayOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
/** Next Monday on/after `d` (if d is already Monday, returns d). */
function nextMonday(d: Date) {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (8 - day) % 7; // days until Monday, 0 if already Monday
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(r, diff === 0 && day !== 1 ? 7 - ((day + 6) % 7) : diff);
}

const EST_WEEKS_3_STATUSES = new Set(["Open", "Accepted", "Sent to 3PL", "Acknowledged"]);
const EST_WEEKS_2_STATUSES = new Set(["Shipment", "BOL Confirmed"]);

export type RunwayPeriod = {
  key: string;
  label: string;
  start: Date;
  end: Date;
  isGap: boolean;
  cashStart: number;
  // Collections
  ingresoDefinido: number;
  ingresoEstimado: number;
  ingresoProyectado: number;
  // Deductions
  deduccionDefinido: number;
  deduccionEstimado: number;
  deduccionProyectado: number;
  // Logistics
  logisticaDefinido: number;
  logisticaEstimado: number;
  logisticaProyectado: number;
  // IP & Production costs
  cogsDefinido: number;
  cogsProyectado: number;
  // Expenses
  expenses: number;
  eventos: number;
  // Nets
  netoReal: number;
  netoProyectado: number;
  neto: number;
  cashEnd: number;
};

export type RunwaySettings = {
  cash_start: number;
  cash_start_date: string;
  est_weeks_open_accepted: number;
  est_weeks_bol_shipment: number;
  blando_monthly: number;
  logistics_fallback_per_case: number;
};

const DEFAULT_SETTINGS: RunwaySettings = {
  cash_start: 0,
  cash_start_date: ymd(new Date()),
  est_weeks_open_accepted: 3,
  est_weeks_bol_shipment: 2,
  blando_monthly: -15200,
  logistics_fallback_per_case: 3.47,
};

export type RunwayFixedCost = { id: string; label: string; amount: number; timing: "day1" | "eom"; active: boolean };
export type RunwayEvent = { id: string; description: string; amount: number; event_date: string };
export type RunwayCogsPayment = { id: string; payment_month: string; ingredient_purchases: number; heinlein_tolling: number };

export function useRunwayForecast(nWeeks = 20, scenario: Scenario = "Normal") {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // ── Sales Forecast (projected revenue by month) ──
  const { state: salesState } = useSalesForecast();
  const salesForecast = useMemo(() => {
    const s = salesState as ForecastState;
    return calcForecast(
      scenario,
      s.velActive ?? [], s.velNew ?? [],
      s.retailerActive ?? [], s.retailerStores ?? [], s.retailerVel ?? [], s.retailerEntry ?? [],
      s.velChains, s.seasonIdx, s.newSkus ?? [], s.promoMultipliers, s.retVelBySku,
    );
  }, [scenario, salesState]);

  const [orders, setOrders] = useState<any[]>([]);
  const [terms, setTerms] = useState<Record<string, number>>({});
  const [book, setBook] = useState<RateBook>({ mapping: [], tariffs: [], surcharges: null, kehe: [], accessorial: null });
  const [ded, setDed] = useState<{ kehe: number; unfi: number; rainforest: number; blend: number }>({
    kehe: 0.20, unfi: 0.20, rainforest: 0.18, blend: 0.1978,
  });
  const [ipPending, setIpPending] = useState<{ date: Date; amount: number }[]>([]);
  const [settings, setSettings] = useState<RunwaySettings>(DEFAULT_SETTINGS);
  const [fixedCosts, setFixedCosts] = useState<RunwayFixedCost[]>([]);
  const [events, setEvents] = useState<RunwayEvent[]>([]);
  const [cogsPayments, setCogsPayments] = useState<RunwayCogsPayment[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [
          ordersRes, termsRes, mapRes, tariffRes, surRes, keheRes, accRes,
          faRes, settingsRes, fixedRes, eventsRes, ipRes,
        ] = await Promise.all([
          supabase.from("customer_orders").select(
            "id,po_number,distributor,customer,status,ship_est_date,invoice_date,collected_at,gross_sales,wd_cases,pw_cases,hm_cases,matcha_cases,xd_cases,wm_cases"
          ),
          supabase.from("distributor_terms").select("distributor,payment_terms_days"),
          supabase.from("logistics_dc_mapping").select("*"),
          supabase.from("logistics_lineage_tariff").select("*"),
          supabase.from("logistics_lineage_surcharges").select("*").limit(1).maybeSingle(),
          supabase.from("logistics_kehe_rate").select("*"),
          supabase.from("logistics_accessorial_rates").select("*").limit(1).maybeSingle(),
          supabase.from("finance_assumptions").select("key,value").in("key", [
            "deduction_pct_kehe", "deduction_pct_unfi", "deduction_pct_rainforest", "deduction_pct_overall",
          ]),
          supabase.from("runway_settings").select("*"),
          supabase.from("runway_fixed_costs").select("*").eq("active", true).order("sort_order"),
          supabase.from("runway_events").select("*"),
          supabase.from("ip_movements").select("estimated_payment_date,movement_date,actual_payment_date,paid,total_price,shipping_price,other_costs"),
        ]);
        if (cancel) return;

        const firstErr = [ordersRes, termsRes, mapRes, tariffRes, keheRes, accRes, faRes, settingsRes, fixedRes, eventsRes, ipRes]
          .find((r) => r.error);
        if (firstErr?.error) throw firstErr.error;

        setOrders(ordersRes.data ?? []);

        const termMap: Record<string, number> = {};
        for (const t of termsRes.data ?? []) termMap[t.distributor as string] = Number(t.payment_terms_days);
        setTerms(termMap);

        setBook({
          mapping: (mapRes.data ?? []) as any,
          tariffs: (tariffRes.data ?? []) as any,
          surcharges: (surRes.data ?? null) as any,
          kehe: (keheRes.data ?? []) as any,
          accessorial: (accRes.data ?? null) as any,
        });

        const faMap: Record<string, number> = {};
        for (const r of faRes.data ?? []) faMap[r.key] = Number(r.value);
        // Convention (matches the rest of finance.tsx / AssumptionsModal): values are
        // stored as whole percentages, e.g. 19.78 means 19.78% — always divide by 100.
        setDed({
          kehe: faMap["deduction_pct_kehe"] != null ? faMap["deduction_pct_kehe"] / 100 : 0.20,
          unfi: faMap["deduction_pct_unfi"] != null ? faMap["deduction_pct_unfi"] / 100 : 0.20,
          rainforest: faMap["deduction_pct_rainforest"] != null ? faMap["deduction_pct_rainforest"] / 100 : 0.18,
          blend: faMap["deduction_pct_overall"] != null ? faMap["deduction_pct_overall"] / 100 : 0.1978,
        });

        const settingsMap: Record<string, number | string> = {};
        for (const s of settingsRes.data ?? []) {
          if (s.number_value != null) settingsMap[s.key] = Number(s.number_value);
          else if (s.date_value != null) settingsMap[s.key] = String(s.date_value);
        }
        setSettings({
          cash_start: Number(settingsMap["cash_start"] ?? DEFAULT_SETTINGS.cash_start),
          cash_start_date: String(settingsMap["cash_start_date"] ?? DEFAULT_SETTINGS.cash_start_date),
          est_weeks_open_accepted: Number(settingsMap["est_weeks_open_accepted"] ?? DEFAULT_SETTINGS.est_weeks_open_accepted),
          est_weeks_bol_shipment: Number(settingsMap["est_weeks_bol_shipment"] ?? DEFAULT_SETTINGS.est_weeks_bol_shipment),
          blando_monthly: Number(settingsMap["blando_monthly"] ?? DEFAULT_SETTINGS.blando_monthly),
          logistics_fallback_per_case: Number(settingsMap["logistics_fallback_per_case"] ?? DEFAULT_SETTINGS.logistics_fallback_per_case),
        });

        setFixedCosts((fixedRes.data ?? []) as any);
        setEvents((eventsRes.data ?? []) as any);

        // IP & Production projected: read from localStorage (auto-synced from Operations → Procurement)
        try {
          const raw = window.localStorage.getItem("baris.runway.procPayments");
          if (raw) setCogsPayments(JSON.parse(raw).map((r: any, i: number) => ({
            id: String(i), payment_month: r.payment_month,
            ingredient_purchases: r.ingredient_purchases ?? 0,
            heinlein_tolling: r.heinlein_tolling ?? 0,
          })));
        } catch {}

        const pending = (ipRes.data ?? [])
          .filter((m: any) => !m.paid)
          .map((m: any) => {
            const d = parseDate(m.estimated_payment_date) ?? parseDate(m.movement_date) ?? new Date();
            const amt = -(Number(m.total_price ?? 0) + Number(m.shipping_price ?? 0) + Number(m.other_costs ?? 0));
            return { date: d, amount: amt };
          });
        setIpPending(pending);
      } catch (e: any) {
        if (!cancel) setError(e?.message ?? "Error loading Runway");
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [reloadKey]);

  const periods = useMemo<RunwayPeriod[]>(() => {
    if (loading) return [];

    const cashStartDate = parseDate(settings.cash_start_date) ?? new Date();
    const week1Start = nextMonday(new Date(cashStartDate.getTime() + MS_DAY));
    // Everything dated on/before cashStartDate is assumed already resolved (collected/paid)
    // and reflected in cash_start — it is excluded from the model entirely, not swept in.
    // The "gap" period only covers [cashStartDate+1, week1Start-1], the few real forward-looking
    // days between the balance snapshot and the first full Monday-Sunday week.
    const gapStart = addDays(cashStartDate, 1);
    const gapEnd = addDays(week1Start, -1);

    const periodDefs: { key: string; label: string; start: Date; end: Date; isGap: boolean }[] = [
      { key: "gap", label: `${ymd(gapStart).slice(8,10)}/${ymd(gapStart).slice(5,7)} - ${ymd(gapEnd).slice(8,10)}/${ymd(gapEnd).slice(5,7)}`, start: gapStart, end: gapEnd, isGap: true },
    ];
    for (let w = 0; w < nWeeks; w++) {
      const s = addDays(week1Start, 7 * w);
      const e = addDays(s, 6);
      const label = `${ymd(s).slice(8,10)}/${ymd(s).slice(5,7)} - ${ymd(e).slice(8,10)}/${ymd(e).slice(5,7)}`;
      periodDefs.push({ key: `w${w}`, label, start: s, end: e, isGap: false });
    }

    // Returns null when the date is on/before cashStartDate — meaning "already resolved,
    // don't count it" — instead of sweeping it into the first period.
    function findPeriodIndex(d: Date): number | null {
      if (d <= cashStartDate) return null;
      for (let i = 0; i < periodDefs.length; i++) {
        if (d >= periodDefs[i].start && d <= periodDefs[i].end) return i;
      }
      return periodDefs.length - 1; // clamp anything beyond horizon into the last week
    }

    const buckets = periodDefs.map(() => ({
      ingresoDefinido: 0, ingresoEstimado: 0, ingresoProyectado: 0,
      deduccionDefinido: 0, deduccionEstimado: 0, deduccionProyectado: 0,
      logisticaDefinido: 0, logisticaEstimado: 0, logisticaProyectado: 0,
      cogsDefinido: 0, cogsProyectado: 0,
      expenses: 0, eventos: 0,
    }));

    // ── Pipeline PO events ──
    for (const o of orders) {
      const invoiced = o.status === "Invoiced";
      const shipEst = parseDate(o.ship_est_date);
      const invoiceActual = parseDate(o.invoice_date);
      let invoiceDateCalc: Date | null = null;
      if (invoiced) {
        invoiceDateCalc = invoiceActual ?? shipEst;
      } else if (shipEst) {
        const weeks = EST_WEEKS_3_STATUSES.has(o.status)
          ? settings.est_weeks_open_accepted
          : EST_WEEKS_2_STATUSES.has(o.status)
          ? settings.est_weeks_bol_shipment
          : 0;
        invoiceDateCalc = addDays(shipEst, weeks * 7);
      }
      if (!invoiceDateCalc) continue;

      const termsDays = terms[o.distributor] ?? (o.distributor === "Rainforest" ? 60 : 30);
      const collectedAt = parseDate(o.collected_at);
      const collectionDate = collectedAt ?? addDays(invoiceDateCalc, termsDays);

      const gross = Number(o.gross_sales ?? 0);
      const dedPct = o.distributor === "KeHe" ? ded.kehe : o.distributor === "UNFI" ? ded.unfi : o.distributor === "Rainforest" ? ded.rainforest : ded.blend;
      const deduction = -gross * dedPct;

      const logi = calcLogistics(o, book);
      const cases = logi.totalCases;
      const logisticsCost = logi.total != null ? -logi.total : -(cases * settings.logistics_fallback_per_case);

      const incomeIdx = findPeriodIndex(collectionDate);
      const dedIdx = incomeIdx; // same timing as income (paid at time of collection)
      const logiIdx = findPeriodIndex(invoiceDateCalc); // logistics owed once invoiced/shipped

      if (invoiced) {
        if (incomeIdx != null) buckets[incomeIdx].ingresoDefinido += gross;
        if (dedIdx != null) buckets[dedIdx].deduccionDefinido += deduction;
        if (logiIdx != null) buckets[logiIdx].logisticaDefinido += logisticsCost;
      } else {
        if (incomeIdx != null) buckets[incomeIdx].ingresoEstimado += gross;
        if (dedIdx != null) buckets[dedIdx].deduccionEstimado += deduction;
        if (logiIdx != null) buckets[logiIdx].logisticaEstimado += logisticsCost;
      }
    }

    // ── COGS Definido: unpaid I&P movements ──
    for (const p of ipPending) {
      const idx = findPeriodIndex(p.date);
      if (idx != null) buckets[idx].cogsDefinido += p.amount;
    }

    // ── IP & Production Proyectado: from Procurement Planning payments (via localStorage) ──
    // Values stored as positive costs → negate for cash outflow; placed in first week of payment month
    for (const cp of cogsPayments) {
      const d = parseDate(cp.payment_month);
      if (!d) continue;
      const idx = findPeriodIndex(d);
      if (idx != null) buckets[idx].cogsProyectado += -(Number(cp.ingredient_purchases ?? 0) + Number(cp.heinlein_tolling ?? 0));
    }

    // ── Projected revenue / deductions / logistics from Sales Forecast ──
    // Rules:
    //   1. Sales Forecast = what's SOLD in month M; collection happens in month M+1 (~30d terms).
    //   2. Past months (where all weeks have actuals): Projected = $0
    //   3. Current month: Projected = max(0, Forecast(sales_month) - Confirmed - Estimated)
    //   4. Future months: Projected = full forecast (no pipeline yet)
    //
    // Approach: compute projected PER MONTH first, then distribute to weeks pro-rata.
    const forecastByMonth: Record<string, { revenue: number; cases: number }> = {};
    for (const fr of salesForecast) {
      forecastByMonth[mk2(fr.year, fr.month)] = { revenue: fr.totalCases * PRICE_PER_CASE, cases: fr.totalCases };
    }

    // Helper: zero-padded month key for correct string comparison
    const mk2 = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

    // Group confirmed+estimated revenue by their SALES month (= collection month - 1)
    const pipelineByMonth: Record<string, number> = {};
    for (const o of orders) {
      const shipOrInv = o.ship_est_date || o.invoice_date || o.po_date;
      if (!shipOrInv) continue;
      const d = parseDate(shipOrInv);
      if (!d) continue;
      const mk = mk2(d.getFullYear(), d.getMonth() + 1);
      pipelineByMonth[mk] = (pipelineByMonth[mk] ?? 0) + Number(o.gross_sales ?? 0);
    }

    // For each forecast month, compute how much projected collections to show
    const projByCollectionMonth: Record<string, { rev: number; cases: number }> = {};
    const now = new Date();
    const currentSalesMonth = mk2(now.getFullYear(), now.getMonth() + 1);

    for (const fr of salesForecast) {
      const salesMk = mk2(fr.year, fr.month);
      const collMonth = new Date(fr.year, fr.month, 1); // collection = sales month + 1
      const collMk = mk2(collMonth.getFullYear(), collMonth.getMonth() + 1);
      const fcRev = fr.totalCases * PRICE_PER_CASE;
      const fcCases = fr.totalCases;

      const isPast = salesMk < currentSalesMonth;
      const isCurrent = salesMk === currentSalesMonth;

      if (isPast) {
        // Pipeline already covers it
        projByCollectionMonth[collMk] = { rev: 0, cases: 0 };
      } else if (isCurrent) {
        // Current month: subtract what's already in the pipeline
        const pipeline = pipelineByMonth[salesMk] ?? 0;
        const gap = Math.max(0, fcRev - pipeline);
        projByCollectionMonth[collMk] = { rev: gap, cases: fcRev > 0 ? fcCases * (gap / fcRev) : 0 };
      } else {
        // Future: full forecast
        projByCollectionMonth[collMk] = { rev: fcRev, cases: fcCases };
      }
    }

    // Distribute projected collections to weekly periods (pro-rata by days in month)
    for (let i = 0; i < periodDefs.length; i++) {
      const p = periodDefs[i];
      let rawRev = 0, rawCases = 0;
      const days = Math.round((p.end.getTime() - p.start.getTime()) / MS_DAY) + 1;
      let d = new Date(p.start);
      for (let j = 0; j < days; j++) {
        const mk = mk2(d.getFullYear(), d.getMonth() + 1);
        const proj = projByCollectionMonth[mk];
        if (proj && proj.rev > 0) {
          const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
          rawRev += proj.rev / daysInMonth;
          rawCases += proj.cases / daysInMonth;
        }
        d = addDays(d, 1);
      }
      if (rawRev > 0) {
        buckets[i].ingresoProyectado = Math.round(rawRev);
        buckets[i].deduccionProyectado = -Math.round(rawRev * ded.blend);
        buckets[i].logisticaProyectado = -Math.round(rawCases * settings.logistics_fallback_per_case);
      }
    }

    // ── Monthly SG&A Expenses: placed at end of each month ──
    // Reads from the same localStorage source as P&L expense assumptions
    let monthlyExpenseK = 0;
    try {
      const raw = window.localStorage.getItem("baris.finance.expenseK");
      const exp = raw ? JSON.parse(raw) : null;
      if (exp) monthlyExpenseK = Object.values(exp as Record<string,number>).reduce((s: number, v: any) => s + Math.abs(Number(v) || 0), 0);
    } catch {}
    if (monthlyExpenseK === 0) monthlyExpenseK = 60; // default $60K/month if no overrides
    const horizonStart = periodDefs[0].start;
    const horizonEnd = periodDefs[periodDefs.length - 1].end;
    {
      let cursor = firstDayOfMonth(horizonStart);
      while (cursor <= horizonEnd) {
        const eom = lastDayOfMonth(cursor);
        if (eom >= horizonStart && eom <= horizonEnd) {
          const idx = findPeriodIndex(eom);
          if (idx != null) buckets[idx].expenses = -(monthlyExpenseK * 1000); // $K → $, negative = outflow
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    }

    // ── Special events ──
    for (const ev of events) {
      const d = parseDate(ev.event_date);
      if (!d) continue;
      const idx = findPeriodIndex(d);
      if (idx != null) buckets[idx].eventos += Number(ev.amount);
    }

    // ── Roll forward cash ──
    const result: RunwayPeriod[] = [];
    let cash = settings.cash_start;
    for (let i = 0; i < periodDefs.length; i++) {
      const b = buckets[i];
      const netoReal = b.ingresoDefinido + b.ingresoEstimado + b.deduccionDefinido + b.deduccionEstimado
        + b.logisticaDefinido + b.logisticaEstimado + b.cogsDefinido + b.expenses + b.eventos;
      const netoProyectado = b.ingresoProyectado + b.deduccionProyectado + b.logisticaProyectado + b.cogsProyectado;
      const neto = netoReal + netoProyectado;
      const cashStart = cash;
      const cashEnd = cashStart + neto;
      result.push({ ...periodDefs[i], cashStart, cashEnd, neto, netoReal, netoProyectado, ...b });
      cash = cashEnd;
    }
    return result;
  }, [loading, orders, terms, book, ded, ipPending, settings, fixedCosts, events, cogsPayments, salesForecast, nWeeks]);

  return { periods, loading, error, settings, fixedCosts, events, cogsPayments, reload };
}
