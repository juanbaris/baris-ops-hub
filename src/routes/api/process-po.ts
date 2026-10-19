import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  fileBase64: z.string().min(1).max(30_000_000),
  mediaType: z.enum([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ]),
  mode: z.string().optional(),
}).passthrough();

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export const Route = createFileRoute("/api/process-po")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return Response.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
        }

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));

        // Handle AI search mode — no file needed
        if (parsed.success && parsed.data.mode === "search") {
          const { query, context } = parsed.data as any;
          const searchResp = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 512,
              messages: [{
                role: "user",
                content: `You are a helpful assistant for BARIS, a frozen berry CPG brand. Answer the question based ONLY on the data provided. Be concise and direct. Use numbers from the data exactly.\n\nDATA:\n${context}\n\nQUESTION: ${query}`,
              }],
            }),
          });
          if (searchResp.ok) {
            const searchData = await searchResp.json();
            const answer = searchData.content?.[0]?.text ?? "No answer found.";
            return Response.json({ answer });
          }
          return Response.json({ answer: "Could not get an answer." });
        }

        // Handle BOL extraction mode — extracts cases, lot numbers, ship date, BOL number
        if (parsed.success && parsed.data.mode === "bol") {
          const { fileBase64: bolBase64, mediaType: bolMediaType } = parsed.data;
          const bolRes = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 1000,
              messages: [{
                role: "user",
                content: [
                  { type: bolMediaType === "application/pdf" ? "document" : "image",
                    source: { type: "base64", media_type: bolMediaType, data: bolBase64 } },
                  { type: "text", text: `Extract data from this Bill of Lading. Return ONLY valid JSON, no markdown.

IMPORTANT: A single SKU item may be split across MULTIPLE lots with different quantities. Each lot line shows a sub-lot number (e.g. 97353L) and a MOC code (e.g. BA218261). Extract EVERY lot line separately.

{
  "bol_number": "string (BOL or PRO number, e.g. A6-247427 or C1-237108)",
  "ship_date": "YYYY-MM-DD",
  "wd_cases": 0,
  "pw_cases": 0,
  "hm_cases": 0,
  "matcha_cases": 0,
  "xd_cases": 0,
  "wm_cases": 0,
  "lots": [
    {"sku_key": "hm", "sub_lot": "97353L", "moc": "BA218261", "cases": 41},
    {"sku_key": "xd", "sub_lot": "97344L", "moc": "BA212261", "cases": 35}
  ]
}

SKU item numbers: WD=23141, PW=77670, HM=77671, Matcha=77672, XD=88021, WM=93562.
sku_key mapping: WD→"wd", PW→"pw", HM→"hm", Matcha→"matcha", XD→"xd", WM→"wm".

The BOL structure is: a header line with total cases and item code (e.g. "45CS 77671 HAZELNUT AND MILK..."), followed by one or more lot lines (e.g. "41CS 97353L BA218261"). Each lot line has: quantity, sub-lot number (e.g. 97353L, 98281L), and MOC code (e.g. BA218261, BA212261).

Extract ALL lot lines. The sub_lot is the alphanumeric code like 97353L. The moc is the BA-prefixed code like BA218261.
Use 0 for cases not found. Return empty lots array if no lot detail is visible.` }
                ]
              }]
            }),
          });
          if (bolRes.ok) {
            const bolData = await bolRes.json();
            const bolText = bolData.content?.[0]?.text ?? "{}";
            try {
              const extracted = JSON.parse(bolText.replace(/```json|```/g, "").trim());
              return Response.json(extracted);
            } catch {
              return Response.json({ wd_cases:0, pw_cases:0, hm_cases:0, matcha_cases:0, xd_cases:0, wm_cases:0 });
            }
          }
          return Response.json({ wd_cases:0, pw_cases:0, hm_cases:0, matcha_cases:0, xd_cases:0, wm_cases:0 });
        }

        if (!parsed.success) {
          return Response.json(
            { error: "Invalid body: expected fileBase64 and a supported mediaType" },
            { status: 400 },
          );
        }
        const { fileBase64, mediaType } = parsed.data;

        const {
          ITEM_MAP,
          SKU_WEIGHT,
          normDist,
          generatePackingSlipHTML,
          EXTRACTION_PROMPT,
          toBase64Utf8,
        } = await import("@/lib/process-po.server");

        try {
          const extractRes = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-5",
              max_tokens: 1500,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: mediaType === "application/pdf" ? "document" : "image",
                      source: { type: "base64", media_type: mediaType, data: fileBase64 },
                    },
                    { type: "text", text: EXTRACTION_PROMPT },
                  ],
                },
              ],
            }),
          });

          if (!extractRes.ok) {
            console.error("Anthropic error", extractRes.status, await extractRes.text());
            return Response.json(
              { error: "Document extraction service failed" },
              { status: 502 },
            );
          }

          const extractData = (await extractRes.json()) as {
            content?: { text?: string }[];
          };
          const rawText = extractData.content?.[0]?.text ?? "{}";
          const clean = rawText.replace(/```json|```/g, "").trim();

          let po: Record<string, unknown>;
          try {
            po = JSON.parse(clean);
          } catch {
            return Response.json(
              { error: "Could not read PO data from this document" },
              { status: 422 },
            );
          }

          const rawItems = (po.items ?? []) as {
            sku?: string;
            item_number?: string;
            cases?: number;
            weight_lbs?: number;
            unit_price?: number;
          }[];

          const items = rawItems.map((item) => {
            const sku = item.sku ?? ITEM_MAP[item.item_number ?? ""] ?? "XD";
            return {
              sku,
              itemNumber: item.item_number ?? "",
              cases: item.cases ?? 0,
              weight:
                item.weight_lbs ??
                Math.round((item.cases ?? 0) * (SKU_WEIGHT[sku] ?? 3.41)),
              unitPrice: item.unit_price ?? 0,
            };
          });

          const totalCases = items.reduce((s, i) => s + i.cases, 0);
          const totalLbs = items.reduce((s, i) => s + i.weight, 0);
          const grossSales =
            (po.total_amount as number | undefined) ??
            items.reduce((s, i) => s + i.cases * i.unitPrice, 0);
          const discountPct = (po.discount_percent as number | undefined) ?? 0;
          const promoDiscount = (po.promo_discount_amount as number | undefined)
            ?? Math.round(grossSales * discountPct) / 100;
          const netSales = grossSales - promoDiscount;

          const poNumber = (po.po_number as string | undefined) ?? "";
          const psHTML = generatePackingSlipHTML({
            poNumber,
            poDate: (po.po_date as string | undefined) ?? "",
            pickupDate: (po.ship_date as string | undefined) ?? "",
            shipToName: (po.customer as string | undefined) ?? "",
            shipTo: (po.ship_to_address as string | undefined) ?? "",
            distributor: normDist((po.distributor as string | undefined) ?? ""),
            items,
            totalCases,
            totalLbs,
          });

          const casesFor = (sku: string) =>
            items.find((i) => i.sku === sku)?.cases ?? 0;

          return Response.json({
            po_number: poNumber,
            po_date: (po.po_date as string | undefined) ?? "",
            ship_est_date: (po.ship_date as string | undefined) ?? "",
            distributor: normDist((po.distributor as string | undefined) ?? ""),
            customer: (po.customer as string | undefined) ?? "",
            ship_to_address: (po.ship_to_address as string | undefined) ?? "",
            wd_cases: casesFor("WD"),
            pw_cases: casesFor("PW"),
            hm_cases: casesFor("HM"),
            matcha_cases: casesFor("Matcha"),
            xd_cases: casesFor("XD"),
            wm_cases: casesFor("WM"),
            total_cases: totalCases,
            gross_sales: Math.round(grossSales * 100) / 100,
            promo_discount: Math.round(promoDiscount * 100) / 100,
            net_sales: Math.round(netSales * 100) / 100,
            packing_slip_html: toBase64Utf8(psHTML),
            packing_slip_filename: `BARIS_PS_${poNumber || "NEW"}.html`,
          });
        } catch (err) {
          console.error("process-po failed", err);
          return Response.json({ error: "Failed to process PO" }, { status: 500 });
        }
      },
    },
  },
});
