import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { EXTENDED_SKUS } from "@/lib/sales-database";
import { PRICE_PER_CASE, WEEKS_PER_MONTH, UNITS_PER_CASE, FORECAST_MONTHS } from "@/lib/sales-forecast";

// ─── Types ────────────────────────────────────────────────────────────────────
type SimAccount = {
  id: string; name: string; storeCount: number;
  skuVelocities: Record<string, number>; // units/store/week; 0 = SKU not selected
  entryMonth: string; active: boolean;
};
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
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { accounts: [] };
    const parsed = JSON.parse(raw);
    // Migrate old format (stores[]) → new flat format
    if (parsed.accounts) {
      parsed.accounts = parsed.accounts.map((a: any) => {
        if (a.storeCount !== undefined) return a; // already new format
        // Old format had stores: SimStore[]
        const firstStore = a.stores?.[0];
        return {
          id: a.id, name: a.name, entryMonth: a.entryMonth, active: a.active,
          storeCount: 0,
          skuVelocities: firstStore?.skuVelocities ?? Object.fromEntries(SKUS.map(s => [s, 0])),
        };
      });
    }
    return parsed;
  } catch { return { accounts: [] }; }
}
function saveSim(s: SimState) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

function blankAccount(): SimAccount {
  return {
    id: uid(), name: "", storeCount: 0,
    skuVelocities: Object.fromEntries(SKUS.map(s => [s, 0])),
    entryMonth: MONTHS_LABELS[0], active: true,
  };
}

// cases/month for one SKU = stores × vel(units/store/week) × weeks/month ÷ units/case
function skuCasesPerMonth(stores: number, vel: number): number {
  if (stores <= 0 || vel <= 0) return 0;
  return Math.round(stores * vel * WEEKS_PER_MONTH / UNITS_PER_CASE);
}

