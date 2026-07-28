import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

const ITEM_MAP: Record<string, string> = {
  "88021": "XD", "23141": "WD", "77670": "PW",
  "77671": "HM", "77672": "Matcha", "93562": "WM",
};

const SKU_DESCRIPTIONS: Record<string, string> = {
  "XD": "Rasp covered in organic extra dark",
  "WD": "Rasp covered in dark & white choc 5OZ",
  "PW": "Rasp covered in pistachio & white 5OZ",
  "HM": "Rasp covered in hazelnut & milk 5OZ",
  "Matcha": "Rasp covered in matcha & white 5OZ",
  "WM": "Rasp covered in milk & white choc 5OZ",
};

const SKU_UPC: Record<string, string> = {
  "XD": "00197644880218", "WD": "00197644231410",
  "PW": "00197644776700", "HM": "00197644776717",
  "Matcha": "00197644776724", "WM": "00197644935620",
};

// Weights per case (LBS) approximate
const SKU_WEIGHT: Record<string, number> = {
  "XD": 3.41, "WD": 3.41, "PW": 3.41, "HM": 3.41, "Matcha": 3.41, "WM": 3.41,
};

const DISTRIBUTOR_MAP: Record<string, string> = {
  "UNFI": "UNFI", "KEHE": "KeHe", "KEHE DISTRIBUTORS": "KeHe",
  "RAINFOREST": "Rainforest", "RFD": "RFD",
};

function normDist(raw: string): string {
  const upper = raw.toUpperCase();
  for (const [k, v] of Object.entries(DISTRIBUTOR_MAP)) {
    if (upper.includes(k)) return v;
  }
  return "Other";
}

// ─── Generate Packing Slip HTML (returns base64 encoded HTML for download) ───
function generatePackingSlipHTML(data: {
  poNumber: string; poDate: string; pickupDate: string;
  shipTo: string; shipToName: string;
  items: { sku: string; itemNumber: string; cases: number; weight: number }[];
  totalCases: number; totalLbs: number;
}): string {
  const itemRows = data.items.map((item, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#F2E0E5'}">
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
    <td class="td" style="vertical-align:top">${data.shipToName}<br>${data.shipTo.replace(/\n/g, "<br>")}</td>
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY" }), { status: 500 });

  try {
    const { fileBase64, mediaType } = await req.json();
    if (!fileBase64 || !mediaType) {
      return new Response(JSON.stringify({ error: "Missing fileBase64 or mediaType" }), { status: 400 });
    }

    // ── Step 1: Extract PO data with Claude Vision ─────────────────────────
    const extractRes = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            {
              type: mediaType === "application/pdf" ? "document" : "image",
              source: { type: "base64", media_type: mediaType, data: fileBase64 },
            },
            {
              type: "text",
              text: `Extract all PO details from this document. Item codes map to SKUs: 23141=WD, 77670=PW, 77671=HM, 77672=Matcha, 88021=XD, 93562=WM. 
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
              }`
            }
          ]
        }]
      })
    });

    const extractData = await extractRes.json();
    const rawText = extractData.content?.[0]?.text ?? "{}";
    const clean = rawText.replace(/```json|```/g, "").trim();
    const po = JSON.parse(clean);

    // ── Step 2: Build structured response ────────────────────────────────
    const items = (po.items ?? []).map((item: { sku?: string; item_number?: string; cases?: number; weight_lbs?: number; unit_price?: number }) => ({
      sku: item.sku ?? ITEM_MAP[item.item_number ?? ""] ?? "XD",
      itemNumber: item.item_number ?? "",
      cases: item.cases ?? 0,
      weight: item.weight_lbs ?? Math.round((item.cases ?? 0) * SKU_WEIGHT[item.sku ?? "XD"]),
      unitPrice: item.unit_price ?? 0,
    }));

    const totalCases = items.reduce((s: number, i: { cases: number }) => s + i.cases, 0);
    const totalLbs = items.reduce((s: number, i: { weight: number }) => s + i.weight, 0);
    const grossSales = po.total_amount ?? items.reduce((s: number, i: { cases: number; unitPrice: number }) => s + i.cases * i.unitPrice, 0);
    const discountPct = po.discount_percent ?? 0;
    const promoDiscount = Math.round(grossSales * discountPct) / 100;
    const netSales = grossSales - promoDiscount;

    // ── Step 3: Generate Packing Slip HTML ────────────────────────────────
    const psHTML = generatePackingSlipHTML({
      poNumber: po.po_number ?? "",
      poDate: po.po_date ?? "",
      pickupDate: po.ship_date ?? "",
      shipToName: po.customer ?? "",
      shipTo: po.ship_to_address ?? "",
      items,
      totalCases,
      totalLbs,
    });

    const psBase64 = btoa(unescape(encodeURIComponent(psHTML)));

    // ── Response ──────────────────────────────────────────────────────────
    return new Response(JSON.stringify({
      // Form fields
      po_number: po.po_number ?? "",
      po_date: po.po_date ?? "",
      ship_est_date: po.ship_date ?? "",
      distributor: normDist(po.distributor ?? ""),
      customer: po.customer ?? "",
      // SKU cases
      wd_cases: items.find((i: { sku: string }) => i.sku === "WD")?.cases ?? 0,
      pw_cases: items.find((i: { sku: string }) => i.sku === "PW")?.cases ?? 0,
      hm_cases: items.find((i: { sku: string }) => i.sku === "HM")?.cases ?? 0,
      matcha_cases: items.find((i: { sku: string }) => i.sku === "Matcha")?.cases ?? 0,
      xd_cases: items.find((i: { sku: string }) => i.sku === "XD")?.cases ?? 0,
      wm_cases: items.find((i: { sku: string }) => i.sku === "WM")?.cases ?? 0,
      // Financials
      gross_sales: Math.round(grossSales * 100) / 100,
      promo_discount: Math.round(promoDiscount * 100) / 100,
      net_sales: Math.round(netSales * 100) / 100,
      // Packing slip
      packing_slip_html: psBase64,
      packing_slip_filename: `BARIS_PS_${po.po_number ?? "NEW"}.html`,
    }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
});
