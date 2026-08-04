import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const NAV = [
  { to: "/home", label: "Home" },
  { to: "/fulfillment", label: "Fulfillment" },
  { to: "/operations", label: "Operations" },
  { to: "/sales", label: "Sales" },
  { to: "/finance", label: "Finance" },
  { to: "/system", label: "System" },
] as const;

function NavAISearch() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  async function ask() {
    if (!query.trim()) return;
    setLoading(true);
    setAnswer(null);
    setOpen(true);

    const [{ data: mv }, { data: ords }] = await Promise.all([
      supabase.from("fp_movements").select("sku,cases,type"),
      supabase.from("customer_orders").select("*").order("po_date", { ascending: false }).limit(200),
    ]);

    const stock: Record<string, number> = {};
    for (const m of mv ?? []) {
      stock[m.sku] = (stock[m.sku] ?? 0) + (m.type === "In" ? Number(m.cases) : -Number(m.cases));
    }
    const orders = ords ?? [];

    const stockSummary = Object.entries(stock)
      .map(([sku, cases]) => `${sku}: ${Math.round(cases)} cases`)
      .join(", ");

    const openOrders = orders.filter((o) => o.status !== "Invoiced");
    const invoicedThisMonth = orders.filter((o) => {
      if (o.status !== "Invoiced" || !o.invoice_date) return false;
      const d = new Date(o.invoice_date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const revenueThisMonth = invoicedThisMonth.reduce((s, o) => s + (Number(o.gross_sales) || 0), 0);

    const ordersContext = orders.slice(0, 50).map((o) =>
      `PO ${o.po_number}: ${o.distributor} ${o.customer} ${o.status} gross_sales=$${o.gross_sales || 0} po_date=${o.po_date}`
    ).join("\n");

    const context = `
BARIS Ops Hub — Live data as of today:

STOCK (Lineage Newark, cases on hand):
${stockSummary}

OPEN ORDERS (${openOrders.length} total):
${openOrders.slice(0, 20).map((o) => `PO ${o.po_number}: ${o.distributor} ${o.customer} status=${o.status} gross_sales=$${o.gross_sales || 0}`).join("\n")}

REVENUE THIS MONTH (invoiced): $${Math.round(revenueThisMonth).toLocaleString()}

RECENT ORDERS (last 50):
${ordersContext}

FORECAST (Normal scenario, cases):
Aug 2026: 3869, Sep: 8810, Oct: 4524, Nov: 1548, Dec: 7917
Jan 2027: 1250, Feb: 8334, Mar: 8274, Apr: 9762, May: 4286, Jun: 8750, Jul: 4048
`;

    try {
      const response = await fetch("/api/process-po", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "search", query, context }),
      });
      if (response.ok) {
        const data = await response.json();
        setAnswer(data.answer || "No answer found.");
      } else {
        setAnswer("Could not get an answer. Try again.");
      }
    } catch {
      setAnswer("Error connecting to AI.");
    }
    setLoading(false);
  }

  return (
    <div className="relative hidden md:block" style={{ width: 260 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && ask()}
        onFocus={() => answer && setOpen(true)}
        placeholder="✨ Ask AI about your data…"
        className="w-full rounded-full border border-sidebar-border/40 bg-sidebar-accent/40 px-4 py-1.5 text-sm text-sidebar-foreground placeholder:text-sidebar-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      {loading && (
        <span className="absolute right-3 top-1.5 animate-spin text-sm text-sidebar-foreground/70">⟳</span>
      )}
      {open && (answer || loading) && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[420px] rounded-xl border border-border bg-card p-4 text-foreground shadow-lg">
          {loading ? (
            <p className="text-sm text-muted-foreground">Thinking…</p>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
              <button
                onClick={() => { setOpen(false); setAnswer(null); setQuery(""); }}
                className="mt-2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear ✕
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [name, setName] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: p } = await supabase
        .from("profiles")
        .select("display_name, email")
        .eq("id", data.user.id)
        .maybeSingle();
      setName(p?.display_name || p?.email || data.user.email || "");
    });
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-1 px-4">
          <div className="mr-4 flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              B
            </div>
            <span className="font-mono text-sm font-bold tracking-widest">BARIS</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active = path === item.to || path.startsWith(item.to + "/");
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <NavAISearch />
            <span className="hidden text-sm text-sidebar-foreground/70 sm:inline">
              {name}
            </span>
            <button
              onClick={signOut}
              className="rounded-md border border-sidebar-border/40 bg-transparent px-3 py-1 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
      {subtitle && (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

export function Placeholder({ note }: { note: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Coming soon
      </p>
      <p className="mt-2 text-sm text-foreground">{note}</p>
    </div>
  );
}