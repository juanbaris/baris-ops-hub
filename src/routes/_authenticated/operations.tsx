import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/operations")({
  component: () => (
    <>
      <PageHeader
        title="Operaciones"
        subtitle="Stock, production, procurement planning y COGS simulator."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          to="/fp-stock"
          className="rounded-2xl border border-border bg-card p-5 hover:border-primary/50 hover:bg-muted/40"
        >
          <h3 className="text-base font-semibold">FP Stock</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Finished product on hand by SKU and warehouse.
          </p>
        </Link>
        <Link
          to="/fp-movements"
          className="rounded-2xl border border-border bg-card p-5 hover:border-primary/50 hover:bg-muted/40"
        >
          <h3 className="text-base font-semibold">FP Movements</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Finished product ledger.
          </p>
        </Link>
        <Link
          to="/ip-movements"
          className="rounded-2xl border border-border bg-card p-5 hover:border-primary/50 hover:bg-muted/40"
        >
          <h3 className="text-base font-semibold">I&amp;P Movements</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Ingredients &amp; packaging ledger.
          </p>
        </Link>
      </div>
    </>
  ),
  head: () => ({ meta: [{ title: "Operaciones · BARIS" }] }),
});