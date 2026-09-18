// src/components/baris-ai-panel.tsx
// Panel flotante de chat para el agente BARIS AI (v1, solo lectura).
// Llama al endpoint /api/baris-agent con el token de sesión del usuario logueado.
import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type DisplayMsg = { role: "user" | "assistant"; text: string; tools?: string[]; error?: boolean };

const SUGGESTIONS = [
  "Dame los 5 KPIs más importantes",
  "¿Cómo está nuestro cashflow?",
  "Calculá la NOF",
  "¿Qué inconsistencias hay en operaciones?",
];

export function BarisAiPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const serverHistory = useRef<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("No hay sesión activa. Volvé a iniciar sesión.");
      const res = await fetch("/api/baris-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: q, history: serverHistory.current }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `Error ${res.status}`);
      serverHistory.current = j.history ?? serverHistory.current;
      setMessages((m) => [
        ...m,
        { role: "assistant", text: j.reply || "(sin respuesta)", tools: (j.tools_used ?? []).map((t: any) => t.tool) },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e instanceof Error ? e.message : String(e), error: true }]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setMessages([]);
    serverHistory.current = [];
  }

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Abrir BARIS AI"
        style={{ position: "fixed", right: 24, bottom: 24, zIndex: 60 }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition hover:scale-105 hover:bg-neutral-800"
      >
        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3c-4.97 0-9 3.58-9 8 0 2.03.86 3.88 2.28 5.29L4 21l4.9-1.2c1 .27 2.05.4 3.1.4 4.97 0 9-3.58 9-8s-4.03-8-9-8Z" />
          </svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          style={{ position: "fixed", right: 24, bottom: 92, zIndex: 60, width: 400, maxWidth: "calc(100vw - 32px)", height: 620, maxHeight: "calc(100vh - 120px)" }}
          className="flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-200 bg-neutral-900 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-semibold tracking-tight">BARIS AI</span>
              <span className="text-xs text-neutral-400">solo lectura</span>
            </div>
            <button onClick={reset} className="text-xs text-neutral-300 hover:text-white">Limpiar</button>
          </div>

          {/* Mensajes */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-neutral-500">
                  Preguntame sobre cashflow, NOF, KPIs, SKUs, pipeline o inconsistencias. Respondo en español o inglés.
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 transition hover:border-neutral-900 hover:bg-neutral-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-900 px-3.5 py-2.5 text-sm text-white"
                      : m.error
                      ? "max-w-[90%] rounded-2xl rounded-bl-sm border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
                      : "max-w-[90%] rounded-2xl rounded-bl-sm bg-neutral-100 px-3.5 py-2.5 text-sm text-neutral-800"
                  }
                >
                  <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                  {m.tools && m.tools.length > 0 && (
                    <div className="mt-2 border-t border-neutral-200 pt-1.5 text-[10px] text-neutral-400">
                      tools: {m.tools.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-neutral-100 px-3.5 py-2.5 text-sm text-neutral-500">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: "0ms" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: "150ms" }} />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-neutral-200 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Escribí tu pregunta…"
                className="max-h-28 flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
              <button
                onClick={() => send(input)}
                disabled={loading || !input.trim()}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-900 text-white transition hover:bg-neutral-800 disabled:opacity-40"
                aria-label="Enviar"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
