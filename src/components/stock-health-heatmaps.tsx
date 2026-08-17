import React from "react";
import { buildGrids, shortDc, SH_PRODUCTS, type SHRec, type Grid } from "@/lib/stock-health";

function Legend({ neverLabel }: { neverLabel: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 12, fontSize: 12 }} className="text-muted-foreground">
      {[["#d03b3b", "0-2 crítico"], ["#ec835a", "2-4 alerta"], ["#fab219", "4-6 vigilar"], ["#0ca30c", "6+ saludable"]].map(([bg, label]) => (
        <span key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: bg }} />{label}
        </span>
      ))}
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--surface-1, #f3f3f3)", border: "0.5px solid var(--border, #ddd)" }} />{neverLabel}
      </span>
    </div>
  );
}

function HeatTable({ grid, minWidth }: { grid: Grid; minWidth: number }) {
  const firstCol: React.CSSProperties = { position: "sticky", left: 0, background: "var(--surface-2, #fafafa)", padding: "8px 10px", borderBottom: "0.5px solid var(--border, #e5e5e5)", fontWeight: 500, whiteSpace: "nowrap", textAlign: "left" };
  const thBase: React.CSSProperties = { position: "sticky", top: 0, textAlign: "center", padding: "8px 6px", borderBottom: "0.5px solid var(--border, #e5e5e5)", minWidth: 78, fontWeight: 500, whiteSpace: "nowrap", background: "var(--surface-2, #fafafa)" };
  if (!grid.dcs.length) return <p className="text-sm text-muted-foreground py-4">Sin DCs para mostrar.</p>;
  return (
    <div style={{ overflowX: "auto", border: "0.5px solid var(--border, #e5e5e5)", borderRadius: 12 }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth }}>
        <thead>
          <tr>
            <th style={{ ...firstCol, top: 0, zIndex: 3, minWidth: 170 }} className="text-foreground">Producto</th>
            {grid.dcs.map(dc => <th key={dc} title={dc} style={{ ...thBase, zIndex: 2 }} className="text-muted-foreground">{shortDc(dc)}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map(row => (
            <tr key={row.product}>
              <td style={{ ...firstCol, zIndex: 1 }}>{row.product}</td>
              {row.cells.map((c, i) => c.text === null ? (
                <td key={i} style={{ textAlign: "center", padding: "8px 6px", borderBottom: "0.5px solid var(--border, #e5e5e5)", background: "var(--surface-1, #f5f5f5)" }} className="text-muted-foreground">–</td>
              ) : (
                <td key={i} style={{ textAlign: "center", padding: "8px 6px", borderBottom: "0.5px solid var(--border, #e5e5e5)", background: c.bg!, color: c.fg!, fontWeight: 500 }}>{c.text}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StockHealthHeatmaps({ records }: { records: SHRec[] }) {
  const { kehe, unfi } = buildGrids(records);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-bold mb-1" style={{ color: "#1C2340" }}>KeHE — Weeks On Hand por DC</p>
        <Legend neverLabel="sin stock" />
        <HeatTable grid={kehe} minWidth={960} />
      </div>
      <div>
        <p className="text-sm font-bold mb-1" style={{ color: "#1C2340" }}>UNFI — cobertura por DC (SKUs autorizados)</p>
        <Legend neverLabel="nunca pedido" />
        <HeatTable grid={unfi} minWidth={1080} />
      </div>
    </div>
  );
}
