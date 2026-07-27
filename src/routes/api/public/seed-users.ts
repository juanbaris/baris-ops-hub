import { createFileRoute } from "@tanstack/react-router";

// One-time seeding endpoint. Creates the 4 named BARIS users with the roles
// specified in the initial spec. Idempotent: refuses to run if any users
// already exist. Returns the generated temp passwords so an admin can
// share them privately.
export const Route = createFileRoute("/api/public/seed-users")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        const { data: existing, error: listErr } =
          await supabaseAdmin.auth.admin.listUsers({ perPage: 1 });
        if (listErr) return json({ error: listErr.message }, 500);
        if ((existing?.users?.length ?? 0) > 0) {
          return json(
            { error: "Users already exist. Seeding is a one-time action." },
            409,
          );
        }

        const seed: Array<{
          email: string;
          name: string;
          role: "admin" | "editor" | "viewer";
        }> = [
          { email: "marcos@baris.local", name: "Marcos", role: "admin" },
          { email: "pedro@baris.local", name: "Pedro", role: "admin" },
          { email: "juan@baris.local", name: "Juan", role: "editor" },
          { email: "luca@baris.local", name: "Luca", role: "viewer" },
        ];

        const results: Array<{
          email: string;
          name: string;
          role: string;
          temp_password: string;
        }> = [];

        for (const u of seed) {
          const temp = generatePassword(14);
          const { data: created, error: cErr } =
            await supabaseAdmin.auth.admin.createUser({
              email: u.email,
              password: temp,
              email_confirm: true,
              user_metadata: { display_name: u.name },
            });
          if (cErr || !created.user)
            return json({ error: `Create ${u.email}: ${cErr?.message}` }, 500);
          const { error: rErr } = await supabaseAdmin
            .from("user_roles")
            .insert({ user_id: created.user.id, role: u.role });
          if (rErr)
            return json({ error: `Role ${u.email}: ${rErr.message}` }, 500);
          results.push({
            email: u.email,
            name: u.name,
            role: u.role,
            temp_password: temp,
          });
        }

        return json({ ok: true, users: results });
      },
    },
  },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function generatePassword(len: number): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
  return out;
}