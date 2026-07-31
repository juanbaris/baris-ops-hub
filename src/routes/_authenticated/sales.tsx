import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── All forecast data from Excel ─────────────────────────────────────────────
const PRICE_PER_CASE = 37;
const SEASON_IDX: Record<number, number> = {
  1:0.21, 2:1.40, 3:1.39, 4:1.64, 5:0.72, 6:1.47,
  7:0.68, 8:0.65, 9:1.48, 10:0.76, 11:0.26, 12:1.33
};
const GROWTH = { Pesimista: 0.50, Normal: 0.75, Optimista: 1.20 };
const IMPLIED_ANNUAL_2026 = 62113;

// Forecast period: Aug 2026 (month 8) → Jul 2027 (month 7)
const FORECAST_MONTHS = [
  { label:"Ago 2026", month:8,  year:2026, yoy2025:2690  },
  { label:"Sep 2026", month:9,  year:2026, yoy2025:2728  },
  { label:"Oct 2026", month:10, year:2026, yoy2025:1386  },
  { label:"Nov 2026", month:11, year:2026, yoy2025:489   },
  { label:"Dic 2026", month:12, year:2026, yoy2025:2452  },
  { label:"Ene 2027", month:1,  year:2027, yoy2025:388   },
  { label:"Feb 2027", month:2,  year:2027, yoy2025:2582  },
  { label:"Mar 2027", month:3,  year:2027, yoy2025:2562  },
  { label:"Abr 2027", month:4,  year:2027, yoy2025:3021  },
  { label:"May 2027", month:5,  year:2027, yoy2025:1314  },
  { label:"Jun 2027", month:6,  year:2027, yoy2025:2710  },
  { label:"Jul 2027", month:7,  year:2027, yoy2025:1242  },
];

const HISTORICAL = [
  { label:"May 2026", cases:7972,  revenue:294358, type:"real" },
  { label:"Jun 2026", cases:5791,  revenue:212494, type:"real" },
  { label:"Jul 2026", cases:7656,  revenue:277626, type:"real" },
];

const SKU_MIX = [
  { sku:"XD",     pct:0.30 },
  { sku:"PW",     pct:0.25 },
  { sku:"HM",     pct:0.18 },
  { sku:"WM",     pct:0.12 },
  { sku:"WD",     pct:0.08 },
  { sku:"Matcha", pct:0.07 },
];

const DIST_MIX = [
  { dist:"KeHE",       pct:0.55, color:"#A3224A" },
  { dist:"UNFI",       pct:0.28, color:"#1C2340" },
  { dist:"Rainforest", pct:0.10, color:"#3B82F6" },
  { dist:"RFD/Other",  pct:0.07, color:"#9CA3AF" },
];

const VELOCITY_DATA = [
  { chain:"Sprouts",    stores:404, vel_t4w:1.39, vel_lw:1.2  },
  { chain:"Whole Foods",stores:60,  vel_t4w:8.09, vel_lw:9.4  },
  { chain:"GoPuff",     stores:80,  vel_t4w:2.84, vel_lw:2.1  },
  { chain:"Kowalski",   stores:10,  vel_t4w:6.58, vel_lw:6.3  },
  { chain:"INFRA",      stores:41,  vel_t4w:2.15, vel_lw:2.0  },
];

function calcForecast(scenario: "Pesimista"|"Normal"|"Optimista", velOverride: boolean, newAcct: boolean, newAcctConfig: any) {
  const growth = GROWTH[scenario];
  const base = IMPLIED_ANNUAL_2026 * (1 + growth);
  return FORECAST_MONTHS.map(m => {
    const baseCases = Math.round((base / 12) * SEASON_IDX[m.month]);
    let velDelta = 0;
    let acctDelta = 0;
    if (velOverride && newAcctConfig.velStores > 0) {
      const wksPerMonth = 4.33;
      const unitPerCase = 8;
      velDelta = Math.round((newAcctConfig.velNew - newAcctConfig.velCurrent) * newAcctConfig.velStores * wksPerMonth / unitPerCase);
    }
    if (newAcct && newAcctConfig.acctStores > 0) {
      const idx = FORECAST_MONTHS.indexOf(m) - (newAcctConfig.acctEntry - 1);
      if (idx >= 0) {
        const ramp = idx === 0 ? 0.4 : idx === 1 ? 0.7 : 1.0;
        acctDelta = Math.round(newAcctConfig.acctStores * newAcctConfig.acctVel * 4.33 / 8 * ramp);
      }
    }
    const total = baseCases + velDelta + acctDelta;
    return {
      ...m,
      baseCases,
      velDelta,
      acctDelta,
      totalCases: total,
      revenue: Math.round(total * PRICE_PER_CASE),
      budget: Math.round((IMPLIED_ANNUAL_2026 * (1 + GROWTH.Normal) / 12) * SEASON_IDX[m.month] * PRICE_PER_CASE),
    };
  });
}

