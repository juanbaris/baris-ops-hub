// Shared Import Modal — accepts Excel (.xls/.xlsx) or CSV files.
// Shows a preview of parsed rows and lets the user choose partial (append) or full (replace).
import { useRef, useState } from "react";
import { parseExcelOrCsv, type ParsedRow } from "@/lib/excel-import";

export type ImportMode = "partial" | "replace" | "range";

export function ImportModal({
  open,
  onClose,
  onImport,
  title = "Import from Excel / CSV",
  replaceLabel = "Replace all — overwrites existing data",
  partialLabel = "Add new — keeps existing data",
  rangeLabel,
  columnHints,
  dateColumn,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (rows: ParsedRow[], mode: ImportMode, dateRange?: { min: string; max: string }) => Promise<void>;
  title?: string;
  replaceLabel?: string;
  partialLabel?: string;
  rangeLabel?: string;
  columnHints?: string[];
  /** Column name(s) to auto-detect date range from parsed rows (enables "range" mode) */
  dateColumn?: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: ParsedRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<ImportMode>("partial");

  // Auto-detect date range from parsed rows
  const detectedRange = (() => {
    if (!parsed || !dateColumn?.length) return null;
    let min = "9999", max = "0000";
    for (const row of parsed.rows) {
      for (const col of dateColumn) {
        const v = row[col];
        if (v != null && v !== "") {
          const s = String(v);
          if (s < min) min = s;
          if (s > max) max = s;
        }
      }
    }
    if (min === "9999") return null;
    return { min, max };
  })();

  // Format date for display (handles "2026-06", "2026-06-01", etc.)
  function fmtDate(d: string) {
    const MN = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const parts = d.split("-");
    if (parts.length >= 2) {
      const m = Number(parts[1]);
      return `${MN[m] || parts[1]} ${parts[0]}`;
    }
    return d;
  }

  if (!open) return null;

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setParsed(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = await parseExcelOrCsv(file);
      if (!result.rows.length) { setError("No data rows found in the file."); return; }
      setParsed(result);
    } catch (err: any) {
      setError("Failed to parse file: " + (err?.message ?? String(err)));
    }
  }

  async function doImport() {
    if (!parsed) return;
    setBusy(true);
    try {
      await onImport(parsed.rows, mode, mode === "range" && detectedRange ? detectedRange : undefined);
      handleClose();
    } catch (err: any) {
      setError("Import failed: " + (err?.message ?? String(err)));
    } finally {
      setBusy(false);
    }
  }

  function handleClose() {
    setParsed(null);
    setError(null);
    setBusy(false);
    setMode("partial");
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div className="w-[700px] max-w-[95vw] max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-border" style={{ backgroundColor: "#1C2340", borderRadius: "16px 16px 0 0" }}>
          <p className="text-sm font-bold text-white">📥 {title}</p>
          <p className="text-xs text-white/60 mt-1">Upload an Excel (.xls, .xlsx) or CSV file.</p>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* File picker */}
          <div>
            <input ref={fileRef} type="file" accept=".xls,.xlsx,.csv,.tsv" onChange={handleFile}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border-0 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white file:cursor-pointer"
              style={{ ["--file-bg" as any]: "#A3224A" }}
            />
            <style>{`input[type=file]::file-selector-button { background-color: #A3224A; }`}</style>
          </div>

          {/* Column hints */}
          {columnHints && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-[11px] text-blue-800">
              <strong>Expected columns:</strong> {columnHints.join(" · ")}
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-xs text-red-700">{error}</div>
          )}

          {/* Preview */}
          {parsed && (
            <>
              <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-xs font-semibold mb-2">Preview — {parsed.rows.length} rows found</p>
                <div className="overflow-x-auto max-h-52">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="border-b border-border">
                        {parsed.headers.map(h => (
                          <th key={h} className="px-2 py-1 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.rows.slice(0, 10).map((r, i) => (
                        <tr key={i} className="border-t border-border/40">
                          {parsed.headers.map(h => (
                            <td key={h} className="px-2 py-1 whitespace-nowrap">{r[h] == null ? "—" : String(r[h])}</td>
                          ))}
                        </tr>
                      ))}
                      {parsed.rows.length > 10 && (
                        <tr><td colSpan={parsed.headers.length} className="px-2 py-1 text-muted-foreground italic">… and {parsed.rows.length - 10} more rows</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mode selection */}
              <div className="space-y-2">
                <p className="text-xs font-semibold">Import mode:</p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="importMode" checked={mode === "partial"} onChange={() => setMode("partial")} className="mt-0.5" />
                  <span className="text-xs"><strong>Partial</strong> — {partialLabel}</span>
                </label>
                {detectedRange && (
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name="importMode" checked={mode === "range"} onChange={() => setMode("range")} className="mt-0.5" />
                    <span className="text-xs">
                      <strong>Replace date range</strong> — {rangeLabel || `Deletes existing data from ${fmtDate(detectedRange.min)} to ${fmtDate(detectedRange.max)} and inserts the file's rows`}
                    </span>
                  </label>
                )}
                <label className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" name="importMode" checked={mode === "replace"} onChange={() => setMode("replace")} className="mt-0.5" />
                  <span className="text-xs"><strong>Replace ALL</strong> — {replaceLabel}</span>
                </label>
              </div>
              {mode === "range" && detectedRange && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-[11px] text-amber-800">
                  ⚠️ This will <strong>delete all existing movements</strong> between <strong>{fmtDate(detectedRange.min)}</strong> and <strong>{fmtDate(detectedRange.max)}</strong>, then insert the {parsed.rows.length} rows from the file.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={handleClose} className="rounded-lg border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted">Cancel</button>
          {parsed && (
            <button onClick={doImport} disabled={busy}
              className="rounded-lg px-5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "#A3224A" }}>
              {busy ? "Importing…" : `Import ${parsed.rows.length} rows (${mode === "partial" ? "add" : mode === "range" ? "replace range" : "replace all"})`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
