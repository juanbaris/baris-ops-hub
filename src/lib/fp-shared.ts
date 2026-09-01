import type { Database } from "@/integrations/supabase/types";

export type SKU = Database["public"]["Enums"]["sku"];
export type Warehouse = Database["public"]["Enums"]["warehouse"];
export type FPConcept = Database["public"]["Enums"]["fp_concept"];
export type FPRow = Database["public"]["Tables"]["fp_movements"]["Row"];
export type LotRow = Database["public"]["Tables"]["lot_master"]["Row"];

export const SKUS: SKU[] = ["XD", "PW", "HM", "WM", "WD", "Matcha"];

/** BARIS display names. The DB enum keeps the short codes. */
export const SKU_LABEL: Record<SKU, string> = {
  XD: "XD", PW: "P&W", HM: "H&M", WM: "W&M", WD: "W&D", Matcha: "Matcha",
  // New flavors confirmed for launch (fixed in Operations) — not yet used in Fulfillment/Home.
  "Strawberry & White": "Strawberry & White", "Strawberry Caramel": "Strawberry Caramel",
  "Strawberry Yogurt": "Strawberry Yogurt", "Raspberry Yogurt": "Raspberry Yogurt",
};

/** Maps any written form ("P&W", "pw", "P & W") back to the DB enum value. */
export function toSku(raw: string | null | undefined): SKU | null {
  if (!raw) return null;
  const k = raw.replace(/[\s&]/g, "").toUpperCase();
  const hit = SKUS.find((s) => s.toUpperCase() === k);
  return hit ?? (k === "MATCHA" ? "Matcha" : null);
}

export function skuLabel(raw: string | null | undefined): string {
  const s = toSku(raw);
  return s ? SKU_LABEL[s] : (raw ?? "—");
}

export const WAREHOUSES: Warehouse[] = [
  "Lineage Newark", "Cold Chain", "FreezPak", "Empire",
  "PermaFrost", "Pod Chicago", "Pod MidAtlantic", "Pod Texas",
];

export const FP_CONCEPTS: FPConcept[] = [
  "Production", "Sale", "Sample", "Damage", "Transfer", "Free", "Balance correction", "Historical",
];

export type CogsStatus = "confirmed" | "estimated" | "missing";
export type LotCard = { cogs: number | null; status: CogsStatus; expiry: string | null; sku: SKU | null };

export function buildLotMap(lots: Pick<LotRow, "lot_number" | "cogs_per_case" | "cogs_status" | "expiry_date" | "sku">[]) {
  const map: Record<string, LotCard> = {};
  for (const l of lots) {
    map[normLot(l.lot_number)] = {
      cogs: l.cogs_per_case == null ? null : Number(l.cogs_per_case),
      status: (l.cogs_status as CogsStatus) ?? "missing",
      expiry: l.expiry_date,
      sku: toSku(l.sku),
    };
  }
  return map;
}

export function normLot(lot: string | null | undefined) {
  return (lot ?? "").trim().toUpperCase();
}

/** Movement-level COGS wins; otherwise fall back to the Lot Master card. */
export function resolveCogs(
  m: { cogs_per_case?: number | string | null; lot_number: string | null },
  lotMap: Record<string, LotCard>,
): { cogs: number | null; status: CogsStatus } {
  if (m.cogs_per_case != null && m.cogs_per_case !== "") {
    return { cogs: Number(m.cogs_per_case), status: "confirmed" };
  }
  const card = lotMap[normLot(m.lot_number)];
  if (card?.cogs != null) return { cogs: card.cogs, status: card.status === "missing" ? "confirmed" : card.status };
  return { cogs: null, status: "missing" };
}

export const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

export const money2 = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toFixed(2)}`;

export function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(`${d}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

export function monthKey(d: string) { return d.slice(0, 7); }

export function daysBetween(from: string, to = new Date()) {
  const a = new Date(`${from}T00:00:00`).getTime();
  return Math.max(0, Math.round((to.getTime() - a) / 86400000));
}

export function monthsUntil(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const t = new Date(`${dateStr}T00:00:00`).getTime();
  if (Number.isNaN(t)) return null;
  return (t - Date.now()) / (86400000 * 30.44);
}

export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => (typeof c === "string" && /[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
