// ─── Collections Tab ──────────────────────────────────────────────────────────
// Replaces the existing CollectionsTab in fulfillment.tsx (lines 2315-2519)
// 4 layers: Collected (green) · Invoiced/Pending (yellow) · Pipeline (orange) · Forecast (gray)

const PAYMENT_TERMS: Record<string, number> = { UNFI: 30, KeHe: 30, RFD: 30, Rainforest: 60, Direct: 30, Other: 30 };

const DEDUCTION_RATE: Record<string, number> = {
  UNFI: 0.17,       // 17% — UNFI Allowance + promos + fees
  KeHe: 0.16,       // 16% — KeHE Allowance + promos + fees + freight (FOB)
  Rainforest: 0.28,  // 28% — DSD + MCBs + Incentives (from Jul payment data)
  RFD: 0.15,
  Direct: 0.05,
  Other: 0.10,
};

// DC mix for forecast (Capa 4)
const DC_MIX: Record<string, number> = { KeHe: 0.51, UNFI: 0.26, Rainforest: 0.23 };

// Weeks from pipeline status to invoice
const WEEKS_TO_INVOICE: Record<string, number> = {
  Open: 3, Accepted: 3, "Sent to 3PL": 3,
  Shipment: 2, "BOL Confirmed": 2,
};

type Layer = "collected" | "invoiced" | "pipeline" | "forecast";

