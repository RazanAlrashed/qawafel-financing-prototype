/**
 * generate_data.js
 * Generates 12 months of made-up invoices for a fictional Jeddah beverage distributor
 * ("Red Sea Beverages Trading") and writes them to data/invoices.csv.
 *
 * Run:  node scripts/generate_data.js
 * No packages needed. The seed is fixed, so the output is the same every time.
 * No real company or customer data is used.
 */
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- 1. Settings
const SEED = 7319;
const DAY = 864e5;                        // milliseconds in one day
const AS_OF = Date.UTC(2026, 8, 30);      // report date: 30 Sep 2026
const START = { year: 2025, month: 9 };   // first month: Oct 2025 (month index 9)
const VAT_RATE = 0.15;                    // Saudi VAT
const BASE_MONTHLY_REVENUE = 780000;      // SAR net, before seasonality and growth
const MONTHLY_GROWTH = 0.008;             // about 0.8% growth per month

// Seasonality by month, Oct 2025 to Sep 2026.
// Cold drinks sell more in the heat (Jun-Aug), plus peaks for Ramadan/Eid (Feb-Mar)
// and the Hajj season (May-Jun). Winter (Dec-Jan) is the slowest.
const SEASONALITY = [1.0, 0.9, 0.85, 0.85, 1.15, 1.3, 1.0, 1.2, 1.3, 1.25, 1.2, 1.0];

// Buyers: share of sales, payment terms (days), and how many days late they
// usually pay. Shares add up to 1. The biggest buyer (19%) is also the risky one:
// see the dispute settings below.
const BUYERS = [
  { name: "Corniche Hotels Group",  share: 0.19, terms: 60, lateDays: 18 },
  { name: "Balad Supermarkets",     share: 0.14, terms: 30, lateDays: 4 },
  { name: "Obhur Resorts",          share: 0.12, terms: 45, lateDays: 9 },
  { name: "Hijaz Cafe Chain",       share: 0.10, terms: 30, lateDays: 5 },
  { name: "Tahlia Fresh Stores",    share: 0.09, terms: 30, lateDays: 6 },
  { name: "Rawdah Catering",        share: 0.08, terms: 45, lateDays: 14 },
  { name: "Harbor Mini Markets",    share: 0.07, terms: 30, lateDays: 7 },
  { name: "Sharafiyah Kiosks",      share: 0.06, terms: 30, lateDays: 11 },
  { name: "Safwa Event Services",  share: 0.05, terms: 60, lateDays: 28 },
  { name: "Andalus Restaurants",    share: 0.04, terms: 45, lateDays: 10 },
  { name: "Nuzha Cooperative",      share: 0.03, terms: 30, lateDays: 5 },
  { name: "Makkah Road Wholesale",  share: 0.03, terms: 45, lateDays: 20 },
];

// Risk story: the largest buyer (a hotel group) stops paying many invoices issued
// between Feb and Jun 2026 (month index 4 to 8), so old overdue receivables build up.
const DISPUTED_BUYER = 0;
const DISPUTE_FROM = 4, DISPUTE_TO = 8;
const DISPUTE_CHANCE = 0.55;

// Data gap: the export for November 2025 is incomplete (only 45% of invoices kept).
const GAP_MONTH = 1;
const GAP_KEEP = 0.45;

