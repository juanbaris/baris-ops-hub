import PptxGenJS from "pptxgenjs";
import { buildGrids, SH_PRODUCTS, type SHRec } from "@/lib/stock-health";

export type MonthPoint = { label: string; actual: number; budget: number; open?: number; replan?: number };
export type QuarterPoint = { label: string; actual: number; budget: number };
export type DistSegment = { label: string; value: number; color: string };

const NAVY = "1C2340";
const CREAM = "F5F0E8";
const BURGUNDY = "A3224A";
const GREEN = "7EB53F";
const GRAY = "94A3B8";
const YELLOW = "F5A623";

function titleBar(slide: PptxGenJS.Slide, title: string, subtitle: string) {
  slide.background = { color: CREAM };
  slide.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 30, bold: true, color: NAVY, fontFace: "Arial" });
  slide.addText(subtitle, { x: 0.5, y: 0.9, w: 9, h: 0.35, fontSize: 14, color: "6B7280", fontFace: "Arial" });
}

export async function generateWeeklyDeck(opts: {
  monthly: MonthPoint[];
  quarters: QuarterPoint[];
  ytdByDist: DistSegment[];
  year: number;
  asOf: string;
  stockHealth?: SHRec[];
}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = `BARIS Weekly Meeting · ${opts.asOf}`;

  // Slide 1 — Monthly sales
  const s1 = pptx.addSlide();
  titleBar(s1, "Actual vs. Budget Sales", `Monthly sales — actual, budget & open orders · ${opts.year}`);
  s1.addChart(
    pptx.ChartType.bar,
    [
      { name: "Actual Sales $", labels: opts.monthly.map(m => m.label), values: opts.monthly.map(m => m.actual) },
      { name: "Budget Sales $", labels: opts.monthly.map(m => m.label), values: opts.monthly.map(m => m.budget) },
      { name: "Open Orders $", labels: opts.monthly.map(m => m.label), values: opts.monthly.map(m => m.open ?? 0) },
    ],
    {
      x: 0.5, y: 1.4, w: 9, h: 3.8,
      barDir: "col", barGrouping: "clustered",
      chartColors: [GREEN, GRAY, YELLOW],
      showLegend: true, legendPos: "b", legendFontSize: 11,
      showValue: true, dataLabelFontSize: 8, dataLabelFormatCode: '$#,##0,"k"',
      catAxisLabelFontSize: 11, valAxisLabelFontSize: 10, valAxisLabelFormatCode: '$#,##0',
      valGridLine: { style: "solid", color: "E5E7EB" },
    },
  );

  // Slide 2 — Quarters
  const s2 = pptx.addSlide();
  titleBar(s2, `Sales by Quarter — ${opts.year}`, "Actual vs. Budget, by quarter");
  s2.addChart(
    pptx.ChartType.bar,
    [
      { name: "Actual Sales", labels: opts.quarters.map(q => q.label), values: opts.quarters.map(q => q.actual) },
      { name: "Budget Sales", labels: opts.quarters.map(q => q.label), values: opts.quarters.map(q => q.budget) },
    ],
    {
      x: 0.5, y: 1.4, w: 9, h: 3.8,
      barDir: "col", barGrouping: "clustered",
      chartColors: [GREEN, GRAY],
      showLegend: true, legendPos: "b", legendFontSize: 11,
      showValue: true, dataLabelFontSize: 10, dataLabelFormatCode: '$#,##0',
      catAxisLabelFontSize: 13, valAxisLabelFontSize: 10, valAxisLabelFormatCode: '$#,##0',
      valGridLine: { style: "solid", color: "E5E7EB" },
    },
  );

  // Slide 3 — YTD by distributor (stacked share bar drawn with shapes)
  const s3 = pptx.addSlide();
  const total = opts.ytdByDist.reduce((s, d) => s + d.value, 0) || 1;
  titleBar(s3, "YTD Sales Breakdown by Distributor", `Share of YTD sales · Total $${Math.round(total / 1000).toLocaleString()}k`);
  const barX = 1.2, barY = 2.2, barW = 7.0, barH = 1.3;
  let cx = barX;
  opts.ytdByDist.filter(d => d.value > 0).forEach(d => {
    const w = (d.value / total) * barW;
    s3.addShape(pptx.ShapeType.rect, { x: cx, y: barY, w, h: barH, fill: { color: d.color.replace("#", "") } });
    if (w > 0.6) {
      s3.addText(`${Math.round((d.value / total) * 100)}%`, {
        x: cx, y: barY, w, h: barH, align: "center", valign: "middle",
        fontSize: 16, bold: true, color: "FFFFFF", fontFace: "Arial",
      });
    }
    cx += w;
  });
  // legend
  let lx = barX;
  opts.ytdByDist.filter(d => d.value > 0).forEach(d => {
    s3.addShape(pptx.ShapeType.rect, { x: lx, y: barY + barH + 0.4, w: 0.18, h: 0.18, fill: { color: d.color.replace("#", "") } });
    s3.addText(`${d.label} · $${Math.round(d.value / 1000).toLocaleString()}k`, {
      x: lx + 0.25, y: barY + barH + 0.32, w: 2.2, h: 0.32, fontSize: 12, color: NAVY, fontFace: "Arial",
    });
    lx += 2.5;
  });
  s3.addText(`$ ${Math.round(total / 1000).toLocaleString()}k`, {
    x: barX + barW + 0.15, y: barY, w: 1.6, h: barH, valign: "middle",
    fontSize: 20, bold: true, color: BURGUNDY, fontFace: "Arial",
  });

  // Slides 4-5 — Stock Health heatmaps (KeHE + UNFI), if a CSV has been uploaded
  if (opts.stockHealth && opts.stockHealth.length) {
    const { kehe, unfi } = buildGrids(opts.stockHealth);
    const shortP = (p: string) => p.replace(" Rasp 5oz", "");
    const shortH = (n: string) => (n.length > 12 ? n.slice(0, 11) + "…" : n);

    const addHeatSlide = (grid: typeof kehe, title: string, sub: string) => {
      if (!grid.dcs.length) return;
      const s = pptx.addSlide();
      titleBar(s, title, sub);
      const headerRow = [
        { text: "Producto", options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 8, align: "left" as const, valign: "middle" as const } },
        ...grid.dcs.map(dc => ({ text: shortH(dc), options: { bold: true, color: "FFFFFF", fill: { color: NAVY }, fontSize: 7, align: "center" as const, valign: "middle" as const } })),
      ];
      const bodyRows = grid.rows.map(row => ([
        { text: shortP(row.product), options: { bold: true, color: NAVY, fill: { color: "F2ECE2" }, fontSize: 8, align: "left" as const, valign: "middle" as const } },
        ...row.cells.map(c => c.text === null
          ? { text: "–", options: { color: "9CA3AF", fill: { color: "F0F0F0" }, fontSize: 8, align: "center" as const, valign: "middle" as const } }
          : { text: c.text, options: { bold: true, color: (c.fg || "#000").replace("#", ""), fill: { color: (c.bg || "#fff").replace("#", "") }, fontSize: 8, align: "center" as const, valign: "middle" as const } }),
      ]));
      const nCols = grid.dcs.length + 1;
      const firstW = 1.4;
      const colW = Math.min(0.62, (9.0 - firstW) / grid.dcs.length);
      s.addTable([headerRow, ...bodyRows], {
        x: 0.5, y: 1.4, w: firstW + colW * grid.dcs.length,
        colW: [firstW, ...Array(grid.dcs.length).fill(colW)],
        rowH: 0.35, border: { type: "solid", color: "FFFFFF", pt: 1 }, fontFace: "Arial",
      });
    };

    addHeatSlide(kehe, "Stock Health — KeHE", "Weeks On Hand por DC · verde 6+ / amarillo 4-6 / naranja 2-4 / rojo 0-2");
    addHeatSlide(unfi, "Stock Health — UNFI", "Cobertura por DC (SKUs autorizados) · verde con stock / rojo quiebre / gris nunca pedido");
  }

  await pptx.writeFile({ fileName: `BARIS-Weekly-Meeting-${opts.asOf}.pptx` });
}