interface CollectionRow {
  id: string;
  layer: Layer;
  distributor: string;
  poNumber: string;
  customer: string;
  grossSales: number;
  deductionPct: number;
  expectedCollection: number;
  invoiceDate: string | null;
  estCollectionDate: string;
  estCollectionWeek: string;  // "YYYY-Www"
  daysUntilCollection: number;
  status: string;
  collectedAt: string | null;
  actualAmount: number | null;
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const dayOfWeek = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (dt: Date) => `${dt.toLocaleString("en", { month: "short" })} ${dt.getDate()}`;
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function getWeekKey(dateStr: string): string {
  const d = new Date(dateStr);
  const dayOfWeek = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function getMonthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function CollectionsTab({ orders }: { orders: Order[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const [viewMode, setViewMode] = useState<"pending" | "collected" | "all">("pending");
  const [filterDist, setFilterDist] = useState<string>("all");
  const [filterLayer, setFilterLayer] = useState<string>("all");
  const [sortKey, setSortKey] = useState<string>("estCollectionDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [marking, setMarking] = useState<string | null>(null);

  // ── Build all 4 layers ────────────────────────────────────────────────
  const allRows: CollectionRow[] = useMemo(() => {
    const rows: CollectionRow[] = [];

    orders.forEach(o => {
      const dist = o.distributor || "Other";
      const gross = Number(o.gross_sales) || 0;
      if (gross <= 0) return;
      const dedPct = DEDUCTION_RATE[dist] ?? 0.15;
      const expected = Math.round(gross * (1 - dedPct));
      const terms = PAYMENT_TERMS[dist] ?? 30;

      // ── CAPA 1: Collected ──
      if (o.collected_at) {
        const collDate = (o.collected_at as string).slice(0, 10);
        rows.push({
          id: o.id,
          layer: "collected",
          distributor: dist,
          poNumber: o.po_number || "—",
          customer: o.customer || "—",
          grossSales: gross,
          deductionPct: dedPct,
          expectedCollection: expected,
          invoiceDate: o.invoice_date,
          estCollectionDate: collDate,
          estCollectionWeek: getWeekKey(collDate),
          daysUntilCollection: 0,
          status: "Collected",
          collectedAt: collDate,
          actualAmount: null, // TODO: track actual amount received
        });
        return;
      }

      // ── CAPA 2: Invoiced, pending collection ──
      if (o.status === "Invoiced" && o.invoice_date) {
        const estDate = addDays(o.invoice_date, terms);
        const daysUntil = Math.floor((new Date(estDate).getTime() - new Date(today).getTime()) / 86400000);
        const statusLabel = daysUntil < -7 ? "Overdue" : daysUntil < 0 ? "Late" : daysUntil <= 7 ? "Due soon" : "Upcoming";
        rows.push({
          id: o.id,
          layer: "invoiced",
          distributor: dist,
          poNumber: o.po_number || "—",
          customer: o.customer || "—",
          grossSales: gross,
          deductionPct: dedPct,
          expectedCollection: expected,
          invoiceDate: o.invoice_date,
          estCollectionDate: estDate,
          estCollectionWeek: getWeekKey(estDate),
          daysUntilCollection: daysUntil,
          status: statusLabel,
          collectedAt: null,
          actualAmount: null,
        });
        return;
      }

      // ── CAPA 3: Pipeline (pre-invoice) ──
      const weeksToInv = WEEKS_TO_INVOICE[o.status as string];
      if (weeksToInv !== undefined) {
        const estInvoiceDate = addDays(today, weeksToInv * 7);
        const estDate = addDays(estInvoiceDate, terms);
        const daysUntil = Math.floor((new Date(estDate).getTime() - new Date(today).getTime()) / 86400000);
        rows.push({
          id: o.id,
          layer: "pipeline",
          distributor: dist,
          poNumber: o.po_number || "—",
          customer: o.customer || "—",
          grossSales: gross,
          deductionPct: dedPct,
          expectedCollection: expected,
          invoiceDate: null,
          estCollectionDate: estDate,
          estCollectionWeek: getWeekKey(estDate),
          daysUntilCollection: daysUntil,
          status: `${o.status} → ~${weeksToInv}w to inv`,
          collectedAt: null,
          actualAmount: null,
        });
      }
    });

    return rows;
  }, [orders, today]);

  // ── CAPA 4: Forecast (monthly, from demand model) ──────────────────
  // Uses monthly gross sales from the demand forecast × DC mix × (1-ded%)
  // We generate 4 months of forecast from today
  const forecastRows = useMemo(() => {
    // Monthly forecast gross (Normal scenario, rough)
    // These should ideally come from the demand forecast model
    const MONTHLY_FORECAST: Record<string, number> = {
      "2026-08": 224294, "2026-09": 208194, "2026-10": 259592,
      "2026-11": 243477, "2026-12": 193917,
      "2027-01": 219000, "2027-02": 252000, "2027-03": 296000,
    };

    const rows: { month: string; monthLabel: string; dc: string; gross: number; net: number; collectionMonth: string }[] = [];

    Object.entries(MONTHLY_FORECAST).forEach(([month, grossTotal]) => {
      Object.entries(DC_MIX).forEach(([dc, mix]) => {
        const gross = Math.round(grossTotal * mix);
        const dedPct = DEDUCTION_RATE[dc] ?? 0.15;
        const net = Math.round(gross * (1 - dedPct));
        const terms = PAYMENT_TERMS[dc] ?? 30;
        // Collection month = invoice month + terms/30 months
        const [y, m] = month.split("-").map(Number);
        const collDate = new Date(y, m - 1 + Math.ceil(terms / 30), 15);
        const collMonth = collDate.toISOString().slice(0, 7);
        const monthLabel = new Date(y, m - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });

        rows.push({ month, monthLabel, dc, gross, net, collectionMonth: collMonth });
      });
    });
    return rows;
  }, []);

  // ── Filter & Sort ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return allRows
      .filter(r => {
        if (viewMode === "pending" && r.layer === "collected") return false;
        if (viewMode === "collected" && r.layer !== "collected") return false;
        if (filterDist !== "all" && r.distributor !== filterDist) return false;
        if (filterLayer !== "all" && r.layer !== filterLayer) return false;
        return true;
      })
      .sort((a, b) => {
        let av: number | string = 0, bv: number | string = 0;
        if (sortKey === "estCollectionDate") { av = a.estCollectionDate; bv = b.estCollectionDate; }
        else if (sortKey === "expectedCollection") { av = a.expectedCollection; bv = b.expectedCollection; }
        else if (sortKey === "grossSales") { av = a.grossSales; bv = b.grossSales; }
        else if (sortKey === "distributor") { av = a.distributor; bv = b.distributor; }
        else if (sortKey === "layer") { av = a.layer; bv = b.layer; }
        if (av < bv) return sortDir === "asc" ? -1 : 1;
        if (av > bv) return sortDir === "asc" ? 1 : -1;
        return 0;
      });
  }, [allRows, viewMode, filterDist, filterLayer, sortKey, sortDir]);

  // ── Weekly timeline (next 8 weeks) ────────────────────────────────────
  const weeklyTimeline = useMemo(() => {
    const weeks: Map<string, { label: string; invoiced: number; pipeline: number; orders: number }> = new Map();

    // Generate 8 weeks from today
    for (let w = 0; w < 8; w++) {
      const weekStart = addDays(today, w * 7 - new Date(today).getDay() + 1);
      const key = getWeekKey(weekStart);
      const label = getWeekLabel(weekStart);
      weeks.set(key, { label, invoiced: 0, pipeline: 0, orders: 0 });
    }

    allRows
      .filter(r => r.layer === "invoiced" || r.layer === "pipeline")
      .forEach(r => {
        const key = r.estCollectionWeek;
        const entry = weeks.get(key);
        if (entry) {
          if (r.layer === "invoiced") entry.invoiced += r.expectedCollection;
          else entry.pipeline += r.expectedCollection;
          entry.orders++;
        }
      });

    return [...weeks.entries()].map(([key, data]) => ({ weekKey: key, ...data }));
  }, [allRows, today]);

  // ── KPI calculations ──────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const pending = allRows.filter(r => r.layer === "invoiced");
    const pipeline = allRows.filter(r => r.layer === "pipeline");
    const collected = allRows.filter(r => r.layer === "collected");
    const thisMonth = today.slice(0, 7);

    const overdue = pending.filter(r => r.daysUntilCollection < 0);
    const dueSoon = pending.filter(r => r.daysUntilCollection >= 0 && r.daysUntilCollection <= 7);

    return {
      totalPendingNet: pending.reduce((s, r) => s + r.expectedCollection, 0),
      totalPendingGross: pending.reduce((s, r) => s + r.grossSales, 0),
      pendingCount: pending.length,
      dueSoonNet: dueSoon.reduce((s, r) => s + r.expectedCollection, 0),
      dueSoonCount: dueSoon.length,
      overdueNet: overdue.reduce((s, r) => s + r.expectedCollection, 0),
      overdueCount: overdue.length,
      pipelineNet: pipeline.reduce((s, r) => s + r.expectedCollection, 0),
      pipelineCount: pipeline.length,
      collectedThisMonth: collected
        .filter(r => (r.collectedAt || "").startsWith(thisMonth))
        .reduce((s, r) => s + r.expectedCollection, 0),
      collectedThisMonthCount: collected.filter(r => (r.collectedAt || "").startsWith(thisMonth)).length,
      totalDeductions: pending.reduce((s, r) => s + r.grossSales * r.deductionPct, 0),
    };
  }, [allRows, today]);

