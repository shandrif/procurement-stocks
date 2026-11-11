#!/usr/bin/env node
// Writes a realistic sample workbook (same text format the M365 connector returns)
// so the dashboard can be previewed before the real file is connected.
//   node scripts/make-sample.mjs <out.txt> [--seed N]

import { writeFile } from 'node:fs/promises';

const out = process.argv[2] ?? 'data/raw/sample.txt';
let seed = Number(process.argv[process.argv.indexOf('--seed') + 1]) || 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const catalogue = {
  'Coffee Beans': [['Ethiopian Guji Espresso Beans 1KG', 'KG', 95], ['Brazilian Drip Beans 1KG', 'KG', 72], ['Colombian Supremo Beans 1KG', 'KG', 88], ['Decaf House Blend 1KG', 'KG', 101], ['Costa Rica Tarrazu 1KG', 'KG', 110], ['Green Beans Ethiopia (60KG bag)', 'BAG', 1650]],
  Dairy: [['Fresh Milk Full Fat 1L', 'CTN', 66], ['Oat Milk Barista 1L', 'CTN', 168], ['Almond Milk 1L', 'CTN', 172], ['Whipping Cream 1L', 'CTN', 210], ['Condensed Milk 397g', 'CTN', 140]],
  'Syrups & Sauces': [['Vanilla Syrup 1L', 'BTL', 34], ['Caramel Syrup 1L', 'BTL', 34], ['Hazelnut Syrup 1L', 'BTL', 34], ['Chocolate Sauce 2KG', 'TUB', 58], ['Salted Caramel Sauce 2KG', 'TUB', 61], ['Hot Chocolate Mix 3L', 'GAL', 75]],
  'Cups & Lids': [['Espresso Cup 4oz', 'CTN', 120], ['Drip Coffee Cup 12oz', 'CTN', 185], ['Drip Coffee Cup 16oz', 'CTN', 205], ['Cold Cup PET 16oz', 'CTN', 230], ['Hot Lid 12/16oz', 'CTN', 95], ['Dome Lid Cold 16oz', 'CTN', 110], ['Cup Sleeve Kraft', 'CTN', 80]],
  Packaging: [['Paper Bag Medium', 'CTN', 90], ['Carrier 2-Cup', 'CTN', 70], ['Carrier 4-Cup', 'CTN', 85], ['Wooden Stirrer', 'CTN', 40], ['Paper Straw 8mm', 'CTN', 60], ['Napkin Branded', 'CTN', 55]],
  Merchandise: [['Hot & Cold Mug Black (Stable)', 'PCS', 38], ['Hot & Cold Mug Beige (Stable)', 'PCS', 38], ['Al Sail Mug Orange 40oz', 'PCS', 52], ['Espresso Mug', 'PCS', 24], ['Coffee Card Lobo Guara', 'PCS', 2]],
  Cleaning: [['Espresso Machine Cleaner Tabs', 'BOX', 145], ['Milk System Cleaner 1L', 'BTL', 62], ['Sanitizer Spray 5L', 'GAL', 48], ['Grinder Cleaning Pellets', 'BOX', 98], ['Blue Roll Paper', 'ROLL', 18]],
  Bakery: [['Butter Croissant (frozen)', 'BOX', 160], ['Chocolate Cookie Dough', 'BOX', 190], ['Cheesecake Slice', 'BOX', 240], ['Banana Bread Loaf', 'BOX', 150]],
};
const warehouses = ['Riyadh Central WH', 'Jeddah WH', 'Al Khobar WH'];

const header = ['Item Code', 'Item Description', 'Category', 'UOM', 'Warehouse', 'On Hand', 'Min Qty', 'Avg Daily Usage', 'Unit Cost'];
const rows = [header];
let n = 1;
for (const [cat, items] of Object.entries(catalogue)) {
  const prefix = cat.slice(0, 2).toUpperCase();
  for (const [name, uom, cost] of items) {
    const code = `${prefix}${String(1010000 + n++).padStart(8, '0')}`;
    for (const wh of warehouses) {
      const usage = Math.max(1, Math.round(rand() * 18 + (wh.startsWith('Riyadh') ? 8 : 2)));
      const min = usage * 7;
      const roll = rand();
      let onHand;
      if (roll < 0.09) onHand = 0;
      else if (roll < 0.22) onHand = Math.round(min * (0.2 + rand() * 0.75));
      else if (roll < 0.36) onHand = Math.round(min * (1.05 + rand() * 0.9));
      else onHand = Math.round(min * (2.1 + rand() * 4));
      rows.push([code, name, cat, uom, wh, onHand.toLocaleString('en-US'), min, usage, cost.toFixed(2)]);
    }
  }
}

const text = [
  `Workbook: 1 worksheets. Cell values are tab-separated rows (sample data).`,
  `## Sheet: Stock — ${rows.length} rows × ${header.length} columns`,
  ...rows.map((r) => r.join('\t')),
].join('\n');
await writeFile(out, text + '\n');
console.log(`Sample workbook written to ${out} (${rows.length - 1} rows)`);
