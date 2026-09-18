import { createFileRoute } from "@tanstack/react-router";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

export const Route = createFileRoute("/api/baris-agent")({
  server: {
    handlers: {
      OPTIONS: async () => new Response("ok", { headers: cors }),
      POST: async ({ request }) => {
        const apiKey = process.env["ANTHROPIC_API_KEY"];
        const supabaseUrl = process.env["SUPABASE_URL"];
        const anonKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const model = process.env["AGENT_MODEL"] ?? "claude-sonnet-4-5";
        if (!apiKey) return json({ error: "Falta ANTHROPIC_API_KEY." }, 500);
        if (!supabaseUrl || !anonKey) return json({ error: "Backend no configurado." }, 500);

        // Autenticación: exigir usuario logueado (el agente lee toda la DB con service role).
        const authHeader = request.headers.get("Authorization") ?? "";
        const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { apikey: anonKey, Authorization: authHeader },
        });
        if (!userRes.ok) return json({ error: "No autenticado." }, 401);

        try {
          const body = (await request.json().catch(() => ({}))) as {
            message?: string;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            history?: any[];
          };
          const message = body.message ?? "";
          const history = Array.isArray(body.history) ? body.history : [];
          if (!message.trim()) return json({ error: "Falta 'message'." }, 400);

          const { agentTurn } = await import("@/lib/baris-agent.server");
          const { reply, tools_used, messages } = await agentTurn(message, history, { apiKey, model });
          return json({ reply, tools_used, history: messages });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : String(e) }, 500);
        }
      },
    },
  },
});