// ------------------------------------------------- 2. Seeded random generator
// mulberry32: a small generator that returns the same sequence for the same seed.
let state = SEED;
function rand() {
  state |= 0; state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ------------------------------------------------------- 3. Generate invoices
// For each month, keep adding invoices until the month's revenue target is reached.
let invoices = [];
for (let m = 0; m < 12; m++) {
  const year = START.year + Math.floor((START.month + m) / 12);
  const month = (START.month + m) % 12;
  const target = BASE_MONTHLY_REVENUE * SEASONALITY[m] * (1 + MONTHLY_GROWTH * m);
  const monthStart = invoices.length;
  let total = 0;

  while (total < target) {
    // Pick a buyer, weighted by sales share.
    const r = rand();
    let b = 0, cumulative = 0;
    for (; b < BUYERS.length - 1; b++) {
      cumulative += BUYERS[b].share;
      if (r < cumulative) break;
    }
    const buyer = BUYERS[b];

    // Amount: many small invoices, a few large ones (2,500 to about 26,500 SAR).
    const a1 = rand(), a2 = rand();
    const net = Math.round(2500 + a1 * a2 * 24000);

    // Dates: random day in the month, due date from the buyer's terms.
    const date = Date.UTC(year, month, 1 + Math.floor(rand() * 28));
    const due = date + buyer.terms * DAY;

    // Payment: the buyer pays around (due date + typical lateness), with some noise.
    // If that day is after the report date, the invoice is still open.
    const noise = rand();
    const paidOn = due + Math.round(buyer.lateDays + (noise - 0.5) * buyer.lateDays * 1.2) * DAY;
    let paid = paidOn <= AS_OF ? paidOn : null;

    // Disputed account: many hotel-group invoices in Feb-Jun are never paid.
    if (b === DISPUTED_BUYER && m >= DISPUTE_FROM && m <= DISPUTE_TO && rand() < DISPUTE_CHANCE) paid = null;

    invoices.push({
      type: "invoice", buyer: buyer.name, date, due, paid,
      net, vat: Math.round(net * VAT_RATE),
    });
    total += net;
  }

  // Data gap: drop most of one month's invoices to mimic an incomplete export.
  if (m === GAP_MONTH) {
    const monthInvoices = invoices.splice(monthStart);
    for (const inv of monthInvoices) if (rand() < GAP_KEEP) invoices.push(inv);
  }
}

// Sort by date and number the invoices.
invoices.sort((x, y) => x.date - y.date);
invoices.forEach((inv, i) => (inv.no = "INV-" + (1001 + i)));
const count = invoices.length;

// ---------------------------------------- 4. Add deliberate errors to find later
// The prototype's data-quality checks should catch all of these.

// 5 duplicate rows (same invoice number exported twice).
[0.1, 0.33, 0.52, 0.77, 0.9].forEach((f) => invoices.push({ ...invoices[Math.floor(count * f)] }));

// 3 credit notes (negative amounts, 30% of an earlier invoice, settled immediately).
[0.12, 0.4, 0.66].forEach((f, i) => {
  const o = invoices[Math.floor(count * f)];
  const net = -Math.round(o.net * 0.3);
  const date = o.date + 10 * DAY;
  invoices.push({
    no: "CN-" + (301 + i), type: "credit_note", buyer: o.buyer,
    date, due: date, paid: date, net, vat: Math.round(net * VAT_RATE),
  });
});

// 3 invoices with VAT missing (VAT = 0 on a taxable sale).
[0.22, 0.58, 0.81].forEach((f) => (invoices[Math.floor(count * f)].vat = 0));

// ------------------------------------------------------------- 5. Write the CSV
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const header = "invoice_no,type,buyer,issue_date,due_date,paid_date,net,vat,total";
const rows = invoices.map((v) =>
  [v.no, v.type, `"${v.buyer}"`, iso(v.date), iso(v.due), v.paid ? iso(v.paid) : "", v.net, v.vat, v.net + v.vat].join(",")
);
const out = path.join(__dirname, "..", "data", "invoices.csv");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, header + "\n" + rows.join("\n") + "\n");

// ---------------------------------------------------- 6. Count what is in the data
// These numbers are computed from the generated rows, not typed by hand.
const seen = new Set();
let duplicates = 0, creditNotes = 0, missingVat = 0;
const perMonth = {};
for (const v of invoices) {
  if (seen.has(v.no)) duplicates++; else seen.add(v.no);
  if (v.type === "credit_note") creditNotes++;
  if (v.type === "invoice" && v.vat === 0) missingVat++;
  if (v.type === "invoice") {
    const key = iso(v.date).slice(0, 7);
    perMonth[key] = (perMonth[key] || 0) + 1;
  }
}
const counts = Object.entries(perMonth).sort((x, y) => x[0].localeCompare(y[0]));
const median = counts.map((c) => c[1]).sort((x, y) => x - y)[Math.floor(counts.length / 2)];
const thin = counts.filter((c) => c[1] < 0.6 * median).map((c) => c[0]);

console.log(`Wrote ${rows.length} rows to ${out}`);
console.log(`Found in the data: ${duplicates} duplicate invoice numbers, ${creditNotes} credit notes, ${missingVat} invoices with missing VAT.`);
console.log(`Months with unusually few invoices (under 60% of the median ${median}): ${thin.join(", ") || "none"}.`);
