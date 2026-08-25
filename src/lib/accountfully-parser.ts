/**
 * Accountfully Management Report PDF parser.
 * Extracts P&L by Month + Balance Sheet using pdf.js (position-based column detection).
 * No external API needed — runs entirely client-side.
 */

// ─── PDF.js CDN loader ───────────────────────────────────────────────────────
const PDFJS_VERSION = "3.11.174";
const PDFJS_CDN = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}`;

async function ensurePdfJs(): Promise<any> {
  if ((window as any).pdfjsLib) return (window as any).pdfjsLib;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${PDFJS_CDN}/pdf.min.js`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load pdf.js"));
    document.head.appendChild(s);
  });
  const lib = (window as any).pdfjsLib;
  lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
  return lib;
}

// ─── Types ───────────────────────────────────────────────────────────────────
type TI = { text: string; x: number; y: number; w: number };
type Row = TI[];

// ─── P&L label → pnl_detail key mapping ─────────────────────────────────────
const PNL_MAP: Record<string, string> = {
  "Sales of Product Income": "sales_product",
  "Shipping Income": "shipping_income",
  "Consumer Returns": "consumer_returns",
  "Distributor Fees": "distributor_fees",
  "DSD Programs": "dsd_programs",
  "KeHE Allowance": "kehe_allowance",
  "Payment Terms": "payment_terms",
  "Promos": "promos",
  "Trade Spend": "trade_spend",
  "UNFI Allowance": "unfi_allowance",
  "Returns / Refunds": "returns_refunds",
  "Shipping & QTY Variances": "shipping_qty_var",
  "Product Costs": "product_costs",
  "Freight In": "freight_in",
  "Freight Out": "freight_out_actual",
  "Merchant Account Fees": "merchant_fees",
  "Warehouse / Fulfillment": "warehouse_fulfillment",
  "Broker Commissions & Fees": "broker_commissions",
  "Slotting Fees": "slotting_fees",
  "Demos & Merchandising": "demos_merchandising",
  "Digital & Social Media": "digital_social",
  "Events/Trade Shows": "events_tradeshows",
  "Printing & Promotional": "printing_promotional",
  "Product Samples": "product_samples",
  "Bank Charges & Fees": "bank_charges",
  "Dues & Subscriptions": "dues_subscriptions",
  "Rent": "rent",
  "Utilities": "utilities",
  "Insurance": "insurance",
  "Meals & Entertainment": "meals_entertainment",
  "Office Supplies": "office_supplies",
  "Contractors": "contractors",
  "Payroll Processing Fees": "payroll_processing",
  "Payroll Taxes": "payroll_taxes",
  "Salaries & Wages - Operations": "salaries_operations",
  "Accounting & Finance": "accounting_finance",
  "Business Consultation": "business_consultation",
  "Legal Fees": "legal_fees",
  "Quality and R&D": "quality_rd",
  "Taxes & Licenses": "taxes_licenses",
  "Car Rental / Uber": "car_rental_uber",
  "Flights": "flights",
  "Hotel": "hotel",
  "Parking & tolls": "vehicle_expenses",
  "Vehicle gas & fuel": "vehicle_expenses",
  "Vehicle expenses": "vehicle_expenses",
  "Uncategorized Expense": "uncategorized",
  "9000 Other Income": "other_income",
  "Other Income": "other_income",
  "Total Other Income": "other_income",
};

// Deduction keys: come NEGATIVE from Accountfully PDF → keep as-is (no sign change)
// (These are under "4500 Deductions to Income" in the PDF)
const DEDUCTION_KEYS = new Set([
  "consumer_returns", "distributor_fees", "dsd_programs", "kehe_allowance",
  "payment_terms", "promos", "trade_spend", "unfi_allowance", "returns_refunds",
  "shipping_qty_var",
]);

// Cost/Expense keys: come POSITIVE from Accountfully PDF → ALWAYS negate (v = -v)
// Credits (negative in PDF, e.g. trade show refund) get negated to positive = correct
const COST_KEYS = new Set([
  "product_costs", "freight_in", "freight_out_actual",
  "merchant_fees", "warehouse_fulfillment", "broker_commissions", "slotting_fees",
  "demos_merchandising", "digital_social", "events_tradeshows", "printing_promotional",
  "product_samples", "bank_charges", "dues_subscriptions", "rent", "utilities",
  "insurance", "meals_entertainment", "office_supplies", "contractors",
  "payroll_processing", "payroll_taxes", "salaries_operations", "accounting_finance",
  "business_consultation", "legal_fees", "quality_rd", "taxes_licenses",
  "car_rental_uber", "flights", "hotel", "vehicle_expenses", "uncategorized",
]);

