import PptxGenJS from "pptxgenjs";

const NAVY = "1C2340";
const CREAM = "F5F0E8";
const GREEN = "7EB53F";
const BURGUNDY = "A3224A";
const LOT_BASELINE = "2026-08-14";
const SKUS = ["XD", "PW", "HM", "WM", "WD", "Matcha"];

function titleBar(slide: PptxGenJS.Slide, title: string, subtitle: string) {
  slide.background = { color: CREAM };
  slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 28, bold: true, color: NAVY, fontFace: "Arial" });
  slide.addText(subtitle, { x: 0.5, y: 0.95, w: 9, h: 0.35, fontSize: 13, color: "6B7280", fontFace: "Arial" });
}
const cell = (text: string, opts: any = {}) => ({ text, options: { fontSize: 10, fontFace: "Arial", valign: "middle", ...opts } });
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const moneyK = (n: number) => `$${Math.round(n).toLocaleString()}k`;

export async function generateAccountingDeck(opts: {
  asOf: string;
  salesByMonth: { label: string; gross: number }[];
  lots: any[];
  fpMovements: any[];
  ipMovements: any[];
  actuals: Record<string, any>;
  realMonths: number;
  periods: string[];
  months: string[];
}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = `BARIS Accounting · ${opts.asOf}`;

  // ── Slide 1: Sales — gross invoiced (last 3 months) ──
  {
    const s = pptx.addSlide();
    titleBar(s, "Sales — Gross Invoiced", "All invoiced POs · last 3 months");
    const total = opts.salesByMonth.reduce((a, r) => a + r.gross, 0);
    const rows = [
      [cell("Month", { bold: true, color: "FFFFFF", fill: { color: NAVY } }), cell("Gross Sales", { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" })],
      ...opts.salesByMonth.map(r => [cell(r.label, { bold: true, color: NAVY, fill: { color: "F2ECE2" } }), cell(money(r.gross), { align: "right" })]),
      [cell("TOTAL (3 mo)", { bold: true, color: "FFFFFF", fill: { color: NAVY } }), cell(money(total), { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" })],
    ];
    s.addTable(rows, { x: 0.5, y: 1.5, w: 6, colW: [3, 3], rowH: 0.42, border: { type: "solid", color: "FFFFFF", pt: 1 } });
  }

  // ── Slide 2: FP Stock (per SKU, all warehouses) ──
  {
    const delta: Record<string, number> = {};
    for (const m of opts.fpMovements) {
      const lot = (m.lot_number ?? "").trim();
      if (!lot || m.movement_date <= LOT_BASELINE) continue;
      const k = `${lot}||${m.warehouse ?? "—"}`;
      delta[k] = (delta[k] ?? 0) + (m.type === "In" ? Number(m.cases) : -Number(m.cases));
    }
    const cases: Record<string, number> = {}, val: Record<string, number> = {};
    const seen = new Set<string>();
    const add = (sku: string, c: number, cogs: number) => { cases[sku] = (cases[sku] ?? 0) + c; val[sku] = (val[sku] ?? 0) + c * (Number(cogs) || 0) * 8; };
    for (const r of opts.lots) { const k = `${r.lot_number}||${r.warehouse ?? "—"}`; seen.add(k); add(r.sku, (Number(r.cases_initial) || 0) + (delta[k] ?? 0), r.cogs_per_case); }
    for (const m of opts.fpMovements) { const lot = (m.lot_number ?? "").trim(); const k = `${lot}||${m.warehouse ?? "—"}`; if (!lot || seen.has(k) || m.movement_date <= LOT_BASELINE) continue; seen.add(k); add(m.sku, delta[k] ?? 0, m.cogs_per_case); }

    const s = pptx.addSlide();
    titleBar(s, "FP Stock — Actual", "Finished-product stock (all warehouses) · from Lot Master");
    const totCases = SKUS.reduce((a, sku) => a + Math.max(0, Math.round(cases[sku] ?? 0)), 0);
    const totVal = SKUS.reduce((a, sku) => a + Math.max(0, val[sku] ?? 0), 0);
    const rows = [
      ["SKU", "Stock (cases)", "Inv. $"].map((t, i) => cell(t, { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: i === 0 ? "left" : "right" })),
      ...SKUS.map(sku => [
        cell(sku, { bold: true, color: NAVY, fill: { color: "F2ECE2" } }),
        cell(Math.max(0, Math.round(cases[sku] ?? 0)).toLocaleString(), { align: "right" }),
        cell(money(Math.max(0, val[sku] ?? 0)), { align: "right", color: BURGUNDY }),
      ]),
      [cell("TOTAL", { bold: true, color: "FFFFFF", fill: { color: NAVY } }), cell(totCases.toLocaleString(), { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" }), cell(money(totVal), { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right" })],
    ];
    s.addTable(rows, { x: 0.5, y: 1.5, w: 7, colW: [2.2, 2.4, 2.4], rowH: 0.4, border: { type: "solid", color: "FFFFFF", pt: 1 } });
  }

  // ── Slide 3: I&P inventory (net on-hand by material) ──
  {
    const net: Record<string, number> = {};
    for (const m of opts.ipMovements) net[m.material] = (net[m.material] ?? 0) + ((m.type === "In" ? 1 : -1) * Number(m.quantity || 0));
    const rows = Object.entries(net).filter(([, q]) => Math.round(q) !== 0).sort((a, b) => b[1] - a[1]);
    const s = pptx.addSlide();
    titleBar(s, "I&P Inventory", "Ingredients & packaging · net on-hand");
    const body = [
      ["Material", "On hand"].map((t, i) => cell(t, { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: i === 0 ? "left" : "right" })),
      ...rows.slice(0, 24).map(([mat, q]) => [cell(mat, { color: NAVY, fill: { color: "F2ECE2" }, fontSize: 9 }), cell(Math.round(q).toLocaleString(), { align: "right", fontSize: 9 })]),
    ];
    s.addTable(body, { x: 0.5, y: 1.5, w: 6, colW: [4, 2], rowH: 0.28, border: { type: "solid", color: "FFFFFF", pt: 1 } });
  }

  // ── Slide 4: P&L headline (Gross Sales + Net Income) by real month, $K ──
  {
    const realIdx = opts.periods.map((_, i) => i).filter(i => opts.actuals[opts.periods[i]]?.pnl_detail != null);
    const grossOf = (d: any) => (Number(d.sales_product) || 0) + (Number(d.shipping_income) || 0);
    const niOf = (d: any) => Object.values(d).reduce((a: number, v: any) => a + (typeof v === "number" ? v : 0), 0);
    const s = pptx.addSlide();
    titleBar(s, "P&L — Headline", `Actual months (Jan–${opts.months[opts.realMonths - 1] ?? ""}) · $ thousands`);
    const header = [cell("$K", { bold: true, color: "FFFFFF", fill: { color: NAVY } }),
      ...realIdx.map(i => cell(opts.months[i], { bold: true, color: "FFFFFF", fill: { color: NAVY }, align: "right", fontSize: 9 }))];
    const grossRow = [cell("Gross Sales", { bold: true, color: NAVY, fill: { color: "F2ECE2" } }),
      ...realIdx.map(i => cell(moneyK(grossOf(opts.actuals[opts.periods[i]].pnl_detail)), { align: "right", color: GREEN.replace("#", ""), fontSize: 9 }))];
    const niRow = [cell("Net Income", { bold: true, color: NAVY, fill: { color: "F2ECE2" } }),
      ...realIdx.map(i => { const v = niOf(opts.actuals[opts.periods[i]].pnl_detail); return cell(moneyK(v), { align: "right", color: v >= 0 ? GREEN.replace("#", "") : "D03B3B", fontSize: 9 }); })];
    s.addTable([header, grossRow, niRow], { x: 0.5, y: 1.5, w: 9, rowH: 0.42, border: { type: "solid", color: "FFFFFF", pt: 1 } });
    s.addText("Net Income = sum of P&L detail lines; Gross Sales = product + shipping income.", { x: 0.5, y: 5.0, w: 9, h: 0.3, fontSize: 9, color: "9CA3AF", fontFace: "Arial" });
  }

  await pptx.writeFile({ fileName: `BARIS-Accounting-${opts.asOf}.pptx` });
}
