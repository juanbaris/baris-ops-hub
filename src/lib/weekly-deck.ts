import PptxGenJS from "pptxgenjs";

export type MonthPoint = { label: string; actual: number; budget: number; open?: number };
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

  await pptx.writeFile({ fileName: `BARIS-Weekly-Meeting-${opts.asOf}.pptx` });
}