type SalesTab = "resumen"|"detalle"|"sku"|"distribuidor"|"simulador"|"estacionalidad"|"real";

declare global { interface Window { Chart: any } }
function useChart(ref: React.RefObject<HTMLCanvasElement | null>, builder: () => any, deps: any[]) {
  const chartRef = useRef<any>(null);
  useEffect(() => {
    if (!ref.current || !window.Chart) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new window.Chart(ref.current, builder());
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, deps);
}

// ─── Resumen Tab ──────────────────────────────────────────────────────────────
function ResumenTab({ forecast, scenario, reals }: { forecast: any[]; scenario: string; reals: Record<string, number> }) {
  const mainCanvas = useRef<HTMLCanvasElement | null>(null);
  const distCanvas = useRef<HTMLCanvasElement | null>(null);

  const allMonths = [...HISTORICAL.map(h => h.label), ...forecast.map(f => f.label)];
  const realVals = [...HISTORICAL.map(h => h.cases), ...forecast.map(f => reals[f.label] ?? null)];
  const fcstVals = [...HISTORICAL.map(() => null), ...forecast.map(f => reals[f.label] ?? f.totalCases)];
  const budgetVals = [...HISTORICAL.map(() => null), ...forecast.map(f => f.budget / PRICE_PER_CASE)];

  useChart(mainCanvas, () => ({
    type: "bar",
    data: {
      labels: allMonths,
      datasets: [
        { label:"Real", data:realVals, backgroundColor:"#A3224A", borderRadius:3 },
        { label:"Forecast", data:fcstVals, backgroundColor:"rgba(163,34,74,0.35)", borderRadius:3 },
        { type:"line", label:"Budget", data:budgetVals, borderColor:"#9CA3AF", borderDash:[4,3], pointRadius:3, fill:false },
      ]
    },
    options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:"bottom", labels:{ boxWidth:12, font:{ size:11 } } } },
      scales:{ y:{ ticks:{ callback:(v:number) => v.toLocaleString() } } } }
  }), [forecast, reals]);

  const totalFcst = forecast.reduce((s, f) => s + f.totalCases, 0);
  const totalRevFcst = forecast.reduce((s, f) => s + f.revenue, 0);
  const totalBudget = forecast.reduce((s, f) => s + f.budget, 0);
  const coveredMonths = forecast.filter(f => reals[f.label] != null).length;

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label:"Forecast 12m (casos)", value:totalFcst.toLocaleString(), sub:`Escenario ${scenario}`, color:"#A3224A" },
          { label:"Revenue forecast 12m", value:`$${Math.round(totalRevFcst/1000)}K`, sub:`@$${PRICE_PER_CASE}/case`, color:"#1C2340" },
          { label:"vs Budget", value:`${((totalFcst/(totalBudget/PRICE_PER_CASE)-1)*100).toFixed(1)}%`, sub:"Normal baseline", color: totalFcst >= totalBudget/PRICE_PER_CASE ? "#10B981" : "#EF4444" },
          { label:"Meses con real cargado", value:`${coveredMonths}/12`, sub:"Actualizar mensualmente", color:"#6B7280" },
        ].map((k,i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">{k.label}</p>
            <p className="text-2xl font-bold font-mono" style={{color:k.color}}>{k.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Main chart */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold" style={{color:"#1C2340"}}>Forecast vs Budget vs Real · Ago 2026 → Jul 2027</h3>
            <p className="text-xs text-muted-foreground">Casos por mes · escenario {scenario}</p>
          </div>
        </div>
        <div style={{height:280}}><canvas ref={mainCanvas} /></div>
      </div>

      {/* Distributor breakdown */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>Revenue proyectado por distribuidor</h3>
        <div className="space-y-3">
          {DIST_MIX.map(d => {
            const rev = Math.round(totalRevFcst * d.pct);
            return (
              <div key={d.dist}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium">{d.dist}</span>
                  <span className="font-mono font-semibold">${Math.round(rev/1000)}K · {Math.round(d.pct*100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full" style={{width:`${d.pct*100}%`, backgroundColor:d.color}} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Detalle Tab ──────────────────────────────────────────────────────────────
function DetalleTab({ forecast, reals, onRealUpdate }: { forecast: any[]; reals: Record<string, number>; onRealUpdate: (label: string, val: number) => void }) {
  const [editing, setEditing] = useState<string|null>(null);
  const [editVal, setEditVal] = useState("");

  const totalFcst = forecast.reduce((s,f) => s + f.totalCases, 0);
  const totalBudget = forecast.reduce((s,f) => s + f.budget/PRICE_PER_CASE, 0);
  const totalReal = Object.values(reals).reduce((s,v) => s + v, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        💡 Click en <strong>Real casos</strong> de cualquier mes para cargar el real cuando cierre el mes. Todo se recalcula automáticamente.
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <th className="px-4 py-2.5 text-left">Mes</th>
              <th className="px-4 py-2.5 text-left">Tipo</th>
              <th className="px-4 py-2.5 text-right">Casos base</th>
              <th className="px-4 py-2.5 text-right">Δ vel.</th>
              <th className="px-4 py-2.5 text-right">Δ nueva cta</th>
              <th className="px-4 py-2.5 text-right font-bold">TOTAL CASOS</th>
              <th className="px-4 py-2.5 text-right">Revenue fcst</th>
              <th className="px-4 py-2.5 text-right">Budget</th>
              <th className="px-4 py-2.5 text-right">Δ vs Budget</th>
              <th className="px-4 py-2.5 text-right">REAL casos</th>
              <th className="px-4 py-2.5 text-right">Δ real vs fcst</th>
              <th className="px-4 py-2.5 text-right">YoY vs 2025</th>
            </tr>
          </thead>
          <tbody>
            {/* Historical */}
            {HISTORICAL.map((h,i) => (
              <tr key={i} className="border-t border-border/60 bg-muted/10">
                <td className="px-4 py-1.5 font-semibold text-muted-foreground">{h.label}</td>
                <td className="px-4 py-1.5"><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">Real</span></td>
                <td colSpan={4} className="px-4 py-1.5 text-right font-mono font-semibold">{h.cases.toLocaleString()}</td>
                <td className="px-4 py-1.5 text-right font-mono">${Math.round(h.revenue/1000)}K</td>
                <td colSpan={5} className="px-4 py-1.5 text-center text-muted-foreground text-xs">—</td>
              </tr>
            ))}
            {/* Forecast */}
            {forecast.map((f,i) => {
              const real = reals[f.label];
              const budgetCases = Math.round(f.budget / PRICE_PER_CASE);
              const deltaVsBudget = f.totalCases - budgetCases;
              const deltaReal = real != null ? real - f.totalCases : null;
              const yoy = f.yoy2025 > 0 ? ((f.totalCases / f.yoy2025) - 1) * 100 : null;
              const hasReal = real != null;
              return (
                <tr key={i} className={`border-t border-border/60 hover:bg-muted/20 ${hasReal ? "bg-emerald-50/20" : ""}`}>
                  <td className="px-4 py-1.5 font-semibold" style={{color:"#1C2340"}}>{f.label}</td>
                  <td className="px-4 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${hasReal ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                      {hasReal ? "Real" : "Forecast"}
                    </span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{f.baseCases.toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{f.velDelta > 0 ? `+${f.velDelta}` : "—"}</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">{f.acctDelta > 0 ? `+${f.acctDelta}` : "—"}</td>
                  <td className="px-4 py-1.5 text-right font-mono font-bold" style={{color:"#1C2340"}}>{(hasReal ? real : f.totalCases).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right font-mono">${Math.round(f.revenue/1000)}K</td>
                  <td className="px-4 py-1.5 text-right font-mono text-muted-foreground">${Math.round(f.budget/1000)}K</td>
                  <td className={`px-4 py-1.5 text-right font-mono text-xs ${deltaVsBudget >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {deltaVsBudget >= 0 ? "+" : ""}{deltaVsBudget.toLocaleString()}
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    {editing === f.label ? (
                      <div className="flex items-center gap-1">
                        <input type="number" autoFocus value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") {
                              onRealUpdate(f.label, parseInt(editVal) || 0);
                              setEditing(null);
                            }
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="w-20 rounded border border-border px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/30" />
                        <button onClick={() => { onRealUpdate(f.label, parseInt(editVal)||0); setEditing(null); }}
                          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{backgroundColor:"#A3224A"}}>✓</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditing(f.label); setEditVal(String(real ?? "")); }}
                        className={`rounded px-2 py-0.5 text-xs font-mono ${hasReal ? "font-semibold text-emerald-600 hover:bg-emerald-50" : "text-muted-foreground hover:bg-muted border border-dashed border-border"}`}>
                        {hasReal ? real!.toLocaleString() : "cargar"}
                      </button>
                    )}
                  </td>
                  <td className={`px-4 py-1.5 text-right font-mono text-xs ${deltaReal == null ? "text-muted-foreground" : deltaReal >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                    {deltaReal == null ? "—" : `${deltaReal >= 0 ? "+" : ""}${deltaReal.toLocaleString()}`}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-xs text-muted-foreground">
                    {yoy != null ? `${yoy >= 0 ? "+" : ""}${yoy.toFixed(0)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{backgroundColor:"#1C2340", color:"#fff"}}>
              <td colSpan={5} className="px-4 py-2 text-xs font-semibold">TOTAL 12 meses</td>
              <td className="px-4 py-2 text-right font-mono font-bold">{totalFcst.toLocaleString()}</td>
              <td className="px-4 py-2 text-right font-mono">${Math.round(totalFcst*PRICE_PER_CASE/1000)}K</td>
              <td className="px-4 py-2 text-right font-mono text-slate-300">${Math.round(totalBudget*PRICE_PER_CASE/1000)}K</td>
              <td className={`px-4 py-2 text-right font-mono text-xs ${totalFcst >= totalBudget ? "text-emerald-400" : "text-red-400"}`}>
                {totalFcst >= totalBudget ? "+" : ""}{Math.round(totalFcst - totalBudget).toLocaleString()}
              </td>
              <td className="px-4 py-2 text-right font-mono text-emerald-400">{totalReal > 0 ? totalReal.toLocaleString() : "—"}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── SKU Tab ──────────────────────────────────────────────────────────────────
function SKUTab({ forecast }: { forecast: any[] }) {
  const skuByMonth = useMemo(() =>
    SKU_MIX.map(s => ({
      ...s,
      months: forecast.map(f => Math.round(f.totalCases * s.pct)),
      total: Math.round(forecast.reduce((sum,f) => sum + f.totalCases * s.pct, 0)),
    })), [forecast]);

  const SKU_COLORS: Record<string, string> = {
    XD:"#1C2340", PW:"#A3224A", HM:"#3B82F6", WM:"#10B981", WD:"#F59E0B", Matcha:"#8B5CF6"
  };

  return (
    <div className="space-y-5">
      {/* Mix overview */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-4" style={{color:"#1C2340"}}>Mix de SKUs — Forecast 2026–2027</h3>
        <div className="flex gap-3 flex-wrap mb-4">
          {SKU_MIX.map(s => (
            <div key={s.sku} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
              <span className="w-3 h-3 rounded-sm" style={{backgroundColor:SKU_COLORS[s.sku]}} />
              <span className="text-xs font-semibold">{s.sku}</span>
              <span className="text-xs text-muted-foreground">{Math.round(s.pct*100)}%</span>
            </div>
          ))}
        </div>
        <div className="h-3 rounded-full overflow-hidden flex">
          {SKU_MIX.map(s => (
            <div key={s.sku} style={{width:`${s.pct*100}%`, backgroundColor:SKU_COLORS[s.sku]}} title={`${s.sku}: ${Math.round(s.pct*100)}%`} />
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <th className="px-4 py-2.5 text-left sticky left-0 bg-muted/40">SKU</th>
              <th className="px-4 py-2.5 text-center">Mix</th>
              {forecast.map(f => <th key={f.label} className="px-3 py-2.5 text-right w-16">{f.label.slice(0,3)}</th>)}
              <th className="px-4 py-2.5 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            {skuByMonth.map(s => (
              <tr key={s.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-4 py-1.5 sticky left-0 bg-card">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-sm" style={{backgroundColor:SKU_COLORS[s.sku]}} />
                    <span className="font-semibold">{s.sku}</span>
                  </div>
                </td>
                <td className="px-4 py-1.5 text-center text-muted-foreground">{Math.round(s.pct*100)}%</td>
                {s.months.map((v,i) => (
                  <td key={i} className="px-3 py-1.5 text-right font-mono">{v.toLocaleString()}</td>
                ))}
                <td className="px-4 py-1.5 text-right font-mono font-bold">{s.total.toLocaleString()}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-bold" style={{backgroundColor:"#1C2340", color:"#fff"}}>
              <td className="px-4 py-2 sticky left-0" style={{backgroundColor:"#1C2340"}}>TOTAL</td>
              <td className="px-4 py-2 text-center">100%</td>
              {forecast.map(f => <td key={f.label} className="px-3 py-2 text-right font-mono">{f.totalCases.toLocaleString()}</td>)}
              <td className="px-4 py-2 text-right font-mono">{forecast.reduce((s,f)=>s+f.totalCases,0).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Historical mix reference */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-3" style={{color:"#1C2340"}}>Evolución histórica del mix</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
              <th className="py-2 text-left">SKU</th>
              <th className="py-2 text-right">2023</th>
              <th className="py-2 text-right">2024</th>
              <th className="py-2 text-right">2025</th>
              <th className="py-2 text-right">2026 (7mo)</th>
              <th className="py-2 text-right">2027 fcst</th>
            </tr>
          </thead>
          <tbody>
            {[
              {sku:"XD",    h:[0.33,0.22,0.27,0.30,0.30]},
              {sku:"PW",    h:[0,   0,   0.03,0.22,0.25]},
              {sku:"HM",    h:[0,   0,   0.02,0.19,0.18]},
              {sku:"WM",    h:[0.35,0.41,0.37,0.11,0.12]},
              {sku:"WD",    h:[0.32,0.37,0.31,0.09,0.08]},
              {sku:"Matcha",h:[0,   0,   0,   0.09,0.07]},
            ].map(s => (
              <tr key={s.sku} className="border-t border-border/60 hover:bg-muted/20">
                <td className="py-1.5 font-semibold">{s.sku}</td>
                {s.h.map((v,i) => (
                  <td key={i} className={`py-1.5 text-right font-mono text-sm ${v === 0 ? "text-muted-foreground" : ""}`}>
                    {v === 0 ? "—" : `${Math.round(v*100)}%`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Simulador Tab ────────────────────────────────────────────────────────────
function SimuladorTab({ onConfigChange }: { onConfigChange: (cfg: any) => void }) {
  const [velEnable, setVelEnable] = useState(false);
  const [velNew, setVelNew] = useState(1.8);
  const [velCurrent] = useState(1.39);
  const [velStores] = useState(404);
  const [acctEnable, setAcctEnable] = useState(false);
  const [acctStores, setAcctStores] = useState(300);
  const [acctVel, setAcctVel] = useState(1.5);
  const [acctEntry, setAcctEntry] = useState(5);

  useEffect(() => {
    onConfigChange({ velEnable, velNew, velCurrent, velStores, acctEnable, acctStores, acctVel, acctEntry });
  }, [velEnable, velNew, acctEnable, acctStores, acctVel, acctEntry]);

  const inp = "rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30";
  const months = ["Ago26","Sep26","Oct26","Nov26","Dic26","Ene27","Feb27","Mar27","Abr27","May27","Jun27","Jul27"];

  return (
    <div className="space-y-5">
      {/* Velocity override */}
      <div className={`rounded-2xl border p-5 shadow-sm ${velEnable ? "border-blue-200 bg-blue-50/30" : "border-border bg-card"}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold" style={{color:"#1C2340"}}>Override velocidad — Sprouts (404 tiendas)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Velocidad actual T4W: {velCurrent} u/s/w · incremento → delta de cases/mes</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-semibold text-muted-foreground">Enable</span>
            <div onClick={() => setVelEnable(!velEnable)}
              className={`w-10 h-5 rounded-full relative transition-colors ${velEnable ? "" : "bg-muted"}`}
              style={velEnable ? {backgroundColor:"#A3224A"} : {}}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${velEnable ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground">Nueva velocidad (u/s/w)</label>
            <input type="number" step="0.1" className={`${inp} mt-1 w-full`} value={velNew}
              onChange={e => setVelNew(parseFloat(e.target.value)||0)} disabled={!velEnable} />
          </div>
          <div className="flex items-end">
            <div className={`rounded-xl p-3 ${velEnable ? "bg-blue-100" : "bg-muted"} w-full text-center`}>
              <p className="text-[10px] text-muted-foreground">Delta mensual</p>
              <p className="text-xl font-bold font-mono" style={{color:"#1C2340"}}>
                {velEnable ? `+${Math.round((velNew-velCurrent)*velStores*4.33/8).toLocaleString()}` : "—"}
              </p>
              <p className="text-[10px] text-muted-foreground">cases/mes</p>
            </div>
          </div>
        </div>
      </div>

      {/* New account */}
      <div className={`rounded-2xl border p-5 shadow-sm ${acctEnable ? "border-emerald-200 bg-emerald-50/30" : "border-border bg-card"}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold" style={{color:"#1C2340"}}>Nueva cuenta (Kroger, Target, etc.)</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Ramp-up: 40% → 70% → 100% en 3 meses</p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs font-semibold text-muted-foreground">Enable</span>
            <div onClick={() => setAcctEnable(!acctEnable)}
              className={`w-10 h-5 rounded-full relative transition-colors ${acctEnable ? "" : "bg-muted"}`}
              style={acctEnable ? {backgroundColor:"#10B981"} : {}}>
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${acctEnable ? "translate-x-5" : "translate-x-0.5"}`} />
            </div>
          </label>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted-foreground">Tiendas al launch</label>
            <input type="number" className={`${inp} mt-1 w-full`} value={acctStores}
              onChange={e => setAcctStores(parseInt(e.target.value)||0)} disabled={!acctEnable} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Velocidad esperada (u/s/w)</label>
            <input type="number" step="0.1" className={`${inp} mt-1 w-full`} value={acctVel}
              onChange={e => setAcctVel(parseFloat(e.target.value)||0)} disabled={!acctEnable} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Mes de entrada (1=Ago26)</label>
            <select className={`${inp} mt-1 w-full`} value={acctEntry}
              onChange={e => setAcctEntry(parseInt(e.target.value))} disabled={!acctEnable}>
              {months.map((m,i) => <option key={i} value={i+1}>{i+1} — {m}</option>)}
            </select>
          </div>
        </div>
        {acctEnable && (
          <div className="grid grid-cols-4 gap-2">
            {[0,1,2,3].map(i => {
              const ramp = i === 0 ? 0.4 : i === 1 ? 0.7 : 1.0;
              const cases = i < 3 ? Math.round(acctStores * acctVel * 4.33 / 8 * ramp) : null;
              return (
                <div key={i} className={`rounded-lg p-3 text-center ${i < 3 ? "bg-emerald-50 border border-emerald-200" : "bg-muted"}`}>
                  <p className="text-[10px] text-muted-foreground">{i === 0 ? "Mes 1 (40%)" : i === 1 ? "Mes 2 (70%)" : i === 2 ? "Mes 3+ (100%)" : "Después"}</p>
                  <p className="text-lg font-bold font-mono text-emerald-600">{cases?.toLocaleString() ?? "—"}</p>
                  <p className="text-[10px] text-muted-foreground">cases/mes</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Presets */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-3" style={{color:"#1C2340"}}>Presets de nueva cuenta</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {label:"Indie indie (100 tiendas)", stores:100, vel:1.5},
            {label:"Regional (300 tiendas)", stores:300, vel:1.5},
            {label:"Nacional mid (600 tiendas)", stores:600, vel:1.2},
            {label:"Nacional grande (1000 tiendas)", stores:1000, vel:1.0},
          ].map(p => {
            const monthly = Math.round(p.stores * p.vel * 4.33 / 8);
            return (
              <div key={p.label} className="rounded-xl border border-border p-3 hover:bg-muted/30 cursor-pointer"
                onClick={() => { setAcctStores(p.stores); setAcctVel(p.vel); setAcctEnable(true); }}>
                <p className="text-xs font-semibold">{p.label}</p>
                <p className="text-lg font-bold font-mono mt-1" style={{color:"#A3224A"}}>+{monthly.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">cases/mes estabilizado</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Estacionalidad Tab ───────────────────────────────────────────────────────
function EstacionalidadTab() {
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const indices = [0.21,1.40,1.39,1.64,0.72,1.47,0.68,0.65,1.48,0.76,0.26,1.33];
  const maxIdx = Math.max(...indices);

  return (
    <div className="space-y-5">
      {/* Bar chart of indices */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="text-sm font-bold mb-1" style={{color:"#1C2340"}}>Índices de estacionalidad — fuente: 2025 (único año completo a escala)</h3>
        <p className="text-xs text-muted-foreground mb-5">1.0 = promedio · &gt;1.0 = pico · &lt;1.0 = valle. Los picos corresponden a ciclos de PO de distribuidores, no a consumo del shopper.</p>
        <div className="flex items-end gap-2 h-32">
          {indices.map((v,i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-[10px] font-mono font-semibold" style={{color: v >= 1.3 ? "#A3224A" : v <= 0.4 ? "#9CA3AF" : "#1C2340"}}>{v}</span>
              <div className="w-full rounded-t" style={{
                height:`${(v/maxIdx)*80}px`,
                backgroundColor: v >= 1.3 ? "#A3224A" : v <= 0.4 ? "#E5E7EB" : "#1C2340",
                minHeight:4,
              }} />
              <span className="text-[9px] text-muted-foreground">{months[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Velocity by chain */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30">
          <h3 className="text-sm font-semibold" style={{color:"#1C2340"}}>Velocidad por cadena — Jul 2026 (Orda/Fron)</h3>
          <p className="text-xs text-muted-foreground">u/s/w = units per store per week</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/20 border-b border-border">
              <th className="px-4 py-2.5 text-left">Cadena</th>
              <th className="px-4 py-2.5 text-right">Tiendas</th>
              <th className="px-4 py-2.5 text-right">Vel. T4W</th>
              <th className="px-4 py-2.5 text-right">Vel. LW</th>
              <th className="px-4 py-2.5 text-right">Cases/mes estimados</th>
            </tr>
          </thead>
          <tbody>
            {VELOCITY_DATA.map((v,i) => {
              const monthly = Math.round(v.stores * v.vel_t4w * 4.33 / 8);
              return (
                <tr key={i} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold" style={{color:"#1C2340"}}>{v.chain}</td>
                  <td className="px-4 py-2 text-right font-mono">{v.stores}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{v.vel_t4w}</td>
                  <td className="px-4 py-2 text-right font-mono text-muted-foreground">{v.vel_lw}</td>
                  <td className="px-4 py-2 text-right font-mono text-emerald-600 font-semibold">{monthly.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Real Mensual Tab ─────────────────────────────────────────────────────────
const ALL_MONTHS = [
  "Ene 2026","Feb 2026","Mar 2026","Abr 2026","May 2026","Jun 2026","Jul 2026",
  "Ago 2026","Sep 2026","Oct 2026","Nov 2026","Dic 2026",
  "Ene 2027","Feb 2027","Mar 2027","Abr 2027","May 2027","Jun 2027","Jul 2027",
];

// Pre-loaded from BARIS_Acc Real Mensual sheet (Jan–Jul 2026 actuals)
const PRELOADED_REALS: Record<string, { net_sales: number; wm: number; wd: number; xd: number; pw: number; hm: number; matcha: number }> = {
  "Ene 2026": { net_sales:135884, wm:0,   wd:0,   xd:1418, pw:1078, hm:1033, matcha:0    },
  "Feb 2026": { net_sales:201332, wm:840, wd:550, xd:1018, pw:867,  hm:747,  matcha:0    },
  "Mar 2026": { net_sales:195015, wm:645, wd:705, xd:1560, pw:900,  hm:810,  matcha:0    },
  "Abr 2026": { net_sales:111511, wm:495, wd:300, xd:641,  pw:877,  hm:427,  matcha:0    },
  "May 2026": { net_sales:294358, wm:690, wd:691, xd:2108, pw:2368, hm:1665, matcha:0    },
  "Jun 2026": { net_sales:212494, wm:891, wd:542, xd:1939, pw:1149, hm:1060, matcha:0    },
  "Jul 2026": { net_sales:277626, wm:585, wd:510, xd:2916, pw:1440, hm:1725, matcha:0    },
};

type MonthReal = { net_sales: string; wm: string; wd: string; xd: string; pw: string; hm: string; matcha: string };

function RealMensualTab({ onRealUpdate }: { onRealUpdate: (label: string, cases: number) => void }) {
  const [data, setData] = useState<Record<string, MonthReal>>(() => {
    const init: Record<string, MonthReal> = {};
    for (const m of ALL_MONTHS) {
      const p = PRELOADED_REALS[m];
      init[m] = p
        ? { net_sales:String(p.net_sales), wm:String(p.wm||""), wd:String(p.wd||""), xd:String(p.xd||""), pw:String(p.pw||""), hm:String(p.hm||""), matcha:String(p.matcha||"") }
        : { net_sales:"", wm:"", wd:"", xd:"", pw:"", hm:"", matcha:"" };
    }
    return init;
  });
  const [saved, setSaved] = useState<Set<string>>(new Set(Object.keys(PRELOADED_REALS)));

  function set(month: string, field: keyof MonthReal, val: string) {
    setData(d => ({ ...d, [month]: { ...d[month], [field]: val } }));
  }

  function saveMonth(month: string) {
    const row = data[month];
    const total = ["wm","wd","xd","pw","hm","matcha"].reduce((s, k) => s + (parseInt(row[k as keyof MonthReal]) || 0), 0);
    setSaved(s => new Set([...s, month]));
    onRealUpdate(month, total);
    toast.success(`${month} saved: ${total.toLocaleString()} cases`);
  }

  const totals = ALL_MONTHS.map(m => {
    const row = data[m];
    const cases = ["wm","wd","xd","pw","hm","matcha"].reduce((s,k) => s + (parseInt(row?.[k as keyof MonthReal])||0), 0);
    const rev = parseInt(row?.net_sales) || 0;
    return { month: m, cases, rev, hasData: cases > 0 || rev > 0 };
  });

  const ytdCases = totals.slice(0,7).reduce((s,r) => s + r.cases, 0);
  const ytdRev = totals.slice(0,7).reduce((s,r) => s + r.rev, 0);

  const inp = "rounded border border-border bg-background px-1.5 py-0.5 text-xs font-mono w-full focus:outline-none focus:ring-1 focus:ring-primary/30";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">YTD 2026 Revenue (Ene–Jul)</p>
          <p className="text-2xl font-bold font-mono" style={{color:"#A3224A"}}>${Math.round(ytdRev/1000)}K</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">YTD 2026 Cases (Ene–Jul)</p>
          <p className="text-2xl font-bold font-mono" style={{color:"#1C2340"}}>{ytdCases.toLocaleString()}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">$/case promedio YTD</p>
          <p className="text-2xl font-bold font-mono" style={{color:"#1C2340"}}>${ytdCases > 0 ? (ytdRev/ytdCases).toFixed(2) : "—"}</p>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
        💡 Ene–Jul 2026 cargados desde BARIS_Acc. Completá el mes corriente al cierre con ventas netas ($) y cajas por SKU.
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
        <table className="w-full text-xs min-w-max">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <th className="px-3 py-2.5 text-left">Mes</th>
              <th className="px-3 py-2.5 text-right">Ventas netas ($)</th>
              <th className="px-3 py-2.5 text-right">XD cases</th>
              <th className="px-3 py-2.5 text-right">PW cases</th>
              <th className="px-3 py-2.5 text-right">HM cases</th>
              <th className="px-3 py-2.5 text-right">WM cases</th>
              <th className="px-3 py-2.5 text-right">WD cases</th>
              <th className="px-3 py-2.5 text-right">Matcha cases</th>
              <th className="px-3 py-2.5 text-right font-bold">TOTAL cases</th>
              <th className="px-3 py-2.5 text-right">$/case</th>
              <th className="px-3 py-2.5 text-center">Acción</th>
            </tr>
          </thead>
          <tbody>
            {ALL_MONTHS.map(m => {
              const row = data[m];
              const isSaved = saved.has(m);
              const isFuture = !PRELOADED_REALS[m] && !isSaved;
              const total = ["wm","wd","xd","pw","hm","matcha"].reduce((s,k) => s + (parseInt(row?.[k as keyof MonthReal])||0), 0);
              const rev = parseInt(row?.net_sales) || 0;
              const pricePerCase = total > 0 && rev > 0 ? (rev/total).toFixed(2) : "—";

              return (
                <tr key={m} className={`border-t border-border/60 ${isSaved ? "bg-emerald-50/20" : isFuture ? "bg-muted/10" : ""}`}>
                  <td className="px-3 py-1.5 font-semibold" style={{color:"#1C2340"}}>{m}</td>
                  {(["net_sales","xd","pw","hm","wm","wd","matcha"] as (keyof MonthReal)[]).map(field => (
                    <td key={field} className="px-3 py-1.5">
                      <input type="number" className={inp} value={row?.[field] ?? ""}
                        onChange={e => set(m, field, e.target.value)}
                        placeholder={isFuture ? "—" : "0"}
                        style={isSaved && !isFuture ? {backgroundColor:"#f0fdf4"} : {}} />
                    </td>
                  ))}
                  <td className={`px-3 py-1.5 text-right font-mono font-bold ${total > 0 ? "" : "text-muted-foreground"}`} style={total > 0 ? {color:"#1C2340"} : {}}>
                    {total > 0 ? total.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{pricePerCase}</td>
                  <td className="px-3 py-1.5 text-center">
                    <button onClick={() => saveMonth(m)}
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold ${isSaved ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200" : "text-white"}`}
                      style={!isSaved ? {backgroundColor:"#A3224A"} : {}}>
                      {isSaved ? "✓ Saved" : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{backgroundColor:"#1C2340",color:"#fff"}}>
              <td className="px-3 py-2 font-semibold text-xs">TOTAL YTD</td>
              <td className="px-3 py-2 text-right font-mono">${ytdRev.toLocaleString()}</td>
              <td colSpan={6} />
              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">{ytdCases.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono text-slate-300">{ytdCases > 0 ? `$${(ytdRev/ytdCases).toFixed(2)}` : "—"}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function SalesPage() {
  const [tab, setTab] = useState<SalesTab>("resumen");
  const [scenario, setScenario] = useState<"Pesimista"|"Normal"|"Optimista">("Normal");
  const [reals, setReals] = useState<Record<string, number>>({});
  const [simConfig, setSimConfig] = useState<any>({ velEnable:false, velNew:1.8, velCurrent:1.39, velStores:404, acctEnable:false, acctStores:300, acctVel:1.5, acctEntry:5 });

  const forecast = useMemo(() => calcForecast(scenario, simConfig.velEnable, simConfig.acctEnable, simConfig), [scenario, simConfig]);

  // Load Chart.js
  useEffect(() => {
    if (window.Chart) return;
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);

  const tabs: { id: SalesTab; label: string }[] = [
    { id:"real",           label:"Real Mensual" },
    { id:"resumen",        label:"Resumen" },
    { id:"detalle",        label:"Detalle mensual" },
    { id:"sku",            label:"Por SKU" },
    { id:"simulador",      label:"Simulador" },
    { id:"estacionalidad", label:"Estacionalidad" },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold" style={{color:"#1C2340"}}>Sales</h1>
        <p className="text-sm text-muted-foreground">Demand forecast Ago 2026 → Jul 2027 · actualizar real mensualmente</p>
      </div>

      {/* Scenario selector */}
      <div className="flex items-center gap-4">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {(["Pesimista","Normal","Optimista"] as const).map(s => (
            <button key={s} onClick={() => setScenario(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${scenario === s ? "text-white shadow-sm" : "text-muted-foreground"}`}
              style={scenario === s ? {backgroundColor: s === "Pesimista" ? "#EF4444" : s === "Normal" ? "#1C2340" : "#10B981"} : {}}>
              {s}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {scenario === "Normal" ? "+75% YoY · 109K cajas · $4.0M" : scenario === "Pesimista" ? "+50% YoY · 93K cajas · $3.4M" : "+120% YoY · 137K cajas · $5.0M"}
        </span>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab === t.id ? {borderColor:"#A3224A", color:"#A3224A"} : {}}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "real"          && <RealMensualTab onRealUpdate={(label, cases) => setReals(r => ({...r, [label]: cases}))} />}
      {tab === "resumen"       && <ResumenTab forecast={forecast} scenario={scenario} reals={reals} />}
      {tab === "detalle"       && <DetalleTab forecast={forecast} reals={reals} onRealUpdate={(label, val) => setReals(r => ({...r, [label]: val}))} />}
      {tab === "sku"           && <SKUTab forecast={forecast} />}
      {tab === "simulador"     && <SimuladorTab onConfigChange={setSimConfig} />}
      {tab === "estacionalidad"&& <EstacionalidadTab />}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/sales")({
  component: SalesPage,
  head: () => ({ meta: [{ title: "Sales · BARIS" }] }),
});
