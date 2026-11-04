// Shared Excel/CSV import utility — parses .xls, .xlsx, and .csv files.
// Uses SheetJS (xlsx) for robust parsing of all Excel formats.
// Falls back to manual CSV parsing if xlsx is not available.

export type ParsedRow = Record<string, string | number | null>;

/**
 * Parse an uploaded file (Excel or CSV) into an array of row objects.
 * Header row is used as keys. Values are auto-typed to numbers where appropriate.
 */
export async function parseExcelOrCsv(file: File): Promise<{ headers: string[]; rows: ParsedRow[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".tsv")) {
    return parseCsv(file, name.endsWith(".tsv") ? "\t" : ",");
  }
  // Excel: use SheetJS
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!raw.length) return { headers: [], rows: [] };
  const headers = raw[0].map((h: any) => String(h ?? "").trim());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || r.every((c: any) => c === "" || c == null)) continue;
    const obj: ParsedRow = {};
    for (let j = 0; j < headers.length; j++) {
      const v = r[j];
      if (v == null || v === "") { obj[headers[j]] = null; continue; }
      if (typeof v === "number") { obj[headers[j]] = v; continue; }
      const s = String(v).trim();
      const cleaned = s.replace(/[$,\s]/g, "");
      const n = Number(cleaned);
      if (s !== "" && cleaned !== "" && isFinite(n) && /^-?\d/.test(cleaned)) {
        obj[headers[j]] = n;
      } else {
        obj[headers[j]] = s;
      }
    }
    rows.push(obj);
  }
  return { headers, rows };
}

async function parseCsv(file: File, sep: string): Promise<{ headers: string[]; rows: ParsedRow[] }> {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].split(sep).map(h => h.replace(/^"|"$/g, "").trim());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(sep).map(c => c.replace(/^"|"$/g, "").trim());
    if (cells.every(c => !c)) continue;
    const obj: ParsedRow = {};
    for (let j = 0; j < headers.length; j++) {
      const v = cells[j] ?? "";
      if (!v) { obj[headers[j]] = null; continue; }
      const cleaned = v.replace(/[$,\s]/g, "");
      const n = Number(cleaned);
      if (cleaned && isFinite(n) && /^-?\d/.test(cleaned)) {
        obj[headers[j]] = n;
      } else {
        obj[headers[j]] = v;
      }
    }
    rows.push(obj);
  }
  return { headers, rows };
}
