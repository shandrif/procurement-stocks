// Turns raw sheets into stock records. Two layouts are understood:
//   list   — one row per item (or item × warehouse) with a quantity column
//   matrix — items down the side, locations across the top (store SOH trackers)
// Column aliases can be extended in config/source.json → "columns".

import { toNumber } from './workbook.mjs';

export const DEFAULT_ALIASES = {
  item: ['item description', 'description', 'item name', 'item', 'items', 'items/stores', 'product', 'material', 'name', 'item desc'],
  code: ['item code', 'code', 'sku', 'item number', 'item no', 'item #', 'material code', 'part number', 'barcode'],
  category: ['category', 'item category', 'group', 'item group', 'family', 'class', 'type'],
  location: ['warehouse', 'location', 'store', 'branch', 'subinventory', 'organization', 'org', 'site', 'wh'],
  qty: ['on hand', 'onhand', 'on-hand', 'soh', 'stock on hand', 'quantity', 'qty', 'available', 'available qty', 'balance', 'closing stock', 'current stock', 'stock', 'qty on hand'],
  min: ['min', 'min qty', 'minimum', 'min stock', 'reorder level', 'reorder point', 'rop', 'safety stock', 'par', 'par level'],
  max: ['max', 'max qty', 'maximum', 'max stock'],
  uom: ['uom', 'u/m', 'unit', 'unit of measure', 'units'],
  unitCost: ['unit cost', 'unit price', 'cost', 'price', 'unit pr', 'avg cost'],
  usage: ['avg daily usage', 'daily usage', 'avg daily consumption', 'daily consumption', 'consumption/day', 'usage per day', 'adu'],
};

// Matrix columns that are summaries, not locations.
const NON_LOCATION = /^(total|totals|grand total|av|avg|average|remarks?|notes?|comments?|sum)$/i;

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function buildAliases(config) {
  const out = {};
  for (const [key, list] of Object.entries(DEFAULT_ALIASES)) {
    out[key] = [...(config.columns?.[key] ?? []), ...list].map(norm);
  }
  return out;
}

function matchColumns(headerRow, aliases) {
  const cells = headerRow.map(norm);
  const map = {};
  for (const [key, list] of Object.entries(aliases)) {
    // exact match first, in alias priority order
    for (const alias of list) {
      const idx = cells.findIndex((c, i) => c === alias && !Object.values(map).includes(i));
      if (idx !== -1) { map[key] = idx; break; }
    }
  }
  return map;
}

function findHeader(rows, aliases) {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const filled = rows[r].filter((c) => String(c).trim() !== '').length;
    if (filled < 2) continue;
    const map = matchColumns(rows[r], aliases);
    if (map.item !== undefined || map.code !== undefined) return { index: r, map };
  }
  return null;
}

function pick(row, idx) {
  return idx === undefined ? '' : String(row[idx] ?? '').trim();
}

export function normalize(sheets, config = {}) {
  const aliases = buildAliases(config);
  const ignore = new Set((config.ignoreSheets ?? []).map(norm));
  const only = (config.sheets ?? []).map(norm);
  const records = [];
  const report = [];

  for (const sheet of sheets) {
    const key = norm(sheet.name);
    if (ignore.has(key) || (only.length && !only.includes(key))) {
      report.push({ sheet: sheet.name, skipped: 'ignored by config' });
      continue;
    }
    const header = findHeader(sheet.rows, aliases);
    if (!header) { report.push({ sheet: sheet.name, skipped: 'no header row found' }); continue; }

    const layout = config.layout && config.layout !== 'auto'
      ? config.layout
      : header.map.qty !== undefined ? 'list' : 'matrix';

    const before = records.length;
    const body = sheet.rows.slice(header.index + 1);
    if (layout === 'list') readList(sheet.name, body, header.map, records, config);
    else readMatrix(sheet.name, sheet.rows[header.index], body, header.map, records, config);
    report.push({ sheet: sheet.name, layout, records: records.length - before });
  }
  return { records, report };
}

function readList(sheetName, body, map, records, config) {
  let category = '';
  for (const row of body) {
    const item = pick(row, map.item) || pick(row, map.code);
    const qty = toNumber(pick(row, map.qty));
    if (!item) continue;
    if (qty === null) {
      // A lone label with no quantity is usually a section/category heading.
      if (row.filter((c) => String(c).trim()).length === 1) category = item;
      continue;
    }
    if (/^(grand )?total/i.test(item)) continue;
    records.push({
      sheet: sheetName,
      item,
      code: pick(row, map.code),
      category: pick(row, map.category) || category || config.defaultCategory || sheetName,
      location: pick(row, map.location) || config.defaultLocation || sheetName,
      qty,
      min: toNumber(pick(row, map.min)),
      max: toNumber(pick(row, map.max)),
      uom: pick(row, map.uom),
      unitCost: toNumber(pick(row, map.unitCost)),
      usage: toNumber(pick(row, map.usage)),
    });
  }
}

function readMatrix(sheetName, headerRow, body, map, records, config) {
  const itemCol = map.item ?? map.code ?? 0;
  const locCols = [];
  headerRow.forEach((cell, i) => {
    const label = String(cell ?? '').trim();
    if (i === itemCol || !label || NON_LOCATION.test(label)) return;
    if (Object.values(map).includes(i)) return;
    locCols.push({ i, label });
  });
  let category = '';
  for (const row of body) {
    const item = String(row[itemCol] ?? '').trim();
    const values = locCols.map(({ i }) => toNumber(row[i]));
    if (!item) { if (values.every((v) => v === null)) category = ''; continue; }
    if (values.every((v) => v === null)) { category = item; continue; }
    if (/^(grand )?total/i.test(item)) continue;
    locCols.forEach(({ label }, k) => {
      if (values[k] === null && config.blankMeansZero === false) return;
      records.push({
        sheet: sheetName,
        item,
        code: pick(row, map.code),
        category: pick(row, map.category) || category || config.defaultCategory || inferCategory(item, config),
        location: label,
        qty: values[k] ?? 0,
        min: null, max: null, uom: pick(row, map.uom), unitCost: null, usage: null,
      });
    });
  }
}

function inferCategory(item, config) {
  for (const [cat, words] of Object.entries(config.categoryKeywords ?? {})) {
    if (words.some((w) => item.toLowerCase().includes(w.toLowerCase()))) return cat;
  }
  return 'General';
}

// out → critical → low → ok
export function classify(rec, t) {
  if (rec.qty <= 0) return 'out';
  if (rec.min != null && rec.min > 0) {
    if (rec.qty <= rec.min) return 'critical';
    if (rec.qty <= rec.min * t.lowFactor) return 'low';
    return 'ok';
  }
  if (rec.usage != null && rec.usage > 0) {
    const days = rec.qty / rec.usage;
    if (days <= t.criticalDays) return 'critical';
    if (days <= t.criticalDays * t.lowFactor) return 'low';
    return 'ok';
  }
  if (rec.qty <= t.criticalQty) return 'critical';
  if (rec.qty <= t.criticalQty * t.lowFactor) return 'low';
  return 'ok';
}
