import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Placeholder } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/sales")({
  component: () => (
    <>
      <PageHeader title="Ventas" subtitle="Dashboard, historial y accounts." />
      <Placeholder note="Se construirá después de Fulfillment y Operations." />
    </>
  ),
  head: () => ({ meta: [{ title: "Ventas · BARIS" }] }),
});