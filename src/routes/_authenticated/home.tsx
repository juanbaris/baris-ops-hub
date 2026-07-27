import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Placeholder } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage,
  head: () => ({
    meta: [{ title: "Home · BARIS Operations Hub" }],
  }),
});

function HomePage() {
  return (
    <>
      <PageHeader title="Welcome back" subtitle="Overview del período actual" />
      <Placeholder note="KPIs, sales by SKU chart y stock alerts se cargarán aquí cuando construyamos el módulo Home." />
    </>
  );
}