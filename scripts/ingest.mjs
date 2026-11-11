#!/usr/bin/env node
// Daily import: workbook text → stock records → encrypted files the app reads.
//   node scripts/ingest.mjs <workbook.txt|csv> [--sample] [--dry-run]
// Writes data/inventory.enc.json and appends a day to data/history.enc.json.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseWorkbookText } from './lib/workbook.mjs';
import { normalize, classify } from './lib/normalize.mjs';
import { sealJson } from './lib/crypto.mjs';

const root = new URL('..', import.meta.url);
const path = (p) => new URL(p, root);
const args = process.argv.slice(2);
const input = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--date');
const isSample = args.includes('--sample');
const dryRun = args.includes('--dry-run');
const dateArg = args[args.indexOf('--date') + 1];
if (!input) { console.error('Usage: ingest.mjs <workbook.txt> [--sample] [--dry-run]'); process.exit(1); }

const config = JSON.parse(await readFile(path('config/source.json'), 'utf8'));
const t = { criticalQty: 10, criticalDays: 7, lowFactor: 2, ...config.thresholds };

const text = await readFile(input, 'utf8');
const sheets = parseWorkbookText(text);
const { records, report } = normalize(sheets, config);

console.log('Sheets:');
for (const r of report) console.log(' ', r.sheet.padEnd(28), r.skipped ? `skipped (${r.skipped})` : `${r.layout}, ${r.records} records`);
if (!records.length) {
  console.error('\nNo stock records found. Check config/source.json (columns, sheets, layout).');
  process.exit(2);
}

for (const r of records) r.status = classify(r, t);
const count = (s) => records.filter((r) => r.status === s).length;
const summary = {
  records: records.length,
  items: new Set(records.map((r) => r.item.toLowerCase())).size,
  locations: new Set(records.map((r) => r.location)).size,
  units: records.reduce((a, r) => a + Math.max(0, r.qty), 0),
  value: records.reduce((a, r) => a + (r.unitCost ? Math.max(0, r.qty) * r.unitCost : 0), 0),
  out: count('out'), critical: count('critical'), low: count('low'), ok: count('ok'),
};
console.log('\nSummary:', summary);
if (dryRun) process.exit(0);

const now = args.includes('--date') ? new Date(`${dateArg}T07:00:00+03:00`) : new Date();
const keyring = JSON.parse(await readFile(path('data/keyring.json'), 'utf8'));
const fields = ['sheet', 'item', 'code', 'category', 'location', 'qty', 'min', 'max', 'uom', 'unitCost', 'usage', 'status'];
const payload = {
  generatedAt: now.toISOString(),
  source: { label: config.source?.label ?? 'Stock file', sample: isSample, sheets: report },
  thresholds: t,
  summary,
  fields,
  rows: records.map((r) => fields.map((f) => r[f] ?? null)),
};
await writeFile(path('data/inventory.enc.json'), JSON.stringify(await sealJson(payload, keyring)) + '\n');

// History: one sealed entry per day (replacing a same-day rerun), last 120 days.
const day = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone ?? 'Asia/Riyadh' }).format(now);
const perItem = {};
for (const r of records) perItem[r.item] = (perItem[r.item] ?? 0) + Math.max(0, r.qty);
const historyFile = path('data/history.enc.json');
let history = existsSync(historyFile) ? JSON.parse(await readFile(historyFile, 'utf8')) : { v: 1, days: [] };
if (isSample !== Boolean(history.sample)) history = { v: 1, days: [] }; // never mix sample and real data
history.sample = isSample;
history.days = history.days.filter((d) => d.day !== day);
history.days.push({ day, entry: await sealJson({ day, summary, perItem }, keyring) });
history.days = history.days.sort((a, b) => a.day.localeCompare(b.day)).slice(-120);
await writeFile(historyFile, JSON.stringify(history) + '\n');

console.log(`\nWrote data/inventory.enc.json and history for ${day}.`);
