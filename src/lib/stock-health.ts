// Shared Stock Health heatmap logic — used by Fulfillment tab, Home, and the Weekly PPT.
export const SH_KEY = "baris.fulfillment.stockhealth.v1";

export const SH_PRODUCTS = [
  "Dark & White Rasp 5oz", "Extra Dark Rasp 5oz", "Hazelnut Rasp 5oz",
  "Matcha Rasp 5oz", "Milk & White Rasp 5oz", "Pistachio Rasp 5oz",
];
export const UNFI_DCS = [
  "Chesterfield NH DC","Dayville CT DC","Greenwood IN DC","Hudson Valley NY DC",
  "Iowa City IA DC","Joliet, IL DC","Manchester PA DC","Moreno Valley CA DC",
  "Prescott WI DC","Ridgefield WA DC","Rocklin CA DC","Sarasota North FL DC",
];
// Fixed authorized SKUs per UNFI DC (short names → full via " Rasp 5oz"). Matcha never authorized.
const UNFI_AUTH_SHORT: Record<string, string[]> = {
  "Chesterfield NH DC": ["Dark & White","Extra Dark","Milk & White"],
  "Dayville CT DC": ["Dark & White","Extra Dark","Milk & White"],
  "Greenwood IN DC": ["Dark & White","Extra Dark","Milk & White","Pistachio"],
  "Hudson Valley NY DC": ["Dark & White","Milk & White","Pistachio"],
  "Iowa City IA DC": ["Extra Dark","Hazelnut","Pistachio"],
  "Joliet, IL DC": ["Extra Dark","Hazelnut","Pistachio"],
  "Manchester PA DC": ["Dark & White","Hazelnut","Milk & White","Pistachio"],
  "Moreno Valley CA DC": ["Dark & White","Extra Dark"],
  "Prescott WI DC": ["Dark & White","Hazelnut","Milk & White","Pistachio"],
  "Ridgefield WA DC": ["Pistachio"],
  "Rocklin CA DC": ["Dark & White","Extra Dark","Milk & White","Pistachio"],
  "Sarasota North FL DC": ["Dark & White","Milk & White"],
};
export const UNFI_AUTH: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(UNFI_AUTH_SHORT).map(([dc, arr]) => [dc, new Set(arr.map(s => `${s} Rasp 5oz`))])
);

export type SHRec = { product: string; dc: string; qty: number; woh: number };
export type Cell = { text: string | null; bg: string | null; fg: string | null }; // text null = dash / never
export type Grid = { dcs: string[]; rows: { product: string; cells: Cell[] }[] };

export const DASH: Cell = { text: null, bg: null, fg: null };
export const isUnfi = (dc: string) => dc.trim().endsWith("DC");
export const shortDc = (n: string) => (n.length > 14 ? n.slice(0, 13) + "…" : n);
export function wohColor(wk: number): { bg: string; fg: string } {
  if (wk <= 2) return { bg: "#d03b3b", fg: "#ffffff" };
  if (wk <= 4) return { bg: "#ec835a", fg: "#4a1b0c" };
  if (wk <= 6) return { bg: "#fab219", fg: "#412402" };
  return { bg: "#0ca30c", fg: "#ffffff" };
}

function parseCsvText(text: string): string[][] {
  const out: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.length) continue;
    const cells: string[] = []; let cur = ""; let q = false;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (q) { if (ch === '"') { if (raw[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === ",") { cells.push(cur); cur = ""; } else cur += ch; }
    }
    cells.push(cur);
    out.push(cells);
  }
  return out;
}

export function parseStockHealth(text: string): SHRec[] {
  const rows = parseCsvText(text);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.replace(/^\uFEFF/, "").trim().toLowerCase());
  const iP = header.indexOf("product");
  const iDc = header.indexOf("dc");
  const iQty = header.findIndex(h => h.startsWith("qty on hand"));
  const iWoh = header.findIndex(h => h.startsWith("weeks on hand"));
  if (iP < 0 || iDc < 0 || iQty < 0) return [];
  const recs: SHRec[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row[iP]) continue;
    recs.push({
      product: row[iP].trim(), dc: (row[iDc] || "").trim(),
      qty: parseFloat(row[iQty]) || 0, woh: iWoh >= 0 ? (parseFloat(row[iWoh]) || 0) : 0,
    });
  }
  return recs;
}

export function loadStockHealth(): { records: SHRec[]; updatedAt: string | null } {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(SH_KEY) : null;
    if (raw) { const p = JSON.parse(raw); return { records: p.records ?? [], updatedAt: p.updatedAt ?? null }; }
  } catch {}
  return { records: [], updatedAt: null };
}

export function buildGrids(records: SHRec[]): { kehe: Grid; unfi: Grid } {
  const lookup: Record<string, SHRec> = {};
  for (const r of records) lookup[`${r.product}||${r.dc}`] = r;

  // KeHE DCs = "City, ST" format, drop fully-inactive, sorted
  const keheSet = new Set<string>();
  for (const r of records) if (!isUnfi(r.dc)) keheSet.add(r.dc);
  const keheDcs = [...keheSet]
    .filter(dc => SH_PRODUCTS.some(p => (lookup[`${p}||${dc}`]?.qty ?? 0) > 0))
    .sort((a, b) => a.localeCompare(b));

  const kehe: Grid = {
    dcs: keheDcs,
    rows: SH_PRODUCTS.map(p => ({
      product: p,
      cells: keheDcs.map(dc => {
        const rec = lookup[`${p}||${dc}`];
        const qty = rec?.qty ?? 0;
        if (!qty || qty <= 0) return DASH;
        const c = wohColor(rec!.woh);
        return { text: String(Math.round(qty)), bg: c.bg, fg: c.fg };
      }),
    })),
  };

  const unfi: Grid = {
    dcs: UNFI_DCS,
    rows: SH_PRODUCTS.map(p => ({
      product: p,
      cells: UNFI_DCS.map(dc => {
        if (!UNFI_AUTH[dc]?.has(p)) return DASH;                        // never ordered
        const qty = lookup[`${p}||${dc}`]?.qty ?? 0;
        if (!qty || qty <= 0) return { text: "0", bg: "#d03b3b", fg: "#ffffff" }; // real stockout
        return { text: String(Math.round(qty)), bg: "#0ca30c", fg: "#ffffff" };   // healthy
      }),
    })),
  };

  return { kehe, unfi };
}
