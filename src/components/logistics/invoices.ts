// src/components/logistics/invoices.ts
//
// Lógica pura de facturas reales de logística: reconciliación con el pipeline,
// acumulado real por mes/categoría, forecast simple de supply chain y la mezcla
// del mes corriente (real + forecast pendiente). Sin dependencias de UI.
//
// Convención igual a rates.ts / forecast.ts: funciones puras y testeables.

// ── Tipos (locales, no dependen de los types autogenerados de Supabase) ──────
export type InvoiceCategory =
  | "freight" | "accessorial" | "storage_receipt" | "storage_renewal";

export type LogisticsInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;              // 'YYYY-MM-DD'
  carrier: "Lineage" | "KeHe";
  category: InvoiceCategory;
  canonical_dc: string | null;
  cases: number | null;
  pallets: number | null;
  weight_lb: number | null;
  freight_base: number | null;
  fuel: number | null;
  detention: number | null;
  lumper: number | null;
  charges: unknown;
  total_charged: number;
  bol: string | null;
  po_ref: string | null;
  is_supplemental: boolean;
  pdf_path: string | null;
  status: "pending" | "confirmed";
};

export type InvoiceOrderLink = {
  invoice_id: string;
  order_id: string | null;
  po_number: string | null;
  allocated_amount: number;
};

export const CATEGORY_LABEL: Record<InvoiceCategory, string> = {
  freight: "Freight",
  accessorial: "Accesorial",
  storage_receipt: "Storage — Receipt",
  storage_renewal: "Storage — Renewal",
};

