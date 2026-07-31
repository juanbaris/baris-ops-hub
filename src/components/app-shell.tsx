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
            <span className="hidden text-sm text-sidebar-foreground/70 sm:inline">
              {name}
            </span>
            <button
              onClick={signOut}
              className="rounded-md border border-sidebar-border/40 bg-transparent px-3 py-1 text-xs text-sidebar-foreground/80 hover:bg-sidebar-accent"
            >
              Salir
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
        Próximamente
      </p>
      <p className="mt-2 text-sm text-foreground">{note}</p>
    </div>
  );
}