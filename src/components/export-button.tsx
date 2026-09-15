// Shared EXPORT control — Excel (.xls, multi-sheet) or PDF ("foto" / screenshot).
// Excel: uses explicit `excelData` if provided, otherwise scrapes every <table>
//        inside `targetRef` (one sheet per table, "Actions"/empty columns dropped).
// PDF:   captures `targetRef` with html2canvas-pro (Tailwind v4 oklch-safe) → jsPDF,
//        auto-paginating tall views across A4 pages.
// The dropdown menu is rendered in a portal with fixed positioning so it is never
// clipped by the tab bar's `overflow-x-auto` container.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { downloadExcel, type Sheet, type SheetCell } from "@/lib/excel-report";

type ExcelSource = Sheet[] | (() => Sheet[]);

export function ExportButton({
  filename,
  targetRef,
  excelData,
  excelAllData,
  excelAllLabel = "Excel — Todo (sin filtro)",
  excelLabel,
  className,
}: {
  filename: string;
  targetRef?: RefObject<HTMLElement | null>;
  excelData?: ExcelSource;
  excelAllData?: ExcelSource;
  excelAllLabel?: string;
  excelLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const MENU_W = 224; // w-56

  // Position the menu under the trigger, right-aligned, in viewport coords.
  useLayoutEffect(() => {
    if (!open) return;
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    setPos({ top: r.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScrollResize = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open]);

  const resolve = (s?: ExcelSource): Sheet[] | undefined =>
    typeof s === "function" ? s() : s;

  function nameForTable(tbl: HTMLTableElement, idx: number, used: Set<string>): string {
    let base =
      tbl.getAttribute("data-export-name") ||
      tbl.querySelector("caption")?.textContent?.trim() ||
      "";
    if (!base) {
      let node: Element | null = tbl;
      let hops = 0;
      outer: while (node && hops < 6) {
        let sib: Element | null = node.previousElementSibling;
        while (sib) {
          const h = sib.matches("h1,h2,h3,h4,h5,p,span")
            ? sib
            : sib.querySelector("h1,h2,h3,h4,h5");
          const txt = h?.textContent?.replace(/\s+/g, " ").trim();
          if (txt && txt.length >= 2 && txt.length <= 60) { base = txt; break outer; }
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
        hops++;
      }
    }
    if (!base) base = `Tabla ${idx + 1}`;
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${n++})`;
    used.add(name.toLowerCase());
    return name;
  }

  function scrapeSheets(): Sheet[] {
    const root = targetRef?.current;
    if (!root) return [];
    const tables = Array.from(root.querySelectorAll("table")) as HTMLTableElement[];
    const used = new Set<string>();
    const sheets: Sheet[] = [];
    tables.forEach((tbl, ti) => {
      const headRows = tbl.querySelectorAll("thead tr");
      const headRow = (headRows[headRows.length - 1] as HTMLElement) ||
        (tbl.querySelector("tr") as HTMLElement | null);
      const drop = new Set<number>();
      if (headRow) {
        Array.from(headRow.children).forEach((th, i) => {
          const t = (th.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (t === "actions" || t === "action" || t === "") drop.add(i);
        });
      }
      const rows: SheetCell[][] = [];
      tbl.querySelectorAll("tr").forEach((tr) => {
        const cells = Array.from(tr.children) as HTMLElement[];
        if (!cells.length) return;
        const out: SheetCell[] = [];
        cells.forEach((c, i) => {
          if (drop.has(i)) return;
          const raw = (c.innerText ?? c.textContent ?? "").replace(/\s+/g, " ").trim();
          const cleaned = raw.replace(/[$,\s]/g, "");
          const asNum = Number(cleaned);
          if (raw !== "" && cleaned !== "" && !cleaned.endsWith("%") && isFinite(asNum) && /^-?\d/.test(cleaned)) {
            out.push(asNum);
          } else {
            out.push(raw);
          }
        });
        if (out.some((v) => String(v ?? "").length)) rows.push(out);
      });
      if (rows.length) sheets.push({ name: nameForTable(tbl, ti, used), rows });
    });
    return sheets;
  }

  async function doExcel(all: boolean) {
    setBusy(all ? "all" : "excel");
    setOpen(false);
    try {
      let sheets = resolve(all ? excelAllData : excelData);
      if (!sheets || !sheets.length) sheets = scrapeSheets();
      if (!sheets.length) {
        alert("No hay tablas para exportar en esta vista.");
        return;
      }
      downloadExcel(filename, sheets);
    } catch (e: any) {
      console.error(e);
      alert("Error generando Excel: " + (e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  async function doPdf() {
    const root = targetRef?.current;
    setOpen(false);
    if (!root) {
      alert("No hay contenido para capturar.");
      return;
    }
    setBusy("pdf");
    try {
      const [h2cMod, jspdfMod] = await Promise.all([
        import("html2canvas-pro"),
        import("jspdf"),
      ]);
      const html2canvas = (h2cMod as any).default ?? (h2cMod as any);
      const JsPDF = (jspdfMod as any).jsPDF ?? (jspdfMod as any).default;

      const canvas: HTMLCanvasElement = await html2canvas(root, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        windowWidth: Math.max(root.scrollWidth, root.clientWidth),
      });

      const landscape = canvas.width >= canvas.height;
      const pdf = new JsPDF({ orientation: landscape ? "l" : "p", unit: "pt", format: "a4" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const fullH = (canvas.height * pw) / canvas.width;

      if (fullH <= ph) {
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pw, fullH);
      } else {
        const pageHeightPx = Math.floor((ph * canvas.width) / pw);
        let rendered = 0;
        let page = 0;
        while (rendered < canvas.height) {
          const sliceH = Math.min(pageHeightPx, canvas.height - rendered);
          const c2 = document.createElement("canvas");
          c2.width = canvas.width;
          c2.height = sliceH;
          const ctx = c2.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, c2.width, c2.height);
          ctx.drawImage(canvas, 0, rendered, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
          if (page > 0) pdf.addPage();
          pdf.addImage(c2.toDataURL("image/png"), "PNG", 0, 0, pw, (sliceH * pw) / canvas.width);
          rendered += sliceH;
          page++;
        }
      }
      pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
    } catch (e: any) {
      console.error(e);
      alert("Error generando PDF: " + (e?.message ?? e));
    } finally {
      setBusy(null);
    }
  }

  const menu =
    open && !busy && pos
      ? createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: MENU_W, zIndex: 9999 }}
            className="overflow-hidden rounded-lg border border-border bg-card py-1 text-xs shadow-xl"
          >
            <button
              onClick={() => doExcel(false)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
            >
              <span>📊</span>
              {excelLabel ?? (excelAllData ? "Excel — Filtrado" : "Excel")}
            </button>
            {excelAllData && (
              <button
                onClick={() => doExcel(true)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
              >
                <span>📊</span>
                {excelAllLabel}
              </button>
            )}
            <button
              onClick={doPdf}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
            >
              <span>🖼️</span>
              PDF — Captura
            </button>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`inline-block flex-shrink-0 ${className ?? ""}`}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        disabled={!!busy}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-opacity disabled:opacity-60"
        style={{ backgroundColor: "#A3224A" }}
      >
        {busy ? "Generando…" : "⬇ EXPORT"}
      </button>
      {menu}
    </div>
  );
}
