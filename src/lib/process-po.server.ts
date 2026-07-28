// Server-only helpers for PO document processing.

export const ITEM_MAP: Record<string, string> = {
  "88021": "XD", "23141": "WD", "77670": "PW",
  "77671": "HM", "77672": "Matcha", "93562": "WM",
};

export const SKU_DESCRIPTIONS: Record<string, string> = {
  XD: "Rasp covered in organic extra dark",
  WD: "Rasp covered in dark & white choc 5OZ",
  PW: "Rasp covered in pistachio & white 5OZ",
  HM: "Rasp covered in hazelnut & milk 5OZ",
  Matcha: "Rasp covered in matcha & white 5OZ",
  WM: "Rasp covered in milk & white choc 5OZ",
};

export const SKU_UPC: Record<string, string> = {
  XD: "00197644880218", WD: "00197644231410",
  PW: "00197644776700", HM: "00197644776717",
  Matcha: "00197644776724", WM: "00197644935620",
};

export const SKU_WEIGHT: Record<string, number> = {
  XD: 3.41, WD: 3.41, PW: 3.41, HM: 3.41, Matcha: 3.41, WM: 3.41,
};

const DISTRIBUTOR_MAP: Record<string, string> = {
  UNFI: "UNFI", KEHE: "KeHe", "KEHE DISTRIBUTORS": "KeHe",
  RAINFOREST: "Rainforest", RFD: "RFD", DIRECT: "Direct",
};

export function normDist(raw: string): string {
  const upper = (raw ?? "").toUpperCase();
  for (const [k, v] of Object.entries(DISTRIBUTOR_MAP)) {
    if (upper.includes(k)) return v;
  }
  return "Other";
}

export type PoItem = {
  sku: string;
  itemNumber: string;
  cases: number;
  weight: number;
  unitPrice: number;
};

export function generatePackingSlipHTML(data: {
  poNumber: string; poDate: string; pickupDate: string;
  shipTo: string; shipToName: string;
  items: PoItem[];
  totalCases: number; totalLbs: number;
}): string {
  const itemRows = data.items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? "#ffffff" : "#F2E0E5"}">
      <td style="padding:6px 8px;border:1px solid #ccc;">${SKU_DESCRIPTIONS[item.sku] ?? item.sku}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">${SKU_UPC[item.sku] ?? ""}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;">${item.itemNumber}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${item.cases}</td>
      <td style="padding:6px 8px;border:1px solid #ccc;text-align:center;">${item.weight}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Calibri, sans-serif; font-size: 13px; margin: 40px; color: #1a1a1a; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  h2 { font-size: 16px; color: #7B1D3A; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  .th-dark { background: #7B1D3A; color: white; font-weight: bold; padding: 6px 8px; border: 1px solid #7B1D3A; }
  .td { padding: 6px 8px; border: 1px solid #ccc; }
  .alt { background: #F2E0E5; }
  .section-title { font-weight: bold; font-size: 14px; margin: 16px 0 6px; }
</style></head>
<body>
<h1>Packing Slip</h1>
<h2>PATAGONIA BITES CORP</h2>

<table>
  <tr><td class="th-dark" style="width:30%">PO #</td><td class="td">${data.poNumber}</td></tr>
  <tr><td class="th-dark">PO DATE</td><td class="td alt">${data.poDate}</td></tr>
  <tr><td class="th-dark">VENDOR #</td><td class="td">PATAGONIA BITES CORP</td></tr>
  <tr><td class="th-dark">TEMPERATURE</td><td class="td alt">Frozen (0 F)</td></tr>
  <tr><td class="th-dark">PICKUP DATE</td><td class="td">${data.pickupDate}</td></tr>
</table>

<table>
  <tr>
    <td class="th-dark" style="width:50%">SHIP FROM</td>
    <td class="th-dark" style="width:50%">SHIP TO</td>
  </tr>
  <tr>
    <td class="td" style="vertical-align:top">LINEAGE NEWARK<br>360 Avenue P<br>Newark, NJ 07105</td>
    <td class="td" style="vertical-align:top">${data.shipToName}<br>${(data.shipTo ?? "").replace(/\n/g, "<br>")}</td>
  </tr>
</table>

<p>Note: Freight Prepaid by Seller - Destination.</p>

<div class="section-title">LOAD</div>
<table>
  <tr>
    <td class="th-dark" style="width:33%">Total Pallets</td>
    <td class="th-dark" style="width:33%">Total LBS</td>
    <td class="th-dark" style="width:33%">Total Cases</td>
  </tr>
  <tr>
    <td class="td"><strong>TBD</strong></td>
    <td class="td"><strong>${data.totalLbs}</strong></td>
    <td class="td"><strong>${data.totalCases}</strong></td>
  </tr>
</table>

<table>
  <tr>
    <td class="th-dark" style="width:30%">Total Load</td>
    <td class="th-dark" style="width:20%">Case UPC</td>
    <td class="th-dark" style="width:20%">Item/unit number</td>
    <td class="th-dark" style="width:15%">Cases</td>
    <td class="th-dark" style="width:15%">Weight (LBS)</td>
  </tr>
  ${itemRows}
  <tr>
    <td class="td"></td><td class="td"></td>
    <td class="td"><strong>TOTAL</strong></td>
    <td class="td" style="text-align:center"><strong>${data.totalCases}</strong></td>
    <td class="td" style="text-align:center"><strong>${data.totalLbs}</strong></td>
  </tr>
</table>

<br><br>
<table>
  <tr>
    <td class="td" style="width:50%">____________________________<br><strong>Shipper (Lineage Newark)</strong><br>Sign / Print / Date</td>
    <td class="td" style="width:50%">____________________________<br><strong>Carrier / Driver (${data.shipToName})</strong><br>Sign / Print / Date</td>
  </tr>
</table>
</body></html>`;
}

export const EXTRACTION_PROMPT = `Extract all PO details from this document. Item codes map to SKUs: 23141=WD, 77670=PW, 77671=HM, 77672=Matcha, 88021=XD, 93562=WM.
Distributor values must be one of: UNFI, KeHe, Rainforest, RFD, Direct, Other.
Return ONLY valid JSON with this exact structure:
{
  "po_number": "string",
  "po_date": "YYYY-MM-DD",
  "ship_date": "YYYY-MM-DD",
  "distributor": "UNFI|KeHe|Rainforest|RFD|Direct|Other",
  "customer": "string (DC name e.g. UNFI Iowa City Warehouse)",
  "ship_to_address": "string (full address)",
  "location_id": "string or empty",
  "freight_terms": "string",
  "items": [
    { "item_number": "88021", "sku": "XD", "cases": 120, "unit_price": 36.96, "weight_lbs": 409 }
  ],
  "total_cases": 120,
  "total_amount": 4435.20,
  "discount_percent": 2.0
}`;

export function toBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
