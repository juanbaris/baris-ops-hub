// src/hooks/use-logistics-invoices.ts
//
// Carga y mutación de facturas reales de logística. Mismo patrón que
// use-logistics-forecast.ts (supabase directo + useState/useEffect).

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  allocateToOrders, looksSupplemental, parsePoRefs,
  realByMonth, storageMonthlyAvgFromReal,
  type LogisticsInvoice, type InvoiceOrderLink,
} from "@/components/logistics/invoices";

// Nota: hasta regenerar los types de Supabase (después de correr la migración),
// las tablas nuevas no están en el tipo Database. Usamos un cliente laxo acá.
// Una vez regenerados los types, se puede tipar fuerte y sacar el `as any`.
const db = supabase as unknown as {
  from: (t: string) => any;
  storage: typeof supabase.storage;
};

export type NewInvoiceInput = Omit<LogisticsInvoice, "id" | "is_supplemental" | "status"> & {
  is_supplemental?: boolean;
};

export function useLogisticsInvoices() {
  const [invoices, setInvoices] = useState<LogisticsInvoice[]>([]);
  const [links, setLinks] = useState<InvoiceOrderLink[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [inv, lk] = await Promise.all([
      db.from("logistics_invoices").select("*").order("invoice_date", { ascending: false }),
      db.from("logistics_invoice_orders").select("*"),
    ]);
    setInvoices((inv.data ?? []) as LogisticsInvoice[]);
    setLinks((lk.data ?? []) as InvoiceOrderLink[]);
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  /** ¿ya existe esa factura? (dedupe en cliente además del UNIQUE en la base). */
  const exists = useCallback(
    (invoiceNumber: string) => invoices.some(i => i.invoice_number === invoiceNumber),
    [invoices],
  );

  /**
   * Guarda una factura confirmada + sus vínculos a POs.
   * `orderLookup`: órdenes candidatas {id, po_number, totalCases} para el match.
   */
  const saveInvoice = useCallback(async (
    input: NewInvoiceInput,
    orderLookup: { id: string; po_number: string; totalCases: number }[],
  ) => {
    const payload = {
      ...input,
      is_supplemental: input.is_supplemental ?? looksSupplemental(input.freight_base),
      status: "confirmed" as const,
    };
    const { data, error } = await db.from("logistics_invoices").insert(payload).select().single();
    if (error) throw error;
    const inv = data as LogisticsInvoice;

    // Vincular a POs (freight/accesorial). Storage no lleva PO.
    if (inv.category === "freight" || inv.category === "accessorial") {
      const linkRows = allocateToOrders(
        { id: inv.id, total_charged: inv.total_charged, po_ref: inv.po_ref },
        orderLookup,
      );
      if (linkRows.length) {
        const { error: le } = await db.from("logistics_invoice_orders").insert(linkRows);
        if (le) throw le;
      }
    }
    await reload();
    return inv;
  }, [reload]);

  const deleteInvoice = useCallback(async (id: string) => {
    const { error } = await db.from("logistics_invoices").delete().eq("id", id);
    if (error) throw error;
    await reload();
  }, [reload]);

  /** Sube el PDF al bucket y devuelve la ruta guardada. */
  const uploadPdf = useCallback(async (invoiceNumber: string, file: File) => {
    const path = `${invoiceNumber}.pdf`;
    const { error } = await db.storage.from("logistics-invoices").upload(path, file, { upsert: true });
    if (error) throw error;
    return path;
  }, []);

  const signedPdfUrl = useCallback(async (path: string) => {
    const { data } = await db.storage.from("logistics-invoices").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }, []);

  const real = useMemo(() => realByMonth(invoices), [invoices]);
  const storageAvg = useMemo(() => storageMonthlyAvgFromReal(real, 6), [real]);

  return {
    invoices, links, loading, reload,
    exists, saveInvoice, deleteInvoice, uploadPdf, signedPdfUrl,
    real, storageAvg,
    parsePoRefs,
  };
}
