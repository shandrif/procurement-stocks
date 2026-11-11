#!/usr/bin/env node
// Manage the single dashboard login.
//   node scripts/credentials.mjs init   --user <id> --password <pw>   (new key pair; old data becomes unreadable until the next import)
//   node scripts/credentials.mjs change --user <id> --password <pw> --new-user <id> --new-password <pw>
// "change" keeps the same key pair, so existing data and history stay readable.

import { readFile, writeFile } from 'node:fs/promises';
import { createKeyring, rekeyKeyring } from './lib/crypto.mjs';

const KEYRING = new URL('../data/keyring.json', import.meta.url);
const [cmd, ...rest] = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];

function need(...keys) {
  for (const k of keys) if (!args[k]) { console.error(`Missing --${k}`); process.exit(1); }
}
function strong(pw) {
  if (pw.length < 10) { console.error('Use a password of at least 10 characters.'); process.exit(1); }
}

if (cmd === 'init') {
  need('user', 'password'); strong(args.password);
  await writeFile(KEYRING, JSON.stringify(await createKeyring(args.user, args.password), null, 2) + '\n');
  console.log('New keyring written to data/keyring.json. Run the import so data is sealed with the new key.');
} else if (cmd === 'change') {
  need('user', 'password', 'new-user', 'new-password'); strong(args['new-password']);
  const keyring = JSON.parse(await readFile(KEYRING, 'utf8'));
  const next = await rekeyKeyring(keyring, args.user, args.password, args['new-user'], args['new-password']);
  await writeFile(KEYRING, JSON.stringify(next, null, 2) + '\n');
  console.log('Login changed. Existing data stays readable.');
} else {
  console.log('Usage: credentials.mjs init|change --user … --password … [--new-user … --new-password …]');
  process.exit(1);
}