// ─── BS label → bs_detail key mapping ────────────────────────────────────────
const BS_MAP: Record<string, string> = {
  "1001 BOFA x6854": "bofa_x6854",
  "BOFA x6854": "bofa_x6854",
  "Citi Bank": "citi_bank",
  "Mercury Checking": "mercury_checking",
  "Mercury Treasury": "mercury_treasury",
  "1100 Accounts receivable (A/R)": "accounts_receivable",
  "Accounts receivable (A/R)": "accounts_receivable",
  "1401 Finished Goods": "finished_goods",
  "1410 Raw Materials & Packaging": "raw_materials_packaging",
  "Loans to shareholders": "loans_to_shareholders",
  "1201 Equipment": "equipment",
  "1220 Accumulated depreciation": "accumulated_depreciation",
  "Due from Shareholders": "due_from_shareholders",
  "2010 Accrued Liabilities": "accrued_liabilities",
  "1st Investment Round": "capital_1st_round",
  "2nd Investment Round": "capital_2nd_round",
  "3rd Investment Round": "capital_3rd_round",
  "4th Investment Round": "capital_4th_round",
  "Common Stock": "common_stock",
  "Opening balance equity": "opening_balance_equity",
  "Retained Earnings": "retained_earnings",
  "Net Income": "net_income_equity",
};

// Credit card labels → sum into combined keys
const CC_PATTERNS: { pattern: string; key: string }[] = [
  { pattern: "BoA 3724", key: "boa_3724" },
  { pattern: "BoA 7830", key: "boa_7830" },
  { pattern: "BoA 8781", key: "boa_8781" },
  { pattern: "Citi Credit", key: "citi_credit" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const NUM_RE = /^-?\$?[\d,]+\.?\d*$/;
function parseNum(s: string): number | null {
  const clean = s.replace(/[$,]/g, "").trim();
  if (!clean || clean === "-" || clean === "–") return null;
  const n = parseFloat(clean);
  return isNaN(n) ? null : n;
}

function groupRows(items: TI[], tolerance = 3): Row[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x); // top to bottom, left to right
  const rows: Row[] = [];
  let cur: Row = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - cur[0].y) <= tolerance) {
      cur.push(sorted[i]);
    } else {
      cur.sort((a, b) => a.x - b.x);
      rows.push(cur);
      cur = [sorted[i]];
    }
  }
  if (cur.length) { cur.sort((a, b) => a.x - b.x); rows.push(cur); }
  return rows;
}

// ─── Extract text items from all pages ───────────────────────────────────────
async function extractPages(file: File): Promise<{ items: TI[]; pageNum: number }[]> {
  const lib = await ensurePdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: buf }).promise;
  const pages: { items: TI[]; pageNum: number }[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: TI[] = content.items
      .filter((it: any) => it.str.trim().length > 0)
      .map((it: any) => ({
        text: it.str.trim(),
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
        w: Math.round(it.width),
      }));
    pages.push({ items, pageNum: p });
  }
  return pages;
}

// ─── Detect month columns from header row ────────────────────────────────────
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function detectMonthColumns(rows: Row[]): { months: { label: string; period: string; x: number }[]; totalX: number } | null {
  for (const row of rows) {
    const monthItems = row.filter(it => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d\d$/.test(it.text));
    if (monthItems.length >= 2) {
      const months = monthItems.map(it => {
        const [mon, yr] = it.text.split(" ");
        const mi = MONTH_NAMES.indexOf(mon) + 1;
        return { label: it.text, period: `${yr}-${String(mi).padStart(2, "0")}`, x: it.x };
      });
      // Find "Total" column
      const totalItem = row.find(it => it.text === "Total");
      const totalX = totalItem?.x ?? (months[months.length - 1].x + 80);
      return { months, totalX };
    }
  }
  return null;
}

