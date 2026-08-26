// src/routes/api/parse-logistics-invoice.ts
//
// Lee una factura de logística (PDF/imagen) con Claude y devuelve los campos
// listos para el formulario de carga. Mismo patrón que /api/process-po.
//
// Requiere el secret ANTHROPIC_API_KEY (ya lo usás en process-po).

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({
  fileBase64: z.string().min(1).max(30_000_000),
  mediaType: z.enum([
    "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif",
  ]),
}).passthrough();

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// DCs canónicos que ya existen en la app (para que la IA mapee a uno de estos).
const CANONICAL_DCS = [
  "UNFI Moreno Valley", "UNFI Rocklin", "UNFI Ridgefield", "UNFI Sarasota",
  "UNFI Iowa City", "UNFI Greenwood", "UNFI Hudson Valley", "UNFI Racine",
  "UNFI Lancaster (Dallas)", "UNFI Manchester", "UNFI York", "UNFI Joliet",
  "UNFI Twin Cities", "UNFI Chesterfield", "UNFI Dayville",
  "Rainforest Bayonne/NJ", "Rainforest Maryland/Frederick",
  "KeHe Chino", "KeHe Hialeah", "KeHe Phoenix", "KeHe Aurora", "KeHe Dallas",
  "KeHe Maryland", "KeHe Douglasville", "KeHe Stockton", "KeHe Ellettsville", "KeHe Portland",
];

const EXTRACTION_PROMPT = `You are reading ONE logistics invoice for BARIS (frozen berry brand). Extract the billing data and return ONLY valid JSON, no markdown, no explanation.

Return exactly this shape:
{
  "invoice_number": "string",
  "invoice_date": "YYYY-MM-DD",
  "carrier": "Lineage" | "KeHe",
  "category": "freight" | "accessorial" | "storage_receipt" | "storage_renewal",
  "canonical_dc": "string or null",
  "cases": number or null,
  "pallets": number or null,
  "weight_lb": number or null,
  "freight_base": number or null,
  "fuel": number or null,
  "detention": number or null,
  "lumper": number or null,
  "total_charged": number,
  "bol": "string or null",
  "po_ref": "string or null",
  "is_supplemental": boolean
}

RULES (very important):

1) total_charged = THE AMOUNT ACTUALLY OWED / "PLEASE PAY THIS AMOUNT" / "TOTAL DUE".
   - On Lineage STORAGE receipts there are two numbers: "Gross" and "Net" are the VALUE OF THE MERCHANDISE (the product) — NEVER use those as the cost. The amount to pay is the sum of the "Summary Of charges" block (it appears in the AMOUNT column next to "Gross:"). Use that.
   - On freight/accessorial invoices, total_charged = the invoice TOTAL DUE.

2) carrier: "Lineage Transportation LLC" or "Lineage Logistics PFS" => "Lineage". Any KeHE / "Freight Support Service" / invoice number starting with "FSS" => "KeHe".

3) category:
   - "freight" = a transportation invoice (Lineage Transportation LLC, or KeHe FSS). Has freight base, fuel surcharge, weight, pallets, a consignee/destination, BOL, PO.
   - "accessorial" = Lineage PFS dispatch charges: Bill of Lading + Case Picking + Loading Truck/Container. Usually references "Orders 123, 456, ...".
   - "storage_receipt" = Lineage PFS RECEIPT invoice: Handling + Initial Storage (+ Consolidate Pallets / Shrink Wrap / Loading-Unloading). Charged when pallets ENTER the warehouse.
   - "storage_renewal" = Lineage PFS renewal invoice: "Storage - Recurring" / "Storage - Extended" / "Storage - Long Term".

4) canonical_dc: only for freight. Map the consignee/destination to the closest of this list (return the exact string, or null if none matches): ${CANONICAL_DCS.join(", ")}.

5) freight components (freight only): freight_base = the base freight line; fuel = fuel surcharge $; detention = detention $; lumper = lumper $. Use null if not present. For storage/accessorial leave these null.

6) po_ref: all PO numbers on the invoice, comma-separated. For accessorial with "Orders 111, 222, 333" put "111, 222, 333".

7) is_supplemental = true ONLY when this is a freight invoice whose freight base is ~0 (e.g. 0.01) and the real charge is just a later Lumper for the same BOL. Otherwise false.

8) Dates: normalize to YYYY-MM-DD (invoices may show MM.DD.YY, MON-DD-YY, or MM/DD/YYYY).

Return numbers as plain numbers (no "$" or commas). Use null (not 0) when a field is genuinely absent, except total_charged which must be a number.`;

export const Route = createFileRoute("/api/parse-logistics-invoice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          return Response.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
        }

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json({ error: "Invalid body: expected fileBase64 and mediaType" }, { status: 400 });
        }
        const { fileBase64, mediaType } = parsed.data;

        try {
          const res = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 1200,
              messages: [{
                role: "user",
                content: [
                  { type: mediaType === "application/pdf" ? "document" : "image",
                    source: { type: "base64", media_type: mediaType, data: fileBase64 } },
                  { type: "text", text: EXTRACTION_PROMPT },
                ],
              }],
            }),
          });

          if (!res.ok) {
            console.error("Anthropic error", res.status, await res.text());
            return Response.json({ error: "Invoice extraction service failed" }, { status: 502 });
          }

          const data = (await res.json()) as { content?: { text?: string }[] };
          const raw = data.content?.[0]?.text ?? "{}";
          const clean = raw.replace(/```json|```/g, "").trim();

          let inv: Record<string, unknown>;
          try {
            inv = JSON.parse(clean);
          } catch {
            return Response.json({ error: "Could not read invoice data from this document" }, { status: 422 });
          }

          const num = (v: unknown): number | null => {
            if (v == null || v === "") return null;
            const n = Number(String(v).replace(/[$,]/g, ""));
            return Number.isFinite(n) ? n : null;
          };
          const str = (v: unknown): string | null => {
            const s = (v ?? "").toString().trim();
            return s === "" ? null : s;
          };

          const carrier = str(inv.carrier) === "KeHe" ? "KeHe" : "Lineage";
          const catRaw = str(inv.category) ?? "freight";
          const category = ["freight", "accessorial", "storage_receipt", "storage_renewal"].includes(catRaw)
            ? catRaw : "freight";

          return Response.json({
            invoice_number: str(inv.invoice_number) ?? "",
            invoice_date: /^\d{4}-\d{2}-\d{2}$/.test(String(inv.invoice_date ?? "")) ? String(inv.invoice_date) : "",
            carrier,
            category,
            canonical_dc: str(inv.canonical_dc),
            cases: num(inv.cases),
            pallets: num(inv.pallets),
            weight_lb: num(inv.weight_lb),
            freight_base: num(inv.freight_base),
            fuel: num(inv.fuel),
            detention: num(inv.detention),
            lumper: num(inv.lumper),
            total_charged: num(inv.total_charged) ?? 0,
            bol: str(inv.bol),
            po_ref: str(inv.po_ref),
            is_supplemental: inv.is_supplemental === true,
          });
        } catch (err) {
          console.error("parse-logistics-invoice failed", err);
          return Response.json({ error: "Failed to parse invoice" }, { status: 500 });
        }
      },
    },
  },
});
