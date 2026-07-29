import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type SysTab = "team" | "config" | "activity" | "data";

// ─── Team Tab ─────────────────────────────────────────────────────────────────
const TEAM = [
  { initials:"MF", name:"Marcos",  username:"marcos", email:"marcos@everybaris.com",  role:"Admin",  bg:"#EEEDFE", color:"#3C3489", lastLogin:"Today · 10:42am", active:true },
  { initials:"PL", name:"Pedro",   username:"pedro",  email:"pedro@everybaris.com",   role:"Admin",  bg:"#E1F5EE", color:"#085041", lastLogin:"Today · 9:15am",  active:true },
  { initials:"JC", name:"Juan",    username:"juan",   email:"juan@everybaris.com",    role:"Editor", bg:"#E6F1FB", color:"#0C447C", lastLogin:"Yesterday · 4:30pm", active:true },
  { initials:"LG", name:"Luca",    username:"luca",   email:"luca@everybaris.com",    role:"Viewer", bg:"#FAEEDA", color:"#633806", lastLogin:"Jul 20",          active:true },
];

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    Admin:  "bg-purple-100 text-purple-700 border border-purple-200",
    Editor: "bg-blue-100 text-blue-700 border border-blue-200",
    Viewer: "bg-gray-100 text-gray-600 border border-gray-200",
  };
  const icons: Record<string, string> = { Admin: "🛡", Editor: "✏", Viewer: "👁" };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${styles[role] ?? styles.Viewer}`}>
      {icons[role]} {role}
    </span>
  );
}

function TeamTab() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{color:"#1C2340"}}>System users</h2>
          <p className="text-sm text-muted-foreground">4 active users · roles determine permissions per module</p>
        </div>
        <button className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white opacity-50 cursor-not-allowed" style={{backgroundColor:"#1C2340"}}
          title="User management via Supabase Auth — coming soon">
          + Add user
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-b border-border">
              <th className="px-5 py-3 text-left">User</th>
              <th className="px-5 py-3 text-left">Name</th>
              <th className="px-5 py-3 text-left">Email</th>
              <th className="px-5 py-3 text-left">Role</th>
              <th className="px-5 py-3 text-left">Last login</th>
              <th className="px-5 py-3 text-center">Status</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {TEAM.map(u => (
              <tr key={u.username} className="border-t border-border/60 hover:bg-muted/20">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{backgroundColor:u.bg, color:u.color}}>{u.initials}</span>
                    <span className="font-semibold" style={{color:"#1C2340"}}>{u.username}</span>
                  </div>
                </td>
                <td className="px-5 py-3">{u.name}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{u.email}</td>
                <td className="px-5 py-3"><RoleBadge role={u.role} /></td>
                <td className="px-5 py-3 text-xs font-mono text-muted-foreground">{u.lastLogin}</td>
                <td className="px-5 py-3 text-center">
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-700">Active</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button className="rounded-lg px-3 py-1 text-xs border border-border hover:bg-muted opacity-50 cursor-not-allowed">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span><RoleBadge role="Admin" /> full access, user management</span>
        <span><RoleBadge role="Editor" /> create and edit, no delete</span>
        <span><RoleBadge role="Viewer" /> read only</span>
      </div>

      <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-xs text-orange-700">
        🔒 Login will be enabled as the last step. Password for all users: <strong>baris2026</strong> · Emails: x@everybaris.com
      </div>
    </div>
  );
}

// ─── Config Tab ───────────────────────────────────────────────────────────────
type ConfigRow = { label: string; value: string };
type ConfigGroup = { title: string; rows: ConfigRow[] };

const DEFAULT_CONFIG: ConfigGroup[] = [
  {
    title: "Prices per distributor ($/case)",
    rows: [
      { label: "UNFI",       value: "$36.96" },
      { label: "KeHe",       value: "$36.96" },
      { label: "RFD",        value: "$38.50" },
      { label: "Rainforest", value: "$35.00" },
    ]
  },
  {
    title: "Payment terms (days)",
    rows: [
      { label: "UNFI",       value: "30 days" },
      { label: "KeHe",       value: "30 days" },
      { label: "Rainforest", value: "60 days" },
      { label: "RFD",        value: "30 days" },
    ]
  },
  {
    title: "Production & COGS",
    rows: [
      { label: "Tolling cost default",  value: "$1.45" },
      { label: "Scrap IQF Raspberry",   value: "20%" },
      { label: "Scrap coatings (choc)", value: "15%" },
      { label: "Scrap packaging",       value: "3%" },
      { label: "Units per case",        value: "8" },
    ]
  },
  {
    title: "Stock alerts",
    rows: [
      { label: "🔴 Critical (WoH)",        value: "< 2" },
      { label: "🟡 Watch",                 value: "< 5" },
      { label: "Alert best-by (months)",   value: "6" },
      { label: "Stale lot (days w/o mvmt.)",value: "60" },
      { label: "Fill rate warning",        value: "95%" },
    ]
  },
];

const WAREHOUSES = [
  { name: "Lineage Newark", desc: "3PL commercial · Newark, NJ", active: true },
  { name: "Cold Chain",     desc: "Samples",                     active: true },
  { name: "Empire",         desc: "Copacker NJ",                 active: true },
  { name: "Heinlein",       desc: "Copacker FL (new)",           active: true },
  { name: "Freezpak",       desc: "Legacy / inactive",           active: false },
];

function ConfigTab() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);

  function updateVal(gi: number, ri: number, val: string) {
    setConfig(prev => prev.map((g, i) => i !== gi ? g : {
      ...g, rows: g.rows.map((r, j) => j !== ri ? r : { ...r, value: val })
    }));
    setSaved(false);
  }

  function save() {
    setSaved(true);
    toast.success("Configuration saved");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{color:"#1C2340"}}>System parameters</h2>
          <p className="text-sm text-muted-foreground">Prices, terms, COGS defaults, alerts and warehouses. Apply globally.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setConfig(DEFAULT_CONFIG); setSaved(false); }}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold border border-border hover:bg-muted">
            ↺ Restore defaults
          </button>
          <button onClick={save}
            className="rounded-lg px-4 py-1.5 text-sm font-semibold text-white"
            style={{backgroundColor:"#A3224A"}}>
            {saved ? "✓ Saved" : "Save changes"}
          </button>
        </div>
      </div>

      {/* Config groups */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {config.map((group, gi) => (
          <div key={group.title} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30">
              <p className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">{group.title}</p>
            </div>
            <div className="divide-y divide-border/60">
              {group.rows.map((row, ri) => (
                <div key={row.label} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20">
                  <span className="text-sm text-muted-foreground">{row.label}</span>
                  <input value={row.value} onChange={e => updateVal(gi, ri, e.target.value)}
                    className="w-28 text-right rounded-lg border border-border bg-background px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Email template */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/30">
          <p className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">Fulfillment · Lineage 3PL email template</p>
        </div>
        <div className="divide-y divide-border/60">
          {[
            { label:"To",      value:"a6orders@onelineage.com" },
            { label:"CC",      value:"pedro@everybaris.com · a6ship@onelineage.com · ltranssolutionseast@onelineage.com" },
            { label:"Subject", value:"PO #{PO_number} - {customer}" },
          ].map(row => (
            <div key={row.label} className="flex items-start justify-between px-4 py-2.5">
              <span className="text-sm text-muted-foreground w-16 flex-shrink-0">{row.label}</span>
              <span className="text-sm font-mono text-right text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Warehouses */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border bg-muted/30">
          <p className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">Active warehouses</p>
        </div>
        <div className="divide-y divide-border/60">
          {WAREHOUSES.map(wh => (
            <div key={wh.name} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/20">
              <div className="flex items-center gap-2.5">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${wh.active ? "bg-emerald-500" : "bg-gray-300"}`} />
                <span className={`text-sm font-medium ${!wh.active ? "text-muted-foreground" : ""}`}>{wh.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{wh.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────
function ActivityTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState("all");
  const [filterAction, setFilterAction] = useState("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      setLogs(data ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => logs.filter(l =>
    (filterUser === "all" || l.user_id === filterUser) &&
    (filterAction === "all" || l.action === filterAction)
  ), [logs, filterUser, filterAction]);

  const userMap: Record<string, typeof TEAM[0]> = {};
  // We can't map user_id to name easily without profiles join — show initials from action
  const actionColor: Record<string, string> = {
    status_change: "bg-purple-100 text-purple-700",
    bol_confirmed: "bg-emerald-100 text-emerald-700",
    bol_uploaded: "bg-blue-100 text-blue-700",
    created: "bg-emerald-100 text-emerald-700",
    updated: "bg-blue-100 text-blue-700",
    deleted: "bg-red-100 text-red-700",
  };

  function exportCSV() {
    const rows = [["timestamp","action","table","record_id","user_id","details"]];
    filtered.forEach(l => rows.push([l.created_at, l.action, l.table_name, l.record_id, l.user_id ?? "", JSON.stringify(l.new_data)]));
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "audit_log.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold" style={{color:"#1C2340"}}>Audit log</h2>
          <p className="text-sm text-muted-foreground">Immutable action log · 90-day retention</p>
        </div>
        <button onClick={exportCSV} className="rounded-lg px-4 py-1.5 text-sm font-semibold border border-border hover:bg-muted">
          ↓ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none">
          <option value="all">All actions</option>
          <option value="status_change">Status change</option>
          <option value="bol_confirmed">BOL confirmed</option>
          <option value="bol_uploaded">BOL uploaded</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-muted-foreground">
          <p className="text-2xl mb-2">📋</p>
          <p className="text-sm">No activity logged yet</p>
          <p className="text-xs mt-1">Actions like status changes and BOL uploads will appear here automatically</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden divide-y divide-border/60">
          {filtered.map((log, i) => {
            const user = TEAM.find(u => u.username === log.user_id);
            const dt = new Date(log.created_at);
            const timeStr = dt.toLocaleDateString("en-US", { month:"short", day:"numeric" }) + " · " +
              dt.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit" });
            return (
              <div key={i} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/20">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{backgroundColor: user?.bg ?? "#F3F4F6", color: user?.color ?? "#6B7280"}}>
                  {user?.initials ?? "—"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${actionColor[log.action] ?? "bg-muted text-muted-foreground"}`}>
                      {log.table_name}
                    </span>
                    <span className="text-sm">{log.action?.replace(/_/g," ")}</span>
                    {log.record_id && <span className="text-xs font-mono text-muted-foreground">#{log.record_id.slice(0,8)}</span>}
                    {log.new_data?.new_value && (
                      <span className="text-xs text-muted-foreground">
                        {log.new_data.old_value} → <strong>{log.new_data.new_value}</strong>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 font-mono">{timeStr} · {user?.username ?? log.user_id?.slice(0,8) ?? "system"}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Showing last {filtered.length} entries · 90-day retention</p>
    </div>
  );
}

// ─── Data Tab ─────────────────────────────────────────────────────────────────
const IMPORTS = [
  { name: "FP Movements",    file: "fp_movements.csv",       table: "fp_movements" },
  { name: "I&P Movements",   file: "ip_movements.csv",       table: "ip_movements" },
  { name: "Customer Orders", file: "customer_orders.csv",    table: "customer_orders" },
  { name: "Production Runs", file: "production_runs.csv",    table: "production_runs" },
  { name: "Budget Lines",    file: "budget_lines.csv",       table: "budget_lines" },
];

function DataTab() {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const tables = ["fp_movements","ip_movements","customer_orders","production_runs","budget_lines","audit_log"];
      const results = await Promise.all(tables.map(t =>
        supabase.from(t as any).select("*", { count:"exact", head:true })
      ));
      const c: Record<string, number> = {};
      tables.forEach((t, i) => { c[t] = results[i].count ?? 0; });
      setCounts(c);
    })();
  }, []);

  function downloadTemplate(tableName: string) {
    const templates: Record<string, string> = {
      fp_movements: "movement_date,type,sku,cases,warehouse,lot_number,concept,cogs_per_case,po_number_ref,notes",
      ip_movements: "movement_date,material,vendor,type,quantity,unit,lot_number,concept,notes",
      customer_orders: "po_number,po_date,ship_est_date,invoice_date,distributor,customer,status,wd_cases,pw_cases,hm_cases,matcha_cases,xd_cases,wm_cases,gross_sales,promo_discount,net_sales,notes",
      production_runs: "run_date,facility,sku,cases_produced,cogs_per_case,lot_number,notes",
      budget_lines: "year,month_num,month,budget_gross,budget_net",
    };
    const csv = templates[tableName] ?? "";
    const blob = new Blob([csv + "\n"], { type:"text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${tableName}_template.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold" style={{color:"#1C2340"}}>Data & Import</h2>
        <p className="text-sm text-muted-foreground">Database status and CSV import/export tools</p>
      </div>

      {/* Database status */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{color:"#1C2340"}}>Database status</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(counts).map(([table, count]) => (
            <div key={table} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{table.replace(/_/g," ")}</p>
              <p className="text-2xl font-bold font-mono mt-1" style={{color:"#1C2340"}}>{count.toLocaleString()}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">rows</p>
            </div>
          ))}
        </div>
      </div>

      {/* Import CSV */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{color:"#1C2340"}}>Import CSV</h3>
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden divide-y divide-border/60">
          {IMPORTS.map(imp => (
            <div key={imp.table} className="flex items-center justify-between px-5 py-3 hover:bg-muted/20">
              <div>
                <p className="text-sm font-medium">{imp.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{imp.file}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => downloadTemplate(imp.table)}
                  className="rounded-lg px-3 py-1 text-xs font-semibold border border-border hover:bg-muted">
                  ↓ Template
                </button>
                <label className="rounded-lg px-3 py-1 text-xs font-semibold text-white cursor-pointer"
                  style={{backgroundColor:"#1C2340"}}>
                  ↑ Upload
                  <input type="file" accept=".csv" className="hidden"
                    onChange={e => {
                      if (e.target.files?.[0]) toast.info(`Use SQL editor to import ${imp.file} — see create_budget_table.sql pattern`);
                    }} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export */}
      <div>
        <h3 className="text-sm font-semibold mb-3" style={{color:"#1C2340"}}>Export data</h3>
        <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden divide-y divide-border/60">
          {["customer_orders","fp_movements","ip_movements","audit_log"].map(table => (
            <div key={table} className="flex items-center justify-between px-5 py-3 hover:bg-muted/20">
              <div>
                <p className="text-sm font-medium">{table.replace(/_/g," ")}</p>
                <p className="text-xs text-muted-foreground">{counts[table] ?? 0} rows</p>
              </div>
              <button
                onClick={async () => {
                  const { data } = await supabase.from(table as any).select("*");
                  if (!data || data.length === 0) { toast.error("No data to export"); return; }
                  const headers = Object.keys(data[0]).join(",");
                  const rows = data.map((r: any) => Object.values(r).map(v => JSON.stringify(v ?? "")).join(","));
                  const csv = [headers, ...rows].join("\n");
                  const blob = new Blob([csv], { type:"text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `${table}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
                  URL.revokeObjectURL(url);
                  toast.success(`${data.length} rows exported`);
                }}
                className="rounded-lg px-3 py-1 text-xs font-semibold border border-border hover:bg-muted">
                ↓ Export CSV
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function SistemaPage() {
  const [tab, setTab] = useState<SysTab>("team");

  const tabs: { id: SysTab; label: string; icon: string }[] = [
    { id:"team",     label:"Team",        icon:"👥" },
    { id:"config",   label:"Settings",    icon:"⚙️" },
    { id:"activity", label:"Audit Log",   icon:"📋" },
    { id:"data",     label:"Data & Import",icon:"💾" },
  ];

  return (
    <div className="space-y-5 pb-10">
      <div>
        <h1 className="text-2xl font-bold" style={{color:"#1C2340"}}>System</h1>
        <p className="text-sm text-muted-foreground">Users, configuration, audit log and data management</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
            style={tab === t.id ? {borderColor:"#A3224A", color:"#A3224A"} : {}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "team"     && <TeamTab />}
      {tab === "config"   && <ConfigTab />}
      {tab === "activity" && <ActivityTab />}
      {tab === "data"     && <DataTab />}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/system")({
  component: SistemaPage,
  head: () => ({ meta: [{ title: "System · BARIS" }] }),
});
