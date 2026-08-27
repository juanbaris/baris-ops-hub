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
const NAVY_BLACK = "111827";

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
  highlightIndex?: number;
}) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = `BARIS Weekly Meeting · ${opts.asOf}`;

  // Slide 1 — Monthly sales (drawn with shapes so it mirrors the Home chart exactly:
  // open orders stack on top of the current month's invoiced bar, REPLAN shown in black)
  {
    const s = pptx.addSlide();
    titleBar(s, "Monthly Sales", `Invoiced vs Best Estimate vs Open vs REPLAN · ${opts.year} · $ USD gross sales`);

    const hi = opts.highlightIndex ?? -1;
    const data = opts.monthly;
    const hasOpen = data.some(d => (d.open ?? 0) > 0);
    const hasReplan = data.some(d => (d.replan ?? 0) > 0);
    const fmtK = (v: number) => `$${Math.round(v / 1000).toLocaleString()}k`;

    const plotX = 1.05, plotW = 8.4, plotTop = 1.75, plotH = 2.75;
    const base = plotTop + plotH;
    const max = Math.max(
      1,
      ...data.map((d, i) => Math.max(d.actual + (i === hi ? d.open ?? 0 : 0), d.budget, d.replan ?? 0, d.open ?? 0)),
    ) * 1.12;

    // gridlines + axis labels
    for (let g = 0; g <= 4; g++) {
      const y = base - (plotH * g) / 4;
      s.addShape(pptx.ShapeType.rect, { x: plotX, y, w: plotW, h: 0.005, fill: { color: "E5E7EB" } });
      s.addText(fmtK((max * g) / 4), {
        x: plotX - 1.0, y: y - 0.12, w: 0.9, h: 0.24, align: "right", valign: "middle",
        fontSize: 8, color: "9CA3AF", fontFace: "Arial", margin: 0,
      });
    }

    const groupW = plotW / data.length;
    data.forEach((d, i) => {
      const stacked = i === hi;
      const bars: { v: number; c: string }[] = [
        { v: d.actual, c: GREEN },
        { v: d.budget, c: GRAY },
        ...(hasOpen && !stacked ? [{ v: d.open ?? 0, c: YELLOW }] : []),
        ...(hasReplan ? [{ v: d.replan ?? 0, c: NAVY_BLACK }] : []),
      ].filter(b => b.v > 0);

      const barW = Math.min(0.17, (groupW * 0.82) / Math.max(1, bars.length));
      const totalW = barW * bars.length + 0.03 * (bars.length - 1);
      let bx = plotX + groupW * i + (groupW - totalW) / 2;

      bars.forEach(b => {
        const h = (b.v / max) * plotH;
        s.addShape(pptx.ShapeType.rect, { x: bx, y: base - h, w: barW, h, fill: { color: b.c } });
        s.addText(fmtK(b.v), {
          x: bx - 0.18, y: base - h - 0.22, w: barW + 0.36, h: 0.2, align: "center", valign: "bottom",
          fontSize: 6.5, color: b.c === GREEN ? "4D7A1F" : b.c === NAVY_BLACK ? NAVY_BLACK : "6B7280",
          fontFace: "Arial", margin: 0,
        });
        bx += barW + 0.03;

        // open orders stacked on top of the invoiced bar at the current month
        if (stacked && b.c === GREEN && (d.open ?? 0) > 0) {
          const oh = ((d.open ?? 0) / max) * plotH;
          const ox = bx - barW - 0.03;
          s.addShape(pptx.ShapeType.rect, { x: ox, y: base - h - oh, w: barW, h: oh, fill: { color: YELLOW } });
          s.addText(fmtK(d.open ?? 0), {
            x: ox - 0.18, y: base - h - oh - 0.22, w: barW + 0.36, h: 0.2, align: "center", valign: "bottom",
            fontSize: 6.5, color: "B26A00", fontFace: "Arial", margin: 0,
          });
        }
      });

      s.addText(d.label, {
        x: plotX + groupW * i, y: base + 0.06, w: groupW, h: 0.24, align: "center",
        fontSize: 9, bold: i === hi, color: i === hi ? NAVY : "6B7280", fontFace: "Arial", margin: 0,
      });
    });

    // legend
    const legend: { label: string; color: string }[] = [
      { label: "Invoiced sales", color: GREEN },
      { label: "Budget · Pessimistic (Best Estimate)", color: GRAY },
      ...(hasOpen ? [{ label: "Open orders", color: YELLOW }] : []),
      ...(hasReplan ? [{ label: "REPLAN · Normal + SET", color: NAVY_BLACK }] : []),
    ];
    let lx = plotX;
    legend.forEach(l => {
      s.addShape(pptx.ShapeType.rect, { x: lx, y: 4.92, w: 0.14, h: 0.14, fill: { color: l.color } });
      const w = 0.12 + l.label.length * 0.062;
      s.addText(l.label, { x: lx + 0.2, y: 4.86, w, h: 0.26, fontSize: 9, color: NAVY, fontFace: "Arial", valign: "middle", margin: 0 });
      lx += 0.2 + w + 0.18;
    });
  }


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