// ─── Assign values in a row to month columns ─────────────────────────────────
function assignToColumns(row: Row, cols: { x: number }[]): (number | null)[] {
  const result: (number | null)[] = cols.map(() => null);
  const numItems = row.filter(it => parseNum(it.text) !== null);
  for (const it of numItems) {
    const n = parseNum(it.text);
    if (n === null) continue;
    // Find closest column (within tolerance of 40px)
    let best = -1, bestDist = 40;
    for (let c = 0; c < cols.length; c++) {
      const dist = Math.abs(it.x - cols[c].x);
      if (dist < bestDist) { bestDist = dist; best = c; }
    }
    if (best >= 0) result[best] = n;
  }
  return result;
}

// ─── Extract row label (non-number text on the left) ─────────────────────────
function rowLabel(row: Row, firstColX: number): string {
  return row
    .filter(it => it.x < firstColX - 20 && parseNum(it.text) === null)
    .map(it => it.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Parse P&L by Month ─────────────────────────────────────────────────────
function parsePnl(pages: { items: TI[]; pageNum: number }[]): {
  months: string[]; // period keys
  data: Record<string, Record<string, number>>; // period → pnl_detail
} {
  // Find pages with month headers
  const allRows: Row[] = [];
  let cols: { months: { label: string; period: string; x: number }[]; totalX: number } | null = null;

  for (const pg of pages) {
    const rows = groupRows(pg.items);
    if (!cols) {
      cols = detectMonthColumns(rows);
    }
    // Check if this page continues the table (has month header row repeated)
    const pageCols = detectMonthColumns(rows);
    if (pageCols) cols = pageCols;

    // Collect data rows (skip if no columns detected yet)
    if (cols) {
      for (const row of rows) {
        // Skip header rows, "Total" summary rows we don't need, page footers
        const label = rowLabel(row, cols.months[0].x);
        if (label.startsWith("Patagonia") || /^Page \d/.test(label)) continue;
        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20/.test(label)) continue;
        allRows.push(row);
      }
    }
  }

  if (!cols) throw new Error("Could not find P&L by Month columns in PDF");

  const colPositions = [...cols.months.map(m => ({ x: m.x })), { x: cols.totalX }];
  const result: Record<string, Record<string, number>> = {};
  for (const m of cols.months) result[m.period] = {};

  for (const row of allRows) {
    const label = rowLabel(row, cols.months[0].x);
    // Skip "Total ..." rows (they sum sub-items we already captured) except for Other Income fallback
    const isTotal = label.startsWith("Total ");
    // Match label to PNL_MAP
    const key = PNL_MAP[label];
    if (!key) continue;
    // If this is a "Total" row but we already have data for this key from sub-items, skip it
    if (isTotal && key !== "other_income") continue;
    // For other_income: skip "Total Other Income" if "9000 Other Income" already provided data
    if (isTotal && key === "other_income") {
      const hasData = cols.months.some(m => (result[m.period][key] ?? 0) !== 0);
      if (hasData) continue;
    }

    const values = assignToColumns(row, colPositions);
    for (let i = 0; i < cols.months.length; i++) {
      let v = values[i] ?? 0;
      // Deductions: already negative in PDF → keep as-is
      // Costs/Expenses: positive in PDF → negate; credits (negative) → negate to positive
      if (COST_KEYS.has(key)) v = -v;
      // Use += to accumulate (e.g. parking + gas → vehicle_expenses)
      result[cols.months[i].period][key] = (result[cols.months[i].period][key] ?? 0) + v;
    }
  }

  return { months: cols.months.map(m => m.period), data: result };
}

// ─── Parse Balance Sheet ─────────────────────────────────────────────────────
function parseBs(pages: { items: TI[]; pageNum: number }[]): Record<string, number> {
  const bs: Record<string, number> = {};
  const ccAccum: Record<string, number> = {};

  // Process ALL BS pages (already filtered to BS section by the caller)
  for (const pg of pages) {
    const rows = groupRows(pg.items);
    for (const row of rows) {
      const fullText = row.map(it => it.text).join(" ");
      // Try each BS_MAP entry
      for (const [pdfLabel, key] of Object.entries(BS_MAP)) {
        if (fullText.includes(pdfLabel)) {
          // Get the last number in the row (the value)
          const nums = row.map(it => parseNum(it.text)).filter(n => n !== null) as number[];
          if (nums.length > 0) {
            bs[key] = nums[nums.length - 1];
          }
          break;
        }
      }
      // Credit card accounts: sum sub-accounts
      for (const cc of CC_PATTERNS) {
        if (fullText.includes(cc.pattern) && !fullText.includes("Total")) {
          const nums = row.map(it => parseNum(it.text)).filter(n => n !== null) as number[];
          if (nums.length > 0) {
            ccAccum[cc.key] = (ccAccum[cc.key] ?? 0) + nums[nums.length - 1];
          }
        }
      }
    }
  }

  // Merge credit card totals (prefer explicit "Total BoA 3724" if parsed, else use accumulated)
  for (const cc of CC_PATTERNS) {
    if (ccAccum[cc.key] != null && bs[cc.key] == null) {
      bs[cc.key] = ccAccum[cc.key];
    }
  }

  return bs;
}

// ─── Compute summary fields ($K) ────────────────────────────────────────────
function buildSummary(pnl: Record<string, number>) {
  const gs = (pnl.sales_product ?? 0) + (pnl.shipping_income ?? 0);
  const deductions = (pnl.consumer_returns ?? 0) + (pnl.distributor_fees ?? 0) + (pnl.dsd_programs ?? 0)
    + (pnl.kehe_allowance ?? 0) + (pnl.payment_terms ?? 0) + (pnl.promos ?? 0)
    + (pnl.trade_spend ?? 0) + (pnl.unfi_allowance ?? 0) + (pnl.returns_refunds ?? 0)
    + (pnl.shipping_qty_var ?? 0);
  const ns = gs + deductions;
  const cogs = (pnl.product_costs ?? 0);
  const logistics = (pnl.freight_in ?? 0) + (pnl.freight_out_actual ?? 0)
    + (pnl.merchant_fees ?? 0) + (pnl.warehouse_fulfillment ?? 0);
  const gm = ns + cogs + logistics; // gross margin (ns is positive, cogs/logistics negative)
  const selling = (pnl.broker_commissions ?? 0) + (pnl.slotting_fees ?? 0);
  const mkt = (pnl.demos_merchandising ?? 0) + (pnl.digital_social ?? 0) + (pnl.events_tradeshows ?? 0)
    + (pnl.printing_promotional ?? 0) + (pnl.product_samples ?? 0);
  const team = (pnl.contractors ?? 0) + (pnl.payroll_processing ?? 0) + (pnl.payroll_taxes ?? 0)
    + (pnl.salaries_operations ?? 0);
  const profSvcs = (pnl.accounting_finance ?? 0) + (pnl.business_consultation ?? 0) + (pnl.legal_fees ?? 0);
  const travel = (pnl.car_rental_uber ?? 0) + (pnl.flights ?? 0) + (pnl.hotel ?? 0);
  const genExpTotal = (pnl.bank_charges ?? 0) + (pnl.dues_subscriptions ?? 0) + (pnl.rent ?? 0)
    + (pnl.utilities ?? 0) + (pnl.insurance ?? 0) + (pnl.meals_entertainment ?? 0) + (pnl.office_supplies ?? 0)
    + profSvcs + (pnl.quality_rd ?? 0) + (pnl.taxes_licenses ?? 0) + travel
    + (pnl.vehicle_expenses ?? 0);
  const genExp = genExpTotal - team; // G&A minus payroll
  const totalExp = selling + mkt + team + genExp;
  const ebitda = gm + totalExp;
  const otherIncome = pnl.other_income ?? 0;
  const netIncome = ebitda + otherIncome;

  const K = (v: number) => Math.round(v * 100) / 100000; // raw $ → $K (rounded to 2 decimals)

  return {
    gross_sales: +(gs / 1000).toFixed(2),
    net_sales: +(ns / 1000).toFixed(2),
    cogs: +(cogs / 1000).toFixed(2),
    gross_margin: +(gm / 1000).toFixed(2),
    gm_pct: ns !== 0 ? +(gm / ns).toFixed(4) : 0,
    selling_exp: +(selling / 1000).toFixed(2),
    mkt_trade: +(mkt / 1000).toFixed(2),
    business_contribution: +((gm + selling + mkt) / 1000).toFixed(2),
    team: +(team / 1000).toFixed(2),
    gen_exp: +(genExp / 1000).toFixed(2),
    ebitda: +(ebitda / 1000).toFixed(2),
    other_income: +(otherIncome / 1000).toFixed(2),
    trade_spend: +((-(pnl.dsd_programs ?? 0) - (pnl.promos ?? 0) - (pnl.consumer_returns ?? 0)) / 1000).toFixed(2),
    distr_fees: +((-(pnl.distributor_fees ?? 0) - (pnl.kehe_allowance ?? 0) - (pnl.unfi_allowance ?? 0) - (pnl.payment_terms ?? 0)) / 1000).toFixed(2),
    storage: +((-(pnl.warehouse_fulfillment ?? 0) - (pnl.freight_in ?? 0)) / 1000).toFixed(2),
    freight_out: +((-(pnl.freight_out_actual ?? 0)) / 1000).toFixed(2),
    units_sold: null,
  };
}

function buildBsSummary(bs: Record<string, number>) {
  const cash = (bs.bofa_x6854 ?? 0) + (bs.citi_bank ?? 0) + (bs.mercury_checking ?? 0) + (bs.mercury_treasury ?? 0);
  const ar = bs.accounts_receivable ?? 0;
  const inv = (bs.finished_goods ?? 0) + (bs.raw_materials_packaging ?? 0);
  const loans = bs.loans_to_shareholders ?? 0;
  const fixed = (bs.equipment ?? 0) + (bs.accumulated_depreciation ?? 0);
  const due = bs.due_from_shareholders ?? 0;
  const totalAssets = cash + ar + inv + loans + fixed + due;
  const cc = (bs.boa_3724 ?? 0) + (bs.boa_7830 ?? 0) + (bs.boa_8781 ?? 0) + (bs.citi_credit ?? 0);
  const accrued = bs.accrued_liabilities ?? 0;
  const totalLiab = cc + accrued;
  const equity = (bs.capital_1st_round ?? 0) + (bs.capital_2nd_round ?? 0) + (bs.capital_3rd_round ?? 0)
    + (bs.capital_4th_round ?? 0) + (bs.common_stock ?? 0) + (bs.opening_balance_equity ?? 0)
    + (bs.retained_earnings ?? 0) + (bs.net_income_equity ?? 0);

  return {
    cash: +(cash / 1000).toFixed(2),
    ar: +(ar / 1000).toFixed(2),
    inventory: +(inv / 1000).toFixed(2),
    total_assets: +(totalAssets / 1000).toFixed(2),
    total_liab: +(totalLiab / 1000).toFixed(2),
    total_equity: +(equity / 1000).toFixed(2),
  };
}

// ─── Main entry point ────────────────────────────────────────────────────────
export async function parseAccountfullyPdf(file: File): Promise<any[]> {
  const pages = await extractPages(file);

  // Find P&L by Month pages (look for "Profit and Loss by Month" header)
  const pnlPages: typeof pages = [];
  const bsPages: typeof pages = [];
  let inPnlByMonth = false;
  let inBs = false;

  for (const pg of pages) {
    const texts = pg.items.map(it => it.text).join(" ");
    if (texts.includes("Profit and Loss by Month")) { inPnlByMonth = true; inBs = false; }
    if (texts.includes("Balance Sheet") && texts.includes("ASSETS")) { inBs = true; inPnlByMonth = false; }
    if (inPnlByMonth) pnlPages.push(pg);
    if (inBs) bsPages.push(pg);
  }

  if (!pnlPages.length) throw new Error("Could not find 'Profit and Loss by Month' section in the PDF");

  const { months, data: pnlData } = parsePnl(pnlPages);
  const bsData = bsPages.length ? parseBs(bsPages) : {};
  const lastMonth = months[months.length - 1];

  // Build output rows
  const rows: any[] = [];
  for (const period of months) {
    const pnl = pnlData[period] ?? {};
    const summary = buildSummary(pnl);
    const isLast = period === lastMonth;

    const MLABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    rows.push({
      period,
      period_label: (() => { const [y, m] = period.split("-"); return `${MLABELS[parseInt(m)-1]} ${y}`; })(),
      ...summary,
      pnl_detail: pnl,
      bs_detail: isLast && Object.keys(bsData).length > 0 ? bsData : null,
      ...(isLast && Object.keys(bsData).length > 0 ? buildBsSummary(bsData) : {}),
    });
  }

  return rows;
}
