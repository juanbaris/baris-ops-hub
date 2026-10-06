import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { EXTENDED_SKUS } from "@/lib/sales-database";
import { PRICE_PER_CASE, WEEKS_PER_MONTH, UNITS_PER_CASE, FORECAST_MONTHS } from "@/lib/sales-forecast";

// ─── Types ────────────────────────────────────────────────────────────────────
type SimStore = { name: string; skuVelocities: Record<string, number> };
type SimAccount = { id: string; name: string; stores: SimStore[]; entryMonth: string; active: boolean };
type SimState = { accounts: SimAccount[] };

const LS_KEY = "baris_sim_v1";
const SKUS = [...EXTENDED_SKUS];
const SKU_COLORS: Record<string, string> = {
  XD: "#1C2340", PW: "#A3224A", HM: "#3B82F6", WM: "#10B981", WD: "#F59E0B", Matcha: "#8B5CF6",
  DS: "#EC4899", VS: "#FB7185", CS: "#F97316", GR: "#14B8A6", GS: "#A855F7",
};
const MONTHS_LABELS = FORECAST_MONTHS.map(m => m.label);
const SHORT_LABELS = FORECAST_MONTHS.map(m => `${m.label.slice(0, 3)} ${m.label.slice(-2)}`);

declare global { interface Window { Chart: any } }

function uid() { return Math.random().toString(36).slice(2, 9); }

function loadSim(): SimState {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : { accounts: [] }; }
  catch { return { accounts: [] }; }
}
function saveSim(s: SimState) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

function blankStore(): SimStore {
  const vels: Record<string, number> = {};
  SKUS.forEach(s => vels[s] = 0);
  return { name: "Store 1", skuVelocities: vels };
}
function blankAccount(): SimAccount {
  return { id: uid(), name: "", stores: [blankStore()], entryMonth: MONTHS_LABELS[0], active: true };
}

// Cases a single store adds per month for a sku
function storeCases(vel: number): number {
  if (vel <= 0) return 0;
  return Math.round(vel * WEEKS_PER_MONTH / UNITS_PER_CASE);
}

