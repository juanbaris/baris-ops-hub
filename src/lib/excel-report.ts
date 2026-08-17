// Library-free multi-sheet Excel export (SpreadsheetML 2003).
// Produces a .xls file that opens in Excel & Google Sheets with one tab per sheet — no dependency needed.
export type SheetCell = string | number | null | undefined;
export type Sheet = { name: string; rows: SheetCell[][] };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cellXml(v: SheetCell): string {
  if (typeof v === "number" && isFinite(v)) return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  const s = v == null ? "" : String(v);
  return `<Cell><Data ss:Type="String">${esc(s)}</Data></Cell>`;
}
// Excel worksheet names: max 31 chars, no : \ / ? * [ ]
function safeName(n: string): string {
  return n.replace(/[:\\/?*\[\]]/g, " ").slice(0, 31) || "Sheet";
}

export function downloadExcel(filename: string, sheets: Sheet[]) {
  const sheetsXml = sheets.map(sh => {
    const rows = sh.rows.map(r => `<Row>${r.map(cellXml).join("")}</Row>`).join("");
    return `<Worksheet ss:Name="${esc(safeName(sh.name))}"><Table>${rows}</Table></Worksheet>`;
  }).join("");
  const xml =
    `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
    `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:x="urn:schemas-microsoft-com:office:excel" ` +
    `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheetsXml}</Workbook>`;
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
