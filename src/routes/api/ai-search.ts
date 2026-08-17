import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const BodySchema = z.object({ query: z.string().min(1).max(2000) });

export const Route = createFileRoute("/api/ai-search")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ error: "AI is not configured." }, { status: 500 });

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "Missing question." }, { status: 400 });

        const { buildDataContext, SEARCH_SYSTEM_PROMPT } = await import("@/lib/ai-search.server");

        let context: string;
        try {
          context = await buildDataContext();
        } catch (err) {
          console.error("ai-search context failed", err);
          return Response.json({ error: "Could not read the database." }, { status: 500 });
        }

        const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": apiKey,
            "X-Lovable-AIG-SDK": "fetch",
          },
          body: JSON.stringify({
            model: "openai/gpt-5.6-sol",
            stream: true,
            instructions: SEARCH_SYSTEM_PROMPT,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: `DATA SNAPSHOT:\n${context}\n\nQUESTION: ${parsed.data.query}` },
                ],
              },
            ],
            reasoning: { effort: "low", summary: "auto" },
          }),
        });

        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          console.error("ai-search gateway error", res.status, detail);
          if (res.status === 429) return Response.json({ error: "Too many requests, try again in a moment." }, { status: 429 });
          if (res.status === 402) return Response.json({ error: "AI credits exhausted. Add credits to continue." }, { status: 402 });
          return Response.json({ error: "AI service failed." }, { status: 502 });
        }

        // Read the SSE stream and accumulate the answer text.
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const evt = JSON.parse(payload) as {
                type?: string;
                delta?: string;
                response?: { output_text?: string };
              };
              if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
                answer += evt.delta;
              } else if (evt.type === "response.completed" && !answer && evt.response?.output_text) {
                answer = evt.response.output_text;
              }
            } catch {
              /* ignore keep-alive / partial frames */
            }
          }
        }

        return Response.json({ answer: answer.trim() || "No answer could be produced from the current data." });
      },
    },
  },
});