  // ── Actions ───────────────────────────────────────────────────────────
  async function markCollected(orderId: string) {
    setMarking(orderId);
    const { error } = await supabase
      .from("customer_orders")
      .update({ collected_at: new Date().toISOString() })
      .eq("id", orderId);
    if (error) toast.error("Failed");
    else toast.success("Marked as collected ✓");
    setMarking(null);
  }

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const SortTh = ({ label, k, align }: { label: string; k: string; align?: string }) => (
    <th onClick={() => toggleSort(k)}
      className={`px-3 py-2.5 ${align === "right" ? "text-right" : "text-left"} cursor-pointer hover:text-foreground select-none whitespace-nowrap`}>
      {label}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  const distOptions = [...new Set(allRows.map(r => r.distributor))].sort();

  const LAYER_STYLES: Record<Layer, { bg: string; text: string; label: string; dot: string }> = {
    collected: { bg: "bg-emerald-50", text: "text-emerald-700", label: "Collected", dot: "bg-emerald-500" },
    invoiced:  { bg: "bg-yellow-50",  text: "text-yellow-700",  label: "Invoiced",  dot: "bg-yellow-500" },
    pipeline:  { bg: "bg-orange-50",  text: "text-orange-700",  label: "Pipeline",  dot: "bg-orange-500" },
    forecast:  { bg: "bg-slate-50",   text: "text-slate-600",   label: "Forecast",  dot: "bg-slate-400" },
  };

  // ═════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-5">

      {/* ── SECTION A: KPI Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: "Pending (net)", value: kpis.totalPendingNet, sub: `${kpis.pendingCount} invoices · gross $${Math.round(kpis.totalPendingGross).toLocaleString()}`, color: "text-amber-600" },
          { label: "Due This Week", value: kpis.dueSoonNet, sub: `${kpis.dueSoonCount} invoices`, color: "text-orange-600" },
          { label: "Overdue", value: kpis.overdueNet, sub: `${kpis.overdueCount} invoices`, color: kpis.overdueNet > 0 ? "text-red-600" : "text-emerald-600" },
          { label: "In Pipeline", value: kpis.pipelineNet, sub: `${kpis.pipelineCount} POs not yet invoiced`, color: "text-orange-500" },
          { label: "Collected (month)", value: kpis.collectedThisMonth, sub: `${kpis.collectedThisMonthCount} this month`, color: "text-emerald-600" },
        ].map((kpi, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5">{kpi.label}</p>
            <p className={`text-xl font-bold font-mono ${kpi.color}`}>${Math.round(kpi.value).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Payment terms & deduction rates legend ───────────────────── */}
      <div className="flex items-center gap-2 flex-wrap text-[10px]">
        {Object.entries(PAYMENT_TERMS).filter(([d]) => ["UNFI","KeHe","Rainforest"].includes(d)).map(([d, t]) => (
          <span key={d} className={`rounded-full px-2.5 py-1 font-semibold ${d === "Rainforest" ? "bg-orange-100 text-orange-700 border border-orange-200" : "bg-muted text-muted-foreground"}`}>
            {d}: {t}d · {Math.round((DEDUCTION_RATE[d] ?? 0) * 100)}% ded
          </span>
        ))}
        <span className="text-muted-foreground ml-2">Amounts shown are NET (after estimated deductions)</span>
      </div>

      {/* ── SECTION B: Weekly Timeline ────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Expected Collections — Next 8 Weeks (net of deductions)
          </h3>
        </div>
        <div className="grid grid-cols-8 divide-x divide-border">
          {weeklyTimeline.map((w, i) => {
            const total = w.invoiced + w.pipeline;
            const isThisWeek = i === 0;
            return (
              <div key={w.weekKey} className={`px-3 py-3 text-center ${isThisWeek ? "bg-amber-50/50" : ""}`}>
                <p className={`text-[10px] font-semibold ${isThisWeek ? "text-amber-700" : "text-muted-foreground"}`}>
                  {isThisWeek ? "THIS WEEK" : w.label.split(" – ")[0]}
                </p>
                <p className="text-lg font-bold font-mono mt-1" style={{ color: total > 0 ? "#1C2340" : "#ccc" }}>
                  ${total > 0 ? Math.round(total / 1000) + "K" : "—"}
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {w.invoiced > 0 && (
                    <p className="text-[9px] font-medium text-yellow-700">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 mr-0.5" />
                      ${Math.round(w.invoiced / 1000)}K inv
                    </p>
                  )}
                  {w.pipeline > 0 && (
                    <p className="text-[9px] font-medium text-orange-600">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 mr-0.5" />
                      ${Math.round(w.pipeline / 1000)}K pipe
                    </p>
                  )}
                </div>
                {w.orders > 0 && (
                  <p className="text-[9px] text-muted-foreground mt-1">{w.orders} orders</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── SECTION C: Detail Table ──────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between flex-wrap gap-2">
          {/* View tabs */}
          <div className="flex gap-1">
            {(["pending", "collected", "all"] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${viewMode === mode ? "bg-[#1C2340] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                {mode === "pending" ? "Pending" : mode === "collected" ? "Collected" : "All"}
              </button>
            ))}
          </div>
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <select value={filterDist} onChange={e => setFilterDist(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none">
              <option value="all">All distributors</option>
              {distOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select value={filterLayer} onChange={e => setFilterLayer(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none">
              <option value="all">All layers</option>
              <option value="invoiced">Invoiced only</option>
              <option value="pipeline">Pipeline only</option>
              <option value="collected">Collected only</option>
            </select>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted/30 border-b border-border">
              <th className="px-3 py-2.5 text-left w-16">Layer</th>
              <SortTh label="Distributor" k="distributor" />
              <th className="px-3 py-2.5 text-left">PO #</th>
              <th className="px-3 py-2.5 text-left">Customer</th>
              <SortTh label="Gross" k="grossSales" align="right" />
              <th className="px-3 py-2.5 text-right">Ded %</th>
              <SortTh label="Expected Net" k="expectedCollection" align="right" />
              <th className="px-3 py-2.5 text-left">Status</th>
              <SortTh label="Est. Collection" k="estCollectionDate" />
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                {viewMode === "collected" ? "No collected payments yet" : "No pending collections ✅"}
              </td></tr>
            ) : filtered.map(r => {
              const ls = LAYER_STYLES[r.layer];
              const isOverdue = r.layer === "invoiced" && r.daysUntilCollection < 0;
              const isDueSoon = r.layer === "invoiced" && r.daysUntilCollection >= 0 && r.daysUntilCollection <= 7;
              const rowBg = isOverdue ? "bg-red-50/40" : isDueSoon ? "bg-orange-50/30" : r.layer === "pipeline" ? "bg-orange-50/15" : r.layer === "collected" ? "bg-emerald-50/20" : "";

              return (
                <tr key={r.id} className={`border-t border-border/60 hover:bg-muted/20 ${rowBg}`}>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${ls.bg} ${ls.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ls.dot}`} />
                      {ls.label}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold text-xs" style={{ color: "#1C2340" }}>{r.distributor}</td>
                  <td className="px-3 py-2 font-mono text-xs font-semibold" style={{ color: "#A3224A" }}>{r.poNumber}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[120px]">{r.customer}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                    ${Math.round(r.grossSales).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-[10px] text-red-500 font-semibold">
                    -{Math.round(r.deductionPct * 100)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold text-emerald-600">
                    ${Math.round(r.expectedCollection).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold whitespace-nowrap
                      ${isOverdue ? "bg-red-100 text-red-700"
                        : isDueSoon ? "bg-orange-100 text-orange-700"
                        : r.layer === "collected" ? "bg-emerald-100 text-emerald-700"
                        : r.layer === "pipeline" ? "bg-orange-50 text-orange-600"
                        : "bg-blue-50 text-blue-700"}`}>
                      {r.status}
                      {isOverdue && ` (${Math.abs(r.daysUntilCollection)}d late)`}
                      {isDueSoon && ` (in ${r.daysUntilCollection}d)`}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.layer === "collected"
                      ? <span className="text-emerald-600">{r.collectedAt}</span>
                      : <span className={isOverdue ? "text-red-600 font-bold" : isDueSoon ? "text-orange-500" : "text-muted-foreground"}>
                          {r.estCollectionDate}
                        </span>
                    }
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.layer === "invoiced" && (
                      <button onClick={() => markCollected(r.id)} disabled={marking === r.id}
                        className="rounded-lg px-2.5 py-1 text-[10px] font-semibold border border-border hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 disabled:opacity-50">
                        {marking === r.id ? "…" : "✓ Collected"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ backgroundColor: "#1C2340", color: "#fff" }}>
                <td colSpan={4} className="px-3 py-2.5 text-xs font-semibold">
                  Total ({filtered.length} {viewMode === "collected" ? "collected" : "pending"})
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-slate-300">
                  ${Math.round(filtered.reduce((s, r) => s + r.grossSales, 0)).toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right text-[10px] text-red-300">
                  -${Math.round(filtered.reduce((s, r) => s + r.grossSales * r.deductionPct, 0)).toLocaleString()}
                </td>
                <td className="px-3 py-2.5 text-right font-mono font-bold text-emerald-400">
                  ${Math.round(filtered.reduce((s, r) => s + r.expectedCollection, 0)).toLocaleString()}
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── SECTION D: Monthly Forecast (Capa 4) ─────────────────────── */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-muted/30">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Monthly Collections Forecast — by Distributor (estimated, Normal scenario)
          </h3>
        </div>
        <div className="p-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="px-3 py-2 text-left">Month (invoiced)</th>
                <th className="px-3 py-2 text-right">KeHe (51%)</th>
                <th className="px-3 py-2 text-right">UNFI (26%)</th>
                <th className="px-3 py-2 text-right">RF (23%)</th>
                <th className="px-3 py-2 text-right font-bold">Total Net</th>
                <th className="px-3 py-2 text-left text-muted-foreground/70">Collection month</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Group by invoice month
                const months = [...new Set(forecastRows.map(r => r.month))].sort();
                return months.map(month => {
                  const monthRows = forecastRows.filter(r => r.month === month);
                  const kehe = monthRows.find(r => r.dc === "KeHe");
                  const unfi = monthRows.find(r => r.dc === "UNFI");
                  const rf = monthRows.find(r => r.dc === "Rainforest");
                  const total = monthRows.reduce((s, r) => s + r.net, 0);
                  const collMonth = kehe?.collectionMonth || month;
                  const label = new Date(month + "-15").toLocaleString("en", { month: "short", year: "numeric" });
                  const collLabel = new Date(collMonth + "-15").toLocaleString("en", { month: "short", year: "numeric" });

                  return (
                    <tr key={month} className="border-t border-border/40 hover:bg-muted/10">
                      <td className="px-3 py-2 font-semibold text-xs" style={{ color: "#1C2340" }}>{label}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        <span className="text-muted-foreground">${Math.round((kehe?.gross || 0) / 1000)}K</span>
                        <span className="text-emerald-600 font-semibold ml-1">→ ${Math.round((kehe?.net || 0) / 1000)}K</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        <span className="text-muted-foreground">${Math.round((unfi?.gross || 0) / 1000)}K</span>
                        <span className="text-emerald-600 font-semibold ml-1">→ ${Math.round((unfi?.net || 0) / 1000)}K</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        <span className="text-muted-foreground">${Math.round((rf?.gross || 0) / 1000)}K</span>
                        <span className="text-emerald-600 font-semibold ml-1">→ ${Math.round((rf?.net || 0) / 1000)}K</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-600">
                        ${Math.round(total / 1000)}K
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px]">
                          Collect ~{collLabel}
                        </span>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
