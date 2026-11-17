import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexRedirect,
  head: () => ({ meta: [
    { title: "BARIS Operations Hub" },
    { name: "description", content: "Access BARIS sales, fulfillment, inventory and financial operations." },
    { property: "og:title", content: "BARIS Operations Hub" },
    { property: "og:description", content: "Access BARIS sales, fulfillment, inventory and financial operations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
});

function IndexRedirect() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setTarget(data.session ? "/home" : "/auth");
    });
  }, []);
  if (!target) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  return <Navigate to={target} />;
}
