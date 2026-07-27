import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Placeholder } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/fulfillment")({
  component: () => (
    <>
      <PageHeader
        title="Fulfillment"
        subtitle="Sales orders, shipments, collections, deductions and activity."
      />
      <Placeholder note="Dashboard, Pipeline PO, Collections y Shipments se construirán en el siguiente paso." />
    </>
  ),
  head: () => ({ meta: [{ title: "Fulfillment · BARIS" }] }),
});