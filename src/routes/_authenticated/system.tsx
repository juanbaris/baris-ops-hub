import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/system")({
  component: SystemPage,
  head: () => ({ meta: [{ title: "Sistema · BARIS" }] }),
});

type UserRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  role: string | null;
};

function SystemPage() {
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, display_name, email");
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role");
      const map = new Map((roles ?? []).map((r) => [r.user_id, r.role]));
      setUsers(
        (profiles ?? []).map((p) => ({
          id: p.id,
          display_name: p.display_name,
          email: p.email,
          role: map.get(p.id) ?? null,
        })),
      );
    })();
  }, []);

  return (
    <>
      <PageHeader
        title="Sistema"
        subtitle="Usuarios, distribuidores, imports y audit log."
      />
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Usuarios
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 font-medium">Nombre</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Rol</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/60">
                <td className="py-2.5 font-medium text-foreground">
                  {u.display_name ?? "—"}
                </td>
                <td className="py-2.5 font-mono text-xs text-muted-foreground">
                  {u.email}
                </td>
                <td className="py-2.5">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {u.role ?? "—"}
                  </span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-muted-foreground">
                  Aún no hay usuarios creados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}