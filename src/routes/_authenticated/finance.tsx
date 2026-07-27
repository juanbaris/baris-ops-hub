import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Placeholder } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/finance")({
  component: () => (
    <>
      <PageHeader
        title="Finanzas"
        subtitle="Collections, runway y EBITDA simulator."
      />
      <Placeholder note="Se construirá al final." />
    </>
  ),
  head: () => ({ meta: [{ title: "Finanzas · BARIS" }] }),
});