// ─── Component ────────────────────────────────────────────────────────────────
export function SimulatorTab({ baseForecast, dbSkuByMonth }: {
  baseForecast: { label: string; totalCases: number }[];
  dbSkuByMonth?: Record<string, Record<string, number>>;
}) {
  const [sim, setSim] = useState<SimState>(loadSim);
  const [editingId, setEditingId] = useState<string | null>(null);
  const skuChartRef = useRef<HTMLCanvasElement>(null);
  const revChartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { saveSim(sim); }, [sim]);
  const updateSim = useCallback((fn: (s: SimState) => SimState) => setSim(prev => fn(prev)), []);

  // ── Sim incremental cases by month × sku ──
  const { simBySkuMonth, simTotalByMonth } = useMemo(() => {
    const bySkuMonth: Record<string, number[]> = {};
    SKUS.forEach(sku => bySkuMonth[sku] = new Array(MONTHS_LABELS.length).fill(0));
    const totalByMonth = new Array(MONTHS_LABELS.length).fill(0);

    for (const acct of sim.accounts) {
      if (!acct.active || acct.storeCount <= 0) continue;
      const entryIdx = MONTHS_LABELS.indexOf(acct.entryMonth);
      if (entryIdx < 0) continue;
      for (const sku of SKUS) {
        const vel = acct.skuVelocities[sku] ?? 0;
        if (vel <= 0) continue;
        const fullCases = skuCasesPerMonth(acct.storeCount, vel);
        for (let mi = entryIdx; mi < MONTHS_LABELS.length; mi++) {
          const monthsIn = mi - entryIdx;
          const ramp = monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0;
          const adj = Math.round(fullCases * ramp);
          bySkuMonth[sku][mi] += adj;
          totalByMonth[mi] += adj;
        }
      }
    }
    return { simBySkuMonth: bySkuMonth, simTotalByMonth: totalByMonth };
  }, [sim]);

  const baseTotalByMonth = useMemo(() =>
    MONTHS_LABELS.map(label => baseForecast.find(f => f.label === label)?.totalCases ?? 0), [baseForecast]);

  const baseBySkuMonth = useMemo(() => {
    const out: Record<string, number[]> = {};
    SKUS.forEach(sku => {
      out[sku] = MONTHS_LABELS.map(label => Math.round(dbSkuByMonth?.[label]?.[sku] ?? 0));
    });
    return out;
  }, [dbSkuByMonth]);

  const combinedBySkuMonth = useMemo(() => {
    const out: Record<string, number[]> = {};
    SKUS.forEach(sku => {
      out[sku] = MONTHS_LABELS.map((_, i) => (baseBySkuMonth[sku]?.[i] ?? 0) + (simBySkuMonth[sku]?.[i] ?? 0));
    });
    return out;
  }, [baseBySkuMonth, simBySkuMonth]);

  const combinedTotalByMonth = useMemo(() =>
    baseTotalByMonth.map((b, i) => b + simTotalByMonth[i]), [baseTotalByMonth, simTotalByMonth]);

  const baseRevByMonth = useMemo(() => baseTotalByMonth.map(c => c * PRICE_PER_CASE), [baseTotalByMonth]);
  const combinedRevByMonth = useMemo(() => combinedTotalByMonth.map(c => c * PRICE_PER_CASE), [combinedTotalByMonth]);
  const simRevByMonth = useMemo(() => simTotalByMonth.map(c => c * PRICE_PER_CASE), [simTotalByMonth]);

  // ── Charts ──
  useEffect(() => {
    if (!skuChartRef.current || !window.Chart) return;
    const existing = (skuChartRef.current as any)._chart;
    if (existing) existing.destroy();
    const datasets = [
      { label: "Base forecast", data: baseTotalByMonth, backgroundColor: "rgba(28,35,64,0.35)", stack: "main", borderRadius: 2 },
      ...SKUS.filter(sku => simBySkuMonth[sku].some(v => v > 0)).map(sku => ({
        label: `+ ${sku}`, data: simBySkuMonth[sku], backgroundColor: SKU_COLORS[sku] ?? "#666", stack: "main", borderRadius: 2,
      })),
    ];
    const chart = new window.Chart(skuChartRef.current, {
      type: "bar", data: { labels: SHORT_LABELS, datasets },
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

  // ── Summary totals ──
  const totalSimCases = simTotalByMonth.reduce((a, b) => a + b, 0);
  const totalBaseCases = baseTotalByMonth.reduce((a, b) => a + b, 0);
  const totalCombinedCases = totalBaseCases + totalSimCases;
  const totalCombinedRev = totalCombinedCases * PRICE_PER_CASE;

  // ── SKU table ──
  const skuTableData = useMemo(() => SKUS.map(sku => {
    const months = combinedBySkuMonth[sku];
    const total = months.reduce((a, b) => a + b, 0);
    return { sku, months, total };
  }), [combinedBySkuMonth]);
  const grandTotal = combinedTotalByMonth.reduce((a, b) => a + b, 0);
  const hasSim = totalSimCases > 0;

  // ── Account card ──
  function AccountCard({ acct }: { acct: SimAccount }) {
    const isEditing = editingId === acct.id;
    const selectedSkus = SKUS.filter(s => (acct.skuVelocities[s] ?? 0) > 0);

    const totalAddedCases = useMemo(() => {
      if (!acct.active || acct.storeCount <= 0) return 0;
      const entryIdx = MONTHS_LABELS.indexOf(acct.entryMonth);
      if (entryIdx < 0) return 0;
      let total = 0;
      for (const sku of SKUS) {
        const vel = acct.skuVelocities[sku] ?? 0;
        if (vel <= 0) continue;
        const full = skuCasesPerMonth(acct.storeCount, vel);
        for (let mi = entryIdx; mi < MONTHS_LABELS.length; mi++) {
          const monthsIn = mi - entryIdx;
          total += Math.round(full * (monthsIn === 0 ? 0.4 : monthsIn === 1 ? 0.7 : 1.0));
        }
      }
      return total;
    }, [acct]);

    const update = (fn: (a: SimAccount) => SimAccount) =>
      updateSim(s => ({ ...s, accounts: s.accounts.map(a => a.id === acct.id ? fn(a) : a) }));

    const toggleSku = (sku: string) => {
      update(a => {
        const vels = { ...a.skuVelocities };
        vels[sku] = vels[sku] > 0 ? 0 : 1; // toggle: off → default 1 u/s/w
        return { ...a, skuVelocities: vels };
      });
    };

    return (
      <div className={`rounded-2xl border bg-card shadow-sm overflow-hidden transition-all ${acct.active ? "border-border" : "border-border/50 opacity-60"}`}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border">
          <button onClick={() => update(a => ({ ...a, active: !a.active }))}
            className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold border transition-colors ${acct.active ? "bg-emerald-500 border-emerald-500 text-white" : "bg-white border-gray-300 text-transparent"}`}>
            ✓
          </button>
          {isEditing ? (
            <input value={acct.name} onChange={e => update(a => ({ ...a, name: e.target.value }))}
              className="flex-1 bg-white border border-border rounded px-2 py-1 text-sm font-semibold" placeholder="Account name (e.g. Publix)" autoFocus />
          ) : (
            <span className="flex-1 text-sm font-semibold" style={{ color: "#1C2340" }}>{acct.name || "New Account"}</span>
          )}
          <span className="text-xs text-muted-foreground">{acct.storeCount} stores</span>
          <span className="text-xs font-mono" style={{ color: "#A3224A" }}>+{totalAddedCases.toLocaleString()} cases</span>
          <span className="text-xs font-mono text-muted-foreground">+${Math.round(totalAddedCases * PRICE_PER_CASE / 1000)}K</span>
          <button onClick={() => setEditingId(isEditing ? null : acct.id)}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted transition-colors">
            {isEditing ? "Done" : "Edit"}
          </button>
          <button onClick={() => updateSim(s => ({ ...s, accounts: s.accounts.filter(a => a.id !== acct.id) }))}
            className="text-xs px-2 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 transition-colors">✕</button>
        </div>

        {/* Collapsed summary */}
        {!isEditing && selectedSkus.length > 0 && (
          <div className="px-4 py-2 flex gap-2 flex-wrap">
            {selectedSkus.map(sku => (
              <span key={sku} className="inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 border border-border">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SKU_COLORS[sku] }} />
                {sku}: {acct.skuVelocities[sku]} u/s/w → {skuCasesPerMonth(acct.storeCount, acct.skuVelocities[sku]).toLocaleString()} cases/mo
              </span>
            ))}
          </div>
        )}

        {/* Editor */}
        {isEditing && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Stores</label>
                <input type="number" min="0" value={acct.storeCount}
                  onChange={e => update(a => ({ ...a, storeCount: parseInt(e.target.value) || 0 }))}
                  className="w-24 text-sm font-mono border border-border rounded px-2 py-1 bg-white" placeholder="100" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-muted-foreground">Entry month</label>
                <select value={acct.entryMonth} onChange={e => update(a => ({ ...a, entryMonth: e.target.value }))}
                  className="text-xs border border-border rounded px-2 py-1 bg-white">
                  {MONTHS_LABELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>

            {/* SKU selector + velocity */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">SKUs & Velocity (units/store/week)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {SKUS.map(sku => {
                  const vel = acct.skuVelocities[sku] ?? 0;
                  const isOn = vel > 0;
                  const casesMonth = skuCasesPerMonth(acct.storeCount, vel);
                  return (
                    <div key={sku}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${isOn ? "border-border bg-white" : "border-border/40 bg-muted/20"}`}>
                      <button onClick={() => toggleSku(sku)}
                        className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold border transition-colors ${isOn ? "text-white" : "bg-white border-gray-300 text-transparent"}`}
                        style={isOn ? { backgroundColor: SKU_COLORS[sku], borderColor: SKU_COLORS[sku] } : {}}>
                        ✓
                      </button>
                      <span className="text-xs font-bold w-12" style={{ color: SKU_COLORS[sku] }}>{sku}</span>
                      {isOn ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input type="number" step="0.1" min="0.1" value={vel}
                            onChange={e => update(a => ({
                              ...a, skuVelocities: { ...a.skuVelocities, [sku]: Math.max(0, parseFloat(e.target.value) || 0) }
                            }))}
                            className="w-16 text-center text-xs font-mono border border-border rounded px-1 py-1 bg-white" />
                          <span className="text-[10px] text-muted-foreground">u/s/w</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">→</span>
                          <span className="text-xs font-mono font-semibold" style={{ color: "#1C2340" }}>{casesMonth.toLocaleString()}</span>
                          <span className="text-[10px] text-muted-foreground">cases/mo</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">off</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick totals */}
            {selectedSkus.length > 0 && acct.storeCount > 0 && (
              <div className="rounded-lg bg-muted/30 border border-border/50 px-4 py-2 text-xs">
                <span className="font-semibold" style={{ color: "#1C2340" }}>
                  Total at full ramp: {selectedSkus.reduce((s, sku) => s + skuCasesPerMonth(acct.storeCount, acct.skuVelocities[sku]), 0).toLocaleString()} cases/month
                </span>
                <span className="text-muted-foreground ml-3">
                  ≈ ${Math.round(selectedSkus.reduce((s, sku) => s + skuCasesPerMonth(acct.storeCount, acct.skuVelocities[sku]), 0) * PRICE_PER_CASE / 1000)}K/mo revenue
                </span>
              </div>
            )}
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

      {/* Accounts list — ABOVE charts so you edit first, then see impact */}
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
            <button onClick={() => { const a = blankAccount(); updateSim(s => ({ ...s, accounts: [...s.accounts, a] })); setEditingId(a.id); }}
              className="text-xs px-3 py-1.5 rounded-lg text-white font-semibold shadow-sm hover:opacity-90 transition-opacity"
              style={{ backgroundColor: "#A3224A" }}>
              + New Account
            </button>
          </div>
        </div>
        {sim.accounts.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">No simulated accounts yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Click <strong>+ New Account</strong> to model a new retail account.</p>
          </div>
        )}
        {sim.accounts.map(acct => <AccountCard key={acct.id} acct={acct} />)}
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

      {/* SKU × Month table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm">
        <div className="px-5 py-3 border-b border-border flex items-center gap-3">
          <h3 className="text-sm font-bold" style={{ color: "#1C2340" }}>Combined Forecast by SKU</h3>
          {hasSim && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: "rgba(163,34,74,0.1)", color: "#A3224A" }}>includes sim Δ</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-max">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
                <th className="px-4 py-2.5 text-left sticky left-0 bg-muted/40 z-10">SKU</th>
                <th className="px-4 py-2.5 text-center">Mix</th>
                {MONTHS_LABELS.map(m => (
                  <th key={m} className="px-3 py-2.5 text-right w-16">{m.slice(0, 3).toUpperCase()} {m.slice(-2)}</th>
                ))}
                <th className="px-4 py-2.5 text-right font-bold">Total</th>
              </tr>
            </thead>
            <tbody>
              {skuTableData.map(s => {
                const hasSimForSku = simBySkuMonth[s.sku]?.some(v => v > 0);
                return (
                  <tr key={s.sku} className="border-t border-border/60 hover:bg-muted/20">
                    <td className="px-4 py-1.5 font-semibold sticky left-0 bg-card z-10">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: SKU_COLORS[s.sku] }} />
                        {s.sku}
                        {hasSimForSku && <span className="text-[9px] text-amber-600">+sim</span>}
                      </div>
                    </td>
                    <td className="px-4 py-1.5 text-center text-muted-foreground">{grandTotal > 0 ? Math.round(s.total / grandTotal * 100) : 0}%</td>
                    {s.months.map((v, i) => {
                      const simV = simBySkuMonth[s.sku]?.[i] ?? 0;
                      return (
                        <td key={i} className={`px-3 py-1.5 text-right font-mono ${simV > 0 ? "font-semibold" : ""}`}
                          style={simV > 0 ? { color: "#A3224A" } : undefined}
                          title={simV > 0 ? `Base: ${v - simV} + Sim: ${simV}` : undefined}>
                          {v > 0 ? v.toLocaleString() : "0"}
                        </td>
                      );
                    })}
                    <td className="px-4 py-1.5 text-right font-mono font-bold">{s.total.toLocaleString()}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border font-bold" style={{ backgroundColor: "#1C2340", color: "#fff" }}>
                <td className="px-4 py-2 sticky left-0 z-10" style={{ backgroundColor: "#1C2340" }}>TOTAL</td>
                <td className="px-4 py-2 text-center">100%</td>
                {combinedTotalByMonth.map((v, i) => (
                  <td key={i} className="px-3 py-2 text-right font-mono">{v.toLocaleString()}</td>
                ))}
                <td className="px-4 py-2 text-right font-mono">{grandTotal.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