// ─── Component ────────────────────────────────────────────────────────────────
export function SimulatorTab({ baseForecast }: {
  baseForecast: { label: string; totalCases: number }[];
}) {
  const [sim, setSim] = useState<SimState>(loadSim);
  const [editingId, setEditingId] = useState<string | null>(null);
  const skuChartRef = useRef<HTMLCanvasElement>(null);
  const revChartRef = useRef<HTMLCanvasElement>(null);

  // Persist on change
  useEffect(() => { saveSim(sim); }, [sim]);

  const updateSim = useCallback((fn: (s: SimState) => SimState) => setSim(prev => fn(prev)), []);

  // ── Compute incremental cases by month × sku from sim accounts ──
  const { simBySkuMonth, simTotalByMonth } = useMemo(() => {
    const bySkuMonth: Record<string, number[]> = {};
    SKUS.forEach(sku => bySkuMonth[sku] = new Array(MONTHS_LABELS.length).fill(0));
    const totalByMonth = new Array(MONTHS_LABELS.length).fill(0);

    for (const acct of sim.accounts) {
      if (!acct.active) continue;
      const entryIdx = MONTHS_LABELS.indexOf(acct.entryMonth);
      if (entryIdx < 0) continue;
      for (const store of acct.stores) {
        for (const sku of SKUS) {
          const vel = store.skuVelocities[sku] ?? 0;
          if (vel <= 0) continue;
          const cases = storeCases(vel);
          for (let mi = entryIdx; mi < MONTHS_LABELS.length; mi++) {
            // Ramp: 40% first month, 70% second, 100% after
            const monthsIn = mi - entryIdx;
            const ramp = monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0;
            const adj = Math.round(cases * ramp);
            bySkuMonth[sku][mi] += adj;
            totalByMonth[mi] += adj;
          }
        }
      }
    }
    return { simBySkuMonth: bySkuMonth, simTotalByMonth: totalByMonth };
  }, [sim]);

  // ── Base forecast by month (from the By SKU tab data) ──
  const baseTotalByMonth = useMemo(() =>
    MONTHS_LABELS.map(label => {
      const row = baseForecast.find(f => f.label === label);
      return row?.totalCases ?? 0;
    }), [baseForecast]);

  // Combined totals
  const combinedTotalByMonth = useMemo(() =>
    baseTotalByMonth.map((b, i) => b + simTotalByMonth[i]), [baseTotalByMonth, simTotalByMonth]);

  // Revenue = cases × PRICE_PER_CASE
  const baseRevByMonth = useMemo(() => baseTotalByMonth.map(c => c * PRICE_PER_CASE), [baseTotalByMonth]);
  const combinedRevByMonth = useMemo(() => combinedTotalByMonth.map(c => c * PRICE_PER_CASE), [combinedTotalByMonth]);
  const simRevByMonth = useMemo(() => simTotalByMonth.map(c => c * PRICE_PER_CASE), [simTotalByMonth]);

  // ── Charts ──
  useEffect(() => {
    if (!skuChartRef.current || !window.Chart) return;
    const existing = (skuChartRef.current as any)._chart;
    if (existing) existing.destroy();

    // Stacked bar: base cases + sim delta by sku
    const datasets = [
      { label: "Base forecast", data: baseTotalByMonth, backgroundColor: "rgba(28,35,64,0.35)", stack: "main", borderRadius: 2 },
      ...SKUS.filter(sku => simBySkuMonth[sku].some(v => v > 0)).map(sku => ({
        label: `+ ${sku}`, data: simBySkuMonth[sku], backgroundColor: SKU_COLORS[sku] ?? "#666", stack: "main", borderRadius: 2,
      })),
    ];
    const chart = new window.Chart(skuChartRef.current, {
      type: "bar",
      data: { labels: SHORT_LABELS, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "bottom" as const, labels: { usePointStyle: true, pointStyle: "rectRounded", font: { size: 10 } } } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } },
          y: { stacked: true, ticks: { callback: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v, font: { size: 9 } }, grid: { color: "rgba(0,0,0,0.05)" } },
        },
      },
    });
    (skuChartRef.current as any)._chart = chart;
    return () => chart.destroy();
  }, [baseTotalByMonth, simBySkuMonth]);

  useEffect(() => {
    if (!revChartRef.current || !window.Chart) return;
    const existing = (revChartRef.current as any)._chart;
    if (existing) existing.destroy();
    const chart = new window.Chart(revChartRef.current, {
      type: "bar",
      data: {
        labels: SHORT_LABELS,
        datasets: [
          { label: "Base revenue", data: baseRevByMonth, backgroundColor: "rgba(28,35,64,0.3)", stack: "rev", borderRadius: 2 },
          { label: "Sim Δ revenue", data: simRevByMonth, backgroundColor: "rgba(163,34,74,0.7)", stack: "rev", borderRadius: 2 },
          { type: "line", label: "Combined", data: combinedRevByMonth, borderColor: "#1C2340", borderWidth: 2, pointRadius: 2, fill: false, tension: 0.3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: true, position: "bottom" as const, labels: { usePointStyle: true, pointStyle: "rectRounded", font: { size: 10 } } } },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } },
          y: { stacked: true, ticks: { callback: (v: number) => `$${(v / 1000).toFixed(0)}K`, font: { size: 9 } }, grid: { color: "rgba(0,0,0,0.05)" } },
        },
      },
    });
    (revChartRef.current as any)._chart = chart;
    return () => chart.destroy();
  }, [baseRevByMonth, simRevByMonth, combinedRevByMonth]);

  // ── Totals for summary cards ──
  const totalSimCases = simTotalByMonth.reduce((a, b) => a + b, 0);
  const totalSimRev = totalSimCases * PRICE_PER_CASE;
  const totalBaseCases = baseTotalByMonth.reduce((a, b) => a + b, 0);
  const totalCombinedCases = totalBaseCases + totalSimCases;
  const totalCombinedRev = totalCombinedCases * PRICE_PER_CASE;

  // ── Account editor ──
  function AccountCard({ acct }: { acct: SimAccount }) {
    const isEditing = editingId === acct.id;
    const totalAddedCases = useMemo(() => {
      if (!acct.active) return 0;
      const entryIdx = MONTHS_LABELS.indexOf(acct.entryMonth);
      if (entryIdx < 0) return 0;
      let total = 0;
      for (const store of acct.stores) {
        for (const sku of SKUS) {
          const vel = store.skuVelocities[sku] ?? 0;
          if (vel <= 0) continue;
          const c = storeCases(vel);
          for (let mi = entryIdx; mi < MONTHS_LABELS.length; mi++) {
            const monthsIn = mi - entryIdx;
            total += Math.round(c * (monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0));
          }
        }
      }
      return total;
    }, [acct]);

    const update = (fn: (a: SimAccount) => SimAccount) =>
      updateSim(s => ({ ...s, accounts: s.accounts.map(a => a.id === acct.id ? fn(a) : a) }));

    return (
      <div className={`rounded-2xl border bg-card shadow-sm overflow-hidden transition-all ${acct.active ? "border-border" : "border-border/50 opacity-60"}`}>
        <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border">
          <button onClick={() => update(a => ({ ...a, active: !a.active }))}
            className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold border transition-colors ${acct.active ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white border-gray-300 text-transparent"}`}>
            ✓
          </button>
          {isEditing ? (
            <input value={acct.name} onChange={e => update(a => ({ ...a, name: e.target.value }))}
              className="flex-1 bg-white border border-border rounded px-2 py-1 text-sm font-semibold" placeholder="Account name" autoFocus />
          ) : (
            <span className="flex-1 text-sm font-semibold" style={{ color: "#1C2340" }}>{acct.name || "New Account"}</span>
          )}
          <span className="text-xs text-muted-foreground font-mono">+{totalAddedCases.toLocaleString()} cases</span>
          <span className="text-xs text-muted-foreground font-mono">+${Math.round(totalAddedCases * PRICE_PER_CASE / 1000)}K</span>
          <button onClick={() => setEditingId(isEditing ? null : acct.id)}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors">
            {isEditing ? "Done" : "Edit"}
          </button>
          <button onClick={() => updateSim(s => ({ ...s, accounts: s.accounts.filter(a => a.id !== acct.id) }))}
            className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors">✕</button>
        </div>
        {isEditing && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-xs font-semibold text-muted-foreground">Entry month</label>
              <select value={acct.entryMonth} onChange={e => update(a => ({ ...a, entryMonth: e.target.value }))}
                className="text-xs border border-border rounded px-2 py-1 bg-white">
                {MONTHS_LABELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {acct.stores.map((store, si) => (
              <div key={si} className="rounded-xl border border-border/60 p-3 space-y-2 bg-muted/10">
                <div className="flex items-center gap-2">
                  <input value={store.name} onChange={e => update(a => {
                    const stores = [...a.stores]; stores[si] = { ...stores[si], name: e.target.value }; return { ...a, stores };
                  })} className="text-xs font-semibold bg-white border border-border rounded px-2 py-1 w-40" placeholder="Store/chain name" />
                  {acct.stores.length > 1 && (
                    <button onClick={() => update(a => ({ ...a, stores: a.stores.filter((_, i) => i !== si) }))}
                      className="text-xs text-red-400 hover:text-red-600">Remove</button>
                  )}
                </div>
                <div className="grid grid-cols-6 gap-2">
                  {SKUS.map(sku => (
                    <div key={sku} className="flex flex-col items-center gap-0.5">
                      <span className="text-[10px] font-semibold" style={{ color: SKU_COLORS[sku] }}>{sku}</span>
                      <input type="number" step="0.1" min="0"
                        value={store.skuVelocities[sku] ?? 0}
                        onChange={e => update(a => {
                          const stores = [...a.stores];
                          const vels = { ...stores[si].skuVelocities, [sku]: parseFloat(e.target.value) || 0 };
                          stores[si] = { ...stores[si], skuVelocities: vels };
                          return { ...a, stores };
                        })}
                        className="w-full text-center text-xs font-mono border border-border rounded px-1 py-1 bg-white"
                        title={`${sku} velocity (units/store/week)`} />
                      <span className="text-[9px] text-muted-foreground">u/s/w</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={() => update(a => ({ ...a, stores: [...a.stores, blankStore()] }))}
              className="text-xs px-3 py-1.5 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors">
              + Add store / chain
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Base forecast (cases)", value: totalBaseCases.toLocaleString(), color: "#1C2340" },
          { label: "Sim Δ cases", value: `+${totalSimCases.toLocaleString()}`, color: "#A3224A" },
          { label: "Combined cases", value: totalCombinedCases.toLocaleString(), color: "#1C2340" },
          { label: "Combined revenue", value: `$${(totalCombinedRev / 1e6).toFixed(2)}M`, color: "#10B981" },
        ].map((k, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">{k.label}</p>
            <p className="text-xl font-bold font-mono" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
        🧪 <strong>Simulador</strong> — agrega accounts hipotéticos para ver cómo impactarían en el forecast. Todo vive en localStorage.
        <br />Velocity = units/store/week · Ramp: 40% M1, 70% M2, 100% M3+
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-bold mb-3" style={{ color: "#1C2340" }}>Sales by SKU by Month (cases)</h3>
          <div style={{ height: 320 }}><canvas ref={skuChartRef} /></div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <h3 className="text-sm font-bold mb-3" style={{ color: "#1C2340" }}>Monthly Revenue ($)</h3>
          <div style={{ height: 320 }}><canvas ref={revChartRef} /></div>
        </div>
      </div>

      {/* Accounts list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold" style={{ color: "#1C2340" }}>Simulated Accounts ({sim.accounts.length})</h3>
          <div className="flex gap-2">
            {sim.accounts.length > 0 && (
              <button onClick={() => { if (confirm("Clear all simulated accounts?")) setSim({ accounts: [] }); }}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                Clear all
              </button>
            )}
            <button onClick={() => updateSim(s => ({ ...s, accounts: [...s.accounts, blankAccount()] }))}
              className="text-xs px-3 py-1.5 rounded-lg text-white font-semibold shadow-sm hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "#A3224A" }}>
              + New Account
            </button>
          </div>
        </div>
        {sim.accounts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">No simulated accounts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Click <strong>+ New Account</strong> to model a new retail account entering the portfolio.</p>
          </div>
        )}
        {sim.accounts.map(acct => <AccountCard key={acct.id} acct={acct} />)}
      </div>
    </div>
  );
}
