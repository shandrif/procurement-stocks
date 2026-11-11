#!/usr/bin/env node
// Collects the public site into _site/ (only encrypted data is included).
import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';

const out = new URL('../_site/', import.meta.url);
const from = (p) => new URL(`../${p}`, import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('data/', out), { recursive: true });
await cp(from('index.html'), new URL('index.html', out));
await cp(from('assets'), new URL('assets', out), { recursive: true });
for (const f of ['keyring.json', 'inventory.enc.json', 'history.enc.json']) {
  try { await access(from(`data/${f}`)); await cp(from(`data/${f}`), new URL(`data/${f}`, out)); } catch {}
}
await writeFile(new URL('_headers', out), `/*
  X-Robots-Tag: noindex, nofollow
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY

/data/*
  Cache-Control: no-store
`);
console.log('Site built in _site/');
