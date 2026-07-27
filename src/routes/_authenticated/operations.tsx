import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Placeholder } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/operations")({
  component: () => (
    <>
      <PageHeader
        title="Operaciones"
        subtitle="Stock, production, procurement planning y COGS simulator."
      />
      <Placeholder note="FP Stock, FP Input, I&P Input, Production, Procurement y COGS." />
    </>
  ),
  head: () => ({ meta: [{ title: "Operaciones · BARIS" }] }),
});