// Categoría → “bucket” de alto nivel para el resumen de supply chain.
export type CostBucket = "freight" | "accessorial" | "storage";
export function bucketOf(cat: InvoiceCategory): CostBucket {
  if (cat === "freight") return "freight";
  if (cat === "accessorial") return "accessorial";
  return "storage";
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const monthOf = (isoDate: string) => (isoDate || "").slice(0, 7); // 'YYYY-MM'

// ── 1. Detección de factura suplementaria (Lumper posterior, mismo BOL) ──────
/** base < $1 ≈ factura de solo-Lumper que Lineage emite después por el mismo envío. */
export function looksSupplemental(freightBase: number | null | undefined): boolean {
  return freightBase != null && Number(freightBase) < 1;
}

// ── 2. Parseo de las PO(s) referenciadas en la factura ───────────────────────
/**
 * Extrae números de PO del texto de referencia.
 * Freight: suele traer un PO. Accesorial: "Orders 242548, 242703, 242768…".
 */
export function parsePoRefs(poRef: string | null | undefined): string[] {
  if (!poRef) return [];
  const matches = String(poRef).match(/\d{4,}/g) ?? [];
  return [...new Set(matches)];
}

// ── 3. Reparto del monto de una factura entre sus POs ────────────────────────
/**
 * Asigna total_charged a cada PO. Proporcional a las cajas de cada orden;
 * si no hay cajas, reparto parejo. Devuelve los vínculos a insertar.
 */
export function allocateToOrders(
  invoice: Pick<LogisticsInvoice, "id" | "total_charged" | "po_ref">,
  matchedOrders: { id: string; po_number: string; totalCases: number }[],
): InvoiceOrderLink[] {
  const refs = parsePoRefs(invoice.po_ref);
  // Órdenes que efectivamente matchean una PO de la factura.
  const matched = matchedOrders.filter(o => refs.includes(String(o.po_number)));
  const targets = matched.length ? matched : [];

  // POs de la factura que no encontraron orden → vínculo suelto (para match manual).
  const unmatchedRefs = refs.filter(ref => !matched.some(o => String(o.po_number) === ref));

  const links: InvoiceOrderLink[] = [];
  if (targets.length) {
    const totalCases = targets.reduce((s, o) => s + (o.totalCases || 0), 0);
    for (const o of targets) {
      const share = totalCases > 0 ? (o.totalCases || 0) / totalCases : 1 / targets.length;
      links.push({
        invoice_id: invoice.id,
        order_id: o.id,
        po_number: String(o.po_number),
        allocated_amount: r2(invoice.total_charged * share),
      });
    }
  }
  for (const ref of unmatchedRefs) {
    links.push({ invoice_id: invoice.id, order_id: null, po_number: ref, allocated_amount: 0 });
  }
  // Sin ninguna PO en el texto (p. ej. storage): un vínculo vacío no aporta; devolvemos [].
  return links;
}

// ── 4. Real de una PO (freight/accesorial) y variance vs estimado ────────────
export type OrderReconciliation = {
  orderId: string;
  hasFreightInvoice: boolean;
  hasAccessorialInvoice: boolean;
  realFreight: number;       // suma allocated de facturas freight
  realAccessorial: number;   // suma allocated de facturas accessorial
  realTotal: number;
  estTotal: number | null;
  variancePct: number | null; // (real - est) / est
};

export type VarianceFlag = "green" | "yellow" | "red" | "none";
export function varianceFlag(pct: number | null): VarianceFlag {
  if (pct == null) return "none";
  const a = Math.abs(pct);
  if (a < 0.10) return "green";
  if (a <= 0.25) return "yellow";
  return "red";
}

/**
 * Reconcilia una orden: junta sus facturas (por categoría) contra el estimado.
 * `estTotal` = calcLogistics(order).total (freight + noFlete).
 */
export function reconcileOrder(
  orderId: string,
  invoices: LogisticsInvoice[],
  links: InvoiceOrderLink[],
  estTotal: number | null,
): OrderReconciliation {
  const invById = new Map(invoices.map(i => [i.id, i]));
  const mine = links.filter(l => l.order_id === orderId);
  let realFreight = 0, realAccessorial = 0;
  let hasFreight = false, hasAcc = false;
  for (const l of mine) {
    const inv = invById.get(l.invoice_id);
    if (!inv || inv.status !== "confirmed") continue;
    if (inv.category === "freight") { realFreight += l.allocated_amount; hasFreight = true; }
    else if (inv.category === "accessorial") { realAccessorial += l.allocated_amount; hasAcc = true; }
  }
  const realTotal = r2(realFreight + realAccessorial);
  const variancePct = estTotal && estTotal > 0 ? (realTotal - estTotal) / estTotal : null;
  return {
    orderId,
    hasFreightInvoice: hasFreight,
    hasAccessorialInvoice: hasAcc,
    realFreight: r2(realFreight),
    realAccessorial: r2(realAccessorial),
    realTotal,
    estTotal,
    variancePct,
  };
}

// ── 5. Acumulado REAL por mes y categoría ────────────────────────────────────
export type MonthlyByBucket = { freight: number; accessorial: number; storage: number; total: number };

/** Suma las facturas confirmadas por mes ('YYYY-MM') y bucket. */
export function realByMonth(invoices: LogisticsInvoice[]): Map<string, MonthlyByBucket> {
  const out = new Map<string, MonthlyByBucket>();
  for (const inv of invoices) {
    if (inv.status !== "confirmed") continue;
    const key = monthOf(inv.invoice_date);
    if (!key) continue;
    const cur = out.get(key) ?? { freight: 0, accessorial: 0, storage: 0, total: 0 };
    const b = bucketOf(inv.category);
    cur[b] += inv.total_charged;
    cur.total += inv.total_charged;
    out.set(key, cur);
  }
  for (const v of out.values()) {
    v.freight = r2(v.freight); v.accessorial = r2(v.accessorial);
    v.storage = r2(v.storage); v.total = r2(v.total);
  }
  return out;
}

// ── 6. Forecast simple de supply chain (9% / 1% / storage promedio) ──────────
export type SupplyChainAssumptions = {
  freightPctSales: number;      // 0.09
  accessorialPctSales: number;  // 0.01
  storageMonthlyAvg: number;    // promedio real de storage
};

export type MonthForecast = { monthKey: string; grossSales: number };

/** Forecast por mes y bucket a partir del gross sales proyectado. */
export function forecastByMonth(
  months: MonthForecast[],
  a: SupplyChainAssumptions,
): Map<string, MonthlyByBucket> {
  const out = new Map<string, MonthlyByBucket>();
  for (const m of months) {
    const freight = r2(m.grossSales * a.freightPctSales);
    const accessorial = r2(m.grossSales * a.accessorialPctSales);
    const storage = r2(a.storageMonthlyAvg);
    out.set(m.monthKey, { freight, accessorial, storage, total: r2(freight + accessorial + storage) });
  }
  return out;
}

/** Promedio de storage real de los últimos `n` meses (para autocompletar la assumption). */
export function storageMonthlyAvgFromReal(real: Map<string, MonthlyByBucket>, n = 6): number {
  const keys = [...real.keys()].sort().slice(-n);
  if (!keys.length) return 0;
  const sum = keys.reduce((s, k) => s + (real.get(k)?.storage ?? 0), 0);
  return r2(sum / keys.length);
}

// ── 7. Mezcla del mes corriente (real + forecast pendiente) ──────────────────
export type SeriesPoint = {
  monthKey: string;
  kind: "real" | "current" | "forecast";
  // por bucket: lo REAL ya cargado
  real: MonthlyByBucket;
  // por bucket: lo que falta para llegar al forecast (barra azul); 0 en meses reales
  pending: MonthlyByBucket;
  // total mostrado por bucket = real + pending = max(forecast, real)
  shown: MonthlyByBucket;
};

const emptyBucket = (): MonthlyByBucket => ({ freight: 0, accessorial: 0, storage: 0, total: 0 });
const maxBucket = (real: MonthlyByBucket, fc: MonthlyByBucket): MonthlyByBucket => ({
  freight: Math.max(real.freight, fc.freight),
  accessorial: Math.max(real.accessorial, fc.accessorial),
  storage: Math.max(real.storage, fc.storage),
  total: Math.max(real.total, fc.total),
});
const subBucket = (a: MonthlyByBucket, b: MonthlyByBucket): MonthlyByBucket => ({
  freight: Math.max(0, r2(a.freight - b.freight)),
  accessorial: Math.max(0, r2(a.accessorial - b.accessorial)),
  storage: Math.max(0, r2(a.storage - b.storage)),
  total: Math.max(0, r2(a.total - b.total)),
});

/**
 * Serie mensual real+forecast:
 *  - mes pasado (< currentMonthKey): solo REAL.
 *  - mes corriente (= currentMonthKey): real (verde) + pendiente = max(0, forecast - real) (azul);
 *    total = max(forecast, real). Si real supera forecast → pendiente 0.
 *  - mes futuro (> currentMonthKey): solo forecast.
 *
 * `currentMonthKey` = new Date().toISOString().slice(0,7) — pasarlo desde el componente.
 */
export function buildSupplyChainSeries(
  real: Map<string, MonthlyByBucket>,
  forecast: Map<string, MonthlyByBucket>,
  currentMonthKey: string,
  fromKey: string,
): SeriesPoint[] {
  const keys = new Set<string>([...real.keys(), ...forecast.keys()]);
  const sorted = [...keys].filter(k => k >= fromKey).sort();
  return sorted.map(k => {
    const rb = real.get(k) ?? emptyBucket();
    const fb = forecast.get(k) ?? emptyBucket();
    if (k < currentMonthKey) {
      return { monthKey: k, kind: "real", real: rb, pending: emptyBucket(), shown: rb };
    }
    if (k > currentMonthKey) {
      return { monthKey: k, kind: "forecast", real: emptyBucket(), pending: fb, shown: fb };
    }
    // mes corriente
    const pending = subBucket(fb, rb);
    const shown = maxBucket(rb, fb);
    return { monthKey: k, kind: "current", real: rb, pending, shown };
  });
}
