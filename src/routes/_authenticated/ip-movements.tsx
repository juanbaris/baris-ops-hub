import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { ExportButton } from "@/components/export-button";
import { ImportModal, type ImportMode } from "@/components/import-modal";
import { downloadExcel, type Sheet } from "@/lib/excel-report";
import type { ParsedRow } from "@/lib/excel-import";

type Row = Database["public"]["Tables"]["ip_movements"]["Row"];
type InsertRow = Database["public"]["Tables"]["ip_movements"]["Insert"];

const IP_CONCEPTS = ["Procurement","Consumption","Damage","Transfer","Inventory","Inv Adjustment","Work in Progress","Pistachio Production","Hazelnut And Milk Production"] as const;
const MOVEMENT_TYPES = ["In","Out"] as const;

type SortCol = "movement_date"|"type"|"concept"|"material"|"quantity"|"unit"|"vendor"|"lot_number"|"notes"|"total_price"|"price_per_unit";

function IPMovements() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sort, setSort] = useState<{col:SortCol;dir:"asc"|"desc"}>({col:"movement_date",dir:"desc"});

  // Filters
  const [fType, setFType] = useState("");
  const [fConcept, setFConcept] = useState("");
  const [fMaterial, setFMaterial] = useState("");
  const [fMonth, setFMonth] = useState("");
  const [fSearch, setFSearch] = useState("");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("ip_movements")
      .select("*")
      .order("movement_date", { ascending: false });
    if (error) setErr(error.message);
    else { setRows(data ?? []); setErr(null); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // Unique materials for filter dropdown
  const materials = useMemo(() => [...new Set(rows.map(r => r.material))].sort(), [rows]);
  const months = useMemo(() => [...new Set(rows.map(r => r.movement_date?.slice(0,7)).filter(Boolean))].sort().reverse(), [rows]);

  // Filter + sort
  const filteredSorted = useMemo(() => {
    let out = rows.filter(r => {
      if (fType && r.type !== fType) return false;
      if (fConcept && r.concept !== fConcept) return false;
      if (fMaterial && r.material !== fMaterial) return false;
      if (fMonth && !r.movement_date?.startsWith(fMonth)) return false;
      if (fSearch) {
        const s = fSearch.toLowerCase();
        const hay = [r.material,r.vendor,r.lot_number,r.notes,r.concept].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
    out.sort((a,b) => {
      const va = a[sort.col]; const vb = b[sort.col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return sort.dir === "asc" ? va - vb : vb - va;
      return sort.dir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
    return out;
  }, [rows, fType, fConcept, fMaterial, fMonth, fSearch, sort]);

  function toggleSort(col: SortCol) {
    setSort(s => s.col === col ? {...s, dir: s.dir === "asc" ? "desc" : "asc"} : {col, dir: "asc"});
  }

  const hasFilter = !!(fType || fConcept || fMaterial || fMonth || fSearch);

  // Excel export builder
  function buildExcel(data: Row[]): Sheet[] {
    const headers = ["Date","Type","Concept","Material","Qty","Unit","Vendor","Lot","Total Price","$/unit","Shipping","Other Costs","Notes","Warehouse","Received","Paid","Est. Receive","Est. Payment","Act. Receive","Act. Payment"];
    const rows2 = data.map(r => [
      r.movement_date, r.type, r.concept, r.material, r.quantity, r.unit,
      r.vendor ?? "", r.lot_number ?? "", r.total_price ?? "", r.price_per_unit ?? "",
      r.shipping_price ?? "", r.other_costs ?? "", r.notes ?? "", r.warehouse ?? "",
      r.received ? "Yes" : "No", r.paid ? "Yes" : "No",
      r.estimated_receive_date ?? "", r.estimated_payment_date ?? "",
      r.actual_receive_date ?? "", r.actual_payment_date ?? "",
    ]);
    return [{ name: "IP Movements", rows: [headers, ...rows2] }];
  }

  // Import handler
  async function handleImport(parsed: ParsedRow[], mode: ImportMode) {
    // Column mapping (supports English & Spanish)
    const colMap: Record<string, string> = {
      date: "movement_date", fecha: "movement_date", movement_date: "movement_date",
      type: "type", tipo: "type",
      concept: "concept", concepto: "concept",
      material: "material",
      qty: "quantity", quantity: "quantity", cantidad: "quantity",
      unit: "unit", unidad: "unit",
      vendor: "vendor", proveedor: "vendor",
      lot: "lot_number", lot_number: "lot_number", lote: "lot_number",
      notes: "notes", notas: "notes",
      total_price: "total_price", "total price": "total_price", precio_total: "total_price",
      "$/unit": "price_per_unit", price_per_unit: "price_per_unit", precio_unitario: "price_per_unit",
      shipping: "shipping_price", shipping_price: "shipping_price", flete: "shipping_price",
      other_costs: "other_costs", "other costs": "other_costs", otros_costos: "other_costs",
      warehouse: "warehouse", almacen: "warehouse",
      received: "received", recibido: "received",
      paid: "paid", pagado: "paid",
      "est. receive": "estimated_receive_date", estimated_receive_date: "estimated_receive_date",
      "est. payment": "estimated_payment_date", estimated_payment_date: "estimated_payment_date",
      "act. receive": "actual_receive_date", actual_receive_date: "actual_receive_date",
      "act. payment": "actual_payment_date", actual_payment_date: "actual_payment_date",
    };

    function mapRow(r: ParsedRow): InsertRow {
      const mapped: Record<string, any> = {};
      for (const [key, val] of Object.entries(r)) {
        const norm = key.toLowerCase().trim();
        const dbCol = colMap[norm];
        if (dbCol) mapped[dbCol] = val;
      }
      // Defaults
      if (!mapped.movement_date) mapped.movement_date = new Date().toISOString().slice(0,10);
      if (!mapped.type) mapped.type = "In";
      if (!mapped.concept) mapped.concept = "Procurement";
      if (!mapped.material) mapped.material = "Unknown";
      if (!mapped.quantity) mapped.quantity = 0;
      if (!mapped.unit) mapped.unit = "lbs";
      // Boolean fields
      if (typeof mapped.received === "string") mapped.received = ["yes","si","sí","true","1"].includes(mapped.received.toLowerCase());
      if (typeof mapped.paid === "string") mapped.paid = ["yes","si","sí","true","1"].includes(mapped.paid.toLowerCase());
      return mapped as InsertRow;
    }

    if (mode === "replace") {
      // Delete all, then insert
      const { error: delErr } = await supabase.from("ip_movements").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (delErr) throw new Error("Failed to clear existing movements: " + delErr.message);
    }

    // Insert in batches of 50
    const toInsert = parsed.map(mapRow);
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      const { error } = await supabase.from("ip_movements").insert(batch);
      if (error) throw new Error(`Import failed at batch ${Math.floor(i/50)+1}: ${error.message}`);
    }
    await load();
  }

  const cols: { key: SortCol; label: string; numeric?: boolean }[] = [
    { key: "movement_date", label: "Date" },
    { key: "type", label: "Type" },
    { key: "concept", label: "Concept" },
    { key: "material", label: "Material" },
    { key: "quantity", label: "Qty", numeric: true },
    { key: "unit", label: "Unit" },
    { key: "vendor", label: "Vendor" },
    { key: "lot_number", label: "Lot" },
    { key: "total_price", label: "Total $", numeric: true },
    { key: "price_per_unit", label: "$/unit", numeric: true },
    { key: "notes", label: "Notes" },
  ];

  return (
    <>
      <PageHeader title="I&P Movements" subtitle="Ingredients & packaging ledger." />

      {/* Toolbar: Filters + Export/Import */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={fType} onChange={e => setFType(e.target.value)} className="rounded border text-xs px-2 py-1.5">
          <option value="">All Types</option>
          {MOVEMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={fConcept} onChange={e => setFConcept(e.target.value)} className="rounded border text-xs px-2 py-1.5">
          <option value="">All Concepts</option>
          {IP_CONCEPTS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fMaterial} onChange={e => setFMaterial(e.target.value)} className="rounded border text-xs px-2 py-1.5">
          <option value="">All Materials</option>
          {materials.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={fMonth} onChange={e => setFMonth(e.target.value)} className="rounded border text-xs px-2 py-1.5">
          <option value="">All Months</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input value={fSearch} onChange={e => setFSearch(e.target.value)} placeholder="Search…" className="rounded border text-xs px-2 py-1.5 w-36" />
        {hasFilter && <button onClick={() => { setFType(""); setFConcept(""); setFMaterial(""); setFMonth(""); setFSearch(""); }} className="text-xs text-red-500 hover:underline">Clear</button>}

        <div className="ml-auto flex items-center gap-2">
          <ExportButton filename="IP_Movements" excelData={() => buildExcel(filteredSorted)} excelAllData={() => buildExcel(rows)} excelLabel="Excel — Filtrado" excelAllLabel="Excel — Todo" />
          <button onClick={() => setImportOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white" style={{backgroundColor:"#1C2340"}}>📥 IMPORT</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={`px-3 py-2 font-medium cursor-pointer hover:text-foreground select-none ${c.numeric ? "text-right" : "text-left"}`}
                  onClick={() => toggleSort(c.key)}
                >
                  {c.label} {sort.col === c.key ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : err ? (
              <tr><td colSpan={cols.length} className="p-6 text-center text-destructive">{err}</td></tr>
            ) : filteredSorted.length === 0 ? (
              <tr><td colSpan={cols.length} className="p-6 text-center text-muted-foreground">{hasFilter ? "No movements match the filters." : "No movements yet."}</td></tr>
            ) : (
              filteredSorted.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  {cols.map((c) => {
                    const v = r[c.key];
                    return (
                      <td
                        key={c.key}
                        className={`px-3 py-2 ${c.numeric ? "text-right font-mono" : ""}`}
                      >
                        {v == null || v === "" ? "—" : typeof v === "number" ? (c.key === "price_per_unit" || c.key === "total_price" ? `$${v.toLocaleString()}` : v.toLocaleString()) : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
          {filteredSorted.length > 0 && (
            <tfoot>
              <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
                <td colSpan={4} className="px-3 py-2 text-xs font-semibold">{filteredSorted.length} movements</td>
                <td className="px-3 py-2 text-right font-mono text-xs">{filteredSorted.reduce((s,r) => s + r.quantity, 0).toLocaleString()}</td>
                <td colSpan={3}></td>
                <td className="px-3 py-2 text-right font-mono text-xs">${Math.round(filteredSorted.reduce((s,r) => s + (r.total_price ?? 0), 0)).toLocaleString()}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
        title="Import I&P Movements"
        partialLabel="Add new movements — keeps existing data"
        replaceLabel="Replace all — overwrites ALL existing movements"
        columnHints={["Date","Type","Concept","Material","Qty","Unit","Vendor","Lot","Total Price","$/unit","Notes"]}
      />
    </>
  );
}

export const Route = createFileRoute("/_authenticated/ip-movements")({
  component: IPMovements,
  head: () => ({ meta: [{ title: "I&P Movements · BARIS" }] }),
});
